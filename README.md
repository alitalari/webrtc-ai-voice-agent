# AI Voice SDK

A vendor-neutral SDK for building real-time AI voice sessions with WebRTC, interruption handling, and pluggable ASR/TTS/model providers.

> Status: **Phase 0 — scaffold**. APIs are stubs; transport lands in Phase 1. See [`ai_voice_sdk_plan.md`](./ai_voice_sdk_plan.md).

## Why This Exists

Real-time AI voice products need more than ASR + LLM + TTS. They need session control, interruption handling, latency visibility, reconnect behavior, and clean client SDKs. This project owns that **session layer**.

## Monorepo Layout

```text
apps/
  web-demo/                 Browser demo app
  server/                   Reference backend (control plane + media engine)
packages/
  web-sdk/                  Public TypeScript SDK (VoiceSession)
  protocol/                 Wire protocol — source of truth for shared types
  provider-interfaces/      ASR / TTS / Model / Realtime adapter contracts
docs/                       Architecture, RTC, providers, deployment, testing, observability
infra/                      docker-compose + coturn (TURN) for the hosted demo
examples/                   Minimal SDK consumers
e2e/                        End-to-end tests (Phase 1+)
```

## Default Providers (V1, all swappable)

| Category | Default  |
| -------- | -------- |
| ASR      | Deepgram |
| TTS      | Cartesia |
| LLM      | Claude   |

## Develop

Requires Node >= 20. Uses npm workspaces.

```bash
npm install        # install + link workspaces
npm run build      # tsc -b across all packages (also typechecks)
npm run lint       # eslint
npm test           # vitest (unit/integration)
npm run test:coverage
```

## Documentation

- [Architecture](./docs/architecture.md)
- [RTC / STUN / TURN](./docs/rtc.md)
- [Provider adapters](./docs/providers.md)
- [Deployment](./docs/deployment.md)
- [Testing strategy](./docs/testing.md)
- [Observability](./docs/observability.md)

## Roadmap

Android SDK · iOS SDK · hosted STUN/TURN · hosted session orchestration · provider marketplace.

## License

Open-core: Apache 2.0 for SDK / protocol / reference backend; managed control plane is the commercial layer.
