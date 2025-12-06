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
    } catch (err: any) {
      logger.error('Failed to write token to Firestore', { error: err?.message || String(err), docPath: this.docPath });
    }
  }
}
