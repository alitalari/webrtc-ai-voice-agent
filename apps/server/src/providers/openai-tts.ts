import OpenAI from 'openai';
import { resampleLinear } from '@voice/media';
import type { AudioChunk, TTSAdapter, TTSInput } from '@voice/provider-interfaces';

const OUTPUT_RATE = 48000; // what the WebRTC Opus encoder expects
const SOURCE_RATE = 24000; // OpenAI TTS emits pcm @ 24kHz; 24k→48k is a clean 2×
const FRAME_SAMPLES = 960; // 20ms @ 48kHz → one Opus frame

export interface OpenAITTSAdapterOptions {
  apiKey: string;
  model?: string;
  voice?: string;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Real streaming TTS backed by OpenAI (`/v1/audio/speech`, response_format pcm).
 * A background task drains the streamed PCM, resamples 24kHz → 48kHz, and
 * re-frames into 20ms chunks that the generator yields paced at real-time.
 * `cancel()` aborts the request for barge-in. Note: OpenAI TTS has a higher
 * time-to-first-audio than Cartesia/ElevenLabs.
 */
export class OpenAITTSAdapter implements TTSAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly voice: string;
  private controller: AbortController | undefined;
  private cancelled = false;

  constructor(options: OpenAITTSAdapterOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? 'gpt-4o-mini-tts';
    this.voice = options.voice ?? 'alloy';
  }

  async *synthesizeStream(input: TTSInput): AsyncIterable<AudioChunk> {
    this.cancelled = false;
    const controller = new AbortController();
    this.controller = controller;

    const frames: Int16Array<ArrayBufferLike>[] = [];
    let residual: Int16Array<ArrayBufferLike> = new Int16Array(0);
    let done = false;

    // Background: pull the streamed PCM, resample, and buffer 20ms frames.
    void (async () => {
      try {
        const resp = await this.client.audio.speech.create(
          { model: this.model, voice: this.voice, input: input.text, response_format: 'pcm' },
          { signal: controller.signal },
        );
        if (!resp.body) return;
        const body = resp.body as unknown as AsyncIterable<Uint8Array>;
        let byteResidual = Buffer.alloc(0);
        for await (const chunk of body) {
          const buf = Buffer.concat([byteResidual, Buffer.from(chunk)]);
          const usable = buf.length - (buf.length % 2); // keep whole int16 samples
          const pcm48 = resampleLinear(int16FromBuffer(buf.subarray(0, usable)), SOURCE_RATE, OUTPUT_RATE);
          byteResidual = Buffer.from(buf.subarray(usable));
          residual = concat(residual, pcm48);
          while (residual.length >= FRAME_SAMPLES) {
            frames.push(residual.slice(0, FRAME_SAMPLES));
            residual = residual.slice(FRAME_SAMPLES);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error('[openai-tts]', err instanceof Error ? err.message : err);
      } finally {
        done = true;
      }
    })();

    let ts = 0;
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
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.controller?.abort();
  }
}

function int16FromBuffer(buf: Buffer): Int16Array {
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
