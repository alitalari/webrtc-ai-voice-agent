/**
 * Raw audio frame passed across provider boundaries. The media engine owns all
 * decode/encode and resampling, so adapters declare the format they expect/emit
 * (see docs/architecture.md → Audio Pipeline & Formats).
 */
export interface AudioChunk {
  /** PCM or encoded payload. */
  data: Uint8Array;
  /** Sample rate in Hz (e.g. 16000 for ASR, 24000 for TTS, 48000 for WebRTC). */
  sampleRate: number;
  /** Monotonic milliseconds from session start. */
  timestampMs: number;
}
