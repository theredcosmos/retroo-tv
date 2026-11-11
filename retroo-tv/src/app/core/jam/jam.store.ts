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
  JamControlAction,
  JamError,
  JamEvent,
  JamSnapshot,
  JamSummary,
  PlaybackState,
} from '../models';

const MAX_CHAT = 100;
const HOST_HEARTBEAT_MS = 15_000;
const LOBBY_REFRESH_MS = 20_000;
const NAME_KEY = 'retroo.displayName';
const tokenKey = (code: string) => `retroo.jam.${code}.hostToken`;
/** Jam this tab was in (sessionStorage) — lets a page reload rejoin automatically. */
const ACTIVE_KEY = 'retroo.jam.active';
/** Name this tab joined with — tabs of one browser share localStorage but must keep separate identities. */
const TAB_NAME_KEY = 'retroo.jam.name';
const JAM_PATH = /^\/jam\/([A-Z0-9]{6})\/?$/i;

export type JamStatus = 'idle' | 'joining' | 'live' | 'ended';

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

    // Lobby polling only while browsing (not inside a jam).
    effect(() => {
      const browsing = this.status() === 'idle' || this.status() === 'ended';
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

  async create(jamName: string): Promise<void> {
    await this.run(async () => {
      const res = await firstValueFrom(this.api.createJam(jamName.trim(), this.displayName().trim()));
      try {
        sessionStorage.setItem(tokenKey(res.jam.code), res.hostToken);
      } catch {
        /* storage blocked — host controls work until reload */
      }
      this.hostToken.set(res.hostToken);
      this.enter(res.jam);
    });
  }

  async join(code: string): Promise<void> {
    await this.run(async () => {
      const snapshot = await firstValueFrom(this.api.jam(code.toUpperCase()));
      this.hostToken.set(readToken(snapshot.code));
      this.enter(snapshot);
    });
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

  dismissInvite(): void {
    this.invitedCode.set(null);
    if (JAM_PATH.test(location.pathname)) history.replaceState(null, '', '/');
  }

  // ---- internals ---------------------------------------------------------------------------------------

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

    const code = snapshot.code;
    this.subs = new Subscription();
    this.subs.add(this.realtime.watchJson<JamEvent>(`/topic/jam/${code}`).subscribe((e) => this.onEvent(e)));
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
    this.status.set(message ? 'ended' : 'idle');
    if (message) this.toast.show(message);
    if (JAM_PATH.test(location.pathname)) history.pushState(null, '', '/');
  }

  private teardown(): void {
    this.subs.unsubscribe();
    clearInterval(this.ticker);
    clearInterval(this.heartbeat);
  }

  private sendJoin(code: string): void {
    this.realtime.publish(`/app/jam/${code}/join`, {
      name: this.displayName().trim(),
      ...(this.hostToken() ? { hostToken: this.hostToken() } : {}),
    });
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

function readInviteCode(): string | null {
  const m = typeof location !== 'undefined' ? JAM_PATH.exec(location.pathname) : null;
  return m ? m[1].toUpperCase() : null;
}
