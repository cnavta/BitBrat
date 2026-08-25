/**
 * Unit Tests for ClaimCheckService Timestamp-Based Versioning (Sprint 24)
 *
 * Tests the new Sprint 24 versioning logic that handles out-of-order delivery.
 */

import { ClaimCheckService, type StoredSnapshot, type StoreSnapshotResult } from './claim-check-service';
import type { RedisClientType } from 'redis';
import type { Logger } from '../../common/logging';
import type { IConfig, InternalEventV2, PersistenceSnapshotEventV1, SnapshotKind } from '../../types';

// Mock Redis client
const mockSet = jest.fn();
const mockGet = jest.fn();
const mockExists = jest.fn();
const mockDel = jest.fn();

const mockRedisClient: Partial<RedisClientType> = {
  set: mockSet,
  get: mockGet,
  exists: mockExists,
  del: mockDel,
  isReady: true,
};

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  child: jest.fn(() => mockLogger),
} as any;

// Mock config
const mockConfig: IConfig = {
  CLAIM_CHECK_MAX_EVENT_SIZE_BYTES: '1048576', // 1MB
  CLAIM_CHECK_MAX_BLOB_SIZE_BYTES: '10485760', // 10MB
  CLAIM_CHECK_DEFAULT_TTL_SECONDS: '300', // 5 minutes
  CLAIM_CHECK_MAX_TTL_SECONDS: '3600', // 1 hour
} as any;

// Test fixtures
const createTestEvent = (correlationId: string = 'corr-123'): InternalEventV2 => ({
  v: '2',
  correlationId,
  type: 'test.event.v1',
  ingress: {
    ingressAt: new Date().toISOString(),
    source: 'test',
    connector: 'test' as any,
  },
  identity: {
    external: {
      id: 'user-123',
      platform: 'test',
      displayName: 'Test User',
    },
  },
  egress: {
    destination: 'test',
    connector: 'test' as any,
  },
  routing: {
    stage: 'analysis',
    slip: [],
    history: [],
  },
  annotations: [],
  message: {
    id: 'msg-123',
    role: 'user',
    text: 'test message',
  },
});

// Helper to create persistence snapshot from event
const createTestSnapshot = (
  event: InternalEventV2,
  kind: SnapshotKind = 'initial',
  capturedAt?: string,
  sequence?: number
): PersistenceSnapshotEventV1 => {
  const timestamp = capturedAt || new Date().toISOString();
  const baseKey = `${event.correlationId}:${kind}:test-service:internal.ingress.v1:${timestamp}`;
  const idempotencyKey = sequence !== undefined ? `${baseKey}:${sequence}` : baseKey;

  return {
    v: '1',
    correlationId: event.correlationId,
    kind,
    sourceService: 'test-service',
    sourceTopic: 'internal.ingress.v1',
    capturedAt: timestamp,
    idempotencyKey,
    event,
  };
};

