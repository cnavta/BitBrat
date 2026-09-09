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
  
  test('upsertIngressEvent respects qos.persistenceTtlSec', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });

    const ingressAt = '2024-01-01T00:00:00Z';
    const evt = makeEvent({
      ingress: { ingressAt, source: 'ingress.twitch', connector: 'twitch' },
      qos: { persistenceTtlSec: 3600 }
    });

    const result = await store.upsertIngressEvent(evt);

    const expectedExpireAt = new Date('2024-01-01T01:00:00Z');
    // Mock Firestore Timestamp might not be identical to real one, but computeExpireAt uses it.
    // In our mock, we just store what's passed.
    expect(result.aggregate.expireAt!.toDate().toISOString()).toBe(expectedExpireAt.toISOString());
    expect(db.__state.rootSets['c-1'].expireAt.toDate().toISOString()).toBe(expectedExpireAt.toISOString());
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

  // ============================================================================
  // Sprint 24: Tests for 'initial' Snapshot Handling
  // ============================================================================

  describe('Sprint 24: initial snapshot handling', () => {
    test('applySnapshotEvent creates aggregate from initial snapshot (race condition)', async () => {
      const db = makeFirestoreMock();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const store = new PersistenceStore({ firestore: db, logger });

      // Initial snapshot arrives BEFORE upsertIngressEvent
      const now = new Date().toISOString();
      const result = await store.applySnapshotEvent({
        v: '1',
        correlationId: 'c-race',
        kind: 'initial',
        capturedAt: now,
        sourceService: 'ingress-egress',
        sourceTopic: 'internal.ingress.v1',
        idempotencyKey: 'c-race:initial:ingress-egress:internal.ingress.v1:' + now,
        event: makeEvent({ correlationId: 'c-race' }),
      });

      expect(result.duplicate).toBe(false);
      expect(result.snapshot.kind).toBe('initial');
      expect(result.snapshot.sequence).toBe(1);
      expect(result.aggregate.status).toBe('INGESTED');
      expect(result.aggregate.correlationId).toBe('c-race');
      expect(db.__state.rootSets['c-race']).toBeDefined();
      expect(db.__state.snapshotSets[`c-race/${result.snapshot.snapshotId}`].kind).toBe('initial');
    });

    test('applySnapshotEvent handles initial arriving after update (out-of-order)', async () => {
      const db = makeFirestoreMock();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const store = new PersistenceStore({ firestore: db, logger });

      // First, apply an 'update' snapshot (normal flow)
      await store.upsertIngressEvent(makeEvent({ correlationId: 'c-ooo' }));
      const updateTime = new Date().toISOString();
      await store.applySnapshotEvent({
        v: '1',
        correlationId: 'c-ooo',
        kind: 'update',
        capturedAt: updateTime,
        sourceService: 'llm-bot',
        sourceTopic: 'internal.analysis.v1',
        idempotencyKey: 'c-ooo:update:llm-bot:internal.analysis.v1:' + updateTime,
        event: makeEvent({ correlationId: 'c-ooo' }),
      });

      // Now apply an 'initial' snapshot (out-of-order)
      const initialTime = new Date().toISOString();
      const result = await store.applySnapshotEvent({
        v: '1',
        correlationId: 'c-ooo',
        kind: 'initial',
        capturedAt: initialTime,
        sourceService: 'ingress-egress',
        sourceTopic: 'internal.ingress.v1',
        idempotencyKey: 'c-ooo:initial:ingress-egress:internal.ingress.v1:' + initialTime,
        event: makeEvent({ correlationId: 'c-ooo' }),
      });

      expect(result.duplicate).toBe(false);
      expect(result.snapshot.kind).toBe('initial');
      expect(result.snapshot.sequence).toBe(3); // After initial + update
      expect(result.aggregate.status).toBe('INGESTED'); // 'initial' sets status to INGESTED
      expect(Object.keys(db.__state.snapshotSets).filter(k => k.startsWith('c-ooo/'))).toHaveLength(3);
    });

    test('applySnapshotEvent is idempotent for duplicate initial snapshots', async () => {
      const db = makeFirestoreMock();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const store = new PersistenceStore({ firestore: db, logger });

      const payload = {
        v: '1',
        correlationId: 'c-dup-init',
        kind: 'initial',
        capturedAt: '2024-01-01T10:00:00.000Z',
        sourceService: 'ingress-egress',
        sourceTopic: 'internal.ingress.v1',
        idempotencyKey: 'c-dup-init:initial:ingress-egress:internal.ingress.v1:2024-01-01T10:00:00.000Z',
        event: makeEvent({ correlationId: 'c-dup-init' }),
      };

      const first = await store.applySnapshotEvent(payload);
      const second = await store.applySnapshotEvent(payload);

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(first.snapshot.snapshotId).toBe(second.snapshot.snapshotId);
      expect(Object.keys(db.__state.snapshotSets).filter(k => k.startsWith('c-dup-init/'))).toHaveLength(1);
    });

    test('applySnapshotEvent stores all fields correctly for initial snapshots', async () => {
      const db = makeFirestoreMock();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const store = new PersistenceStore({ firestore: db, logger });

      const capturedAt = '2024-01-01T10:00:00.000Z';
      const event = makeEvent({
        correlationId: 'c-fields',
        type: 'chat.message.v1',
        ingress: { ingressAt: capturedAt, source: 'ingress.twitch', connector: 'twitch' },
        identity: { external: { id: 'u-123', platform: 'twitch', displayName: 'TestUser' } },
        message: { id: 'm1', role: 'user', text: 'Hello world' },
      });

      const result = await store.applySnapshotEvent({
        v: '1',
        correlationId: 'c-fields',
        kind: 'initial',
        capturedAt,
        sourceService: 'ingress-egress',
        sourceTopic: 'internal.ingress.v1',
        idempotencyKey: 'c-fields:initial:ingress-egress:internal.ingress.v1:' + capturedAt,
        event,
      });

      // Verify aggregate
      expect(result.aggregate.correlationId).toBe('c-fields');
      expect(result.aggregate.eventType).toBe('chat.message.v1');
      expect(result.aggregate.source).toBe('ingress.twitch');
      expect(result.aggregate.status).toBe('INGESTED');
      expect(result.aggregate.latestStage).toBe('initial'); // From event.routing.stage
      expect(result.aggregate.snapshotCount).toBe(1);
      expect(result.aggregate.identitySummary?.externalId).toBe('u-123');
      expect(result.aggregate.identitySummary?.platform).toBe('twitch');
      expect(result.aggregate.identitySummary?.displayName).toBe('TestUser');

      // Verify snapshot
      expect(result.snapshot.kind).toBe('initial');
      expect(result.snapshot.sequence).toBe(1);
      expect(result.snapshot.sourceService).toBe('ingress-egress');
      expect(result.snapshot.sourceTopic).toBe('internal.ingress.v1');
      expect(result.snapshot.event.message?.text).toBe('Hello world');
      expect(db.__state.snapshotSets[`c-fields/${result.snapshot.snapshotId}`]).toBeDefined();
    });

    test('deriveAggregateStatus returns INGESTED for initial snapshots', async () => {
      const db = makeFirestoreMock();
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const store = new PersistenceStore({ firestore: db, logger });

      const result = await store.applySnapshotEvent({
        v: '1',
        correlationId: 'c-status',
        kind: 'initial',
        capturedAt: new Date().toISOString(),
        sourceService: 'ingress-egress',
        sourceTopic: 'internal.ingress.v1',
        idempotencyKey: 'c-status:initial:test',
        event: makeEvent({ correlationId: 'c-status' }),
      });

      expect(result.aggregate.status).toBe('INGESTED');
      expect(result.aggregate.finalizedAt).toBeUndefined();
      expect(result.aggregate.finalSnapshotId).toBeUndefined();
    });
  });
});
