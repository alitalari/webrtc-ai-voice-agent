import { describe, it, expect } from 'vitest';
import { downsample } from '@voice/media';

describe('downsample', () => {
  it('reduces length by the factor', () => {
    const input = new Int16Array(48); // 48 samples
    expect(downsample(input, 3)).toHaveLength(16); // → 16 (48k → 16k)
  });

  it('box-averages each group of `factor` samples', () => {
    const input = Int16Array.from([0, 6, 12, 30, 30, 30]); // → avg(0,6,12)=6, avg(30,30,30)=30
    expect(Array.from(downsample(input, 3))).toEqual([6, 30]);
  });

  it('returns the input unchanged for factor <= 1', () => {
    const input = Int16Array.from([1, 2, 3]);
    expect(downsample(input, 1)).toBe(input);
  });

  it('drops a trailing partial group', () => {
    const input = Int16Array.from([10, 10, 10, 99]); // 4 samples, factor 3 → 1 output
    expect(Array.from(downsample(input, 3))).toEqual([10]);
  });
});
