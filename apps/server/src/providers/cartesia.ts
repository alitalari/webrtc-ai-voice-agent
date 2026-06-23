import type { AudioChunk, TTSAdapter, TTSInput } from '@voice/provider-interfaces';

const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 960; // 20ms @ 48kHz → one Opus frame

export interface CartesiaAdapterOptions {
  apiKey: string;
  voiceId: string;
  model?: string;
  version?: string;
}

interface CartesiaMessage {
  type?: string;
  data?: string; // base64 pcm_s16le
  error?: string;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Real streaming TTS backed by Cartesia, over a WebSocket. Requests raw
 * pcm_s16le at 48kHz (matching the WebRTC Opus encoder, so no resampling). The
 * incoming PCM is re-framed into exact 20ms frames and yielded paced at
 * real-time, so the downstream RTP stream isn't bursted. `cancel()` closes the
 * socket and stops the stream for barge-in.
 */
export class CartesiaTTSAdapter implements TTSAdapter {
  private ws: WebSocket | undefined;
  private cancelled = false;
  private contextSeq = 0;
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly model: string;
  private readonly version: string;

  constructor(options: CartesiaAdapterOptions) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId;
    this.model = options.model ?? 'sonic-2';
    this.version = options.version ?? '2024-11-13';
  }

  async *synthesizeStream(input: TTSInput): AsyncIterable<AudioChunk> {
    this.cancelled = false;
    const params = new URLSearchParams({ api_key: this.apiKey, cartesia_version: this.version });
    const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params.toString()}`);
    this.ws = ws;

    const frames: Int16Array<ArrayBufferLike>[] = [];
    let residual: Int16Array<ArrayBufferLike> = new Int16Array(0);
    let done = false;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          context_id: `ctx-${this.contextSeq++}`,
          model_id: this.model,
          transcript: input.text,
          voice: { mode: 'id', id: input.voiceId ?? this.voiceId },
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
        }),
      );
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: CartesiaMessage;
      try {
        msg = JSON.parse(e.data) as CartesiaMessage;
      } catch {
        return;
      }
      if (msg.type === 'chunk' && msg.data) {
        residual = concat(residual, pcmFromBase64(msg.data));
        while (residual.length >= FRAME_SAMPLES) {
          frames.push(residual.slice(0, FRAME_SAMPLES));
          residual = residual.slice(FRAME_SAMPLES);
        }
      } else if (msg.type === 'done' || msg.type === 'error') {
        if (msg.error) console.error('[cartesia]', msg.error);
        done = true;
      }
    };
    ws.onerror = () => {
      done = true;
    };
    ws.onclose = () => {
      done = true;
    };

    let ts = 0;
    try {
      while (!this.cancelled) {
        const frame = frames.shift();
        if (frame) {
          yield {
            data: new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
            sampleRate: SAMPLE_RATE,
            timestampMs: ts,
          };
          ts += 20;
          await delay(20); // pace at real-time so RTP isn't bursted
        } else if (done) {
          break;
        } else {
          await delay(10); // wait for more audio
        }
      }
    } finally {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

function pcmFromBase64(b64: string): Int16Array {
  const buf = Buffer.from(b64, 'base64');
  const out = new Int16Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

function concat(a: Int16Array, b: Int16Array): Int16Array {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
