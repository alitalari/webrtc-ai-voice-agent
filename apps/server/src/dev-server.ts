import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeASRAdapter, FakeModelAdapter, FakeTTSAdapter } from '@voice/fake-providers';
import { createSession } from '@voice/orchestrator';
import { PROTOCOL_VERSION } from '@voice/protocol';
import { createWeriftSession } from './webrtc/werift-transport.js';
import { loadConfig } from './config.js';
import { ClaudeModelAdapter } from './providers/claude.js';
import { DeepgramASRAdapter } from './providers/deepgram.js';
import { CartesiaTTSAdapter } from './providers/cartesia.js';

const config = loadConfig();

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

let sessionCounter = 0;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { offer } = JSON.parse(await readBody(req)) as { offer: string };
  const sessionId = `s-${++sessionCounter}`;

  const { answerSdp, transport } = await createWeriftSession(offer, config.vadThreshold);

  const model = config.anthropicApiKey
    ? new ClaudeModelAdapter({ apiKey: config.anthropicApiKey, model: config.anthropicModel })
    : new FakeModelAdapter({ sleep: (i) => delay(i === 0 ? 300 : 20) });
  if (model instanceof ClaudeModelAdapter) void model.warmup(); // warm the connection
  // Dev wiring: fake providers, given *realistic* latency so the demo's timing
  // and latency chart feel like a real voice agent (real providers swap in at
  // Phase 3). Real server-side VAD drives turns; fake TTS is a ~1s 48kHz tone
  // paced at 20ms/frame.
  createSession({
    sessionId,
    transport,
    adapters: {
      asr: config.deepgramApiKey
        ? new DeepgramASRAdapter({ apiKey: config.deepgramApiKey })
        : new FakeASRAdapter({ repeat: true, partialAfter: 8, finalAfter: 26 }),
      model,
      tts: config.cartesiaApiKey
        ? new CartesiaTTSAdapter({ apiKey: config.cartesiaApiKey, voiceId: config.cartesiaVoiceId })
        : new FakeTTSAdapter({
            sampleRate: 48000,
            chunkCount: 50,
            sleep: (i) => delay(i === 0 ? 120 : 20), // ~120ms to first audio byte
          }),
    },
    // speechOnsetMs: require sustained speech to open a turn (filters brief noise).
    endpointer: { silenceThresholdMs: 600, speechOnsetMs: 150 },
    onTiming: (t) => {
      const ms = (n: number) => `${Math.round(n)}ms`;
      console.log(
        `[turn] e2e=${ms(t.endToEndMs)} | talk=${ms(t.talkMs)} ` +
          `asr=${t.asrMs === null ? '—' : ms(t.asrMs)} ` +
          `llm_ttft=${ms(t.llmTtftMs)} llm_gen=${ms(t.llmGenMs)} tts=${ms(t.ttsMs)} | "${t.transcript}"`,
      );
    },
  });

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ answer: answerSdp, sessionId }));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url === '/' || !req.url ? '/index.html' : req.url;
  const ext = path.slice(path.lastIndexOf('.'));
  try {
    const file = await readFile(join(publicDir, path));
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store', // dev: always serve fresh index.html / client.js
    });
    res.end(file);
  } catch {
    res.writeHead(404).end('not found');
  }
}

export function startDevServer(): void {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'POST' && req.url === '/session') {
          await handleSession(req, res);
        } else {
          await serveStatic(req, res);
        }
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(err instanceof Error ? err.message : 'error');
      }
    })();
  });

  server.listen(config.port, () => {
    const asr = config.deepgramApiKey ? 'Deepgram' : 'fake';
    const llm = config.anthropicApiKey ? `Claude (${config.anthropicModel})` : 'fake';
    const tts = config.cartesiaApiKey ? 'Cartesia' : 'fake';
    console.log(`@voice/server dev server on http://localhost:${config.port} (protocol v${PROTOCOL_VERSION})`);
    console.log(`providers — ASR: ${asr} · LLM: ${llm} · TTS: ${tts}`);
  });
}
