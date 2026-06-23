import { describe, it, expect } from 'vitest';
import {
  transition,
  SessionMachine,
  type SessionState,
  type SessionEvent,
} from '@voice/session';

describe('happy-path turn cycle', () => {
  it('walks idle → listening → userSpeaking → thinking → speaking → listening', () => {
    let r = transition('idle', { type: 'start' });
    expect(r.state).toBe('listening');
    // Capture opens once at session start and stays open for continuous VAD.
    expect(r.effects).toEqual([{ type: 'startCapture' }]);

    r = transition(r.state, { type: 'userSpeechStarted' });
    expect(r.state).toBe('userSpeaking');
    expect(r.effects).toEqual([]);

    r = transition(r.state, { type: 'endpointed' });
    expect(r.state).toBe('thinking');
    expect(r.effects).toEqual([]);

    r = transition(r.state, { type: 'agentResponseStarted' });
    expect(r.state).toBe('speaking');

    r = transition(r.state, { type: 'agentResponseCompleted' });
    expect(r.state).toBe('listening');
    // WHY: a normal turn returns to listening with NO cancel effects — graceful
    // completion must be distinguishable from a barge-in (which DOES cancel).
    expect(r.effects).toEqual([]);
  });
});

describe('barge-in — the property that makes this a real-time system', () => {
  it('user speech during speaking cancels model+TTS, flushes audio, notifies, and listens', () => {
    const r = transition('speaking', { type: 'userSpeechStarted' });
    expect(r.state).toBe('userSpeaking');
    // Exact ordering matters: cancel the producers, flush what's queued, then notify.
    expect(r.effects).toEqual([
      { type: 'cancelModel' },
      { type: 'cancelTts' },
      { type: 'flushPlayback' },
      { type: 'notifyInterrupted' },
    ]);
  });

  it('user speech during thinking (before any audio) also interrupts', () => {
    // WHY: the user can cut in while the LLM is still generating, before TTS starts.
    const r = transition('thinking', { type: 'userSpeechStarted' });
    expect(r.state).toBe('userSpeaking');
    const kinds = r.effects.map((e) => e.type);
    expect(kinds).toContain('cancelModel');
    expect(kinds).toContain('flushPlayback');
    expect(kinds).toContain('notifyInterrupted');
  });

  it('does NOT fire from listening — userSpeechStarted starts a turn, not a barge-in', () => {
    const r = transition('listening', { type: 'userSpeechStarted' });
    expect(r.state).toBe('userSpeaking');
    // No agent was active, so there is nothing to cancel.
    expect(r.effects).toEqual([]);
  });

  it('does NOT double-fire — userSpeechStarted while already userSpeaking is a no-op', () => {
    const r = transition('userSpeaking', { type: 'userSpeechStarted' });
    expect(r.changed).toBe(false);
    expect(r.effects).toEqual([]);
  });
});

describe('manual interrupt', () => {
  it('from speaking cancels and returns to listening (the user did not necessarily speak)', () => {
    const r = transition('speaking', { type: 'manualInterrupt' });
    expect(r.state).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'cancelModel' });
    expect(r.effects).toContainEqual({ type: 'notifyInterrupted' });
  });

  it('from thinking cancels and returns to listening', () => {
    const r = transition('thinking', { type: 'manualInterrupt' });
    expect(r.state).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'cancelTts' });
  });

  it('while listening is a no-op — no spurious cancels or interrupt notice', () => {
    // WHY: emitting cancel/notify effects when no agent turn is active would send a
    // phantom interruption and cancel nothing — a classic broken-logic bug a weaker
    // test (only checking state) would miss.
    const r = transition('listening', { type: 'manualInterrupt' });
    expect(r.changed).toBe(false);
    expect(r.state).toBe('listening');
    expect(r.effects).toEqual([]);
  });
});

