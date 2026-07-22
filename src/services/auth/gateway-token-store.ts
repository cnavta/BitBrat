import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from '../../common/firebase';
import { logger } from '../../common/logging';

/**
 * API Gateway Token document structure
 * Stored in Firestore at: gateways/api/tokens/{token_hash}
 * Stored in PostgreSQL at: api_tokens table with id = {token_hash}
 */
export type GatewayTokenDoc = {
  user_id: string;
  created_at: Date;
  token_hash: string;
};

/**
 * Interface for API Gateway token persistence
 * Abstracts over Firestore and PostgreSQL backends
 */
export interface IGatewayTokenStore {
  /**
   * Store a new API token
   * @param tokenHash - SHA-256 hash of the raw token
   * @param userId - Internal user ID (e.g., "twitch:12345")
   */
  setToken(tokenHash: string, userId: string): Promise<void>;

  /**
   * Retrieve an API token by its hash
   * @param tokenHash - SHA-256 hash of the raw token
   * @returns Token document or null if not found
   */
  getToken(tokenHash: string): Promise<GatewayTokenDoc | null>;

  /**
   * Delete an API token (revocation)
   * @param tokenHash - SHA-256 hash of the raw token
   */
  deleteToken(tokenHash: string): Promise<void>;

  /**
   * Get all tokens for a user
   * @param userId - Internal user ID
   * @returns Array of token documents
   */
  getTokensForUser(userId: string): Promise<GatewayTokenDoc[]>;
}

/**
 * Firestore-backed implementation of IGatewayTokenStore
 * Stores tokens at: gateways/api/tokens/{token_hash}
 */
export class FirestoreGatewayTokenStore implements IGatewayTokenStore {
  private db: Firestore;

  constructor(db?: Firestore) {
    this.db = db || getFirestore();
  }

  private tokenDocRef(tokenHash: string) {
    return this.db.collection('gateways/api/tokens').doc(tokenHash);
  }

  async setToken(tokenHash: string, userId: string): Promise<void> {
    try {
      const now = new Date();
      const tokenDoc: GatewayTokenDoc = {
        user_id: userId,
        created_at: now,
        token_hash: tokenHash,
      };

      await this.tokenDocRef(tokenHash).set(tokenDoc);
      logger.debug('gatewayTokenStore.setToken.ok', { tokenHash, userId, backend: 'firestore' });
    } catch (err: any) {
      logger.error('gatewayTokenStore.setToken.error', {
        error: err?.message || String(err),
        tokenHash,
        userId,
        backend: 'firestore'
      });
      throw err;
    }
  }

  async getToken(tokenHash: string): Promise<GatewayTokenDoc | null> {
    try {
      const snap = await this.tokenDocRef(tokenHash).get();
      if (!snap.exists) {
        logger.debug('gatewayTokenStore.getToken.not_found', { tokenHash, backend: 'firestore' });
        return null;
      }

      const data = snap.data() as any;
      return {
        user_id: data.user_id,
        created_at: data.created_at?.toDate?.() || new Date(data.created_at),
        token_hash: data.token_hash,
      };
    } catch (err: any) {
      logger.error('gatewayTokenStore.getToken.error', {
        error: err?.message || String(err),
        tokenHash,
        backend: 'firestore'
      });
      return null;
    }
  }

  async deleteToken(tokenHash: string): Promise<void> {
    try {
      await this.tokenDocRef(tokenHash).delete();
      logger.debug('gatewayTokenStore.deleteToken.ok', { tokenHash, backend: 'firestore' });
    } catch (err: any) {
      logger.error('gatewayTokenStore.deleteToken.error', {
        error: err?.message || String(err),
        tokenHash,
        backend: 'firestore'
      });
      throw err;
    }
  }

