import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../../core/ui/theme.service';
import { LivingSceneComponent } from './scenes/living-scene.component';
import { RuralSceneComponent } from './scenes/rural-scene.component';
import { CitySceneComponent } from './scenes/city-scene.component';
import { VillaSceneComponent } from './scenes/villa-scene.component';
import { NeonSceneComponent } from './scenes/neon-scene.component';
import { StudioSceneComponent } from './scenes/studio-scene.component';

/**
 * The room behind the TV, composed like a photograph with a shallow depth of field: the TV is the only sharp
 * object, everything here is soft light — a backdrop gradient, a key light, one scene-specific light composition
 * (window light on the wall, skyline bokeh, an arch of daylight…), the floor falling into shadow and a vignette.
 * Scenes are pure CSS, decorative and aria-hidden; `@switch` keeps only the active one in the DOM.
 */
@Component({
  selector: 'app-room',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LivingSceneComponent,
    RuralSceneComponent,
    CitySceneComponent,
    VillaSceneComponent,
    NeonSceneComponent,
    StudioSceneComponent,
  ],
  host: { 'aria-hidden': 'true' },
  template: `
    <div class="backdrop"></div>
    @switch (theme.scene()) {
      @case ('rural') { <app-rural-scene /> }
      @case ('city') { <app-city-scene /> }
      @case ('villa') { <app-villa-scene /> }
      @case ('neon') { <app-neon-scene /> }
      @case ('studio') { <app-studio-scene /> }
      @default { <app-living-scene [night]="theme.night()" /> }
    }
    <div class="floor"></div>
    <div class="vignette"></div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      background: var(--wall-3);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(70% 60% at 50% 38%, rgba(var(--light), calc(var(--light-a) * 0.35)), transparent 70%),
        linear-gradient(180deg, var(--wall-1) 0%, var(--wall-2) 58%, var(--wall-3) 100%);
      transition: background var(--slow) var(--ease);
    }
    .floor {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 26%;
      background: linear-gradient(180deg, transparent, var(--floor-1) 35%, var(--floor-2));
      filter: blur(8px);
    }
    .vignette {
      position: absolute;
      inset: 0;
      background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.45) 100%);
    }
  `,
})
export class RoomComponent {
  protected readonly theme = inject(ThemeService);
}
