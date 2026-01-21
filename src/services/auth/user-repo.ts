import { getFirestore } from '../../common/firebase';
import type { Firestore } from 'firebase-admin/firestore';

export interface AuthUserDoc {
  id: string;
  email?: string;
  displayName?: string;
  roles: string[];
  status?: string;

  profile?: {
    username: string;
    description?: string;
    avatarUrl?: string;
    updatedAt: string;
    [key: string]: any;
  };

  rolesMeta?: {
    twitch?: string[];
    discord?: string[];
    twilio?: string[];
  };

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
  /** Search for users by display name or email. Returns an array of matches. */
  searchUsers(query: { displayName?: string; email?: string }): Promise<AuthUserDoc[]>;
  /** Update user fields partially. Returns the updated doc or null if not found. */
  updateUser(id: string, update: Partial<AuthUserDoc>): Promise<AuthUserDoc | null>;
  /** Optional: upsert user and update counters/session on message arrival. Implemented when backed by Firestore. */
  ensureUserOnMessage?(
    id: string,
    data: {
      provider?: string;
      providerUserId?: string;
      displayName?: string;
      email?: string;
      profile?: AuthUserDoc['profile'];
      roles?: string[];
      rolesMeta?: AuthUserDoc['rolesMeta'];
    },
    nowIso: string
  ): Promise<{ doc: AuthUserDoc; created: boolean; isFirstMessage: boolean; isNewSession: boolean }>;
}

function removeUndefined(obj: any): any {
  const out: any = {};
  for (const k in obj) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
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
      email: data?.email,
      displayName: data?.displayName,
      roles: Array.isArray(data?.roles) ? data.roles : [],
      status: data?.status,
      notes: data?.notes,
      profile: data?.profile,
      rolesMeta: data?.rolesMeta,
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
      email: data?.email,
      displayName: data?.displayName,
      roles: Array.isArray(data?.roles) ? data.roles : [],
      status: data?.status,
      notes: data?.notes,
      profile: data?.profile,
      rolesMeta: data?.rolesMeta,
    };
  }

  async searchUsers(query: { displayName?: string; email?: string }): Promise<AuthUserDoc[]> {
    const db = this.db || getFirestore();
    let q: FirebaseFirestore.Query = db.collection(this.collectionName);

    if (query.email) {
      q = q.where('email', '==', query.email);
    }
    if (query.displayName) {
      q = q.where('displayName', '==', query.displayName);
    }

    const snap = await q.get();
    return snap.docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        email: data?.email,
        displayName: data?.displayName,
        roles: Array.isArray(data?.roles) ? data.roles : [],
        status: data?.status,
        notes: data?.notes,
        profile: data?.profile,
        rolesMeta: data?.rolesMeta,
      };
    });
  }

  async updateUser(id: string, update: Partial<AuthUserDoc>): Promise<AuthUserDoc | null> {
    if (!id) return null;
    const db = this.db || getFirestore();
    const ref = db.collection(this.collectionName).doc(id);
    
    // Check if exists
    const snap = await ref.get();
    if (!snap.exists) return null;

    // Remove id from update if present to avoid overwriting doc ID field if it's mirrored
    const { id: _, ...cleanUpdate } = update as any;
    
    await ref.set(removeUndefined(cleanUpdate), { merge: true });
    
    // Return updated document
    return this.getById(id);
  }

  async ensureUserOnMessage(
    id: string,
    data: {
      provider?: string;
      providerUserId?: string;
      displayName?: string;
      email?: string;
      profile?: AuthUserDoc['profile'];
      roles?: string[];
      rolesMeta?: AuthUserDoc['rolesMeta'];
    },
    nowIso: string
  ): Promise<{ doc: AuthUserDoc; created: boolean; isFirstMessage: boolean; isNewSession: boolean }> {
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
        roles: data.roles || [],
        profile: data.profile,
        rolesMeta: data.rolesMeta,
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
      await ref.set(removeUndefined(initial), { merge: true });
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

    // Merge roles and rolesMeta
    const mergedRoles = new Set<string>(dataExisting?.roles || []);
    if (data.roles) {
      data.roles.forEach(r => mergedRoles.add(r));
    }

    const mergedRolesMeta = { ...(dataExisting?.rolesMeta || {}) };
    if (data.rolesMeta) {
      if (data.rolesMeta.twitch) mergedRolesMeta.twitch = data.rolesMeta.twitch;
      if (data.rolesMeta.discord) mergedRolesMeta.discord = data.rolesMeta.discord;
      if (data.rolesMeta.twilio) mergedRolesMeta.twilio = data.rolesMeta.twilio;
    }

    const update: any = {
      lastSeenAt: nowIso,
      lastMessageAt: nowIso,
      lastSessionActivityAt: nowIso,
      messageCountAllTime,
      sessionCount,
      roles: Array.from(mergedRoles),
      rolesMeta: mergedRolesMeta,
    };

    if (data.displayName) update.displayName = data.displayName;
    if (data.email) update.email = data.email;
    if (data.profile) update.profile = data.profile;

    if (isNewSession) {
      update.lastSessionId = `sess_${id}_${Math.random().toString(36).slice(2, 8)}`;
      update.lastSessionStartedAt = nowIso;
    }
    await ref.set(removeUndefined(update), { merge: true });

    const merged = { id, ...dataExisting, ...update } as AuthUserDoc;
    return {
      doc: merged,
      created: false,
      isFirstMessage: (dataExisting?.messageCountAllTime || 0) === 0,
      isNewSession,
    };
  }
}