  async getTokensForUser(userId: string): Promise<GatewayTokenDoc[]> {
    try {
      const snapshot = await this.db
        .collection('gateways/api/tokens')
        .where('user_id', '==', userId)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          user_id: data.user_id,
          created_at: data.created_at?.toDate?.() || new Date(data.created_at),
          token_hash: data.token_hash,
        };
      });
    } catch (err: any) {
      logger.error('gatewayTokenStore.getTokensForUser.error', {
        error: err?.message || String(err),
        userId,
        backend: 'firestore'
      });
      return [];
    }
  }
}

/**
 * PostgreSQL-backed implementation of IGatewayTokenStore
 * Uses IDocumentStore with api_tokens table
 */
export class PostgresGatewayTokenStore implements IGatewayTokenStore {
  constructor(
    private readonly store: any, // IDocumentStore
    private readonly tableName = 'api_tokens'
  ) {}

  async setToken(tokenHash: string, userId: string): Promise<void> {
    try {
      const now = new Date();
      const tokenDoc = {
        user_id: userId,
        created_at: now.toISOString(),
        token_hash: tokenHash,
      };

      await this.store.set(this.tableName, tokenHash, tokenDoc);
      logger.debug('gatewayTokenStore.setToken.ok', { tokenHash, userId, backend: 'postgres' });
    } catch (err: any) {
      logger.error('gatewayTokenStore.setToken.error', {
        error: err?.message || String(err),
        tokenHash,
        userId,
        backend: 'postgres'
      });
      throw err;
    }
  }

  async getToken(tokenHash: string): Promise<GatewayTokenDoc | null> {
    try {
      const doc = await this.store.get(this.tableName, tokenHash);

      if (!doc) {
        logger.debug('gatewayTokenStore.getToken.not_found', { tokenHash, backend: 'postgres' });
        return null;
      }

      return {
        user_id: doc.user_id,
        created_at: new Date(doc.created_at),
        token_hash: doc.token_hash,
      };
    } catch (err: any) {
      logger.error('gatewayTokenStore.getToken.error', {
        error: err?.message || String(err),
        tokenHash,
        backend: 'postgres'
      });
      return null;
    }
  }

  async deleteToken(tokenHash: string): Promise<void> {
    try {
      await this.store.delete(this.tableName, tokenHash);
      logger.debug('gatewayTokenStore.deleteToken.ok', { tokenHash, backend: 'postgres' });
    } catch (err: any) {
      logger.error('gatewayTokenStore.deleteToken.error', {
        error: err?.message || String(err),
        tokenHash,
        backend: 'postgres'
      });
      throw err;
    }
  }

  async getTokensForUser(userId: string): Promise<GatewayTokenDoc[]> {
    try {
      // Query all tokens and filter by user_id using IDocumentStore.query
      const allDocs = await this.store.query(this.tableName, {
        filters: [{ field: 'user_id', operator: '==', value: userId }]
      });

      return allDocs.map((doc: any) => ({
        user_id: doc.user_id,
        created_at: new Date(doc.created_at),
        token_hash: doc.token_hash,
      }));
    } catch (err: any) {
      logger.error('gatewayTokenStore.getTokensForUser.error', {
        error: err?.message || String(err),
        userId,
        backend: 'postgres'
      });
      return [];
    }
  }
}

/**
 * Factory function to create the appropriate GatewayTokenStore based on backend
 *
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param options - For PostgreSQL: { tableName }
 * @returns IGatewayTokenStore instance (Firestore or PostgreSQL based)
 */
export function createGatewayTokenStore(
  dbOrStore?: any,
  options?: { tableName?: string }
): IGatewayTokenStore {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreGatewayTokenStore(dbOrStore);
  }

  // Check if IDocumentStore (has get/set methods)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new PostgresGatewayTokenStore(dbOrStore, options?.tableName || 'api_tokens');
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    // Auto-create DocumentStore for PostgreSQL
    const { createDocumentStore } = require('../../common/persistence/factory');
    const store = createDocumentStore();
    return new PostgresGatewayTokenStore(store, options?.tableName || 'api_tokens');
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  return new FirestoreGatewayTokenStore();
}
