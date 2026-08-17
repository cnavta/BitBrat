/**
 * Idempotency Middleware (Sprint 1: Distributed Idempotency Layer)
 *
 * Provides distributed message deduplication using Redis SET NX EX pattern.
 * Prevents duplicate processing during platform restarts, deploys, or crashes.
 *
 * Features:
 * - Automatic idempotency key generation from message attributes
 * - Configurable TTL per subscription or global default
 * - Custom key derivation function support
 * - Fail-open strategy (processes messages if Redis unavailable)
 * - Structured logging for observability
 *
 * Usage:
 * ```typescript
 * // In base-server.ts onMessage()
 * const isDuplicate = await checkIdempotency(redis, {
 *   topic: 'internal.egress.v1',
 *   correlationId: event.correlationId,
 *   source: event.source,
 *   ttlSeconds: 60
 * });
 *
 * if (isDuplicate) {
 *   logger.info('idempotency.duplicate', { correlationId });
 *   await ctx.ack(); // Acknowledge duplicate to prevent redelivery
 *   return;
 * }
 *
 * // Process message...
 * ```
 *
 * @since Sprint 1
 */

import type { RedisClientType } from 'redis';
import type { Logger } from './logging';

/**
 * Configuration for idempotency check
 */
export interface IdempotencyConfig {
  /** Topic/subject name for key namespacing */
  topic: string;
  /** Correlation ID from message envelope */
  correlationId: string;
  /** Optional source identifier for multi-producer scenarios */
  source?: string;
  /** TTL for idempotency key (seconds, default: 300 = 5 minutes) */
  ttlSeconds?: number;
  /** Custom key derivation function (overrides default key generation) */
  customKeyFn?: (config: IdempotencyConfig) => string;
}

/**
 * Result of idempotency check
 */
export interface IdempotencyResult {
  /** True if message is a duplicate (key already exists in Redis) */
  isDuplicate: boolean;
  /** The Redis key used for deduplication */
  key: string;
  /** True if check succeeded (false if Redis unavailable - fail-open) */
  checkSucceeded: boolean;
}

/**
 * Default idempotency key generation
 *
 * Key format: `bitbrat:idempotency:{topic}:{correlationId}:{source?}`
 *
 * Examples:
 * - `bitbrat:idempotency:internal.egress.v1:abc123:ingress-egress`
 * - `bitbrat:idempotency:internal.analysis.v1:def456`
 *
 * @param config Idempotency configuration
 * @returns Redis key string
 */
export function generateIdempotencyKey(config: IdempotencyConfig): string {
  const { topic, correlationId, source } = config;

  // Normalize topic (remove bus prefix if present, replace dots with colons)
  const normalizedTopic = topic.replace(/^(local\.|dev\.|staging\.|prod\.)/, '').replace(/\./g, ':');

  // Build key segments
  const segments = ['bitbrat', 'idempotency', normalizedTopic, correlationId];
  if (source) {
    segments.push(source);
  }

  return segments.join(':');
}

/**
 * Check if message is a duplicate using Redis SET NX EX pattern
 *
 * Algorithm:
 * 1. Generate idempotency key from message attributes
 * 2. Attempt to SET key with NX (only if not exists) and EX (TTL)
 * 3. If SET succeeds (returns 'OK'), message is new
 * 4. If SET fails (returns null), message is duplicate
 * 5. If Redis operation fails, fail-open (return isDuplicate=false)
 *
 * Fail-open Strategy:
 * - If Redis is unavailable, logs warning and returns isDuplicate=false
 * - This allows services to continue processing messages without Redis
 * - Trade-off: May process duplicates during Redis outage
 * - Rationale: Availability > strict deduplication (at-least-once delivery)
 *
 * @param redis Redis client instance (can be null for fail-open)
 * @param config Idempotency configuration
 * @param logger Logger instance for observability
 * @returns IdempotencyResult with duplicate status and metadata
 */
