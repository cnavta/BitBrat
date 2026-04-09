import type { InternalEventV2 } from '../../../types/events';
import { PersistenceStore } from '../store';

function makeFirestoreMock() {
  const rootSets: Record<string, any> = {};
  const snapshotSets: Record<string, any> = {};
  const collection = jest.fn((name: string) => ({
    doc: jest.fn((id: string) => ({
      id,
      path: `${name}/${id}`,
      set: jest.fn(async (data: any) => {
        if (name === 'events') {
          rootSets[id] = data;
        }
      }),
      collection: jest.fn((sub: string) => ({
        doc: jest.fn((snapshotId: string) => ({ path: `${name}/${id}/${sub}/${snapshotId}` })),
        where: jest.fn((_field: string, _op: string, value: string) => ({
          __kind: 'query',
          correlationId: id,
          idempotencyKey: value,
          limit: jest.fn(() => ({ __kind: 'query', correlationId: id, idempotencyKey: value })),
        })),
      })),
    })),
  }));
  const runTransaction = jest.fn(async (handler: any) => {
    const transaction = {
      get: jest.fn(async (ref: any) => {
        if (ref?.__kind === 'query') {
          const docs = Object.entries(snapshotSets)
            .filter(([key, data]) => key.startsWith(`${ref.correlationId}/`) && (data as any).idempotencyKey === ref.idempotencyKey)
            .map(([, data]) => ({ data: () => data }));
          return { empty: docs.length === 0, docs };
        }
        if (ref?.path?.startsWith('events/')) {
          const correlationId = String(ref.path).split('/')[1];
          return { exists: !!rootSets[correlationId], data: () => rootSets[correlationId] };
        }
        return { exists: false, data: () => undefined };
      }),
      set: jest.fn((ref: any, data: any) => {
        if (ref?.path?.startsWith('events/') && ref.path.includes('/snapshots/')) {
          const [, correlationId, , snapshotId] = String(ref.path).split('/');
          snapshotSets[`${correlationId}/${snapshotId}`] = data;
        } else if (ref?.path?.startsWith('events/')) {
          const correlationId = String(ref.path).split('/')[1];
          rootSets[correlationId] = data;
        }
      }),
    };
    return handler(transaction);
  });
  return { collection, runTransaction, __state: { rootSets, snapshotSets } } as any;
}

describe('PersistenceStore – Metadata Persistence', () => {
  it('persists top-level event metadata during upsertIngressEvent', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-meta-1',
      type: 'chat.message.v1',
      ingress: { ingressAt: new Date().toISOString(), source: 'test' },
      identity: { external: { id: 'u1', platform: 'test' } },
      egress: { destination: 'internal.egress.v1' },
      routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
      metadata: {
        matchedRuleIds: ['rule-1', 'rule-2'],
        chosenRuleId: 'rule-1'
      }
    } as any;

    await store.upsertIngressEvent(evt);

    expect(db.__state.rootSets['c-meta-1'].currentProjection.metadata).toEqual({
      matchedRuleIds: ['rule-1', 'rule-2'],
      chosenRuleId: 'rule-1'
    });
  });

  it('persists top-level event metadata during applyFinalization if present', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    
    await store.applyFinalization({
      correlationId: 'c-meta-finalize',
      status: 'SENT',
      metadata: {
          matchedRuleIds: ['rule-1'],
          chosenRuleId: 'rule-1'
      }
    });

    expect(db.__state.rootSets['c-meta-finalize'].delivery.metadata).toEqual({
      matchedRuleIds: ['rule-1'],
      chosenRuleId: 'rule-1'
    });
  });
});
