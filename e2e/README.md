# End-to-End Tests

Placeholder. Lands in Phase 1+ once a real server + WebRTC transport exists.

Plan (see [`../docs/testing.md`](../docs/testing.md)):

- Drive a headless browser (Playwright) against the running backend over real WebRTC.
- Feed scripted audio in; assert transcripts, agent audio, and `metrics.latency` out.
- Cover the high-signal paths: normal turn, **barge-in within the latency budget**,
  and failures (provider timeout, disconnect + reconnect, TURN unavailable, mic denied).
- Assert against the latency budget so performance regressions fail the build.
