import { startDevServer } from './dev-server.js';

/**
 * Reference backend entry point. Real WebRTC media path + session orchestration.
 * Providers are real when their keys are present in apps/server/.env, else fake.
 * See docs/architecture.md → Stack & Runtime Decision.
 */
startDevServer();
