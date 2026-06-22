# Provider Adapters

> Draft. Interfaces live in `packages/provider-interfaces`.

Each provider sits behind a narrow interface and is selected at runtime by name
(`providers: { asr, tts, model }`). Keys live server-side only.

| Category | Interface | V1 default | Notes |
| --- | --- | --- | --- |
| ASR | `ASRAdapter` | Deepgram | Streaming STT + endpointing signals |
| LLM | `ModelAdapter` | Claude | Streaming, cancellable (barge-in) |
| TTS | `TTSAdapter` | Cartesia | Low-latency streaming, cancellable |
| Realtime (alt.) | `RealtimeSpeechAdapter` | — (post-V1) | GPT-realtime / Gemini Live |

## Cancellation contract

`ModelAdapter.cancel()` and `TTSAdapter.cancel()` must abort in-flight work
promptly — this is the mechanism barge-in relies on. Target barge-in
cancellation latency: ≤ 100 ms.

## Adding a provider

1. Implement the relevant interface in the server.
2. Register it under a name.
3. Select via config. No session-layer changes required.
