import { VoiceSession } from '@voice/web-sdk';

/**
 * Phase 0 placeholder. The real demo (Vite UI, transcript display, latency
 * panel, debug panel) is built in Phase 1+. Kept compiling so the SDK's public
 * surface is exercised from a consumer's perspective from day one.
 */
export function createDemoSession(): VoiceSession {
  return new VoiceSession({
    signaling: { url: 'wss://localhost:8080/v1/sessions', token: 'dev-token' },
    rtc: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    session: { bargeIn: true, vad: true, latencyMetrics: true },
    providers: { asr: 'deepgram', tts: 'cartesia', model: 'claude' },
  });
}
