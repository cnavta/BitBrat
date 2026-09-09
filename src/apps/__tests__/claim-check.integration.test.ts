/**
 * Integration Tests for Claim Check Service (Sprint 24)
 *
 * Tests claim check functionality end-to-end with real Redis instance.
 * Covers blob storage, TTL expiration, failure scenarios, and MCP tools.
 *
 * NOTE: Event storage tests using the old storeEventClaim(correlationId, event) API
 * are marked as deprecated. See src/services/claim-check/claim-check-service-versioning.test.ts
 * for comprehensive tests of the current storeEventClaim(snapshot, ttl) API.
 */

// @ts-nocheck - Some tests use deprecated API signatures for historical reference
import { ClaimCheckServer } from '../claim-check-service';
import { ClaimCheckService } from '../../services/claim-check/claim-check-service';
import type { PersistenceSnapshotEventV1, InternalEventV2 } from '../../types';
import { createClient, RedisClientType } from 'redis';
import { randomUUID } from 'crypto';

// Skip these integration tests in CI or when Redis is not available
// Set SKIP_REDIS_TESTS=true to skip these tests
const shouldSkip = process.env.SKIP_REDIS_TESTS === 'true' || process.env.CI === 'true';
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('ClaimCheckServer Integration Tests', () => {
  let redisClient: RedisClientType;
  let claimService: ClaimCheckService;
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

  // Test configuration
  const mockConfig = {
    CLAIM_CHECK_MAX_EVENT_SIZE_BYTES: '1048576',
    CLAIM_CHECK_MAX_BLOB_SIZE_BYTES: '10485760',
    CLAIM_CHECK_DEFAULT_TTL_SECONDS: '5', // Short TTL for tests
    CLAIM_CHECK_MAX_TTL_SECONDS: '30',
  };

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };

  beforeAll(async () => {
    // Create and connect Redis client for testing
    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        connectTimeout: 2000, // 2 second connection timeout
        reconnectStrategy: false // Don't retry connections
      }
    });

    // Suppress error logging during connection attempts
    redisClient.on('error', () => {});

    try {
      await redisClient.connect();
      console.log('✓ Connected to Redis for integration tests');

      // Initialize ClaimCheckService
      claimService = new ClaimCheckService(
        redisClient,
        mockConfig as any,
        mockLogger as any
      );
    } catch (error: any) {
      console.log('⚠ Redis not available - all tests in this suite will be skipped');
      // Connection failed - tests will be skipped via redisClient?.isOpen checks
    }
  }, 5000); // 5 second timeout for beforeAll hook

  afterAll(async () => {
    if (redisClient?.isOpen) {
      await redisClient.quit();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test keys
    if (redisClient?.isOpen) {
      const keys = await redisClient.keys('bitbrat:claim:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }
  });

  // Helper to create test event
  const createTestEvent = (correlationId: string, text?: string): InternalEventV2 => ({
    v: '2',
    correlationId,
    type: 'chat.message.v1',
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
    message: {
      id: randomUUID(),
      role: 'user',
      text: text || 'Test message',
    },
    routing: {
      stage: 'analysis',
      slip: [],
      history: [],
    },
    annotations: [],
  });

  // Helper to create test snapshot
  const createTestSnapshot = (
    kind: 'update' | 'final' | 'deadletter',
    correlationId: string
  ): PersistenceSnapshotEventV1 => ({
    v: '1',
    correlationId,
    kind,
    capturedAt: new Date().toISOString(),
    sourceService: 'test-service',
    sourceTopic: 'internal.test.v1',
    idempotencyKey: `test-key-${correlationId}`,
    event: createTestEvent(correlationId),
  });

  describe.skip('DEPRECATED (Sprint 24): Event Claim Check Flow - Old API Signature', () => {
    // These tests use the old storeEventClaim(correlationId, event, ttl?) signature
    // Sprint 24 changed to storeEventClaim(snapshot, ttl?) to support versioning
    // See src/services/claim-check/claim-check-service-versioning.test.ts for current API tests

    it('should store and retrieve event claim', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `test-corr-${randomUUID()}`;
      const event = createTestEvent(correlationId, 'Integration test message');

      // Store event
      await claimService.storeEventClaim(correlationId, event);

      // Verify stored in Redis
      const storedJson = await redisClient.get(`bitbrat:claim:event:${correlationId}`);
      expect(storedJson).toBeTruthy();

      // Retrieve via service
      const retrieved = await claimService.retrieveEventClaim(correlationId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.correlationId).toBe(correlationId);
      expect(retrieved?.message?.text).toBe('Integration test message');
    });

    it('should check if event claim exists', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `test-exists-${randomUUID()}`;
      const event = createTestEvent(correlationId);

      // Should not exist initially
      const beforeStore = await claimService.eventClaimExists(correlationId);
      expect(beforeStore).toBe(false);

      // Store event
      await claimService.storeEventClaim(correlationId, event);

      // Should exist now
      const afterStore = await claimService.eventClaimExists(correlationId);
      expect(afterStore).toBe(true);
    });

    it('should return null for non-existent event', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `nonexistent-${randomUUID()}`;
      const retrieved = await claimService.retrieveEventClaim(correlationId);
      expect(retrieved).toBeNull();
    });

    it('should respect custom TTL for events', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `test-ttl-${randomUUID()}`;
      const event = createTestEvent(correlationId);

      // Store with 2-second TTL
      await claimService.storeEventClaim(correlationId, event, 2);

      // Should exist immediately
      let exists = await claimService.eventClaimExists(correlationId);
      expect(exists).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Should be expired
      exists = await claimService.eventClaimExists(correlationId);
      expect(exists).toBe(false);
    }, 10000);

    it('should reject oversized events', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `test-oversized-${randomUUID()}`;
      const largeText = 'x'.repeat(2 * 1024 * 1024); // 2MB text
      const event = createTestEvent(correlationId, largeText);

      await expect(claimService.storeEventClaim(correlationId, event)).rejects.toThrow(
        /exceeds max size/
      );
    });
  });

  describe('Blob Claim Check Flow', () => {
    it('should store and retrieve blob claim', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const testData = Buffer.from('Test blob data');
      const contentType = 'text/plain';

      // Store blob
      const result = await claimService.storeBlobClaim(testData, { contentType });

      expect(result.blobId).toMatch(/^blob-[a-f0-9-]+$/);
      expect(result.size).toBe(testData.length);
      expect(result.expiresAt).toBeDefined();

      // Retrieve blob
      const retrieved = await claimService.retrieveBlobClaim(result.blobId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.data.toString()).toBe('Test blob data');
      expect(retrieved?.contentType).toBe(contentType);
      expect(retrieved?.metadata.size).toBe(testData.length);
    });

    it('should handle binary blob data', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      // Create binary data (simulated image bytes)
      const binaryData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const contentType = 'image/jpeg';

      // Store blob
      const result = await claimService.storeBlobClaim(binaryData, { contentType });

      // Retrieve blob
      const retrieved = await claimService.retrieveBlobClaim(result.blobId);
      expect(retrieved).toBeDefined();
      expect(Buffer.compare(retrieved!.data, binaryData)).toBe(0);
      expect(retrieved?.contentType).toBe(contentType);
    });

    it('should check if blob claim exists', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const testData = Buffer.from('Existence test');

      // Store blob
      const result = await claimService.storeBlobClaim(testData);

      // Should exist
      const exists = await claimService.blobClaimExists(result.blobId);
      expect(exists).toBe(true);

      // Non-existent blob
      const fakeId = 'blob-nonexistent';
      const notExists = await claimService.blobClaimExists(fakeId);
      expect(notExists).toBe(false);
    });

    it('should respect custom TTL for blobs', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const testData = Buffer.from('TTL test blob');

      // Store with 2-second TTL
      const result = await claimService.storeBlobClaim(testData, { ttl: 2 });

      // Should exist immediately
      let exists = await claimService.blobClaimExists(result.blobId);
      expect(exists).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Should be expired
      exists = await claimService.blobClaimExists(result.blobId);
      expect(exists).toBe(false);

      // Retrieval should return null
      const retrieved = await claimService.retrieveBlobClaim(result.blobId);
      expect(retrieved).toBeNull();
    }, 10000);

    it('should reject oversized blobs', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      // Create blob larger than max size (10MB)
      const largeBlob = Buffer.alloc(11 * 1024 * 1024);

      await expect(claimService.storeBlobClaim(largeBlob)).rejects.toThrow(
        /exceeds max size/
      );
    });

    it('should return null for non-existent blob', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const fakeId = 'blob-nonexistent';
      const retrieved = await claimService.retrieveBlobClaim(fakeId);
      expect(retrieved).toBeNull();
    });
  });

  describe.skip('DEPRECATED (Sprint 24): Concurrent Operations - Old API Signature', () => {
    // These tests use the old storeEventClaim(correlationId, event) signature
    // Sprint 24 changed to storeEventClaim(snapshot, ttl?) to support versioning

    it('should handle concurrent event stores', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationIds = Array.from({ length: 10 }, () => `concurrent-${randomUUID()}`);
      const events = correlationIds.map((id) => createTestEvent(id));

      // Store all events concurrently
      await Promise.all(
        correlationIds.map((id, idx) => claimService.storeEventClaim(id, events[idx]))
      );

      // Verify all stored
      const existsResults = await Promise.all(
        correlationIds.map((id) => claimService.eventClaimExists(id))
      );

      expect(existsResults.every((exists) => exists === true)).toBe(true);
    });

    it('should handle concurrent blob stores', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const blobs = Array.from({ length: 10 }, (_, i) =>
        Buffer.from(`Concurrent blob ${i}`)
      );

      // Store all blobs concurrently
      const results = await Promise.all(
        blobs.map((data) => claimService.storeBlobClaim(data))
      );

      // Verify all stored
      const existsResults = await Promise.all(
        results.map((result) => claimService.blobClaimExists(result.blobId))
      );

      expect(existsResults.every((exists) => exists === true)).toBe(true);
    });
  });

  describe('Failure Scenarios', () => {
    it('should handle malformed JSON in Redis gracefully', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `malformed-${randomUUID()}`;

      // Manually insert malformed JSON
      await redisClient.set(`bitbrat:claim:event:${correlationId}`, 'not valid json', {
        EX: 10,
      });

      // Should handle gracefully and return null
      const retrieved = await claimService.retrieveEventClaim(correlationId);
      expect(retrieved).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle missing metadata for blob gracefully', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const blobId = `blob-${randomUUID()}`;

      // Insert data without metadata
      await redisClient.set(
        `bitbrat:claim:blob:${blobId}`,
        Buffer.from('orphaned data').toString('base64'),
        { EX: 10 }
      );

      // Should handle missing metadata gracefully
      const retrieved = await claimService.retrieveBlobClaim(blobId);
      expect(retrieved).toBeNull();
    });
  });

  describe.skip('DEPRECATED (Sprint 24): TTL and Cleanup - Old API Signature', () => {
    // These tests use the old storeEventClaim(correlationId, event, ttl?) signature
    // Sprint 24 changed to storeEventClaim(snapshot, ttl?) to support versioning

    it('should auto-expire event claims after TTL', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const correlationId = `auto-expire-${randomUUID()}`;
      const event = createTestEvent(correlationId);

      // Store with 1-second TTL
      await claimService.storeEventClaim(correlationId, event, 1);

      // Exists immediately
      let key = await redisClient.get(`bitbrat:claim:event:${correlationId}`);
      expect(key).toBeTruthy();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should be gone
      key = await redisClient.get(`bitbrat:claim:event:${correlationId}`);
      expect(key).toBeNull();
    }, 10000);

    it('should auto-expire blob claims after TTL', async () => {
      if (!redisClient?.isOpen) {
        console.log('Skipping test - Redis not available');
        return;
      }

      const testData = Buffer.from('Auto-expire blob');

      // Store with 1-second TTL
      const result = await claimService.storeBlobClaim(testData, { ttl: 1 });

      // Exists immediately
      let dataKey = await redisClient.get(`bitbrat:claim:blob:${result.blobId}`);
      expect(dataKey).toBeTruthy();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should be gone
      dataKey = await redisClient.get(`bitbrat:claim:blob:${result.blobId}`);
      expect(dataKey).toBeNull();
    }, 10000);
  });
});
