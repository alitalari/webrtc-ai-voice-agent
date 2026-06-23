import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  type RTCDataChannel,
} from 'werift';
import OpusScript from 'opusscript';
import { EnergyVad, VadGate } from '@voice/media';
import type { ServerTransport } from '@voice/orchestrator';
import type { ClientEvent, ServerEvent } from '@voice/protocol';
import type { AudioChunk } from '@voice/provider-interfaces';
import type { VadFrame } from '@voice/session';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

/**
 * Control-channel framing over the WebRTC data channel — just enough to
 * multiplex protocol events and (as a fallback) client-supplied VAD on one
 * reliable channel. Distinct from the protocol's wire envelope.
 */
type ControlMessage =
  | { kind: 'event'; payload: ClientEvent }
  | { kind: 'vad'; payload: VadFrame };

/**
 * Real WebRTC implementation of the `ServerTransport` seam (werift).
 *
 * Milestone 2: the inbound mic audio is decoded (Opus → PCM) and run through
 * real energy VAD, so the user's voice — not a button — drives turn-taking. The
 * audio is still echoed back so you can hear yourself. Agent TTS playback onto
 * the return track is the remaining piece (needs PCM→Opus encode).
 */
export class WeriftServerTransport implements ServerTransport {
  private clientEventCb: ((event: ClientEvent) => void) | undefined;
  private userVadCb: ((frame: VadFrame) => void) | undefined;
  private control: RTCDataChannel | undefined;

  private readonly decoder = new OpusScript(SAMPLE_RATE, CHANNELS);
  private readonly vad = new EnergyVad();
  private readonly gate = new VadGate();
  private vadClockMs = 0;
  private lastSpeech = false;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly outgoingAudio: MediaStreamTrack,
  ) {
    pc.onDataChannel.subscribe((channel) => {
      if (channel.label !== 'control') return;
      this.control = channel;
      channel.onMessage.subscribe((data) => this.handleControl(data));
    });

    pc.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe((rtp) => {
        this.outgoingAudio.writeRtp(rtp); // echo, so the user hears themselves
        this.detectVad(rtp.payload);
      });
    });
  }

  /** Decode one Opus RTP payload → PCM → energy VAD → a turn signal. */
  private detectVad(payload: Buffer): void {
    let pcm: Buffer;
    try {
      pcm = this.decoder.decode(payload);
    } catch {
      return; // skip undecodable packets (comfort noise / DTX / partial)
    }
    if (!pcm || pcm.length === 0) return;

    const mono = toMonoInt16(pcm, CHANNELS);
    // 48 samples == 1ms at 48kHz; advance the audio-timeline clock.
    this.vadClockMs += mono.length / (SAMPLE_RATE / 1000);

    const speech = this.gate.step(this.vad.isSpeech(mono), this.vadClockMs);
    if (speech !== this.lastSpeech) {
      this.lastSpeech = speech;
      // Server-terminal readout so VAD activity is visible while tuning.
      console.log(`[vad] ${speech ? 'speech ' : 'silence'} @ ${Math.round(this.vadClockMs)}ms`);
    }
    this.userVadCb?.({ speech, timestampMs: this.vadClockMs });
  }

  private handleControl(data: string | Buffer): void {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    let message: ControlMessage;
    try {
      message = JSON.parse(text) as ControlMessage;
    } catch {
      return;
    }
    if (message.kind === 'event') this.clientEventCb?.(message.payload);
    else if (message.kind === 'vad') this.userVadCb?.(message.payload);
  }

  sendEvent(event: ServerEvent): void {
    this.control?.send(JSON.stringify({ kind: 'event', payload: event }));
  }

  sendAudio(_chunk: AudioChunk): void {
    // Agent TTS audio → outgoing track requires PCM→Opus encode (next milestone).
  }

  onClientEvent(cb: (event: ClientEvent) => void): void {
    this.clientEventCb = cb;
  }

  onUserAudio(_cb: (chunk: AudioChunk) => void): void {
    // Decoded PCM is consumed by VAD here, not forwarded to ASR yet (Phase 3).
  }

  onUserVad(cb: (frame: VadFrame) => void): void {
    this.userVadCb = cb;
  }

  close(): void {
    this.decoder.delete();
    void this.pc.close();
  }
}

/** De-interleave 16-bit PCM and keep the left channel as a mono frame. */
function toMonoInt16(pcm: Buffer, channels: number): Int16Array {
  const frames = Math.floor(pcm.length / 2 / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = pcm.readInt16LE(i * channels * 2);
  }
  return out;
}

export interface WeriftSession {
  answerSdp: string;
  transport: WeriftServerTransport;
  pc: RTCPeerConnection;
}

/** Build a peer connection from a browser offer and return the answer + transport. */
export async function createWeriftSession(offerSdp: string): Promise<WeriftSession> {
  const pc = new RTCPeerConnection({
    codecs: {
      audio: [
        new RTCRtpCodecParameters({
          mimeType: 'audio/opus',
          clockRate: SAMPLE_RATE,
          channels: CHANNELS,
          payloadType: 96,
        }),
      ],
    },
  });

  const outgoingAudio = new MediaStreamTrack({ kind: 'audio' });
  const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  await transceiver.sender.replaceTrack(outgoingAudio);

  const transport = new WeriftServerTransport(pc, outgoingAudio);

  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

  const local = pc.localDescription;
  if (!local) throw new Error('no local description after ICE gathering');
  return { answerSdp: local.sdp, transport, pc };
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    pc.iceGatheringStateChange.subscribe((state) => {
      if (state === 'complete') resolve();
    });
  });
}
