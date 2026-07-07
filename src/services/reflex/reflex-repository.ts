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
 * Repository for managing reflexes in Firestore.
 *
 * Provides:
 * - CRUD operations (getAll, getById, create, update, delete)
 * - Real-time subscription using onSnapshot
 * - Timestamp conversion (Firestore → ISO strings)
 * - Soft delete semantics (active=false)
 * - Error handling with typed exceptions
 */
export class ReflexRepository {
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
