/**
 * VoiceSession configuration shape — the public contract for constructing a
 * session. Mirrors the JSON configuration in the plan. Provider/key selection
 * is by name only; secrets never leave the server.
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SignalingConfig {
  /** WebSocket/HTTPS endpoint that issues sessions. */
  url: string;
  /** Short-lived session token. Never a raw provider key. */
  token: string;
}

export interface RtcConfig {
  iceServers: IceServerConfig[];
  iceTransportPolicy?: 'all' | 'relay';
}

export interface MediaConfig {
  preferredCodec?: 'opus';
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface SessionOptions {
  bargeIn?: boolean;
  vad?: boolean;
  maxSessionDurationSeconds?: number;
  latencyMetrics?: boolean;
}

/** Provider selection by registered name (e.g. "deepgram", "cartesia", "claude"). */
export interface ProvidersConfig {
  asr?: string;
  tts?: string;
  model?: string;
}

export interface VoiceSessionConfig {
  signaling: SignalingConfig;
  rtc: RtcConfig;
  media?: MediaConfig;
  session?: SessionOptions;
  providers?: ProvidersConfig;
}
