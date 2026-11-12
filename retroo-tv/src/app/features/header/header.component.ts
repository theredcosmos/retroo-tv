import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { JamStore } from '../../core/jam/jam.store';
import { PlayerStore } from '../../core/player/player.store';
import { RealtimeService } from '../../core/realtime/realtime.service';

/**
 * Top bar, deliberately quiet: live listeners (left), a serif wordmark (centre), and on the right the Jam drawer
 * button and a link to what's on — the decade on YouTube Music, or the shared playlist. (The scene picker lives in
 * the bottom-right corner of the stage — see App.)
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="side left">
      <div class="pill glass" [class.offline]="!connected()" role="status" aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        @if (listeners() !== null) { {{ listeners() }} listening } @else { connecting }
      </div>
    </div>

    <h1 class="wordmark">Retroo <em>TV</em></h1>

    <div class="side right">
      <button type="button" class="pill glass jam" (click)="jam.drawerOpen.set(!jam.drawerOpen())"
              [attr.aria-expanded]="jam.drawerOpen()" [class.active]="jam.inJam()">
        @if (jam.inJam()) { <span class="dot" aria-hidden="true"></span> Jam · {{ jam.members().length }} }
        @else { Jam }
      </button>
      @if (link(); as l) {
        <a class="pill glass link" [href]="l.url" target="_blank" rel="noopener noreferrer" [title]="l.label">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#ff0033" />
            <path d="M10 8.5v7l5.5-3.5z" fill="#fff" />
          </svg>
          <span class="label">{{ l.label }}</span>
          <span aria-hidden="true">↗</span>
        </a>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
    }
    .side { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .right { justify-content: flex-end; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 13px;
      border-radius: var(--radius-pill); font-size: 12px; font-weight: 500; white-space: nowrap;
      text-decoration: none; cursor: pointer; transition: background var(--fast) var(--ease);
      &:hover { background: var(--hover); }
    }
    .jam.active { border-color: var(--accent); }
    .dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--live);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 25%, transparent);
    }
    .offline .dot { background: var(--ink-faint); box-shadow: none; }
    .wordmark {
      margin: 0; font: 400 26px/1 var(--font-display); letter-spacing: 0.01em; color: var(--ink);
      text-shadow: var(--text-shadow);
      em { font-style: italic; color: var(--ink-dim); }
    }
    .link .label { max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 760px) {
      :host { grid-template-columns: auto 1fr; }
      .wordmark { display: none; }
      .link .label { display: none; }
    }
  `,
})
export class HeaderComponent {
  private readonly realtime = inject(RealtimeService);
  private readonly player = inject(PlayerStore);
  protected readonly jam = inject(JamStore);

  protected readonly listeners = this.realtime.listeners;
  protected readonly connected = this.realtime.connected;
  protected readonly link = computed(() => {
    const src = this.player.source();
    if (src.kind === 'playlist') return { url: src.url, label: `${src.name} on YouTube Music` };
    const d = this.player.activeDecadeInfo();
    if (!d) return null;
    const label = d.slug === 'now' ? `${new Date().getFullYear()} on YouTube Music` : `${d.label} on YouTube Music`;
    return { url: d.ytMusicUrl, label };
  });
}
