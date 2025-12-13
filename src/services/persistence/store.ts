import type { Firestore } from 'firebase-admin/firestore';
import type { InternalEventV2 } from '../../types/events';
import { COLLECTION_EVENTS, EventDocV1, FinalizationUpdateV1, normalizeFinalizePayload, normalizeIngressEvent } from './model';

export interface PersistenceStoreDeps {
  firestore: Firestore;
  logger?: { info: Function; warn: Function; error: Function; debug?: Function };
}

export class PersistenceStore {
  private db: Firestore;
  private logger: Required<PersistenceStoreDeps>['logger'];

  constructor(deps: PersistenceStoreDeps) {
    this.db = deps.firestore;
    this.logger = (deps.logger || console) as any;
  }

  private docRef(correlationId: string) {
    return this.db.collection(COLLECTION_EVENTS).doc(correlationId);
  }

  /** Upsert the event document by correlationId. Idempotent. */
  async upsertIngressEvent(evt: InternalEventV2): Promise<EventDocV1> {
    const doc = normalizeIngressEvent(evt);
    if (!doc.correlationId) throw new Error('missing_correlationId');
    const ref = this.docRef(doc.correlationId);
    // Use set with merge: true to ensure idempotency
    await ref.set(doc as any, { merge: true });
    this.logger.info('persistence.upsert.ok', { correlationId: doc.correlationId, status: doc.status });
    return doc;
  }

  /** Apply finalization update. Creates stub doc if not present. Idempotent. */
  async applyFinalization(rawMsg: any): Promise<FinalizationUpdateV1> {
    const update = normalizeFinalizePayload(rawMsg);
    if (!update.correlationId) throw new Error('missing_correlationId');
    const ref = this.docRef(update.correlationId);
    const finalizedAt = update.deliveredAt || new Date().toISOString();
    const patch: Partial<EventDocV1> = {
      status: 'FINALIZED',
      finalizedAt,
      egress: {
        destination: update.destination,
        deliveredAt: update.deliveredAt,
        providerMessageId: update.providerMessageId,
        status: update.status,
        error: update.error || null,
        metadata: update.metadata,
      },
    };
    await ref.set(patch as any, { merge: true });
    this.logger.info('persistence.finalize.ok', { correlationId: update.correlationId, status: update.status });
    return update;
  }
}
