import type { ResourceManager, SetupContext } from './types';
import { createClient, type RedisClientType } from 'redis';
import { logger as globalLogger } from '../logging';

/**
 * Redis Resource Manager (Sprint 1: Distributed Idempotency Layer)
 *
 * Manages Redis client lifecycle with connection pooling, health checks, and graceful shutdown.
 * Implements singleton pattern to ensure single Redis connection across all manager instances.
 *
 * Configuration:
 * - REDIS_URL: Connection URL (format: redis://host:port or redis://user:pass@host:port)
 * - REDIS_IDEMPOTENCY_ENABLED: Enable Redis-backed idempotency (default: false, opt-in)
 * - REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: Default TTL for idempotency keys (default: 300)
 *
 * Features:
 * - Connection pooling (built-in with redis client v4+)
 * - Auto-reconnect with exponential backoff
 * - Graceful shutdown with connection drain
 * - Error handling with fail-open strategy (logs errors but doesn't crash)
 *
 * @since Sprint 1
 */

// Module-level memoized instance to guarantee a single Redis client across all manager instances
let memoizedClient: RedisClientType | null = null;
let isConnecting = false;
let isShuttingDown = false;

export class RedisManager implements ResourceManager<RedisClientType> {
  /**
   * Initialize Redis client and establish connection.
   *
   * Uses singleton pattern to ensure only one Redis connection per process.
   * Safe to call multiple times - returns existing connection if available.
   *
   * Connection options:
   * - Socket keepAlive enabled for long-lived connections
   * - Auto-reconnect with exponential backoff (max 3000ms)
   * - Lazy connect = false (connect immediately during setup)
   *
   * @param ctx Setup context with config and logger
   * @returns Connected Redis client instance
   * @throws Error if REDIS_URL is not configured (when idempotency is enabled)
   */
  async setup(ctx: SetupContext): Promise<RedisClientType> {
    const log = ctx?.logger || globalLogger;

    // Return existing connection if already established
    if (memoizedClient) {
      log.info('redis.manager.setup.reuse', { isReady: memoizedClient.isReady });
      return memoizedClient;
    }

    // Prevent concurrent setup calls
    if (isConnecting) {
      log.warn('redis.manager.setup.already_connecting');
      // Wait for connection to complete (poll every 100ms, max 10s)
      const startTime = Date.now();
      while (isConnecting && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (memoizedClient) {
        return memoizedClient;
      }
      throw new Error('Redis connection timeout: concurrent setup took too long');
    }

    isConnecting = true;

    try {
      log.info('redis.manager.setup.start');

      // Validate configuration
      const redisUrl = ctx.config.redisUrl || ctx.env.REDIS_URL;
      if (!redisUrl) {
        // If idempotency is enabled, Redis URL is required
        if (ctx.config.redisIdempotencyEnabled) {
          throw new Error('REDIS_URL is required when redisIdempotencyEnabled is true');
        }
        // Otherwise, log warning and return a stub client (fail-open strategy)
        log.warn('redis.manager.setup.no_url', {
          message: 'REDIS_URL not configured - idempotency will be disabled',
        });
        // Return a stub client that throws on any operation
        // This allows services to start even without Redis
        return null as any; // Type assertion - caller should check redisIdempotencyEnabled
      }

      // Create Redis client with connection options
      const client = createClient({
        url: redisUrl,
        socket: {
          keepAlive: true, // Enable TCP keepalive
          reconnectStrategy: (retries) => {
            if (isShuttingDown) {
              log.info('redis.manager.reconnect.skipped_shutdown');
              return false; // Don't reconnect during shutdown
            }
            if (retries > 50) {
              log.error('redis.manager.reconnect.max_retries', { retries });
              return new Error('Max reconnect retries exceeded');
            }
            // Exponential backoff: min 500ms, max 3000ms
            const delay = Math.min(500 * Math.pow(1.5, retries), 3000);
            log.warn('redis.manager.reconnect.attempt', { retries, delayMs: delay });
            return delay;
          },
        },
      });

      // Event handlers for monitoring
      client.on('error', (err) => {
        log.error('redis.client.error', { error: err.message, stack: err.stack });
      });

      client.on('connect', () => {
        log.info('redis.client.connect', { url: redisUrl });
      });

      client.on('ready', () => {
        log.info('redis.client.ready', { url: redisUrl });
      });

      client.on('reconnecting', () => {
        log.warn('redis.client.reconnecting');
      });

      client.on('end', () => {
        log.info('redis.client.end');
      });

      // Connect to Redis (this can throw if connection fails)
      await client.connect();

      // Verify connection with PING
      const pong = await client.ping();
      if (pong !== 'PONG') {
        throw new Error(`Redis PING failed: expected PONG, got ${pong}`);
      }

      log.info('redis.manager.setup.success', {
        url: redisUrl,
        isReady: client.isReady,
      });

      memoizedClient = client;
      return client;
    } catch (err: any) {
      log.error('redis.manager.setup.error', {
        error: err.message,
        stack: err.stack,
      });
      // Fail-open strategy: log error but allow service to start
      // Idempotency middleware will check for null client and skip dedupe
      throw err; // Re-throw to let caller decide whether to fail or continue
    } finally {
      isConnecting = false;
    }
  }

  /**
   * Gracefully shutdown Redis connection.
   *
   * Drains pending operations and closes the connection.
   * Safe to call multiple times (no-op if already shutdown).
   *
   * @param instance Redis client instance to shutdown
   */
  async shutdown(instance: RedisClientType): Promise<void> {
    const log = globalLogger;

    if (!instance || isShuttingDown) {
      log.debug('redis.manager.shutdown.skip', {
        hasInstance: !!instance,
        isShuttingDown,
      });
      return;
    }

    isShuttingDown = true;

    try {
      log.info('redis.manager.shutdown.start');

      // Check if client is still connected
      if (instance.isOpen) {
        // Quit gracefully (waits for pending operations to complete)
        await instance.quit();
        log.info('redis.manager.shutdown.quit');
      } else {
        log.warn('redis.manager.shutdown.already_closed');
      }

      // Clear memoized client
      memoizedClient = null;

      log.info('redis.manager.shutdown.success');
    } catch (err: any) {
      log.error('redis.manager.shutdown.error', {
        error: err.message,
        stack: err.stack,
      });
      // Force disconnect if graceful quit fails
      try {
        await instance.disconnect();
        log.warn('redis.manager.shutdown.force_disconnect');
      } catch (disconnectErr: any) {
        log.error('redis.manager.shutdown.force_disconnect.error', {
          error: disconnectErr.message,
        });
      }
    } finally {
      isShuttingDown = false;
    }
  }

  /**
   * Health check: verify Redis connection is alive and responsive.
   *
   * Executes a PING command with timeout to verify connectivity.
   * Used by Bit health checks and operational monitoring.
   *
   * @param instance Redis client instance to check
   * @param timeoutMs Maximum time to wait for PING response (default: 1000ms)
   * @returns true if healthy (PING succeeded), false otherwise
   */
  async healthCheck(instance: RedisClientType, timeoutMs = 1000): Promise<boolean> {
    if (!instance) {
      return false;
    }

    try {
      // Race PING against timeout
      const pong = await Promise.race([
        instance.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
        ),
      ]);

      return pong === 'PONG';
    } catch (err: any) {
      globalLogger.warn('redis.manager.health_check.failed', {
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Get current Redis client instance (if exists).
   *
   * Useful for testing and debugging.
   * Returns null if Redis is not initialized.
   *
   * @returns Current Redis client or null
   */
  static getInstance(): RedisClientType | null {
    return memoizedClient;
  }

  /**
   * Reset memoized instance (for testing only).
   *
   * WARNING: Only use in tests. Do not call in production code.
   * Does not close existing connections - use shutdown() instead.
   */
  static resetForTesting(): void {
    memoizedClient = null;
    isConnecting = false;
    isShuttingDown = false;
  }
}
