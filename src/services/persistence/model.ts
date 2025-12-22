import type { InternalEventV2 } from '../../types/events';

export const COLLECTION_EVENTS = 'events';
export const COLLECTION_SOURCES = 'sources';

export interface SourceDocV1 {
  id: string; // e.g., "123456"
  platform: 'twitch' | 'discord' | 'kick' | string;
  displayName?: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  streamStatus?: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastStatusUpdate: string; // ISO8601
  lastStreamUpdate?: string; // ISO8601
  lastError?: { code?: string; message: string; at: string } | null;
  metrics?: {
    messagesIn?: number;
    messagesOut?: number;
    errors?: number;
    reconnects?: number;
    lastHeartbeat?: string; // ISO8601
  };
  metadata?: Record<string, any>;
  authStatus?: 'VALID' | 'EXPIRED' | 'REVOKED';
  viewerCount?: number;
  permissions?: string[];
  latencyMs?: number;
}

export interface EventDocV1 extends InternalEventV2 {
  /** Overall processing status of the recorded event */
  status?: 'INGESTED' | 'FINALIZED' | 'ERROR' | string;
  /** When the ingress was recorded */
  ingestedAt: string; // ISO8601
  /** When the event was finalized (egress/response) */
  finalizedAt?: string; // ISO8601
  /** Timestamp used by Firestore TTL to auto-expire documents */
  ttl?: FirebaseFirestore.Timestamp;
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
  delivery?: {
    destination?: string;
    deliveredAt?: string; // ISO8601
    providerMessageId?: string;
    status?: string;
    error?: { code: string; message?: string } | null;
    metadata?: Record<string, any>;
  };
  /** Dead-letter metadata: failure context for terminal errors */
  deadletter?: {
    reason: string;
    error: { code: string; message?: string } | null;
    lastStepId?: string;
    originalType?: string;
    slipSummary?: string;
    at: string; // ISO8601
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
    // Preserve non-plain objects (e.g., Firestore Timestamp, Date, custom classes)
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype) return value as any;
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
  } as any;
  return stripUndefinedDeep(doc) as EventDocV1;
}

/**
 * Normalizes system.source.status events into a SourceDocV1 patch.
 */
export function normalizeSourceStatus(evt: InternalEventV2): Partial<SourceDocV1> {
  const payload = evt.payload || evt.externalEvent?.payload || {};
  const now = new Date().toISOString();
  
  const patch: Partial<SourceDocV1> = {
    platform: payload.platform,
    id: payload.id || payload.source?.split(':')[1],
    status: payload.status,
    displayName: payload.displayName,
    lastStatusUpdate: now,
    metrics: payload.metrics ? {
      ...payload.metrics,
      lastHeartbeat: now,
    } : undefined,
    lastError: payload.lastError ? {
      ...payload.lastError,
      at: payload.lastError.at || now,
    } : undefined,
    metadata: payload.metadata,
    authStatus: payload.authStatus,
  };

  return stripUndefinedDeep(patch);
}

/**
 * Normalizes system.stream.online/offline events into a SourceDocV1 patch.
 */
export function normalizeStreamEvent(evt: InternalEventV2): Partial<SourceDocV1> {
  const payload = evt.payload || evt.externalEvent?.payload || {};
  const now = new Date().toISOString();
  const isOnline = evt.type === 'system.stream.online';

  // Derive platform and id
  const platform = payload.platform || evt.externalEvent?.source?.split('.')[0] || evt.source?.split('.')[1] || 'unknown';
  const id = payload.id || payload.broadcasterId || evt.userId || (payload.source && payload.source.includes(':') ? payload.source.split(':')[1] : undefined);

  const patch: Partial<SourceDocV1> = {
    platform,
    id,
    streamStatus: isOnline ? 'ONLINE' : 'OFFLINE',
    lastStreamUpdate: now,
    viewerCount: payload.viewer_count,
    metadata: payload, // Store the full payload as metadata for now
  };

  return stripUndefinedDeep(patch);
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

/**
 * Normalizes a DLQ event payload into a patch for EventDocV1.
 */
export function normalizeDeadLetterPayload(msg: any, destination?: string): Partial<EventDocV1> {
  const now = new Date().toISOString();

  // Detection of raw InternalEventV2 reaching DLQ (has v, source, correlationId and lacks explicit wrapped reason)
  if (msg?.v === '1' && msg?.source && msg?.correlationId && !msg?.payload?.reason) {
    const slip = Array.isArray(msg.routingSlip) ? msg.routingSlip : [];
    const lastStep = slip[slip.length - 1];

    let reason = 'RAW_EVENT_IN_DLQ';
    if (destination?.includes('router.dlq')) {
      reason = 'NO_ROUTING_MATCH';
    } else if (lastStep?.nextTopic?.includes('router.dlq')) {
      reason = 'NO_ROUTING_MATCH';
    }

    return stripUndefinedDeep({
      ...(msg as any), // Preserve original event fields (message, annotations, etc)
      status: 'ERROR',
      finalizedAt: now,
      deadletter: {
        reason,
        error: msg.errors && msg.errors.length ? msg.errors[msg.errors.length - 1] : null,
        lastStepId: lastStep?.id,
        originalType: msg.type,
        slipSummary: slip.length ? slip.map((s: any) => `${s.id}:${s.status}`).join('->') : undefined,
        at: now,
      },
    });
  }

  const payload = msg?.payload || {};

  return stripUndefinedDeep({
    status: 'ERROR',
    finalizedAt: now,
    deadletter: {
      reason: payload.reason || 'unknown',
      error: payload.error || null,
      lastStepId: payload.lastStepId,
      originalType: payload.originalType,
      slipSummary: payload.slipSummary,
      at: now,
    },
  });
}
