import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Neon Den: two out-of-focus neon washes (magenta, cyan) on a violet wall and their reflection in a glossy floor. */
@Component({
  selector: 'app-neon-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wash magenta"></div>
    <div class="wash cyan"></div>
    <div class="reflection"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; }
    .wash {
      position: absolute; width: 46%; height: 70%; border-radius: 50%; filter: blur(70px); mix-blend-mode: screen;
      &.magenta { left: -6%; top: 2%; background: rgba(255, 60, 200, 0.42); }
      &.cyan { right: -8%; top: 10%; background: rgba(40, 210, 255, 0.3); }
    }
    .reflection {
      position: absolute; left: 10%; right: 10%; bottom: 0; height: 22%;
      background: linear-gradient(90deg, rgba(255, 60, 200, 0.18), transparent 45%, transparent 55%, rgba(40, 210, 255, 0.14));
      filter: blur(24px);
    }
  `,
})
export class NeonSceneComponent {}
