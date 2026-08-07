/**
 * Unit Tests for RedisManager (Sprint 1)
 *
 * Tests Redis connection lifecycle, health checks, and error handling.
 * Uses mocked redis client to avoid external dependencies in tests.
 */

import { RedisManager } from './redis-manager';
import type { SetupContext } from './types';
import type { RedisClientType } from 'redis';

// Mock the redis module
const mockConnect = jest.fn();
const mockQuit = jest.fn();
const mockDisconnect = jest.fn();
const mockPing = jest.fn();
const mockOn = jest.fn();

const mockClient = {
  connect: mockConnect,
  quit: mockQuit,
  disconnect: mockDisconnect,
  ping: mockPing,
  on: mockOn,
  isReady: true,
  isOpen: true,
};

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

import { createClient } from 'redis';
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

// Mock logger to avoid console spam
jest.mock('../logging', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('RedisManager', () => {
  let manager: RedisManager;
  let mockContext: SetupContext;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockQuit.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockPing.mockResolvedValue('PONG');
    mockCreateClient.mockReturnValue(mockClient as any);
    mockClient.isOpen = true;

    // Reset memoized state
    RedisManager.resetForTesting();

    // Create manager
    manager = new RedisManager();

    // Mock setup context
    mockContext = {
      config: {
        port: 3000,
        logLevel: 'info',
        redisUrl: 'redis://localhost:6379',
        redisIdempotencyEnabled: true,
        redisIdempotencyDefaultTtlSeconds: 300,
        twitchScopes: [],
        twitchChannels: [],
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        child: jest.fn(),
      } as any,
      serviceName: 'test-service',
      env: { REDIS_URL: 'redis://localhost:6379' },
      app: {} as any,
    };
  });

  describe('setup', () => {
    it('should create a new Redis client and connect', async () => {
      const client = await manager.setup(mockContext);

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://localhost:6379',
          socket: expect.objectContaining({
            keepAlive: true,
            reconnectStrategy: expect.any(Function),
          }),
        })
      );
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockPing).toHaveBeenCalledTimes(1);
      expect(client).toBeDefined();
    });

    it('should reuse existing client on subsequent setup calls', async () => {
      const client1 = await manager.setup(mockContext);
      const client2 = await manager.setup(mockContext);

      expect(client1).toBe(client2);
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should throw error if REDIS_URL is missing and idempotency is enabled', async () => {
      mockContext.config.redisUrl = undefined;
      mockContext.env.REDIS_URL = undefined;

      await expect(manager.setup(mockContext)).rejects.toThrow(
        'REDIS_URL is required when redisIdempotencyEnabled is true'
      );
    });

    it('should return null if REDIS_URL is missing and idempotency is disabled', async () => {
      mockContext.config.redisUrl = undefined;
      mockContext.env.REDIS_URL = undefined;
      mockContext.config.redisIdempotencyEnabled = false;

      const client = await manager.setup(mockContext);

      expect(client).toBeNull();
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('should throw error if connection fails', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(manager.setup(mockContext)).rejects.toThrow('Connection refused');
    });

    it('should throw error if PING fails', async () => {
      mockPing.mockResolvedValueOnce('UNEXPECTED');

      await expect(manager.setup(mockContext)).rejects.toThrow(
        'Redis PING failed: expected PONG, got UNEXPECTED'
      );
    });

    it('should register event handlers for monitoring', async () => {
      await manager.setup(mockContext);

      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('reconnecting', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('end', expect.any(Function));
    });

    it('should use exponential backoff for reconnection', async () => {
      await manager.setup(mockContext);

      // Get the reconnectStrategy function
      const calls = mockCreateClient.mock.calls as any[];
      expect(calls.length).toBeGreaterThan(0);
      const reconnectStrategyCall = calls[0]?.[0]?.socket?.reconnectStrategy;
      expect(reconnectStrategyCall).toBeDefined();

      // Test exponential backoff
      expect(reconnectStrategyCall(0)).toBe(500); // 500ms
      expect(reconnectStrategyCall(1)).toBe(750); // 500 * 1.5^1
      expect(reconnectStrategyCall(2)).toBe(1125); // 500 * 1.5^2
      expect(reconnectStrategyCall(10)).toBe(3000); // Capped at 3000ms
    });

    it('should stop reconnecting after max retries', async () => {
      await manager.setup(mockContext);

      const calls = mockCreateClient.mock.calls as any[];
      expect(calls.length).toBeGreaterThan(0);
      const reconnectStrategyCall = calls[0]?.[0]?.socket?.reconnectStrategy;
      expect(reconnectStrategyCall).toBeDefined();

      const result = reconnectStrategyCall(51);

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Max reconnect retries exceeded');
    });
  });

  describe('shutdown', () => {
    it('should gracefully quit the Redis client', async () => {
      const client = await manager.setup(mockContext);
      mockClient.isOpen = true;

      await manager.shutdown(client as RedisClientType);

      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('should skip quit if client is already closed', async () => {
      const client = await manager.setup(mockContext);
      mockClient.isOpen = false;

      await manager.shutdown(client as RedisClientType);

      expect(mockQuit).not.toHaveBeenCalled();
    });

    it('should force disconnect if quit fails', async () => {
      const client = await manager.setup(mockContext);
      mockClient.isOpen = true;
      mockQuit.mockRejectedValueOnce(new Error('Quit failed'));

      await manager.shutdown(client as RedisClientType);

      expect(mockQuit).toHaveBeenCalledTimes(1);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      const client = await manager.setup(mockContext);
      mockClient.isOpen = true;

      // First shutdown
      await manager.shutdown(client as RedisClientType);
      expect(mockQuit).toHaveBeenCalledTimes(1);

      // Second shutdown - should be no-op since client is already shutdown
      // Note: In real usage, caller should check RedisManager.getInstance() first
      // But this tests defensive programming in shutdown()
      mockClient.isOpen = false; // Simulate that client is now closed
      await manager.shutdown(client as RedisClientType);

      // Quit should still only be called once (from first shutdown)
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('should clear memoized client after shutdown', async () => {
      const client = await manager.setup(mockContext);
      expect(RedisManager.getInstance()).toBe(client);
      mockClient.isOpen = true;

      await manager.shutdown(client as RedisClientType);

      expect(RedisManager.getInstance()).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should return true if PING succeeds', async () => {
      const client = await manager.setup(mockContext);
      mockPing.mockResolvedValueOnce('PONG');

      const healthy = await manager.healthCheck(client as RedisClientType);

      expect(healthy).toBe(true);
      expect(mockPing).toHaveBeenCalled();
    });

    it('should return false if PING fails', async () => {
      const client = await manager.setup(mockContext);
      mockPing.mockRejectedValueOnce(new Error('Connection lost'));

      const healthy = await manager.healthCheck(client as RedisClientType);

      expect(healthy).toBe(false);
    });

    it('should return false if PING times out', async () => {
      const client = await manager.setup(mockContext);
      // Mock slow PING that never resolves
      mockPing.mockImplementationOnce(() => new Promise(() => {}));

      const healthy = await manager.healthCheck(client as RedisClientType, 100);

      expect(healthy).toBe(false);
    });

    it('should return false if client is null', async () => {
      const healthy = await manager.healthCheck(null as any);

      expect(healthy).toBe(false);
    });
  });

  describe('getInstance', () => {
    it('should return null before setup', () => {
      expect(RedisManager.getInstance()).toBeNull();
    });

    it('should return the memoized client after setup', async () => {
      const client = await manager.setup(mockContext);

      expect(RedisManager.getInstance()).toBe(client);
    });

    it('should return null after shutdown', async () => {
      const client = await manager.setup(mockContext);
      await manager.shutdown(client as any);

      expect(RedisManager.getInstance()).toBeNull();
    });
  });

  describe('resetForTesting', () => {
    it('should clear memoized state', async () => {
      await manager.setup(mockContext);
      expect(RedisManager.getInstance()).not.toBeNull();

      RedisManager.resetForTesting();

      expect(RedisManager.getInstance()).toBeNull();
    });
  });

  describe('fail-open strategy', () => {
    it('should allow service to start without Redis when idempotency is disabled', async () => {
      mockContext.config.redisUrl = undefined;
      mockContext.env.REDIS_URL = undefined;
      mockContext.config.redisIdempotencyEnabled = false;

      const client = await manager.setup(mockContext);

      expect(client).toBeNull();
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'redis.manager.setup.no_url',
        expect.objectContaining({
          message: 'REDIS_URL not configured - idempotency will be disabled',
        })
      );
    });

    it('should throw error when idempotency is enabled but Redis is unavailable', async () => {
      mockContext.config.redisIdempotencyEnabled = true;
      mockContext.config.redisUrl = undefined;
      mockContext.env.REDIS_URL = undefined;

      await expect(manager.setup(mockContext)).rejects.toThrow(
        'REDIS_URL is required when redisIdempotencyEnabled is true'
      );
    });
  });
});
