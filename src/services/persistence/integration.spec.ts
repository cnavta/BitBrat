import { BaseServer } from '../../common/base-server';

function makeDocSnapshot(data: any, exists = true) {
  return { exists, data: () => data };
}

function makeQuerySnapshot(docs: any[] = []) {
  return {
    empty: docs.length === 0,
    docs: docs.map((data) => ({ data: () => data })),
  };
}

function makeFirestoreMock() {
  const rootSets: Record<string, any> = {};
  const snapshotSets: Record<string, any> = {};
  const collection = jest.fn((name: string) => {
    if (name === 'events') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          path: `events/${id}`,
          collection: jest.fn((sub: string) => ({
            doc: jest.fn((snapshotId: string) => ({
              id: snapshotId,
              path: `events/${id}/${sub}/${snapshotId}`,
            })),
            where: jest.fn((_field: string, _op: string, value: string) => ({
              __kind: 'query',
              correlationId: id,
              idempotencyKey: value,
              limit: jest.fn(() => ({ __kind: 'query', correlationId: id, idempotencyKey: value })),
            })),
          })),
        })),
      };
    }
    return { doc: jest.fn((_id: string) => ({ path: `${name}/${_id}` })) };
  });
  const runTransaction = jest.fn(async (handler: any) => {
    const transaction = {
      get: jest.fn(async (ref: any) => {
        if (ref?.__kind === 'query') {
          const docs = Object.entries(snapshotSets)
            .filter(([key, data]) => key.startsWith(`${ref.correlationId}/`) && (data as any).idempotencyKey === ref.idempotencyKey)
            .map(([, data]) => data);
          return makeQuerySnapshot(docs);
        }
        if (ref?.path?.startsWith('events/')) {
          const correlationId = String(ref.path).split('/')[1];
          return makeDocSnapshot(rootSets[correlationId], !!rootSets[correlationId]);
        }
        return makeDocSnapshot(undefined, false);
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

describe('persistence-service integration (mocked messaging + firestore)', () => {
  const handlers: { destination: string; handler: (msg: any, attr: any, ctx: any) => Promise<void> }[] = [];
  const firestore = makeFirestoreMock();

  beforeAll(() => {
    // Spy on onMessage to capture handlers instead of wiring a real subscriber
    jest
      .spyOn(BaseServer.prototype as any, 'onMessage')
      .mockImplementation(async (opts: any, handler: any) => {
        const destination = opts?.destination || opts?.subject || 'unknown';
        handlers.push({ destination, handler });
        // return dummy unsubscribe fn
        return () => {};
      });

    // Make getResource('firestore') return our mock
    jest
      .spyOn(BaseServer.prototype as any, 'getResource')
      .mockImplementation((...args: any[]) => (args[0] === 'firestore' ? firestore : undefined));

    // Import and bootstrap the app (registers handlers via our spies)
    const mod = require('../../apps/persistence-service');
    // Ensure app is created to trigger setup
    if (typeof mod.createApp === 'function') {
      mod.createApp();
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('ingress handler persists aggregate and initial snapshot', async () => {
    const h = handlers.find((x) => x.destination === 'internal.ingress.v1');
    expect(h).toBeTruthy();
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const msg = {
      v: '2',
      correlationId: 'it-1',
      type: 'chat.message.v1',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      egress: { destination: 'internal.egress.v1' },
      routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
      message: { id: 'm', role: 'user', text: 'hello' },
    };
    await h!.handler(msg, {}, ctx);
    expect(ack).toHaveBeenCalled();
    expect(firestore.__state.rootSets['it-1']).toMatchObject({ correlationId: 'it-1', status: 'INGESTED' });
    const snapshotKey = Object.keys(firestore.__state.snapshotSets).find((key) => key.startsWith('it-1/'));
    expect(snapshotKey).toBeTruthy();
    expect(firestore.__state.snapshotSets[snapshotKey!].kind).toBe('initial');
  });

  test('snapshot handler applies final snapshot and updates aggregate', async () => {
    const ingressHandler = handlers.find((x) => x.destination === 'internal.ingress.v1');
    const h = handlers.find((x) => x.destination === 'internal.persistence.snapshot.v1');
    expect(ingressHandler).toBeTruthy();
    expect(h).toBeTruthy();
    await ingressHandler!.handler({
      v: '2',
      correlationId: 'it-2',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2024-01-01T00:00:00Z', source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      egress: { destination: 'internal.egress.v1' },
      routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
      message: { id: 'm', role: 'user', text: 'hello' },
    }, {}, { ack: jest.fn(async () => {}) });
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const msg = {
      v: '1',
      correlationId: 'it-2',
      kind: 'final',
      capturedAt: '2024-01-01T00:00:00Z',
      sourceService: 'ingress-egress',
      sourceTopic: 'internal.egress.v1',
      idempotencyKey: 'it-2:final',
      delivery: { destination: 'egress://default', deliveredAt: '2024-01-01T00:00:00Z', status: 'SENT' },
      event: {
        v: '2',
        correlationId: 'it-2',
        type: 'chat.message.v1',
        ingress: { ingressAt: '2024-01-01T00:00:00Z', source: 'ingress.twitch' },
        identity: { external: { id: 'u1', platform: 'twitch' } },
        egress: { destination: 'internal.egress.v1' },
        routing: { stage: 'response', slip: [{ id: 'egress', status: 'OK' }], history: [] },
        candidates: [{ id: 'c1', kind: 'text', source: 'unit', createdAt: '2024-01-01T00:00:00Z', status: 'selected', priority: 1, text: 'yo' }],
      },
    };
    await h!.handler(msg, {}, ctx);
    expect(ack).toHaveBeenCalled();
    expect(firestore.__state.rootSets['it-2']).toMatchObject({ status: 'FINALIZED', delivery: { status: 'SENT', destination: 'egress://default' } });
    const snapshotKey = Object.keys(firestore.__state.snapshotSets).find((key) => key.startsWith('it-2/') && !key.endsWith('initial'));
    expect(snapshotKey).toBeTruthy();
    expect(firestore.__state.snapshotSets[snapshotKey!].sequence).toBe(2);
  });

  test('snapshot handler is idempotent on duplicate idempotency keys', async () => {
    const ingressHandler = handlers.find((x) => x.destination === 'internal.ingress.v1');
    const h = handlers.find((x) => x.destination === 'internal.persistence.snapshot.v1');
    expect(ingressHandler).toBeTruthy();
    expect(h).toBeTruthy();
    await ingressHandler!.handler({
      v: '2',
      correlationId: 'it-3',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2024-01-01T00:00:00Z', source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      egress: { destination: 'internal.egress.v1' },
      routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
      message: { id: 'm', role: 'user', text: 'hello' },
    }, {}, { ack: jest.fn(async () => {}) });
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const msg = {
      v: '1',
      correlationId: 'it-3',
      kind: 'final',
      capturedAt: '2024-01-01T00:00:00Z',
      sourceService: 'ingress-egress',
      sourceTopic: 'internal.egress.v1',
      idempotencyKey: 'it-3:final',
      delivery: { destination: 'egress://default', deliveredAt: '2024-01-01T00:00:00Z', status: 'SENT' },
      event: {
        v: '2',
        correlationId: 'it-3',
        type: 'chat.message.v1',
        ingress: { ingressAt: '2024-01-01T00:00:00Z', source: 'ingress.twitch' },
        identity: { external: { id: 'u1', platform: 'twitch' } },
        egress: { destination: 'internal.egress.v1' },
        routing: { stage: 'response', slip: [{ id: 'egress', status: 'OK' }], history: [] },
      },
    };
    await h!.handler(msg, {}, ctx);
    await h!.handler(msg, {}, ctx);
    expect(ack).toHaveBeenCalled();
    const snapshotKeys = Object.keys(firestore.__state.snapshotSets).filter((key) => key.startsWith('it-3/'));
    expect(snapshotKeys).toHaveLength(2);
    expect(firestore.__state.rootSets['it-3'].snapshotCount).toBe(2);
  });
});
