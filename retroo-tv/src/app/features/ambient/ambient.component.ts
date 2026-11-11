import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { PlayerStore } from '../../core/player/player.store';

/**
 * "Ambient mode": the current song's artwork, hugely blurred, glows behind the TV and tints the room —
 * the way light from a real screen colours the wall. Cross-fades between songs by keeping the previous
 * artwork underneath while the new one fades in. Strength per theme via --ambient-a.
 */
@Component({
  selector: 'app-ambient',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    @for (url of layers(); track url) {
      <div class="layer" [style.background-image]="'url(' + url + ')'"></div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      opacity: var(--ambient-a);
      mask-image: radial-gradient(60% 55% at 50% 42%, #000 30%, transparent 75%);
      -webkit-mask-image: radial-gradient(60% 55% at 50% 42%, #000 30%, transparent 75%);
      mix-blend-mode: screen;
      transition: opacity var(--slow) var(--ease);
    }
    .layer {
      position: absolute;
      inset: 10% 15% 25%;
      background-size: cover;
      background-position: center;
      filter: blur(80px) saturate(1.6);
      transform: scale(1.3);
      animation: fade-in 1.6s var(--ease) both;
    }
    @keyframes fade-in { from { opacity: 0; } }
  `,
})
export class AmbientComponent {
  private readonly player = inject(PlayerStore);
  private readonly url = computed(() => {
    const s = this.player.current();
    return s ? `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg` : null;
  });

  /** [previous, current] artwork — the previous stays underneath while the new one fades in. */
  protected readonly layers = linkedSignal<string | null, string[]>({
    source: this.url,
    computation: (url, prev) => {
      const list = prev?.value ?? [];
      if (!url) return list;
      return [...list.filter((u) => u !== url), url].slice(-2);
    },
  });
}
