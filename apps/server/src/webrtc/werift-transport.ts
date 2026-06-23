import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket,
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

type ControlMessage =
  | { kind: 'event'; payload: ClientEvent }
  | { kind: 'vad'; payload: VadFrame }
  | { kind: 'config'; payload: unknown };

/**
 * Real WebRTC implementation of the `ServerTransport` seam (werift).
 *
 * Inbound mic: Opus → PCM → energy VAD → turn signals (the user's voice drives
 * turns). Outbound agent: TTS PCM → Opus → a clean owned RTP stream on the
 * return track (no echo relay). werift's sender rewrites SSRC + payload type, so
 * we only supply a monotonic sequence number and timestamp.
 */
export class WeriftServerTransport implements ServerTransport {
  private clientEventCb: ((event: ClientEvent) => void) | undefined;
  private userAudioCb: ((chunk: AudioChunk) => void) | undefined;
  private userVadCb: ((frame: VadFrame) => void) | undefined;
  private control: RTCDataChannel | undefined;

  private readonly decoder = new OpusScript(SAMPLE_RATE, CHANNELS);
  private readonly encoder = new OpusScript(SAMPLE_RATE, CHANNELS);
  private readonly vad: EnergyVad;
  private readonly gate = new VadGate();
  private vadClockMs = 0;
  private lastSpeech = false;

  private outSeq = 0;
  private outTimestamp = 0;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly outgoingAudio: MediaStreamTrack,
    vadThreshold?: number,
  ) {
    this.vad = new EnergyVad({ threshold: vadThreshold });

    pc.onDataChannel.subscribe((channel) => {
      if (channel.label !== 'control') return;
      this.control = channel;
      channel.onMessage.subscribe((data) => this.handleControl(data));
    });

    // Decode inbound audio for VAD only (no echo).
    pc.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe((rtp) => this.detectVad(rtp.payload));
    });
  }

  /** Decode one Opus RTP payload → PCM → energy VAD → a smoothed turn signal. */
  private detectVad(payload: Buffer): void {
    let pcm: Buffer;
    try {
      pcm = this.decoder.decode(payload);
    } catch {
      return; // skip undecodable packets (comfort noise / DTX / partial)
    }
    if (!pcm || pcm.length === 0) return;

    const mono = toMonoInt16(pcm, CHANNELS);
    this.vadClockMs += mono.length / (SAMPLE_RATE / 1000); // 48 samples == 1ms

    const speech = this.gate.step(this.vad.isSpeech(mono), this.vadClockMs);
    if (speech !== this.lastSpeech) {
      this.lastSpeech = speech;
      console.log(`[vad] ${speech ? 'speech ' : 'silence'} @ ${Math.round(this.vadClockMs)}ms`);
    }
    this.userVadCb?.({ speech, timestampMs: this.vadClockMs });

    // Feed speech frames to ASR (fake ASR counts them to drive transcripts).
    if (speech) {
      this.userAudioCb?.({
        data: new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength),
        sampleRate: SAMPLE_RATE,
        timestampMs: this.vadClockMs,
      });
    }
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
    else if (message.kind === 'config') console.log('[config]', JSON.stringify(message.payload));
  }

  sendEvent(event: ServerEvent): void {
    this.control?.send(JSON.stringify({ kind: 'event', payload: event }));
  }

  /** Encode one agent PCM frame to Opus and send it on the return track. */
  sendAudio(chunk: AudioChunk): void {
    const mono = int16FromChunk(chunk);
    if (mono.length === 0) return;

    let opus: Buffer;
    try {
      opus = this.encoder.encode(monoToInterleavedStereo(mono), mono.length);
    } catch {
      return;
    }

    const header = new RtpHeader({
      sequenceNumber: this.outSeq,
      timestamp: this.outTimestamp,
      payloadType: 96, // rewritten by werift's sender to the negotiated PT
      ssrc: 1, // rewritten by werift's sender
      marker: this.outSeq === 0,
    });
    this.outgoingAudio.writeRtp(new RtpPacket(header, opus));

    this.outSeq = (this.outSeq + 1) & 0xffff;
    this.outTimestamp = (this.outTimestamp + mono.length) >>> 0;
  }

  onClientEvent(cb: (event: ClientEvent) => void): void {
    this.clientEventCb = cb;
  }

  onUserAudio(cb: (chunk: AudioChunk) => void): void {
    this.userAudioCb = cb;
  }

  onUserVad(cb: (frame: VadFrame) => void): void {
    this.userVadCb = cb;
  }

  close(): void {
    this.decoder.delete();
    this.encoder.delete();
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

/** Read an AudioChunk's bytes as 16-bit mono samples (alignment-safe). */
function int16FromChunk(chunk: AudioChunk): Int16Array {
  const samples = Math.floor(chunk.data.byteLength / 2);
  const out = new Int16Array(samples);
  const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Duplicate mono samples into an interleaved L/R stereo buffer. */
function monoToInterleavedStereo(mono: Int16Array): Buffer {
  const buf = Buffer.allocUnsafe(mono.length * 4);
  for (let i = 0; i < mono.length; i++) {
    buf.writeInt16LE(mono[i], i * 4);
    buf.writeInt16LE(mono[i], i * 4 + 2);
  }
  return buf;
}

export interface WeriftSession {
  answerSdp: string;
  transport: WeriftServerTransport;
  pc: RTCPeerConnection;
}

/** Build a peer connection from a browser offer and return the answer + transport. */
export async function createWeriftSession(
  offerSdp: string,
  vadThreshold?: number,
): Promise<WeriftSession> {
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

  const transport = new WeriftServerTransport(pc, outgoingAudio, vadThreshold);

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
