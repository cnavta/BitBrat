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
