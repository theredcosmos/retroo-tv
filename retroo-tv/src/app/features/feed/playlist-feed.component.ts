import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { FeedStore } from '../../core/feed/feed.store';
import { PlayerStore } from '../../core/player/player.store';
import { SharedPlaylist } from '../../core/models';

/** Seconds each entry stays in view while auto-scrolling. */
const SECONDS_PER_ITEM = 4;

/**
 * "Listener channels": playlists other visitors shared. Each one can be **tuned in** — played right here on the
 * TV (PlayerStore.playPlaylist) — or opened on YouTube Music.
 *
 * Like the reference site the list sits directly on the room, no box: text with a soft shadow, faded top and
 * bottom. Seamless loop = the list rendered twice, track animated by −50%; the copy is aria-hidden/untabbable;
 * hover or focus pauses; reduced motion gets a plain scrollable list.
 */
@Component({
  selector: 'app-playlist-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="eyebrow">Listener channels</span>
    </div>
    @if (!feed.loading() && feed.items().length === 0) {
      <p class="empty">No playlists yet. Share one and it becomes a channel anyone can tune in to.</p>
    }
    <div class="viewport" [class.static]="feed.items().length < 4" [hidden]="feed.items().length === 0">
      <div class="track" [style.animation-duration.s]="duration()">
        @for (copy of copies(); track copy) {
          <ul [attr.aria-hidden]="copy === 1 ? true : null">
            @for (p of feed.items(); track p.id) {
              <li [class.fresh]="p.id === feed.freshId() && copy === 0"
                  [class.on]="playingId() === playlistId(p)">
                <p class="line">
                  <span class="who">{{ p.displayName }}</span>
                  <span class="name">{{ p.playlistName }}</span>
                </p>
                @if (p.note) { <q>{{ p.note }}</q> }
                <div class="actions">
                  <button type="button" class="tune" (click)="tune(p)" [disabled]="!player.canControl()"
                          [tabIndex]="copy === 1 ? -1 : 0"
                          [attr.aria-label]="'Tune in to ' + p.playlistName">
                    @if (playingId() === playlistId(p)) { On air } @else { ▶ Tune in }
                  </button>
                  <a [href]="p.playlistUrl" target="_blank" rel="noopener noreferrer nofollow"
                     [tabIndex]="copy === 1 ? -1 : 0">YouTube Music ↗</a>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-height: 0; text-shadow: var(--text-shadow); }
    .viewport {
      max-height: min(50vh, 460px);
      overflow: hidden;
      &:not(.static) {
        height: min(50vh, 460px);
        mask-image: linear-gradient(transparent, #000 16%, #000 84%, transparent);
        -webkit-mask-image: linear-gradient(transparent, #000 16%, #000 84%, transparent);
      }
      &:hover .track, &:focus-within .track { animation-play-state: paused; }
      &.static .track { animation: none; }
    }
    .track { animation: scroll linear infinite; }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      padding: 12px 0 12px 12px;
      border-left: 1px solid var(--line);
      transition: border-color var(--slow) var(--ease);
      &.on { border-left-color: var(--accent); }
      &.fresh { animation: arrive 1.2s var(--ease); }
      &:hover .actions { opacity: 1; }
    }
    .line { margin: 0; display: grid; gap: 1px; }
    .who { font-size: 11px; color: var(--ink-faint); letter-spacing: 0.02em; }
    .name { font: 400 18px/1.2 var(--font-display); color: var(--ink); }
    q { display: block; margin-top: 3px; font-size: 12px; font-style: italic; color: var(--ink-dim); }
    q::before { content: '“'; } q::after { content: '”'; }
    .actions {
      display: flex; gap: 14px; margin-top: 6px; font-size: 11px; opacity: 0.75;
      transition: opacity var(--fast) var(--ease);
      a { color: var(--ink-faint); text-decoration: none; &:hover { color: var(--ink); } }
    }
    .tune {
      border: 0; padding: 0; background: none; font-weight: 600; color: var(--ink); cursor: pointer;
      letter-spacing: 0.02em;
      &:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
    .empty { margin: 0; font-size: 12px; color: var(--ink-dim); max-width: 240px; }
    @keyframes scroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }
    @keyframes arrive { from { opacity: 0; transform: translateX(-6px); } }
    @media (hover: none) { .actions { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .viewport { overflow-y: auto; }
      .track { animation: none; }
    }
  `,
})
export class PlaylistFeedComponent implements OnInit {
  protected readonly feed = inject(FeedStore);
  protected readonly player = inject(PlayerStore);

  protected readonly copies = computed(() => (this.feed.items().length >= 4 ? [0, 1] : [0]));
  protected readonly duration = computed(() => Math.max(24, this.feed.items().length * SECONDS_PER_ITEM));
  protected readonly playingId = computed(() => {
    const src = this.player.source();
    return src.kind === 'playlist' ? src.playlistId : null;
  });

  ngOnInit(): void {
    this.feed.load();
  }

  protected tune(p: SharedPlaylist): void {
    void this.player.playPlaylist(p);
  }

  protected playlistId(p: SharedPlaylist): string | null {
    return new URL(p.playlistUrl).searchParams.get('list');
  }
}
