import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  type RTCDataChannel,
} from 'werift';
import type { ServerTransport } from '@voice/orchestrator';
import type { ClientEvent, ServerEvent } from '@voice/protocol';
import type { AudioChunk } from '@voice/provider-interfaces';
import type { VadFrame } from '@voice/session';

/**
 * Control-channel framing over the WebRTC data channel — just enough to
 * multiplex protocol events and (for now) client-supplied VAD on one reliable
 * channel. Distinct from the protocol's wire envelope.
 */
type ControlMessage =
  | { kind: 'event'; payload: ClientEvent }
  | { kind: 'vad'; payload: VadFrame };

/**
 * Real WebRTC implementation of the `ServerTransport` seam (werift).
 *
 * Milestone 1 (this file): prove the media path. The browser's mic audio is
 * echoed straight back over a return track (RTP relay, no codec needed), and
 * control events flow over the data channel. Real VAD from decoded audio and
 * agent TTS playback land with the Opus codec in the next milestone — until
 * then the client supplies VAD over the control channel and `sendAudio` is a
 * no-op.
 */
export class WeriftServerTransport implements ServerTransport {
  private clientEventCb: ((event: ClientEvent) => void) | undefined;
  private userAudioCb: ((chunk: AudioChunk) => void) | undefined;
  private userVadCb: ((frame: VadFrame) => void) | undefined;
  private control: RTCDataChannel | undefined;

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
      track.onReceiveRtp.subscribe((rtp) => this.outgoingAudio.writeRtp(rtp));
    });
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
    void this.userAudioCb;
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
    void this.pc.close();
  }
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
          clockRate: 48000,
          channels: 2,
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
