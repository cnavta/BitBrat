/**
 * CounterManager Unit Tests
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Tests all counter operations with mocked dependencies
 */

import { CounterManager } from './counter-manager';
import { ScopeResolver } from './scope-resolver';
import type { IDocumentStore } from '../../common/persistence/interfaces';
import type { RedisClientType } from 'redis';
import type { InternalEventV2 } from '../../types';
import type { CounterDefinition, CounterSnapshot } from './types';

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

// Mock DocumentStore
const createMockDocStore = (): jest.Mocked<IDocumentStore> => ({
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  query: jest.fn(),
  getAll: jest.fn(),
  watch: jest.fn(),
  batch: jest.fn(),
  health: jest.fn(),
});

// Mock Redis client
const createMockRedis = (): jest.Mocked<RedisClientType> => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  incrBy: jest.fn(),
  decrBy: jest.fn(),
  ping: jest.fn(),
  isReady: true,
} as any);

describe('CounterManager', () => {
  let manager: CounterManager;
  let mockDocStore: jest.Mocked<IDocumentStore>;
  let mockRedis: jest.Mocked<RedisClientType>;
  let scopeResolver: ScopeResolver;

  beforeEach(() => {
    mockDocStore = createMockDocStore();
    mockRedis = createMockRedis();
    scopeResolver = new ScopeResolver(mockLogger);
    manager = new CounterManager(mockDocStore, mockRedis, scopeResolver, mockLogger);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create counter with explicit scope', async () => {
      mockDocStore.get.mockResolvedValue(null); // No existing counter
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.set.mockResolvedValue('OK' as any);

      const result = await manager.create({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
        initialValue: 0,
      });

      expect(result).toEqual({
        success: true,
        counterId: 'stream:bitbrat:deaths',
        key: 'counter:stream:bitbrat:deaths',
      });

      // Verify DocumentStore.set called with correct definition
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'counter_definitions',
        'stream:bitbrat:deaths',
        expect.objectContaining({
          id: 'stream:bitbrat:deaths',
          name: 'deaths',
          scopeType: 'stream',
          scopeValue: 'bitbrat',
          metadata: {},
          createdBy: 'system',
        })
      );

      // Verify Redis.set called with initial value
      expect(mockRedis.set).toHaveBeenCalledWith('counter:stream:bitbrat:deaths', '0');
    });

    it('should create counter with TTL', async () => {
      mockDocStore.get.mockResolvedValue(null);
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.expire.mockResolvedValue(true as any);

      const result = await manager.create({
        name: 'session_counter',
        scopeType: 'global',
        scopeValue: 'global',
        initialValue: 100,
        ttlSeconds: 3600,
      });

      expect(result.success).toBe(true);

      // Verify TTL set in DocumentStore definition
      const definition = mockDocStore.set.mock.calls[0][2] as CounterDefinition;
      expect(definition.ttlSeconds).toBe(3600);
      expect(definition.expiresAt).toBeDefined();

      // Verify Redis EXPIRE called
      expect(mockRedis.expire).toHaveBeenCalledWith('counter:global:global:session_counter', 3600);
    });

    it('should create counter with metadata', async () => {
      mockDocStore.get.mockResolvedValue(null);
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.set.mockResolvedValue('OK' as any);

      await manager.create({
        name: 'points',
        scopeType: 'user',
        scopeValue: 'user123',
        metadata: {
          description: 'User loyalty points',
          category: 'rewards',
          icon: '⭐',
        },
      });

      const definition = mockDocStore.set.mock.calls[0][2] as CounterDefinition;
      expect(definition.metadata).toEqual({
        description: 'User loyalty points',
        category: 'rewards',
        icon: '⭐',
      });
    });

    it('should auto-infer scope from event', async () => {
      mockDocStore.get.mockResolvedValue(null);
      mockDocStore.set.mockResolvedValue(undefined);
      mockRedis.set.mockResolvedValue('OK' as any);

      const event = {
        ingress: { channel: 'test-channel' },
      } as InternalEventV2;

      const result = await manager.create({
        name: 'messages',
        event,
      });

      expect(result.counterId).toBe('stream:test-channel:messages');
      expect(result.key).toBe('counter:stream:test-channel:messages');
    });

    it('should throw error if counter already exists', async () => {
      mockDocStore.get.mockResolvedValue({
        id: 'stream:bitbrat:deaths',
      } as CounterDefinition);

      await expect(
        manager.create({
          name: 'deaths',
          scopeType: 'stream',
          scopeValue: 'bitbrat',
        })
      ).rejects.toThrow('Counter already exists: stream:bitbrat:deaths');

      expect(mockDocStore.set).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('increment', () => {
    it('should increment counter by 1 (default delta)', async () => {
      mockRedis.incrBy.mockResolvedValue(43 as any);

      const result = await manager.increment({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(result).toEqual({
        success: true,
        newValue: 43,
        key: 'counter:stream:bitbrat:deaths',
      });

      expect(mockRedis.incrBy).toHaveBeenCalledWith('counter:stream:bitbrat:deaths', 1);
    });

    it('should increment counter by custom delta', async () => {
      mockRedis.incrBy.mockResolvedValue(150 as any);

      const result = await manager.increment({
        name: 'points',
        scopeType: 'user',
        scopeValue: 'user123',
        delta: 50,
      });

      expect(result.newValue).toBe(150);
      expect(mockRedis.incrBy).toHaveBeenCalledWith('counter:user:user123:points', 50);
    });

    it('should increment using direct key', async () => {
      mockRedis.incrBy.mockResolvedValue(10 as any);

      const result = await manager.increment({
        key: 'counter:global:global:test',
        delta: 5,
      });

      expect(result.newValue).toBe(10);
      expect(mockRedis.incrBy).toHaveBeenCalledWith('counter:global:global:test', 5);
    });
  });

  describe('decrement', () => {
    it('should decrement counter by 1 (default delta)', async () => {
      mockRedis.decrBy.mockResolvedValue(41 as any);

      const result = await manager.decrement({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(result).toEqual({
        success: true,
        newValue: 41,
        key: 'counter:stream:bitbrat:deaths',
      });

      expect(mockRedis.decrBy).toHaveBeenCalledWith('counter:stream:bitbrat:deaths', 1);
    });

    it('should decrement counter by custom delta', async () => {
      mockRedis.decrBy.mockResolvedValue(50 as any);

      const result = await manager.decrement({
        name: 'lives',
        scopeType: 'user',
        scopeValue: 'user456',
        delta: 3,
      });

      expect(result.newValue).toBe(50);
      expect(mockRedis.decrBy).toHaveBeenCalledWith('counter:user:user456:lives', 3);
    });
  });

  describe('get', () => {
    it('should get counter value and metadata', async () => {
      mockRedis.get.mockResolvedValue('42');
      mockDocStore.get.mockResolvedValue({
        metadata: { description: 'Death counter', icon: '💀' },
      } as CounterDefinition);

      const result = await manager.get({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(result).toEqual({
        success: true,
        value: 42,
        key: 'counter:stream:bitbrat:deaths',
        metadata: { description: 'Death counter', icon: '💀' },
      });

      expect(mockRedis.get).toHaveBeenCalledWith('counter:stream:bitbrat:deaths');
      expect(mockDocStore.get).toHaveBeenCalledWith(
        'counter_definitions',
        'stream:bitbrat:deaths'
      );
    });

    it('should return 0 if counter does not exist in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDocStore.get.mockResolvedValue(null);

      const result = await manager.get({
        name: 'nonexistent',
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(result.value).toBe(0);
    });

    it('should get counter using direct key (no metadata lookup)', async () => {
      mockRedis.get.mockResolvedValue('99');

      const result = await manager.get({
        key: 'counter:stream:bitbrat:test',
      });

      expect(result.value).toBe(99);
      expect(result.metadata).toBeUndefined();
      expect(mockDocStore.get).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('should set counter to specific value', async () => {
      mockRedis.set.mockResolvedValue('OK' as any);

      const result = await manager.set({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
        value: 100,
      });

      expect(result).toEqual({
        success: true,
        value: 100,
        key: 'counter:stream:bitbrat:deaths',
      });

      expect(mockRedis.set).toHaveBeenCalledWith('counter:stream:bitbrat:deaths', '100');
    });
  });

  describe('delete', () => {
    it('should delete counter from both stores', async () => {
      mockRedis.del.mockResolvedValue(1 as any);
      mockDocStore.delete.mockResolvedValue(undefined);

      const result = await manager.delete({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(result).toEqual({
        success: true,
        key: 'counter:stream:bitbrat:deaths',
      });

      expect(mockRedis.del).toHaveBeenCalledWith('counter:stream:bitbrat:deaths');
      expect(mockDocStore.delete).toHaveBeenCalledWith(
        'counter_definitions',
        'stream:bitbrat:deaths'
      );
    });
  });

  describe('list', () => {
    it('should list all counters without filters (but exclude expired)', async () => {
      const mockCounters = [
        { id: 'stream:bitbrat:deaths', name: 'deaths' },
        { id: 'stream:bitbrat:wins', name: 'wins' },
      ] as CounterDefinition[];

      mockDocStore.query.mockResolvedValue(mockCounters);

      const result = await manager.list({});

      expect(result).toEqual(mockCounters);
      // Should filter out expired counters by default
      const call = mockDocStore.query.mock.calls[0][1];
      expect(call.filters).toHaveLength(1);
      expect(call.filters![0]).toMatchObject({
        field: 'expiresAt',
        operator: '>',
      });
    });

    it('should filter by scope type', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({ scopeType: 'stream' });

      const call = mockDocStore.query.mock.calls[0][1];
      expect(call.filters).toHaveLength(2);
      expect(call.filters).toContainEqual({ field: 'scopeType', operator: '==', value: 'stream' });
      expect(call.filters).toContainEqual(
        expect.objectContaining({ field: 'expiresAt', operator: '>' })
      );
    });

    it('should filter by scope type and value', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      const call = mockDocStore.query.mock.calls[0][1];
      expect(call.filters).toHaveLength(3);
      expect(call.filters).toContainEqual({ field: 'scopeType', operator: '==', value: 'stream' });
      expect(call.filters).toContainEqual({ field: 'scopeValue', operator: '==', value: 'bitbrat' });
      expect(call.filters).toContainEqual(
        expect.objectContaining({ field: 'expiresAt', operator: '>' })
      );
    });

    it('should exclude expired counters by default', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({});

      const filters = mockDocStore.query.mock.calls[0][1].filters;
      expect(filters).toContainEqual(
        expect.objectContaining({
          field: 'expiresAt',
          operator: '>',
        })
      );
    });

    it('should include expired counters when requested', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await manager.list({ includeExpired: true });

      expect(mockDocStore.query).toHaveBeenCalledWith('counter_definitions', {
        filters: undefined,
      });
    });
  });

  describe('snapshot', () => {
    it('should create snapshot of counter value', async () => {
      mockRedis.get.mockResolvedValue('42');
      mockDocStore.set.mockResolvedValue(undefined);

      const result = await manager.snapshot({
        name: 'deaths',
        scopeType: 'stream',
        scopeValue: 'bitbrat',
        trigger: 'manual',
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
      expect(result.snapshotId).toBeDefined();
      expect(result.snapshotAt).toBeDefined();

      // Verify snapshot stored in DocumentStore
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'counter_snapshots',
        expect.any(String),
        expect.objectContaining({
          counterId: 'stream:bitbrat:deaths',
          value: 42,
          trigger: 'manual',
        })
      );
    });

    it('should default trigger to manual', async () => {
      mockRedis.get.mockResolvedValue('100');
      mockDocStore.set.mockResolvedValue(undefined);

      await manager.snapshot({
        name: 'test',
        scopeType: 'global',
        scopeValue: 'global',
      });

      const snapshot = mockDocStore.set.mock.calls[0][2] as CounterSnapshot;
      expect(snapshot.trigger).toBe('manual');
    });
  });

  describe('error handling', () => {
    it('should throw error when resolveKey fails', async () => {
      await expect(
        manager.increment({
          // No key or name provided
        } as any)
      ).rejects.toThrow('Either key or name must be provided');
    });

    it('should log errors on create failure', async () => {
      mockDocStore.get.mockRejectedValue(new Error('Database error'));

      await expect(
        manager.create({
          name: 'test',
          scopeType: 'global',
          scopeValue: 'global',
        })
      ).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
