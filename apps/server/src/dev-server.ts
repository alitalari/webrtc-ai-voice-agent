import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeASRAdapter, FakeModelAdapter, FakeTTSAdapter } from '@voice/fake-providers';
import { createSession } from '@voice/orchestrator';
import { PROTOCOL_VERSION } from '@voice/protocol';
import { createWeriftSession } from './webrtc/werift-transport.js';

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

  const { answerSdp, transport } = await createWeriftSession(offer);
  // Dev wiring: fake providers. Real server-side VAD drives turns; the fake TTS
  // emits a ~1s 48kHz tone, paced in real time (20ms/frame) so it plays smoothly.
  createSession({
    sessionId,
    transport,
    adapters: {
      asr: new FakeASRAdapter(),
      model: new FakeModelAdapter(),
      tts: new FakeTTSAdapter({
        sampleRate: 48000,
        chunkCount: 50,
        sleep: () => delay(20),
      }),
    },
    endpointer: { silenceThresholdMs: 600 },
  });

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ answer: answerSdp, sessionId }));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url === '/' || !req.url ? '/index.html' : req.url;
  const ext = path.slice(path.lastIndexOf('.'));
  try {
    const file = await readFile(join(publicDir, path));
    res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404).end('not found');
  }
}

export function startDevServer(port = 8080): void {
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

  server.listen(port, () => {
    console.log(`@voice/server dev server on http://localhost:${port} (protocol v${PROTOCOL_VERSION})`);
  });
}
