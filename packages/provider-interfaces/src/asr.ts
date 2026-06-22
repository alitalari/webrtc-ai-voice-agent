import type { AudioChunk } from './audio.js';

export interface ASRSessionOptions {
  sampleRate: number;
  language?: string;
}

/** Opaque handle to a started ASR stream. */
export interface ASRSession {
  readonly id: string;
}

/**
 * Streaming speech-to-text. V1 implementation: Deepgram.
 * Endpointing signals (utterance end / speech-final) surface via the final
 * transcript callback and are consumed by the session state machine.
 */
export interface ASRAdapter {
  startSession(options: ASRSessionOptions): Promise<ASRSession>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  stopSession(): Promise<void>;
  onPartialTranscript(callback: (text: string) => void): void;
  onFinalTranscript(callback: (text: string) => void): void;
}
