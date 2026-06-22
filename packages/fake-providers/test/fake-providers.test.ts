import { describe, it, expect } from 'vitest';
import { FakeASRAdapter, FakeModelAdapter, FakeTTSAdapter } from '@voice/fake-providers';
import type { AudioChunk } from '@voice/provider-interfaces';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('FakeModelAdapter', () => {
  it('streams the full script when not cancelled', async () => {
    const m = new FakeModelAdapter({ script: ['a', 'b', 'c'] });
    const out = await collect(m.generateResponse({ messages: [] }));
    expect(out.map((o) => o.textDelta)).toEqual(['a', 'b', 'c']);
  });

  it('stops streaming after cancel() — the barge-in contract', async () => {
    const m = new FakeModelAdapter({ script: ['a', 'b', 'c', 'd'] });
    const it = m.generateResponse({ messages: [] })[Symbol.asyncIterator]();

    expect((await it.next()).value).toEqual({ textDelta: 'a' });
    await m.cancel();
    // WHY: once barge-in cancels the model, no further tokens may be produced —
    // otherwise the agent keeps "talking over" the user.
    expect((await it.next()).done).toBe(true);
  });
});

describe('FakeTTSAdapter', () => {
  it('emits exactly chunkCount chunks when run to completion', async () => {
    const t = new FakeTTSAdapter({ chunkCount: 3 });
    const chunks = await collect(t.synthesizeStream({ text: 'hi' }));
    expect(chunks).toHaveLength(3);
    expect(chunks[0].sampleRate).toBe(24000);
  });

  it('stops mid-stream on cancel()', async () => {
    const t = new FakeTTSAdapter({ chunkCount: 5 });
    const it = t.synthesizeStream({ text: 'hi' })[Symbol.asyncIterator]();

    const first = await it.next();
    expect(first.done).toBe(false);
    await t.cancel();
    expect((await it.next()).done).toBe(true);
  });
});

describe('FakeASRAdapter', () => {
  it('invokes partial then final via the test hooks', async () => {
    const a = new FakeASRAdapter();
    const partials: string[] = [];
    const finals: string[] = [];
    a.onPartialTranscript((t) => partials.push(t));
    a.onFinalTranscript((t) => finals.push(t));

    await a.startSession({ sampleRate: 16000 });
    a.emitPartial('hel');
    a.emitFinal('hello');

    expect(partials).toEqual(['hel']);
    expect(finals).toEqual(['hello']);
  });

  it('emits partial/final after the configured number of audio chunks', async () => {
    const a = new FakeASRAdapter({ partialAfter: 1, finalAfter: 2 });
    const events: string[] = [];
    a.onPartialTranscript(() => events.push('partial'));
    a.onFinalTranscript(() => events.push('final'));

    await a.startSession({ sampleRate: 16000 });
    const chunk: AudioChunk = { data: new Uint8Array(2), sampleRate: 16000, timestampMs: 0 };
    await a.sendAudio(chunk);
    await a.sendAudio(chunk);

    expect(events).toEqual(['partial', 'final']);
  });
});
