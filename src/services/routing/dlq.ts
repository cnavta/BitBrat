import { InternalEventV1, InternalEventV2 } from '../../types/events';
import { summarizeSlip } from './slip';

/**
 * Dead-Letter Queue (DLQ) Event Builder
 *
 * Purpose:
 * - Construct a minimal, standardized dead-letter event when processing cannot continue.
 * - Include correlation/tracing data, a slip summary, and a safe preview of the original payload.
 *
 * Usage:
 * - Called by the router or workers when a terminal error occurs or a timeout is reached.
 */
export function buildDlqEvent(params: {
  source?: string;
  original: InternalEventV1 | InternalEventV2 | any;
  reason: string;
  error?: unknown;
  lastStepId?: string;
}): InternalEventV1 {
  const { original, reason, error, lastStepId } = params;
  const err = normalizeError(error);

  // Extract common fields regardless of V1 (nested envelope) or V2 (flattened)
  const isV1 = !!original.envelope;
  const correlationId = isV1 ? original.envelope.correlationId : original.correlationId;
  const traceId = isV1 ? original.envelope.traceId : original.traceId;
  const routingSlip = isV1 ? original.envelope.routingSlip : original.routingSlip;
  const egress = isV1 ? original.envelope.egress : original.egress;

  return {
    envelope: {
      v: '1',
      source: params.source || 'router',
      correlationId,
      traceId,
      routingSlip,
      egress,
    },
    type: 'router.deadletter.v1',
    channel: original.channel,
    userId: original.userId,
    payload: {
      reason,
      error: err,
      lastStepId: lastStepId || inferLastStepId(original),
      originalType: original.type,
      slipSummary: summarizeSlip(routingSlip),
      originalPayloadPreview: safePreview(original.payload),
      // Egress context enrichment
      egressSource: original.source,
      metadata: original.metadata || (isV1 ? original.envelope.metadata : undefined),
    },
  };
}

/** Normalize various error shapes to a consistent DLQ payload. */
function normalizeError(e: unknown): { code: string; message?: string } | null {
  if (!e) return null;
  if (typeof e === 'string') return { code: 'error', message: e };
  if (e instanceof Error) return { code: e.name || 'Error', message: e.message };
  try {
    return { code: 'error', message: JSON.stringify(e) };
  } catch {
    return { code: 'error' };
  }
}

/** Infer the last relevant step id to aid debugging. */
function inferLastStepId(original: any): string | undefined {
  const slip = (original.envelope ? original.envelope.routingSlip : original.routingSlip) || [];
  // last step with a status not OK/SKIP (or the last overall)
  const idx = slip.findIndex((s: any) => s.status !== 'OK' && s.status !== 'SKIP');
  if (idx >= 0) return slip[idx].id;
  return slip.length ? slip[slip.length - 1].id : undefined;
}

/** Safely preview an arbitrary object without leaking large payloads or throwing. */
function safePreview(obj: any): any {
  if (!obj) return obj;
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 1000) return obj;
    return { truncated: true, length: s.length };
  } catch {
    return { note: 'unserializable' };
  }
}
