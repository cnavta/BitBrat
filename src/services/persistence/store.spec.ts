import type { InternalEventV2 } from '../../types/events';
// Timestamp may not be a real Firestore Timestamp in unit tests; avoid hard dependency
import { PersistenceStore } from './store';

function makeFirestoreMock() {
  const set = jest.fn(async (_data, _opts) => {});
  const doc = jest.fn((_id: string) => ({ set }));
  const collection = jest.fn((_name: string) => ({ doc }));
  return { collection, __fns: { set, doc, collection } } as any;
}

describe('PersistenceStore', () => {
  test('upsertIngressEvent uses merge set with correlationId', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const evt: InternalEventV2 = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'c-1',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hi' },
    } as any;
    await store.upsertIngressEvent(evt);
    expect(db.__fns.collection).toHaveBeenCalledWith('events');
    expect(db.__fns.doc).toHaveBeenCalledWith('c-1');
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[1]).toEqual({ merge: true });
    expect(setCall[0]).toMatchObject({ correlationId: 'c-1', status: 'INGESTED' });
  });

  test('applyFinalization writes FINALIZED patch and egress info', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.applyFinalization({
      correlationId: 'c-2',
      destination: 'egress://default',
      deliveredAt: '2024-01-01T00:00:00Z',
      providerMessageId: 'pm-1',
      status: 'SENT',
      metadata: { ok: true },
    });
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[1]).toEqual({ merge: true });
    expect(setCall[0]).toMatchObject({ status: 'FINALIZED', egress: { status: 'SENT', destination: 'egress://default' } });
    // TTL should be 7 days after deliveredAt
    const expected = new Date('2024-01-01T00:00:00Z');
    expected.setUTCDate(expected.getUTCDate() + 7);
    const ttlVal = setCall[0].ttl;
    let iso: string | undefined;
    if (ttlVal && typeof ttlVal.toDate === 'function') iso = ttlVal.toDate().toISOString();
    else if (ttlVal instanceof Date) iso = ttlVal.toISOString();
    else if (typeof ttlVal === 'string') iso = new Date(ttlVal).toISOString();
    else iso = undefined;
    expect(iso).toBe(expected.toISOString());
  });

  test('applyFinalization honors PERSISTENCE_TTL_DAYS env override', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const prev = process.env.PERSISTENCE_TTL_DAYS;
    process.env.PERSISTENCE_TTL_DAYS = '2';
    try {
      await store.applyFinalization({
        correlationId: 'c-ttl-override',
        deliveredAt: '2024-01-01T00:00:00Z',
        status: 'SENT',
      });
      const setCall = db.__fns.set.mock.calls[0];
      const expected = new Date('2024-01-01T00:00:00Z');
      expected.setUTCDate(expected.getUTCDate() + 2);
      const ttlVal = setCall[0].ttl;
      let iso: string | undefined;
      if (ttlVal && typeof ttlVal.toDate === 'function') iso = ttlVal.toDate().toISOString();
      else if (ttlVal instanceof Date) iso = ttlVal.toISOString();
      else if (typeof ttlVal === 'string') iso = new Date(ttlVal).toISOString();
      else iso = undefined;
      expect(iso).toBe(expected.toISOString());
    } finally {
      if (prev === undefined) delete process.env.PERSISTENCE_TTL_DAYS; else process.env.PERSISTENCE_TTL_DAYS = prev;
    }
  });

  test('applyFinalization merges annotations and candidates when provided', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const now = new Date().toISOString();
    await store.applyFinalization({
      correlationId: 'c-3',
      status: 'SENT',
      annotations: [{ id: 'a1', kind: 'intent', source: 't', createdAt: now }],
      candidates: [{ id: 'c1', kind: 'text', source: 't', createdAt: now, status: 'selected', priority: 1, text: 'hi' }],
    });
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[1]).toEqual({ merge: true });
    expect(Array.isArray(setCall[0].annotations)).toBe(true);
    expect(Array.isArray(setCall[0].candidates)).toBe(true);
    expect(setCall[0].candidates[0].status).toBe('selected');
  });
});
