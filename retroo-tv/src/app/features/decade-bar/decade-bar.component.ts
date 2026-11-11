import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChildren } from '@angular/core';
import { PlayerStore } from '../../core/player/player.store';
import { DecadeSlug } from '../../core/models';

/**
 * "Travel to" channel selector — or, when tuned to a shared playlist, a line saying whose playlist is on with a
 * way back to the decades.
 *
 * Accessibility: WAI-ARIA radiogroup with roving tabindex (only the selected chip is tabbable; ←/→ move and select).
 */
@Component({
  selector: 'app-decade-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar glass">
      @if (player.source(); as src) {
        @if (src.kind === 'playlist') {
          <div class="playlist-row">
            <span class="eyebrow">Tuned to</span>
            <span class="pl-name">{{ src.name }}</span>
            <span class="by">shared by {{ src.sharedBy }}</span>
            @if (player.canControl()) {
              <button type="button" class="back" (click)="player.leavePlaylist()">Back to decades</button>
            }
          </div>
        }
      }
      <div class="row">
        <span class="eyebrow label" id="travel-label">Travel to</span>
        <div class="chips" role="radiogroup" aria-labelledby="travel-label" (keydown)="onKey($event)">
          @for (d of player.decades(); track d.slug; let i = $index) {
            <button
              #chip
              type="button"
              role="radio"
              class="chip"
              [class.active]="d.slug === player.activeDecade() && !player.isPlaylist()"
              [attr.aria-checked]="d.slug === player.activeDecade() && !player.isPlaylist()"
              [tabIndex]="d.slug === player.activeDecade() ? 0 : -1"
              [disabled]="d.songCount === 0 || !player.canControl()"
              [title]="d.songCount + ' songs · press ' + (i + 1)"
              (click)="select(d.slug)"
            >
              {{ d.label }}
            </button>
          } @empty {
            @for (n of placeholders; track n) {
              <span class="chip skeleton" aria-hidden="true"></span>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: grid;
      gap: 8px;
      padding: 8px 8px 8px 16px;
      border-radius: var(--radius-pill);
      width: min(600px, 94vw);
    }
    .row { display: flex; align-items: center; gap: 14px; }
    .label { flex: none; }
    .chips { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .chip {
      height: 32px;
      border: 0;
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--ink-dim);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
      &:hover:not(:disabled) { color: var(--ink); background: var(--hover); }
      &:disabled { opacity: 0.35; cursor: not-allowed; }
      &.active { background: var(--ink); color: var(--page-bg); font-weight: 600; }
    }
    .skeleton { background: var(--hover); animation: shimmer 1.4s var(--ease) infinite alternate; }
    .playlist-row {
      display: flex; align-items: baseline; gap: 10px; padding: 4px 4px 2px 0; min-width: 0;
      border-bottom: var(--hairline); padding-bottom: 8px; margin-right: 8px;
    }
    .pl-name { font: 400 17px/1.1 var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .by { font-size: 11px; color: var(--ink-faint); white-space: nowrap; }
    .back {
      margin-left: auto; border: 0; background: none; font-size: 11px; color: var(--ink-dim);
      text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
      &:hover { color: var(--ink); }
    }
    @keyframes shimmer { to { opacity: 0.4; } }
    @media (max-width: 560px) {
      .bar { border-radius: var(--radius-lg); padding: 10px; }
      .row { flex-direction: column; align-items: stretch; gap: 8px; }
      .chips { grid-template-columns: repeat(4, 1fr); }
    }
  `,
})
export class DecadeBarComponent {
  protected readonly player = inject(PlayerStore);
  protected readonly placeholders = [1, 2, 3, 4, 5, 6, 7];
  private readonly chips = viewChildren<ElementRef<HTMLButtonElement>>('chip');

  protected select(slug: DecadeSlug): void {
    void this.player.selectDecade(slug);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const decades = this.player.decades().filter((d) => d.songCount > 0);
    const idx = decades.findIndex((d) => d.slug === this.player.activeDecade());
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = decades[(idx + step + decades.length) % decades.length];
    this.select(next.slug);
    queueMicrotask(() => this.chips().find((c) => c.nativeElement.tabIndex === 0)?.nativeElement.focus());
  }
}
