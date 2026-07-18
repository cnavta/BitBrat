import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore, QueryFilter } from '../../common/persistence/interfaces';
import type {
  EventAggregateV2,
  EventSnapshotDocV1,
  InternalEventV2,
  PersistenceSnapshotEventV1,
} from '../../types/events';
import {
  COLLECTION_EVENTS,
  COLLECTION_SOURCES,
  SUBCOLLECTION_SNAPSHOTS,
  stripUndefinedDeep,
} from './model';

// =============================================================================
// Persistence Store Repository Abstraction
// =============================================================================

export interface UpsertIngressResult {
  aggregate: EventAggregateV2;
  snapshot: EventSnapshotDocV1;
  created: boolean;
}

export interface ApplySnapshotResult {
  aggregate: EventAggregateV2;
  snapshot: EventSnapshotDocV1;
  duplicate: boolean;
}

/**
 * Interface for event persistence storage operations.
 */
export interface IPersistenceStore {
  /**
   * Upsert the aggregate + initial snapshot by correlationId. Idempotent.
   * @param aggregate - Event aggregate document
   * @param snapshot - Initial snapshot document
   * @returns Result with created flag
   */
  upsertIngressEvent(
    aggregate: EventAggregateV2,
    snapshot: EventSnapshotDocV1
  ): Promise<UpsertIngressResult>;

  /**
   * Apply a finalization patch to the aggregate.
   * @param correlationId - Event correlation ID
   * @param patch - Partial aggregate updates
   */
  applyFinalization(correlationId: string, patch: Partial<EventAggregateV2>): Promise<void>;

  /**
   * Apply a snapshot event with transaction support.
   * Handles:
   * - Idempotency check (query snapshots for matching idempotencyKey)
   * - Aggregate creation if missing (race condition)
   * - Snapshot sequence incrementing
   * - Aggregate + snapshot updates
   *
   * @param snapshotEvent - Normalized snapshot event
   * @param initialAggregate - Initial aggregate to create if missing
   * @param buildSnapshot - Function to build snapshot from aggregate
   * @param applyToAggregate - Function to apply snapshot to aggregate
   * @returns Result with duplicate flag
   */
  applySnapshotEvent(
    snapshotEvent: PersistenceSnapshotEventV1,
    initialAggregate: EventAggregateV2,
    buildSnapshot: (aggregate: EventAggregateV2) => EventSnapshotDocV1,
    applyToAggregate: (aggregate: EventAggregateV2, snapshot: EventSnapshotDocV1, sequence: number) => EventAggregateV2
  ): Promise<ApplySnapshotResult>;

  /**
   * Upsert source status/state document.
   * @param docId - Source document ID (e.g., "twitch:12345")
   * @param patch - Partial source state updates
   */
  upsertSourceState(docId: string, patch: any): Promise<void>;
}

/**
 * Firestore implementation of persistence store with transaction support.
 */
export class FirestorePersistenceStore implements IPersistenceStore {
  constructor(private readonly firestore: Firestore) {}

  private docRef(correlationId: string) {
    return this.firestore.collection(COLLECTION_EVENTS).doc(correlationId);
  }

  private snapshotsRef(correlationId: string) {
    return this.docRef(correlationId).collection(SUBCOLLECTION_SNAPSHOTS);
  }

  async upsertIngressEvent(
    aggregate: EventAggregateV2,
    snapshot: EventSnapshotDocV1
  ): Promise<UpsertIngressResult> {
    if (!aggregate.correlationId) throw new Error('missing_correlationId');

    const ref = this.docRef(aggregate.correlationId);
    const snapshotRef = this.snapshotsRef(aggregate.correlationId).doc(snapshot.snapshotId);
    let created = false;

    await this.firestore.runTransaction(async (transaction: any) => {
      const existing = await transaction.get(ref);
      if (existing?.exists) {
        return;
      }
      transaction.set(ref, stripUndefinedDeep(aggregate));
      transaction.set(snapshotRef, stripUndefinedDeep(snapshot));
      created = true;
    });

    return { aggregate, snapshot, created };
  }

  async applyFinalization(correlationId: string, patch: Partial<EventAggregateV2>): Promise<void> {
    const ref = this.docRef(correlationId);
    await ref.set(stripUndefinedDeep(patch) as any, { merge: true });
  }

  async applySnapshotEvent(
    snapshotEvent: PersistenceSnapshotEventV1,
    initialAggregate: EventAggregateV2,
    buildSnapshot: (aggregate: EventAggregateV2) => EventSnapshotDocV1,
    applyToAggregate: (aggregate: EventAggregateV2, snapshot: EventSnapshotDocV1, sequence: number) => EventAggregateV2
  ): Promise<ApplySnapshotResult> {
    const aggregateRef = this.docRef(snapshotEvent.correlationId!);
    const snapshotsRef = this.snapshotsRef(snapshotEvent.correlationId!);

    let nextAggregate: EventAggregateV2 | undefined;
    let nextSnapshot: EventSnapshotDocV1 | undefined;
    let duplicate = false;

    await this.firestore.runTransaction(async (transaction: any) => {
      const aggregateDoc = await transaction.get(aggregateRef);
      let aggregate: EventAggregateV2;

      if (!aggregateDoc?.exists) {
        // Race condition: snapshot arrived before ingress created the aggregate
        aggregate = initialAggregate;
      } else {
        aggregate = aggregateDoc.data() as EventAggregateV2;
      }

      // Idempotency check
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

      // Build and apply snapshot
      nextSnapshot = buildSnapshot(aggregate);
      const sequence = nextSnapshot.sequence;
      nextAggregate = applyToAggregate(aggregate, nextSnapshot, sequence);

      transaction.set(aggregateRef, stripUndefinedDeep(nextAggregate));
      transaction.set(snapshotsRef.doc(nextSnapshot.snapshotId), stripUndefinedDeep(nextSnapshot));
    });

    if (!nextAggregate || !nextSnapshot) {
      throw new Error('snapshot_apply_incomplete');
    }

    return { aggregate: nextAggregate, snapshot: nextSnapshot, duplicate };
  }

