/**
 * Unit Tests for Idempotency Middleware (Sprint 1)
 *
 * Tests distributed message deduplication logic with mocked Redis.
 */

import {
  checkIdempotency,
  generateIdempotencyKey,
  extractIdempotencyHints,
  mergeIdempotencyConfig,
  type IdempotencyConfig,
  type SubscriptionIdempotencyConfig,
} from './idempotency-middleware';
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

describe('Idempotency Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue('OK');
    (mockRedisClient as any).isReady = true;
  });

  describe('generateIdempotencyKey', () => {
    it('should generate key with topic and correlationId', () => {
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
      };

      const key = generateIdempotencyKey(config);

      expect(key).toBe('bitbrat:idempotency:internal:egress:v1:abc123');
    });

    it('should include source in key when provided', () => {
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
        source: 'ingress-egress',
      };

      const key = generateIdempotencyKey(config);

      expect(key).toBe('bitbrat:idempotency:internal:egress:v1:abc123:ingress-egress');
    });

    it('should normalize topic by removing bus prefix', () => {
      const configs = [
        { topic: 'local.internal.egress.v1', correlationId: 'abc' },
        { topic: 'dev.internal.egress.v1', correlationId: 'abc' },
        { topic: 'staging.internal.egress.v1', correlationId: 'abc' },
        { topic: 'prod.internal.egress.v1', correlationId: 'abc' },
      ];

      configs.forEach((config) => {
        const key = generateIdempotencyKey(config);
        expect(key).toBe('bitbrat:idempotency:internal:egress:v1:abc');
      });
    });

    it('should replace dots with colons in topic', () => {
      const config: IdempotencyConfig = {
        topic: 'internal.analysis.enriched.v2',
        correlationId: 'xyz789',
      };

      const key = generateIdempotencyKey(config);

      expect(key).toBe('bitbrat:idempotency:internal:analysis:enriched:v2:xyz789');
    });
  });

  describe('checkIdempotency', () => {
    it('should return isDuplicate=false for new message', async () => {
      mockSet.mockResolvedValueOnce('OK');

      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
        ttlSeconds: 60,
      };

      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.checkSucceeded).toBe(true);
      expect(result.key).toBe('bitbrat:idempotency:internal:egress:v1:abc123');
      expect(mockSet).toHaveBeenCalledWith('bitbrat:idempotency:internal:egress:v1:abc123', 'processed', {
        NX: true,
        EX: 60,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'idempotency.new',
        expect.objectContaining({
          correlationId: 'abc123',
          ttlSeconds: 60,
        })
      );
    });

    it('should return isDuplicate=true for duplicate message', async () => {
      mockSet.mockResolvedValueOnce(null); // Redis returns null when key exists

      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
      };

      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.checkSucceeded).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'idempotency.duplicate',
        expect.objectContaining({
          correlationId: 'abc123',
        })
      );
    });

    it('should use default TTL of 300 seconds when not specified', async () => {
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
      };

      await checkIdempotency(mockRedisClient as RedisClientType, config, mockLogger);

      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 300 })
      );
    });

    it('should use custom key function when provided', async () => {
      const customKeyFn = jest.fn(() => 'custom:key:123');
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
        customKeyFn,
      };

      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(customKeyFn).toHaveBeenCalledWith(config);
      expect(result.key).toBe('custom:key:123');
      expect(mockSet).toHaveBeenCalledWith('custom:key:123', expect.any(String), expect.any(Object));
    });

    it('should fail-open when Redis client is null', async () => {
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
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
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should fail-open when Redis client is not ready', async () => {
      (mockRedisClient as any).isReady = false;

      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
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
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should fail-open when Redis SET operation fails', async () => {
      mockSet.mockRejectedValueOnce(new Error('Connection lost'));

      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'abc123',
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

  describe('extractIdempotencyHints', () => {
    it('should extract ttlSeconds from message data', () => {
      const data = {
        idempotency: {
          ttlSeconds: 120,
        },
      };

      const hints = extractIdempotencyHints(data);

      expect(hints.ttlSeconds).toBe(120);
    });

    it('should extract source from message data', () => {
      const data = {
        idempotency: {
          source: 'custom-producer',
        },
      };

      const hints = extractIdempotencyHints(data);

      expect(hints.source).toBe('custom-producer');
    });

    it('should return empty object for message without idempotency hints', () => {
      const data = { correlationId: 'abc' };

      const hints = extractIdempotencyHints(data);

      expect(hints).toEqual({});
    });

    it('should ignore invalid ttlSeconds', () => {
      const data = {
        idempotency: {
          ttlSeconds: -100, // Invalid: negative
        },
      };

      const hints = extractIdempotencyHints(data);

      expect(hints.ttlSeconds).toBeUndefined();
    });

    it('should ignore empty source', () => {
      const data = {
        idempotency: {
          source: '', // Invalid: empty string
        },
      };

      const hints = extractIdempotencyHints(data);

      expect(hints.source).toBeUndefined();
    });

    it('should handle malformed idempotency data gracefully', () => {
      const data = {
        idempotency: 'not-an-object',
      };

      const hints = extractIdempotencyHints(data);

      expect(hints).toEqual({});
    });
  });

  describe('mergeIdempotencyConfig', () => {
    it('should prioritize message hints over subscription config', () => {
      const messageHints = { ttlSeconds: 60 };
      const subscriptionConfig: SubscriptionIdempotencyConfig = { ttlSeconds: 120 };

      const merged = mergeIdempotencyConfig(messageHints, subscriptionConfig);

      expect(merged.ttlSeconds).toBe(60);
    });

    it('should use subscription config when message hints are missing', () => {
      const messageHints = {};
      const subscriptionConfig: SubscriptionIdempotencyConfig = { ttlSeconds: 120 };

      const merged = mergeIdempotencyConfig(messageHints, subscriptionConfig);

      expect(merged.ttlSeconds).toBe(120);
    });

    it('should use bit default TTL when both message and subscription are missing', () => {
      const messageHints = {};
      const subscriptionConfig: SubscriptionIdempotencyConfig = {};
      const bitDefaultTtl = 180;

      const merged = mergeIdempotencyConfig(messageHints, subscriptionConfig, bitDefaultTtl);

      expect(merged.ttlSeconds).toBe(180);
    });

    it('should use global default (300s) when all configs are missing', () => {
      const messageHints = {};

      const merged = mergeIdempotencyConfig(messageHints);

      expect(merged.ttlSeconds).toBe(300);
    });

    it('should preserve custom key function from subscription config', () => {
      const customKeyFn = jest.fn();
      const messageHints = {};
      const subscriptionConfig: SubscriptionIdempotencyConfig = { customKeyFn };

      const merged = mergeIdempotencyConfig(messageHints, subscriptionConfig);

      expect(merged.customKeyFn).toBe(customKeyFn);
    });

    it('should preserve source from message hints', () => {
      const messageHints = { source: 'custom-source' };

      const merged = mergeIdempotencyConfig(messageHints);

      expect(merged.source).toBe('custom-source');
    });
  });

  describe('integration scenarios', () => {
    it('should handle full idempotency flow for egress message', async () => {
      // Scenario: Egress message with short TTL (60s)
      const config: IdempotencyConfig = {
        topic: 'internal.egress.v1',
        correlationId: 'msg-001',
        source: 'ingress-egress',
        ttlSeconds: 60,
      };

      // First attempt: new message
      mockSet.mockResolvedValueOnce('OK');
      const result1 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result1.isDuplicate).toBe(false);
      expect(result1.key).toBe('bitbrat:idempotency:internal:egress:v1:msg-001:ingress-egress');

      // Second attempt: duplicate (within TTL window)
      mockSet.mockResolvedValueOnce(null);
      const result2 = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result2.isDuplicate).toBe(true);
      expect(result2.key).toBe(result1.key);
    });

    it('should handle routing message with long TTL (3600s)', async () => {
      const config: IdempotencyConfig = {
        topic: 'internal.routing.v1',
        correlationId: 'route-001',
        ttlSeconds: 3600, // 1 hour
      };

      mockSet.mockResolvedValueOnce('OK');
      const result = await checkIdempotency(
        mockRedisClient as RedisClientType,
        config,
        mockLogger
      );

      expect(result.isDuplicate).toBe(false);
      expect(mockSet).toHaveBeenCalledWith(
        expect.any(String),
        'processed',
        expect.objectContaining({ EX: 3600 })
      );
    });

    it('should gracefully handle Redis outage during high traffic', async () => {
      // Simulate Redis connection loss
      mockSet.mockRejectedValue(new Error('ECONNREFUSED'));

      const messages = [
        { topic: 'internal.egress.v1', correlationId: 'msg-001' },
        { topic: 'internal.egress.v1', correlationId: 'msg-002' },
        { topic: 'internal.egress.v1', correlationId: 'msg-003' },
      ];

      const results = await Promise.all(
        messages.map((config) =>
          checkIdempotency(mockRedisClient as RedisClientType, config, mockLogger)
        )
      );

      // All messages processed (fail-open)
      results.forEach((result) => {
        expect(result.isDuplicate).toBe(false);
        expect(result.checkSucceeded).toBe(false);
      });

      // Logged errors
      expect(mockLogger.error).toHaveBeenCalledTimes(3);
    });
  });
});
