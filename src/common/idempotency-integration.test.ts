/**
 * Integration Tests for Service-Level Idempotency (Sprint 1)
 *
 * These tests verify that idempotency middleware integrates correctly with the Bit base class
 * and that services properly deduplicate messages when Redis is available.
 */

import { checkIdempotency, generateIdempotencyKey } from './idempotency-middleware';
import type { RedisClientType } from 'redis';
import type { Logger } from './logging';

// Mock Redis client
const mockSet = jest.fn();
const mockRedisClient: Partial<RedisClientType> = {
  set: mockSet,
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

describe('Service-Level Idempotency Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue('OK');
    (mockRedisClient as any).isReady = true;
  });

  describe('Egress Message Flow (ingress-egress-service)', () => {
    it('should deduplicate egress messages within TTL window', async () => {
      const correlationId = 'test-egress-001';
      const topic = 'internal.egress.v1';

      // Simulate first egress message
      const config1 = {
        topic,
        correlationId,
        source: 'ingress-egress',
        ttlSeconds: 60, // Egress messages use 60s TTL
      };

      const result1 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result1.isDuplicate).toBe(false);
      expect(result1.checkSucceeded).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('bitbrat:idempotency:internal:egress:v1'),
        'processed',
        { NX: true, EX: 60 }
      );

      // Simulate duplicate egress message (within TTL)
      mockSet.mockResolvedValueOnce(null); // Redis returns null when key exists
      const result2 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result2.isDuplicate).toBe(true);
      expect(result2.checkSucceeded).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'idempotency.duplicate',
        expect.objectContaining({ correlationId })
      );
    });

    it('should generate correct key for egress messages', () => {
      const key = generateIdempotencyKey({
        topic: 'internal.egress.v1',
        correlationId: 'msg-123',
        source: 'ingress-egress',
      });

      expect(key).toBe('bitbrat:idempotency:internal:egress:v1:msg-123:ingress-egress');
    });
  });

  describe('Auth Enrichment Flow (auth-service)', () => {
    it('should deduplicate auth enrichment messages within TTL window', async () => {
      const correlationId = 'test-auth-001';
      const topic = 'internal.auth.v1';

      // Simulate first auth enrichment
      const config1 = {
        topic,
        correlationId,
        ttlSeconds: 300, // Auth uses 300s TTL
      };

      const result1 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result1.isDuplicate).toBe(false);
      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('bitbrat:idempotency:internal:auth:v1'),
        'processed',
        { NX: true, EX: 300 }
      );

      // Simulate duplicate auth enrichment (within TTL)
      mockSet.mockResolvedValueOnce(null);
      const result2 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result2.isDuplicate).toBe(true);
    });

    it('should normalize topic names correctly', () => {
      // Test with different bus prefixes
      const configs = [
        { topic: 'local.internal.auth.v1', correlationId: 'auth-123' },
        { topic: 'dev.internal.auth.v1', correlationId: 'auth-123' },
        { topic: 'staging.internal.auth.v1', correlationId: 'auth-123' },
        { topic: 'prod.internal.auth.v1', correlationId: 'auth-123' },
      ];

      configs.forEach((config) => {
        const key = generateIdempotencyKey(config);
        expect(key).toBe('bitbrat:idempotency:internal:auth:v1:auth-123');
      });
    });
  });

  describe('LLM Processing Flow (llm-bot-service)', () => {
    it('should deduplicate LLM requests within TTL window', async () => {
      const correlationId = 'test-llm-001';
      const topic = 'internal.llmbot.v1';

      // Simulate first LLM request
      const config1 = {
        topic,
        correlationId,
        ttlSeconds: 300, // LLM uses 300s TTL
      };

      const result1 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result1.isDuplicate).toBe(false);
      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('bitbrat:idempotency:internal:llmbot:v1'),
        'processed',
        { NX: true, EX: 300 }
      );

      // Simulate duplicate LLM request (within TTL)
      mockSet.mockResolvedValueOnce(null);
      const result2 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config1,
        mockLogger
      );

      expect(result2.isDuplicate).toBe(true);
    });

    it('should prevent expensive LLM calls from being duplicated', async () => {
      const correlationId = 'expensive-llm-request';
      const topic = 'internal.llmbot.v1';

      // First request succeeds
      mockSet.mockResolvedValueOnce('OK');
      const result1 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic, correlationId, ttlSeconds: 300 },
        mockLogger
      );

      expect(result1.isDuplicate).toBe(false);

      // Duplicate request blocked
      mockSet.mockResolvedValueOnce(null);
      const result2 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic, correlationId, ttlSeconds: 300 },
        mockLogger
      );

      expect(result2.isDuplicate).toBe(true);

      // Only one SET call should have succeeded (first one)
      expect(mockSet).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fail-Open Behavior', () => {
    it('should process messages when Redis is unavailable (egress)', async () => {
      const config = {
        topic: 'internal.egress.v1',
        correlationId: 'test-failopen-001',
        ttlSeconds: 60,
      };

      const result = await checkIdempotency(null, config, mockLogger);

      expect(result.isDuplicate).toBe(false);
      expect(result.checkSucceeded).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'idempotency.redis_unavailable',
        expect.objectContaining({
          message: expect.stringContaining('fail-open'),
        })
      );
    });

    it('should process messages when Redis is not ready (auth)', async () => {
      (mockRedisClient as any).isReady = false;

      const config = {
        topic: 'internal.auth.v1',
        correlationId: 'test-failopen-002',
        ttlSeconds: 300,
      };

      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.checkSucceeded).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'idempotency.redis_not_ready',
        expect.objectContaining({
          message: expect.stringContaining('fail-open'),
        })
      );
    });

    it('should process messages when Redis SET fails (llm-bot)', async () => {
      mockSet.mockRejectedValueOnce(new Error('Connection lost'));

      const config = {
        topic: 'internal.llmbot.v1',
        correlationId: 'test-failopen-003',
        ttlSeconds: 300,
      };

      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.checkSucceeded).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'idempotency.check_error',
        expect.objectContaining({
          error: 'Connection lost',
          message: expect.stringContaining('fail-open'),
        })
      );
    });
  });

  describe('TTL Configuration', () => {
    it('should use service-specific TTL values', async () => {
      // Egress: 60s
      const egressResult = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.egress.v1', correlationId: 'test-ttl-001', ttlSeconds: 60 },
        mockLogger
      );

      expect(egressResult.checkSucceeded).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 60 })
      );

      mockSet.mockClear();

      // Auth: 300s
      const authResult = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.auth.v1', correlationId: 'test-ttl-002', ttlSeconds: 300 },
        mockLogger
      );

      expect(authResult.checkSucceeded).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 300 })
      );

      mockSet.mockClear();

      // LLM: 300s
      const llmResult = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.llmbot.v1', correlationId: 'test-ttl-003', ttlSeconds: 300 },
        mockLogger
      );

      expect(llmResult.checkSucceeded).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 300 })
      );
    });

    it('should use default TTL when not specified', async () => {
      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.test.v1', correlationId: 'test-default-ttl' },
        mockLogger
      );

      expect(result.checkSucceeded).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 300 }) // Default is 300s
      );
    });
  });

  describe('Cross-Service Scenarios', () => {
    it('should deduplicate across service restarts (correlation ID preserved)', async () => {
      const correlationId = 'restart-test-001';

      // Process message before restart
      const beforeRestart = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.egress.v1', correlationId, ttlSeconds: 60 },
        mockLogger
      );

      expect(beforeRestart.isDuplicate).toBe(false);

      // Simulate service restart (same Redis instance, same correlation ID)
      mockSet.mockResolvedValueOnce(null); // Key still exists in Redis

      // Process same message after restart (within TTL window)
      const afterRestart = await checkIdempotency(
        mockRedisClient as RedisClientType,
        { topic: 'internal.egress.v1', correlationId, ttlSeconds: 60 },
        mockLogger
      );

      expect(afterRestart.isDuplicate).toBe(true);
    });

    it('should handle high-throughput scenarios', async () => {
      // Simulate 100 concurrent messages
      const promises = Array.from({ length: 100 }, (_, i) => {
        const correlationId = `high-throughput-${i}`;
        return checkIdempotency(
          mockRedisClient as RedisClientType,
          { topic: 'internal.egress.v1', correlationId, ttlSeconds: 60 },
          mockLogger
        );
      });

      const results = await Promise.all(promises);

      // All should succeed (no duplicates)
      results.forEach((result, i) => {
        expect(result.isDuplicate).toBe(false);
        expect(result.checkSucceeded).toBe(true);
      });

      // Redis SET should be called for each unique correlationId
      expect(mockSet).toHaveBeenCalledTimes(100);
    });
  });
});
