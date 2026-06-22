import type {
  ASRAdapter,
  ASRSession,
  ASRSessionOptions,
  AudioChunk,
} from '@voice/provider-interfaces';

export interface FakeAsrOptions {
  /** Emit a partial transcript after this many audio chunks. */
  partialAfter?: number;
  /** Emit a final transcript after this many audio chunks. */
  finalAfter?: number;
  partialText?: string;
  finalText?: string;
}

/**
 * Deterministic stand-in for streaming ASR. Transcripts fire either after a
 * fixed number of audio chunks (so the loop runs end-to-end) or on demand via
 * the `emitPartial` / `emitFinal` hooks (so orchestrator tests stay readable).
 */
export class FakeASRAdapter implements ASRAdapter {
  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private chunks = 0;
  private sessions = 0;
  private readonly opts: Required<FakeAsrOptions>;

  constructor(options: FakeAsrOptions = {}) {
    this.opts = {
      partialAfter: options.partialAfter ?? 2,
      finalAfter: options.finalAfter ?? 4,
      partialText: options.partialText ?? 'hello',
      finalText: options.finalText ?? 'hello there',
    };
  }

  async startSession(_options: ASRSessionOptions): Promise<ASRSession> {
    this.chunks = 0;
    this.sessions += 1;
    return { id: `fake-asr-${this.sessions}` };
  }

  async sendAudio(_chunk: AudioChunk): Promise<void> {
    this.chunks += 1;
    if (this.chunks === this.opts.partialAfter) this.emitPartial();
    if (this.chunks === this.opts.finalAfter) this.emitFinal();
  }

  async stopSession(): Promise<void> {
    this.chunks = 0;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCb = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCb = callback;
  }

  /** Emit a partial transcript immediately (test/orchestration hook). */
  emitPartial(text = this.opts.partialText): void {
    this.partialCb?.(text);
  }

  /** Emit a final transcript immediately (test/orchestration hook). */
  emitFinal(text = this.opts.finalText): void {
    this.finalCb?.(text);
  }
}
