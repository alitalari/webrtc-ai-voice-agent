import { downsample } from '@voice/media';
import type {
  ASRAdapter,
  ASRSession,
  ASRSessionOptions,
  AudioChunk,
} from '@voice/provider-interfaces';

const TARGET_RATE = 16000;

export interface DeepgramAdapterOptions {
  apiKey: string;
  model?: string;
}

/** Shape of the Deepgram streaming `Results` message we care about. */
interface DeepgramResults {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

/**
 * Real streaming ASR backed by Deepgram, over a WebSocket. Auth uses Deepgram's
 * key-as-subprotocol (`['token', key]`) so it works with Node's built-in
 * WebSocket (no header support needed, no extra deps).
 *
 * The 48kHz mic audio is downsampled to 16kHz linear16. Interim results are
 * emitted as partials; finalized segments accumulate into the current utterance
 * (reset on `speech_final`) so the session layer reads a full transcript.
 */
export class DeepgramASRAdapter implements ASRAdapter {
  private ws: WebSocket | undefined;
  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private utterance = '';
  private sessions = 0;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: DeepgramAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'nova-2';
  }

  async startSession(_options: ASRSessionOptions): Promise<ASRSession> {
    this.utterance = '';
    const params = new URLSearchParams({
      model: this.model,
      encoding: 'linear16',
      sample_rate: String(TARGET_RATE),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
      'token',
      this.apiKey,
    ]);
    ws.onmessage = (e) => this.onMessage(e);
    ws.onerror = () => console.error('[deepgram] websocket error');
    this.ws = ws;
    this.sessions += 1;
    return { id: `deepgram-${this.sessions}` };
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const samples = int16FromChunk(chunk);
    const factor = Math.max(1, Math.round(chunk.sampleRate / TARGET_RATE));
    this.ws.send(downsample(samples, factor));
  }

  async stopSession(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
    this.ws = undefined;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCb = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCb = callback;
  }

  private onMessage(e: MessageEvent): void {
    if (typeof e.data !== 'string') return;
    let msg: DeepgramResults;
    try {
      msg = JSON.parse(e.data) as DeepgramResults;
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;

    const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
    if (!text) return;

    if (msg.is_final) {
      this.utterance = `${this.utterance} ${text}`.trim();
      this.finalCb?.(this.utterance);
      if (msg.speech_final) this.utterance = ''; // end of utterance → start fresh
    } else {
      this.partialCb?.(`${this.utterance} ${text}`.trim());
    }
  }
}

function int16FromChunk(chunk: AudioChunk): Int16Array {
  const samples = Math.floor(chunk.data.byteLength / 2);
  const out = new Int16Array(samples);
  const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}
