import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PlayerStore } from '../../core/player/player.store';
import { ThemeService } from '../../core/ui/theme.service';
import { StaticNoiseDirective } from './static-noise.directive';

/** Mid-song interference: 2–3 bursts per song, each a couple of seconds, never in the first/last 15 s. */
const GLITCH_EDGE_S = 15;
const GLITCH_MIN_GAP_S = 20;
const GLITCH_MIN_MS = 1_200;
const GLITCH_MAX_MS = 2_800;

/**
 * The CRT television — pure CSS cabinet with a live YouTube iframe as its picture tube.
 *
 * Screen layers, back to front:
 *   1. `.yt-host`     the YouTube iframe (16:9, centre-cropped to fill the 4:3 tube; pointer-events off)
 *   2. `<canvas>`     static noise while tuning / off / error
 *   3. `.scanlines`   horizontal lines + RGB mask
 *   4. `.glare`       curvature vignette and glare
 *   5. `.osd`         on-screen display ("CH 90s"), tap-to-tune prompt, error text
 *
 * TV models (per theme): see crt-tv.models.scss. Model parts that a model doesn't use are hidden by CSS.
 *
 * The channel knob is functional: it rotates to the active decade and clicking it changes channel.
 */
@Component({
  selector: 'app-crt-tv',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StaticNoiseDirective],
  // The TV model (console / portable / sleek / cabinet / gloss) comes from the active theme.
  host: { '[attr.data-model]': 'theme.tvModel()' },
  templateUrl: './crt-tv.component.html',
  styleUrls: ['./crt-tv.component.scss', './crt-tv.models.scss'],
})
export class CrtTvComponent {
  protected readonly player = inject(PlayerStore);
  protected readonly theme = inject(ThemeService);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('ytHost');

  /** OSD stays visible briefly after each channel change, like a real TV. */
  protected readonly osdVisible = signal(false);
  private osdTimer?: ReturnType<typeof setTimeout>;

  protected readonly channelIndex = computed(() =>
    Math.max(0, this.player.decades().findIndex((d) => d.slug === this.player.activeDecade())),
  );
  /**
   * 7 channels spread over a 270° sweep. Plus whole turns counted on every wrap from the last channel back to the
   * first, so the knob keeps turning forward instead of spinning 270° backwards.
   */
  private knobTurns = 0;
  private lastIndex = 0;
  protected readonly knobAngle = computed(() => {
    const i = this.channelIndex();
    const n = Math.max(1, this.player.decades().length);
    if (i < this.lastIndex && this.lastIndex - i > n / 2) this.knobTurns++;
    else if (i > this.lastIndex && i - this.lastIndex > n / 2) this.knobTurns--;
    this.lastIndex = i;
    return -135 + i * 45 + this.knobTurns * 360;
  });
  protected readonly channelLabel = computed(() => this.player.activeDecadeInfo()?.label ?? '');
  /** On-screen display: "CH 90s", or "CH ★" with the playlist name when tuned to a shared playlist. */
  protected readonly osdLabel = computed(() => {
    const src = this.player.source();
    return src.kind === 'playlist' ? `CH ★  ${src.name}` : `CH ${this.channelLabel()}`;
  });
  /** True for the length of the CRT power-on animation after the first "Tune in". */
  protected readonly poweringOn = signal(false);
  /** True during a mid-song interference burst (weak-signal flicker, a little snow, a rolling band). */
  protected readonly glitching = signal(false);
  /** Song positions (s) at which the next bursts fire, ascending. Planned per song, consumed as playback passes. */
  private glitchPlan: number[] = [];
  private glitchTimer?: ReturnType<typeof setTimeout>;
  private readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    // The iframe host must exist in the DOM before the YouTube API can replace it.
    afterNextRender(() => void this.player.init(this.host().nativeElement));

    // Plan the interference bursts once the new song's duration is known.
    effect(() => {
      const videoId = this.player.current()?.videoId;
      const duration = this.player.duration();
      untracked(() => this.planGlitches(videoId, duration));
    });
    // Fire a burst when playback passes a planned position. Driven by the song position (not wall-clock time),
    // so pausing, seeking or a jam re-sync never makes a burst fire at the wrong moment.
    effect(() => {
      const t = this.player.progress();
      const live = this.player.status() === 'on' && !this.player.showStatic() && this.player.isPlaying();
      untracked(() => {
        while (this.glitchPlan.length && t - this.glitchPlan[0] > 3) this.glitchPlan.shift(); // seeked past
        if (live && this.glitchPlan.length && t >= this.glitchPlan[0]) {
          this.glitchPlan.shift();
          this.glitch();
        }
      });
    });
    // A channel change or "No signal" ends any burst immediately.
    effect(() => {
      if (this.player.status() !== 'on') untracked(() => this.stopGlitch());
    });

    // Flash "CH 90s" whenever the channel changes — from the knob, the decade bar or a keyboard shortcut.
    effect(() => {
      this.player.activeDecade();
      this.player.source();
      untracked(() => this.flashOsd());
    });
  }

  protected tuneIn(): void {
    this.player.tuneIn();
    this.poweringOn.set(true);
    setTimeout(() => this.poweringOn.set(false), 800);
    this.flashOsd();
  }

  /**
   * Turn the dial one channel. Skips empty decades (the decade bar disables those; the knob used to land on them
   * and show "No signal"). From a shared playlist, the first turn returns to the decade the dial points at.
   */
  protected nextChannel(): void {
    const decades = this.player.decades();
    if (!decades.length || !this.player.canControl()) return;
    if (this.player.isPlaylist()) {
      void this.player.selectDecade(this.player.activeDecade());
      return;
    }
    for (let step = 1; step <= decades.length; step++) {
      const next = decades[(this.channelIndex() + step) % decades.length];
      if (next.songCount > 0) {
        void this.player.selectDecade(next.slug);
        return;
      }
    }
  }

  private planGlitches(videoId: string | undefined, duration: number): void {
    this.glitchPlan = [];
    this.stopGlitch();
    if (!videoId || this.reducedMotion || duration < GLITCH_EDGE_S * 2 + GLITCH_MIN_GAP_S) return;
    const span = duration - GLITCH_EDGE_S * 2;
    const count = Math.min(Math.random() < 0.5 ? 2 : 3, Math.floor(span / GLITCH_MIN_GAP_S));
    // Split the playable span into `count` equal slots and put one burst at a random point in each:
    // spread out, never bunched, but still unpredictable.
    const slot = span / count;
    for (let i = 0; i < count; i++) {
      this.glitchPlan.push(GLITCH_EDGE_S + slot * i + Math.random() * (slot - GLITCH_MIN_GAP_S / 2));
    }
  }

  private glitch(): void {
    this.glitching.set(true);
    clearTimeout(this.glitchTimer);
    const ms = GLITCH_MIN_MS + Math.random() * (GLITCH_MAX_MS - GLITCH_MIN_MS);
    this.glitchTimer = setTimeout(() => this.glitching.set(false), ms);
  }

  private stopGlitch(): void {
    clearTimeout(this.glitchTimer);
    this.glitching.set(false);
  }

  private flashOsd(): void {
    this.osdVisible.set(true);
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.osdVisible.set(false), 2500);
  }
}
