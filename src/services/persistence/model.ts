import type {
  AggregateStatus,
  EventAggregateV2,
  EventSnapshotDocV1,
  InternalEventV2,
  PersistenceSnapshotEventV1,
  SnapshotDeadletterV1,
  SnapshotDeliveryV1,
  SnapshotKind,
} from '../../types/events';
import { Timestamp } from 'firebase-admin/firestore';
import { INTERNAL_INGRESS_V1 } from '../../types/events';

export const COLLECTION_EVENTS = 'events';
export const COLLECTION_SOURCES = 'sources';
export const SUBCOLLECTION_SNAPSHOTS = 'snapshots';

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

export interface InitialPersistenceWriteV1 {
  aggregate: EventAggregateV2;
  snapshot: EventSnapshotDocV1;
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

function buildIdentitySummary(evt: InternalEventV2): EventAggregateV2['identitySummary'] {
  return stripUndefinedDeep({
    externalId: evt.identity?.external?.id,
    platform: evt.identity?.external?.platform,
    displayName: evt.identity?.user?.displayName || evt.identity?.external?.displayName,
    userId: evt.identity?.user?.id,
  });
}

function buildCurrentProjection(evt: InternalEventV2): EventAggregateV2['currentProjection'] {
  return stripUndefinedDeep({
    annotations: evt.annotations,
    candidates: evt.candidates,
    routing: evt.routing,
    metadata: evt.metadata,
  });
}

export function buildInitialSnapshotId(evt: InternalEventV2): string {
  return `${evt.correlationId}-000001-initial`;
}

export function buildSnapshotId(correlationId: string, sequence: number, kind: SnapshotKind): string {
  return `${correlationId}-${String(sequence).padStart(6, '0')}-${kind}`;
}

export function resolveSnapshotBaseDate(base: string | number | Date | undefined): Date {
  const candidate = base ? new Date(base) : new Date();
  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
}

export function computeExpireAt(params: {
  baseDate?: string | number | Date;
  qosTtlSeconds?: number;
  ttlDays?: number;
}): FirebaseFirestore.Timestamp {
  const baseDate = resolveSnapshotBaseDate(params.baseDate);
  const ttlSeconds = typeof params.qosTtlSeconds === 'number' && isFinite(params.qosTtlSeconds) && params.qosTtlSeconds > 0
    ? params.qosTtlSeconds
    : null;
  let expireAt: Date;
  if (ttlSeconds != null) {
    expireAt = new Date(baseDate.getTime() + ttlSeconds * 1000);
  } else {
    let ttlDays = params.ttlDays ?? parseInt(String(process.env.PERSISTENCE_TTL_DAYS ?? '7'), 10);
    if (!isFinite(ttlDays) || ttlDays <= 0) ttlDays = 7;
    expireAt = new Date(baseDate.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }
  return Timestamp.fromDate(expireAt);
}

function deriveAggregateStatus(kind: SnapshotKind, currentStatus?: AggregateStatus): AggregateStatus {
  if (kind === 'deadletter') return 'ERROR';
  if (kind === 'final') return 'FINALIZED';
  if (kind === 'update') return currentStatus === 'FINALIZED' || currentStatus === 'ERROR' ? currentStatus : 'IN_PROGRESS';
  return 'INGESTED';
}

export function buildSnapshotDoc(params: {
  snapshotId: string;
  sequence: number;
  kind: SnapshotKind;
  capturedAt: string;
  sourceService: string;
  sourceTopic: string;
  idempotencyKey: string;
  event: InternalEventV2;
  stage?: string;
  stepId?: string;
  attempt?: number;
  changeSummary?: string;
  delivery?: SnapshotDeliveryV1;
  deadletter?: SnapshotDeadletterV1;
  expireAt?: FirebaseFirestore.Timestamp;
}): EventSnapshotDocV1 {
  return stripUndefinedDeep({
    v: '1',
    snapshotId: params.snapshotId,
    correlationId: params.event.correlationId,
    sequence: params.sequence,
    kind: params.kind,
    capturedAt: params.capturedAt,
    sourceService: params.sourceService,
    sourceTopic: params.sourceTopic,
    idempotencyKey: params.idempotencyKey,
    stage: params.stage,
    stepId: params.stepId,
    attempt: params.attempt,
    changeSummary: params.changeSummary,
    delivery: params.delivery,
    deadletter: params.deadletter,
    event: params.event,
    expireAt: params.expireAt,
  }) as EventSnapshotDocV1;
}

export function normalizeIngressEvent(evt: InternalEventV2, expireAt?: FirebaseFirestore.Timestamp): InitialPersistenceWriteV1 {
  const capturedAt = evt.ingress?.ingressAt || new Date().toISOString();
  const snapshotId = buildInitialSnapshotId(evt);
  const aggregate: EventAggregateV2 = stripUndefinedDeep({
    correlationId: evt.correlationId,
    eventType: evt.type,
    source: evt.ingress?.source || 'unknown',
    channel: evt.ingress?.channel,
    status: 'INGESTED',
    ingressAt: evt.ingress?.ingressAt || capturedAt,
    latestStage: evt.routing?.stage,
    latestStepId: evt.routing?.slip?.[0]?.id,
    initialSnapshotId: snapshotId,
    latestSnapshotId: snapshotId,
    snapshotCount: 1,
    identitySummary: buildIdentitySummary(evt),
    currentProjection: buildCurrentProjection(evt),
    expireAt,
  }) as EventAggregateV2;
  const snapshot = buildSnapshotDoc({
    snapshotId,
    sequence: 1,
    kind: 'initial',
    capturedAt,
    sourceService: 'persistence',
    sourceTopic: INTERNAL_INGRESS_V1,
    idempotencyKey: `${evt.correlationId}:initial:persistence:${capturedAt}`,
    event: evt,
    stage: evt.routing?.stage,
    stepId: evt.routing?.slip?.[0]?.id,
    expireAt,
  });
  return { aggregate, snapshot };
}

/**
 * Normalizes system.source.status events into a SourceDocV1 patch.
 */
export function normalizeSourceStatus(evt: InternalEventV2): Partial<SourceDocV1> {
  const payload = evt.payload || evt.externalEvent?.metadata || {};
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
  const payload = evt.payload || evt.externalEvent?.metadata || {};
  const now = new Date().toISOString();
  const isOnline = evt.type === 'system.stream.online';

  // Derive platform and id
  const platform = payload.platform || evt.externalEvent?.source?.split('.')[0] || evt.ingress?.source?.split('.')[1] || 'unknown';
  const id = payload.id || payload.broadcasterId || evt.identity?.user?.id || evt.identity?.external?.id || (payload.source && payload.source.includes(':') ? payload.source.split(':')[1] : undefined);

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

export function normalizeSnapshotEvent(msg: any): PersistenceSnapshotEventV1 {
  const event = msg?.event as InternalEventV2;
  return stripUndefinedDeep({
    v: '1',
    correlationId: String(msg?.correlationId || event?.correlationId || ''),
    kind: msg?.kind,
    capturedAt: msg?.capturedAt || new Date().toISOString(),
    sourceService: String(msg?.sourceService || ''),
    sourceTopic: String(msg?.sourceTopic || ''),
    idempotencyKey: String(msg?.idempotencyKey || ''),
    stage: msg?.stage || event?.routing?.stage,
    stepId: msg?.stepId,
    attempt: typeof msg?.attempt === 'number' ? msg.attempt : undefined,
    changeSummary: msg?.changeSummary,
    delivery: msg?.delivery,
    deadletter: msg?.deadletter,
    event,
  }) as PersistenceSnapshotEventV1;
}

export function applySnapshotToAggregate(
  aggregate: EventAggregateV2,
  snapshot: EventSnapshotDocV1,
  nextSnapshotCount = aggregate.snapshotCount + 1,
): EventAggregateV2 {
  const delivery = snapshot.delivery || aggregate.delivery;
  const deadletter = snapshot.deadletter || aggregate.deadletter;
  const next: EventAggregateV2 = {
    ...aggregate,
    status: deriveAggregateStatus(snapshot.kind, aggregate.status),
    finalizedAt: snapshot.kind === 'final' || snapshot.kind === 'deadletter'
      ? delivery?.deliveredAt || deadletter?.at || snapshot.capturedAt
      : aggregate.finalizedAt,
    latestStage: snapshot.stage || snapshot.event?.routing?.stage || aggregate.latestStage,
    latestStepId: snapshot.stepId || aggregate.latestStepId,
    latestSnapshotId: snapshot.snapshotId,
    finalSnapshotId: snapshot.kind === 'final' ? snapshot.snapshotId : aggregate.finalSnapshotId,
    snapshotCount: nextSnapshotCount,
    identitySummary: buildIdentitySummary(snapshot.event),
    delivery,
    deadletter,
    currentProjection: buildCurrentProjection(snapshot.event),
    expireAt: snapshot.expireAt || aggregate.expireAt,
  };
  return stripUndefinedDeep(next) as EventAggregateV2;
}

/**
 * Normalizes a DLQ event payload into a persistence snapshot event.
 */
export function normalizeDeadLetterPayload(msg: any): PersistenceSnapshotEventV1 {
  const now = new Date().toISOString();
  const payload = msg?.payload || {};

  return stripUndefinedDeep({
    v: '1',
    correlationId: String(msg?.correlationId || msg?.envelope?.correlationId || payload?.correlationId || ''),
    kind: 'deadletter',
    capturedAt: now,
    sourceService: String(msg?.source || msg?.service || 'persistence'),
    sourceTopic: String(msg?.sourceTopic || msg?.topic || msg?.type || 'internal.deadletter.v1'),
    idempotencyKey: String(msg?.idempotencyKey || `${msg?.correlationId || msg?.envelope?.correlationId || 'missing'}:deadletter:${payload.reason || 'unknown'}:${now}`),
    stage: msg?.routing?.stage,
    stepId: payload.lastStepId,
    changeSummary: payload.reason || 'deadletter',
    deadletter: {
      reason: payload.reason || 'unknown',
      error: payload.error || null,
      lastStepId: payload.lastStepId,
      originalType: payload.originalType,
      slipSummary: payload.slipSummary,
      at: now,
    },
    event: msg?.event || msg?.original || msg,
  });
}
