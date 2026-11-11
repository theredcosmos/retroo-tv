import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Sunset Lounge / Midnight: low sun (or moon) through a two-pane window lands on the back wall as a soft,
 * skewed patch with the mullion's shadow; a sheer curtain glows at the left edge; a plant is a dark, blurred
 * silhouette at the right. Everything is out of focus — nothing here should read as a drawing.
 */
@Component({
  selector: 'app-living-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sunpatch" [class.night]="night()"><span></span><span></span></div>
    <div class="beam" [class.night]="night()"></div>
    <div class="sheer"></div>
    <div class="plant"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; }
    /* Window light on the wall: two panes with a mullion gap, skewed by the low sun angle. */
    .sunpatch {
      position: absolute; left: 54%; top: 8%; width: 30%; height: 46%;
      display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 5%;
      transform: skewX(-14deg) rotate(-3deg); filter: blur(10px); mix-blend-mode: screen;
      opacity: var(--light-a);
      span { background: rgba(var(--light), 0.85); border-radius: 2px; }
      span:nth-child(1) { grid-row: 1 / 3; }
      span:nth-child(2) { grid-row: 1 / 3; }
      &.night { left: 8%; opacity: calc(var(--light-a) * 0.9); transform: skewX(10deg) rotate(2deg); }
    }
    /* Dust-lit shaft of light crossing the room. */
    .beam {
      position: absolute; left: 30%; top: -10%; width: 55%; height: 120%;
      background: linear-gradient(105deg, transparent 30%, rgba(var(--light), 0.12) 50%, transparent 70%);
      filter: blur(30px); mix-blend-mode: screen;
      &.night { opacity: 0.5; }
    }
    .sheer {
      position: absolute; left: -4%; top: -5%; width: 18%; height: 110%;
      background: repeating-linear-gradient(90deg,
        rgba(var(--light), 0.16) 0 26px, rgba(var(--light), 0.05) 26px 48px);
      filter: blur(16px); mix-blend-mode: screen;
    }
    .plant {
      position: absolute; right: -3%; top: 18%; width: 22%; height: 70%;
      background:
        radial-gradient(30% 22% at 40% 30%, rgba(0, 0, 0, 0.55), transparent 70%),
        radial-gradient(26% 20% at 70% 50%, rgba(0, 0, 0, 0.5), transparent 70%),
        radial-gradient(30% 24% at 35% 70%, rgba(0, 0, 0, 0.45), transparent 70%);
      filter: blur(14px);
    }
  `,
})
export class LivingSceneComponent {
  readonly night = input(false);
}