  async upsertSourceState(docId: string, patch: any): Promise<void> {
    const ref = this.firestore.collection(COLLECTION_SOURCES).doc(docId);
    await ref.set(stripUndefinedDeep(patch), { merge: true });
  }
}

/**
 * PostgreSQL implementation of persistence store via IDocumentStore.
 *
 * Note: Firestore subcollections are flattened into separate tables:
 * - events/{correlationId} → events table
 * - events/{correlationId}/snapshots/{snapshotId} → snapshots table with correlationId field
 */
export class DocumentStorePersistenceStore implements IPersistenceStore {
  constructor(private readonly store: IDocumentStore) {}

  async upsertIngressEvent(
    aggregate: EventAggregateV2,
    snapshot: EventSnapshotDocV1
  ): Promise<UpsertIngressResult> {
    if (!aggregate.correlationId) throw new Error('missing_correlationId');

    // PostgreSQL: Check if aggregate exists
    const existing = await this.store.get(COLLECTION_EVENTS, aggregate.correlationId);
    let created = false;

    if (!existing) {
      // Create aggregate and snapshot
      await this.store.set(COLLECTION_EVENTS, aggregate.correlationId, stripUndefinedDeep(aggregate));
      await this.store.set(SUBCOLLECTION_SNAPSHOTS, snapshot.snapshotId, stripUndefinedDeep({
        ...snapshot,
        correlationId: aggregate.correlationId, // Add FK for flattened schema
      }));
      created = true;
    }

    return { aggregate, snapshot, created };
  }

  async applyFinalization(correlationId: string, patch: Partial<EventAggregateV2>): Promise<void> {
    // PostgreSQL: Fetch-modify-update
    const existing = await this.store.get(COLLECTION_EVENTS, correlationId);
    if (!existing) {
      throw new Error(`Aggregate not found: ${correlationId}`);
    }

    const merged = { ...existing, ...stripUndefinedDeep(patch) };
    await this.store.set(COLLECTION_EVENTS, correlationId, merged);
  }

  async applySnapshotEvent(
    snapshotEvent: PersistenceSnapshotEventV1,
    initialAggregate: EventAggregateV2,
    buildSnapshot: (aggregate: EventAggregateV2) => EventSnapshotDocV1,
    applyToAggregate: (aggregate: EventAggregateV2, snapshot: EventSnapshotDocV1, sequence: number) => EventAggregateV2
  ): Promise<ApplySnapshotResult> {
    // PostgreSQL: Fetch-modify-update pattern (no transactions for now)
    const correlationId = snapshotEvent.correlationId!;

    // Get or create aggregate
    let aggregate = await this.store.get(COLLECTION_EVENTS, correlationId);
    if (!aggregate) {
      // Race condition: snapshot arrived before ingress
      aggregate = initialAggregate;
    }

    // Idempotency check: Query snapshots by correlationId + idempotencyKey
    const filters: QueryFilter[] = [
      { field: 'correlationId', operator: '==', value: correlationId },
      { field: 'idempotencyKey', operator: '==', value: snapshotEvent.idempotencyKey },
    ];
    const existingSnapshots = await this.store.query(SUBCOLLECTION_SNAPSHOTS, { filters, limit: 1 });

    if (existingSnapshots.length > 0) {
      // Duplicate
      return {
        aggregate: aggregate as EventAggregateV2,
        snapshot: existingSnapshots[0] as EventSnapshotDocV1,
        duplicate: true,
      };
    }

    // Build and apply snapshot
    const newSnapshot = buildSnapshot(aggregate as EventAggregateV2);
    const sequence = newSnapshot.sequence;
    const updatedAggregate = applyToAggregate(aggregate as EventAggregateV2, newSnapshot, sequence);

    // Persist
    await this.store.set(COLLECTION_EVENTS, correlationId, stripUndefinedDeep(updatedAggregate));
    await this.store.set(SUBCOLLECTION_SNAPSHOTS, newSnapshot.snapshotId, stripUndefinedDeep({
      ...newSnapshot,
      correlationId, // Add FK for flattened schema
    }));

    return {
      aggregate: updatedAggregate,
      snapshot: newSnapshot,
      duplicate: false,
    };
  }

  async upsertSourceState(docId: string, patch: any): Promise<void> {
    // PostgreSQL: Fetch-modify-update with merge
    const existing = await this.store.get(COLLECTION_SOURCES, docId);
    const merged = existing ? { ...existing, ...stripUndefinedDeep(patch) } : stripUndefinedDeep(patch);
    await this.store.set(COLLECTION_SOURCES, docId, merged);
  }
}

/**
 * Factory function to create persistence store based on backend detection.
 */
export function createPersistenceStore(
  dbOrStore?: any
): IPersistenceStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestorePersistenceStore(dbOrStore);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStorePersistenceStore(dbOrStore);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createPersistenceStore: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Default to Firestore (for test environments where Firestore is not initialized)
  return new FirestorePersistenceStore(undefined as any);
}
