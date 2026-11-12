import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom } from 'rxjs';
import { RetrooApi } from '../api/retroo-api.service';
import { ApiError, Decade, DecadeSlug, PlaybackState, SharedPlaylist, Song } from '../models';
import { StaticHissService } from './static-hiss.service';
import { YouTubePlayerService } from './youtube-player.service';

/**
 * TV lifecycle as seen by the UI:
 *  - `off`     : nothing loaded yet / waiting for the first tap (browser autoplay policy).
 *  - `tuning`  : switching channel — static noise is shown while the next video loads.
 *  - `on`      : a video is playing or paused.
 *  - `error`   : the server is unreachable or the decade is empty.
 */
export type TvStatus = 'off' | 'tuning' | 'on' | 'error';

/**
 * Why the picture is changing — the TV renders each differently:
 *  - `channel`     : the user turned the dial (decade bar, knob, next/prev): static + rolling bar.
 *  - `signal-loss` : the song ended on its own: the picture flickers out, then a longer burst of static,
 *                    rolling and hiss — like an old set losing the broadcast between programmes.
 */
export type TvTransition = 'none' | 'channel' | 'signal-loss';

/** What the TV is tuned to: a decade channel (2:1 Bollywood/Hollywood shuffle) or a listener's shared playlist. */
export type PlaySource =
  | { kind: 'decade' }
  | { kind: 'playlist'; playlistId: string; name: string; sharedBy: string; url: string };

/** Bollywood, Bollywood, Hollywood — repeat (gemini.md rule 8). */
const LANG_PATTERN = ['hi', 'hi', 'en'] as const;
/** Songs remembered to avoid repeats in random picks (sent as `exclude`). */
const RECENT_MAX = 10;
/** Placeholder title until YouTube reports the real one for a playlist song. */
const LOADING_TITLE = 'Tuning in…';

/** Stop skipping after this many unplayable videos in a row, so a bad catalog can't cause an infinite loop. */
const MAX_CONSECUTIVE_SKIPS = 5;
/**
 * Minimum time the static is visible when the user changes channel — sells the "tuning" effect. Kept short:
 * the static also stays up while YouTube buffers, so a longer floor only made every click feel laggy.
 */
export const CHANNEL_STATIC_MS = 700;
/** Static between two songs (auto-advance) — the "90s TV losing signal" moment (matches `snow-in` in the CSS). */
export const SIGNAL_LOSS_MS = 2_200;
/** Jam guests re-seek when they are further than this from the host's position. */
const DRIFT_S = 2;
/** How long the "picture warming up" effect runs once the new video actually starts. */
const ARRIVAL_MS = 900;
/** Pressing "previous" after this many seconds restarts the song instead (like every music player). */
const RESTART_THRESHOLD_S = 3;

/**
 * Single source of truth for playback (a lightweight signal-based store — no NgRx needed at this size).
 *
 * Components read signals and call intent methods (`selectDecade`, `next`, `previous`, `togglePlay`, `tuneIn`);
 * they never talk to the API or the YouTube adapter directly. Data flows one way:
 *
 *     component ──intent──▶ PlayerStore ──▶ RetrooApi / YouTubePlayerService
 *         ▲                     │
 *         └──── signals ◀───────┘
 */
@Injectable({ providedIn: 'root' })
export class PlayerStore {
  private readonly api = inject(RetrooApi);
  private readonly yt = inject(YouTubePlayerService);
  private readonly hiss = inject(StaticHissService);

  // ---- state -------------------------------------------------------------------------------------------
  readonly decades = signal<Decade[]>([]);
  readonly activeDecade = signal<DecadeSlug>('now');
  readonly current = signal<Song | null>(null);
  readonly status = signal<TvStatus>('off');
  readonly errorMessage = signal<string | null>(null);
  /** True until the user has interacted once; the TV shows a "tap to tune in" prompt. */
  readonly awaitingGesture = signal(true);
  /** Decade channel or a shared playlist. */
  readonly source = signal<PlaySource>({ kind: 'decade' });
  /** Kind of change in progress (drives CSS effects on the tube). */
  readonly transition = signal<TvTransition>('none');
  /** True for a moment after a new picture appears — brightness settles like a warming CRT. */
  readonly arriving = signal(false);
  /**
   * Jam guest mode: the host drives playback. Local intents (next, decade, play/pause, seek) are ignored and the
   * TV follows `applyRemote()` instead. Mute stays local.
   */
  readonly followMode = signal(false);
  /** Emits when *this* user seeks — the jam host forwards it to guests. */
  readonly seeked$ = new Subject<number>();

