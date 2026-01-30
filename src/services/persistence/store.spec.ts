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
      v: '2',
      correlationId: 'c-1',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
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
    expect(setCall[0]).toMatchObject({ status: 'FINALIZED', egressResult: { status: 'SENT', destination: 'egress://default' } });
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

  test('upsertIngressEvent handles Twilio messages with conversationSid', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-twilio',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twilio',
        channel: 'CH123',
      },
      identity: {
        external: { id: '+1234567890', platform: 'twilio' }
      },
      message: {
        id: 'msg-twilio',
        role: 'user',
        text: 'hello from sms',
        rawPlatformPayload: {
          author: '+1234567890',
          conversationSid: 'CH123'
        }
      } as any,
    } as any;
    await store.upsertIngressEvent(evt);
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[0].message.rawPlatformPayload.conversationSid).toBe('CH123');
    expect(setCall[0].ingress.source).toBe('ingress.twilio');
  });

  test('upsertSourceState handles Twilio status', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-twilio-status',
      type: 'system.source.status',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twilio',
      },
      payload: {
        platform: 'twilio',
        id: '+1234567890',
        status: 'CONNECTED',
        displayName: 'Twilio Bot'
      }
    } as any;
    await store.upsertSourceState(evt);
    expect(db.__fns.collection).toHaveBeenCalledWith('sources');
    expect(db.__fns.doc).toHaveBeenCalledWith('twilio:+1234567890');
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[0].platform).toBe('twilio');
    expect(setCall[0].status).toBe('CONNECTED');
  });

  test('applyFinalization uses qos.ttl seconds when provided', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const deliveredAt = '2024-01-01T00:00:00Z';
    const ttlSeconds = 3600; // 1 hour
    await store.applyFinalization({
      correlationId: 'c-qos',
      deliveredAt,
      status: 'SENT',
      qos: { ttl: ttlSeconds },
    } as any);
    const setCall = db.__fns.set.mock.calls[0];
    const expected = new Date(deliveredAt);
    expected.setUTCSeconds(expected.getUTCSeconds() + ttlSeconds);
    const ttlVal = setCall[0].ttl;
    let iso: string | undefined;
    if (ttlVal && typeof ttlVal.toDate === 'function') iso = ttlVal.toDate().toISOString();
    else if (ttlVal instanceof Date) iso = ttlVal.toISOString();
    else if (typeof ttlVal === 'string') iso = new Date(ttlVal).toISOString();
    else iso = undefined;
    expect(iso).toBe(expected.toISOString());
  });

  test('upsertSourceState handles stream online/offline events', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-stream-1',
      type: 'system.stream.online',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch.eventsub',
      },
      identity: {
        external: { id: '12345', platform: 'twitch' }
      },
      externalEvent: {
        id: 'ee1',
        source: 'twitch.eventsub',
        kind: 'stream.online',
        version: '1',
        createdAt: new Date().toISOString(),
        metadata: {
          broadcasterId: '12345',
          broadcasterLogin: 'testuser',
          viewer_count: 100
        }
      }
    } as any;
    
    await store.upsertSourceState(evt);
    expect(db.__fns.collection).toHaveBeenCalledWith('sources');
    expect(db.__fns.doc).toHaveBeenCalledWith('twitch:12345');
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[0]).toMatchObject({
      platform: 'twitch',
      id: '12345',
      streamStatus: 'ONLINE',
      viewerCount: 100
    });
  });

  test('applyDeadLetter writes ERROR patch and deadletter info', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    const now = new Date().toISOString();
    await store.applyDeadLetter({
      envelope: { correlationId: 'c-dlq-1' },
      type: 'router.deadletter.v1',
      payload: {
        reason: 'no_route',
        error: { code: 'ROUTING_FAILED', message: 'No matches' },
        lastStepId: 'step-1',
        slipSummary: 'ingress -> ?',
      },
    });
    const setCall = db.__fns.set.mock.calls[0];
    expect(setCall[1]).toEqual({ merge: true });
    expect(setCall[0]).toMatchObject({
      status: 'ERROR',
      deadletter: {
        reason: 'no_route',
        error: { code: 'ROUTING_FAILED' },
        lastStepId: 'step-1',
      },
    });
    expect(setCall[0].finalizedAt).toBeDefined();
    expect(setCall[0].ttl).toBeDefined();
  });

  test('applyDeadLetter works with correlationId at top level', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.applyDeadLetter({
      correlationId: 'c-dlq-2',
      payload: { reason: 'worker_fail' },
    });
    expect(db.__fns.doc).toHaveBeenCalledWith('c-dlq-2');
  });

  test('applyDeadLetter logs warning and skips if no correlationId', async () => {
    const db = makeFirestoreMock();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const store = new PersistenceStore({ firestore: db, logger });
    await store.applyDeadLetter({
      payload: { reason: 'lost' },
    });
    expect(db.__fns.set).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('persistence.deadletter.missing_correlationId', expect.any(Object));
  });
});
