# RTC / STUN / TURN

> Draft.

## ICE configuration

The SDK accepts standard `iceServers`. Users may pass their own STUN/TURN.

- **Local dev**: public STUN is enough; TURN not required for localhost.
- **Production**: TURN is required for reliability (symmetric NAT, restrictive networks).

## Hosted demo TURN

- One coturn deployment (see `infra/coturn`).
- Temporary credentials with TTL.
- Origin allowlist, rate limits, capped session duration, bandwidth monitoring.

## Later: hosted STUN/TURN as a service

Managed endpoints, temporary-credential API, usage billing, per-project quotas, region selection. Out of scope for V1.
