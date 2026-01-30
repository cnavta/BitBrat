import type { InternalEventV2 } from '../../../types/events';
import { PersistenceStore } from '../store';

function makeFirestoreMock() {
  const set = jest.fn(async (_data, _opts) => {});
  const doc = jest.fn((_id: string) => ({ set }));
  const collection = jest.fn((_name: string) => ({ doc }));
  return { collection, __fns: { set, doc, collection } } as any;
}

describe('PersistenceStore – Metadata Persistence', () => {
  it('persists top-level event metadata during upsertIngressEvent', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    
    const evt: InternalEventV2 = {
      v: '2',
      source: 'test',
      correlationId: 'c-meta-1',
      type: 'chat.message.v1',
      metadata: {
        matchedRuleIds: ['rule-1', 'rule-2'],
        chosenRuleId: 'rule-1'
      }
    } as any;

    await store.upsertIngressEvent(evt);

    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[0].metadata).toEqual({
      matchedRuleIds: ['rule-1', 'rule-2'],
      chosenRuleId: 'rule-1'
    });
  });

  it('persists top-level event metadata during applyFinalization if present', async () => {
    // This tests if finalize payload also carries forward top-level metadata
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

    const setCall = db.__fns.set.mock.calls[0];
    // Finalization payload currently maps 'metadata' to 'egressResult.metadata'
    expect(setCall[0].egressResult.metadata).toEqual({
      matchedRuleIds: ['rule-1'],
      chosenRuleId: 'rule-1'
    });
  });
});
