import { Directive, ElementRef, OnDestroy, afterNextRender, effect, inject, input } from '@angular/core';

/**
 * Draws animated analogue-TV "snow" on a <canvas>.
 *
 * Performance notes:
 *  - The canvas is small (320×240) and CSS-scaled up (smoothly), so each frame fills
 *    only ~77k pixels — cheap even on phones.
 *  - A pre-allocated Uint32Array view over ImageData writes one 32-bit RGBA value per pixel (no per-channel loop).
 *  - Redrawn at ~30 fps (analogue snow doesn't need 60) — half the CPU of a per-frame redraw.
 *  - The old CSS `filter: contrast() brightness()` is baked into the grey range, so the GPU doesn't re-filter
 *    the canvas on every frame.
 *  - The loop runs only while `appNoiseActive` is true and stops on destroy; with prefers-reduced-motion it draws
 *    a single static frame.
 */
/** ~30 fps. */
const FRAME_MS = 33;

@Directive({ selector: 'canvas[appStaticNoise]' })
export class StaticNoiseDirective implements OnDestroy {
  readonly appNoiseActive = input(true);

  private readonly canvas = inject<ElementRef<HTMLCanvasElement>>(ElementRef).nativeElement;
  private ctx?: CanvasRenderingContext2D | null;
  private image?: ImageData;
  private pixels?: Uint32Array;
  private frame?: number;
  private readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    // 320×240: fine grain like a real tube (cheap at this size, and no visible "pixel blocks").
    this.canvas.width = 320;
    this.canvas.height = 240;

    afterNextRender(() => {
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;
      this.image = this.ctx.createImageData(this.canvas.width, this.canvas.height);
      this.pixels = new Uint32Array(this.image.data.buffer);
      this.draw();
    });

    effect(() => (this.appNoiseActive() ? this.start() : this.stop()));
  }

  private start(): void {
    if (this.frame !== undefined || this.reducedMotion) return;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= FRAME_MS) {
        last = t;
        this.draw();
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private draw(): void {
    if (!this.ctx || !this.image || !this.pixels) return;
    const px = this.pixels;
    const w = this.canvas.width;
    const h = this.canvas.height;
    for (let y = 0; y < h; y++) {
      // ~6% of rows get an interference streak (brighter or darker band), like weak-signal analogue snow.
      const r = Math.random();
      const bias = r < 0.03 ? 39 : r < 0.06 ? -35 : 0;
      for (let x = 0, i = y * w; x < w; x++, i++) {
        // mid-grey range (40–198) instead of pure black/white: softer, more like phosphor snow
        const v = Math.min(255, Math.max(0, 40 + ((Math.random() * 158) | 0) + bias));
        // little-endian ABGR: opaque grey
        px[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
