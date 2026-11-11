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
  /** 7 channels spread over a 270° sweep. */
  protected readonly knobAngle = computed(() => -135 + this.channelIndex() * 45);
  protected readonly channelLabel = computed(() => this.player.activeDecadeInfo()?.label ?? '');
  /** On-screen display: "CH 90s", or "CH ★" with the playlist name when tuned to a shared playlist. */
  protected readonly osdLabel = computed(() => {
    const src = this.player.source();
    return src.kind === 'playlist' ? `CH ★  ${src.name}` : `CH ${this.channelLabel()}`;
  });
  /** True for the length of the CRT power-on animation after the first "Tune in". */
  protected readonly poweringOn = signal(false);

  constructor() {
    // The iframe host must exist in the DOM before the YouTube API can replace it.
    afterNextRender(() => void this.player.init(this.host().nativeElement));

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

  protected nextChannel(): void {
    const decades = this.player.decades();
    if (!decades.length) return;
    const next = decades[(this.channelIndex() + 1) % decades.length];
    void this.player.selectDecade(next.slug);
  }

  private flashOsd(): void {
    this.osdVisible.set(true);
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.osdVisible.set(false), 2500);
  }
}
