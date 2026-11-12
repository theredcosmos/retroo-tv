import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Fine film grain over the whole page (SVG fractal noise, a few-percent opacity per theme).
 * It is the cheapest single trick that makes flat digital gradients read as a photograph. The texture shifts in
 * steps (like projected film) — and stays still under prefers-reduced-motion.
 *
 * Performance: no mix-blend-mode. A blended full-screen layer above the YouTube iframe forced the browser to
 * re-blend the whole page on every video frame. A plain translucent layer is composited for free, and it only
 * overhangs the viewport by 40px (it used to be 4× the viewport's area) — just enough for the jitter.
 */
@Component({
  selector: 'app-film-grain',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: ``,
  styles: `
    :host {
      position: fixed;
      inset: -40px;
      z-index: 60;
      pointer-events: none;
      opacity: calc(var(--grain-film, 0.06) * 0.6);
      will-change: transform;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
      animation: grain 0.9s steps(6) infinite;
    }
    @keyframes grain {
      0% { transform: translate(0, 0); }
      20% { transform: translate(-24px, 16px); }
      40% { transform: translate(16px, -24px); }
      60% { transform: translate(-8px, 24px); }
      80% { transform: translate(24px, 8px); }
      100% { transform: translate(0, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      :host { animation: none; }
    }
  `,
})
export class FilmGrainComponent {}