describe('stop tears the session down', () => {
  it('from listening stops capture', () => {
    const r = transition('listening', { type: 'stop' });
    expect(r.state).toBe('ended');
    expect(r.effects).toEqual([{ type: 'stopCapture' }]);
  });

  it('from speaking stops capture AND cancels in-flight work — but does not notify interrupt', () => {
    const r = transition('speaking', { type: 'stop' });
    expect(r.state).toBe('ended');
    expect(r.effects).toEqual([
      { type: 'stopCapture' },
      { type: 'cancelModel' },
      { type: 'cancelTts' },
      { type: 'flushPlayback' },
    ]);
    // WHY: ending mid-turn must cancel work, but it is NOT a user interruption —
    // emitting notifyInterrupted here would surface a bogus "agent interrupted" event.
    expect(r.effects).not.toContainEqual({ type: 'notifyInterrupted' });
  });

  it('from idle ends cleanly with no effects (nothing was started)', () => {
    const r = transition('idle', { type: 'stop' });
    expect(r.state).toBe('ended');
    expect(r.effects).toEqual([]);
  });
});

describe('inapplicable events are ignored (real-time races, not crashes)', () => {
  it('agentResponseCompleted while listening is a no-op', () => {
    const r = transition('listening', { type: 'agentResponseCompleted' });
    expect(r.changed).toBe(false);
    expect(r.state).toBe('listening');
    expect(r.effects).toEqual([]);
  });

  it('endpointed while idle is a no-op', () => {
    expect(transition('idle', { type: 'endpointed' }).changed).toBe(false);
  });

  it('agentResponseStarted while already speaking is a no-op', () => {
    expect(transition('speaking', { type: 'agentResponseStarted' }).changed).toBe(false);
  });
});

describe('empty / failed response recovery', () => {
  it('thinking + agentResponseCompleted returns to listening with no effects', () => {
    // WHY: if a turn produced no transcript or the provider errored, the session
    // must not get stuck in `thinking` — it recovers straight to listening.
    const r = transition('thinking', { type: 'agentResponseCompleted' });
    expect(r.state).toBe('listening');
    expect(r.effects).toEqual([]);
  });
});

describe('ended is terminal — nothing resurrects a dead session', () => {
  const events: SessionEvent[] = [
    { type: 'start' },
    { type: 'userSpeechStarted' },
    { type: 'endpointed' },
    { type: 'agentResponseStarted' },
    { type: 'agentResponseCompleted' },
    { type: 'manualInterrupt' },
    { type: 'stop' },
  ];

  it.each(events)('ignores %j after ended', (event) => {
    const r = transition('ended', event);
    expect(r.changed).toBe(false);
    expect(r.state).toBe('ended');
    expect(r.effects).toEqual([]);
  });
});

describe('purity / determinism', () => {
  it('does not mutate inputs and is referentially stable', () => {
    const state: SessionState = 'speaking';
    const event: SessionEvent = { type: 'userSpeechStarted' };

    const a = transition(state, event);
    const b = transition(state, event);

    // Same input → same output: required for deterministic tests and event replay
    // on reconnect (see the protocol envelope's monotonic seq).
    expect(a).toEqual(b);
    expect(state).toBe('speaking'); // input untouched

    // Returned effect arrays are independent instances — mutating one cannot leak.
    a.effects.push({ type: 'stopCapture' });
    expect(b.effects).not.toContainEqual({ type: 'stopCapture' });
  });
});

describe('SessionMachine wrapper', () => {
  it('advances state across a full barge-in scenario', () => {
    const m = new SessionMachine();
    expect(m.state).toBe('idle');

    expect(m.dispatch({ type: 'start' })).toEqual([{ type: 'startCapture' }]);
    expect(m.state).toBe('listening');

    m.dispatch({ type: 'userSpeechStarted' });
    m.dispatch({ type: 'endpointed' });
    m.dispatch({ type: 'agentResponseStarted' });
    expect(m.state).toBe('speaking');

    const effects = m.dispatch({ type: 'userSpeechStarted' }); // barge-in
    expect(m.state).toBe('userSpeaking');
    expect(effects).toContainEqual({ type: 'notifyInterrupted' });
  });

  it('a no-op dispatch leaves state unchanged and returns no effects', () => {
    const m = new SessionMachine('listening');
    expect(m.dispatch({ type: 'agentResponseCompleted' })).toEqual([]);
    expect(m.state).toBe('listening');
  });
});
