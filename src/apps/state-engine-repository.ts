import type { Firestore } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import type { IDocumentStore, QueryFilter } from '../common/persistence/interfaces';
import type { MutationProposal, StateSnapshot, MutationLogEntry } from '../types/state';

// =============================================================================
// State Engine Repository Abstraction
// =============================================================================

export interface CommitMutationResult {
  success: boolean;
  resultingVersion?: number;
  error?: string;
}

/**
 * Interface for state engine storage operations.
 */
export interface IStateEngineStore {
  /**
   * Get state snapshot by key.
   * @param key - State key
   * @returns State snapshot or null if not found
   */
  getState(key: string): Promise<StateSnapshot | null>;

  /**
   * Get state snapshots matching a key prefix.
   * @param prefix - Key prefix to match
   * @returns Map of matching keys to state snapshots
   */
  getStateByPrefix(prefix: string): Promise<Record<string, StateSnapshot>>;

  /**
   * Commit a state mutation with optimistic concurrency control.
   * @param mutation - Mutation proposal
   * @returns Commit result with success status and resulting version
   */
  commitMutation(mutation: MutationProposal): Promise<CommitMutationResult>;

  /**
   * Log a mutation (can be called standalone or within a transaction).
   * @param mutation - Mutation proposal
   * @param status - Mutation status (accepted or rejected)
   * @param error - Error message if rejected
   * @param resultingVersion - Resulting state version if accepted
   */
  logMutation(
    mutation: MutationProposal,
    status: 'accepted' | 'rejected',
    error?: string,
    resultingVersion?: number
  ): Promise<void>;
}

/**
 * Firestore implementation of state engine store with transaction support.
 */
export class FirestoreStateEngineStore implements IStateEngineStore {
  constructor(private readonly firestore: Firestore) {}

  async getState(key: string): Promise<StateSnapshot | null> {
    const doc = await this.firestore.collection('state').doc(key).get();
    if (!doc.exists) {
      return null;
    }
    return doc.data() as StateSnapshot;
  }

  async getStateByPrefix(prefix: string): Promise<Record<string, StateSnapshot>> {
    const snapshot = await this.firestore.collection('state')
      .where(FieldPath.documentId(), '>=', prefix)
      .where(FieldPath.documentId(), '<', prefix + '\uf8ff')
      .get();

    const results: Record<string, StateSnapshot> = {};
    snapshot.forEach(doc => {
      results[doc.id] = doc.data() as StateSnapshot;
    });

    return results;
  }

  async commitMutation(mutation: MutationProposal): Promise<CommitMutationResult> {
    try {
      let resultingVersion: number | undefined;

      await this.firestore.runTransaction(async (transaction) => {
        const stateRef = this.firestore.collection('state').doc(mutation.key);
        const doc = await transaction.get(stateRef);

        let currentVersion = 0;
        if (doc.exists) {
          currentVersion = doc.data()?.version || 0;
        }

        if (mutation.expectedVersion !== undefined && mutation.expectedVersion !== currentVersion) {
          throw new Error(`Version mismatch: expected ${mutation.expectedVersion}, found ${currentVersion}`);
        }

        const nextVersion = currentVersion + 1;
        resultingVersion = nextVersion;

        const snapshot: StateSnapshot = {
          value: mutation.value,
          updatedAt: new Date().toISOString(),
          updatedBy: mutation.actor,
          version: nextVersion,
          ttl: mutation.ttl || null,
          metadata: {
            source: mutation.reason,
            ...mutation.metadata
          }
        };

        transaction.set(stateRef, snapshot);

        // Log mutation within transaction
        const logEntry: MutationLogEntry = {
          ...mutation,
          committedAt: new Date().toISOString(),
          status: 'accepted',
          error: undefined,
          resultingVersion: nextVersion
        };

        const logRef = this.firestore.collection('mutation_log').doc(mutation.id);
        transaction.set(logRef, logEntry);
      });

      return { success: true, resultingVersion };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async logMutation(
    mutation: MutationProposal,
    status: 'accepted' | 'rejected',
    error?: string,
    resultingVersion?: number
  ): Promise<void> {
    // Guard for test environments where Firestore is undefined
    if (!this.firestore) return;

    const logEntry: MutationLogEntry = {
      ...mutation,
      committedAt: new Date().toISOString(),
      status,
      error,
      resultingVersion
    };

    const logRef = this.firestore.collection('mutation_log').doc(mutation.id);
    await logRef.set(logEntry);
  }
}

/**
 * PostgreSQL implementation of state engine store via IDocumentStore.
 */
export class DocumentStoreStateEngineStore implements IStateEngineStore {
  constructor(private readonly store: IDocumentStore) {}

  async getState(key: string): Promise<StateSnapshot | null> {
    return await this.store.get('state', key) as StateSnapshot | null;
  }

  async getStateByPrefix(prefix: string): Promise<Record<string, StateSnapshot>> {
    // PostgreSQL: Use LIKE query to match prefix
    // Note: This requires the IDocumentStore to support prefix queries
    // For now, we'll query all and filter in memory (not optimal for large datasets)
    const filters: QueryFilter[] = [
      { field: 'id', operator: '>=', value: prefix },
      { field: 'id', operator: '<', value: prefix + '\uf8ff' },
    ];

    const records = await this.store.query('state', { filters });

    const results: Record<string, StateSnapshot> = {};
    for (const record of records) {
      const id = (record as any).id;
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        results[id] = record as StateSnapshot;
      }
    }

    return results;
  }

  async commitMutation(mutation: MutationProposal): Promise<CommitMutationResult> {
    try {
      // PostgreSQL: Fetch-modify-update pattern with optimistic concurrency check
      // Note: This is not a true transaction, but provides similar semantics for single-document updates

      const currentState = await this.store.get('state', mutation.key);

      let currentVersion = 0;
      if (currentState) {
        currentVersion = (currentState as any).version || 0;
      }

      if (mutation.expectedVersion !== undefined && mutation.expectedVersion !== currentVersion) {
        throw new Error(`Version mismatch: expected ${mutation.expectedVersion}, found ${currentVersion}`);
      }

      const nextVersion = currentVersion + 1;

      const snapshot: StateSnapshot = {
        value: mutation.value,
        updatedAt: new Date().toISOString(),
        updatedBy: mutation.actor,
        version: nextVersion,
        ttl: mutation.ttl || null,
        metadata: {
          source: mutation.reason,
          ...mutation.metadata
        }
      };

      // Commit state update
      await this.store.set('state', mutation.key, snapshot);

      // Log mutation
      const logEntry: MutationLogEntry = {
        ...mutation,
        committedAt: new Date().toISOString(),
        status: 'accepted',
        error: undefined,
        resultingVersion: nextVersion
      };

      await this.store.set('mutation_log', mutation.id, logEntry);

      return { success: true, resultingVersion: nextVersion };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async logMutation(
    mutation: MutationProposal,
    status: 'accepted' | 'rejected',
    error?: string,
    resultingVersion?: number
  ): Promise<void> {
    const logEntry: MutationLogEntry = {
      ...mutation,
      committedAt: new Date().toISOString(),
      status,
      error,
      resultingVersion
    };

    await this.store.set('mutation_log', mutation.id, logEntry);
  }
}

/**
 * Factory function to create state engine store based on backend detection.
 */
export function createStateEngineStore(
  dbOrStore?: any
): IStateEngineStore {
  // Check if Firestore instance
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreStateEngineStore(dbOrStore);
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreStateEngineStore(dbOrStore);
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreStateEngineStore(store);
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestoreStateEngineStore(undefined as any);
}
