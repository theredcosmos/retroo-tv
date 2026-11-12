import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom } from 'rxjs';
import { RetrooApi } from '../api/retroo-api.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PlayerStore } from '../player/player.store';
import { ToastService } from '../ui/toast.service';
import {
  ApiError,
  ChatMessage,
  JamAccess,
  JamControlAction,
  JamError,
  JamEvent,
  JamSnapshot,
  JamSummary,
  JamVisibility,
  JoinRequest,
  PlaybackState,
  SharedPlaylist,
} from '../models';

const MAX_CHAT = 100;
const HOST_HEARTBEAT_MS = 15_000;
const LOBBY_REFRESH_MS = 20_000;
const NAME_KEY = 'retroo.displayName';
const tokenKey = (code: string) => `retroo.jam.${code}.hostToken`;
/** Guest's key for a private jam (invite token from a link, or the pass the host's OK issued). */
const guestKeyKey = (code: string) => `retroo.jam.${code}.key`;
/** Jam this tab was in (sessionStorage) — lets a page reload rejoin automatically. */
const ACTIVE_KEY = 'retroo.jam.active';
/** Name this tab joined with — tabs of one browser share localStorage but must keep separate identities. */
const TAB_NAME_KEY = 'retroo.jam.name';
const JAM_PATH = /^\/jam\/([A-Z0-9]{6})\/?$/i;

/** `waiting` = asked to join a private jam, waiting for the host's answer. */
export type JamStatus = 'idle' | 'joining' | 'waiting' | 'live' | 'ended';

/**
 * Jam sessions on the client (gemini.md §8).
 *
 *  - Lobby: lists live jams (REST, refreshed every 20 s while not in a jam).
 *  - Joining: REST snapshot (chat history, members, current playback) → STOMP subscribe to `/topic/jam/{code}` and
 *    `/user/queue/jam-errors` → SEND `/app/jam/{code}/join`. After a reconnect the join is re-sent automatically,
 *    because the server dropped our membership when the old socket closed.
 *  - Host: mirrors its own PlayerStore to the server (LOAD on song change, PLAY/PAUSE on state change, SEEK on
 *    seek, PLAY heartbeat every 15 s for late joiners and drift).
 *  - Guest: PlayerStore runs in follow mode and applies every STATE event (drift-corrected).
 *  - URL: `/jam/{code}` is pushed into history so the address bar is the invite link; opening it pre-fills the
 *    join form.
 *
 * The host token lives in sessionStorage (per tab) — enough to survive a reload, never sent anywhere except the
 * jam's own control/extend/end calls.
 */
@Injectable({ providedIn: 'root' })
export class JamStore {
  private readonly api = inject(RetrooApi);
  private readonly realtime = inject(RealtimeService);
  private readonly player = inject(PlayerStore);
  private readonly toast = inject(ToastService);

  // ---- state -------------------------------------------------------------------------------------------
  readonly lobby = signal<JamSummary[]>([]);
  readonly jam = signal<JamSnapshot | null>(null);
  readonly chat = signal<ChatMessage[]>([]);
  readonly members = signal<string[]>([]);
  readonly status = signal<JamStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly hostToken = signal<string | null>(null);
  /** Code from a `/jam/XXXXXX` link the user opened, waiting for them to enter a name. */
  readonly invitedCode = signal<string | null>(readInviteCode());
  readonly displayName = signal<string>(readSession(TAB_NAME_KEY) ?? readName());
  readonly busy = signal(false);
  /** Jam drawer visibility (UI state shared by the header button and the drawer). */
  readonly drawerOpen = signal(readInviteCode() !== null);
  /**
   * A shared playlist the user chose to "play in a jam" while not in one. Starting a jam puts it on the TV;
   * joining someone else's jam suggests it in that jam's chat.
   */
  readonly pendingPlaylist = signal<SharedPlaylist | null>(null);
  /** Private jam we asked to join, while waiting for the host (name/host shown on the waiting card). */
  readonly waitingFor = signal<{ code: string; name: string; hostName: string } | null>(null);
  /** Host: people asking to be let in. */
  readonly requests = signal<JoinRequest[]>([]);
  /** Host: secret of the private invite link (fetched lazily after a reload). */
  readonly inviteToken = signal<string | null>(null);
  /** Key from an invite link's `#k=` fragment, for the invited code. */
  private readonly linkKey = readLinkKey();
  private accessSubs = new Subscription();

