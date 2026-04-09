import {
  buildPersistenceSnapshotEvent,
  publishPersistenceSnapshot,
  resolvePersistenceSnapshotPolicy,
} from './persistence-snapshots';
import type { InternalEventV2 } from '../../types/events';

function makeEvent(overrides: Partial<InternalEventV2> = {}): InternalEventV2 {
  return {
    v: '2',
    correlationId: 'corr-1',
    causationId: 'cause-1',
    traceId: 'trace-1',
    type: 'message.received.v1',
    ingress: {
      source: 'unit',
      channel: 'alpha',
      ingressAt: '2026-04-06T00:00:00.000Z',
    },
    identity: {
      external: { id: 'ext-1', platform: 'twitch', displayName: 'tester' },
      user: { id: 'user-1', displayName: 'Tester' },
    },
    egress: { destination: 'internal.egress.v1', type: 'chat' },
    routing: {
      stage: 'resolved',
      slip: [{ id: 'step-1', status: 'PENDING', nextTopic: 'internal.target.v1' } as any],
    },
    payload: { raw: 'x'.repeat(64) },
    metadata: { requestId: 'rq-1' },
    ...overrides,
  } as InternalEventV2;
}

describe('persistence snapshot helper', () => {
  test('resolves documented defaults and boolean/size policy knobs', () => {
    const policy = resolvePersistenceSnapshotPolicy({
      PERSISTENCE_SNAPSHOT_MODE: 'significant',
      PERSISTENCE_INCLUDE_RAW_PAYLOADS: 'false',
      PERSISTENCE_MAX_SNAPSHOT_BYTES: '256',
      PERSISTENCE_TTL_DAYS: '14',
    });

    expect(policy).toEqual({
      mode: 'significant',
      includeRawPayloads: false,
      maxSnapshotBytes: 256,
      ttlDays: 14,
    });
  });

  test('builds update snapshots only when policy mode allows them', () => {
    const event = makeEvent();

    const blocked = buildPersistenceSnapshotEvent({
      policy: { mode: 'final-only', includeRawPayloads: true, ttlDays: 7 },
      kind: 'update',
      sourceService: 'unit-service',
      sourceTopic: 'internal.target.v1',
      event,
      changeSummary: 'step advanced',
    });
    const allowed = buildPersistenceSnapshotEvent({
      policy: { mode: 'significant', includeRawPayloads: true, ttlDays: 7 },
      kind: 'update',
      sourceService: 'unit-service',
      sourceTopic: 'internal.target.v1',
      event,
      changeSummary: 'step advanced',
    });

    expect(blocked).toBeNull();
    expect(allowed?.kind).toBe('update');
    expect(allowed?.event.correlationId).toBe('corr-1');
  });

  test('trims raw payloads when disabled and publishes standardized payloads', async () => {
    const publishJson = jest.fn(async () => 'mid-1');
    const event = makeEvent();

    const result = await publishPersistenceSnapshot({
      config: {
        busPrefix: 'bb.',
        PERSISTENCE_SNAPSHOT_MODE: 'all',
        PERSISTENCE_INCLUDE_RAW_PAYLOADS: 'false',
        PERSISTENCE_MAX_SNAPSHOT_BYTES: '1024',
      },
      createPublisher: (subject: string) => {
        expect(subject).toBe('bb.internal.persistence.snapshot.v1');
        return { publishJson };
      },
      kind: 'final',
      sourceService: 'unit-service',
      sourceTopic: 'internal.egress.v1',
      event,
      changeSummary: 'delivery success',
      delivery: {
        destination: 'internal.egress.v1',
        status: 'SENT',
        deliveredAt: '2026-04-06T00:00:01.000Z',
      },
    });

    expect(result.published).toBe(true);
    expect(result.payload?.event.payload).toBeUndefined();
    expect(publishJson).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'final',
        sourceService: 'unit-service',
        sourceTopic: 'internal.egress.v1',
      }),
      expect.objectContaining({
        correlationId: 'corr-1',
        type: 'internal.persistence.snapshot.v1',
      }),
    );
  });
});