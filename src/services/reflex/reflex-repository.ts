/**
 * Reflex Repository for Firestore Operations
 *
 * Provides CRUD operations and real-time subscription for reflexes in Firestore.
 * Handles timestamp conversion, error handling, and soft delete semantics.
 *
 * Collection: reflexes
 * Query optimization: Uses composite index on (active, priority)
 */

import { getFirestore, Firestore, Timestamp, QuerySnapshot } from 'firebase-admin/firestore';
import { logger } from '../../common/logging';
import { Reflex } from '../../types/reflex.js';

/**
 * Firestore document structure (with Firestore Timestamp types).
 * Internal representation before conversion to Reflex interface.
 */
interface ReflexDocument extends Omit<Reflex, 'createdAt' | 'updatedAt'> {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Callback type for real-time subscription updates.
 */
export type ReflexSubscriptionCallback = (reflexes: Reflex[]) => void;

/**
 * Base repository interface for reflexes
 */
export interface IReflexRepository {
  getAll(): Promise<Reflex[]>;
  getById(id: string): Promise<Reflex | undefined>;
  create(reflex: Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>): Promise<Reflex>;
  update(id: string, updates: Partial<Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Reflex>;
  delete(id: string): Promise<Reflex>;
  subscribe(callback: ReflexSubscriptionCallback): () => void;
}

/**
 * Repository for managing reflexes in Firestore.
 *
 * Provides:
 * - CRUD operations (getAll, getById, create, update, delete)
 * - Real-time subscription using onSnapshot
 * - Timestamp conversion (Firestore → ISO strings)
 * - Soft delete semantics (active=false)
 * - Error handling with typed exceptions
 */
export class ReflexRepository implements IReflexRepository {
  private db: Firestore;
  private collection: string = 'reflexes';

  constructor(db?: Firestore) {
    this.db = db || getFirestore();
  }

