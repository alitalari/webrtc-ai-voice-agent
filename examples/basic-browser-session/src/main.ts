import { VoiceSession } from '@voice/web-sdk';

/**
 * Smallest possible consumer of the SDK. Demonstrates construction + the event
 * subscription surface. Becomes runnable once the transport exists (Phase 1).
 */
export async function run(): Promise<void> {
  const session = new VoiceSession({
    signaling: { url: 'wss://api.example.com/v1/sessions', token: 'user-session-token' },
    rtc: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  });

  session.on('transcript.partial', (event) => {
    if (event.type === 'transcript.partial') {
      console.log('Partial:', event.text);
    }
  });

  await session.start();
}
