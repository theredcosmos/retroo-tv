import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * City Night: the skyline is pure bokeh — out-of-focus circles of sodium, office and neon light behind the TV —
 * with soft venetian-blind shadows slanting across the wall from a streetlamp.
 */
@Component({
  selector: 'app-city-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bokeh far"></div>
    <div class="bokeh near"></div>
    <div class="blinds"></div>
    <div class="dusk"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; }
    .dusk {
      position: absolute; left: 0; right: 0; top: 0; height: 60%;
      background: linear-gradient(180deg, rgba(60, 40, 90, 0.25), transparent);
      mix-blend-mode: screen;
    }
    .bokeh {
      position: absolute; inset: 0 0 30% 0; mix-blend-mode: screen;
      &.far {
        filter: blur(3px); opacity: 0.75;
        background:
          radial-gradient(circle at 8% 30%, rgba(255, 190, 110, 0.55) 0 0.9%, transparent 1.4%),
          radial-gradient(circle at 15% 45%, rgba(255, 220, 160, 0.4) 0 0.7%, transparent 1.1%),
          radial-gradient(circle at 24% 26%, rgba(150, 190, 255, 0.45) 0 0.6%, transparent 1%),
          radial-gradient(circle at 33% 52%, rgba(255, 170, 90, 0.5) 0 0.8%, transparent 1.2%),
          radial-gradient(circle at 62% 22%, rgba(255, 200, 140, 0.45) 0 0.7%, transparent 1.1%),
          radial-gradient(circle at 71% 44%, rgba(140, 180, 255, 0.5) 0 0.9%, transparent 1.3%),
          radial-gradient(circle at 80% 30%, rgba(255, 120, 150, 0.4) 0 0.6%, transparent 1%),
          radial-gradient(circle at 88% 50%, rgba(255, 210, 150, 0.5) 0 0.8%, transparent 1.2%),
          radial-gradient(circle at 94% 20%, rgba(170, 200, 255, 0.4) 0 0.6%, transparent 1%);
      }
      &.near {
        filter: blur(14px); opacity: 0.6;
        background:
          radial-gradient(circle at 6% 55%, rgba(255, 170, 90, 0.7) 0 3%, transparent 4.5%),
          radial-gradient(circle at 20% 18%, rgba(130, 170, 255, 0.55) 0 2.5%, transparent 4%),
          radial-gradient(circle at 78% 60%, rgba(255, 190, 120, 0.65) 0 3.5%, transparent 5%),
          radial-gradient(circle at 92% 14%, rgba(255, 110, 160, 0.5) 0 2.5%, transparent 4%),
          radial-gradient(circle at 66% 12%, rgba(255, 220, 170, 0.45) 0 2%, transparent 3.4%);
      }
    }
    .blinds {
      position: absolute; left: 40%; top: 4%; width: 60%; height: 70%;
      background: repeating-linear-gradient(180deg, rgba(var(--light), 0.22) 0 14px, transparent 14px 30px);
      transform: skewY(-12deg); filter: blur(5px); mix-blend-mode: screen; opacity: var(--light-a);
      mask-image: radial-gradient(closest-side, #000 40%, transparent);
      -webkit-mask-image: radial-gradient(closest-side, #000 40%, transparent);
    }
  `,
})
export class CitySceneComponent {}