export async function checkIdempotency(
  redis: RedisClientType | null,
  config: IdempotencyConfig,
  logger: Logger
): Promise<IdempotencyResult> {
  const ttlSeconds = config.ttlSeconds ?? 300; // Default: 5 minutes

  // Generate key (use custom function if provided)
  const key = config.customKeyFn ? config.customKeyFn(config) : generateIdempotencyKey(config);

  // Fail-open: If Redis is null, allow processing
  if (!redis) {
    logger.warn('idempotency.redis_unavailable', {
      key,
      topic: config.topic,
      correlationId: config.correlationId,
      message: 'Redis client is null - processing message without idempotency check (fail-open)',
    });
    return {
      isDuplicate: false,
      key,
      checkSucceeded: false,
    };
  }

  // Fail-open: If Redis is not connected, allow processing
  if (!redis.isReady) {
    logger.warn('idempotency.redis_not_ready', {
      key,
      topic: config.topic,
      correlationId: config.correlationId,
      message: 'Redis client is not ready - processing message without idempotency check (fail-open)',
    });
    return {
      isDuplicate: false,
      key,
      checkSucceeded: false,
    };
  }

  try {
    // SET NX EX: Atomic check-and-set
    // Returns 'OK' if key was set (new message)
    // Returns null if key already exists (duplicate)
    const result = await redis.set(key, 'processed', {
      NX: true, // Only set if key does not exist
      EX: ttlSeconds, // Expire after TTL seconds
    });

    const isDuplicate = result === null;

    if (isDuplicate) {
      logger.info('idempotency.duplicate', {
        key,
        topic: config.topic,
        correlationId: config.correlationId,
        source: config.source,
        ttlSeconds,
      });
    } else {
      logger.debug('idempotency.new', {
        key,
        topic: config.topic,
        correlationId: config.correlationId,
        source: config.source,
        ttlSeconds,
      });
    }

    return {
      isDuplicate,
      key,
      checkSucceeded: true,
    };
  } catch (err: any) {
    // Fail-open: Log error but allow processing
    logger.error('idempotency.check_error', {
      key,
      topic: config.topic,
      correlationId: config.correlationId,
      error: err.message,
      stack: err.stack,
      message: 'Redis SET NX EX failed - processing message without idempotency check (fail-open)',
    });

    return {
      isDuplicate: false,
      key,
      checkSucceeded: false,
    };
  }
}

/**
 * Subscription-level idempotency configuration
 *
 * Allows fine-grained control over idempotency behavior per subscription.
 * Hierarchy: Per-subscription > Per-Bit > Global default
 */
export interface SubscriptionIdempotencyConfig {
  /** Enable idempotency for this subscription (default: inherit from Bit config) */
  enabled?: boolean;
  /** TTL for idempotency keys (seconds, default: inherit from Bit config or 300) */
  ttlSeconds?: number;
  /** Custom key derivation function (default: generateIdempotencyKey) */
  customKeyFn?: (config: IdempotencyConfig) => string;
}

/**
 * Helper: Extract idempotency configuration from message data
 *
 * Supports explicit idempotency hints in message payload:
 * ```json
 * {
 *   "idempotency": {
 *     "enabled": true,
 *     "ttlSeconds": 60,
 *     "source": "custom-source"
 *   }
 * }
 * ```
 *
 * @param data Parsed message data
 * @returns Partial IdempotencyConfig from message hints (if any)
 */
export function extractIdempotencyHints(data: any): Partial<IdempotencyConfig> {
  const hints: Partial<IdempotencyConfig> = {};

  try {
    if (data?.idempotency && typeof data.idempotency === 'object') {
      const idempotencyData = data.idempotency;

      if (typeof idempotencyData.ttlSeconds === 'number' && idempotencyData.ttlSeconds > 0) {
        hints.ttlSeconds = idempotencyData.ttlSeconds;
      }

      if (typeof idempotencyData.source === 'string' && idempotencyData.source.length > 0) {
        hints.source = idempotencyData.source;
      }
    }
  } catch (err: any) {
    // Silently ignore malformed hints - use defaults
  }

  return hints;
}

/**
 * Merge idempotency configurations with priority hierarchy
 *
 * Priority (highest to lowest):
 * 1. Message-level hints (explicit idempotency payload)
 * 2. Subscription-level config (per-subscription override)
 * 3. Bit-level config (per-service default)
 * 4. Global default (300 seconds)
 *
 * @param messageHints Hints extracted from message payload
 * @param subscriptionConfig Subscription-level configuration
 * @param bitDefaultTtl Bit-level default TTL
 * @returns Merged IdempotencyConfig with effective TTL
 */
export function mergeIdempotencyConfig(
  messageHints: Partial<IdempotencyConfig>,
  subscriptionConfig?: SubscriptionIdempotencyConfig,
  bitDefaultTtl?: number
): Partial<IdempotencyConfig> {
  return {
    ttlSeconds: messageHints.ttlSeconds ?? subscriptionConfig?.ttlSeconds ?? bitDefaultTtl ?? 300,
    source: messageHints.source,
    customKeyFn: subscriptionConfig?.customKeyFn,
  };
}
