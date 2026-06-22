# Testing Strategy

Testing is a first-class constraint, not an afterthought. The bar: **heavy unit
coverage on all deterministic logic, plus end-to-end tests on the real voice
loop wherever feasible.** Every test must encode *why* the behavior matters, not
just *what* it does (a test that can't distinguish correct logic from broken
logic is worthless).

## Layers

### 1. Unit (vitest) — the bulk of coverage

Targets the pure, deterministic core. These must be fast, isolated, and
exhaustive:

- **Session state machine** — every transition, including illegal ones. This is
  the single most important testable artifact; it owns turn-taking and barge-in.
- **Event/envelope parsing** — protocol round-trips, version negotiation,
  sequence-number ordering, malformed-input rejection.
- **Endpointing logic** — silence-threshold decisions against synthetic VAD
  timelines (fake clock; no real audio).
- **Barge-in cancellation** — assert in-flight LLM + TTS streams are cancelled
  and queued audio flushed, using fake adapters.
- **Audio framing/resampling** — format conversions against known fixtures.
- **Error mapping** — provider errors → protocol `error` events.

Convention: tests live in `<package>/test/*.test.ts` (excluded from build).
Determinism is mandatory — inject clocks and fake adapters; never sleep on wall
time. Coverage is tracked (`npm run test:coverage`) and gated in CI as the suite
grows.

### 2. Integration

Real adapters against provider sandboxes/mocks; the orchestration path
(ASR → model → TTS) with a fake transport. Verifies streaming, cancellation, and
error propagation across the real adapter boundaries.

### 3. End-to-end (`/e2e`, Phase 1+)

Browser ↔ backend over real WebRTC, driven by a headless browser
(Playwright). Scripted audio in, asserted transcript/audio/metrics out:

- Normal turn completes; transcript + audio + latency metrics emitted.
- **Barge-in**: injected user speech during agent playback cancels the response
  within the latency budget.
- Failure paths: ASR/TTS/model timeout, WebRTC/signaling disconnect + reconnect,
  TURN unavailable, mic-permission denied.

E2E asserts against the **latency budget** (see observability) so performance
regressions fail the build, not just correctness ones.

## Determinism toolkit

- **Fake clock** for all time-based logic (endpointing, timeouts, metrics).
- **Fake adapters** implementing the provider interfaces with scriptable
  output and controllable timing.
- **Scripted audio fixtures** for repeatable e2e runs.

## CI

`npm run build` (typecheck) · `npm run lint` · `npm test` run on every push/PR.
E2E runs added to CI once the Phase 1 harness exists.
