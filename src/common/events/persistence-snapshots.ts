import type {
  InternalEventV2,
  PersistenceSnapshotEventV1,
  RoutingStage,
  SnapshotDeadletterV1,
  SnapshotDeliveryV1,
} from '../../types/events';
import { INTERNAL_PERSISTENCE_SNAPSHOT_V1 } from '../../types/events';

export type PersistenceSnapshotMode = 'off' | 'final-only' | 'significant' | 'all';

export interface PersistenceSnapshotPolicy {
  mode: PersistenceSnapshotMode;
  includeRawPayloads: boolean;
  maxSnapshotBytes?: number;
  ttlDays: number;
}

export interface PersistenceSnapshotPublishParams {
  config?: Record<string, any>;
  createPublisher: (subject: string) => { publishJson(payload: unknown, attributes?: Record<string, string>): Promise<unknown> } | undefined;
  logger?: { info?: Function; warn?: Function; debug?: Function };
  kind: PersistenceSnapshotEventV1['kind'];
  sourceService: string;
  sourceTopic: string;
  event: InternalEventV2;
  changeSummary?: string;
  delivery?: SnapshotDeliveryV1;
  deadletter?: SnapshotDeadletterV1;
  idempotencyKey?: string;
  capturedAt?: string;
  stage?: RoutingStage;
  stepId?: string;
  attempt?: number;
}

