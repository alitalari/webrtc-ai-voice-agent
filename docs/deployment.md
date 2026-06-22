# Deployment

> Draft. Built out in Phase 5.

## Services

- **Control plane** — stateless; scales horizontally.
- **Media engine** — stateful per session (sticky to one process). Scaled behind a session-aware router. Capacity is bounded by concurrent sessions per instance (CPU for Opus + resampling).
- **coturn** — TURN for the hosted demo (`infra/coturn`).

## Local

`infra/docker-compose.yml` brings up the backend + coturn for local testing.

## Security / abuse controls (hosted demo)

Temporary session tokens · no provider keys in the browser · origin allowlist · per-IP rate limits · max session duration · max concurrent sessions · TURN credential TTL · no raw-audio retention by default.
