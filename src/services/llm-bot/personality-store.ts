/**
 * PersonalityStore Abstraction
 *
 * Provides a unified interface for personality persistence across
 * Firestore and PostgreSQL backends. Used by llm-bot processor for
 * personality resolution during prompt composition.
 *
 * Sprint 344: PostgreSQL Migration Cleanup
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../../common/persistence/interfaces';

/**
 * Personality document structure matching personality.v1.json schema
 */
export interface PersonalityDoc {
  name: string;
  text: string;
  status: 'active' | 'inactive' | 'archived' | string;
  version?: number;
  tags?: string[];
  platform?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  author?: string;
  description?: string;
}

/**
 * Filter options for personality queries
 */
export interface PersonalityFilters {
  status?: 'active' | 'inactive' | 'archived' | string;
  platform?: string;
  model?: string;
  tags?: string[];
}

/**
 * Interface for personality storage operations.
 * Implementations support both Firestore and PostgreSQL.
 */
export interface IPersonalityStore {
  /**
   * Get personality by name, optionally filtered by status.
   * Returns the latest version if multiple exist.
   *
   * @param name - Unique personality name
   * @param status - Optional status filter (default: 'active')
   * @returns PersonalityDoc or undefined if not found
   */
  getByName(name: string, status?: string): Promise<PersonalityDoc | undefined>;

  /**
   * Get active personality by name (convenience method).
   * Equivalent to getByName(name, 'active').
   *
   * @param name - Unique personality name
   * @returns PersonalityDoc or undefined if not found
   */
  getActive(name: string): Promise<PersonalityDoc | undefined>;

  /**
   * List personalities matching filters.
   *
   * @param filters - Optional filters for status, platform, model, tags
   * @returns Array of PersonalityDoc
   */
  list(filters?: PersonalityFilters): Promise<PersonalityDoc[]>;
}

/**
 * Firestore-based personality store implementation.
 *
 * Uses Firestore collection() API to query the 'personalities' collection.
 * Supports filtering by name, status, version with proper ordering.
 */
export class FirestorePersonalityStore implements IPersonalityStore {
  private readonly collectionName: string;

  constructor(
    private readonly firestore: Firestore,
    collectionName: string = 'personalities'
  ) {
    this.collectionName = collectionName;
  }

  async getByName(name: string, status: string = 'active'): Promise<PersonalityDoc | undefined> {
    const snapshot = await this.firestore
      .collection(this.collectionName)
      .where('name', '==', name)
      .where('status', '==', status)
      .orderBy('version', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return undefined;
    }

    return snapshot.docs[0].data() as PersonalityDoc;
  }

  async getActive(name: string): Promise<PersonalityDoc | undefined> {
    return this.getByName(name, 'active');
  }

  async list(filters: PersonalityFilters = {}): Promise<PersonalityDoc[]> {
    let query: any = this.firestore.collection(this.collectionName);

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    if (filters.platform) {
      query = query.where('platform', '==', filters.platform);
    }

    if (filters.model) {
      query = query.where('model', '==', filters.model);
    }

    if (filters.tags && filters.tags.length > 0) {
      query = query.where('tags', 'array-contains-any', filters.tags);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => doc.data() as PersonalityDoc);
  }
}

/**
 * PostgreSQL-based personality store implementation via IDocumentStore.
 *
 * Uses IDocumentStore.query() API to query the 'personalities' table.
 * Filters using JSONB operators for name, status, version, etc.
 */
export class DocumentStorePersonalityStore implements IPersonalityStore {
  private readonly tableName: string;

  constructor(
    private readonly store: IDocumentStore,
    tableName: string = 'personalities'
  ) {
    this.tableName = tableName;
  }

  async getByName(name: string, status: string = 'active'): Promise<PersonalityDoc | undefined> {
    try {
      // Query PostgreSQL using standard QueryFilter format
      // Note: For JSONB @> operator, we need to use PostgreSQL-specific features
      // This is a temporary solution until IDocumentStore supports JSONB operators
      const results = await this.store.query(this.tableName, {
        filters: [
          { field: 'data', operator: '==', value: { name, status } } as any,
        ],
        orderBy: { field: "(data->>'version')::int", direction: 'desc' },
        limit: 1,
      });

      if (results.length === 0) {
        return undefined;
      }

      return results[0] as PersonalityDoc;
    } catch (error: any) {
      // Log error but don't throw - graceful degradation
      console.error('DocumentStorePersonalityStore.getByName error:', error.message);
      return undefined;
    }
  }

  async getActive(name: string): Promise<PersonalityDoc | undefined> {
    return this.getByName(name, 'active');
  }

  async list(filters: PersonalityFilters = {}): Promise<PersonalityDoc[]> {
    try {
      const queryFilters: any[] = [];

      if (filters.status) {
        queryFilters.push({ field: 'data', operator: '==', value: { status: filters.status } });
      }

      if (filters.platform) {
        queryFilters.push({ field: 'data', operator: '==', value: { platform: filters.platform } });
      }

      if (filters.model) {
        queryFilters.push({ field: 'data', operator: '==', value: { model: filters.model } });
      }

      // Note: tags array-contains-any would need custom SQL, skipping for now
      if (filters.tags && filters.tags.length > 0) {
        console.warn('DocumentStorePersonalityStore.list: tags filtering not yet implemented');
      }

      const results = await this.store.query(this.tableName, {
        filters: queryFilters.length > 0 ? queryFilters : undefined,
        orderBy: { field: "(data->>'version')::int", direction: 'desc' },
      });

      return results as PersonalityDoc[];
    } catch (error: any) {
      console.error('DocumentStorePersonalityStore.list error:', error.message);
      return [];
    }
  }
}

/**
 * Factory function to create PersonalityStore based on backend detection.
 *
 * Detection logic:
 * 1. If dbOrStore has .collection() method → Firestore backend
 * 2. If dbOrStore has .query() method → PostgreSQL backend
 * 3. Otherwise → Throw error (no valid backend)
 *
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param collectionOrTable - Collection name (Firestore) or table name (PostgreSQL)
 * @returns IPersonalityStore implementation
 * @throws Error if no valid backend detected
 *
 * @example
 * ```typescript
 * // Firestore backend
 * const store = createPersonalityStore(getFirestore(), 'personalities');
 *
 * // PostgreSQL backend
 * const store = createPersonalityStore(documentStore, 'personalities');
 * ```
 */
export function createPersonalityStore(
  dbOrStore: any,
  collectionOrTable: string = 'personalities'
): IPersonalityStore {
  if (!dbOrStore) {
    throw new Error(
      'createPersonalityStore: dbOrStore parameter is required (Firestore or IDocumentStore)'
    );
  }

  // Check if Firestore instance (has collection() method)
  if (typeof dbOrStore.collection === 'function') {
    return new FirestorePersonalityStore(dbOrStore, collectionOrTable);
  }

  // Check if IDocumentStore instance (has query() method)
  if (typeof dbOrStore.query === 'function' && typeof dbOrStore.get === 'function') {
    return new DocumentStorePersonalityStore(dbOrStore, collectionOrTable);
  }

  throw new Error(
    'createPersonalityStore: Invalid backend. Expected Firestore instance or IDocumentStore.'
  );
}
