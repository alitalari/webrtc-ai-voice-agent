import type { AudioChunk, TTSAdapter, TTSInput } from '@voice/provider-interfaces';

export interface FakeTtsOptions {
  /** Number of audio chunks (frames) to emit for a synthesis. */
  chunkCount?: number;
  /** Sample rate of the generated PCM. */
  sampleRate?: number;
  /** Per-chunk frame duration in ms. */
  frameMs?: number;
  /** Tone frequency in Hz (the "agent voice" placeholder). */
  frequency?: number;
  /** Peak amplitude, 0..1 of full scale. */
  amplitude?: number;
  /** Optional async gap before each chunk (default: a resolved microtask). */
  sleep?: (index: number) => Promise<void>;
}

/**
 * Deterministic, cancellable stand-in for streaming TTS. Emits a continuous sine
 * tone as 16-bit mono PCM frames — real audio (so it can be encoded and heard),
 * just not speech. `cancel()` stops the stream so barge-in can flush playback.
 */
export class FakeTTSAdapter implements TTSAdapter {
  private cancelled = false;
  private readonly chunkCount: number;
  private readonly sampleRate: number;
  private readonly frameMs: number;
  private readonly frequency: number;
  private readonly amplitude: number;
  private readonly sleep: (index: number) => Promise<void>;

  constructor(options: FakeTtsOptions = {}) {
    this.chunkCount = options.chunkCount ?? 5;
    this.sampleRate = options.sampleRate ?? 24000;
    this.frameMs = options.frameMs ?? 20;
    this.frequency = options.frequency ?? 440;
    this.amplitude = options.amplitude ?? 0.25;
    this.sleep = options.sleep ?? (() => Promise.resolve());
  }

  async *synthesizeStream(_input: TTSInput): AsyncIterable<AudioChunk> {
    this.cancelled = false;
    const samplesPerFrame = Math.round((this.sampleRate * this.frameMs) / 1000);
    const peak = Math.round(this.amplitude * 32767);
    let sample = 0; // continuous phase across frames → no clicks

    for (let i = 0; i < this.chunkCount; i++) {
      await this.sleep(i);
      if (this.cancelled) return;

      const pcm = new Int16Array(samplesPerFrame);
      for (let n = 0; n < samplesPerFrame; n++) {
        pcm[n] = Math.round(Math.sin((2 * Math.PI * this.frequency * sample) / this.sampleRate) * peak);
        sample++;
      }

      yield {
        data: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
        sampleRate: this.sampleRate,
        timestampMs: i * this.frameMs,
      };
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}
