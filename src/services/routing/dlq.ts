import { InternalEventV2 } from '../../types/events';
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
  original: InternalEventV2 | any;
  reason: string;
  error?: unknown;
  lastStepId?: string;
}): InternalEventV2 {
  const { original, reason, error, lastStepId } = params;
  const err = normalizeError(error);

  const correlationId = original.correlationId;
  const traceId = original.traceId;
  const routingSlip = original.routingSlip;
  const egress = original.egress || { destination: 'deadletter' };

  return {
    v: '2',
    type: 'router.deadletter.v1',
    correlationId,
    traceId,
    ingress: original.ingress || { ingressAt: new Date().toISOString(), source: params.source || 'router' },
    identity: original.identity || { external: { id: 'unknown', platform: 'system' } },
    egress,
    routingSlip,
    payload: {
      reason,
      error: err,
      lastStepId: lastStepId || inferLastStepId(original),
      originalType: original.type,
      slipSummary: summarizeSlip(routingSlip),
      originalPayloadPreview: safePreview(original.payload || original.message?.rawPlatformPayload),
      // Egress context enrichment
      egressSource: original.ingress?.source,
      metadata: original.metadata,
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
  const slip = original.routingSlip || [];
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
