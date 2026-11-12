import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FeedStore } from '../../core/feed/feed.store';
import { JamStore } from '../../core/jam/jam.store';
import { PlayerStore } from '../../core/player/player.store';
import { SharedPlaylist } from '../../core/models';

/** How long each playlist stays in the spotlight before fading to the next. */
const DWELL_MS = 7_000;

/**
 * "Listener channels": playlists other visitors shared, shown **one at a time** in a spotlight that fades to the
 * next after a few seconds. Each one can be **tuned in** — played here on the TV (PlayerStore.playPlaylist) —
 * taken into a **jam** (JamStore.playlistToJam), or opened on YouTube Music.
 *
 * How the rotation works — the clock is CSS, not a JS timer:
 *  - The card runs a `dwell` animation (DWELL_MS: stay, then fade out) and a hairline progress bar fills over the
 *    same time. `animationend` of the dwell advances to the next playlist.
 *  - Hover, keyboard focus or a tap inside pauses both with `animation-play-state` — so a card never fades out from
 *    under a click — and a hidden tab pauses them for free.
 *  - The entrance fade lives on an inner element, so a card stepped to with ‹ › (while the pointer is on the
 *    arrows, i.e. paused) still fades in.
 *  - A newly shared playlist jumps the queue and shows next (with the "fresh" highlight).
 *  - prefers-reduced-motion: no auto-rotation and no fades; ‹ › still step through.
 * Screen readers: the card is a live region only after the user steps — auto-rotation stays silent.
 */