export interface PersistenceSnapshotPublishResult {
  published: boolean;
  reason?: 'mode_disabled' | 'publisher_unavailable' | 'snapshot_too_large';
  payload?: PersistenceSnapshotEventV1;
  policy: PersistenceSnapshotPolicy;
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function cloneEvent(event: InternalEventV2): InternalEventV2 {
  return JSON.parse(JSON.stringify(event)) as InternalEventV2;
}

function eventSizeBytes(event: InternalEventV2): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

function trimEventToMaxBytes(event: InternalEventV2, maxSnapshotBytes?: number): { event: InternalEventV2; truncated: boolean } | null {
  if (!maxSnapshotBytes) return { event, truncated: false };
  if (eventSizeBytes(event) <= maxSnapshotBytes) return { event, truncated: false };

  const candidate: any = cloneEvent(event);
  const trimSteps: Array<() => void> = [
    () => delete candidate.payload,
    () => delete candidate.metadata,
    () => delete candidate.errors,
    () => delete candidate.externalEvent,
    () => delete candidate.message,
    () => delete candidate.annotations,
    () => delete candidate.candidates,
    () => {
      if (candidate.routing && Array.isArray(candidate.routing.slip)) {
        candidate.routing = { ...candidate.routing, slip: candidate.routing.slip.slice(-1) };
      }
    },
  ];

  for (const trim of trimSteps) {
    trim();
    if (eventSizeBytes(candidate as InternalEventV2) <= maxSnapshotBytes) {
      return { event: candidate as InternalEventV2, truncated: true };
    }
  }

  return null;
}

export function resolvePersistenceSnapshotPolicy(config?: Record<string, any>): PersistenceSnapshotPolicy {
  const modeRaw = String(config?.PERSISTENCE_SNAPSHOT_MODE ?? process.env.PERSISTENCE_SNAPSHOT_MODE ?? 'final-only').trim().toLowerCase();
  const mode: PersistenceSnapshotMode = ['off', 'final-only', 'significant', 'all'].includes(modeRaw)
    ? (modeRaw as PersistenceSnapshotMode)
    : 'final-only';
  const ttlDays = parsePositiveNumber(config?.PERSISTENCE_TTL_DAYS ?? process.env.PERSISTENCE_TTL_DAYS) ?? 7;
  return {
    mode,
    includeRawPayloads: parseBoolean(config?.PERSISTENCE_INCLUDE_RAW_PAYLOADS ?? process.env.PERSISTENCE_INCLUDE_RAW_PAYLOADS, true),
    maxSnapshotBytes: parsePositiveNumber(config?.PERSISTENCE_MAX_SNAPSHOT_BYTES ?? process.env.PERSISTENCE_MAX_SNAPSHOT_BYTES),
    ttlDays,
  };
}

export function shouldPublishSnapshot(policy: PersistenceSnapshotPolicy, kind: PersistenceSnapshotEventV1['kind']): boolean {
  if (policy.mode === 'off') return false;
  if (kind === 'final' || kind === 'deadletter') return true;
  return policy.mode === 'all' || policy.mode === 'significant';
}

export function buildPersistenceSnapshotEvent(params: {
  policy: PersistenceSnapshotPolicy;
  kind: PersistenceSnapshotEventV1['kind'];
  sourceService: string;
  sourceTopic: string;
  event: InternalEventV2;
  changeSummary?: string;
  delivery?: SnapshotDeliveryV1;
  deadletter?: SnapshotDeadletterV1;
  idempotencyKey?: string;
  capturedAt?: string;
  stage?: RoutingStage;
  stepId?: string;
  attempt?: number;
}): PersistenceSnapshotEventV1 | null {
  if (!shouldPublishSnapshot(params.policy, params.kind)) return null;

  const capturedAt = params.capturedAt || new Date().toISOString();
  const event = cloneEvent(params.event);
  if (!params.policy.includeRawPayloads) {
    delete (event as any).payload;
  }

  const trimmed = trimEventToMaxBytes(event, params.policy.maxSnapshotBytes);
  if (!trimmed) return null;

  return {
    v: '1',
    correlationId: params.event.correlationId,
    kind: params.kind,
    capturedAt,
    sourceService: params.sourceService,
    sourceTopic: params.sourceTopic,
    idempotencyKey: params.idempotencyKey || `${params.event.correlationId}:${params.kind}:${params.sourceService}:${params.sourceTopic}:${capturedAt}`,
    stage: params.stage || params.event.routing?.stage,
    stepId: params.stepId || params.event.routing?.slip?.find((step) => step?.status !== 'OK' && step?.status !== 'SKIP')?.id,
    attempt: params.attempt,
    changeSummary: trimmed.truncated && params.changeSummary ? `${params.changeSummary} (truncated)` : params.changeSummary,
    delivery: params.delivery,
    deadletter: params.deadletter,
    event: trimmed.event,
  };
}

export async function publishPersistenceSnapshot(params: PersistenceSnapshotPublishParams): Promise<PersistenceSnapshotPublishResult> {
  const policy = resolvePersistenceSnapshotPolicy(params.config);
  const payload = buildPersistenceSnapshotEvent({
    policy,
    kind: params.kind,
    sourceService: params.sourceService,
    sourceTopic: params.sourceTopic,
    event: params.event,
    changeSummary: params.changeSummary,
    delivery: params.delivery,
    deadletter: params.deadletter,
    idempotencyKey: params.idempotencyKey,
    capturedAt: params.capturedAt,
    stage: params.stage,
    stepId: params.stepId,
    attempt: params.attempt,
  });

  if (!payload) {
    const reason = shouldPublishSnapshot(policy, params.kind) ? 'snapshot_too_large' : 'mode_disabled';
    params.logger?.debug?.('persistence.snapshot.skipped', {
      correlationId: params.event?.correlationId,
      kind: params.kind,
      sourceTopic: params.sourceTopic,
      reason,
      mode: policy.mode,
    });
    return { published: false, reason, policy };
  }

  const prefix = String(params.config?.busPrefix || process.env.BUS_PREFIX || '');
  const subject = `${prefix}${INTERNAL_PERSISTENCE_SNAPSHOT_V1}`;
  const publisher = params.createPublisher(subject);
  if (!publisher) {
    params.logger?.warn?.('persistence.snapshot.publisher_unavailable', {
      correlationId: params.event?.correlationId,
      kind: params.kind,
      subject,
    });
    return { published: false, reason: 'publisher_unavailable', policy, payload };
  }

  await publisher.publishJson(payload, {
    correlationId: String(params.event?.correlationId || ''),
    type: INTERNAL_PERSISTENCE_SNAPSHOT_V1,
  });
  params.logger?.info?.('persistence.snapshot.published', {
    correlationId: params.event?.correlationId,
    kind: params.kind,
    sourceService: params.sourceService,
    sourceTopic: params.sourceTopic,
    mode: policy.mode,
  });
  return { published: true, policy, payload };
}