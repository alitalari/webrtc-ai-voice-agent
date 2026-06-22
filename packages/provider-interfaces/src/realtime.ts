import type { TranscriptEvent, TurnEvent } from '@voice/protocol';
import type { AudioChunk } from './audio.js';

export interface RealtimeOptions {
  sampleRate: number;
  voiceId?: string;
}

/** Opaque handle to a started realtime speech session. */
export interface RealtimeSession {
  readonly id: string;
}

/**
 * Alternative pipeline shape (post-V1): a single vendor (e.g. GPT-realtime,
 * Gemini Live) collapses ASR + LLM + TTS into one duplex audio stream. The
 * session layer treats it as a black box that also emits transcript/turn events,
 * so turn-taking, barge-in, and metrics stay identical to the cascade.
 */
export interface RealtimeSpeechAdapter {
  start(input: RealtimeOptions): Promise<RealtimeSession>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  interrupt(): Promise<void>;
  onAudio(callback: (chunk: AudioChunk) => void): void;
  onTranscript(callback: (event: TranscriptEvent) => void): void;
  onTurnEvent(callback: (event: TurnEvent) => void): void;
}
