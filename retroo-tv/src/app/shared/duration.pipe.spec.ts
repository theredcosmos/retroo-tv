import { DurationPipe } from './duration.pipe';

describe('DurationPipe', () => {
  const pipe = new DurationPipe();

  it('formats minutes and seconds', () => {
    expect(pipe.transform(229.4)).toBe('3:49');
    expect(pipe.transform(5)).toBe('0:05');
  });

  it('formats hours', () => {
    expect(pipe.transform(3725)).toBe('1:02:05');
  });

  it('treats null/negative as zero', () => {
    expect(pipe.transform(null)).toBe('0:00');
    expect(pipe.transform(-3)).toBe('0:00');
  });
});
