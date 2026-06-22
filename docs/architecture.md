# Architecture

> Draft. The authoritative narrative lives in [`../ai_voice_sdk_plan.md`](../ai_voice_sdk_plan.md); this file is the engineering-facing summary.

## Components

```text
Browser (web-sdk)  --WebRTC media-->  Reference Backend  --adapters-->  Providers
                   --WS/HTTPS signal->   ├─ control plane              ├─ ASR (Deepgram)
                                         └─ media engine (isolated)    ├─ LLM (Claude)
                                                                       └─ TTS (Cartesia)
```

- **Control plane** (TypeScript/Node): signaling, auth/session tokens, orchestration, metrics.
- **Media engine** (TypeScript/Node, isolated boundary): WebRTC endpoint, Opus decode/encode, VAD, audio framing. Replaceable with Go+Pion later without touching the protocol or SDK.

## Pipeline

Default: cascade `ASR → LLM → TTS`. Alternative (post-V1): `RealtimeSpeechAdapter` collapsing all three into one vendor session. The session layer (turn state, barge-in, metrics, reconnect) is identical for both.

## Wire Protocol

Source of truth: `packages/protocol`. Versioned, negotiated on connect. Transport split:

- **Media**: WebRTC tracks (Opus).
- **Control + events**: WebRTC data channel (ordered, reliable); WebSocket fallback pre-connection.
- **Signaling**: HTTPS + WebSocket.

Server messages are wrapped in an envelope (`protocolVersion`, monotonic `seq`) for idempotent replay on reconnect.

## Audio Pipeline & Formats

| Hop | Format |
| --- | --- |
| Browser mic → WebRTC | Opus, 48 kHz |
| Media engine → ASR | linear16 PCM, 16 kHz mono |
| TTS → media engine | PCM, 24 kHz → resampled to 48 kHz Opus |

The media engine owns all decode/encode/resampling; no other component touches raw audio.
