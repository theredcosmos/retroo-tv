import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Villa: bright daylight through a tall arched window lands on a cream wall, broken up by the soft dappled shadow
 * of garden leaves; travertine floor; a hint of wainscot. Light and calm.
 */
@Component({
  selector: 'app-villa-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="arch"><span class="leaves"></span></div>
    <div class="wainscot"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; }
    .arch {
      position: absolute; left: 6%; top: 6%; width: 22%; height: 62%; overflow: hidden;
      border-radius: 50% 50% 6px 6px / 28% 28% 6px 6px;
      background: rgba(var(--light), 0.95);
      transform: skewX(8deg); filter: blur(9px); opacity: var(--light-a);
      box-shadow: 0 0 120px 40px rgba(var(--light), 0.35);
    }
    .leaves {
      position: absolute; inset: 0;
      background:
        radial-gradient(18% 10% at 30% 30%, rgba(90, 80, 50, 0.35), transparent 70%),
        radial-gradient(14% 9% at 70% 22%, rgba(90, 80, 50, 0.3), transparent 70%),
        radial-gradient(20% 12% at 60% 55%, rgba(90, 80, 50, 0.3), transparent 70%),
        radial-gradient(16% 10% at 25% 70%, rgba(90, 80, 50, 0.32), transparent 70%),
        radial-gradient(12% 8% at 78% 80%, rgba(90, 80, 50, 0.28), transparent 70%);
      filter: blur(6px);
      animation: sway 9s ease-in-out infinite alternate;
    }
    .wainscot {
      position: absolute; left: 0; right: 0; bottom: 22%; height: 16%;
      background: repeating-linear-gradient(90deg, transparent 0 7%, rgba(80, 60, 30, 0.06) 7% 7.3%);
      border-top: 1px solid rgba(80, 60, 30, 0.12);
      filter: blur(1.5px);
    }
    @keyframes sway { to { transform: translate(2%, 1%) rotate(1deg); } }
  `,
})
export class VillaSceneComponent {}
