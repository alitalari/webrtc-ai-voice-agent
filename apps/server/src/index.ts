import { startDevServer } from './dev-server.js';

/**
 * Reference backend entry point. Milestone 1 of the real WebRTC media path:
 * signaling + a werift peer that echoes audio and carries control events.
 * See docs/architecture.md → Stack & Runtime Decision.
 */
const port = Number(process.env.PORT ?? 8080);
startDevServer(port);
