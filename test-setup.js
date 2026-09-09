/**
 * Global test setup
 *
 * Note: Worktree safeguard is in jest.config.js (runs earlier in Jest lifecycle)
 */

// TEMPORARY FIX: Increase EventEmitter limit to suppress warnings
// Root cause: Bit instances register multiple process listeners (SIGTERM, SIGINT, etc)
//             but cleanup is incomplete in tests.
// TODO (Sprint 31+): Refactor Bit.close() to properly track and remove all listeners
// Tracked in: planning/sprint-30-pe25g1/backlog.yaml (Phase 5)
require('events').EventEmitter.defaultMaxListeners = 20;

// QUICK WIN (Sprint 30): Set default NATS_URL if not provided
// Many tests expect NATS to be available but don't set the URL
// This provides a sensible default for local development
if (!process.env.NATS_URL) {
  process.env.NATS_URL = 'nats://localhost:4222';
}

// Additional test setup can be added here
