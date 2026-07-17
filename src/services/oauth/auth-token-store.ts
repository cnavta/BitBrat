import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from '../../common/firebase';
import { logger } from '../../common/logging';

export type AuthTokenDoc = {
  provider: string;
  identity: string;
  tokenType: 'oauth' | 'bot-token' | string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  scope?: string[];
  providerUserId?: string;
  metadata?: Record<string, unknown>;
  updatedAt: string; // ISO
};

export interface IAuthTokenStoreV2 {
  getAuthToken(provider: string, identity: string): Promise<AuthTokenDoc | null>;
  putAuthToken(provider: string, identity: string, token: Omit<AuthTokenDoc, 'provider' | 'identity' | 'updatedAt'>): Promise<void>;
}

export type LegacyFallbackMap = {
  [provider: string]: {
    [identity: string]: string; // legacy Firestore document base path, e.g. "oauth/twitch/bot"
  };
};

/**
 * FirestoreAuthTokenStore – Original Firestore implementation
 * Stores OAuth tokens in Firestore with nested document structure
 */
export class FirestoreAuthTokenStore implements IAuthTokenStoreV2 {
  private db: Firestore;
  constructor(private readonly options?: { db?: Firestore; legacyFallback?: LegacyFallbackMap }) {
    this.db = options?.db || getFirestore();
  }

  private tokenDocRef(provider: string, identity: string) {
    return this.db.doc(`oauth/${provider}/${identity}/token`);
  }

  async getAuthToken(provider: string, identity: string): Promise<AuthTokenDoc | null> {
    try {
      const snap = await this.tokenDocRef(provider, identity).get();
      if (snap.exists) {
        const d = (snap.data() || {}) as any;
        if (!d.accessToken) return null;

        // Try to handle both old Twitch and new V2 schema fields
        const obtainment = d.obtainmentTimestamp || (d.updatedAt ? Date.parse(d.updatedAt) : Date.now());
        const expiresAt = d.expiresAt || (d.expiresIn ? new Date(obtainment + d.expiresIn * 1000).toISOString() : undefined);

        return {
          provider,
          identity,
          tokenType: d.tokenType || 'oauth',
          accessToken: d.accessToken,
          refreshToken: d.refreshToken || undefined,
          expiresAt,
          scope: Array.isArray(d.scope) ? d.scope : undefined,
          providerUserId: d.providerUserId || d.userId || undefined,
          metadata: d.metadata,
          updatedAt: d.updatedAt || new Date(obtainment).toISOString(),
        };
      }
      return null;
    } catch (e: any) {
      logger.error('authTokenStore.getAuthToken.error', { error: e?.message || String(e), provider, identity });
      return null;
    }
  }

  async putAuthToken(provider: string, identity: string, token: Omit<AuthTokenDoc, 'provider' | 'identity' | 'updatedAt'>): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      await this.tokenDocRef(provider, identity).set(
        {
          provider,
          identity,
          tokenType: token.tokenType,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          scope: token.scope || [],
          providerUserId: token.providerUserId,
          metadata: token.metadata,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    } catch (e: any) {
      logger.error('authTokenStore.putAuthToken.error', { error: e?.message || String(e), provider, identity });
    }
  }
}

/**
 * DocumentStoreAuthTokenStore – PostgreSQL implementation
 * Stores OAuth tokens in IDocumentStore with flat key structure
 */
export class DocumentStoreAuthTokenStore implements IAuthTokenStoreV2 {
  constructor(
    private readonly store: any, // IDocumentStore
    private readonly tableName = 'auth_scopes'
  ) {}

  private makeDocId(provider: string, identity: string): string {
    return `${provider}:${identity}`;
  }

  async getAuthToken(provider: string, identity: string): Promise<AuthTokenDoc | null> {
    try {
      const docId = this.makeDocId(provider, identity);
      const doc = await this.store.get(this.tableName, docId);

      if (!doc) {
        return null;
      }

      const d = doc as any;
      if (!d.accessToken) return null;

      // Handle both old Twitch and new V2 schema fields
      const obtainment = d.obtainmentTimestamp || (d.updatedAt ? Date.parse(d.updatedAt) : Date.now());
      const expiresAt = d.expiresAt || (d.expiresIn ? new Date(obtainment + d.expiresIn * 1000).toISOString() : undefined);

      return {
        provider: d.provider || provider,
        identity: d.identity || identity,
        tokenType: d.tokenType || 'oauth',
        accessToken: d.accessToken,
        refreshToken: d.refreshToken || undefined,
        expiresAt,
        scope: Array.isArray(d.scope) ? d.scope : undefined,
        providerUserId: d.providerUserId || d.userId || undefined,
        metadata: d.metadata,
        updatedAt: d.updatedAt || new Date(obtainment).toISOString(),
      };
    } catch (e: any) {
      logger.error('authTokenStore.getAuthToken.error', { error: e?.message || String(e), provider, identity, backend: 'postgres' });
      return null;
    }
  }

  async putAuthToken(provider: string, identity: string, token: Omit<AuthTokenDoc, 'provider' | 'identity' | 'updatedAt'>): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      const docId = this.makeDocId(provider, identity);

      await this.store.set(this.tableName, docId, {
        provider,
        identity,
        tokenType: token.tokenType,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope || [],
        providerUserId: token.providerUserId,
        metadata: token.metadata,
        updatedAt: nowIso,
      });

      logger.debug('authTokenStore.putAuthToken.ok', { provider, identity, backend: 'postgres' });
    } catch (e: any) {
      logger.error('authTokenStore.putAuthToken.error', { error: e?.message || String(e), provider, identity, backend: 'postgres' });
      throw e;
    }
  }
}

/**
 * Factory function to create the appropriate AuthTokenStore based on backend
 *
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param options - For Firestore: { legacyFallback }. For PostgreSQL: { tableName }
 * @returns AuthTokenStore instance (Firestore or DocumentStore based)
 */
export function createAuthTokenStore(
  dbOrStore?: any,
  options?: { legacyFallback?: LegacyFallbackMap; tableName?: string }
): IAuthTokenStoreV2 {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreAuthTokenStore({
      db: dbOrStore,
      legacyFallback: options?.legacyFallback,
    });
  }

  // Check if IDocumentStore (has get/set methods)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreAuthTokenStore(dbOrStore, options?.tableName || 'auth_scopes');
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    // Auto-create DocumentStore for PostgreSQL
    const { createDocumentStore } = require('../../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreAuthTokenStore(store, options?.tableName || 'auth_scopes');
  }

  // Default to Firestore
  return new FirestoreAuthTokenStore(options);
}
