import { Injectable } from '@angular/core';

/** Peak loudness of the hiss (0–1). Kept low: it should feel like a TV in the room, not a fire alarm. */
const HISS_VOLUME = 0.05;
const FADE_S = 0.15;

/**
 * Analogue-TV "snow" sound, synthesised with the Web Audio API — no audio files.
 *
 *   AudioBufferSourceNode (2 s of white noise, looped)
 *     → BiquadFilter (band-pass ~3.2 kHz: thin and crackly, like a small TV speaker)
 *     → GainNode (fade in/out to avoid clicks)
 *     → speakers
 *
 * The AudioContext is created lazily on first use, which always happens after the user's first click
 * (browsers keep a context "suspended" if it is created before a user gesture).
 */
@Injectable({ providedIn: 'root' })
export class StaticHissService {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private source?: AudioBufferSourceNode;

  start(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gain) return;
    void ctx.resume();
    if (!this.source) {
      this.source = ctx.createBufferSource();
      this.source.buffer = noiseBuffer(ctx);
      this.source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3200;
      filter.Q.value = 0.6;
      this.source.connect(filter).connect(this.gain);
      this.source.start();
    }
    this.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.gain.gain.setTargetAtTime(HISS_VOLUME, ctx.currentTime, FADE_S / 3);
  }

  stop(): void {
    if (!this.ctx || !this.gain || !this.source) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, FADE_S / 3);
    const src = this.source;
    this.source = undefined;
    src.stop(t + FADE_S * 2);
  }

  private ensureContext(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined; // very old browser: silent static is fine
    this.ctx = new Ctor();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    return this.ctx;
  }
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
