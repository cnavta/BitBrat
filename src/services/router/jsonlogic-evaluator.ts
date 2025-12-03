/**
 * JsonLogic Evaluator
 *
 * Provides utilities to build an evaluation context from an InternalEventV2
 * and to evaluate JsonLogic expressions safely (malformed logic returns false).
 */
import type { InternalEventV2 } from '../../types/events';

// json-logic-js does not ship perfect TS types in all versions; use a safe import
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsonLogic: any = require('json-logic-js');

export interface EvalContext {
  type: string;
  channel?: string;
  userId?: string;
  // Back-compat fields to ease rule expressions during V1→V2 migration:
  // - payload maps to message.rawPlatformPayload
  // - envelope-like fields are exposed at top-level where useful
  payload: Record<string, any>;
  v?: string;
  source?: string;
  correlationId?: string;
  traceId?: string;
  message?: any;
  annotations?: any[];
  candidates?: any[];
  now: string; // ISO8601
  ts: number; // epoch ms
}

/** Build a deterministic evaluation context for JsonLogic from an InternalEventV2. */
export function buildContext(evt: InternalEventV2, nowIso?: string, ts?: number): EvalContext {
  const now = nowIso || new Date().toISOString();
  const n = typeof ts === 'number' ? ts : Date.now();
  return {
    type: evt.type,
    channel: evt.channel,
    userId: evt.userId,
    v: (evt as any).v,
    source: (evt as any).source,
    correlationId: (evt as any).correlationId,
    traceId: (evt as any).traceId,
    message: (evt as any).message,
    annotations: (evt as any).annotations,
    candidates: (evt as any).candidates,
    payload: (evt as any)?.message?.rawPlatformPayload || {},
    now,
    ts: n,
  };
}

/**
 * Evaluate a JsonLogic expression against the provided context.
 * Returns boolean; any error or non-boolean result is coerced to false.
 */
export function evaluate(logic: unknown, context: EvalContext): boolean {
  try {
    if (!logic || typeof logic !== 'object') return false;
    const result = jsonLogic.apply(logic as any, context);
    return result === true || result === 1;
  } catch {
    // Malformed logic should not throw; treat as non-match
    return false;
  }
}

export default { buildContext, evaluate };
