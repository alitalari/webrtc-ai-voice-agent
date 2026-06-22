import { describe, it, expect } from 'vitest';
import { createLoopback, createSession } from '@voice/orchestrator';
import { FakeASRAdapter, FakeModelAdapter, FakeTTSAdapter } from '@voice/fake-providers';
import type { ServerEvent } from '@voice/protocol';
import type { AudioChunk } from '@voice/provider-interfaces';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A manual gate: each `wait()` blocks until the test calls `step()`. */
function makeGate() {
  let release!: () => void;
  let current = new Promise<void>((r) => (release = r));
  return {
    wait: () => current,
    step: () => {
      const r = release;
      current = new Promise<void>((res) => (release = res));
      r();
    },
  };
}

describe('end-to-end over the loopback transport', () => {
  it('a full turn round-trips: client drives, server events + audio come back', async () => {
    const { server, client } = createLoopback();
    const asr = new FakeASRAdapter();
    const orch = createSession({
      sessionId: 's1',
      transport: server,
      adapters: {
        asr,
        model: new FakeModelAdapter({ script: ['Hi'] }),
        tts: new FakeTTSAdapter({ chunkCount: 2 }),
      },
      endpointer: { silenceThresholdMs: 100 },
    });

    const events: ServerEvent[] = [];
    const audio: AudioChunk[] = [];
    client.onServerEvent((e) => events.push(e));
    client.onAgentAudio((c) => audio.push(c));

    client.sendEvent({ type: 'session.start', sessionId: 's1' });
    await flush(); // start() awaits asr.startSession
    client.sendVad({ speech: true, timestampMs: 0 });
    asr.emitFinal('hello');
    for (let t = 20; t <= 140; t += 20) client.sendVad({ speech: false, timestampMs: t });
    await orch.whenResponseSettled();

    const types = events.map((e) => e.type);
    expect(types).toContain('session.started');
    expect(types).toContain('transcript.final');
    expect(types).toContain('agent.response.completed');
    expect(audio).toHaveLength(2);
    expect(orch.state).toBe('listening');
  });

  it('a manual interrupt over the control channel cancels the response', async () => {
    const { server, client } = createLoopback();
    const gate = makeGate();
    const asr = new FakeASRAdapter();
    const orch = createSession({
      sessionId: 's1',
      transport: server,
      adapters: {
        asr,
        model: new FakeModelAdapter({ script: ['Hi'], sleep: () => gate.wait() }),
        tts: new FakeTTSAdapter(),
      },
      endpointer: { silenceThresholdMs: 100 },
    });

    const events: ServerEvent[] = [];
    client.onServerEvent((e) => events.push(e));

    client.sendEvent({ type: 'session.start', sessionId: 's1' });
    await flush();
    client.sendVad({ speech: true, timestampMs: 0 });
    asr.emitFinal('hello');
    for (let t = 20; t <= 140; t += 20) client.sendVad({ speech: false, timestampMs: t });
    expect(orch.state).toBe('thinking');

    client.sendEvent({ type: 'agent.interrupt', sessionId: 's1', reason: 'manual' });
    expect(orch.state).toBe('listening');

    gate.step();
    await orch.whenResponseSettled();

    const types = events.map((e) => e.type);
    expect(types).toContain('agent.interrupted');
    expect(types).not.toContain('agent.response.completed');
  });
});
