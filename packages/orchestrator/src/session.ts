import type { EndpointerConfig } from '@voice/session';
import { SessionOrchestrator, type OrchestratorAdapters } from './orchestrator.js';
import type { ServerTransport } from './transport.js';

export interface CreateSessionOptions {
  sessionId: string;
  transport: ServerTransport;
  adapters: OrchestratorAdapters;
  endpointer: EndpointerConfig;
}

/**
 * Bind a transport to a fresh orchestrator: the client's control events, audio,
 * and VAD drive the orchestrator, and the orchestrator's events + audio are sent
 * back over the transport. This is the one place that maps protocol `ClientEvent`s
 * to orchestrator actions.
 */
export function createSession(options: CreateSessionOptions): SessionOrchestrator {
  const orchestrator = new SessionOrchestrator({
    sessionId: options.sessionId,
    adapters: options.adapters,
    endpointer: options.endpointer,
    onEvent: (event) => options.transport.sendEvent(event),
    onAudio: (chunk) => options.transport.sendAudio(chunk),
  });

  options.transport.onClientEvent((event) => {
    switch (event.type) {
      case 'session.start':
        void orchestrator.start();
        break;
      case 'session.stop':
        void orchestrator.stop();
        break;
      case 'agent.interrupt':
        orchestrator.interrupt();
        break;
      default:
        break; // control.mute/unmute, audio.input.* — wired in a later phase
    }
  });
  options.transport.onUserAudio((chunk) => orchestrator.pushUserAudio(chunk));
  options.transport.onUserVad((frame) => orchestrator.pushVad(frame));

  return orchestrator;
}
