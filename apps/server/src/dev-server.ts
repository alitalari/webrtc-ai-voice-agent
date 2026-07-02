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
import { OpenAIModelAdapter } from './providers/openai-llm.js';
import { GeminiModelAdapter } from './providers/gemini.js';
import { OpenAITranscribeASRAdapter } from './providers/openai-asr.js';
import { ElevenLabsScribeASRAdapter } from './providers/elevenlabs-asr.js';
import { ElevenLabsTTSAdapter } from './providers/elevenlabs-tts.js';
import { OpenAITTSAdapter } from './providers/openai-tts.js';
import type { ASRAdapter, ModelAdapter, TTSAdapter } from '@voice/provider-interfaces';

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

// --- Per-session provider selection ---
// The demo's dropdowns pick a provider per session (sent in the POST /session
// body). A stage goes "real" only if the chosen provider's key is set; else it
// falls back to the fake, so the demo always runs.
function makeAsr(choice: string): ASRAdapter {
  switch (choice) {
    case 'openai':
      if (config.openaiApiKey)
        return new OpenAITranscribeASRAdapter({ apiKey: config.openaiApiKey, model: config.openaiTranscribeModel });
      break;
    case 'elevenlabs':
      if (config.elevenlabsApiKey)
        return new ElevenLabsScribeASRAdapter({ apiKey: config.elevenlabsApiKey, model: config.elevenlabsSttModel });
      break;
    case 'deepgram':
    default:
      if (config.deepgramApiKey) return new DeepgramASRAdapter({ apiKey: config.deepgramApiKey });
  }
  console.log(`[providers] ASR '${choice}' unavailable (no key) — using fake`);
  return new FakeASRAdapter({ repeat: true, partialAfter: 8, finalAfter: 26 });
}

function makeModel(choice: string): ModelAdapter {
  switch (choice) {
    case 'gpt':
      if (config.openaiApiKey)
        return new OpenAIModelAdapter({ apiKey: config.openaiApiKey, model: config.openaiModel });
      break;
    case 'gemini':
      if (config.geminiApiKey)
        return new GeminiModelAdapter({ apiKey: config.geminiApiKey, model: config.geminiModel });
      break;
    case 'claude':
    default:
      if (config.anthropicApiKey)
        return new ClaudeModelAdapter({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
  }
  console.log(`[providers] LLM '${choice}' unavailable (no key) — using fake`);
  return new FakeModelAdapter({ sleep: (i) => delay(i === 0 ? 300 : 20) });
}

function makeTts(choice: string): TTSAdapter {
  switch (choice) {
    case 'elevenlabs':
      if (config.elevenlabsApiKey)
        return new ElevenLabsTTSAdapter({
          apiKey: config.elevenlabsApiKey,
          voiceId: config.elevenlabsVoiceId,
          model: config.elevenlabsTtsModel,
        });
      break;
    case 'openai':
      if (config.openaiApiKey)
        return new OpenAITTSAdapter({
          apiKey: config.openaiApiKey,
          model: config.openaiTtsModel,
          voice: config.openaiTtsVoice,
        });
      break;
    case 'cartesia':
    default:
      if (config.cartesiaApiKey)
        return new CartesiaTTSAdapter({ apiKey: config.cartesiaApiKey, voiceId: config.cartesiaVoiceId });
  }
  console.log(`[providers] TTS '${choice}' unavailable (no key) — using fake`);
  return new FakeTTSAdapter({
    sampleRate: 48000,
    chunkCount: 50,
    sleep: (i) => delay(i === 0 ? 120 : 20), // ~120ms to first audio byte
  });
}

async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as {
    offer: string;
    providers?: { asr?: string; llm?: string; tts?: string };
  };
  const asrChoice = (body.providers?.asr ?? 'deepgram').toLowerCase();
  const llmChoice = (body.providers?.llm ?? 'claude').toLowerCase();
  const ttsChoice = (body.providers?.tts ?? 'cartesia').toLowerCase();
  const sessionId = `s-${++sessionCounter}`;

  const { answerSdp, transport } = await createWeriftSession(body.offer, {
    vadThreshold: config.vadThreshold,
    publicIp: config.publicIp,
    icePortRange: config.icePortRange,
  });

  const asr = makeAsr(asrChoice);
  const model = makeModel(llmChoice);
  const tts = makeTts(ttsChoice);
  if (model instanceof ClaudeModelAdapter || model instanceof OpenAIModelAdapter) void model.warmup();
  console.log(`[providers] session ${sessionId}: asr=${asrChoice} · llm=${llmChoice} · tts=${ttsChoice}`);

  createSession({
    sessionId,
    transport,
    adapters: { asr, model, tts },
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
        if (req.method === 'GET' && req.url === '/status') {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(
            JSON.stringify({
              status: 'ok',
              protocol: PROTOCOL_VERSION,
              providers: {
                asr: [
                  config.deepgramApiKey ? 'deepgram' : null,
                  config.openaiApiKey ? 'openai' : null,
                  config.elevenlabsApiKey ? 'elevenlabs' : null,
                ].filter(Boolean),
                llm: [
                  config.anthropicApiKey ? 'claude' : null,
                  config.openaiApiKey ? 'gpt' : null,
                  config.geminiApiKey ? 'gemini' : null,
                ].filter(Boolean),
                tts: [
                  config.cartesiaApiKey ? 'cartesia' : null,
                  config.elevenlabsApiKey ? 'elevenlabs' : null,
                  config.openaiApiKey ? 'openai' : null,
                ].filter(Boolean),
              },
              uptimeSec: Math.round(process.uptime()),
            }),
          );
        } else if (req.method === 'POST' && req.url === '/session') {
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
    const list = (opts: Array<[boolean, string]>): string =>
      opts
        .filter(([has]) => has)
        .map(([, name]) => name)
        .join(', ') || 'fake only';
    console.log(`@voice/server dev server on http://localhost:${config.port} (protocol v${PROTOCOL_VERSION})`);
    console.log(
      `ASR: ${list([[!!config.deepgramApiKey, 'deepgram'], [!!config.openaiApiKey, 'openai'], [!!config.elevenlabsApiKey, 'elevenlabs']])}`,
    );
    console.log(
      `LLM: ${list([[!!config.anthropicApiKey, 'claude'], [!!config.openaiApiKey, 'gpt'], [!!config.geminiApiKey, 'gemini']])}`,
    );
    console.log(
      `TTS: ${list([[!!config.cartesiaApiKey, 'cartesia'], [!!config.elevenlabsApiKey, 'elevenlabs'], [!!config.openaiApiKey, 'openai']])}`,
    );
  });
}
