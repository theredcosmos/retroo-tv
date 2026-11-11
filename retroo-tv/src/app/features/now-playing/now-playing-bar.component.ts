import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlayerStore } from '../../core/player/player.store';
import { DurationPipe } from '../../shared/duration.pipe';

/**
 * Transport bar: artwork, title (serif) / artist, a hairline seekable progress line, and
 * prev / play-pause / next. The progress <input type="range"> is native and keyboard accessible.
 */
@Component({
  selector: 'app-now-playing-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DurationPipe],
  template: `
    @let song = player.current();
    <div class="bar glass">
      <div class="art">
        @if (song) {
          @for (s of [song]; track s.videoId) {
            <img [src]="'https://i.ytimg.com/vi/' + s.videoId + '/mqdefault.jpg'" alt="" width="44" height="44" />
          }
        }
      </div>

      <div class="meta">
        <div class="title" [title]="song?.title ?? ''">{{ song?.title ?? 'Tuning…' }}</div>
        <div class="artist">
          {{ song?.artist ?? '—' }}@if (song?.releaseYear) { <span class="year"> · {{ song!.releaseYear }}</span> }
        </div>
      </div>

      <div class="controls">
        <button type="button" class="icon" (click)="player.previous()" aria-label="Previous (P)" [disabled]="!player.canControl()">
          <svg viewBox="0 0 24 24"><path d="M7 6h2v12H7zm3.5 6 7.5 6V6z" /></svg>
        </button>
        <button type="button" class="play" (click)="player.togglePlay()"
                [disabled]="!player.canControl() && !player.awaitingGesture()"
                [attr.aria-label]="player.isPlaying() ? 'Pause (Space)' : 'Play (Space)'">
          @if (player.isPlaying()) {
            <svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" /></svg>
          } @else {
            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>
          }
        </button>
        <button type="button" class="icon" (click)="player.next()" aria-label="Next (N)" [disabled]="!player.canControl()">
          <svg viewBox="0 0 24 24"><path d="M6 18l7.5-6L6 6zm9-12h2v12h-2z" /></svg>
        </button>
      </div>

      <div class="timeline">
        <span class="time">{{ player.progress() | duration }}</span>
        <input
          type="range"
          min="0"
          step="1"
          aria-label="Seek"
          [max]="player.duration() || 0"
          [value]="player.progress()"
          [disabled]="!player.duration() || !player.canControl()"
          [style.--pct.%]="player.duration() ? (player.progress() / player.duration()) * 100 : 0"
          (change)="seek($event)"
        />
        <span class="time">{{ player.duration() | duration }}</span>
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      grid-template-areas: 'art meta controls' 'time time time';
      align-items: center;
      column-gap: 12px;
      row-gap: 8px;
      padding: 10px 14px 10px 10px;
      border-radius: var(--radius-lg);
      width: min(600px, 94vw);
    }
    .art {
      grid-area: art;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--hover);
      img { width: 100%; height: 100%; object-fit: cover; animation: fade var(--slow) var(--ease); }
    }
    .meta { grid-area: meta; min-width: 0; }
    .title, .artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title { font: 400 18px/1.15 var(--font-display); letter-spacing: 0.005em; }
    .artist { font-size: 12px; color: var(--ink-dim); margin-top: 2px; }
    .year { color: var(--ink-faint); }
    .controls { grid-area: controls; display: flex; align-items: center; gap: 4px; }
    .icon, .play {
      display: grid; place-items: center; border: 0; border-radius: 50%; cursor: pointer;
      transition: background var(--fast) var(--ease), transform var(--fast) var(--ease), opacity var(--fast);
      &:disabled { opacity: 0.3; cursor: not-allowed; }
    }
    .icon {
      width: 34px; height: 34px; background: transparent;
      svg { width: 18px; height: 18px; fill: var(--ink-dim); }
      &:hover:not(:disabled) { background: var(--hover); svg { fill: var(--ink); } }
    }
    .play {
      width: 40px; height: 40px; background: var(--ink);
      svg { width: 18px; height: 18px; fill: var(--page-bg); }
      &:hover:not(:disabled) { transform: scale(1.05); }
    }
    .timeline {
      grid-area: time;
      display: grid;
      grid-template-columns: 34px 1fr 34px;
      align-items: center;
      gap: 10px;
      padding: 0 2px;
    }
    .time { font: 400 10px var(--font-mono); color: var(--ink-faint); font-variant-numeric: tabular-nums; }
    .time:last-child { text-align: right; }
    input[type='range'] {
      --pct: 0%;
      appearance: none;
      height: 2px;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--ink) var(--pct), var(--line) var(--pct));
      cursor: pointer;
      &::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); opacity: 0; transition: opacity var(--fast); }
      &:hover::-webkit-slider-thumb { opacity: 1; }
      &::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: var(--ink); }
      &:disabled { cursor: default; }
    }
    @keyframes fade { from { opacity: 0; } }
  `,
})
export class NowPlayingBarComponent {
  protected readonly player = inject(PlayerStore);

  protected seek(e: Event): void {
    this.player.seek(Number((e.target as HTMLInputElement).value));
  }
}
