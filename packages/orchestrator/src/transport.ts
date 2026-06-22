import type { AudioChunk } from '@voice/provider-interfaces';
import type { ClientEvent, ServerEvent } from '@voice/protocol';
import type { VadFrame } from '@voice/session';

/**
 * Server-side view of the wire to one client. Real deployments implement this
 * over WebRTC (audio over media tracks, control/events over the data channel);
 * the in-memory loopback below implements it for tests and local dev.
 *
 * `onUserVad` is fed by the media engine, which computes VAD from the inbound
 * audio track — in loopback the client supplies frames directly.
 */
export interface ServerTransport {
  sendEvent(event: ServerEvent): void;
  sendAudio(chunk: AudioChunk): void;
  onClientEvent(cb: (event: ClientEvent) => void): void;
  onUserAudio(cb: (chunk: AudioChunk) => void): void;
  onUserVad(cb: (frame: VadFrame) => void): void;
  close(): void;
}

/** Client-side handle for the in-memory loopback — lets a test play the browser. */
export interface ClientHandle {
  sendEvent(event: ClientEvent): void;
  sendAudio(chunk: AudioChunk): void;
  sendVad(frame: VadFrame): void;
  onServerEvent(cb: (event: ServerEvent) => void): void;
  onAgentAudio(cb: (chunk: AudioChunk) => void): void;
}

/**
 * A pair of connected endpoints in memory: the `server` side plugs into
 * `createSession`; the `client` side stands in for the browser in a test. No
 * network, no serialization — just the same control/audio/VAD surface real
 * WebRTC will carry.
 */
export function createLoopback(): { server: ServerTransport; client: ClientHandle } {
  let onClientEvent: ((event: ClientEvent) => void) | undefined;
  let onUserAudio: ((chunk: AudioChunk) => void) | undefined;
  let onUserVad: ((frame: VadFrame) => void) | undefined;
  let onServerEvent: ((event: ServerEvent) => void) | undefined;
  let onAgentAudio: ((chunk: AudioChunk) => void) | undefined;

  const server: ServerTransport = {
    sendEvent: (event) => onServerEvent?.(event),
    sendAudio: (chunk) => onAgentAudio?.(chunk),
    onClientEvent: (cb) => {
      onClientEvent = cb;
    },
    onUserAudio: (cb) => {
      onUserAudio = cb;
    },
    onUserVad: (cb) => {
      onUserVad = cb;
    },
    close: () => {
      onClientEvent = onUserAudio = onUserVad = undefined;
    },
  };

  const client: ClientHandle = {
    sendEvent: (event) => onClientEvent?.(event),
    sendAudio: (chunk) => onUserAudio?.(chunk),
    sendVad: (frame) => onUserVad?.(frame),
    onServerEvent: (cb) => {
      onServerEvent = cb;
    },
    onAgentAudio: (cb) => {
      onAgentAudio = cb;
    },
  };

  return { server, client };
}
