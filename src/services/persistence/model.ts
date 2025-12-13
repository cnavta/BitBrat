import type { InternalEventV2 } from '../../types/events';

export const COLLECTION_EVENTS = 'events';

export interface EventDocV1 extends InternalEventV2 {
  /** Overall processing status of the recorded event */
  status?: 'INGESTED' | 'FINALIZED' | 'ERROR' | string;
  /** When the ingress was recorded */
  ingestedAt: string; // ISO8601
  /** When the event was finalized (egress/response) */
  finalizedAt?: string; // ISO8601
  /** Original ingress payload for debugging */
  raw?: any; // original event payload for debugging
  /** Ingress metadata: where, when and how the event entered the system */
  ingress?: {
    source?: string; // e.g., ingress.twitch
    receivedAt: string; // ISO8601
    destination?: string; // e.g., internal.ingress.v1
    transport?: string; // e.g., pubsub|nats
    attributes?: Record<string, string>;
    metadata?: Record<string, any>;
  };
  /** Finalization/Egress metadata: where, when and how the response was delivered */
  egress?: {
    destination?: string;
    deliveredAt?: string; // ISO8601
    providerMessageId?: string;
    status?: string;
    error?: { code: string; message?: string } | null;
    metadata?: Record<string, any>;
  };
}

export interface FinalizationUpdateV1 {
  correlationId: string;
  destination?: string;
  deliveredAt?: string; // ISO8601
  providerMessageId?: string;
  status?: string; // e.g., SENT, FAILED
  error?: { code: string; message?: string } | null;
  metadata?: Record<string, any>;
  /** Optional: carry forward annotations/candidates from egress path */
  annotations?: any[];
  candidates?: any[];
}

/**
 * Remove all properties with value === undefined recursively from objects/arrays.
 * This prevents Firestore Admin SDK from rejecting writes with undefined values.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value as any;
  if (value === null) return value;
  if (Array.isArray(value)) {
    const arr = (value as any[]).map((v) => stripUndefinedDeep(v)).filter((v) => v !== undefined);
    return arr as any;
  }
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      const sv = stripUndefinedDeep(v as any);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return value as any;
}

export function normalizeIngressEvent(evt: InternalEventV2): EventDocV1 {
  const now = new Date().toISOString();
  // Build and sanitize to avoid undefined values in Firestore writes
  const doc: EventDocV1 = {
    ...(evt as any),
    status: 'INGESTED',
    ingestedAt: now,
    ingress: {
      source: (evt as any)?.source,
      receivedAt: now,
      destination: 'internal.ingress.v1',
    },
    raw: evt,
  } as any;
  return stripUndefinedDeep(doc) as EventDocV1;
}

export function normalizeFinalizePayload(msg: any): FinalizationUpdateV1 {
  const deliveredAt = msg?.deliveredAt || msg?.finalizedAt || new Date().toISOString();
  const destination = msg?.destination || msg?.egressDestination || msg?.egress?.destination;
  const providerMessageId = msg?.providerMessageId || msg?.egress?.providerMessageId;
  const status = msg?.status || msg?.egress?.status || 'FINALIZED';
  const error = msg?.error || msg?.egress?.error || null;
  const metadata = msg?.metadata || msg?.egress?.metadata || undefined;
  const annotations = Array.isArray(msg?.annotations) ? msg.annotations : Array.isArray(msg?.egress?.annotations) ? msg.egress.annotations : undefined;
  const candidates = Array.isArray(msg?.candidates) ? msg.candidates : Array.isArray(msg?.egress?.candidates) ? msg.egress.candidates : undefined;
  return {
    correlationId: String(msg?.correlationId || ''),
    destination,
    deliveredAt,
    providerMessageId,
    status,
    error,
    metadata,
    annotations,
    candidates,
  };
}
