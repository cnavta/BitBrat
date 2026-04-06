import type { InternalEventV2 } from '../../types/events';
import { INTERNAL_PERSISTENCE_SNAPSHOT_V1 } from '../../types/events';
import { PersistenceStore } from './store';

function makeDocSnapshot(data: any, exists = true) {
  return {
    exists,
    data: () => data,
  };
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
          set: jest.fn(async (data: any) => {
            rootSets[id] = data;
          }),
          collection: jest.fn((sub: string) => ({
            doc: jest.fn((snapshotId: string) => ({
              id: snapshotId,
              path: `events/${id}/${sub}/${snapshotId}`,
              set: jest.fn(async (data: any) => {
                snapshotSets[`${id}/${snapshotId}`] = data;
              }),
            })),
            where: jest.fn((_field: string, _op: string, value: string) => ({
              __kind: 'query',
              correlationId: id,
              idempotencyKey: value,
              limit: jest.fn(() => ({
                __kind: 'query',
                correlationId: id,
                idempotencyKey: value,
              })),
            })),
          })),
        })),
      };
    }
    if (name === 'sources') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          path: `sources/${id}`,
          set: jest.fn(async (data: any) => {
            rootSets[`sources/${id}`] = data;
          }),
        })),
      };
    }
    throw new Error(`unexpected collection: ${name}`);
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
          const data = rootSets[correlationId];
          return makeDocSnapshot(data, !!data);
        }
        return makeDocSnapshot(undefined, false);
      }),
      set: jest.fn((ref: any, data: any) => {
        if (ref?.path?.startsWith('events/') && ref.path.includes('/snapshots/')) {
          const [, correlationId, , snapshotId] = String(ref.path).split('/');
          snapshotSets[`${correlationId}/${snapshotId}`] = data;
          return;
        }
        if (ref?.path?.startsWith('events/')) {
          const correlationId = String(ref.path).split('/')[1];
          rootSets[correlationId] = data;
          return;
        }
      }),
    };
    return handler(transaction);
  });

  return {
    collection,
    runTransaction,
    __state: { rootSets, snapshotSets },
  } as any;
}

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  const now = new Date().toISOString();
  return {
    v: '2',
    correlationId: 'c-1',
    type: 'chat.message.v1',
    ingress: { ingressAt: now, source: 'ingress.twitch' },
    identity: { external: { id: 'u1', platform: 'twitch' } },
    egress: { destination: 'internal.egress.v1' },
    message: { id: 'm1', role: 'user', text: 'hi' },
    routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
    ...overrides,
  } as InternalEventV2;
}

