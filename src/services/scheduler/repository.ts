import { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { IDocumentStore, QueryFilter } from '../../common/persistence/interfaces';
import { InternalEventType, MessageV1, AnnotationV1, CandidateV1, QOSV1, ExternalEventV1, Egress, Ingress, Identity } from '../../types/events';

// =============================================================================
// Schedule Repository Abstraction
// =============================================================================

/**
 * Full InternalEventV2 authoring shape stored on a schedule.
 * Server-owned envelope fields are filled at execution time.
 */
export interface ScheduledEventInput {
  type: InternalEventType;
  egress?: Egress;
  ingress?: Pick<Partial<Ingress>, 'connector' | 'channel'>;
  identity?: Identity;
  payload?: Record<string, any>;
  message?: Partial<MessageV1>;
  annotations?: AnnotationV1[];
  candidates?: CandidateV1[];
  qos?: QOSV1;
  externalEvent?: ExternalEventV1;
  metadata?: Record<string, any>;
}

/**
 * Schedule document structure.
 */
export interface ScheduleDoc {
  id: string;
  title: string;
  description?: string;
  schedule: {
    type: 'once' | 'cron';
    value: string;
  };
  event: ScheduledEventInput;
  topic?: string;
  enabled: boolean;
  lastRun?: Date | string;
  nextRun?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Interface for schedule storage operations.
 * Supports both Firestore and PostgreSQL via IDocumentStore.
 */
export interface IScheduleRepository {
  /**
   * List all schedules, optionally filtering by enabled status.
   * @param enabledOnly - If true, only return enabled schedules
   * @returns Array of schedule documents
   */
  list(enabledOnly?: boolean): Promise<ScheduleDoc[]>;

  /**
   * Get a schedule by ID.
   * @param id - Schedule ID
   * @returns Schedule document or null if not found
   */
  get(id: string): Promise<ScheduleDoc | null>;

  /**
   * Create a new schedule.
   * @param schedule - Schedule document
   */
  create(schedule: ScheduleDoc): Promise<void>;

  /**
   * Update an existing schedule.
   * @param id - Schedule ID
   * @param updates - Partial schedule updates
   */
  update(id: string, updates: Partial<ScheduleDoc>): Promise<void>;

  /**
   * Delete a schedule.
   * @param id - Schedule ID
   */
  delete(id: string): Promise<void>;

  /**
   * Get all enabled schedules whose nextRun is before or equal to the given time.
   * @param beforeOrAt - Time threshold
   * @returns Array of schedule documents ready to run
   */
  getDueSchedules(beforeOrAt: Date): Promise<ScheduleDoc[]>;
}

/**
 * Firestore-based schedule repository implementation.
 */
export class FirestoreScheduleRepository implements IScheduleRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionName: string = 'schedules'
  ) {}

  async list(enabledOnly = false): Promise<ScheduleDoc[]> {
    let query: any = this.firestore.collection(this.collectionName);
    if (enabledOnly) {
      query = query.where('enabled', '==', true);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        lastRun: data.lastRun ? data.lastRun.toDate() : undefined,
        nextRun: data.nextRun ? data.nextRun.toDate() : undefined,
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
      };
    });
  }

  async get(id: string): Promise<ScheduleDoc | null> {
    const doc = await this.firestore.collection(this.collectionName).doc(id).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    if (!data) return null;

    return {
      id: doc.id,
      ...data,
      lastRun: data.lastRun ? data.lastRun.toDate() : undefined,
      nextRun: data.nextRun ? data.nextRun.toDate() : undefined,
      createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
      updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
    } as ScheduleDoc;
  }

  async create(schedule: ScheduleDoc): Promise<void> {
    const { id, ...data } = schedule;
    await this.firestore.collection(this.collectionName).doc(id).set({
      ...data,
      lastRun: data.lastRun ? Timestamp.fromDate(new Date(data.lastRun)) : undefined,
      nextRun: data.nextRun ? Timestamp.fromDate(new Date(data.nextRun)) : undefined,
      createdAt: Timestamp.fromDate(new Date(data.createdAt)),
      updatedAt: Timestamp.fromDate(new Date(data.updatedAt)),
    });
  }

  async update(id: string, updates: Partial<ScheduleDoc>): Promise<void> {
    const firestoreUpdates: any = { ...updates };

    if (updates.lastRun) {
      firestoreUpdates.lastRun = Timestamp.fromDate(new Date(updates.lastRun));
    }
    if (updates.nextRun) {
      firestoreUpdates.nextRun = Timestamp.fromDate(new Date(updates.nextRun));
    }
    if (updates.updatedAt) {
      firestoreUpdates.updatedAt = Timestamp.fromDate(new Date(updates.updatedAt));
    }

    await this.firestore.collection(this.collectionName).doc(id).update(firestoreUpdates);
  }

  async delete(id: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(id).delete();
  }

  async getDueSchedules(beforeOrAt: Date): Promise<ScheduleDoc[]> {
    const snapshot = await this.firestore.collection(this.collectionName)
      .where('enabled', '==', true)
      .where('nextRun', '<=', Timestamp.fromDate(beforeOrAt))
      .get();

    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        lastRun: data.lastRun ? data.lastRun.toDate() : undefined,
        nextRun: data.nextRun ? data.nextRun.toDate() : undefined,
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
      };
    });
  }
}

