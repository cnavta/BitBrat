import type { Firestore } from 'firebase-admin/firestore';
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

export interface PersistenceStoreDeps {
  firestore: Firestore;
  logger?: { info: Function; warn: Function; error: Function; debug?: Function };
}

export class PersistenceStore {
  private db: Firestore;
  private logger: Required<PersistenceStoreDeps>['logger'];

  constructor(deps: PersistenceStoreDeps) {
    this.db = deps.firestore;
    this.logger = (deps.logger || console) as any;
  }

  private docRef(correlationId: string) {
    return this.db.collection(COLLECTION_EVENTS).doc(correlationId);
  }

  private snapshotsRef(correlationId: string) {
    return this.docRef(correlationId).collection(SUBCOLLECTION_SNAPSHOTS);
  }

  /** Upsert the aggregate + initial snapshot by correlationId. Idempotent. */
  async upsertIngressEvent(evt: InternalEventV2): Promise<{ aggregate: EventAggregateV2; snapshot: EventSnapshotDocV1; created: boolean }> {
    const expireAt = computeExpireAt({ baseDate: evt.ingress?.ingressAt, qosTtlSeconds: evt.qos?.ttl });
    const normalized = normalizeIngressEvent(evt, expireAt);
    if (!normalized.aggregate.correlationId) throw new Error('missing_correlationId');

    const ref = this.docRef(normalized.aggregate.correlationId);
    const snapshotRef = this.snapshotsRef(normalized.aggregate.correlationId).doc(normalized.snapshot.snapshotId);
    let created = false;

    await this.db.runTransaction(async (transaction: any) => {
      const existing = await transaction.get(ref);
      if (existing?.exists) {
        return;
      }
      transaction.set(ref, stripUndefinedDeep(normalized.aggregate));
      transaction.set(snapshotRef, stripUndefinedDeep(normalized.snapshot));
      created = true;
    });

    this.logger.info('persistence.ingress.ok', {
      correlationId: normalized.aggregate.correlationId,
      status: normalized.aggregate.status,
      created,
    });
    return { ...normalized, created };
  }

  /** Apply a legacy finalization patch as compatibility-only aggregate summary. */
  async applyFinalization(rawMsg: any): Promise<void> {
    const correlationId = String(rawMsg?.correlationId || '');
    if (!correlationId) throw new Error('missing_correlationId');
    const ref = this.docRef(correlationId);
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
      expireAt: computeExpireAt({ baseDate: delivery.deliveredAt, qosTtlSeconds: rawMsg?.qos?.ttl }),
      currentProjection: {
        annotations: Array.isArray(rawMsg?.annotations) ? rawMsg.annotations : undefined,
        candidates: Array.isArray(rawMsg?.candidates) ? rawMsg.candidates : undefined,
      },
    });
    await ref.set(patch as any, { merge: true });
    this.logger.info('persistence.finalize.compat.ok', { correlationId, status: delivery.status });
  }

  async applySnapshotEvent(rawMsg: any): Promise<{ aggregate: EventAggregateV2; snapshot: EventSnapshotDocV1; duplicate: boolean }> {
    const snapshotEvent = normalizeSnapshotEvent(rawMsg);
    if (!snapshotEvent.correlationId) throw new Error('missing_correlationId');
    if (!snapshotEvent.idempotencyKey) throw new Error('missing_idempotencyKey');
    if (!snapshotEvent.event) throw new Error('missing_event');

    const aggregateRef = this.docRef(snapshotEvent.correlationId);
    const snapshotsRef = this.snapshotsRef(snapshotEvent.correlationId);
    const expireAt = computeExpireAt({
      baseDate: snapshotEvent.delivery?.deliveredAt || snapshotEvent.deadletter?.at || snapshotEvent.capturedAt,
      qosTtlSeconds: snapshotEvent.event?.qos?.ttl,
    });

    let nextAggregate: EventAggregateV2 | undefined;
    let nextSnapshot: EventSnapshotDocV1 | undefined;
    let duplicate = false;

    await this.db.runTransaction(async (transaction: any) => {
      const aggregateDoc = await transaction.get(aggregateRef);
      if (!aggregateDoc?.exists) {
        throw new Error('missing_aggregate');
      }

      const aggregate = aggregateDoc.data() as EventAggregateV2;
      const duplicateQuery = snapshotsRef.where('idempotencyKey', '==', snapshotEvent.idempotencyKey).limit(1);
      const duplicateDoc = await transaction.get(duplicateQuery as any);
      const duplicateHit = typeof duplicateDoc?.empty === 'boolean'
        ? !duplicateDoc.empty
        : Array.isArray(duplicateDoc?.docs) && duplicateDoc.docs.length > 0;

      if (duplicateHit) {
        duplicate = true;
        nextAggregate = aggregate;
        const docs = duplicateDoc.docs || [];
        nextSnapshot = docs[0]?.data?.() as EventSnapshotDocV1;
        return;
      }

      const sequence = (aggregate.snapshotCount || 0) + 1;
      const snapshotId = buildSnapshotId(snapshotEvent.correlationId, sequence, snapshotEvent.kind);
      nextSnapshot = buildSnapshotDoc({
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
      nextAggregate = applySnapshotToAggregate(
        { ...aggregate, expireAt },
        nextSnapshot,
        sequence,
      );

      transaction.set(aggregateRef, stripUndefinedDeep(nextAggregate));
      transaction.set(snapshotsRef.doc(snapshotId), stripUndefinedDeep(nextSnapshot));
    });

    if (!nextAggregate || !nextSnapshot) {
      throw new Error('snapshot_apply_incomplete');
    }

    this.logger.info('persistence.snapshot.ok', {
      correlationId: snapshotEvent.correlationId,
      kind: snapshotEvent.kind,
      duplicate,
      snapshotId: nextSnapshot.snapshotId,
      sequence: nextSnapshot.sequence,
    });
    return { aggregate: nextAggregate, snapshot: nextSnapshot, duplicate };
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
    const ref = this.db.collection(COLLECTION_SOURCES).doc(docId);
    
    // Use merge: true to update only the fields present in the patch
    await ref.set(stripUndefinedDeep(patch), { merge: true });
    this.logger.info('persistence.upsert_source.ok', { docId, type: evt.type });
  }
}