  /** Latest host state (guests) and the server-clock offset it arrived with. */
  private latestRemote?: { state: PlaybackState; offsetMs: number };
  /** Video id a guest is currently tuning to, so a burst of STATE events doesn't restart the static. */
  private remoteTuning?: string;

  /** Songs played in the current decade, most recent last — powers the "previous" button. */
  private history: Song[] = [];
  private consecutiveSkips = 0;
  /** Incremented on every channel change; stale async results compare against it and bail out. */
  private requestSeq = 0;
  /** Position in LANG_PATTERN. */
  private rotation = 0;
  /** Most recent video ids, newest last. */
  private recent: string[] = [];
  private playlistIds: string[] = [];
  private playlistIndex = 0;
  private arrivalTimer?: ReturnType<typeof setTimeout>;

  // ---- derived -----------------------------------------------------------------------------------------
  readonly activeDecadeInfo = computed(() => this.decades().find((d) => d.slug === this.activeDecade()));
  readonly isPlaying = computed(() => this.yt.state() === 'playing');
  readonly showStatic = computed(() => this.status() !== 'on' || this.yt.state() === 'buffering');
  readonly canGoBack = computed(() => this.current() !== null);
  readonly progress = this.yt.currentTime;
  readonly duration = this.yt.duration;
  readonly muted = this.yt.muted;
  readonly canControl = computed(() => !this.followMode());
  readonly isPlaylist = computed(() => this.source().kind === 'playlist');

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.yt.ended$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (this.followMode()) {
        // Guest: show the signal-loss snow and wait for the host's next LOAD.
        this.transition.set('signal-loss');
        this.status.set('tuning');
      } else {
        void this.next('signal-loss');
      }
    });
    this.yt.unplayable$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      if (this.followMode()) {
        this.status.set('error');
        this.errorMessage.set("This video can't play on your TV — waiting for the host's next song.");
      } else {
        void this.skipUnplayable();
      }
    });
    // Any video that actually starts playing proves the chain of skips is over.
    effect(() => {
      if (this.yt.state() === 'playing') this.consecutiveSkips = 0;
    });

    // When the new video really starts after a transition, end the transition and play the warm-up effect.
    effect(() => {
      if (this.yt.state() !== 'playing' || untracked(this.transition) === 'none') return;
      untracked(() => {
        this.transition.set('none');
        this.arriving.set(true);
        clearTimeout(this.arrivalTimer);
        this.arrivalTimer = setTimeout(() => this.arriving.set(false), ARRIVAL_MS);
      });
    });

    // Playlist songs arrive without metadata: fill title/artist from the player once the video is playing.
    effect(() => {
      if (this.yt.state() !== 'playing') return;
      untracked(() => {
        const song = this.current();
        if (!song || song.title !== LOADING_TITLE) return;
        const data = this.yt.videoData();
        if (data) this.current.set({ ...song, title: data.title, artist: data.author || song.artist });
      });
    });

    // Static hiss while the screen shows snow (never before the first click, never when muted).
    effect(() => {
      const audible = this.showStatic() && !this.awaitingGesture() && !this.yt.muted();
      untracked(() => (audible ? this.hiss.start() : this.hiss.stop()));
    });
  }

  /** Called once by the TV component with the element that will host the iframe. */
  async init(host: HTMLElement): Promise<void> {
    try {
      const [decades] = await Promise.all([firstValueFrom(this.api.decades()), this.yt.mount(host)]);
      this.decades.set(decades);
      // Cue (not play) a first song so the first tap starts instantly.
      const song = await this.pickRandom(this.activeDecade());
      this.current.set(song);
      this.history = [song];
      this.remember(song.videoId);
      await this.yt.cue(song.videoId);
    } catch (e) {
      this.fail(e);
    }
  }

  /** First user gesture: must call play() synchronously for browsers to allow sound. */
  tuneIn(): void {
    this.awaitingGesture.set(false);
    if (this.followMode()) {
      if (this.latestRemote) {
        this.yt.play(); // synchronous inside the click — unlocks audio
        this.status.set('on');
        this.syncToRemote();
      } else {
        // Jam guest, host hasn't played anything yet: don't start our own random song — show snow and wait.
        this.status.set('tuning');
      }
      return;
    }
    if (this.current()) {
      this.yt.play();
      this.status.set('on');
    } else {
      void this.next();
    }
  }

  async selectDecade(slug: DecadeSlug): Promise<void> {
    if (this.followMode()) return;
    this.awaitingGesture.set(false);
    if (slug === this.activeDecade() && this.status() === 'on' && !this.isPlaylist()) {
      return;
    }
    this.source.set({ kind: 'decade' });
    this.activeDecade.set(slug);
    this.history = [];
    this.consecutiveSkips = 0;
    await this.tuneTo(() => this.pickRandom(slug), 'channel');
  }

  /** `signal-loss` is used when a song ends by itself; user-initiated skips are a `channel` change. */
  async next(kind: Exclude<TvTransition, 'none'> = 'channel'): Promise<void> {
    if (this.followMode()) return;
    this.awaitingGesture.set(false);
    if (this.isPlaylist()) {
      await this.tuneTo(() => Promise.resolve(this.playlistStep(+1)), kind);
      return;
    }
    const slug = this.activeDecade();
    await this.tuneTo(() => this.pickRandom(slug), kind);
  }

  async previous(): Promise<void> {
    if (this.followMode()) return;
    if (this.isPlaylist() && this.progress() <= RESTART_THRESHOLD_S) {
      await this.tuneTo(() => Promise.resolve(this.playlistStep(-1)), 'channel');
      return;
    }
    if (this.progress() > RESTART_THRESHOLD_S || this.history.length < 2) {
      this.yt.seekTo(0);
      return;
    }
    this.history.pop(); // current
    const prev = this.history.pop()!;
    await this.tuneTo(() => Promise.resolve(prev), 'channel');
  }

  togglePlay(): void {
    if (this.awaitingGesture()) {
      this.tuneIn();
      return;
    }
    if (this.followMode()) return;
    this.yt.wantsPlaying() ? this.yt.pause() : this.yt.play();
  }

  seek(seconds: number): void {
    if (this.followMode()) return;
    this.yt.seekTo(seconds);
    this.seeked$.next(seconds);
  }

  /**
   * "Tune in" to a listener's shared playlist: read its video ids through the player, then play them in order with
   * the normal channel transitions. Decade buttons switch back to the decade shuffle.
   */
  async playPlaylist(p: SharedPlaylist): Promise<void> {
    if (this.followMode()) return;
    const playlistId = new URL(p.playlistUrl).searchParams.get('list');
    if (!playlistId) return;
    this.awaitingGesture.set(false);
    const seq = ++this.requestSeq;
    this.transition.set('channel');
    this.status.set('tuning');
    this.errorMessage.set(null);
    const ids = await this.yt.playlistIds(playlistId);
    if (seq !== this.requestSeq) return;
    if (!ids.length) {
      this.transition.set('none');
      this.status.set('error');
      this.errorMessage.set('That playlist is private or empty.');
      return;
    }
    this.source.set({ kind: 'playlist', playlistId, name: p.playlistName, sharedBy: p.displayName, url: p.playlistUrl });
    this.history = [];
    this.playlistIds = ids;
    this.playlistIndex = 0;
    this.consecutiveSkips = 0;
    await this.tuneTo(() => Promise.resolve(this.playlistSong(0)), 'channel');
  }

  /** Back to the decade shuffle (from playlist mode). */
  async leavePlaylist(): Promise<void> {
    if (this.followMode()) return;
    const slug = this.activeDecade();
    this.source.set({ kind: 'decade' });
    this.history = [];
    await this.tuneTo(() => this.pickRandom(slug), 'channel');
  }

  // ---- jam guest sync ----------------------------------------------------------------------------------

  /** Enter/leave guest mode. Leaving resumes normal solo behaviour from wherever the TV is. */
  setFollowMode(on: boolean): void {
    this.followMode.set(on);
    if (!on) {
      this.latestRemote = undefined;
      this.remoteTuning = undefined;
    }
  }

  /**
   * Apply the host's playback state (gemini.md §8.4). `offsetMs` = serverTime − Date.now() when the event
   * arrived, so positions are computed on the server's clock, not this device's (which may be minutes off).
   * New song → the usual channel-change static, then load; same song → only correct drift > 2 s and the
   * play/pause state.
   */
  async applyRemote(state: PlaybackState, offsetMs: number): Promise<void> {
    this.latestRemote = { state, offsetMs };
    this.activeDecade.set(state.song.decade);

    if (this.awaitingGesture()) {
      // Can't play before the user's first click: just cue the host's song behind "Tap to tune in".
      if (this.current()?.videoId !== state.song.videoId) {
        this.current.set(state.song);
        await this.yt.cue(state.song.videoId);
      }
      return;
    }
    if (this.remoteTuning === state.song.videoId) return; // already tuning; syncs when done

    if (this.current()?.videoId !== state.song.videoId || this.status() !== 'on') {
      this.remoteTuning = state.song.videoId;
      await this.tuneTo(() => Promise.resolve(state.song), 'channel');
      this.remoteTuning = undefined;
    }
    this.syncToRemote();
  }

  private syncToRemote(): void {
    const r = this.latestRemote;
    if (!r || r.state.song.videoId !== this.current()?.videoId) return;
    const elapsed = r.state.playing ? (Date.now() + r.offsetMs - r.state.updatedAt) / 1000 : 0;
    const expected = Math.max(0, r.state.positionSec + elapsed);
    if (Math.abs(this.yt.currentTime() - expected) > DRIFT_S) this.yt.seekTo(expected);
    if (r.state.playing) this.yt.play();
    else this.yt.pause();
  }

  toggleMute(): void {
    this.yt.toggleMute();
  }

  // ---- internals ---------------------------------------------------------------------------------------

  /**
   * Shared "change channel" routine: show static, fetch the song, wait at least CHANNEL_STATIC_MS
   * (or SIGNAL_LOSS_MS between songs), then load it. The static stays up until YouTube reports `playing`,
   * and the opaque snow hides YouTube's end screen between songs.
   * The sequence number makes rapid clicks safe — only the latest request is allowed to touch the player
   * (a classic race-condition guard, equivalent to RxJS switchMap).
   */
  private async tuneTo(fetch: () => Promise<Song>, kind: Exclude<TvTransition, 'none'>): Promise<void> {
    const seq = ++this.requestSeq;
    this.transition.set(kind);
    this.arriving.set(false);
    this.status.set('tuning');
    this.errorMessage.set(null);
    try {
      const minMs = kind === 'signal-loss' ? SIGNAL_LOSS_MS : CHANNEL_STATIC_MS;
      const [song] = await Promise.all([fetch(), delay(minMs)]);
      if (seq !== this.requestSeq) return; // superseded by a newer click
      this.current.set(song);
      this.history.push(song);
      this.remember(song.videoId);
      await this.yt.load(song.videoId);
      this.status.set('on');
    } catch (e) {
      if (seq === this.requestSeq) {
        this.transition.set('none');
        this.fail(e);
      }
    }
  }

  /** Next song of the 2:1 rotation for a decade, avoiding the last RECENT_MAX songs. */
  private pickRandom(slug: DecadeSlug): Promise<Song> {
    const lang = LANG_PATTERN[this.rotation % LANG_PATTERN.length];
    this.rotation++;
    return firstValueFrom(this.api.randomSong(slug, lang, this.recent));
  }

  private remember(videoId: string): void {
    this.recent = [...this.recent.filter((id) => id !== videoId), videoId].slice(-RECENT_MAX);
  }

  private playlistStep(delta: number): Song {
    const n = this.playlistIds.length;
    this.playlistIndex = (((this.playlistIndex + delta) % n) + n) % n;
    return this.playlistSong(this.playlistIndex);
  }

  private playlistSong(index: number): Song {
    const src = this.source();
    const videoId = this.playlistIds[index];
    return {
      id: -1,
      videoId,
      title: LOADING_TITLE,
      artist: src.kind === 'playlist' ? `${src.sharedBy}'s playlist` : '',
      decade: this.activeDecade(),
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  private async skipUnplayable(): Promise<void> {
    if (++this.consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
      this.status.set('error');
      this.errorMessage.set('No signal — these videos cannot be played here.');
      return;
    }
    this.history.pop(); // never offer an unplayable song via "previous"
    if (this.awaitingGesture()) {
      // Still behind "Tap to tune in": quietly cue a different song. next() would start playback (and dismiss
      // the prompt) without the user's click.
      try {
        const song = await this.pickRandom(this.activeDecade());
        this.current.set(song);
        this.history = [song];
        this.remember(song.videoId);
        await this.yt.cue(song.videoId);
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    await this.next();
  }

  private fail(e: unknown): void {
    const err = e as Partial<ApiError>;
    this.status.set('error');
    this.errorMessage.set(err?.detail ?? 'No signal.');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
