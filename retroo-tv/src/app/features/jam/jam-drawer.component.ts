import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { JamStore } from '../../core/jam/jam.store';
import { JamPanelComponent } from './jam-panel.component';

/**
 * Slide-over drawer that holds the jam panel. Keeping secondary features in a drawer is what lets the main view
 * stay minimal (TV, feed, controls). Opens from the header's "Jam" button, closes with ✕, Esc or the scrim.
 * The panel stays mounted while closed so chat history and scroll position survive.
 */
@Component({
  selector: 'app-jam-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JamPanelComponent],
  template: `
    <div class="scrim" [class.open]="jam.drawerOpen()" (click)="jam.drawerOpen.set(false)" aria-hidden="true"></div>
    <aside class="drawer" [class.open]="jam.drawerOpen()" [attr.aria-hidden]="!jam.drawerOpen()" [inert]="!jam.drawerOpen()"
           aria-label="Jam sessions">
      <button type="button" class="close" (click)="jam.drawerOpen.set(false)" aria-label="Close jam panel">✕</button>
      <app-jam-panel />
    </aside>
  `,
  styles: `
    .scrim {
      position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.18);
      opacity: 0; pointer-events: none; transition: opacity var(--slow) var(--ease);
      &.open { opacity: 1; pointer-events: auto; }
    }
    .drawer {
      position: fixed; top: 12px; right: 12px; bottom: 12px; z-index: 41;
      width: min(380px, calc(100vw - 24px));
      display: flex; flex-direction: column;
      border-radius: var(--radius-lg);
      background: var(--glass-strong);
      border: var(--hairline);
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      box-shadow: 0 30px 80px -20px var(--shadow);
      transform: translateX(calc(100% + 24px));
      transition: transform var(--slow) var(--ease);
      &.open { transform: none; }
    }
    .close {
      position: absolute; top: 14px; right: 14px; z-index: 1;
      width: 28px; height: 28px; border: var(--hairline); border-radius: 50%;
      background: transparent; color: var(--ink-dim); font-size: 11px; cursor: pointer;
      &:hover { color: var(--ink); background: var(--hover); }
    }
    app-jam-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  `,
})
export class JamDrawerComponent {
  protected readonly jam = inject(JamStore);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.jam.drawerOpen.set(false);
  }
}
