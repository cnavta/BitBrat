import { ITokenStore, TwitchTokenData } from '../types';
import { logger } from '../common/logging';
import { getFirestore } from '../common/firebase';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Firestore-backed token store for Twitch OAuth tokens.
 * The docPath should be a full document path like "oauth/twitch/bot" or "oauth/twitch/broadcaster".
 */
export class FirestoreTokenStore implements ITokenStore {
  private db: Firestore;
  constructor(private docPath: string, db?: Firestore) {
    this.db = db || getFirestore();
  }

  private docRef() {
    return this.db.doc(this.docPath + '/token');
  }

  async getToken(): Promise<TwitchTokenData | null> {
    try {
      const snap = await this.docRef().get();
      if (!snap.exists) {
        logger.info('Token document not found in Firestore', { docPath: this.docPath });
        return null;
      }
      const data = snap.data() as TwitchTokenData | undefined;
      if (!data || !data.accessToken) return null;
      logger.debug('Loaded token from Firestore', data as Record<string, any>);
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        scope: Array.isArray(data.scope) ? data.scope : [],
        expiresIn: data.expiresIn ?? null,
        obtainmentTimestamp: data.obtainmentTimestamp ?? null,
        userId: (data as any).userId ?? null,
      };
    } catch (err: any) {
      logger.error('Failed to read token from Firestore', { error: err?.message || String(err), docPath: this.docPath });
      return null;
    }
  }

  async setToken(token: TwitchTokenData): Promise<void> {
    try {
      await this.docRef().set(
        {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? null,
          scope: token.scope ?? [],
          expiresIn: token.expiresIn ?? null,
          obtainmentTimestamp: token.obtainmentTimestamp ?? null,
          userId: token.userId ?? null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logger.debug('Token written to Firestore', { docPath: this.docPath });
    } catch (err: any) {
      logger.error('Failed to write token to Firestore', { error: err?.message || String(err), docPath: this.docPath });
    }
  }
}

/**
 * PostgreSQL-backed token store for Twitch OAuth tokens.
 * Uses IDocumentStore with a flat key structure instead of nested Firestore paths.
 */
export class PostgresTokenStore implements ITokenStore {
  constructor(
    private readonly store: any, // IDocumentStore
    private readonly docPath: string,
    private readonly tableName = 'twitch_tokens'
  ) {}

  /**
   * Converts Firestore-style docPath to PostgreSQL key.
   * Examples: "oauth/twitch/bot" -> "twitch:bot", "oauth/twitch/broadcaster" -> "twitch:broadcaster"
   */
  private makeDocId(): string {
    // Extract last two segments from path (e.g., "oauth/twitch/bot" -> "twitch:bot")
    const parts = this.docPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
    }
    // Fallback: use entire path
    return this.docPath.replace(/\//g, ':');
  }

  async getToken(): Promise<TwitchTokenData | null> {
    try {
      const docId = this.makeDocId();
      const doc = await this.store.get(this.tableName, docId);

      if (!doc) {
        logger.info('Token document not found in PostgreSQL', { docPath: this.docPath, docId, backend: 'postgres' });
        return null;
      }

      const data = doc as any;
      if (!data || !data.accessToken) return null;

      logger.debug('Loaded token from PostgreSQL', { docPath: this.docPath, backend: 'postgres' });
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        scope: Array.isArray(data.scope) ? data.scope : [],
        expiresIn: data.expiresIn ?? null,
        obtainmentTimestamp: data.obtainmentTimestamp ?? null,
        userId: data.userId ?? null,
      };
    } catch (err: any) {
      logger.error('Failed to read token from PostgreSQL', {
        error: err?.message || String(err),
        docPath: this.docPath,
        backend: 'postgres'
      });
      return null;
    }
  }

  async setToken(token: TwitchTokenData): Promise<void> {
    try {
      const docId = this.makeDocId();
      await this.store.set(this.tableName, docId, {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        scope: token.scope ?? [],
        expiresIn: token.expiresIn ?? null,
        obtainmentTimestamp: token.obtainmentTimestamp ?? null,
        userId: token.userId ?? null,
        updatedAt: Date.now(),
      });

      logger.debug('Token written to PostgreSQL', { docPath: this.docPath, docId, backend: 'postgres' });
    } catch (err: any) {
      logger.error('Failed to write token to PostgreSQL', {
        error: err?.message || String(err),
        docPath: this.docPath,
        backend: 'postgres'
      });
      throw err;
    }
  }
}

/**
 * Factory function to create the appropriate token store based on backend.
 *
 * @param docPath - Firestore document path (e.g., "oauth/twitch/bot")
 * @param dbOrStore - Firestore instance or IDocumentStore
 * @param options - For PostgreSQL: { tableName }
 * @returns ITokenStore instance (Firestore or PostgreSQL based)
 */
export function createTokenStore(
  docPath: string,
  dbOrStore?: any,
  options?: { tableName?: string }
): ITokenStore {
  // Check if Firestore instance (has collection() method)
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreTokenStore(docPath, dbOrStore);
  }

  // Check if IDocumentStore (has get/set methods)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new PostgresTokenStore(dbOrStore, docPath, options?.tableName || 'twitch_tokens');
  }

  // Auto-select based on PERSISTENCE_DRIVER environment variable
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    // Auto-create DocumentStore for PostgreSQL
    const { createDocumentStore } = require('../common/persistence/factory');
    const store = createDocumentStore();
    return new PostgresTokenStore(store, docPath, options?.tableName || 'twitch_tokens');
  }

  // Default to Firestore
  return new FirestoreTokenStore(docPath);
}
