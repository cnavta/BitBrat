import { Firestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { Logger } from '../../common/logging';
import type { IDocumentStore } from '../../common/persistence/interfaces';

export interface TokenInfo {
  token_hash: string;
  uid: string;
  expires_at?: Date | null;
  created_at: Date;
  last_used_at?: Date | null;
}

// =============================================================================
// API Token Store Abstraction
// =============================================================================

/**
 * Interface for API token storage operations.
 * Supports both Firestore and PostgreSQL via IDocumentStore.
 */
export interface IApiTokenStore {
  /**
   * Get token info by hash.
   * @param hash - Token hash
   * @returns TokenInfo or null if not found
   */
  getToken(hash: string): Promise<TokenInfo | null>;

  /**
   * Update last_used_at timestamp for a token (fire-and-forget).
   * @param hash - Token hash
   */
  updateLastUsed(hash: string): Promise<void>;
}

/**
 * Firestore-based API token store implementation.
 */
export class FirestoreApiTokenStore implements IApiTokenStore {
  constructor(
    private readonly firestore: Firestore,
    private readonly logger: Logger,
    private readonly collectionPath = 'gateways/api/tokens'
  ) {}

  async getToken(hash: string): Promise<TokenInfo | null> {
    try {
      const tokenDoc = await this.firestore.collection(this.collectionPath).doc(hash).get();

      if (!tokenDoc.exists) {
        return null;
      }

      const data = tokenDoc.data();
      if (!data) return null;

      return {
        token_hash: hash,
        uid: data.uid || data.user_id,
        expires_at: data.expires_at ? data.expires_at.toDate() : null,
        created_at: data.created_at ? data.created_at.toDate() : new Date(),
        last_used_at: data.last_used_at ? data.last_used_at.toDate() : null,
      };
    } catch (err: any) {
      this.logger.error('firestore.api_token.get_error', { error: err.message, hash: hash.substring(0, 8) });
      return null;
    }
  }

  async updateLastUsed(hash: string): Promise<void> {
    try {
      await this.firestore.collection(this.collectionPath).doc(hash).update({
        last_used_at: new Date()
      });
    } catch (err: any) {
      this.logger.error('firestore.api_token.update_error', { error: err.message, hash: hash.substring(0, 8) });
    }
  }
}

/**
 * PostgreSQL-based API token store implementation via IDocumentStore.
 */
export class DocumentStoreApiTokenStore implements IApiTokenStore {
  constructor(
    private readonly store: IDocumentStore,
    private readonly logger: Logger,
    private readonly tableName = 'api_tokens'
  ) {}

  async getToken(hash: string): Promise<TokenInfo | null> {
    try {
      const doc = await this.store.get(this.tableName, hash);

      if (!doc) {
        return null;
      }

      return {
        token_hash: hash,
        uid: doc.uid || doc.user_id,
        expires_at: doc.expires_at ? new Date(doc.expires_at) : null,
        created_at: doc.created_at ? new Date(doc.created_at) : new Date(),
        last_used_at: doc.last_used_at ? new Date(doc.last_used_at) : null,
      };
    } catch (err: any) {
      this.logger.error('postgres.api_token.get_error', { error: err.message, hash: hash.substring(0, 8) });
      return null;
    }
  }

  async updateLastUsed(hash: string): Promise<void> {
    try {
      const doc = await this.store.get(this.tableName, hash);
      if (doc) {
        await this.store.set(this.tableName, hash, {
          ...doc,
          last_used_at: new Date().toISOString()
        });
      }
    } catch (err: any) {
      this.logger.error('postgres.api_token.update_error', { error: err.message, hash: hash.substring(0, 8) });
    }
  }
}

/**
 * Factory function to create API token store based on backend detection.
 *
 * @param dbOrStore - Firestore instance or IDocumentStore (optional, will use getFirestore() if not provided)
 * @param logger - Logger instance
 * @param collectionOrTable - Collection path (Firestore) or table name (PostgreSQL)
 * @returns IApiTokenStore implementation
 */
export function createApiTokenStore(
  dbOrStore: any,
  logger: Logger,
  collectionOrTable?: string
): IApiTokenStore {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreApiTokenStore(dbOrStore, logger, collectionOrTable || 'gateways/api/tokens');
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreApiTokenStore(dbOrStore, logger, collectionOrTable || 'api_tokens');
  }

  // Default to Firestore (for backward compatibility with tests)
  const { getFirestore } = require('../../common/firebase');
  return new FirestoreApiTokenStore(getFirestore(), logger, collectionOrTable || 'gateways/api/tokens');
}

export class AuthService {
  private cache: Map<string, { uid: string; expires_at?: Date | null }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly tokenStore: IApiTokenStore;

  constructor(
    dbOrStore: Firestore | IDocumentStore,
    private readonly logger: Logger
  ) {
    // Create token store based on backend type
    this.tokenStore = createApiTokenStore(dbOrStore, logger);
  }

  /**
   * Validates a bearer token.
   * 1. Hashes the token using SHA-256.
   * 2. Checks local cache.
   * 3. If not in cache, queries storage (Firestore or PostgreSQL).
   * 4. Updates cache and last_used_at.
   */
  public async validateToken(token: string): Promise<string | null> {
    if (!token) return null;

    const hash = crypto.createHash('sha256').update(token).digest('hex');

    // Check cache
    const cached = this.cache.get(hash);
    if (cached) {
      if (cached.expires_at && cached.expires_at.getTime() < Date.now()) {
        this.cache.delete(hash);
        this.logger.warn('auth.token_expired.cache', { hash: hash.substring(0, 8) });
        return null;
      }
      return cached.uid;
    }

    // Query storage
    try {
      const tokenInfo = await this.tokenStore.getToken(hash);

      if (!tokenInfo) {
        this.logger.warn('auth.token_not_found', { hash: hash.substring(0, 8) });
        return null;
      }

      const { uid, expires_at } = tokenInfo;

      if (expires_at && expires_at.getTime() < Date.now()) {
        this.logger.warn('auth.token_expired.db', { uid, hash: hash.substring(0, 8) });
        return null;
      }

      // Update cache
      this.cache.set(hash, { uid, expires_at });
      setTimeout(() => this.cache.delete(hash), this.CACHE_TTL_MS);

      // Async update last_used_at (fire-and-forget)
      this.tokenStore.updateLastUsed(hash).catch(err => {
        this.logger.error('auth.update_last_used_failed', { error: err.message, uid });
      });

      return uid;
    } catch (err: any) {
      this.logger.error('auth.validate_token_error', { error: err.message });
      return null;
    }
  }
}