  /** Ticks every second while in a jam (drives the countdown). */
  private readonly now = signal(Date.now());
  /** serverTime − Date.now(), refreshed on every event. */
  private offsetMs = 0;

  // ---- derived -----------------------------------------------------------------------------------------
  readonly inJam = computed(() => this.status() === 'live' && this.jam() !== null);
  readonly isHost = computed(() => this.inJam() && this.hostToken() !== null);
  readonly msLeft = computed(() => {
    const j = this.jam();
    return j ? Math.max(0, Date.parse(j.expiresAt) - (this.now() + this.offsetMs)) : 0;
  });
  readonly endingSoon = computed(() => this.inJam() && this.msLeft() <= 5 * 60_000);
  readonly canExtend = computed(() => this.isHost() && !this.jam()?.extended);
  readonly isPrivate = computed(() => this.jam()?.visibility === 'PRIVATE');
  readonly inviteLink = computed(() => {
    const j = this.jam();
    return j ? `${location.origin}/jam/${j.code}` : '';
  });

  private subs = new Subscription();
  private ticker?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lobbyTimer?: ReturnType<typeof setInterval>;
  private lastSentVideoId?: string;
  private lastSentPlaying?: boolean;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Re-join after the socket reconnects (membership is tied to the STOMP session).
    this.realtime.connected$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      const j = this.jam();
      if (this.status() === 'live' && j) this.sendJoin(j.code);
    });

    // Host → server: mirror local playback.
    effect(() => {
      if (!this.isHost()) return;
      const song = this.player.current();
      const playing = this.player.isPlaying();
      const transition = this.player.transition();
      untracked(() => {
        if (!song || transition !== 'none') return; // wait until the new picture is actually up
        // Keyed on id + title: playlist songs get their real title a moment after they start; resend so
        // guests show it too.
        const key = `${song.videoId}|${song.title}`;
        if (key !== this.lastSentVideoId) {
          this.control('LOAD', { song: { ...song, id: song.id > 0 ? song.id : null } });
          this.lastSentVideoId = key;
          this.lastSentPlaying = undefined;
        }
        if (playing !== this.lastSentPlaying) {
          this.control(playing ? 'PLAY' : 'PAUSE');
          this.lastSentPlaying = playing;
        }
      });
    });
    this.player.seeked$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (this.isHost()) this.control('SEEK');
    });

    // Lobby polling only while the lobby is actually on screen (drawer open, not inside a jam).
    effect(() => {
      const browsing = this.drawerOpen() && (this.status() === 'idle' || this.status() === 'ended');
      untracked(() => (browsing ? this.startLobby() : this.stopLobby()));
    });

    destroyRef.onDestroy(() => this.teardown());

    // Reload resilience: if this tab was already in the jam named by the URL, go straight back in.
    const invited = this.invitedCode();
    if (invited && invited === readSession(ACTIVE_KEY) && this.displayName().trim()) {
      void this.join(invited);
    }
  }

  // ---- intents -----------------------------------------------------------------------------------------

  setName(name: string): void {
    this.displayName.set(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage blocked */
    }
  }

  refreshLobby(): void {
    this.api.jams().subscribe({ next: (list) => this.lobby.set(list), error: () => undefined });
  }

  async create(jamName: string, visibility: JamVisibility = 'OPEN'): Promise<void> {
    await this.run(async () => {
      const res = await firstValueFrom(this.api.createJam(jamName.trim(), this.displayName().trim(), visibility));
      this.inviteToken.set(res.inviteToken);
      try {
        sessionStorage.setItem(tokenKey(res.jam.code), res.hostToken);
      } catch {
        /* storage blocked — host controls work until reload */
      }
      this.hostToken.set(res.hostToken);
      this.enter(res.jam);
      const pending = this.pendingPlaylist();
      if (pending) {
        this.pendingPlaylist.set(null);
        this.hostPlaylist(pending);
      }
    });
  }

  async join(code: string): Promise<void> {
    await this.run(async () => {
      const upper = code.toUpperCase();
      const token = readToken(upper);
      // Key for a private jam: one saved earlier in this tab, or the one in the invite link we opened.
      const key = readSession(guestKeyKey(upper)) ?? (this.linkKey?.code === upper ? this.linkKey.key : null);
      const snapshot = await firstValueFrom(this.api.jam(upper, token ?? key));
      if (!token && snapshot.hostName.toLowerCase() === this.displayName().trim().toLowerCase()) {
        // The server refuses guests using the host's name (anti-impersonation); say so before entering.
        this.error.set(`“${snapshot.hostName}” is the host's name — pick another one to join.`);
        return;
      }
      if (snapshot.locked) {
        // Private and we hold no valid key (none, or an invite link the host has since replaced): ask the host.
        writeSession(guestKeyKey(upper), null);
        this.ask(snapshot);
        return;
      }
      if (key && !token) writeSession(guestKeyKey(upper), key);
      this.hostToken.set(token);
      this.enter(snapshot);
      const pending = this.pendingPlaylist();
      if (pending) {
        this.pendingPlaylist.set(null);
        this.playlistToJam(pending);
      }
    });
  }

  /**
   * "Play in jam" for a shared playlist — what it means depends on where this user is:
   *  - host of a live jam → put it on the TV (guests follow) and post it in the chat so everyone sees what's on;
   *  - guest → suggest it in the chat; the host gets a "Play on TV" button on the message;
   *  - not in a jam → open the jam drawer with the playlist waiting; starting a jam plays it.
   */
  playlistToJam(p: SharedPlaylist): void {
    if (this.isHost()) {
      this.hostPlaylist(p);
    } else if (this.inJam()) {
      this.sendChat(`Can we play “${p.playlistName}”? ${p.playlistUrl}`);
      this.toast.show('Suggested to the jam — the host can put it on the TV.');
    } else {
      this.pendingPlaylist.set(p);
      this.drawerOpen.set(true);
    }
  }

  leave(): void {
    const j = this.jam();
    if (j) this.realtime.publish(`/app/jam/${j.code}/leave`, {});
    this.exit(null);
  }

  sendChat(text: string): void {
    const j = this.jam();
    const t = text.trim();
    if (!j || !t) return;
    this.realtime.publish(`/app/jam/${j.code}/chat`, { text: t.slice(0, 280) });
  }

  async extend(): Promise<void> {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return;
    await this.run(async () => this.jam.set(await firstValueFrom(this.api.extendJam(j.code, token))));
  }

  async end(): Promise<void> {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return;
    await this.run(async () => {
      await firstValueFrom(this.api.endJam(j.code, token));
      this.exit('You ended the jam.');
    });
  }

  /** Withdraw a pending "let me in" (also what closing the tab does, server-side). */
  cancelRequest(): void {
    const w = this.waitingFor();
    if (w) this.realtime.publish(`/app/jam/${w.code}/leave`, {});
    this.stopWaiting();
    this.status.set('idle');
  }

  /** Host: let someone in, or not. */
  admit(requestId: string, allow: boolean): void {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return;
    this.realtime.publish(`/app/jam/${j.code}/admit`, { hostToken: token, requestId, allow });
    this.requests.update((list) => list.filter((r) => r.id !== requestId)); // optimistic; REQUESTS confirms
  }

  /** Host: switch between open and private. */
  async setVisibility(visibility: JamVisibility): Promise<void> {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return;
    await this.run(async () => this.jam.set(await firstValueFrom(this.api.setJamVisibility(j.code, token, visibility))));
  }

  /**
   * The link to share. Private jam + host: includes the invite secret (`#k=…` — a fragment, so it never reaches a
   * server log). Anyone else gets the plain link (for a private jam that leads to "ask to join").
   */
  async shareLink(): Promise<string> {
    const j = this.jam();
    const token = this.hostToken();
    if (!j) return '';
    if (j.visibility !== 'PRIVATE' || !token) return this.inviteLink();
    let invite = this.inviteToken();
    if (!invite) {
      invite = (await firstValueFrom(this.api.jamInvite(j.code, token))).inviteToken;
      this.inviteToken.set(invite);
    }
    return `${location.origin}/jam/${j.code}#k=${invite}`;
  }

  /** Host: replace the invite link (old links stop working); returns the new link. */
  async newInviteLink(): Promise<string> {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return '';
    const { inviteToken } = await firstValueFrom(this.api.rotateJamInvite(j.code, token));
    this.inviteToken.set(inviteToken);
    return `${location.origin}/jam/${j.code}#k=${inviteToken}`;
  }

  dismissInvite(): void {
    this.invitedCode.set(null);
    if (JAM_PATH.test(location.pathname)) history.replaceState(null, '', '/');
  }

  // ---- internals ---------------------------------------------------------------------------------------

  private hostPlaylist(p: SharedPlaylist): void {
    void this.player.playPlaylist(p);
    this.sendChat(`🎶 Now playing “${p.playlistName}” (shared by ${p.displayName}) ${p.playlistUrl}`);
    this.drawerOpen.set(false);
  }

  /** Private jam, no key: send "let me in" and wait for the host's answer on our personal access queue. */
  private ask(snapshot: JamSnapshot): void {
    const code = snapshot.code;
    this.stopWaiting();
    this.waitingFor.set({ code, name: snapshot.name, hostName: snapshot.hostName });
    this.status.set('waiting');
    this.invitedCode.set(null);
    this.accessSubs = new Subscription();
    this.accessSubs.add(
      this.realtime.watchJson<JamAccess>('/user/queue/jam-access').subscribe((a) => {
        if (a.code !== code) return;
        this.stopWaiting();
        if (a.type === 'APPROVED' && a.pass && a.jam) {
          writeSession(guestKeyKey(code), a.pass);
          this.hostToken.set(null);
          this.enter(a.jam);
          this.toast.show(`You're in — welcome to ${a.jam.name}!`);
        } else {
          this.status.set('idle');
          this.error.set(`${snapshot.hostName} didn't let you in this time.`);
        }
      }),
    );
    this.accessSubs.add(
      this.realtime.watchJson<JamError>('/user/queue/jam-errors').subscribe((e) => {
        if (this.status() !== 'waiting') return;
        this.stopWaiting();
        this.status.set('idle');
        this.error.set(e.message);
      }),
    );
    this.realtime.publish(`/app/jam/${code}/request`, { name: this.displayName().trim() });
  }

  private stopWaiting(): void {
    this.accessSubs.unsubscribe();
    this.waitingFor.set(null);
  }

  private enter(snapshot: JamSnapshot): void {
    this.offsetMs = snapshot.serverTime - Date.now();
    this.jam.set(snapshot);
    this.chat.set(snapshot.chat);
    this.members.set(snapshot.members);
    this.status.set('live');
    this.invitedCode.set(null);
    this.error.set(null);
    writeSession(ACTIVE_KEY, snapshot.code);
    writeSession(TAB_NAME_KEY, this.displayName().trim());
    if (location.pathname !== `/jam/${snapshot.code}`) history.pushState(null, '', `/jam/${snapshot.code}`);
    else if (location.hash) history.replaceState(null, '', `/jam/${snapshot.code}`); // drop the #k= secret

    const code = snapshot.code;
    this.requests.set([]);
    this.subs = new Subscription();
    // Private jams only let key holders listen in: send ours on the SUBSCRIBE frame.
    const key = this.joinKey(code);
    this.subs.add(
      this.realtime
        .watchJson<JamEvent>(`/topic/jam/${code}`, key ? { 'jam-key': key } : undefined)
        .subscribe((e) => this.onEvent(e)),
    );
    this.subs.add(this.realtime.watchJson<JamError>('/user/queue/jam-errors').subscribe((e) => this.onError(e)));
    this.sendJoin(code);

    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
    if (this.isHost()) {
      this.lastSentVideoId = undefined; // force an initial LOAD of whatever is on the host's TV
      this.lastSentPlaying = undefined;
      this.heartbeat = setInterval(() => {
        if (this.player.isPlaying()) this.control('PLAY');
      }, HOST_HEARTBEAT_MS);
    } else {
      this.player.setFollowMode(true);
      if (snapshot.playback) void this.player.applyRemote(snapshot.playback, this.offsetMs);
    }
  }

  private exit(message: string | null): void {
    this.teardown();
    writeSession(ACTIVE_KEY, null);
    this.player.setFollowMode(false);
    this.jam.set(null);
    this.chat.set([]);
    this.members.set([]);
    this.hostToken.set(null);
    this.requests.set([]);
    this.inviteToken.set(null);
    this.status.set(message ? 'ended' : 'idle');
    if (message) this.toast.show(message);
    if (JAM_PATH.test(location.pathname)) history.pushState(null, '', '/');
  }

  private teardown(): void {
    this.subs.unsubscribe();
    this.accessSubs.unsubscribe();
    clearInterval(this.ticker);
    clearInterval(this.heartbeat);
  }

  private sendJoin(code: string): void {
    const key = readSession(guestKeyKey(code));
    this.realtime.publish(`/app/jam/${code}/join`, {
      name: this.displayName().trim(),
      ...(this.hostToken() ? { hostToken: this.hostToken() } : {}),
      ...(key ? { key } : {}),
    });
  }

  /** What unlocks this jam for us: the host token, or a guest key (invite token / pass). */
  private joinKey(code: string): string | null {
    return this.hostToken() ?? readSession(guestKeyKey(code));
  }

  private control(action: JamControlAction, extra: { song?: unknown } = {}): void {
    const j = this.jam();
    const token = this.hostToken();
    if (!j || !token) return;
    this.realtime.publish(`/app/jam/${j.code}/control`, {
      hostToken: token,
      action,
      positionSec: this.player.progress(),
      ...extra,
    });
  }

  private onEvent(e: JamEvent): void {
    this.offsetMs = e.serverTime - Date.now();
    switch (e.type) {
      case 'STATE':
        this.jam.update((j) => (j ? { ...j, playback: e.payload } : j));
        if (!this.isHost()) void this.player.applyRemote(e.payload as PlaybackState, this.offsetMs);
        break;
      case 'CHAT':
        this.chat.update((c) => [...c, e.payload].slice(-MAX_CHAT));
        break;
      case 'MEMBERS':
        this.members.set(e.payload.members);
        this.jam.update((j) => (j ? { ...j, memberCount: e.payload.memberCount } : j));
        break;
      case 'EXTENDED':
        this.jam.set(e.payload);
        this.toast.show('The jam was extended by an hour 🎉');
        break;
      case 'ENDING_SOON':
        this.toast.show('This jam ends in 5 minutes.');
        break;
      case 'REQUESTS': {
        const before = new Set(this.requests().map((r) => r.id));
        this.requests.set(e.payload.requests);
        const fresh = e.payload.requests.filter((r) => !before.has(r.id));
        if (this.isHost() && fresh.length) {
          this.toast.show(`${fresh.map((r) => r.name).join(', ')} wants to join — open Jam to let them in.`);
        }
        break;
      }
      case 'VISIBILITY':
        this.jam.update((j) => (j ? { ...j, visibility: e.payload.visibility } : j));
        break;
      case 'ENDED':
        this.exit(e.payload.reason === 'EXPIRED' ? 'The jam has ended — time is up.' : 'The host ended the jam.');
        break;
    }
  }

  private onError(e: JamError): void {
    this.toast.show(e.message, 'error');
    if (e.code === 'JAM_FULL' || e.code === 'NOT_FOUND') this.exit(null);
  }

  /** Wraps an async intent with busy/error handling (errors are ApiError from the interceptor). */
  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      const err = e as Partial<ApiError>;
      this.error.set(
        err.status === 404 ? 'That jam no longer exists.' : (err.detail ?? 'Something went wrong.'),
      );
    } finally {
      this.busy.set(false);
    }
  }

  private startLobby(): void {
    if (this.lobbyTimer) return;
    this.refreshLobby();
    this.lobbyTimer = setInterval(() => this.refreshLobby(), LOBBY_REFRESH_MS);
  }

  private stopLobby(): void {
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = undefined;
  }
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function readToken(code: string): string | null {
  return readSession(tokenKey(code));
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked — reload just won't auto-rejoin */
  }
}

/** `#k=…` on an invite link `/jam/CODE#k=…` — the private jam's invite secret. */
function readLinkKey(): { code: string; key: string } | null {
  if (typeof location === 'undefined') return null;
  const code = readInviteCode();
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  return code && key && /^[\w-]{8,64}$/.test(key) ? { code, key } : null;
}

function readInviteCode(): string | null {
  const m = typeof location !== 'undefined' ? JAM_PATH.exec(location.pathname) : null;
  return m ? m[1].toUpperCase() : null;
}
