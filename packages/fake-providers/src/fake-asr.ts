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
  /** Live-demo mode: emit repeatedly (every Nth chunk), cycling phrases. */
  repeat?: boolean;
  phrases?: string[];
}

/**
 * Deterministic stand-in for streaming ASR. In default mode transcripts fire
 * once at fixed chunk counts (used by unit tests). In `repeat` mode it cycles a
 * set of canned phrases every Nth chunk — enough to make the demo transcript
 * look alive until real ASR lands.
 */
export class FakeASRAdapter implements ASRAdapter {
  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private chunks = 0;
  private sessions = 0;
  private phraseIdx = 0;
  private readonly opts: Required<FakeAsrOptions>;

  constructor(options: FakeAsrOptions = {}) {
    this.opts = {
      partialAfter: options.partialAfter ?? 2,
      finalAfter: options.finalAfter ?? 4,
      partialText: options.partialText ?? 'hello',
      finalText: options.finalText ?? 'hello there',
      repeat: options.repeat ?? false,
      phrases: options.phrases ?? [
        'hello',
        'how are you',
        'what can you do',
        'tell me a joke',
        'thanks',
      ],
    };
  }

  async startSession(_options: ASRSessionOptions): Promise<ASRSession> {
    this.chunks = 0;
    this.sessions += 1;
    return { id: `fake-asr-${this.sessions}` };
  }

  async sendAudio(_chunk: AudioChunk): Promise<void> {
    this.chunks += 1;
    if (this.opts.repeat) {
      if (this.chunks % this.opts.partialAfter === 0) this.emitPartial(this.currentPhrase());
      if (this.chunks % this.opts.finalAfter === 0) {
        this.emitFinal(this.currentPhrase());
        this.phraseIdx += 1;
      }
    } else {
      if (this.chunks === this.opts.partialAfter) this.emitPartial();
      if (this.chunks === this.opts.finalAfter) this.emitFinal();
    }
  }

  async stopSession(): Promise<void> {
    this.chunks = 0;
  }

  endUtterance(): void {
    this.chunks = 0; // restart counting for the next turn
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

  private currentPhrase(): string {
    return this.opts.phrases[this.phraseIdx % this.opts.phrases.length];
  }
}