/**
 * PostgreSQL-based schedule repository implementation via IDocumentStore.
 */
export class DocumentStoreScheduleRepository implements IScheduleRepository {
  constructor(
    private readonly store: IDocumentStore,
    private readonly tableName: string = 'schedules'
  ) {}

  async list(enabledOnly = false): Promise<ScheduleDoc[]> {
    const filters: QueryFilter[] = enabledOnly ? [{ field: 'enabled', operator: '==', value: true }] : [];
    const records = await this.store.query(this.tableName, { filters });

    return records.map(this.fromStore);
  }

  async get(id: string): Promise<ScheduleDoc | null> {
    const record = await this.store.get(this.tableName, id);
    if (!record) {
      return null;
    }

    return this.fromStore(record);
  }

  async create(schedule: ScheduleDoc): Promise<void> {
    await this.store.set(this.tableName, schedule.id, this.toStore(schedule));
  }

  async update(id: string, updates: Partial<ScheduleDoc>): Promise<void> {
    const existing = await this.store.get(this.tableName, id);
    if (!existing) {
      throw new Error(`Schedule ${id} not found`);
    }

    const merged = { ...existing, ...this.toStore(updates) };
    await this.store.set(this.tableName, id, merged);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(this.tableName, id);
  }

  async getDueSchedules(beforeOrAt: Date): Promise<ScheduleDoc[]> {
    const filters: QueryFilter[] = [
      { field: 'enabled', operator: '==', value: true },
      { field: 'nextRun', operator: '<=', value: beforeOrAt.toISOString() },
    ];

    const records = await this.store.query(this.tableName, { filters });
    return records.map(this.fromStore);
  }

  private toStore(schedule: Partial<ScheduleDoc>): any {
    const stored: any = { ...schedule };

    if (schedule.lastRun) {
      stored.lastRun = schedule.lastRun instanceof Date ? schedule.lastRun.toISOString() : schedule.lastRun;
    }
    if (schedule.nextRun) {
      stored.nextRun = schedule.nextRun instanceof Date ? schedule.nextRun.toISOString() : schedule.nextRun;
    }
    if (schedule.createdAt) {
      stored.createdAt = schedule.createdAt instanceof Date ? schedule.createdAt.toISOString() : schedule.createdAt;
    }
    if (schedule.updatedAt) {
      stored.updatedAt = schedule.updatedAt instanceof Date ? schedule.updatedAt.toISOString() : schedule.updatedAt;
    }

    return stored;
  }

  private fromStore(record: any): ScheduleDoc {
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      schedule: record.schedule,
      event: record.event,
      topic: record.topic,
      enabled: record.enabled,
      lastRun: record.lastRun ? new Date(record.lastRun) : undefined,
      nextRun: record.nextRun ? new Date(record.nextRun) : undefined,
      createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
    };
  }
}

/**
 * Factory function to create schedule repository based on backend detection.
 *
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param collectionOrTable - Collection name (Firestore) or table name (PostgreSQL)
 * @returns IScheduleRepository implementation
 */
export function createScheduleRepository(
  dbOrStore?: any,
  collectionOrTable?: string
): IScheduleRepository {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreScheduleRepository(dbOrStore, collectionOrTable || 'schedules');
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreScheduleRepository(dbOrStore, collectionOrTable || 'schedules');
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreScheduleRepository(store, collectionOrTable || 'schedules');
  }

  // Default to Firestore (for test environments where Firestore is not initialized)
  return new FirestoreScheduleRepository(undefined as any, collectionOrTable || 'schedules');
}
