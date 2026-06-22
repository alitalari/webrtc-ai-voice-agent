import type { AudioChunk, TTSAdapter, TTSInput } from '@voice/provider-interfaces';

export interface FakeTtsOptions {
  /** Number of audio chunks to emit for a synthesis. */
  chunkCount?: number;
  /** Sample rate to stamp on chunks (TTS-native; resampled downstream). */
  sampleRate?: number;
  /** Per-chunk frame duration, used only to stamp `timestampMs`. */
  frameMs?: number;
  /** Optional async gap before each chunk (default: a resolved microtask). */
  sleep?: (index: number) => Promise<void>;
}

/**
 * Deterministic, cancellable stand-in for streaming TTS. `cancel()` stops the
 * stream so barge-in can flush queued playback.
 */
export class FakeTTSAdapter implements TTSAdapter {
  private cancelled = false;
  private readonly chunkCount: number;
  private readonly sampleRate: number;
  private readonly frameMs: number;
  private readonly sleep: (index: number) => Promise<void>;

  constructor(options: FakeTtsOptions = {}) {
    this.chunkCount = options.chunkCount ?? 5;
    this.sampleRate = options.sampleRate ?? 24000;
    this.frameMs = options.frameMs ?? 20;
    this.sleep = options.sleep ?? (() => Promise.resolve());
  }

  async *synthesizeStream(_input: TTSInput): AsyncIterable<AudioChunk> {
    this.cancelled = false;
    for (let i = 0; i < this.chunkCount; i++) {
      await this.sleep(i);
      if (this.cancelled) return;
      yield {
        data: new Uint8Array(2), // placeholder PCM frame
        sampleRate: this.sampleRate,
        timestampMs: i * this.frameMs,
      };
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}
