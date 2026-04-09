import { applySnapshotToAggregate, buildSnapshotId, computeExpireAt, normalizeIngressEvent, normalizeSnapshotEvent, normalizeSourceStatus } from './model';
import type { EventAggregateV2, InternalEventV2 } from '../../types/events';

describe('persistence/model', () => {
  test('normalizeIngressEvent maps InternalEventV2 into aggregate + initial snapshot', () => {
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'abc-123',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      message: { id: 'm1', role: 'user', text: 'hello' },
      annotations: [{ id: 'a1', kind: 'intent', source: 'test', createdAt: new Date().toISOString() }],
      candidates: [],
      errors: [],
      egress: { destination: 'egress://default' },
      routing: { stage: 'initial', slip: [{ id: 'router', status: 'PENDING' }], history: [] },
    } as any;
    const { aggregate, snapshot } = normalizeIngressEvent(evt);
    expect(aggregate.correlationId).toBe('abc-123');
    expect(aggregate.eventType).toBe('chat.message.v1');
    expect(aggregate.status).toBe('INGESTED');
    expect(aggregate.initialSnapshotId).toBe(snapshot.snapshotId);
    expect(aggregate.latestSnapshotId).toBe(snapshot.snapshotId);
    expect(aggregate.snapshotCount).toBe(1);
    expect(snapshot.kind).toBe('initial');
    expect(snapshot.event.message).toEqual(evt.message);
    expect(snapshot.sourceTopic).toBe('internal.ingress.v1');
  });

  test('normalizeIngressEvent strips undefined properties recursively', () => {
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'undef-1',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      egress: { destination: 'test' },
      routing: { stage: 'initial', slip: [], history: [] },
      // Explicit undefineds to simulate problematic payloads
      annotations: undefined as any,
      candidates: undefined as any,
      message: { id: 'm1', role: 'user', text: 'hello', rawPlatformPayload: { foo: undefined as any } as any } as any,
    } as any;
    const { aggregate, snapshot } = normalizeIngressEvent(evt);
    expect('annotations' in (aggregate.currentProjection as any)).toBe(false);
    expect('candidates' in (aggregate.currentProjection as any)).toBe(false);
    // Nested undefined removed
    expect('foo' in ((snapshot.event.message as any).rawPlatformPayload || {})).toBe(false);
  });

  test('normalizeSnapshotEvent supports final snapshot shapes', () => {
    const flat = normalizeSnapshotEvent({
      v: '1',
      correlationId: 'abc-123',
      kind: 'final',
      capturedAt: '2024-01-01T00:00:00Z',
      sourceService: 'ingress-egress',
      sourceTopic: 'internal.egress.v1',
      idempotencyKey: 'abc-123:final',
      delivery: { destination: 'egress://default', deliveredAt: '2024-01-01T00:00:00Z', status: 'SENT' },
      event: { correlationId: 'abc-123', routing: { stage: 'response', slip: [], history: [] } },
    });
    expect(flat.correlationId).toBe('abc-123');
    expect(flat.kind).toBe('final');
    expect(flat.delivery?.status).toBe('SENT');

    const nested = normalizeSnapshotEvent({
      v: '1',
      correlationId: 'z',
      kind: 'update',
      sourceService: 'router',
      sourceTopic: 'internal.routes.v1',
      idempotencyKey: 'z:update',
      event: { correlationId: 'z', routing: { stage: 'analysis', slip: [], history: [] } },
    });
    expect(nested.correlationId).toBe('z');
    expect(nested.kind).toBe('update');
    expect(nested.stage).toBe('analysis');
  });

  test('applySnapshotToAggregate updates status, delivery, and pointers', () => {
    const now = new Date().toISOString();
    const aggregate: EventAggregateV2 = {
      correlationId: 'c-x',
      eventType: 'chat.message.v1',
      source: 'ingress.twitch',
      status: 'INGESTED',
      ingressAt: now,
      initialSnapshotId: 'c-x-000001-initial',
      latestSnapshotId: 'c-x-000001-initial',
      snapshotCount: 1,
    };
    const snapshot = {
      v: '1',
      snapshotId: buildSnapshotId('c-x', 2, 'final'),
      correlationId: 'c-x',
      sequence: 2,
      kind: 'final',
      capturedAt: now,
      sourceService: 'ingress-egress',
      sourceTopic: 'internal.persistence.snapshot.v1',
      idempotencyKey: 'c-x:final',
      delivery: { destination: 'internal.egress.v1', deliveredAt: now, status: 'SENT' },
      event: {
        v: '2',
        correlationId: 'c-x',
        type: 'chat.message.v1',
        ingress: { ingressAt: now, source: 'ingress.twitch' },
        identity: { external: { id: 'u1', platform: 'twitch' } },
        egress: { destination: 'internal.egress.v1' },
        annotations: [{ id: 'a1', kind: 'intent', source: 't', createdAt: now }],
        candidates: [{ id: 'c1', kind: 'text', source: 't', createdAt: now, status: 'selected', priority: 1, text: 'hi' }],
        routing: { stage: 'response', slip: [], history: [] },
      },
    } as any;
    const out = applySnapshotToAggregate(aggregate, snapshot, 2);
    expect(out.status).toBe('FINALIZED');
    expect(out.finalSnapshotId).toBe(snapshot.snapshotId);
    expect(out.latestSnapshotId).toBe(snapshot.snapshotId);
    expect(out.snapshotCount).toBe(2);
    expect(out.delivery?.status).toBe('SENT');
    expect(out.currentProjection?.candidates?.[0].status).toBe('selected');
  });

  test('computeExpireAt honors qos ttl override', () => {
    const ttl = computeExpireAt({ baseDate: '2024-01-01T00:00:00Z', qosTtlSeconds: 90 });
    expect(ttl.toDate().toISOString()).toBe('2024-01-01T00:01:30.000Z');
  });

  test('normalizeSourceStatus handles Twilio status events', () => {
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twilio',
      },
      identity: {
        external: { id: 'u1', platform: 'twilio' }
      },
      egress: { destination: 'test' },
      type: 'system.source.status',
      payload: {
        platform: 'twilio',
        id: '+1234567890',
        status: 'CONNECTED',
        displayName: 'Twilio Bot',
        metrics: { messagesIn: 10, messagesOut: 10, errors: 0 }
      }
    } as any;

    const patch = normalizeSourceStatus(evt);
    expect(patch.platform).toBe('twilio');
    expect(patch.id).toBe('+1234567890');
    expect(patch.status).toBe('CONNECTED');
    expect(patch.displayName).toBe('Twilio Bot');
    expect(patch.metrics?.messagesIn).toBe(10);
    expect(patch.lastStatusUpdate).toBeDefined();
    expect(patch.metrics?.lastHeartbeat).toBeDefined();
  });
});
