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
  permissions?: string[];
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
        permissions: data.permissions || [],
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
 *
 * Note: Uses both IDocumentStore (for data column) and optional direct SQL access
 * (for permissions column) to support Sprint 39 permission model.
 */
export class DocumentStoreApiTokenStore implements IApiTokenStore {
  private pool?: any; // pg.Pool for direct SQL access to permissions column

  constructor(
    private readonly store: IDocumentStore,
    private readonly logger: Logger,
    private readonly tableName = 'api_tokens',
    pool?: any  // Optional: pg.Pool for direct SQL access
  ) {
    this.pool = pool;
  }

  async getToken(hash: string): Promise<TokenInfo | null> {
    try {
      // If we have direct pool access, query both data and permissions columns
      if (this.pool) {
        const result = await this.pool.query(
          `SELECT data, permissions FROM ${this.tableName} WHERE id = $1`,
          [hash]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        const doc = row.data;
        const permissions = row.permissions || [];

        return {
          token_hash: hash,
          uid: doc.uid || doc.user_id,
          expires_at: doc.expires_at ? new Date(doc.expires_at) : null,
          created_at: doc.created_at ? new Date(doc.created_at) : new Date(),
          last_used_at: doc.last_used_at ? new Date(doc.last_used_at) : null,
          permissions: Array.isArray(permissions) ? permissions : [],
        };
      }

      // Fallback: Use IDocumentStore (permissions in data column)
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
        permissions: doc.permissions || [],
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
 * @param pool - Optional pg.Pool for direct SQL access (Sprint 39 permissions support)
 * @returns IApiTokenStore implementation
 */
export function createApiTokenStore(
  dbOrStore: any,
  logger: Logger,
  collectionOrTable?: string,
  pool?: any
): IApiTokenStore {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreApiTokenStore(dbOrStore, logger, collectionOrTable || 'gateways/api/tokens');
  }

  // Check if IDocumentStore instance
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreApiTokenStore(dbOrStore, logger, collectionOrTable || 'api_tokens', pool);
  }

  // Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
  const { getFirestore } = require('../../common/firebase');
  return new FirestoreApiTokenStore(getFirestore(), logger, collectionOrTable || 'gateways/api/tokens');
}

export class AuthService {
  private cache: Map<string, { uid: string; expires_at?: Date | null }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly tokenStore: IApiTokenStore;
  private pool?: any; // pg.Pool for direct SQL queries

  constructor(
    dbOrStore: Firestore | IDocumentStore,
    private readonly logger: Logger,
    pool?: any  // Optional: pg.Pool for getUserPermissions()
  ) {
    // Create token store based on backend type
    this.tokenStore = createApiTokenStore(dbOrStore, logger, undefined, pool);
    this.pool = pool;
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

  /**
   * Get permissions for a given userId.
   *
   * Sprint 39: Permission-gated access control for event.inject.v2 and other
   * restricted features.
   *
   * Auto-grants:
   * - brat-dev-mcp:* → ['event:inject'] (Dev MCP tools)
   * - dev-tools:* → ['event:inject'] (Development tools)
   *
   * @param userId - User ID (e.g., 'brat-dev-mcp:staging', 'user-123')
   * @returns Array of permission strings (e.g., ['event:inject', 'admin:read'])
   */
  public async getUserPermissions(userId: string): Promise<string[]> {
    if (!userId) {
      return [];
    }

    // Auto-grant event:inject for dev tokens (Sprint 39 security model)
    const isDevToken = userId.startsWith('brat-dev-mcp:') || userId.startsWith('dev-tools:');
    if (isDevToken) {
      this.logger.debug('auth.auto_grant_permissions', {
        userId,
        permissions: ['event:inject'],
        reason: 'dev_token_pattern',
      });
      return ['event:inject'];
    }

    // Query permissions from database
    try {
      // Use direct SQL if pool available (Sprint 39: permissions column)
      if (this.pool) {
        const result = await this.pool.query(
          `SELECT permissions FROM api_tokens WHERE data->>'uid' = $1 LIMIT 1`,
          [userId]
        );

        if (result.rows.length > 0) {
          const permissions = result.rows[0].permissions || [];
          return Array.isArray(permissions) ? permissions : [];
        }

        // Not found - return empty array
        return [];
      }

      // Fallback: Query via IDocumentStore (permissions in data column)
      // This is less efficient but works if pool not available
      const allTokens = await this.tokenStore instanceof DocumentStoreApiTokenStore
        ? [] // DocumentStore doesn't support efficient user lookup without pool
        : [];

      this.logger.warn('auth.get_permissions_no_pool', {
        userId,
        message: 'Pool not available, returning empty permissions (non-dev user)',
      });

      return [];
    } catch (err: any) {
      // Fail-safe: On error, return empty permissions (deny by default)
      this.logger.error('auth.get_permissions_error', {
        error: err.message,
        userId,
        stack: err.stack,
      });
      return [];
    }
  }
}
