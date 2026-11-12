import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export type PlaybackState = 'unstarted' | 'buffering' | 'playing' | 'paused' | 'ended' | 'cued';

/** YouTube error codes that mean "this video can never play here" → skip it. */
const UNPLAYABLE_ERRORS = new Set([2, 5, 100, 101, 150]);

/**
 * Adapter around the YouTube IFrame Player API — the only part of the app that knows `window.YT` exists.
 *
 * Why an adapter?
 *  - The API is callback-based and global; the rest of the app wants signals and observables.
 *  - It hides lifecycle quirks: the script must be loaded once, `onYouTubeIframeAPIReady` is a global callback,
 *    and no player method may be called before `onReady`.
 *  - It is trivially replaceable by a fake in unit tests.
 *
 * The API has no "timeupdate" event, so while playing we sample getCurrentTime() every 500 ms.
 */
@Injectable({ providedIn: 'root' })
export class YouTubePlayerService {
  private player?: YT.Player;
  private host?: HTMLElement;
  private ready?: Promise<void>;
  private ticker?: ReturnType<typeof setInterval>;

  readonly state = signal<PlaybackState>('unstarted');
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly muted = signal(false);

  /**
   * Play/pause the user asked for that the iframe hasn't confirmed yet. The iframe applies commands
   * asynchronously, so `state` lags a click by ~100 ms; without this a quick double-click on play/pause read the
   * stale state twice and sent "pause" both times.
   */
  private pendingPlaying?: boolean;

  /** Fires when a track finishes. */
  readonly ended$ = new Subject<void>();
  /** Fires with the YT error code when a video cannot be played (removed, embedding disabled…). */
  readonly unplayable$ = new Subject<number>();

  /**
   * Creates the player inside `host`; resolves when the player is ready for commands.
   * Idempotent for the same host. If the hosting component was re-created (new host element — e.g. after a
   * hot reload or a route change), the old iframe is detached from the DOM, so we destroy it and build a new one;
   * otherwise every call would hit a dead player ("The YouTube player is not attached to the DOM").
   */
  mount(host: HTMLElement): Promise<void> {
    if (this.ready && host === this.host) {
      return this.ready;
    }
    this.stopTicker();
    this.player?.destroy();
    this.player = undefined;
    this.host = host;
    this.ready = loadIframeApi().then(
      () =>
        new Promise<void>((resolve) => {
          this.player = new YT.Player(host, {
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: 0,
              controls: 0, // our own transport controls live in the now-playing bar
              disablekb: 1,
              fs: 0,
              iv_load_policy: 3, // no annotations
              playsinline: 1, // iOS: play inside the TV, not fullscreen
              rel: 0,
              origin: location.origin,
            },
            events: {
              onReady: () => {
                this.muted.set(this.player?.isMuted() ?? false);
                resolve();
              },
              onStateChange: (e) => this.onStateChange(e.data),
              onError: (e) => this.onError(e.data as number),
            },
          });
        }),
    );
    return this.ready;
  }

  /** Loads and plays a video (only works after a user gesture has happened on the page). */
  async load(videoId: string): Promise<void> {
    await this.ready;
    this.pendingPlaying = true;
    this.currentTime.set(0);
    this.duration.set(0);
    this.player?.loadVideoById(videoId);
  }

  /** Loads a video without playing — used before the first user gesture so autoplay policies are respected. */
  async cue(videoId: string): Promise<void> {
    await this.ready;
    this.pendingPlaying = undefined;
    this.player?.cueVideoById(videoId);
  }

  /**
   * Video ids of a YouTube / YT Music playlist. The IFrame API has no "fetch playlist" call, so we cue the playlist
   * (which loads its index into the player without playing) and poll `getPlaylist()` until it is populated.
   * Resolves to [] for private/empty/unknown playlists after a timeout.
   */
  async playlistIds(listId: string, timeoutMs = 8000): Promise<string[]> {
    await this.ready;
    const player = this.player;
    if (!player) return [];
    player.cuePlaylist({ list: listId, listType: 'playlist' });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const ids = player.getPlaylist();
      if (ids && ids.length) return [...ids];
    }
    return [];
  }

  /** Title/channel of the loaded video (undocumented but stable `getVideoData()`); used for playlist songs. */
  videoData(): { title: string; author: string } | null {
    const data = (this.player as unknown as { getVideoData?: () => { title?: string; author?: string } })
      ?.getVideoData?.();
    return data?.title ? { title: data.title, author: data.author ?? '' } : null;
  }

  /** Must be called synchronously inside a click handler the first time (browser autoplay policy). */
  play(): void {
    this.pendingPlaying = true;
    this.player?.playVideo();
  }

  pause(): void {
    this.pendingPlaying = false;
    this.player?.pauseVideo();
  }

  /** Whether playback is (or is about to be) running — includes a play/pause the iframe hasn't confirmed yet. */
  wantsPlaying(): boolean {
    return this.pendingPlaying ?? this.state() === 'playing';
  }

  seekTo(seconds: number): void {
    this.player?.seekTo(seconds, true);
    this.currentTime.set(seconds);
  }

  /**
   * Our `muted` signal is the source of truth: `player.isMuted()` only updates after the iframe has processed the
   * previous command, so two quick clicks used to read the stale value and both mute.
   */
  toggleMute(): void {
    if (!this.player) return;
    if (this.muted()) {
      this.player.unMute();
      this.muted.set(false);
    } else {
      this.player.mute();
      this.muted.set(true);
    }
  }

  private onStateChange(code: number): void {
    const map: Record<number, PlaybackState> = {
      [-1]: 'unstarted',
      0: 'ended',
      1: 'playing',
      2: 'paused',
      3: 'buffering',
      5: 'cued',
    };
    const next = map[code] ?? 'unstarted';
    this.state.set(next);
    if (next === 'playing' || next === 'paused' || next === 'ended') this.pendingPlaying = undefined;

    if (next === 'playing') {
      this.duration.set(this.player?.getDuration() ?? 0);
      this.startTicker();
    } else {
      this.stopTicker();
    }
    if (next === 'ended') {
      this.ended$.next();
    }
  }

  private onError(code: number): void {
    this.stopTicker();
    if (UNPLAYABLE_ERRORS.has(code)) {
      this.unplayable$.next(code);
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.currentTime.set(this.player?.getCurrentTime() ?? 0), 500);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}

/** Injects https://www.youtube.com/iframe_api once and resolves when the global YT namespace is ready. */
let apiPromise: Promise<void> | undefined;
function loadIframeApi(): Promise<void> {
  apiPromise ??= new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && window.YT?.Player) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the YouTube player'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}
