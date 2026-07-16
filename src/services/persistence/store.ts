import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../../common/persistence/interfaces';
import type {
  EventAggregateV2,
  EventSnapshotDocV1,
  InternalEventV2,
  PersistenceSnapshotEventV1,
  SnapshotDeliveryV1,
} from '../../types/events';
import {
  applySnapshotToAggregate,
  buildSnapshotDoc,
  buildSnapshotId,
  COLLECTION_EVENTS,
  COLLECTION_SOURCES,
  computeExpireAt,
  normalizeDeadLetterPayload,
  normalizeIngressEvent,
  normalizeSnapshotEvent,
  normalizeSourceStatus,
  normalizeStreamEvent,
  stripUndefinedDeep,
  SUBCOLLECTION_SNAPSHOTS,
} from './model';
import { createPersistenceStore, type IPersistenceStore } from './repository';

export interface PersistenceStoreDeps {
  firestore?: Firestore;
  documentStore?: IDocumentStore;
  logger?: { info: Function; warn: Function; error: Function; debug?: Function };
}

export class PersistenceStore {
  private store: IPersistenceStore;
  private logger: Required<PersistenceStoreDeps>['logger'];

  constructor(deps: PersistenceStoreDeps) {
    const dbOrStore = deps.firestore || deps.documentStore;
    this.store = createPersistenceStore(dbOrStore);
    this.logger = (deps.logger || console) as any;
  }

  /** Upsert the aggregate + initial snapshot by correlationId. Idempotent. */
  async upsertIngressEvent(evt: InternalEventV2): Promise<{ aggregate: EventAggregateV2; snapshot: EventSnapshotDocV1; created: boolean }> {
    const expireAt = computeExpireAt({ baseDate: evt.ingress?.ingressAt, qosTtlSeconds: evt.qos?.persistenceTtlSec });
    const normalized = normalizeIngressEvent(evt, expireAt);
    if (!normalized.aggregate.correlationId) throw new Error('missing_correlationId');

    const result = await this.store.upsertIngressEvent(normalized.aggregate, normalized.snapshot);

    this.logger.info('persistence.ingress.ok', {
      correlationId: result.aggregate.correlationId,
      status: result.aggregate.status,
      created: result.created,
    });
    return result;
  }

  /** Apply a legacy finalization patch as compatibility-only aggregate summary. */
  async applyFinalization(rawMsg: any): Promise<void> {
    const correlationId = String(rawMsg?.correlationId || '');
    if (!correlationId) throw new Error('missing_correlationId');
    const delivery: SnapshotDeliveryV1 = stripUndefinedDeep({
      destination: rawMsg?.destination || rawMsg?.egressDestination || rawMsg?.egress?.destination,
      deliveredAt: rawMsg?.deliveredAt || rawMsg?.finalizedAt || new Date().toISOString(),
      providerMessageId: rawMsg?.providerMessageId || rawMsg?.egress?.providerMessageId,
      status: rawMsg?.status || rawMsg?.egress?.status || 'FINALIZED',
      error: rawMsg?.error || rawMsg?.egress?.error || null,
      metadata: rawMsg?.metadata || rawMsg?.egress?.metadata,
    });
    const patch = stripUndefinedDeep({
      status: 'FINALIZED',
      finalizedAt: delivery.deliveredAt,
      delivery,
      expireAt: computeExpireAt({ baseDate: delivery.deliveredAt, qosTtlSeconds: rawMsg?.qos?.persistenceTtlSec }),
      currentProjection: {
        annotations: Array.isArray(rawMsg?.annotations) ? rawMsg.annotations : undefined,
        candidates: Array.isArray(rawMsg?.candidates) ? rawMsg.candidates : undefined,
      },
    });
    await this.store.applyFinalization(correlationId, patch as Partial<EventAggregateV2>);
    this.logger.info('persistence.finalize.compat.ok', { correlationId, status: delivery.status });
  }

