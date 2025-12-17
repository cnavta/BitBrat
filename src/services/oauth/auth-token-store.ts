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

export class FirestoreAuthTokenStore implements IAuthTokenStoreV2 {
  private db: Firestore;
  constructor(private readonly options?: { db?: Firestore; legacyFallback?: LegacyFallbackMap }) {
    this.db = options?.db || getFirestore();
  }

  private v2DocRef(provider: string, identity: string) {
    const p = `authTokens/${provider}/${identity}`;
    return this.db.doc(p);
  }

  private legacyDocRef(provider: string, identity: string) {
    const legacyPath = this.options?.legacyFallback?.[provider]?.[identity];
    if (!legacyPath) return null;
    return this.db.doc(legacyPath + '/token');
  }

  async getAuthToken(provider: string, identity: string): Promise<AuthTokenDoc | null> {
    try {
      const v2 = await this.v2DocRef(provider, identity).get();
      if (v2.exists) {
        const d = (v2.data() || {}) as any;
        if (!d.accessToken) return null;
        return {
          provider,
          identity,
          tokenType: d.tokenType || 'oauth',
          accessToken: d.accessToken,
          refreshToken: d.refreshToken,
          expiresAt: d.expiresAt,
          scope: Array.isArray(d.scope) ? d.scope : undefined,
          providerUserId: d.providerUserId,
          metadata: d.metadata,
          updatedAt: d.updatedAt || new Date().toISOString(),
        };
      }
      // Read-compat fallback for legacy Twitch paths if configured
      const legacyRef = this.legacyDocRef(provider, identity);
      if (legacyRef) {
        const snap = await legacyRef.get();
        if (snap.exists) {
          const d = (snap.data() || {}) as any;
          if (!d.accessToken) return null;
          // Map legacy Twitch schema to v2 doc shape
          const expiresAt = d.expiresIn && d.obtainmentTimestamp ? new Date(d.obtainmentTimestamp + d.expiresIn * 1000).toISOString() : undefined;
          return {
            provider,
            identity,
            tokenType: 'oauth',
            accessToken: d.accessToken,
            refreshToken: d.refreshToken || undefined,
            expiresAt,
            scope: Array.isArray(d.scope) ? d.scope : undefined,
            providerUserId: d.userId || undefined,
            metadata: undefined,
            updatedAt: new Date().toISOString(),
          };
        }
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
      await this.v2DocRef(provider, identity).set(
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
