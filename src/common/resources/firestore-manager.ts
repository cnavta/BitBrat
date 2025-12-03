import type { ResourceManager, SetupContext } from './types';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from '../firebase';
import { logger as globalLogger } from '../logging';

export class FirestoreManager implements ResourceManager<Firestore> {
  setup(ctx: SetupContext): Firestore {
    const log = ctx?.logger || globalLogger;
    log.info('firestore.manager.setup');
    return getFirestore();
  }

  // Firestore Admin SDK does not expose a close for Firestore; rely on process exit.
  async shutdown(_instance: Firestore): Promise<void> {
    // no-op safe shutdown
  }
}
