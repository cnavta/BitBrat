import type { ResourceManager, SetupContext } from './types';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from '../firebase';
import { logger as globalLogger } from '../logging';

// Module-level memoized instance to guarantee a single Firestore across all manager instances
let memoizedDb: Firestore | null = null;

export class FirestoreManager implements ResourceManager<Firestore> {
  setup(ctx: SetupContext): Firestore {
    const log = ctx?.logger || globalLogger;
    if (memoizedDb) {
      log.info('firestore.manager.setup.reuse');
      return memoizedDb;
    }
    log.info('firestore.manager.setup');
    memoizedDb = getFirestore();
    return memoizedDb;
  }

  // Firestore Admin SDK does not expose a close for Firestore; rely on process exit.
  async shutdown(_instance: Firestore): Promise<void> {
    // no-op safe shutdown
  }
}
