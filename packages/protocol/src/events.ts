/**
 * Control/event messages exchanged over the data channel (or signaling
 * WebSocket before the peer connection is up). Audio itself flows over WebRTC
 * media tracks, not these events.
 *
 * Every server message is wrapped in an envelope carrying the protocol version
 * and a monotonic per-session sequence number, so a reconnect can replay/resume
 * without duplication (see docs/architecture.md → Wire Protocol).
 */

export interface LatencyMetrics {
  /** End of user speech → first partial transcript. */
  timeToFirstPartialMs?: number;
  /** End of user speech → final transcript. */
  timeToFinalTranscriptMs?: number;
  /** Final transcript → first synthesized audio byte. */
  timeToFirstAudioByteMs?: number;
  /** End of user speech → first audio in the user's ear. */
  endToEndTurnMs?: number;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
}

export type TurnEvent =
  | { type: 'user_speech_started' }
  | { type: 'user_speech_ended' }
  | { type: 'endpointed' };

export type ClientEvent =
  | { type: 'session.start'; sessionId: string }
  | { type: 'session.stop'; sessionId: string }
  | { type: 'audio.input.start'; sessionId: string }
  | { type: 'audio.input.stop'; sessionId: string }
  | { type: 'agent.interrupt'; sessionId: string; reason: 'user_speech' | 'manual' }
  | { type: 'control.mute'; sessionId: string }
  | { type: 'control.unmute'; sessionId: string };

export type ServerEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.ended'; sessionId: string }
  | { type: 'transcript.partial'; sessionId: string; text: string }
  | { type: 'transcript.final'; sessionId: string; text: string }
  | { type: 'agent.response.started'; sessionId: string }
  | { type: 'agent.response.audio'; sessionId: string; audioChunkId: string }
  | { type: 'agent.response.completed'; sessionId: string }
  | { type: 'agent.interrupted'; sessionId: string }
  | { type: 'metrics.latency'; sessionId: string; metrics: LatencyMetrics }
  | { type: 'error'; sessionId: string; code: string; message: string };

/** Envelope wrapping every server-to-client message. */
export interface ServerEnvelope {
  protocolVersion: string;
  /** Monotonic, per-session. Enables idempotent replay on reconnect. */
  seq: number;
  event: ServerEvent;
}
