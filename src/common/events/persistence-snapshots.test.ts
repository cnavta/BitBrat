import {
  resolvePersistenceSnapshotPolicy,
  shouldPublishSnapshot,
  buildPersistenceSnapshotEvent,
  publishPersistenceSnapshot,
  type PersistenceSnapshotMode,
  type PersistenceSnapshotPolicy,
} from './persistence-snapshots';
import type { InternalEventV2, SnapshotKind } from '../../types/events';

describe('persistence-snapshots', () => {
  describe('resolvePersistenceSnapshotPolicy', () => {
    it('should default to final-only mode', () => {
      // Save original env var and clear it for this test
      const originalMode = process.env.PERSISTENCE_SNAPSHOT_MODE;
      delete process.env.PERSISTENCE_SNAPSHOT_MODE;

      const policy = resolvePersistenceSnapshotPolicy({});
      expect(policy.mode).toBe('final-only');
      expect(policy.includeRawPayloads).toBe(true);
      expect(policy.ttlDays).toBe(7);

      // Restore original env var
      if (originalMode !== undefined) {
        process.env.PERSISTENCE_SNAPSHOT_MODE = originalMode;
      }
    });

    it('should parse all valid modes', () => {
      const modes: PersistenceSnapshotMode[] = ['off', 'final-only', 'significant', 'all'];
      modes.forEach((mode) => {
        const policy = resolvePersistenceSnapshotPolicy({ PERSISTENCE_SNAPSHOT_MODE: mode });
        expect(policy.mode).toBe(mode);
      });
    });

    it('should fall back to final-only for invalid mode', () => {
      const policy = resolvePersistenceSnapshotPolicy({ PERSISTENCE_SNAPSHOT_MODE: 'invalid' });
      expect(policy.mode).toBe('final-only');
    });

    it('should parse environment variables', () => {
      const policy = resolvePersistenceSnapshotPolicy({
        PERSISTENCE_SNAPSHOT_MODE: 'all',
        PERSISTENCE_INCLUDE_RAW_PAYLOADS: 'false',
        PERSISTENCE_MAX_SNAPSHOT_BYTES: '10000',
        PERSISTENCE_TTL_DAYS: '30',
      });
      expect(policy.mode).toBe('all');
      expect(policy.includeRawPayloads).toBe(false);
      expect(policy.maxSnapshotBytes).toBe(10000);
      expect(policy.ttlDays).toBe(30);
    });
  });

  describe('shouldPublishSnapshot', () => {
    describe('mode: off', () => {
      const policy: PersistenceSnapshotPolicy = {
        mode: 'off',
        includeRawPayloads: true,
        ttlDays: 7,
      };

      it('should NOT publish initial snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'initial')).toBe(false);
      });

      it('should NOT publish update snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'update')).toBe(false);
      });

      it('should NOT publish final snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'final')).toBe(false);
      });

      it('should NOT publish deadletter snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'deadletter')).toBe(false);
      });
    });

    describe('mode: final-only', () => {
      const policy: PersistenceSnapshotPolicy = {
        mode: 'final-only',
        includeRawPayloads: true,
        ttlDays: 7,
      };

      it('should publish initial snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'initial')).toBe(true);
      });

      it('should NOT publish update snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'update')).toBe(false);
      });

      it('should publish final snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'final')).toBe(true);
      });

      it('should publish deadletter snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'deadletter')).toBe(true);
      });
    });

    describe('mode: significant', () => {
      const policy: PersistenceSnapshotPolicy = {
        mode: 'significant',
        includeRawPayloads: true,
        ttlDays: 7,
      };

      it('should publish initial snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'initial')).toBe(true);
      });

      it('should publish update snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'update')).toBe(true);
      });

      it('should publish final snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'final')).toBe(true);
      });

      it('should publish deadletter snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'deadletter')).toBe(true);
      });
    });

    describe('mode: all', () => {
      const policy: PersistenceSnapshotPolicy = {
        mode: 'all',
        includeRawPayloads: true,
        ttlDays: 7,
      };

      it('should publish initial snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'initial')).toBe(true);
      });

      it('should publish update snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'update')).toBe(true);
      });

      it('should publish final snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'final')).toBe(true);
      });

      it('should publish deadletter snapshots', () => {
        expect(shouldPublishSnapshot(policy, 'deadletter')).toBe(true);
      });
    });
  });

  describe('buildPersistenceSnapshotEvent', () => {
    const mockEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'test-correlation-id',
      type: 'chat',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'test-platform',
        connector: 'twitch',
        channel: 'channel-123',
      },
      identity: {
        external: {
          id: 'user-123',
          platform: 'test-platform',
          displayName: 'Test User',
          roles: [],
        },
      },
      egress: {
        destination: 'test-destination',
        type: 'chat',
        connector: 'twitch',
        channel: 'channel-123',
      },
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      },
    };

    const policy: PersistenceSnapshotPolicy = {
      mode: 'all',
      includeRawPayloads: true,
      ttlDays: 7,
    };

    it('should build initial snapshot', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.kind).toBe('initial');
      expect(snapshot?.correlationId).toBe('test-correlation-id');
      expect(snapshot?.sourceService).toBe('test-service');
      expect(snapshot?.sourceTopic).toBe('test.topic.v1');
      expect(snapshot?.event.correlationId).toBe('test-correlation-id');
    });

    it('should build update snapshot', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'update',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
        changeSummary: 'Test update',
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.kind).toBe('update');
      expect(snapshot?.changeSummary).toBe('Test update');
    });

    it('should build final snapshot', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'final',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.kind).toBe('final');
    });

    it('should build deadletter snapshot', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'deadletter',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
        deadletter: {
          reason: 'Test failure',
          at: new Date().toISOString(),
          originalType: 'chat',
          lastStepId: 'test-step',
        },
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.kind).toBe('deadletter');
      expect(snapshot?.deadletter?.reason).toBe('Test failure');
    });

    it('should return null if policy does not allow publishing', () => {
      const offPolicy: PersistenceSnapshotPolicy = {
        mode: 'off',
        includeRawPayloads: true,
        ttlDays: 7,
      };

      const snapshot = buildPersistenceSnapshotEvent({
        policy: offPolicy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(snapshot).toBeNull();
    });

    it('should generate idempotency key if not provided', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.idempotencyKey).toContain('test-correlation-id');
      expect(snapshot?.idempotencyKey).toContain('initial');
      expect(snapshot?.idempotencyKey).toContain('test-service');
    });

    it('should use provided idempotency key', () => {
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
        idempotencyKey: 'custom-key',
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.idempotencyKey).toBe('custom-key');
    });

    it('should use provided capturedAt timestamp', () => {
      const customTime = '2026-08-25T10:00:00Z';
      const snapshot = buildPersistenceSnapshotEvent({
        policy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
        capturedAt: customTime,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.capturedAt).toBe(customTime);
    });

    it('should remove payload when includeRawPayloads is false', () => {
      const eventWithPayload: InternalEventV2 = {
        ...mockEvent,
        payload: { test: 'data' },
      };

      const noPayloadPolicy: PersistenceSnapshotPolicy = {
        mode: 'all',
        includeRawPayloads: false,
        ttlDays: 7,
      };

      const snapshot = buildPersistenceSnapshotEvent({
        policy: noPayloadPolicy,
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: eventWithPayload,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.event.payload).toBeUndefined();
    });
  });

  describe('publishPersistenceSnapshot', () => {
    it('should publish snapshot and return published: true', async () => {
      const mockPublisher = {
        publishJson: jest.fn().mockResolvedValue(undefined),
      };

      const mockEvent: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-platform',
          connector: 'twitch',
          channel: 'channel-123',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'test-platform',
            displayName: 'Test User',
            roles: [],
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'chat',
          connector: 'twitch',
          channel: 'channel-123',
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        },
      };

      const result = await publishPersistenceSnapshot({
        config: { PERSISTENCE_SNAPSHOT_MODE: 'all' },
        createPublisher: () => mockPublisher as any,
        logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(result.published).toBe(true);
      expect(result.payload?.kind).toBe('initial');
      expect(mockPublisher.publishJson).toHaveBeenCalled();
    });

    it('should return published: false if mode is off', async () => {
      const mockPublisher = {
        publishJson: jest.fn(),
      };

      const mockEvent: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-platform',
          connector: 'twitch',
          channel: 'channel-123',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'test-platform',
            displayName: 'Test User',
            roles: [],
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'chat',
          connector: 'twitch',
          channel: 'channel-123',
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        },
      };

      const result = await publishPersistenceSnapshot({
        config: { PERSISTENCE_SNAPSHOT_MODE: 'off' },
        createPublisher: () => mockPublisher as any,
        logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(result.published).toBe(false);
      expect(result.reason).toBe('mode_disabled');
      expect(mockPublisher.publishJson).not.toHaveBeenCalled();
    });

    it('should return published: false if publisher is unavailable', async () => {
      const mockEvent: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'chat',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test-platform',
          connector: 'twitch',
          channel: 'channel-123',
        },
        identity: {
          external: {
            id: 'user-123',
            platform: 'test-platform',
            displayName: 'Test User',
            roles: [],
          },
        },
        egress: {
          destination: 'test-destination',
          type: 'chat',
          connector: 'twitch',
          channel: 'channel-123',
        },
        routing: {
          stage: 'initial',
          slip: [],
          history: [],
        },
      };

      const result = await publishPersistenceSnapshot({
        config: { PERSISTENCE_SNAPSHOT_MODE: 'all' },
        createPublisher: () => undefined,
        logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        kind: 'initial',
        sourceService: 'test-service',
        sourceTopic: 'test.topic.v1',
        event: mockEvent,
      });

      expect(result.published).toBe(false);
      expect(result.reason).toBe('publisher_unavailable');
    });
  });
});
