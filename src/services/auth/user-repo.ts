import { getFirestore } from '../../common/firebase';
import type { Firestore } from 'firebase-admin/firestore';
import {logger} from "../../common/logging";

export interface AuthUserDoc {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
  status?: string;
  // Enrichment v1 extensions (optional/persistent)
  notes?: string;
  tags?: string[];
  // State tracking (optional)
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastMessageAt?: string;
  messageCountAllTime?: number;
  lastSessionId?: string;
  lastSessionStartedAt?: string;
  lastSessionActivityAt?: string;
  sessionCount?: number;
}

export interface UserRepo {
  getById(id: string): Promise<AuthUserDoc | null>;
  getByEmail(email: string): Promise<AuthUserDoc | null>;
  /** Optional: upsert user and update counters/session on message arrival. Implemented when backed by Firestore. */
  ensureUserOnMessage?(
    id: string,
    data: { provider?: string; providerUserId?: string; displayName?: string; email?: string },
    nowIso: string
  ): Promise<{ doc: AuthUserDoc; created: boolean; isFirstMessage: boolean; isNewSession: boolean }>;
}

/** Firestore-backed user repository */
export class FirestoreUserRepo implements UserRepo {
  private readonly collectionName: string;
  private readonly db?: Firestore;
  constructor(collectionName = 'users', db?: Firestore) {
    this.collectionName = collectionName;
    this.db = db;
  }

  async getById(id: string): Promise<AuthUserDoc | null> {
    if (!id) return null;
    const db = this.db || getFirestore();
    const snap = await db.collection(this.collectionName).doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    return {
      id: snap.id,
      ...data,
      roles: Array.isArray(data?.roles) ? data.roles : undefined,
    };
  }

  async getByEmail(email: string): Promise<AuthUserDoc | null> {
    if (!email) return null;
    const db = this.db || getFirestore();
    const q = await db.collection(this.collectionName).where('email', '==', email).limit(1).get();
    if (q.empty) return null;
    const doc = q.docs[0];
    const data = doc.data() as any;
    return {
      id: doc.id,
      ...data,
      roles: Array.isArray(data?.roles) ? data.roles : undefined,
    };
  }

  async ensureUserOnMessage(
    id: string,
    data: { provider?: string; providerUserId?: string; displayName?: string; email?: string },
    nowIso: string
  ): Promise<{ doc: AuthUserDoc; created: boolean; isFirstMessage: boolean; isNewSession: boolean }> {
    logger.debug('auth.user.ensureUserOnMessage', { userId: id })
    const db = this.db || getFirestore();
    const ref = db.collection(this.collectionName).doc(id);
    const snap = await ref.get();
    const providerTag = data.provider ? `PROVIDER_${String(data.provider).toUpperCase()}` : undefined;
    if (!snap.exists) {
      const initial: any = {
        provider: data.provider,
        providerUserId: data.providerUserId,
        email: data.email,
        displayName: data.displayName,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        lastMessageAt: nowIso,
        messageCountAllTime: 1,
        sessionCount: 1,
        lastSessionId: `sess_${id}_${Math.random().toString(36).slice(2, 8)}`,
        lastSessionStartedAt: nowIso,
        lastSessionActivityAt: nowIso,
        ...(providerTag ? { tags: [providerTag] } : {}),
      };
      logger.debug('auth.user.ensureUserOnMessage.newUser', { userId: id, initial })
      try {
        await ref.set(initial, {merge: true}).then(e =>
          logger.debug('auth.user.ensureUserOnMessage.newUser.set.complete', { userId: id, doc: e }));
      } catch (e) {
        logger.error('auth.user.ensureUserOnMessage.newUser.error', { userId: id, error: e })
        throw e;
      }
      logger.debug('auth.user.ensureUserOnMessage.newUser.done', { userId: id })
      return {
        doc: { id, ...initial },
        created: true,
        isFirstMessage: true,
        isNewSession: true,
      };
    }

    const dataExisting = snap.data() as any;
    const lastActivityIso = (dataExisting?.lastSessionActivityAt as string) || (dataExisting?.lastMessageAt as string) || nowIso;
    const lastActivity = Date.parse(lastActivityIso || nowIso);
    const nowMs = Date.parse(nowIso);
    const INACTIVITY_MS_24H = 24 * 60 * 60 * 1000;
    const isNewSession = nowMs - lastActivity >= INACTIVITY_MS_24H;

    const messageCountAllTime = (dataExisting?.messageCountAllTime || 0) + 1;
    const sessionCount = (dataExisting?.sessionCount || 0) + (isNewSession ? 1 : 0);
    const update: any = {
      lastSeenAt: nowIso,
      lastMessageAt: nowIso,
      lastSessionActivityAt: nowIso,
      messageCountAllTime,
      sessionCount,
    };
    if (isNewSession) {
      update.lastSessionId = `sess_${id}_${Math.random().toString(36).slice(2, 8)}`;
      update.lastSessionStartedAt = nowIso;
    }
    await ref.set(update, { merge: true });

    const merged = { id, ...dataExisting, ...update } as AuthUserDoc;
    return {
      doc: merged,
      created: false,
      isFirstMessage: (dataExisting?.messageCountAllTime || 0) === 0,
      isNewSession,
    };
  }
}
