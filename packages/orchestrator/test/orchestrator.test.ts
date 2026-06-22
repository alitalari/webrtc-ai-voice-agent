import { describe, it, expect } from 'vitest';
import { SessionOrchestrator } from '@voice/orchestrator';
import { FakeASRAdapter, FakeModelAdapter, FakeTTSAdapter } from '@voice/fake-providers';
import type { ServerEvent } from '@voice/protocol';
import type { AudioChunk } from '@voice/provider-interfaces';

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

describe('SessionOrchestrator — happy path', () => {
  it('runs a full turn: transcript → agent response → audio → back to listening', async () => {
    const asr = new FakeASRAdapter();
    const model = new FakeModelAdapter({ script: ['Hi', ' there'] });
    const tts = new FakeTTSAdapter({ chunkCount: 3 });
    const events: ServerEvent[] = [];
    const audio: AudioChunk[] = [];

    const orch = new SessionOrchestrator({
      sessionId: 's1',
      adapters: { asr, model, tts },
      endpointer: { silenceThresholdMs: 100 },
      onEvent: (e) => events.push(e),
      onAudio: (a) => audio.push(a),
    });

    await orch.start();
    orch.pushVad({ speech: true, timestampMs: 0 });
    orch.pushVad({ speech: true, timestampMs: 20 });
    asr.emitFinal('hello');
    // silence until the endpoint threshold (>=100ms after last speech at t=20)
    for (let t = 40; t <= 140; t += 20) orch.pushVad({ speech: false, timestampMs: t });

    await orch.whenResponseSettled();

    const types = events.map((e) => e.type);
    expect(types).toContain('session.started');
    expect(types).toContain('transcript.final');
    expect(types).toContain('agent.response.started');
    expect(types).toContain('agent.response.completed');
    expect(audio).toHaveLength(3);
    expect(orch.state).toBe('listening');
  });
});

describe('SessionOrchestrator — latency metrics', () => {
  it('emits metrics.latency on first audio with budget-relevant deltas', async () => {
    // Injected clock returns 10, 20, 30 on successive calls: final transcript at
    // t=10, endpoint at t=20, first audio at t=30. So final→audio = 20, end-to-end
    // (endpoint→audio) = 10. Deterministic, no real time.
    let t = 0;
    const now = () => (t += 10);

    const asr = new FakeASRAdapter();
    const events: ServerEvent[] = [];
    const orch = new SessionOrchestrator({
      sessionId: 's1',
      adapters: {
        asr,
        model: new FakeModelAdapter({ script: ['Hi'] }),
        tts: new FakeTTSAdapter({ chunkCount: 1 }),
      },
      endpointer: { silenceThresholdMs: 100 },
      onEvent: (e) => events.push(e),
      onAudio: () => {},
      now,
    });

    await orch.start();
    orch.pushVad({ speech: true, timestampMs: 0 });
    asr.emitFinal('hello'); // now() #1 → 10
    for (let ts = 20; ts <= 140; ts += 20) orch.pushVad({ speech: false, timestampMs: ts }); // endpoint → now() #2 → 20
    await orch.whenResponseSettled(); // first audio → now() #3 → 30

    const metric = events.find((e) => e.type === 'metrics.latency');
    expect(metric).toBeDefined();
    if (metric?.type === 'metrics.latency') {
      expect(metric.metrics.timeToFirstAudioByteMs).toBe(20);
      expect(metric.metrics.endToEndTurnMs).toBe(10);
    }
  });
});

describe('SessionOrchestrator — barge-in cancellation contract', () => {
  it('user speech during thinking cancels the response and listens to the user', async () => {
    const gate = makeGate();
    const asr = new FakeASRAdapter();
    const model = new FakeModelAdapter({ script: ['Hi'], sleep: () => gate.wait() });
    const tts = new FakeTTSAdapter({ chunkCount: 3 });
    const events: ServerEvent[] = [];

    const orch = new SessionOrchestrator({
      sessionId: 's1',
      adapters: { asr, model, tts },
      endpointer: { silenceThresholdMs: 100 },
      onEvent: (e) => events.push(e),
      onAudio: () => {},
    });

    await orch.start();
    orch.pushVad({ speech: true, timestampMs: 0 });
    asr.emitFinal('hello');
    for (let t = 20; t <= 140; t += 20) orch.pushVad({ speech: false, timestampMs: t });

    // Endpointed → the model is generating, suspended on the gate.
    expect(orch.state).toBe('thinking');

    // User barges in before any audio.
    orch.pushVad({ speech: true, timestampMs: 500 });
    expect(orch.state).toBe('userSpeaking');

    gate.step(); // let the now-cancelled model loop unwind
    await orch.whenResponseSettled();

    const types = events.map((e) => e.type);
    // WHY: the user cut in, so the agent must be reported interrupted and must
    // NOT go on to "complete" a response the user never heard.
    expect(types).toContain('agent.interrupted');
    expect(types).not.toContain('agent.response.completed');
    expect(orch.state).toBe('userSpeaking');
  });

  it('manual interrupt during speaking stops playback and returns to listening', async () => {
    const ttsGate = makeGate();
    const asr = new FakeASRAdapter();
    const model = new FakeModelAdapter({ script: ['Hi'] });
    const tts = new FakeTTSAdapter({ chunkCount: 5, sleep: () => ttsGate.wait() });
    const events: ServerEvent[] = [];
    const audio: AudioChunk[] = [];

    const orch = new SessionOrchestrator({
      sessionId: 's1',
      adapters: { asr, model, tts },
      endpointer: { silenceThresholdMs: 100 },
      onEvent: (e) => events.push(e),
      onAudio: (a) => audio.push(a),
    });

    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    await orch.start();
    orch.pushVad({ speech: true, timestampMs: 0 });
    asr.emitFinal('hello');
    for (let t = 20; t <= 140; t += 20) orch.pushVad({ speech: false, timestampMs: t });

    // Model finishes (ungated); TTS is gated and now parked on its first chunk.
    await flush();
    expect(orch.state).toBe('thinking');

    ttsGate.step(); // release the first TTS chunk → enter speaking
    await flush();
    expect(orch.state).toBe('speaking');

    orch.interrupt();
    expect(orch.state).toBe('listening');

    ttsGate.step(); // unwind the cancelled TTS loop
    await orch.whenResponseSettled();

    const types = events.map((e) => e.type);
    expect(types).toContain('agent.response.started');
    expect(types).toContain('agent.interrupted');
    expect(types).not.toContain('agent.response.completed');
    expect(audio.length).toBeGreaterThanOrEqual(1);
  });
});
