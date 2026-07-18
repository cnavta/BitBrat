import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore, QueryFilter } from '../../common/persistence/interfaces';
import type { StreamObserver } from '../../types/sessi';
import type { InternalEventV2, AnnotationV1 } from '../../types/events';

// =============================================================================
// Stream Analyst Repository Abstraction
// =============================================================================

export interface SummarizationRun {
  observerId: string;
  windowStart: string;
  at: string;
  summary: string;
  requestId?: string;
}

export interface EventQueryOptions {
  collectionName: string;
  timeField: string;
  startTime: string;
  eventType?: string;
  filters?: Record<string, any>;
}

/**
 * Interface for stream analyst storage operations.
 */
export interface IStreamAnalystStore {
  /**
   * Get stream observer by ID.
   */
  getStreamObserver(observerId: string): Promise<StreamObserver | null>;

  /**
   * Get summarization run by idempotency key.
   */
  getSummarizationRun(idempotencyKey: string): Promise<SummarizationRun | null>;

  /**
   * Create summarization run.
   */
  setSummarizationRun(idempotencyKey: string, run: SummarizationRun): Promise<void>;

  /**
   * Query events within time window with filters.
   */
  queryEvents(options: EventQueryOptions): Promise<InternalEventV2[]>;

  /**
   * Persist annotations to an event (using transaction in Firestore, fetch-modify-update in PostgreSQL).
   */
  persistAnnotations(eventId: string, collectionName: string, annotations: AnnotationV1[]): Promise<void>;
}

/**
 * Firestore implementation of stream analyst store.
 */
export class FirestoreStreamAnalystStore implements IStreamAnalystStore {
  constructor(private readonly firestore: Firestore) {}

  async getStreamObserver(observerId: string): Promise<StreamObserver | null> {
    const doc = await this.firestore.collection('stream_observers').doc(observerId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as StreamObserver;
  }

  async getSummarizationRun(idempotencyKey: string): Promise<SummarizationRun | null> {
    const doc = await this.firestore.collection('summarization_runs').doc(idempotencyKey).get();
    if (!doc.exists) return null;
    return doc.data() as SummarizationRun;
  }

  async setSummarizationRun(idempotencyKey: string, run: SummarizationRun): Promise<void> {
    await this.firestore.collection('summarization_runs').doc(idempotencyKey).set(run);
  }

  async queryEvents(options: EventQueryOptions): Promise<InternalEventV2[]> {
    let query: any = this.firestore.collection(options.collectionName)
      .where(options.timeField, '>=', options.startTime)
      .orderBy(options.timeField, 'desc');

    if (options.eventType && options.collectionName === 'events') {
      query = query.where('eventType', '==', options.eventType);
    }

    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        query = query.where(key, '==', value);
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      const eventData = { ...data, id: doc.id };

      // Normalize prompt_logs to InternalEventV2-like structure
      if (options.collectionName === 'prompt_logs') {
        return {
          ...eventData,
          ingressAt: data.createdAt,
          eventType: 'prompt_log.v1',
          message: {
            text: data.response?.text || data.prompt || JSON.stringify(data)
          }
        } as any;
      }
      return eventData as InternalEventV2;
    });
  }

  async persistAnnotations(eventId: string, collectionName: string, annotations: AnnotationV1[]): Promise<void> {
    const docRef = this.firestore.collection(collectionName).doc(eventId);
    await this.firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return;

      const currentAnnotations = doc.data()?.annotations || [];
      transaction.update(docRef, {
        annotations: [...currentAnnotations, ...annotations],
        updatedAt: new Date().toISOString()
      });
    });
  }
}

/**
 * PostgreSQL implementation of stream analyst store via IDocumentStore.
 */
export class DocumentStoreStreamAnalystStore implements IStreamAnalystStore {
  constructor(private readonly store: IDocumentStore) {}

  async getStreamObserver(observerId: string): Promise<StreamObserver | null> {
    return await this.store.get('stream_observers', observerId) as StreamObserver | null;
  }

  async getSummarizationRun(idempotencyKey: string): Promise<SummarizationRun | null> {
    return await this.store.get('summarization_runs', idempotencyKey) as SummarizationRun | null;
  }

  async setSummarizationRun(idempotencyKey: string, run: SummarizationRun): Promise<void> {
    await this.store.set('summarization_runs', idempotencyKey, run);
  }

  async queryEvents(options: EventQueryOptions): Promise<InternalEventV2[]> {
    const filters: QueryFilter[] = [
      { field: options.timeField, operator: '>=', value: options.startTime },
    ];

    if (options.eventType && options.collectionName === 'events') {
      filters.push({ field: 'eventType', operator: '==', value: options.eventType });
    }

    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        filters.push({ field: key, operator: '==', value });
      }
    }

    const records = await this.store.query(options.collectionName, {
      filters,
      orderBy: { field: options.timeField, direction: 'desc' },
    });

    // Normalize prompt_logs to InternalEventV2-like structure
    if (options.collectionName === 'prompt_logs') {
      return records.map((data: any) => ({
        ...data,
        ingressAt: data.createdAt,
        eventType: 'prompt_log.v1',
        message: {
          text: data.response?.text || data.prompt || JSON.stringify(data)
        }
      })) as InternalEventV2[];
    }

    return records as InternalEventV2[];
  }

  async persistAnnotations(eventId: string, collectionName: string, annotations: AnnotationV1[]): Promise<void> {
    // PostgreSQL: Fetch-modify-update pattern (no transaction needed for single document)
    const event = await this.store.get(collectionName, eventId);
    if (!event) return;

    const currentAnnotations = (event as any).annotations || [];
    await this.store.set(collectionName, eventId, {
      ...event,
      annotations: [...currentAnnotations, ...annotations],
      updatedAt: new Date().toISOString()
    });
  }
}

/**
 * Factory function to create stream analyst store based on backend detection.
 */
export function createStreamAnalystStore(
  dbOrStore?: any
): IStreamAnalystStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreStreamAnalystStore(dbOrStore);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreStreamAnalystStore(dbOrStore);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error(
      'createStreamAnalystStore: PostgreSQL driver selected but no IDocumentStore instance provided'
    );
  }

  // Default to Firestore (for test environments where Firestore is not initialized)
  return new FirestoreStreamAnalystStore(undefined as any);
}
