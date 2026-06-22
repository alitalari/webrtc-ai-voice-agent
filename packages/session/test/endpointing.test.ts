import { describe, it, expect } from 'vitest';
import { Endpointer, type VadFrame } from '@voice/session';
import type { TurnEvent } from '@voice/protocol';

/** Feed a string of frames ('S' = speech, '.' = silence) at a fixed interval. */
function feed(ep: Endpointer, pattern: string, frameMs = 20, startMs = 0): TurnEvent[] {
  const events: TurnEvent[] = [];
  let t = startMs;
  for (const ch of pattern) {
    const frame: VadFrame = { speech: ch === 'S', timestampMs: t };
    events.push(...ep.push(frame));
    t += frameMs;
  }
  return events;
}

const types = (events: TurnEvent[]): string[] => events.map((e) => e.type);

describe('onset detection', () => {
  it('fires user_speech_started on the first speech frame by default (onsetMs = 0)', () => {
    const ep = new Endpointer({ silenceThresholdMs: 600 });
    expect(types(feed(ep, '...S'))).toEqual(['user_speech_started']);
  });

  it('debounces blips when speechOnsetMs is set — single speech frame is ignored', () => {
    // WHY: a one-frame VAD flicker must not open a turn, or the agent reacts to noise.
    const ep = new Endpointer({ silenceThresholdMs: 600, speechOnsetMs: 60 });
    expect(feed(ep, '.S.')).toEqual([]); // speech for 20ms then gone — discarded
  });

  it('confirms onset only after speech persists past speechOnsetMs', () => {
    const ep = new Endpointer({ silenceThresholdMs: 600, speechOnsetMs: 60 });
    // 20ms frames: onset confirmed once speech has lasted >= 60ms (the 4th S, at t=60).
    expect(types(feed(ep, 'SSSS'))).toEqual(['user_speech_started']);
  });
});

describe('endpoint detection', () => {
  it('does NOT endpoint while silence is shorter than the threshold', () => {
    const ep = new Endpointer({ silenceThresholdMs: 600 });
    // speech, then 200ms of silence (< 600) — ended fires, endpointed does not.
    const ev = types(feed(ep, 'SSSS..........'));
    expect(ev).toContain('user_speech_started');
    expect(ev).toContain('user_speech_ended');
    expect(ev).not.toContain('endpointed');
  });

  it('endpoints once silence reaches the threshold', () => {
    const ep = new Endpointer({ silenceThresholdMs: 100 });
    // 20ms frames: after last speech, silence must reach 100ms → endpointed.
    const ev = types(feed(ep, 'SS............'));
    expect(ev).toEqual(['user_speech_started', 'user_speech_ended', 'endpointed']);
  });

  it('emits exactly one endpointed per turn', () => {
    const ep = new Endpointer({ silenceThresholdMs: 100 });
    const ev = types(feed(ep, 'SS....................'));
    expect(ev.filter((t) => t === 'endpointed')).toHaveLength(1);
  });
});

describe('mid-turn pauses', () => {
  it('a pause shorter than the threshold does not end the turn', () => {
    const ep = new Endpointer({ silenceThresholdMs: 200 });
    // speech, 60ms pause (< 200), more speech, then a real endpoint.
    const ev = types(feed(ep, 'SS...SS..............'));
    // WHY: people pause mid-sentence; endpointing early cuts them off.
    expect(ev.filter((t) => t === 'endpointed')).toHaveLength(1);
    // resumption re-opens speech (a fresh started after the interim ended)
    expect(ev.filter((t) => t === 'user_speech_started')).toHaveLength(2);
  });

  it('silence timer measures from the LAST speech frame, not the first', () => {
    const ep = new Endpointer({ silenceThresholdMs: 100 });
    // long speech then exactly-threshold silence
    const ev = types(feed(ep, 'SSSSSS.....'));
    expect(ev).toContain('endpointed');
  });
});

describe('a full realistic turn', () => {
  it('start → end → endpoint in order', () => {
    const ep = new Endpointer({ silenceThresholdMs: 120 });
    const ev = types(feed(ep, 'SSSSS.......'));
    expect(ev).toEqual(['user_speech_started', 'user_speech_ended', 'endpointed']);
  });

  it('handles two back-to-back turns after reset of the silent phase', () => {
    const ep = new Endpointer({ silenceThresholdMs: 100 });
    const first = types(feed(ep, 'SS......', 20, 0));
    const second = types(feed(ep, 'SS......', 20, 1000));
    expect(first).toEqual(['user_speech_started', 'user_speech_ended', 'endpointed']);
    expect(second).toEqual(['user_speech_started', 'user_speech_ended', 'endpointed']);
  });
});

describe('determinism & reset', () => {
  it('is deterministic — identical frame streams yield identical events', () => {
    const a = types(feed(new Endpointer({ silenceThresholdMs: 100 }), 'SS......'));
    const b = types(feed(new Endpointer({ silenceThresholdMs: 100 }), 'SS......'));
    expect(a).toEqual(b);
  });

  it('reset() returns the engine to the initial silent phase', () => {
    const ep = new Endpointer({ silenceThresholdMs: 100 });
    feed(ep, 'SS'); // mid-turn
    ep.reset();
    // after reset, a fresh speech frame opens a new turn cleanly
    expect(types(feed(ep, 'S', 20, 500))).toEqual(['user_speech_started']);
  });
});