  /**
   * Gets all active reflexes, sorted by priority (ascending).
   *
   * Uses composite index: (active=true, priority ASC)
   *
   * @returns Array of active reflexes, sorted by priority
   * @throws {ReflexRepositoryError} If Firestore query fails
   *
   * @example
   * const reflexes = await repository.getAll();
   * // [{ id: '1', priority: 1, ... }, { id: '2', priority: 2, ... }]
   */
  async getAll(): Promise<Reflex[]> {
    try {
      logger.debug('reflex.repository.fetch_all');

      const snapshot = await this.db
        .collection(this.collection)
        .where('active', '==', true)
        .orderBy('priority', 'asc')
        .get();

      const reflexes = snapshot.docs.map(doc => this.documentToReflex(doc.id, doc.data()));

      logger.info('reflex.repository.fetched', {
        count: reflexes.length,
      });

      return reflexes;
    } catch (error) {
      logger.error('reflex.repository.fetch_error', { error: error instanceof Error ? error.message : String(error) });
      throw new ReflexRepositoryError(
        'Failed to fetch reflexes',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Gets a single reflex by ID.
   *
   * @param id - Reflex ID
   * @returns Reflex if found, undefined if not found
   * @throws {ReflexRepositoryError} If Firestore query fails
   *
   * @example
   * const reflex = await repository.getById('reflex-123');
   * if (reflex) {
   *   console.log('Found:', reflex.name);
   * }
   */
  async getById(id: string): Promise<Reflex | undefined> {
    try {
      logger.debug('reflex.repository.fetch_by_id', { id });

      const doc = await this.db.collection(this.collection).doc(id).get();

      if (!doc.exists) {
        logger.debug('reflex.repository.not_found', { id });
        return undefined;
      }

      const reflex = this.documentToReflex(doc.id, doc.data()!);

      logger.debug('reflex.repository.found', {
        id: reflex.id,
        name: reflex.name,
        active: reflex.active,
      });

      return reflex;
    } catch (error) {
      logger.error('reflex.repository.fetch_by_id_error', { id, error: error instanceof Error ? error.message : String(error) });
      throw new ReflexRepositoryError(
        `Failed to fetch reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Creates a new reflex in Firestore.
   *
   * Auto-generates timestamps (createdAt, updatedAt).
   *
   * @param reflex - Reflex to create (without id, createdAt, updatedAt)
   * @returns Created reflex with id and timestamps
   * @throws {ReflexRepositoryError} If Firestore write fails
   *
   * @example
   * const newReflex = await repository.create({
   *   name: 'Fail Overlay',
   *   active: true,
   *   priority: 1,
   *   match: { type: 'exact', pattern: '!fail', field: 'message.text' },
   *   action: { tool: 'obs.set_source_visibility', parameters: { ... } }
   * });
   */
  async create(reflex: Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.create', {
        name: reflex.name,
        priority: reflex.priority,
      });

      const now = Timestamp.now();
      const docRef = this.db.collection(this.collection).doc();

      const document: ReflexDocument = {
        ...reflex,
        id: docRef.id,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(document);

      const created = this.documentToReflex(docRef.id, document);

      logger.info('reflex.repository.created', {
        id: created.id,
        name: created.name,
        priority: created.priority,
      });

      return created;
    } catch (error) {
      logger.error('reflex.repository.create_error', { error: error instanceof Error ? error.message : String(error) });
      throw new ReflexRepositoryError(
        'Failed to create reflex',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Updates an existing reflex in Firestore.
   *
   * Auto-updates updatedAt timestamp.
   *
   * @param id - Reflex ID to update
   * @param updates - Partial reflex fields to update
   * @returns Updated reflex
   * @throws {ReflexNotFoundError} If reflex doesn't exist
   * @throws {ReflexRepositoryError} If Firestore write fails
   *
   * @example
   * const updated = await repository.update('reflex-123', {
   *   active: false,
   *   priority: 10
   * });
   */
  async update(id: string, updates: Partial<Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.update', { id, updates });

      const docRef = this.db.collection(this.collection).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new ReflexNotFoundError(id);
      }

      const now = Timestamp.now();
      await docRef.update({
        ...updates,
        updatedAt: now,
      });

      // Fetch updated document
      const updatedDoc = await docRef.get();
      const updated = this.documentToReflex(updatedDoc.id, updatedDoc.data()!);

      logger.info('reflex.repository.updated', {
        id: updated.id,
        name: updated.name,
      });

      return updated;
    } catch (error) {
      if (error instanceof ReflexNotFoundError) {
        throw error;
      }
      logger.error('reflex.repository.update_error', { id, error: error instanceof Error ? error.message : String(error) });
      throw new ReflexRepositoryError(
        `Failed to update reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Soft deletes a reflex by setting active=false.
   *
   * Does NOT physically delete the document (preserves audit trail).
   *
   * @param id - Reflex ID to delete
   * @returns Updated reflex with active=false
   * @throws {ReflexNotFoundError} If reflex doesn't exist
   * @throws {ReflexRepositoryError} If Firestore write fails
   *
   * @example
   * const deleted = await repository.delete('reflex-123');
   * console.log(deleted.active); // false
   */
  async delete(id: string): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.delete', { id });

      const deleted = await this.update(id, { active: false });

      logger.info('reflex.repository.deleted', {
        id: deleted.id,
        name: deleted.name,
      });

      return deleted;
    } catch (error) {
      if (error instanceof ReflexNotFoundError) {
        throw error;
      }
      logger.error('reflex.repository.delete_error', { id, error: error instanceof Error ? error.message : String(error) });
      throw new ReflexRepositoryError(
        `Failed to delete reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Subscribes to real-time updates for all active reflexes.
   *
   * Uses Firestore onSnapshot for real-time synchronization.
   * Automatically sorts by priority (ascending).
   *
   * @param callback - Function called when reflexes change
   * @returns Unsubscribe function
   *
   * @example
   * const unsubscribe = repository.subscribe((reflexes) => {
   *   console.log('Reflexes updated:', reflexes.length);
   *   cache.refresh(reflexes);
   * });
   *
   * // Later: unsubscribe()
   */
  subscribe(callback: ReflexSubscriptionCallback): () => void {
    logger.debug('reflex.repository.subscribe');

    const unsubscribe = this.db
      .collection(this.collection)
      .where('active', '==', true)
      .orderBy('priority', 'asc')
      .onSnapshot(
        (snapshot: QuerySnapshot) => {
          logger.debug('reflex.repository.snapshot_received', {
            size: snapshot.size,
            changes: snapshot.docChanges().length,
          });

          const reflexes = snapshot.docs.map(doc => this.documentToReflex(doc.id, doc.data()));

          callback(reflexes);
        },
        (error: Error) => {
          logger.error('reflex.repository.snapshot_error', { error: error.message });
          // Note: Firestore will automatically retry on transient errors
        }
      );

    return unsubscribe;
  }

  /**
   * Converts Firestore document to Reflex interface.
   *
   * Handles Timestamp → ISO string conversion.
   *
   * @param id - Document ID
   * @param data - Document data
   * @returns Reflex object
   */
  private documentToReflex(id: string, data: any): Reflex {
    return {
      ...data,
      id,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    };
  }
}

/**
 * DocumentStoreReflexRepository – PostgreSQL implementation
 *
 * Manages reflexes in IDocumentStore with polling-based updates instead of real-time subscriptions.
 */
export class DocumentStoreReflexRepository implements IReflexRepository {
  private store: any; // IDocumentStore
  private tableName: string = 'reflexes';
  private pollInterval: NodeJS.Timeout | null = null;
  private subscribers: Map<number, ReflexSubscriptionCallback> = new Map();
  private nextSubscriberId = 1;
  private cachedReflexes: Reflex[] = [];

  constructor(store: any, refreshIntervalMs = 60000) {
    this.store = store;

    // Start polling if refresh interval is positive
    if (refreshIntervalMs > 0) {
      this.pollInterval = setInterval(async () => {
        try {
          await this.refreshCache();
        } catch (error) {
          logger.error('reflex.repository.poll_error', {
            error: error instanceof Error ? error.message : String(error),
            backend: 'postgres'
          });
        }
      }, refreshIntervalMs);
    }
  }

  /**
   * Refresh the cached reflexes and notify subscribers
   */
  private async refreshCache(): Promise<void> {
    const reflexes = await this.getAll();
    this.cachedReflexes = reflexes;

    // Notify all subscribers
    for (const callback of this.subscribers.values()) {
      try {
        callback(reflexes);
      } catch (error) {
        logger.error('reflex.repository.subscriber_error', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async getAll(): Promise<Reflex[]> {
    try {
      logger.debug('reflex.repository.fetch_all', { backend: 'postgres' });

      const results = await this.store.query(this.tableName, {
        filters: [
          { field: 'active', operator: '==', value: true }
        ]
      });

      // Sort by priority ascending
      const reflexes = results
        .map((doc: any) => this.documentToReflex(doc))
        .sort((a: Reflex, b: Reflex) => a.priority - b.priority);

      logger.info('reflex.repository.fetched', {
        count: reflexes.length,
        backend: 'postgres'
      });

      return reflexes;
    } catch (error) {
      logger.error('reflex.repository.fetch_error', {
        error: error instanceof Error ? error.message : String(error),
        backend: 'postgres'
      });
      throw new ReflexRepositoryError(
        'Failed to fetch reflexes',
        error instanceof Error ? error : undefined
      );
    }
  }

  async getById(id: string): Promise<Reflex | undefined> {
    try {
      logger.debug('reflex.repository.fetch_by_id', { id, backend: 'postgres' });

      const doc = await this.store.get(this.tableName, id);

      if (!doc) {
        logger.debug('reflex.repository.not_found', { id, backend: 'postgres' });
        return undefined;
      }

      const reflex = this.documentToReflex(doc);

      logger.debug('reflex.repository.found', {
        id: reflex.id,
        name: reflex.name,
        active: reflex.active,
        backend: 'postgres'
      });

      return reflex;
    } catch (error) {
      logger.error('reflex.repository.fetch_by_id_error', {
        id,
        error: error instanceof Error ? error.message : String(error),
        backend: 'postgres'
      });
      throw new ReflexRepositoryError(
        `Failed to fetch reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async create(reflex: Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.create', {
        name: reflex.name,
        priority: reflex.priority,
        backend: 'postgres'
      });

      const now = new Date().toISOString();
      const id = `reflex-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const document: Reflex = {
        ...reflex,
        id,
        createdAt: now,
        updatedAt: now,
      };

      await this.store.set(this.tableName, id, document);

      logger.info('reflex.repository.created', {
        id: document.id,
        name: document.name,
        priority: document.priority,
        backend: 'postgres'
      });

      // Trigger cache refresh to notify subscribers
      await this.refreshCache();

      return document;
    } catch (error) {
      logger.error('reflex.repository.create_error', {
        error: error instanceof Error ? error.message : String(error),
        backend: 'postgres'
      });
      throw new ReflexRepositoryError(
        'Failed to create reflex',
        error instanceof Error ? error : undefined
      );
    }
  }

  async update(id: string, updates: Partial<Omit<Reflex, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.update', { id, updates, backend: 'postgres' });

      const existing = await this.store.get(this.tableName, id);

      if (!existing) {
        throw new ReflexNotFoundError(id);
      }

      const now = new Date().toISOString();
      const updated: Reflex = {
        ...existing,
        ...updates,
        id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      await this.store.set(this.tableName, id, updated);

      logger.info('reflex.repository.updated', {
        id: updated.id,
        name: updated.name,
        backend: 'postgres'
      });

      // Trigger cache refresh to notify subscribers
      await this.refreshCache();

      return updated;
    } catch (error) {
      if (error instanceof ReflexNotFoundError) {
        throw error;
      }
      logger.error('reflex.repository.update_error', {
        id,
        error: error instanceof Error ? error.message : String(error),
        backend: 'postgres'
      });
      throw new ReflexRepositoryError(
        `Failed to update reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(id: string): Promise<Reflex> {
    try {
      logger.debug('reflex.repository.delete', { id, backend: 'postgres' });

      const deleted = await this.update(id, { active: false });

      logger.info('reflex.repository.deleted', {
        id: deleted.id,
        name: deleted.name,
        backend: 'postgres'
      });

      return deleted;
    } catch (error) {
      if (error instanceof ReflexNotFoundError) {
        throw error;
      }
      logger.error('reflex.repository.delete_error', {
        id,
        error: error instanceof Error ? error.message : String(error),
        backend: 'postgres'
      });
      throw new ReflexRepositoryError(
        `Failed to delete reflex: ${id}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  subscribe(callback: ReflexSubscriptionCallback): () => void {
    logger.debug('reflex.repository.subscribe', { backend: 'postgres' });

    const id = this.nextSubscriberId++;
    this.subscribers.set(id, callback);

    // Immediately call with current cache
    if (this.cachedReflexes.length > 0) {
      try {
        callback(this.cachedReflexes);
      } catch (error) {
        logger.error('reflex.repository.initial_subscriber_error', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      // Load initial cache
      this.getAll().then(reflexes => {
        this.cachedReflexes = reflexes;
        callback(reflexes);
      }).catch(error => {
        logger.error('reflex.repository.initial_load_error', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(id);
      logger.debug('reflex.repository.unsubscribed', { id, backend: 'postgres' });
    };
  }

  /**
   * Convert document to Reflex interface
   */
  private documentToReflex(data: any): Reflex {
    return {
      ...data,
      id: data.id,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

/**
 * Base error for all reflex repository errors.
 */
export class ReflexRepositoryError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ReflexRepositoryError';
    this.cause = cause;
  }
}

/**
 * Error thrown when a reflex is not found.
 */
export class ReflexNotFoundError extends Error {
  public readonly reflexId: string;

  constructor(reflexId: string) {
    super(`Reflex not found: ${reflexId}`);
    this.name = 'ReflexNotFoundError';
    this.reflexId = reflexId;
  }
}

/**
 * Creates a singleton instance of ReflexRepository.
 *
 * @returns ReflexRepository instance
 */
export function createReflexRepository(): ReflexRepository {
  return new ReflexRepository();
}

/**
 * Factory function to create the appropriate ReflexRepository based on backend
 *
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param refreshIntervalMs - Polling interval for PostgreSQL (default: 60000ms)
 * @returns ReflexRepository instance (Firestore or DocumentStore based)
 */
export function createReflexRepositoryWithBackend(
  dbOrStore?: any,
  refreshIntervalMs = 60000
): IReflexRepository {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new ReflexRepository(dbOrStore);
  }

  // Check if IDocumentStore (has get/set/query methods)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreReflexRepository(dbOrStore, refreshIntervalMs);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    throw new Error('createReflexRepositoryWithBackend: PostgreSQL driver selected but no IDocumentStore instance provided');
  }

  // Default to Firestore
  return new ReflexRepository();
}
