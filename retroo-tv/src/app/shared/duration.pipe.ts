import { Pipe, PipeTransform } from '@angular/core';

/** 229.4 → "3:49"; 3725 → "1:02:05". Pure pipe: only re-runs when the input value changes. */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(totalSeconds: number | null | undefined): string {
    const s = Math.max(0, Math.floor(totalSeconds ?? 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
}
