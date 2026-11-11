import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/ui/toast.service';

/** Renders ToastService's queue in a polite live region so screen readers announce each message. */
@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" role="status" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast glass" [class.error]="t.kind === 'error'" (click)="toasts.dismiss(t.id)">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .stack { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 70; display: grid; gap: 8px; justify-items: center; }
    .toast {
      padding: 10px 16px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 500; cursor: pointer;
      background: var(--glass-strong); animation: rise var(--slow) var(--ease);
      &.error { border-color: #e98b7d; color: #e98b7d; }
    }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
}