describe('PersistenceStore', () => {
  test('upsertIngressEvent creates aggregate and initial snapshot transactionally', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    const result = await store.upsertIngressEvent(makeEvent());

    expect(db.runTransaction).toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(result.aggregate.status).toBe('INGESTED');
    expect(result.snapshot.kind).toBe('initial');
    expect(db.__state.rootSets['c-1'].initialSnapshotId).toBe(result.snapshot.snapshotId);
    expect(db.__state.snapshotSets[`c-1/${result.snapshot.snapshotId}`].idempotencyKey).toContain('c-1:initial');
  });

  test('upsertIngressEvent is idempotent when aggregate already exists', async () => {
    const db = makeFirestoreMock();
    db.__state.rootSets['c-1'] = {
      correlationId: 'c-1',
      status: 'INGESTED',
      snapshotCount: 1,
      initialSnapshotId: 'c-1-000001-initial',
      latestSnapshotId: 'c-1-000001-initial',
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    const result = await store.upsertIngressEvent(makeEvent());

    expect(result.created).toBe(false);
    expect(Object.keys(db.__state.snapshotSets)).toHaveLength(0);
  });

  test('applySnapshotEvent writes snapshot and updates aggregate summary', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.upsertIngressEvent(makeEvent());

    const now = new Date().toISOString();
    const result = await store.applySnapshotEvent({
      v: '1',
      correlationId: 'c-1',
      kind: 'final',
      capturedAt: now,
      sourceService: 'ingress-egress',
      sourceTopic: INTERNAL_PERSISTENCE_SNAPSHOT_V1,
      idempotencyKey: 'c-1:final:sent',
      delivery: { destination: 'internal.egress.v1', deliveredAt: now, status: 'SENT' },
      event: makeEvent({ routing: { stage: 'response', slip: [{ id: 'egress', status: 'OK' }], history: [] } as any }),
    });

    expect(result.duplicate).toBe(false);
    expect(result.snapshot.sequence).toBe(2);
    expect(result.aggregate.status).toBe('FINALIZED');
    expect(result.aggregate.finalSnapshotId).toBe(result.snapshot.snapshotId);
    expect(result.aggregate.delivery?.status).toBe('SENT');
    expect(db.__state.snapshotSets[`c-1/${result.snapshot.snapshotId}`].kind).toBe('final');
  });

  test('applySnapshotEvent is idempotent for duplicate idempotency keys', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.upsertIngressEvent(makeEvent());

    const payload = {
      v: '1',
      correlationId: 'c-1',
      kind: 'final',
      capturedAt: '2024-01-01T00:00:00Z',
      sourceService: 'ingress-egress',
      sourceTopic: INTERNAL_PERSISTENCE_SNAPSHOT_V1,
      idempotencyKey: 'dup-key',
      delivery: { destination: 'internal.egress.v1', deliveredAt: '2024-01-01T00:00:00Z', status: 'SENT' },
      event: makeEvent({ routing: { stage: 'response', slip: [{ id: 'egress', status: 'OK' }], history: [] } as any }),
    };

    const first = await store.applySnapshotEvent(payload);
    const second = await store.applySnapshotEvent(payload);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(Object.keys(db.__state.snapshotSets)).toHaveLength(2);
    expect(db.__state.rootSets['c-1'].snapshotCount).toBe(2);
  });

  test('applyFinalization preserves compatibility-only aggregate summary updates', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    await store.applyFinalization({
      correlationId: 'c-compat',
      destination: 'internal.egress.v1',
      deliveredAt: '2024-01-01T00:00:00Z',
      status: 'SENT',
      candidates: [{ id: 'c1', kind: 'text', source: 't', createdAt: '2024-01-01T00:00:00Z', status: 'selected', priority: 1 }],
    });

    expect(db.__state.rootSets['c-compat']).toMatchObject({
      status: 'FINALIZED',
      delivery: { status: 'SENT', destination: 'internal.egress.v1' },
    });
    expect(db.__state.rootSets['c-compat'].currentProjection.candidates[0].status).toBe('selected');
  });

  test('applyDeadLetter writes a canonical deadletter snapshot', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.upsertIngressEvent(makeEvent({ correlationId: 'c-dlq' }));

    await store.applyDeadLetter({
      correlationId: 'c-dlq',
      payload: {
        reason: 'worker_fail',
        error: { code: 'WORKER_FAIL', message: 'boom' },
        lastStepId: 'worker',
      },
      original: makeEvent({ correlationId: 'c-dlq', routing: { stage: 'error', slip: [{ id: 'worker', status: 'ERROR' }], history: [] } as any }),
    });

    const aggregate = db.__state.rootSets['c-dlq'];
    const snapshotKey = Object.keys(db.__state.snapshotSets).find((key) => key.startsWith('c-dlq/') && key !== 'c-dlq/c-dlq-000001-initial');
    expect(aggregate.status).toBe('ERROR');
    expect(aggregate.deadletter.reason).toBe('worker_fail');
    expect(snapshotKey).toBeTruthy();
    expect(db.__state.snapshotSets[snapshotKey!].kind).toBe('deadletter');
  });

  test('applyDeadLetter logs warning and skips if no correlationId', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    await store.applyDeadLetter({ payload: { reason: 'lost' } });

    expect(Object.keys(db.__state.rootSets)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('persistence.deadletter.missing_correlationId', expect.any(Object));
  });

  test('upsertSourceState handles Twilio status', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    await store.upsertSourceState({
      v: '2',
      correlationId: 'c-twilio-status',
      type: 'system.source.status',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
      identity: { external: { id: 'u1', platform: 'twilio' } },
      egress: { destination: 'test' },
      routing: { stage: 'meta', slip: [], history: [] },
      payload: { platform: 'twilio', id: '+1234567890', status: 'CONNECTED', displayName: 'Twilio Bot' },
    } as any);

    expect(db.__state.rootSets['sources/twilio:+1234567890']).toMatchObject({ platform: 'twilio', status: 'CONNECTED' });
  });

  test('upsertSourceState handles stream online/offline events', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    await store.upsertSourceState({
      v: '2',
      correlationId: 'c-stream-1',
      type: 'system.stream.online',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twitch.eventsub' },
      identity: { external: { id: '12345', platform: 'twitch' } },
      egress: { destination: 'test' },
      routing: { stage: 'meta', slip: [], history: [] },
      externalEvent: {
        id: 'ee1',
        source: 'twitch.eventsub',
        kind: 'stream.online',
        version: '1',
        createdAt: new Date().toISOString(),
        metadata: { broadcasterId: '12345', viewer_count: 100 },
      },
    } as any);

    expect(db.__state.rootSets['sources/twitch:12345']).toMatchObject({ streamStatus: 'ONLINE', viewerCount: 100 });
  });
});
