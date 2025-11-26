/**
 * Router Utilities Barrel
 *
 * Purpose:
 * - Provide a stable import surface for planning and advancing routing slips.
 * - Centralize exports so business code can do:
 *     import { advanceEvent } from '../services/router';
 *
 * Notes for LLM agents:
 * - Prefer importing from this barrel rather than deep paths to reduce coupling.
 * - See individual modules for detailed docs:
 *   - advance.ts: step advancement algorithm and publish/complete decisions
 *   - slip.ts: low-level slip mutation and inspection helpers
 *   - dlq.ts: dead-letter event builder (not re-exported here by default)
 */
export { ensureSlip, findNextActionable, markStepResult, markStepStarted, isComplete, summarizeSlip } from './slip';
export { markIfSeen } from './idempotency';
