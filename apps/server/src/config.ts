import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface ServerConfig {
  port: number;
  anthropicApiKey?: string;
  anthropicModel: string;
  deepgramApiKey?: string;
  cartesiaApiKey?: string;
  cartesiaVoiceId: string;
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
  };
}