describe('ClaimCheckService - Timestamp-Based Versioning (Sprint 24)', () => {
  let service: ClaimCheckService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClaimCheckService(
      mockRedisClient as RedisClientType,
      mockConfig,
      mockLogger
    );
  });

  describe('storeEventClaim - First Snapshot', () => {
    beforeEach(() => {
      mockSet.mockResolvedValue('OK');
      mockGet.mockResolvedValue(null); // No existing snapshot
    });

    it('should store initial snapshot when no existing snapshot exists', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event, 'initial');

      const result = await service.storeEventClaim(snapshot);

      expect(result).toBe('stored');
      expect(mockGet).toHaveBeenCalledWith('bitbrat:claim:event:corr-123');
      expect(mockSet).toHaveBeenCalledWith(
        'bitbrat:claim:event:corr-123',
        expect.any(String),
        { EX: 300 }
      );

      // Verify stored payload structure
      const storedPayload = JSON.parse(mockSet.mock.calls[0][1]);
      expect(storedPayload).toMatchObject({
        kind: 'initial',
        capturedAt: snapshot.capturedAt,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: expect.any(String),
        event: expect.objectContaining({ correlationId: 'corr-123' }),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.snapshot.stored',
        expect.objectContaining({
          correlationId: 'corr-123',
          kind: 'initial',
          capturedAt: snapshot.capturedAt,
        })
      );
    });

    it('should store snapshot with custom TTL', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event, 'initial');

      await service.storeEventClaim(snapshot, 600);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 600 }
      );
    });

    it('should extract and store sequence number from idempotency key', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event, 'initial', new Date().toISOString(), 42);

      await service.storeEventClaim(snapshot);

      const storedPayload = JSON.parse(mockSet.mock.calls[0][1]);
      expect(storedPayload.sequence).toBe(42);
    });

    it('should handle missing sequence number gracefully', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event, 'initial'); // No sequence

      await service.storeEventClaim(snapshot);

      const storedPayload = JSON.parse(mockSet.mock.calls[0][1]);
      expect(storedPayload.sequence).toBeUndefined();
    });
  });

  describe('storeEventClaim - Out-of-Order Delivery', () => {
    it('should accept newer snapshot (overwrites existing)', async () => {
      const event = createTestEvent();
      const existingTime = '2024-01-01T10:00:00.000Z';
      const newerTime = '2024-01-01T10:05:00.000Z';

      // Existing snapshot (stored first)
      const existingSnapshot: StoredSnapshot = {
        kind: 'initial',
        capturedAt: existingTime,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: existingTime,
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(existingSnapshot));
      mockSet.mockResolvedValue('OK');

      // Incoming snapshot (newer)
      const newerSnapshot = createTestSnapshot(event, 'update', newerTime);

      const result = await service.storeEventClaim(newerSnapshot);

      expect(result).toBe('stored');
      expect(mockSet).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.snapshot.stored',
        expect.objectContaining({
          correlationId: 'corr-123',
          kind: 'update',
          previousKind: 'initial',
        })
      );
    });

    it('should reject stale snapshot (older than existing)', async () => {
      const event = createTestEvent();
      const existingTime = '2024-01-01T10:05:00.000Z';
      const olderTime = '2024-01-01T10:00:00.000Z';

      // Existing snapshot (newer)
      const existingSnapshot: StoredSnapshot = {
        kind: 'update',
        capturedAt: existingTime,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: existingTime,
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(existingSnapshot));

      // Incoming snapshot (older - stale)
      const staleSnapshot = createTestSnapshot(event, 'initial', olderTime);

      const result = await service.storeEventClaim(staleSnapshot);

      expect(result).toBe('rejected_stale');
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.snapshot.rejected_stale',
        expect.objectContaining({
          correlationId: 'corr-123',
          existingKind: 'update',
          existingTime: existingTime,
          incomingKind: 'initial',
          incomingTime: olderTime,
        })
      );
    });

    it('should reject exact duplicate (same timestamp and kind)', async () => {
      const event = createTestEvent();
      const timestamp = '2024-01-01T10:00:00.000Z';

      // Existing snapshot
      const existingSnapshot: StoredSnapshot = {
        kind: 'initial',
        capturedAt: timestamp,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: timestamp,
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(existingSnapshot));

      // Incoming duplicate
      const duplicateSnapshot = createTestSnapshot(event, 'initial', timestamp);

      const result = await service.storeEventClaim(duplicateSnapshot);

      expect(result).toBe('rejected_stale');
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.snapshot.duplicate',
        expect.objectContaining({
          correlationId: 'corr-123',
          kind: 'initial',
        })
      );
    });

    it('should accept snapshot with same timestamp but different kind', async () => {
      const event = createTestEvent();
      const timestamp = '2024-01-01T10:00:00.000Z';

      // Existing snapshot (kind: initial)
      const existingSnapshot: StoredSnapshot = {
        kind: 'initial',
        capturedAt: timestamp,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: timestamp,
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(existingSnapshot));
      mockSet.mockResolvedValue('OK');

      // Incoming snapshot (kind: update, same timestamp)
      const newSnapshot = createTestSnapshot(event, 'update', timestamp);

      const result = await service.storeEventClaim(newSnapshot);

      expect(result).toBe('stored');
      expect(mockSet).toHaveBeenCalled();
    });
  });

  describe('storeEventClaim - Snapshot Evolution', () => {
    it('should accept progression: initial → update → final', async () => {
      const event = createTestEvent();
      const t1 = '2024-01-01T10:00:00.000Z';
      const t2 = '2024-01-01T10:01:00.000Z';
      const t3 = '2024-01-01T10:02:00.000Z';

      // Step 1: Store initial
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      const initialSnapshot = createTestSnapshot(event, 'initial', t1);
      let result = await service.storeEventClaim(initialSnapshot);
      expect(result).toBe('stored');

      // Step 2: Store update (newer)
      const storedInitial: StoredSnapshot = {
        kind: 'initial',
        capturedAt: t1,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: t1,
        event,
      };
      mockGet.mockResolvedValue(JSON.stringify(storedInitial));
      const updateSnapshot = createTestSnapshot(event, 'update', t2);
      result = await service.storeEventClaim(updateSnapshot);
      expect(result).toBe('stored');

      // Step 3: Store final (newest)
      const storedUpdate: StoredSnapshot = {
        kind: 'update',
        capturedAt: t2,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: t2,
        event,
      };
      mockGet.mockResolvedValue(JSON.stringify(storedUpdate));
      const finalSnapshot = createTestSnapshot(event, 'final', t3);
      result = await service.storeEventClaim(finalSnapshot);
      expect(result).toBe('stored');
    });

    it('should handle deadletter snapshots (always accepted if newer)', async () => {
      const event = createTestEvent();
      const existingTime = '2024-01-01T10:00:00.000Z';
      const deadletterTime = '2024-01-01T10:05:00.000Z';

      const existingSnapshot: StoredSnapshot = {
        kind: 'initial',
        capturedAt: existingTime,
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        updatedAt: existingTime,
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(existingSnapshot));
      mockSet.mockResolvedValue('OK');

      const deadletterSnapshot = createTestSnapshot(event, 'deadletter', deadletterTime);

      const result = await service.storeEventClaim(deadletterSnapshot);

      expect(result).toBe('stored');
      expect(mockSet).toHaveBeenCalled();
    });
  });

  describe('storeEventClaim - Error Handling', () => {
    it('should return rejected_error if event exceeds max size', async () => {
      const event = createTestEvent();
      event.payload = { data: 'x'.repeat(2000000) }; // > 1MB

      mockGet.mockResolvedValue(null);

      const snapshot = createTestSnapshot(event, 'initial');

      const result = await service.storeEventClaim(snapshot);

      expect(result).toBe('rejected_error');
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'claim_check.snapshot.size_exceeded',
        expect.objectContaining({
          correlationId: 'corr-123',
          size: expect.any(Number),
          maxSize: 1048576,
        })
      );
    });

    it('should return rejected_error and log on Redis error', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event, 'initial');

      mockGet.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.storeEventClaim(snapshot);

      expect(result).toBe('rejected_error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'claim_check.snapshot.store_error',
        expect.objectContaining({
          correlationId: 'corr-123',
          error: 'Redis connection failed',
        })
      );
    });
  });

  describe('retrieveEventClaim - Returns Versioned Snapshot', () => {
    it('should return StoredSnapshot with versioning metadata', async () => {
      const event = createTestEvent();
      const storedSnapshot: StoredSnapshot = {
        kind: 'update',
        capturedAt: '2024-01-01T10:00:00.000Z',
        sourceService: 'test-service',
        sourceTopic: 'internal.ingress.v1',
        sequence: 42,
        updatedAt: '2024-01-01T10:00:00.000Z',
        event,
      };

      mockGet.mockResolvedValue(JSON.stringify(storedSnapshot));

      const result = await service.retrieveEventClaim('corr-123');

      expect(result).toEqual(storedSnapshot);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.event.retrieved',
        expect.objectContaining({
          correlationId: 'corr-123',
          kind: 'update',
          capturedAt: '2024-01-01T10:00:00.000Z',
        })
      );
    });

    it('should return null if snapshot not found', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.retrieveEventClaim('corr-123');

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.event.not_found',
        { correlationId: 'corr-123' }
      );
    });

    it('should return null and log error on JSON parse failure', async () => {
      mockGet.mockResolvedValue('invalid-json{');

      const result = await service.retrieveEventClaim('corr-123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'claim_check.event.parse_error',
        expect.objectContaining({
          correlationId: 'corr-123',
          error: expect.any(String),
        })
      );
    });
  });

  describe('TTL Normalization', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
    });

    it('should use default TTL when not provided', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event);

      await service.storeEventClaim(snapshot);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 } // Default TTL
      );
    });

    it('should use custom TTL when provided', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event);

      await service.storeEventClaim(snapshot, 600);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 600 }
      );
    });

    it('should cap TTL at maxTtl', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event);

      await service.storeEventClaim(snapshot, 10000);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 3600 } // Capped at maxTtl
      );
    });

    it('should use default TTL for invalid values (0, negative)', async () => {
      const event = createTestEvent();
      const snapshot = createTestSnapshot(event);

      await service.storeEventClaim(snapshot, 0);
      expect(mockSet).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );

      jest.clearAllMocks();
      mockSet.mockResolvedValue('OK');

      await service.storeEventClaim(snapshot, -100);
      expect(mockSet).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
    });
  });
});
