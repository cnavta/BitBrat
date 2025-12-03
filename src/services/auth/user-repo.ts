import { getFirestore } from '../../common/firebase';
import type { Firestore } from 'firebase-admin/firestore';

export interface AuthUserDoc {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
  status?: string;
}

export interface UserRepo {
  getById(id: string): Promise<AuthUserDoc | null>;
  getByEmail(email: string): Promise<AuthUserDoc | null>;
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
      roles: Array.isArray(data?.roles) ? data.roles : undefined,
      status: data?.status,
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
      roles: Array.isArray(data?.roles) ? data.roles : undefined,
      status: data?.status,
    };
  }
}
