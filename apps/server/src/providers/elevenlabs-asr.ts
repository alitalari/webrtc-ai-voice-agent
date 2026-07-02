import WebSocket from 'ws';
import type { ASRAdapter, ASRSession, ASRSessionOptions, AudioChunk } from '@voice/provider-interfaces';

const SAMPLE_RATE = 48000; // Scribe v2 realtime accepts pcm_48000 — no resample needed

export interface ElevenLabsASRAdapterOptions {
  apiKey: string;
  model?: string;
}

interface ScribeMessage {
  message_type?: string;
  text?: string;
}

/**
 * Real streaming ASR backed by ElevenLabs Scribe v2 realtime, over a WebSocket.
 * VAD-based commit segments the audio and emits partial + committed transcripts,
 * mirroring the Deepgram/OpenAI adapters (our session-layer VAD drives turns).
 *
 * Scribe accepts pcm_48000, so the 48kHz mic audio streams through untouched.
 */
export class ElevenLabsScribeASRAdapter implements ASRAdapter {
  private ws: WebSocket | undefined;
  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private utterance = '';
  private sessions = 0;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: ElevenLabsASRAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'scribe_v2_realtime';
  }

  async startSession(_options: ASRSessionOptions): Promise<ASRSession> {
    this.utterance = '';
    const params = new URLSearchParams({
      model_id: this.model,
      audio_format: 'pcm_48000',
      // Default commit_strategy is 'manual' → only partials, never a final. 'vad'
      // auto-commits on silence; 0.5s is shorter than our 600ms endpoint so the
      // committed (final) transcript lands before the turn closes.
      commit_strategy: 'vad',
      vad_silence_threshold_secs: '0.5',
    });
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`,
      { headers: { 'xi-api-key': this.apiKey } },
    );
    this.ws = ws;

    ws.on('open', () => console.log('[elevenlabs-asr] connected'));
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(data.toString()));
    ws.on('error', (e: Error) => console.error('[elevenlabs-asr] error', e?.message ?? e));
    ws.on('close', (code: number) => console.log(`[elevenlabs-asr] closed (${code})`));

    this.sessions += 1;
    return { id: `elevenlabs-${this.sessions}` };
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const b64 = Buffer.from(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength).toString(
      'base64',
    );
    this.ws.send(
      JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64, sample_rate: SAMPLE_RATE }),
    );
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
  }

  private onMessage(text: string): void {
    let msg: ScribeMessage;
    try {
      msg = JSON.parse(text) as ScribeMessage;
    } catch {
      return;
    }
    const t = msg.text ?? '';
    if (msg.message_type === 'partial_transcript') {
      if (t) this.partialCb?.(`${this.utterance} ${t}`.trim());
    } else if (
      msg.message_type === 'committed_transcript' ||
      msg.message_type === 'committed_transcript_with_timestamps'
    ) {
      this.utterance = `${this.utterance} ${t}`.trim();
      if (this.utterance) {
        console.log(`[elevenlabs-asr] final: "${this.utterance}"`);
        this.finalCb?.(this.utterance);
      }
    }
  }
}