@Component({
  selector: 'app-playlist-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="eyebrow">Listener channels</span>
      @if (count() > 1) {
        <div class="nav">
          <button type="button" class="arrow" (click)="step(-1)" aria-label="Previous playlist">‹</button>
          <span class="counter" aria-hidden="true">{{ position() }} / {{ count() }}</span>
          <button type="button" class="arrow" (click)="step(1)" aria-label="Next playlist">›</button>
        </div>
      }
    </div>

    @if (!feed.loading() && count() === 0) {
      <p class="empty">No playlists yet. Share one and it becomes a channel anyone can tune in to.</p>
    }

    <section class="spot" [hidden]="count() === 0" aria-roledescription="carousel" aria-label="Shared playlists"
             (keydown.arrowleft)="step(-1)" (keydown.arrowright)="step(1)">
      @for (p of shown(); track p.id) {
        <article class="card" [class.rotating]="rotating()" [class.on]="playingUrl() === p.playlistUrl"
                 [attr.aria-live]="userStepped() ? 'polite' : 'off'"
                 [attr.aria-label]="position() + ' of ' + count()"
                 (animationend)="onDwellEnd($event)">
          <div class="body" [class.fresh]="p.id === feed.freshId()">
            <p class="line">
              <span class="who">{{ p.displayName }}</span>
              <span class="name">{{ p.playlistName }}</span>
            </p>
            @if (p.note) { <q>{{ p.note }}</q> }
            <div class="actions">
              <button type="button" class="tune" (click)="tune(p)" [disabled]="!player.canControl()"
                      [attr.aria-label]="'Tune in to ' + p.playlistName">
                @if (playingUrl() === p.playlistUrl) { On air } @else { ▶ Tune in }
              </button>
              <button type="button" class="tune" (click)="jam.playlistToJam(p)" [title]="jamHint()"
                      [attr.aria-label]="jamLabel() + ': ' + p.playlistName">
                👥 {{ jamLabel() }}
              </button>
              <a [href]="p.playlistUrl" target="_blank" rel="noopener noreferrer nofollow">YouTube Music ↗</a>
            </div>
          </div>
          @if (rotating()) { <span class="progress" aria-hidden="true"></span> }
        </article>
      }
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-height: 0; text-shadow: var(--text-shadow); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .nav { display: flex; align-items: center; gap: 2px; font-size: 11px; color: var(--ink-faint); }
    .counter { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
    .arrow {
      width: 24px; height: 24px; border: 0; border-radius: 50%; background: none; color: var(--ink-dim);
      font-size: 16px; line-height: 1; cursor: pointer; text-shadow: inherit;
      &:hover { color: var(--ink); background: var(--hover); }
    }
    /* Fixed height: cards with or without a note don't make the Share button below jump. */
    .spot { position: relative; min-height: 150px; }
    .card {
      position: relative;
      padding: 12px 0 14px 12px;
      border-left: 1px solid var(--line);
      transition: border-color var(--slow) var(--ease);
      &.on { border-left-color: var(--accent); }
      &.rotating { animation: dwell ${DWELL_MS}ms linear forwards; }
    }
    /* Paused while the user is on it — the card or the ‹ › arrows; pointer, keyboard focus, or a tap (:hover sticks
       after a tap on touch). Browsing with the arrows therefore never fades the card out from under you. */
    :host(:hover) .card, :host(:focus-within) .card,
    :host(:hover) .progress, :host(:focus-within) .progress { animation-play-state: paused; }
    .body {
      animation: enter 0.6s var(--ease) both;
      &.fresh { animation: enter 0.6s var(--ease) both, glow 1.6s var(--ease); }
    }
    .progress {
      position: absolute; left: 12px; right: 0; bottom: 0; height: 1px;
      background: var(--ink-faint); opacity: 0.6;
      transform-origin: left; transform: scaleX(0);
      animation: fill ${DWELL_MS}ms linear forwards;
    }
    .line { margin: 0; display: grid; gap: 1px; }
    .who { font-size: 11px; color: var(--ink-faint); letter-spacing: 0.02em; }
    .name { font: 400 20px/1.2 var(--font-display); color: var(--ink); }
    q { display: block; margin-top: 4px; font-size: 12px; font-style: italic; color: var(--ink-dim); }
    q::before { content: '“'; } q::after { content: '”'; }
    .actions {
      display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 11px;
      white-space: nowrap;
      a { color: var(--ink-faint); text-decoration: none; &:hover { color: var(--ink); } }
    }
    .tune {
      border: 0; padding: 0; background: none; font-weight: 600; color: var(--ink); cursor: pointer;
      letter-spacing: 0.02em; text-shadow: inherit;
      &:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
    .empty { margin: 0; font-size: 12px; color: var(--ink-dim); max-width: 240px; }
    @keyframes enter { from { opacity: 0; transform: translateY(6px); } }
    /* Stay fully visible, then fade out over the last ~0.5 s. */
    @keyframes dwell { 0%, 93% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes fill { to { transform: scaleX(1); } }
    @keyframes glow { from { border-left-color: var(--accent); } }
    @media (prefers-reduced-motion: reduce) {
      .body, .body.fresh { animation: none; }
    }
  `,
})
export class PlaylistFeedComponent implements OnInit {
  protected readonly feed = inject(FeedStore);
  protected readonly player = inject(PlayerStore);
  protected readonly jam = inject(JamStore);

  private readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Id of the playlist in the spotlight (an id, not an index: new shares are prepended and shift indexes). */
  private readonly currentId = signal<number | null>(null);
  /** True once the user has used ‹ › — from then on the card is announced to screen readers. */
  protected readonly userStepped = signal(false);

  protected readonly count = computed(() => this.feed.items().length);
  private readonly index = computed(() => {
    const items = this.feed.items();
    const i = items.findIndex((p) => p.id === this.currentId());
    return i < 0 ? 0 : i;
  });
  protected readonly position = computed(() => this.index() + 1);
  /** The one card to render — an array so `@for … track p.id` re-creates the element (restarting its animations). */
  protected readonly shown = computed(() => {
    const p = this.feed.items()[this.index()];
    return p ? [p] : [];
  });
  protected readonly rotating = computed(() => this.count() > 1 && !this.reducedMotion);

  /** URL of the playlist on the TV (compared by string — no per-item URL parsing on every render). */
  protected readonly playingUrl = computed(() => {
    const src = this.player.source();
    return src.kind === 'playlist' ? src.url : null;
  });
  protected readonly jamLabel = computed(() =>
    this.jam.isHost() ? 'Play in jam' : this.jam.inJam() ? 'Suggest to jam' : 'Start a jam',
  );
  protected readonly jamHint = computed(() =>
    this.jam.isHost()
      ? "Put it on everyone's TV in your jam"
      : this.jam.inJam()
        ? 'Post it in the jam chat — the host can play it'
        : 'Start a jam session with this playlist playing',
  );

  constructor() {
    // A playlist someone just shared jumps the queue.
    effect(() => {
      const fresh = this.feed.freshId();
      if (fresh !== null) untracked(() => this.currentId.set(fresh));
    });
  }

  ngOnInit(): void {
    this.feed.load();
  }

  protected tune(p: SharedPlaylist): void {
    void this.player.playPlaylist(p);
  }

  /** ‹ / › (and ←/→ while the spotlight has focus). */
  protected step(delta: number): void {
    this.userStepped.set(true);
    this.advance(delta);
  }

  /** The card's dwell animation finished (it was never paused long enough to stop it): show the next one. */
  protected onDwellEnd(e: AnimationEvent): void {
    if (e.target === e.currentTarget && e.animationName.endsWith('dwell')) this.advance(1);
  }

  private advance(delta: number): void {
    const items = this.feed.items();
    if (!items.length) return;
    const next = items[(((this.index() + delta) % items.length) + items.length) % items.length];
    this.currentId.set(next.id);
  }
}