  async applySnapshotEvent(rawMsg: any): Promise<{ aggregate: EventAggregateV2; snapshot: EventSnapshotDocV1; duplicate: boolean }> {
    const snapshotEvent = normalizeSnapshotEvent(rawMsg);
    if (!snapshotEvent.correlationId) throw new Error('missing_correlationId');
    if (!snapshotEvent.idempotencyKey) throw new Error('missing_idempotencyKey');
    if (!snapshotEvent.event) throw new Error('missing_event');

    const expireAt = computeExpireAt({
      baseDate: snapshotEvent.delivery?.deliveredAt || snapshotEvent.deadletter?.at || snapshotEvent.capturedAt,
      qosTtlSeconds: snapshotEvent.event?.qos?.persistenceTtlSec,
    });

    // Build initial aggregate (for race condition case where snapshot arrives before ingress)
    const capturedAt = snapshotEvent.event?.ingress?.ingressAt || snapshotEvent.capturedAt;
    const initialAggregate: EventAggregateV2 = stripUndefinedDeep({
      correlationId: snapshotEvent.correlationId,
      eventType: snapshotEvent.event?.type || 'unknown',
      source: snapshotEvent.event?.ingress?.source || 'unknown',
      channel: snapshotEvent.event?.ingress?.channel,
      status: 'INGESTED',
      ingressAt: capturedAt,
      latestStage: snapshotEvent.stage,
      latestStepId: snapshotEvent.stepId,
      initialSnapshotId: buildSnapshotId(snapshotEvent.correlationId, 1, snapshotEvent.kind),
      latestSnapshotId: buildSnapshotId(snapshotEvent.correlationId, 1, snapshotEvent.kind),
      snapshotCount: 0,
      identitySummary: snapshotEvent.event?.identity ? {
        externalId: snapshotEvent.event.identity?.external?.id,
        platform: snapshotEvent.event.identity?.external?.platform,
        displayName: snapshotEvent.event.identity?.user?.displayName || snapshotEvent.event.identity?.external?.displayName,
        userId: snapshotEvent.event.identity?.user?.id,
      } : undefined,
      currentProjection: {
        annotations: snapshotEvent.event?.annotations,
        candidates: snapshotEvent.event?.candidates,
        routing: snapshotEvent.event?.routing,
        metadata: snapshotEvent.event?.metadata,
      },
      expireAt,
    }) as EventAggregateV2;

    // Helper to build snapshot from current aggregate
    const buildSnapshot = (aggregate: EventAggregateV2) => {
      const sequence = (aggregate.snapshotCount || 0) + 1;
      const snapshotId = buildSnapshotId(snapshotEvent.correlationId, sequence, snapshotEvent.kind);
      return buildSnapshotDoc({
        snapshotId,
        sequence,
        kind: snapshotEvent.kind,
        capturedAt: snapshotEvent.capturedAt,
        sourceService: snapshotEvent.sourceService,
        sourceTopic: snapshotEvent.sourceTopic,
        idempotencyKey: snapshotEvent.idempotencyKey,
        event: snapshotEvent.event,
        stage: snapshotEvent.stage,
        stepId: snapshotEvent.stepId,
        attempt: snapshotEvent.attempt,
        changeSummary: snapshotEvent.changeSummary,
        delivery: snapshotEvent.delivery,
        deadletter: snapshotEvent.deadletter,
        expireAt,
      });
    };

    // Persist via repository (handles idempotency check + transaction)
    // The repository will read the aggregate inside the transaction and handle all logic
    const result = await this.store.applySnapshotEvent(
      snapshotEvent,
      initialAggregate,
      buildSnapshot,
      applySnapshotToAggregate
    );

    this.logger.info('persistence.snapshot.ok', {
      correlationId: snapshotEvent.correlationId,
      kind: snapshotEvent.kind,
      duplicate: result.duplicate,
      snapshotId: result.snapshot.snapshotId,
      sequence: result.snapshot.sequence,
    });
    return result;
  }

  /** Convert dead-letter payloads into canonical snapshot events. */
  async applyDeadLetter(rawMsg: any): Promise<void> {
    const correlationId = String(rawMsg?.correlationId || rawMsg?.envelope?.correlationId || '');
    if (!correlationId) {
      this.logger.warn('persistence.deadletter.missing_correlationId', { type: rawMsg?.type });
      return;
    }
    const snapshotEvent: PersistenceSnapshotEventV1 = normalizeDeadLetterPayload(rawMsg);
    try {
      await this.applySnapshotEvent(snapshotEvent);
      this.logger.info('persistence.deadletter.ok', { correlationId, reason: snapshotEvent.deadletter?.reason });
    } catch (error: any) {
      this.logger.warn('persistence.deadletter.snapshot_apply_failed', {
        correlationId,
        error: error?.message || String(error),
      });
      throw error;
    }
  }

  /**
   * Upsert source status/state into the 'sources' collection.
   */
  async upsertSourceState(evt: InternalEventV2): Promise<void> {
    let patch: any;
    if (evt.type === 'system.source.status') {
      patch = normalizeSourceStatus(evt);
    } else if (evt.type === 'system.stream.online' || evt.type === 'system.stream.offline') {
      patch = normalizeStreamEvent(evt);
    }

    if (!patch || !patch.platform || !patch.id) {
      this.logger.warn('persistence.upsert_source.invalid_payload', { type: evt.type, platform: patch?.platform, id: patch?.id });
      return;
    }

    const docId = `${patch.platform}:${patch.id}`;
    await this.store.upsertSourceState(docId, patch);
    this.logger.info('persistence.upsert_source.ok', { docId, type: evt.type });
  }
}
