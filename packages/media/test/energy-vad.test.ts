import { describe, it, expect } from 'vitest';
import { EnergyVad } from '@voice/media';

/** A frame of constant amplitude — RMS of a constant equals |amp| / 32768. */
function constantFrame(amplitude: number, length = 320): Int16Array {
  return Int16Array.from({ length }, () => amplitude);
}

describe('EnergyVad.rms', () => {
  it('is 0 for silence', () => {
    expect(new EnergyVad().rms(constantFrame(0))).toBe(0);
  });

  it('is 0 for an empty frame', () => {
    expect(new EnergyVad().rms(new Int16Array(0))).toBe(0);
  });

  it('equals |amplitude| / full-scale for a constant frame', () => {
    // 16384 is half of 32768, so RMS should be 0.5.
    expect(new EnergyVad().rms(constantFrame(16384))).toBeCloseTo(0.5, 5);
  });
});

describe('EnergyVad.isSpeech', () => {
  it('treats silence as non-speech', () => {
    expect(new EnergyVad().isSpeech(constantFrame(0))).toBe(false);
  });

  it('treats loud audio as speech', () => {
    // ~0.24 RMS, well above the default 0.02 threshold.
    expect(new EnergyVad().isSpeech(constantFrame(8000))).toBe(true);
  });

  it('treats quiet background below the threshold as non-speech', () => {
    // ~0.009 RMS, below 0.02 — WHY: room noise must not open a turn.
    expect(new EnergyVad().isSpeech(constantFrame(300))).toBe(false);
  });

  it('respects a configured threshold', () => {
    const loud = constantFrame(8000); // ~0.24 RMS
    expect(new EnergyVad({ threshold: 0.5 }).isSpeech(loud)).toBe(false);
    expect(new EnergyVad({ threshold: 0.1 }).isSpeech(loud)).toBe(true);
  });
});
