/**
 * Session state machine — the turn-taking + barge-in core.
 *
 * Pure and transport-agnostic: `transition` is a function of (state, event) with
 * no I/O, no clock, and no provider calls. This is the single most important
 * testable artifact in the system (see docs/testing.md) — every transition,
 * including illegal ones, is unit-tested in isolation.
 *
 * `Effect`s are the imperative one-shot commands the orchestrator must execute
 * (cancel an in-flight model/TTS stream, flush queued audio, toggle capture).
 * The *state* drives everything else — the orchestrator reacts to the state; the
 * machine never performs the work itself.
 */

export type SessionState =
  | 'idle' // session not started (or ended is the terminal twin)
  | 'listening' // mic open, waiting for user speech
  | 'userSpeaking' // VAD detected user speech, capturing the turn
  | 'thinking' // user turn endpointed; LLM generating
  | 'speaking' // agent audio playing back
  | 'ended'; // terminal

export type SessionEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'userSpeechStarted' } // VAD speech onset
  | { type: 'endpointed' } // end-of-turn detected (user finished)
  | { type: 'agentResponseStarted' } // TTS first audio byte
  | { type: 'agentResponseCompleted' } // agent finished speaking
  | { type: 'manualInterrupt' }; // user pressed "stop"

export type SessionEffect =
  | { type: 'startCapture' }
  | { type: 'stopCapture' }
  | { type: 'cancelModel' }
  | { type: 'cancelTts' }
  | { type: 'flushPlayback' }
  | { type: 'notifyInterrupted' };

export interface TransitionResult {
  state: SessionState;
  effects: SessionEffect[];
  /** False when the event did not apply in the current state (a no-op). */
  changed: boolean;
}

/** Cancel an in-flight agent turn. Cancels are idempotent — safe to emit even if
 *  the model finished or TTS never started. Fresh array each call (no shared state). */
const cancelEffects = (): SessionEffect[] => [
  { type: 'cancelModel' },
  { type: 'cancelTts' },
  { type: 'flushPlayback' },
];

/** Barge-in / manual interrupt: cancel the turn AND tell the client it was interrupted. */
const interruptEffects = (): SessionEffect[] => [
  ...cancelEffects(),
  { type: 'notifyInterrupted' },
];

const applied = (state: SessionState, effects: SessionEffect[]): TransitionResult => ({
  state,
  effects,
  changed: true,
});

/**
 * Pure transition function.
 *
 * Inapplicable events are ignored (returned as a no-op with `changed: false`)
 * rather than thrown — a real-time event stream legitimately delivers
 * out-of-order/racing events (e.g. `agentResponseCompleted` arriving just after a
 * barge-in already moved to `userSpeaking`), and crashing the session on those
 * would be wrong. Genuine logic bugs are caught by tests asserting the exact
 * (state, effects) pair for every transition.
 */
export function transition(state: SessionState, event: SessionEvent): TransitionResult {
  switch (state) {
    case 'idle':
      if (event.type === 'start') return applied('listening', [{ type: 'startCapture' }]);
      if (event.type === 'stop') return applied('ended', []); // nothing started yet
      break;

    case 'listening':
      if (event.type === 'userSpeechStarted') return applied('userSpeaking', []);
      if (event.type === 'stop') return applied('ended', [{ type: 'stopCapture' }]);
      break;

    case 'userSpeaking':
      if (event.type === 'endpointed') return applied('thinking', []);
      if (event.type === 'stop') return applied('ended', [{ type: 'stopCapture' }]);
      break;

    case 'thinking':
      if (event.type === 'agentResponseStarted') return applied('speaking', []);
      // Barge-in before audio even started — the user is now speaking.
      if (event.type === 'userSpeechStarted')
        return applied('userSpeaking', interruptEffects());
      if (event.type === 'manualInterrupt') return applied('listening', interruptEffects());
      if (event.type === 'stop')
        return applied('ended', [{ type: 'stopCapture' }, ...cancelEffects()]);
      break;

    case 'speaking':
      if (event.type === 'agentResponseCompleted') return applied('listening', []);
      // Barge-in during playback — cancel, flush, and listen to the new utterance.
      if (event.type === 'userSpeechStarted')
        return applied('userSpeaking', interruptEffects());
      if (event.type === 'manualInterrupt') return applied('listening', interruptEffects());
      if (event.type === 'stop')
        return applied('ended', [{ type: 'stopCapture' }, ...cancelEffects()]);
      break;

    case 'ended':
      break; // terminal — nothing resurrects a dead session
  }
  return { state, effects: [], changed: false };
}

/**
 * Thin stateful wrapper for orchestrator ergonomics. The pure `transition`
 * function remains the source of truth and is what the tests exercise directly.
 */
export class SessionMachine {
  private current: SessionState;

  constructor(initial: SessionState = 'idle') {
    this.current = initial;
  }

  get state(): SessionState {
    return this.current;
  }

  /** Apply an event; advance the state and return the effects to execute. */
  dispatch(event: SessionEvent): SessionEffect[] {
    const result = transition(this.current, event);
    this.current = result.state;
    return result.effects;
  }
}
