import WebSocket from 'ws';
import { downsample } from '@voice/media';
import type { ASRAdapter, ASRSession, ASRSessionOptions, AudioChunk } from '@voice/provider-interfaces';

const TARGET_RATE = 24000; // OpenAI realtime transcription expects pcm16 mono @ 24kHz

export interface OpenAIASRAdapterOptions {
  apiKey: string;
  model?: string;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: unknown;
}

/**
 * Real streaming ASR backed by OpenAI's realtime transcription (GA) over a
 * WebSocket. Auth needs an Authorization header, so this uses the `ws` package
 * (Node's built-in WebSocket can't set headers).
 *
 * Server VAD segments the audio and emits transcription events, mirroring how
 * the Deepgram adapter relies on Deepgram's own endpointing; our session-layer
 * VAD still drives turn-taking. 48kHz mic audio is downsampled to 24kHz.
 */
export class OpenAITranscribeASRAdapter implements ASRAdapter {
  private ws: WebSocket | undefined;
  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private utterance = '';
  private partial = '';
  private sessions = 0;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenAIASRAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4o-mini-transcribe';
  }

  async startSession(_options: ASRSessionOptions): Promise<ASRSession> {
    this.utterance = '';
    this.partial = '';
    // ?intent=transcription puts the realtime socket in transcription mode
    // (a plain connect is rejected with missing_model).
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: TARGET_RATE },
                transcription: { model: this.model },
                turn_detection: { type: 'server_vad', silence_duration_ms: 300 },
              },
            },
          },
        }),
      );
      console.log('[openai-asr] connected');
    });
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(data.toString()));
    ws.on('error', (e: Error) => console.error('[openai-asr] error', e?.message ?? e));
    ws.on('close', (code: number) => console.log(`[openai-asr] closed (${code})`));

    this.sessions += 1;
    return { id: `openai-${this.sessions}` };
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const samples = int16FromChunk(chunk);
    const factor = Math.max(1, Math.round(chunk.sampleRate / TARGET_RATE)); // 48000/24000 = 2
    const ds = downsample(samples, factor);
    const b64 = Buffer.from(ds.buffer, ds.byteOffset, ds.byteLength).toString('base64');
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
  }

  async stopSession(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    this.ws = undefined;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCb = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCb = callback;
  }

  endUtterance(): void {
    this.utterance = '';
    this.partial = '';
  }

  private onMessage(text: string): void {
    let msg: RealtimeEvent;
    try {
      msg = JSON.parse(text) as RealtimeEvent;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'conversation.item.input_audio_transcription.delta':
        this.partial = `${this.partial}${msg.delta ?? ''}`;
        this.partialCb?.(`${this.utterance} ${this.partial}`.trim());
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.partial = '';
        this.utterance = `${this.utterance} ${msg.transcript ?? ''}`.trim();
        if (this.utterance) {
          console.log(`[openai-asr] final: "${this.utterance}"`);
          this.finalCb?.(this.utterance);
        }
        break;
      case 'error':
        console.error('[openai-asr]', JSON.stringify(msg.error ?? msg));
        break;
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
