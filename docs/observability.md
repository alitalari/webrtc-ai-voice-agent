# Observability

Visibility is a design constraint at **every stage**, not a Phase 4 add-on.
"Make the invisible parts visible" is a core differentiator of this project, and
the same signals that make the demo impressive are what make the system
debuggable and testable.

## Principles

- **Instrument as you build.** Every component emits its timings/states from the
  first commit, even before there's a dashboard to show them.
- **One latency budget, measured everywhere.** Targets (P50) below; every
  segment is timestamped so a regression in any one is visible and can fail an
  e2e test.
- **Structured logs only.** JSON logs keyed by `sessionId` + `seq`, so a session
  can be reconstructed end-to-end.
- **The debug surface is part of the product.** The demo ships a developer panel
  (connection state, session state, last 20 events, latency breakdown, provider
  names).

## Latency budget (P50 targets)

| Segment | Target |
| --- | --- |
| End of user speech → endpoint decision | ≤ 300 ms |
| → ASR final transcript | ≤ 150 ms |
| → LLM first token | ≤ 350 ms |
| → TTS first audio byte | ≤ 150 ms |
| → first audio in user's ear | ≤ 150 ms |
| **Total voice-to-voice** | **≤ ~1.1 s** |
| Barge-in cancellation | ≤ 100 ms |

Surfaced to the client via the `metrics.latency` protocol event
(`LatencyMetrics` in `packages/protocol`).

## Metrics

WebRTC setup time · ICE state transitions · packet loss · jitter · RTT ·
ASR/model/TTS latency · time-to-first-audio · end-to-end turn latency ·
barge-in success/failure · reconnect count · concurrent sessions per instance.

## Logs (lifecycle events)

session started/ended · provider error · reconnect attempted · ICE failure ·
barge-in triggered · TTS cancelled · model generation cancelled.
