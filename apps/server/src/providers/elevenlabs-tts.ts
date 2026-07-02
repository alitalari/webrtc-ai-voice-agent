import WebSocket from 'ws';
import { resampleLinear } from '@voice/media';
import type { AudioChunk, TTSAdapter, TTSInput } from '@voice/provider-interfaces';

const OUTPUT_RATE = 48000; // what the WebRTC Opus encoder expects
const SOURCE_RATE = 24000; // pcm_24000 is allowed on all tiers (44.1k is paid-only); 24k→48k is a clean 2×
const FRAME_SAMPLES = 960; // 20ms @ 48kHz → one Opus frame

export interface ElevenLabsTTSAdapterOptions {
  apiKey: string;
  voiceId: string;
  model?: string;
}

interface ElevenAudioMessage {
  audio?: string; // base64 pcm_44100
  isFinal?: boolean;
  error?: string;
  message?: string;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Real streaming TTS backed by ElevenLabs, over the stream-input WebSocket.
 * ElevenLabs emits 24kHz PCM here (44.1k is paid-tier), so each chunk is
 * resampled to 48kHz, re-framed into exact 20ms frames, and yielded paced at
 * real-time (so
 * the downstream RTP stream isn't bursted). `cancel()` closes the socket for
 * barge-in. Structurally identical to the Cartesia adapter plus the resample.
 */
export class ElevenLabsTTSAdapter implements TTSAdapter {
  private ws: WebSocket | undefined;
  private cancelled = false;
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly model: string;

  constructor(options: ElevenLabsTTSAdapterOptions) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId;
    this.model = options.model ?? 'eleven_flash_v2_5';
  }

  async *synthesizeStream(input: TTSInput): AsyncIterable<AudioChunk> {
    this.cancelled = false;
    const voiceId = input.voiceId ?? this.voiceId;
    const params = new URLSearchParams({ model_id: this.model, output_format: 'pcm_24000' });
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?${params.toString()}`,
      { headers: { 'xi-api-key': this.apiKey } },
    );
    this.ws = ws;

    const frames: Int16Array<ArrayBufferLike>[] = [];
    let residual: Int16Array<ArrayBufferLike> = new Int16Array(0);
    let done = false;

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          text: ' ',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
        }),
      );
      ws.send(JSON.stringify({ text: `${input.text} `, flush: true }));
      ws.send(JSON.stringify({ text: '' })); // EOS
    });
    ws.on('message', (data: WebSocket.RawData) => {
      let msg: ElevenAudioMessage;
      try {
        msg = JSON.parse(data.toString()) as ElevenAudioMessage;
      } catch {
        return;
      }
      if (msg.error) {
        console.error('[elevenlabs-tts]', msg.error ?? msg.message);
        done = true;
        return;
      }
      if (msg.audio) {
        const pcm48 = resampleLinear(pcmFromBase64(msg.audio), SOURCE_RATE, OUTPUT_RATE);
        residual = concat(residual, pcm48);
        while (residual.length >= FRAME_SAMPLES) {
          frames.push(residual.slice(0, FRAME_SAMPLES));
          residual = residual.slice(FRAME_SAMPLES);
        }
      }
      if (msg.isFinal) done = true;
    });
    ws.on('error', () => {
      done = true;
    });
    ws.on('close', () => {
      done = true;
    });

    let ts = 0;
    try {
      while (!this.cancelled) {
        const frame = frames.shift();
        if (frame) {
          yield {
            data: new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
            sampleRate: OUTPUT_RATE,
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

function concat(a: Int16Array<ArrayBufferLike>, b: Int16Array<ArrayBufferLike>): Int16Array<ArrayBufferLike> {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
