import { PROTOCOL_VERSION } from '@voice/protocol';

/**
 * Reference backend entry point.
 *
 * Phase 0 scaffold only. This process will host two internal services:
 *   - control plane: signaling, auth/session tokens, orchestration, metrics
 *   - media engine:  isolated WebRTC endpoint (Opus, VAD, framing)
 * See docs/architecture.md → Stack & Runtime Decision.
 */
function main(): void {
  // Structured logging convention lands in Phase 4 (docs/observability.md).
  console.log(`@voice/server scaffold — protocol v${PROTOCOL_VERSION}`);
}

main();
