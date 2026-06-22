import type { AudioChunk } from './audio.js';

export interface TTSInput {
  text: string;
  voiceId?: string;
}

/**
 * Streaming text-to-speech. V1 default: Cartesia.
 * `cancel()` must stop synthesis promptly so barge-in can flush queued audio.
 */
export interface TTSAdapter {
  synthesizeStream(input: TTSInput): AsyncIterable<AudioChunk>;
  cancel(): Promise<void>;
}
