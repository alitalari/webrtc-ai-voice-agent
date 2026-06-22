import type { ServerEvent, VoiceSessionConfig } from '@voice/protocol';

/** Event names a consumer can subscribe to (derived from the protocol). */
export type VoiceSessionEventType = ServerEvent['type'];

export type VoiceSessionListener = (event: ServerEvent) => void;

/**
 * Public SDK entry point.
 *
 * Phase 0 deliverable: the API surface only. Transport (WebRTC + signaling),
 * the session state machine, and barge-in land in Phase 1/2. Methods throw
 * until then so callers fail loudly rather than silently no-op.
 */
export class VoiceSession {
  constructor(public readonly config: VoiceSessionConfig) {}

  /** Subscribe to a server event. Returns `this` for chaining. */
  on(_event: VoiceSessionEventType, _listener: VoiceSessionListener): this {
    throw new Error('VoiceSession.on is not implemented yet (Phase 1).');
  }

  /** Start capturing audio and connect the session. */
  async start(): Promise<void> {
    throw new Error('VoiceSession.start is not implemented yet (Phase 1).');
  }

  /** Stop the session and release the microphone. */
  async stop(): Promise<void> {
    throw new Error('VoiceSession.stop is not implemented yet (Phase 1).');
  }
}
