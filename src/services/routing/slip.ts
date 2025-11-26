import { EnvelopeV1, RoutingStep, RoutingStatus } from '../../types/events';

/**
 * Routing Slip Utilities
 *
 * Purpose:
 * - Provide small, focused helpers to create, inspect, and mutate RoutingStep[] entries
 *   that travel inside the InternalEventV1.envelope.routingSlip.
 *
 * Notes for LLM agents:
 * - Keep step transitions explicit and side-effect free except for timestamping fields.
 * - Status values: 'PENDING' | 'OK' | 'ERROR' | 'SKIP'. Consumers should only flip their own step.
 * - Attempts: increment attempt when retrying the same step; maxAttempts defaults to 3 if unset.
 */

/**
 * Ensure that the envelope has a routingSlip. If missing or empty, initialize it
 * from the provided planned steps (shallow copy to avoid aliasing).
 *
 * @param envelope - The event envelope to host the routingSlip.
 * @param planned  - Planned steps returned by the router's planRoutingSlip.
 * @returns The (possibly newly created) routingSlip array on the envelope.
 */
export function ensureSlip(envelope: EnvelopeV1, planned: RoutingStep[]): RoutingStep[] {
  if (!Array.isArray(envelope.routingSlip) || envelope.routingSlip.length === 0) {
    envelope.routingSlip = planned.map((s) => ({ ...s }));
  }
  return envelope.routingSlip;
}

/**
 * Find the next actionable step: the first step whose status is neither OK nor SKIP.
 * Returns null when all steps are completed or the slip is invalid.
 *
 * @param slip - The current routingSlip.
 * @returns The index and step reference, or null if none.
 */
export function findNextActionable(slip: RoutingStep[] | undefined): { index: number; step: RoutingStep } | null {
  if (!Array.isArray(slip)) return null;
  const idx = slip.findIndex((s) => s.status !== 'OK' && s.status !== 'SKIP');
  if (idx < 0) return null;
  return { index: idx, step: slip[idx] };
}

/**
 * Mark a step as started by setting startedAt if absent and
 * initializing attempt and maxAttempts fields when missing.
 */
export function markStepStarted(step: RoutingStep): void {
  step.startedAt = step.startedAt || new Date().toISOString();
  step.attempt = step.attempt ?? 0;
  step.maxAttempts = step.maxAttempts ?? 3;
}

/**
 * Mark a step result by stamping endedAt, updating status, and setting error payload.
 *
 * @param step    - Step to finalize.
 * @param status  - New status (OK | ERROR | SKIP).
 * @param err     - Optional normalized error object; set null to clear.
 */
export function markStepResult(step: RoutingStep, status: RoutingStatus, err?: { code: string; message?: string; retryable?: boolean } | null): void {
  step.endedAt = new Date().toISOString();
  step.status = status;
  step.error = err ?? null;
}

/**
 * Determine if a slip is complete, i.e., every step is in a terminal non-error state (OK or SKIP).
 */
export function isComplete(slip: RoutingStep[] | undefined): boolean {
  if (!Array.isArray(slip)) return false;
  return slip.every((s) => s.status === 'OK' || s.status === 'SKIP');
}

/**
 * Produce a compact textual summary for logging, e.g., "[router:OK,llm-bot:OK#1,egress:PENDING]".
 */
export function summarizeSlip(slip: RoutingStep[] | undefined): string {
  if (!Array.isArray(slip)) return '[]';
  return '[' + slip.map((s) => `${s.id}:${s.status}${s.attempt != null ? `#${s.attempt}` : ''}`).join(',') + ']';
}
