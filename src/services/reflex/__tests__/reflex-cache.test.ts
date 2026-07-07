/**
 * Unit tests for reflex-cache.ts
 *
 * Tests in-memory caching, real-time synchronization, and cache statistics.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ReflexCache } from '../reflex-cache.js';
import type { Reflex } from '../../../types/reflex.js';
import type { ReflexRepository, ReflexSubscriptionCallback } from '../reflex-repository.js';

// Mock reflex-metrics module
jest.mock('../reflex-metrics.js', () => ({
  metrics: {
    setCacheSize: jest.fn(),
    recordMatchLatency: jest.fn(),
    recordExecuteLatency: jest.fn(),
    incrementMatchCount: jest.fn(),
    incrementExecuteCount: jest.fn(),
  },
}));

describe('ReflexCache', () => {
  let mockRepository: jest.Mocked<ReflexRepository>;
  let cache: ReflexCache;

  const mockReflexes: Reflex[] = [
    {
      id: 'reflex-1',
      name: 'High Priority Reflex',
      active: true,
      priority: 1,
      match: { type: 'exact', pattern: '!test1', field: 'message.text' },
      action: { tool: 'tool1', parameters: {} },
      createdAt: '2026-07-04T12:00:00Z',
      updatedAt: '2026-07-04T12:00:00Z',
    },
    {
      id: 'reflex-2',
      name: 'Medium Priority Reflex',
      active: true,
      priority: 5,
      match: { type: 'exact', pattern: '!test2', field: 'message.text' },
      action: { tool: 'tool2', parameters: {} },
      createdAt: '2026-07-04T12:00:00Z',
      updatedAt: '2026-07-04T12:00:00Z',
    },
    {
      id: 'reflex-3',
      name: 'Low Priority Reflex',
      active: true,
      priority: 10,
      match: { type: 'exact', pattern: '!test3', field: 'message.text' },
      action: { tool: 'tool3', parameters: {} },
      createdAt: '2026-07-04T12:00:00Z',
      updatedAt: '2026-07-04T12:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock repository
    mockRepository = {
      getAll: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      subscribe: jest.fn(),
    } as any;

    cache = new ReflexCache(mockRepository);
  });

  describe('initialize', () => {
    it('should load initial reflexes and set up subscription', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();

      expect(mockRepository.getAll).toHaveBeenCalled();
      expect(mockRepository.subscribe).toHaveBeenCalled();
      expect(cache.size).toBe(3);
      expect(cache.isInitialized()).toBe(true);
    });

    it('should populate cache with initial reflexes', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();

      const allReflexes = cache.getAll();
      expect(allReflexes).toHaveLength(3);
      expect(allReflexes.map(r => r.id)).toEqual(['reflex-1', 'reflex-2', 'reflex-3']);
    });

    it('should update cache size metric on initialization', async () => {
      const { metrics } = require('../reflex-metrics.js');
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();

      expect(metrics.setCacheSize).toHaveBeenCalledWith(3);
    });

    it('should throw error if repository.getAll fails', async () => {
      mockRepository.getAll.mockRejectedValue(new Error('Firestore error'));

      await expect(cache.initialize()).rejects.toThrow('Cache initialization failed: Firestore error');
    });

    it('should set up subscription callback', async () => {
      mockRepository.getAll.mockResolvedValue([]);
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();

      expect(subscriptionCallback).toBeDefined();
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
    });

    it('should return all reflexes from cache', () => {
      const result = cache.getAll();

      expect(result).toHaveLength(3);
      expect(result.map(r => r.id)).toEqual(['reflex-1', 'reflex-2', 'reflex-3']);
    });

    it('should sort reflexes by priority (ascending)', () => {
      const result = cache.getAll();

      expect(result[0].priority).toBe(1);
      expect(result[1].priority).toBe(5);
      expect(result[2].priority).toBe(10);
    });

    it('should not query repository', () => {
      mockRepository.getAll.mockClear();

      cache.getAll();

      expect(mockRepository.getAll).not.toHaveBeenCalled();
    });

    it('should return empty array when cache is empty', async () => {
      const emptyCache = new ReflexCache(mockRepository);
      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await emptyCache.initialize();

      const result = emptyCache.getAll();

      expect(result).toEqual([]);
    });

    it('should sort unsorted reflexes correctly', () => {
      const unsortedReflexes = [mockReflexes[2], mockReflexes[0], mockReflexes[1]];
      cache.refresh(unsortedReflexes);

      const result = cache.getAll();

      expect(result[0].id).toBe('reflex-1'); // priority 1
      expect(result[1].id).toBe('reflex-2'); // priority 5
      expect(result[2].id).toBe('reflex-3'); // priority 10
    });
  });

  describe('getById', () => {
    beforeEach(async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
      cache.resetStats(); // Reset stats to start clean
    });

    it('should return reflex when found in cache', () => {
      const result = cache.getById('reflex-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('reflex-1');
      expect(result!.name).toBe('High Priority Reflex');
    });

    it('should return undefined when not found in cache', () => {
      const result = cache.getById('missing-id');

      expect(result).toBeUndefined();
    });

    it('should increment hits when reflex found', () => {
      cache.getById('reflex-1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should increment misses when reflex not found', () => {
      cache.getById('missing-id');

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should track multiple hits and misses', () => {
      cache.getById('reflex-1'); // hit
      cache.getById('reflex-2'); // hit
      cache.getById('missing-1'); // miss
      cache.getById('reflex-3'); // hit
      cache.getById('missing-2'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
    });
  });

  describe('refresh', () => {
    beforeEach(async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
    });

    it('should replace cache contents with new reflexes', () => {
      const newReflexes: Reflex[] = [
        {
          id: 'reflex-new',
          name: 'New Reflex',
          active: true,
          priority: 1,
          match: { type: 'exact', pattern: '!new', field: 'message.text' },
          action: { tool: 'new-tool', parameters: {} },
          createdAt: '2026-07-04T13:00:00Z',
          updatedAt: '2026-07-04T13:00:00Z',
        },
      ];

      cache.refresh(newReflexes);

      const result = cache.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('reflex-new');
    });

    it('should clear old reflexes that are no longer active', () => {
      const updatedReflexes = [mockReflexes[0]]; // Only first reflex
      cache.refresh(updatedReflexes);

      expect(cache.size).toBe(1);
      expect(cache.getById('reflex-1')).toBeDefined();
      expect(cache.getById('reflex-2')).toBeUndefined();
      expect(cache.getById('reflex-3')).toBeUndefined();
    });

    it('should update stats.size', () => {
      cache.refresh([mockReflexes[0]]);

      const stats = cache.getStats();
      expect(stats.size).toBe(1);
    });

    it('should update stats.lastSyncAt', () => {
      const beforeRefresh = new Date().toISOString();
      cache.refresh([mockReflexes[0]]);
      const afterRefresh = new Date().toISOString();

      const stats = cache.getStats();
      expect(stats.lastSyncAt).toBeDefined();
      expect(stats.lastSyncAt! >= beforeRefresh).toBe(true);
      expect(stats.lastSyncAt! <= afterRefresh).toBe(true);
    });

    it('should update cache size metric', () => {
      const { metrics } = require('../reflex-metrics.js');
      metrics.setCacheSize.mockClear();

      cache.refresh([mockReflexes[0]]);

      expect(metrics.setCacheSize).toHaveBeenCalledWith(1);
    });

    it('should handle empty refresh (clear cache)', () => {
      cache.refresh([]);

      expect(cache.size).toBe(0);
      expect(cache.getAll()).toEqual([]);
    });
  });

  describe('real-time synchronization', () => {
    it('should call refresh when subscription callback fires', async () => {
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.getAll.mockResolvedValue([mockReflexes[0]]);
      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();

      // Initial state: 1 reflex
      expect(cache.size).toBe(1);

      // Simulate Firestore snapshot update
      subscriptionCallback!([mockReflexes[0], mockReflexes[1]]);

      // Cache should be updated
      expect(cache.size).toBe(2);
      expect(cache.getAll().map(r => r.id)).toEqual(['reflex-1', 'reflex-2']);
    });

    it('should increment updates counter on sync', async () => {
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.getAll.mockResolvedValue([mockReflexes[0]]);
      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();
      cache.resetStats();

      // Trigger 3 updates
      subscriptionCallback!(mockReflexes);
      subscriptionCallback!(mockReflexes);
      subscriptionCallback!(mockReflexes);

      const stats = cache.getStats();
      expect(stats.updates).toBe(3);
    });

    it('should update lastSyncAt on sync', async () => {
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.getAll.mockResolvedValue([mockReflexes[0]]);
      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();

      const beforeSync = new Date().toISOString();
      subscriptionCallback!(mockReflexes);
      const afterSync = new Date().toISOString();

      const stats = cache.getStats();
      expect(stats.lastSyncAt).toBeDefined();
      expect(stats.lastSyncAt! >= beforeSync).toBe(true);
      expect(stats.lastSyncAt! <= afterSync).toBe(true);
    });

    it('should update metrics on sync', async () => {
      const { metrics } = require('../reflex-metrics.js');
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();
      metrics.setCacheSize.mockClear();

      subscriptionCallback!(mockReflexes);

      expect(metrics.setCacheSize).toHaveBeenCalledWith(3);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
    });

    it('should return cache statistics', () => {
      const stats = cache.getStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('updates');
      expect(stats).toHaveProperty('lastSyncAt');
    });

    it('should return accurate size', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(3);
    });

    it('should return accurate hit/miss counts', () => {
      cache.resetStats();
      cache.getById('reflex-1'); // hit
      cache.getById('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should return copy of stats (not reference)', () => {
      const stats1 = cache.getStats();
      stats1.hits = 999;

      const stats2 = cache.getStats();
      expect(stats2.hits).not.toBe(999);
    });
  });

  describe('resetStats', () => {
    beforeEach(async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
    });

    it('should reset hit and miss counters', () => {
      cache.getById('reflex-1'); // hit
      cache.getById('missing'); // miss

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should reset updates counter', async () => {
      let subscriptionCallback: ReflexSubscriptionCallback | undefined;

      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockImplementation((callback: ReflexSubscriptionCallback) => {
        subscriptionCallback = callback;
        return jest.fn();
      });

      await cache.initialize();
      subscriptionCallback!(mockReflexes);
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.updates).toBe(0);
    });

    it('should preserve size', () => {
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.size).toBe(3);
    });

    it('should preserve lastSyncAt', () => {
      const beforeReset = cache.getStats().lastSyncAt;
      cache.resetStats();
      const afterReset = cache.getStats().lastSyncAt;

      expect(afterReset).toBe(beforeReset);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(cache.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();

      expect(cache.isInitialized()).toBe(true);
    });

    it('should return false after close', async () => {
      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();
      cache.close();

      expect(cache.isInitialized()).toBe(false);
    });
  });

  describe('close', () => {
    it('should call unsubscribe function', async () => {
      const mockUnsubscribe = jest.fn();
      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockReturnValue(mockUnsubscribe);

      await cache.initialize();
      cache.close();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should clear cache', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();
      expect(cache.size).toBe(3);

      cache.close();

      expect(cache.size).toBe(0);
      expect(cache.getAll()).toEqual([]);
    });

    it('should reset size stat', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();
      cache.close();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should not throw if called before initialization', () => {
      expect(() => cache.close()).not.toThrow();
    });

    it('should not throw if called multiple times', async () => {
      mockRepository.getAll.mockResolvedValue([]);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();
      cache.close();

      expect(() => cache.close()).not.toThrow();
    });
  });

  describe('size property', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('should return correct count after initialization', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();

      expect(cache.size).toBe(3);
    });

    it('should update after refresh', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());

      await cache.initialize();
      cache.refresh([mockReflexes[0]]);

      expect(cache.size).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle concurrent getById calls', async () => {
      mockRepository.getAll.mockResolvedValue(mockReflexes);
      mockRepository.subscribe.mockReturnValue(jest.fn());
      await cache.initialize();
      cache.resetStats();

      // Simulate concurrent access
      const results = await Promise.all([
        Promise.resolve(cache.getById('reflex-1')),
        Promise.resolve(cache.getById('reflex-2')),
        Promise.resolve(cache.getById('reflex-3')),
      ]);

      expect(results.every(r => r !== undefined)).toBe(true);
      expect(cache.getStats().hits).toBe(3);
    });

    it('should handle reflexes with same priority', () => {
      const samePriorityReflexes = [
        { ...mockReflexes[0], priority: 5 },
        { ...mockReflexes[1], priority: 5 },
        { ...mockReflexes[2], priority: 5 },
      ];

      cache.refresh(samePriorityReflexes);

      const result = cache.getAll();
      expect(result).toHaveLength(3);
      expect(result.every(r => r.priority === 5)).toBe(true);
    });

    it('should handle refresh with duplicate IDs (last wins)', () => {
      const duplicates = [
        { ...mockReflexes[0], name: 'First' },
        { ...mockReflexes[0], name: 'Second' }, // Same ID
      ];

      cache.refresh(duplicates);

      const result = cache.getById('reflex-1');
      expect(result!.name).toBe('Second');
      expect(cache.size).toBe(1); // Only one entry
    });
  });
});
