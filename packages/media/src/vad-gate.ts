/**
 * Hangover smoothing for a raw per-frame VAD decision.
 *
 * Energy VAD flips to "silence" in the tiny gaps between syllables, which makes
 * the signal chatter even while someone is clearly still talking. The gate holds
 * "speech" for `hangoverMs` after the last speech frame, so short gaps are
 * bridged and only a real pause reads as silence. The `Endpointer` then decides
 * end-of-turn from that clean signal.
 *
 * Pure and deterministic — the frame timestamp is the clock.
 */

export interface VadGateConfig {
  /** Hold 'speech' for this long (ms) after the last speech frame. */
  hangoverMs?: number;
}

export class VadGate {
  private readonly hangoverMs: number;
  private lastSpeechMs = -Infinity;

  constructor(config: VadGateConfig = {}) {
    this.hangoverMs = config.hangoverMs ?? 250;
  }

  /** Smooth a raw per-frame speech flag into a debounced one. */
  step(rawSpeech: boolean, timestampMs: number): boolean {
    if (rawSpeech) {
      this.lastSpeechMs = timestampMs;
      return true;
    }
    return timestampMs - this.lastSpeechMs < this.hangoverMs;
  }

  reset(): void {
    this.lastSpeechMs = -Infinity;
  }
}
