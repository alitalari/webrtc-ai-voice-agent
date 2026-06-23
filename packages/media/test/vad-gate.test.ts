import { describe, it, expect } from 'vitest';
import { VadGate } from '@voice/media';

describe('VadGate', () => {
  it('passes continuous speech straight through', () => {
    const g = new VadGate({ hangoverMs: 300 });
    expect(g.step(true, 0)).toBe(true);
    expect(g.step(true, 20)).toBe(true);
    expect(g.step(true, 40)).toBe(true);
  });

  it('bridges a short gap shorter than the hangover', () => {
    const g = new VadGate({ hangoverMs: 300 });
    g.step(true, 0);
    // WHY: a 100ms gap between syllables must NOT read as silence.
    expect(g.step(false, 100)).toBe(true);
    expect(g.step(false, 250)).toBe(true);
  });

  it('reads silence once the gap exceeds the hangover', () => {
    const g = new VadGate({ hangoverMs: 300 });
    g.step(true, 0);
    expect(g.step(false, 200)).toBe(true);
    expect(g.step(false, 320)).toBe(false); // 320ms since last speech > 300
  });

  it('reports silence before any speech', () => {
    expect(new VadGate().step(false, 1000)).toBe(false);
  });

  it('re-opens speech after a gap when audio resumes', () => {
    const g = new VadGate({ hangoverMs: 300 });
    g.step(true, 0);
    expect(g.step(false, 400)).toBe(false);
    expect(g.step(true, 420)).toBe(true);
  });

  it('reset() clears the hangover', () => {
    const g = new VadGate({ hangoverMs: 300 });
    g.step(true, 1000);
    g.reset();
    expect(g.step(false, 1010)).toBe(false); // would have been within hangover
  });
});
