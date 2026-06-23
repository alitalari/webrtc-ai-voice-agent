/**
 * Energy-based voice activity detection — the simplest real VAD.
 *
 * Per frame: compute RMS amplitude of the 16-bit PCM and compare it to a
 * threshold. That single boolean (is this frame speech?) is all the upstream
 * media engine needs; the `Endpointer` does the smoothing — onset debounce and
 * the silence-to-end-of-turn timing — so this stays a pure, stateless,
 * per-frame decision.
 *
 * Pure DSP: no audio I/O, no clock. A more accurate model (e.g. Silero) can
 * later replace this behind the same `isSpeech` shape.
 */

export interface EnergyVadConfig {
  /** RMS amplitude (0..1 of 16-bit full scale) above which a frame is speech. */
  threshold?: number;
}

export class EnergyVad {
  private readonly threshold: number;

  constructor(config: EnergyVadConfig = {}) {
    this.threshold = config.threshold ?? 0.02;
  }

  /** Root-mean-square amplitude of a 16-bit PCM frame, normalized to 0..1. */
  rms(frame: Int16Array): number {
    if (frame.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i] / 32768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / frame.length);
  }

  /** True if the frame's energy exceeds the configured threshold. */
  isSpeech(frame: Int16Array): boolean {
    return this.rms(frame) > this.threshold;
  }
}
