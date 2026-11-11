import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Village Afternoon: a limewashed wall with real texture (SVG fractal noise), bright afternoon light through a
 * barred window falling on the wall, warm green bounce light from the courtyard outside, and a red-oxide floor.
 */
@Component({
  selector: 'app-rural-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="limewash"></div>
    <div class="window-light"></div>
    <div class="bounce"></div>
    <div class="earth"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; }
    .limewash {
      position: absolute; inset: 0; opacity: 0.35; mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.02' numOctaves='4' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.4 0 0 0 0 0.3 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 600px 600px;
    }
    /* Barred window light: bright patch crossed by soft vertical bar shadows. */
    .window-light {
      position: absolute; left: 8%; top: 10%; width: 28%; height: 44%;
      background:
        repeating-linear-gradient(90deg, transparent 0 13%, rgba(40, 30, 15, 0.55) 13% 15%),
        rgba(var(--light), 0.9);
      transform: skewX(12deg); filter: blur(6px); opacity: var(--light-a); mix-blend-mode: screen;
      border-radius: 3px;
    }
    .bounce {
      position: absolute; left: -10%; bottom: 10%; width: 60%; height: 50%;
      background: radial-gradient(closest-side, rgba(150, 190, 90, 0.28), transparent);
      filter: blur(30px); mix-blend-mode: screen;
    }
    .earth {
      position: absolute; left: 0; right: 0; bottom: 0; height: 24%;
      background: linear-gradient(180deg, rgba(120, 50, 30, 0), rgba(120, 50, 30, 0.55) 40%, rgba(60, 22, 12, 0.9));
      filter: blur(6px);
    }
  `,
})
export class RuralSceneComponent {}
