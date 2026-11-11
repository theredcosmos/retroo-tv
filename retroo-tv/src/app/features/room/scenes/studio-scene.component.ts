import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Studio / Ivory / Noir: a seamless photographic cyclorama — one soft spotlight from above and the wall curving
 * into the floor. Nothing else; the TV is the subject.
 */
@Component({
  selector: 'app-studio-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="spot"></div><div class="sweep"></div>`,
  styles: `
    :host { position: absolute; inset: 0; }
    .spot {
      position: absolute; left: 20%; right: 20%; top: -20%; height: 95%;
      background: radial-gradient(closest-side, rgba(var(--light), var(--light-a)), transparent);
      filter: blur(20px);
    }
    .sweep {
      position: absolute; left: -10%; right: -10%; bottom: 0; height: 40%;
      background: radial-gradient(60% 100% at 50% 0%, rgba(var(--light), calc(var(--light-a) * 0.35)), transparent 70%);
      filter: blur(30px);
    }
  `,
})
export class StudioSceneComponent {}
