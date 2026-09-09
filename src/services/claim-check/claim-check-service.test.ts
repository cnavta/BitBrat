/**
 * Unit Tests for ClaimCheckService (Sprint 24)
 *
 * Tests Redis-backed temporary storage for events and blobs with mocked Redis.
 *
 * NOTE: Some tests using the old storeEventClaim(correlationId, event) API are marked
 * as deprecated. See claim-check-service-versioning.test.ts for comprehensive tests
 * of the current storeEventClaim(snapshot, ttl) API with versioning support.
 */

// @ts-nocheck - Some tests use deprecated API signatures for historical reference
import { ClaimCheckService, type BlobMetadata, type BlobStoreResult, type StoredSnapshot, type StoreSnapshotResult } from './claim-check-service';
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
const createTestEvent = (): InternalEventV2 => ({
  v: '2',
  correlationId: 'corr-123',
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
  capturedAt?: string
): PersistenceSnapshotEventV1 => ({
  v: '1',
  correlationId: event.correlationId,
  kind,
  sourceService: 'test-service',
  sourceTopic: 'internal.ingress.v1',
  capturedAt: capturedAt || new Date().toISOString(),
  idempotencyKey: `${event.correlationId}:${kind}:test-service:internal.ingress.v1:${capturedAt || new Date().toISOString()}`,
  event,
});

describe('ClaimCheckService', () => {
  let service: ClaimCheckService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClaimCheckService(
      mockRedisClient as RedisClientType,
      mockConfig,
      mockLogger
    );
  });

  describe('Constructor', () => {
    it('should initialize with configuration defaults', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.service.initialized',
        expect.objectContaining({
          maxEventSize: 1048576,
          maxBlobSize: 10485760,
          defaultTtl: 300,
          maxTtl: 3600,
        })
      );
    });

    it('should use default values when config not provided', () => {
      const emptyConfig = {} as IConfig;
      const service2 = new ClaimCheckService(
        mockRedisClient as RedisClientType,
        emptyConfig,
        mockLogger
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.service.initialized',
        expect.objectContaining({
          maxEventSize: 1048576,
          maxBlobSize: 10485760,
          defaultTtl: 300,
          maxTtl: 3600,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Event Claim Check Operations
  // ─────────────────────────────────────────────────────────

  describe.skip('DEPRECATED: storeEventClaim (pre-Sprint 24 tests)', () => {
    // These tests use the old signature: storeEventClaim(correlationId, event, ttl)
    // Sprint 24 changed signature to: storeEventClaim(snapshot, ttl)
    // See claim-check-service-versioning.test.ts for Sprint 24 tests
    beforeEach(() => {
      mockSet.mockResolvedValue('OK');
    });

    it('should store event with default TTL', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event);

      expect(mockSet).toHaveBeenCalledWith(
        'bitbrat:claim:event:corr-123',
        JSON.stringify(event),
        { EX: 300 }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.event.stored',
        expect.objectContaining({
          correlationId: 'corr-123',
          ttl: 300,
        })
      );
    });

    it('should store event with custom TTL', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, 600);

      expect(mockSet).toHaveBeenCalledWith(
        'bitbrat:claim:event:corr-123',
        expect.any(String),
        { EX: 600 }
      );
    });

    it('should cap TTL at max TTL', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, 5000);

      expect(mockSet).toHaveBeenCalledWith(
        'bitbrat:claim:event:corr-123',
        expect.any(String),
        { EX: 3600 } // Capped at maxTtl
      );
    });

    it('should throw error if event exceeds max size', async () => {
      const largeEvent = createTestEvent();
      largeEvent.payload = { data: 'x'.repeat(2000000) }; // > 1MB

      await expect(
        service.storeEventClaim('corr-123', largeEvent)
      ).rejects.toThrow(/Event exceeds max size/);

      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should use default TTL for invalid TTL values', async () => {
      const event = createTestEvent();

      await service.storeEventClaim('corr-123', event, -1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );

      jest.clearAllMocks();

      await service.storeEventClaim('corr-123', event, 0);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
    });
  });

  describe('retrieveEventClaim', () => {
    it('should retrieve and parse stored event', async () => {
      const event = createTestEvent();
      mockGet.mockResolvedValue(JSON.stringify(event));

      const result = await service.retrieveEventClaim('corr-123');

      expect(mockGet).toHaveBeenCalledWith('bitbrat:claim:event:corr-123');
      expect(result).toEqual(event);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.event.retrieved',
        { correlationId: 'corr-123' }
      );
    });

    it('should return null if event not found', async () => {
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

  describe('eventClaimExists', () => {
    it('should return true if event exists', async () => {
      mockExists.mockResolvedValue(1);

      const result = await service.eventClaimExists('corr-123');

      expect(mockExists).toHaveBeenCalledWith('bitbrat:claim:event:corr-123');
      expect(result).toBe(true);
    });

    it('should return false if event does not exist', async () => {
      mockExists.mockResolvedValue(0);

      const result = await service.eventClaimExists('corr-123');

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Blob Claim Check Operations
  // ─────────────────────────────────────────────────────────

  describe('storeBlobClaim', () => {
    beforeEach(() => {
      mockSet.mockResolvedValue('OK');
    });

    it('should store blob with metadata using default TTL', async () => {
      const data = Buffer.from('test blob data');
      const result = await service.storeBlobClaim(data);

      expect(result).toMatchObject({
        blobId: expect.stringMatching(/^blob-[a-f0-9-]+$/),
        size: data.length,
        expiresAt: expect.any(String),
      });

      expect(mockSet).toHaveBeenCalledTimes(2); // Data + metadata

      // Verify data storage (base64 encoded)
      const base64Data = data.toString('base64');
      expect(mockSet).toHaveBeenCalledWith(
        expect.stringMatching(/^bitbrat:claim:blob:blob-/),
        base64Data,
        { EX: 300 }
      );

      // Verify metadata storage
      expect(mockSet).toHaveBeenCalledWith(
        expect.stringMatching(/^bitbrat:claim:blob:blob-.*:meta$/),
        expect.any(String),
        { EX: 300 }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.blob.stored',
        expect.objectContaining({
          blobId: expect.stringMatching(/^blob-/),
          size: data.length,
          ttl: 300,
        })
      );
    });

    it('should store blob with custom contentType and TTL', async () => {
      const data = Buffer.from('image data');
      const result = await service.storeBlobClaim(data, {
        contentType: 'image/png',
        ttl: 600,
      });

      expect(result.size).toBe(data.length);

      const metadataCall = mockSet.mock.calls.find(call =>
        call[0].endsWith(':meta')
      );
      const metadata = JSON.parse(metadataCall[1]) as BlobMetadata;

      expect(metadata).toMatchObject({
        contentType: 'image/png',
        size: data.length,
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.blob.stored',
        expect.objectContaining({
          contentType: 'image/png',
          ttl: 600,
        })
      );
    });

    it('should throw error if blob exceeds max size', async () => {
      const largeData = Buffer.alloc(11 * 1024 * 1024); // > 10MB

      await expect(
        service.storeBlobClaim(largeData)
      ).rejects.toThrow(/Blob exceeds max size/);

      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should generate unique blob IDs', async () => {
      const data = Buffer.from('test');

      const result1 = await service.storeBlobClaim(data);
      const result2 = await service.storeBlobClaim(data);

      expect(result1.blobId).not.toBe(result2.blobId);
      expect(result1.blobId).toMatch(/^blob-[a-f0-9-]+$/);
      expect(result2.blobId).toMatch(/^blob-[a-f0-9-]+$/);
    });

    it('should cap TTL at max TTL', async () => {
      const data = Buffer.from('test');
      await service.storeBlobClaim(data, { ttl: 5000 });

      // Both data and metadata should use capped TTL
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 3600 }
      );
    });
  });

  describe('retrieveBlobClaim', () => {
    it('should retrieve blob data and metadata', async () => {
      const originalData = Buffer.from('test blob data');
      const base64Data = originalData.toString('base64');

      const metadata: BlobMetadata = {
        contentType: 'text/plain',
        size: originalData.length,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };

      mockGet
        .mockResolvedValueOnce(base64Data) // Data key
        .mockResolvedValueOnce(JSON.stringify(metadata)); // Metadata key

      const result = await service.retrieveBlobClaim('blob-123');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenCalledWith('bitbrat:claim:blob:blob-123');
      expect(mockGet).toHaveBeenCalledWith('bitbrat:claim:blob:blob-123:meta');

      expect(result).toMatchObject({
        data: expect.any(Buffer),
        contentType: 'text/plain',
        metadata,
      });

      expect(result!.data.toString()).toBe('test blob data');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.blob.retrieved',
        expect.objectContaining({ blobId: 'blob-123' })
      );
    });

    it('should return null if blob data not found', async () => {
      mockGet
        .mockResolvedValueOnce(null) // Data key
        .mockResolvedValueOnce('{}'); // Metadata key

      const result = await service.retrieveBlobClaim('blob-123');

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'claim_check.blob.not_found',
        { blobId: 'blob-123' }
      );
    });

    it('should return null if metadata not found', async () => {
      mockGet
        .mockResolvedValueOnce('data') // Data key
        .mockResolvedValueOnce(null); // Metadata key

      const result = await service.retrieveBlobClaim('blob-123');

      expect(result).toBeNull();
    });

    it('should return null and log error on metadata parse failure', async () => {
      mockGet
        .mockResolvedValueOnce('dGVzdA==') // Data key (base64)
        .mockResolvedValueOnce('invalid-json{'); // Metadata key

      const result = await service.retrieveBlobClaim('blob-123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'claim_check.blob.metadata_parse_error',
        expect.objectContaining({
          blobId: 'blob-123',
          error: expect.any(String),
        })
      );
    });
  });

  describe('blobClaimExists', () => {
    it('should return true if blob exists', async () => {
      mockExists.mockResolvedValue(1);

      const result = await service.blobClaimExists('blob-123');

      expect(mockExists).toHaveBeenCalledWith('bitbrat:claim:blob:blob-123');
      expect(result).toBe(true);
    });

    it('should return false if blob does not exist', async () => {
      mockExists.mockResolvedValue(0);

      const result = await service.blobClaimExists('blob-123');

      expect(result).toBe(false);
    });
  });

  describe('deleteBlobClaim', () => {
    it('should delete both data and metadata keys', async () => {
      mockDel.mockResolvedValue(1);

      await service.deleteBlobClaim('blob-123');

      expect(mockDel).toHaveBeenCalledTimes(2);
      expect(mockDel).toHaveBeenCalledWith('bitbrat:claim:blob:blob-123');
      expect(mockDel).toHaveBeenCalledWith('bitbrat:claim:blob:blob-123:meta');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'claim_check.blob.deleted',
        { blobId: 'blob-123' }
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Key Generation
  // ─────────────────────────────────────────────────────────

  describe.skip('DEPRECATED: Key Generation (pre-Sprint 24)', () => {
    // Uses old storeEventClaim signature
    it('should generate correct event key format', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('test-corr-id', event);

      expect(mockSet).toHaveBeenCalledWith(
        'bitbrat:claim:event:test-corr-id',
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should generate correct blob data key format', async () => {
      const data = Buffer.from('test');
      await service.storeBlobClaim(data);

      const dataCall = mockSet.mock.calls.find(call =>
        call[0].startsWith('bitbrat:claim:blob:') && !call[0].endsWith(':meta')
      );

      expect(dataCall[0]).toMatch(/^bitbrat:claim:blob:blob-[a-f0-9-]+$/);
    });

    it('should generate correct blob metadata key format', async () => {
      const data = Buffer.from('test');
      await service.storeBlobClaim(data);

      const metaCall = mockSet.mock.calls.find(call =>
        call[0].endsWith(':meta')
      );

      expect(metaCall[0]).toMatch(/^bitbrat:claim:blob:blob-[a-f0-9-]+:meta$/);
    });
  });

  // ─────────────────────────────────────────────────────────
  // TTL Normalization
  // ─────────────────────────────────────────────────────────

  describe.skip('DEPRECATED: TTL Normalization (pre-Sprint 24)', () => {
    // Uses old storeEventClaim signature
    it('should use default TTL when TTL not provided', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
    });

    it('should use default TTL for zero TTL', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, 0);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
    });

    it('should use default TTL for negative TTL', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, -100);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 300 }
      );
    });

    it('should cap TTL at maxTtl', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, 10000);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 3600 }
      );
    });

    it('should accept valid TTL within range', async () => {
      const event = createTestEvent();
      await service.storeEventClaim('corr-123', event, 600);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { EX: 600 }
      );
    });
  });
});
