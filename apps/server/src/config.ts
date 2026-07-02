import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface ServerConfig {
  port: number;
  anthropicApiKey?: string;
  anthropicModel: string;
  deepgramApiKey?: string;
  cartesiaApiKey?: string;
  cartesiaVoiceId: string;
  // OpenAI — one key drives both GPT (LLM) and streaming transcription (ASR).
  openaiApiKey?: string;
  openaiModel: string;
  openaiTranscribeModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  // Google Gemini (LLM).
  geminiApiKey?: string;
  geminiModel: string;
  // ElevenLabs — one key drives both TTS and Scribe v2 realtime (ASR).
  elevenlabsApiKey?: string;
  elevenlabsVoiceId: string;
  elevenlabsTtsModel: string;
  elevenlabsSttModel: string;
  vadThreshold: number;
  /** Public IP to announce as a WebRTC host candidate (needed off localhost). */
  publicIp?: string;
  /** Fixed UDP range for WebRTC media, so it can be firewalled. */
  icePortRange?: [number, number];
}

/**
 * Load server config from `apps/server/.env` (if present) + the ambient
 * environment. Provider keys are server-side only, never sent to the browser.
 */
export function loadConfig(): ServerConfig {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    process.loadEnvFile(envPath); // Node >= 20.12; no-op if the file is missing
  } catch {
    // No .env file — rely on the ambient environment.
  }

  return {
    port: Number(process.env.PORT ?? 8080),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    // Default to a fast, cheap model for voice latency; override with ANTHROPIC_MODEL
    // (e.g. claude-sonnet-4-6 or claude-opus-4-8) for more capability.
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    cartesiaApiKey: process.env.CARTESIA_API_KEY,
    // A Cartesia voice UUID. Override with CARTESIA_VOICE_ID (pick one from your
    // Cartesia dashboard) if the default isn't available on your account.
    cartesiaVoiceId: process.env.CARTESIA_VOICE_ID ?? 'a0e99841-438c-4a64-b679-ae501e7d6091',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
    openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
    openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    // Rachel — a public premade ElevenLabs voice. Override with ELEVENLABS_VOICE_ID.
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM',
    elevenlabsTtsModel: process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_flash_v2_5',
    elevenlabsSttModel: process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2_realtime',
    // Energy VAD threshold (0..1 RMS). Raise for noisy rooms, lower if your voice
    // isn't detected. Tune via VAD_THRESHOLD.
    vadThreshold: Number(process.env.VAD_THRESHOLD ?? 0.03),
    publicIp: process.env.PUBLIC_IP,
    icePortRange:
      process.env.ICE_UDP_MIN && process.env.ICE_UDP_MAX
        ? [Number(process.env.ICE_UDP_MIN), Number(process.env.ICE_UDP_MAX)]
        : undefined,
  };
}
