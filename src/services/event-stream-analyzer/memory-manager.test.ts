import { MemoryManager, type MemoryManagerConfig } from './memory-manager';

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

describe('MemoryManager', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: MemoryManager;

  const defaultConfig: MemoryManagerConfig = {
    maxEvents: 10000,
    warningThreshold: 0.8,
    evictionStrategy: 'oldest'
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    manager = new MemoryManager(mockLogger, defaultConfig);
  });

  describe('Event Tracking', () => {
    it('should track events added to observers', () => {
      manager.addEvents('observer-1', 100);
      manager.addEvents('observer-2', 50);

      expect(manager.getObserverCount('observer-1')).toBe(100);
      expect(manager.getObserverCount('observer-2')).toBe(50);
      expect(manager.getTotalEvents()).toBe(150);
    });

    it('should accumulate events for same observer', () => {
      manager.addEvents('observer-1', 100);
      manager.addEvents('observer-1', 50);
      manager.addEvents('observer-1', 25);

      expect(manager.getObserverCount('observer-1')).toBe(175);
      expect(manager.getTotalEvents()).toBe(175);
    });

    it('should track events removed from observers', () => {
      manager.addEvents('observer-1', 100);
      manager.removeEvents('observer-1', 30);

      expect(manager.getObserverCount('observer-1')).toBe(70);
      expect(manager.getTotalEvents()).toBe(70);
    });

    it('should not go below zero when removing events', () => {
      manager.addEvents('observer-1', 50);
      manager.removeEvents('observer-1', 100);

      expect(manager.getObserverCount('observer-1')).toBe(0);
      expect(manager.getTotalEvents()).toBe(0);
    });

    it('should delete observer when event count reaches zero', () => {
      manager.addEvents('observer-1', 50);
      manager.removeEvents('observer-1', 50);

      const stats = manager.getStats();
      expect(stats.observerCounts.has('observer-1')).toBe(false);
    });
  });

  describe('Memory Limit Checks', () => {
    it('should detect when adding events would exceed limit', () => {
      manager.addEvents('observer-1', 9000);

      expect(manager.wouldExceedLimit(500)).toBe(false);
      expect(manager.wouldExceedLimit(1001)).toBe(true);
    });

    it('should return false when under limit', () => {
      manager.addEvents('observer-1', 5000);

      expect(manager.wouldExceedLimit(1000)).toBe(false);
    });
  });

  describe('Memory Statistics', () => {
    it('should calculate correct usage statistics', () => {
      manager.addEvents('observer-1', 6000);
      manager.addEvents('observer-2', 2000);

      const stats = manager.getStats();

      expect(stats.totalEvents).toBe(8000);
      expect(stats.maxEvents).toBe(10000);
      expect(stats.usagePercent).toBe(0.8);
      expect(stats.warningLevel).toBe(true);
      expect(stats.criticalLevel).toBe(false);
    });

    it('should detect warning level at 80%', () => {
      manager.addEvents('observer-1', 7999);

      let stats = manager.getStats();
      expect(stats.warningLevel).toBe(false);

      manager.addEvents('observer-2', 1);

      stats = manager.getStats();
      expect(stats.warningLevel).toBe(true);
    });

    it('should detect critical level at 95%', () => {
      manager.addEvents('observer-1', 9500);

      const stats = manager.getStats();
      expect(stats.criticalLevel).toBe(true);
      expect(stats.warningLevel).toBe(true);
    });

    it('should include observer counts in stats', () => {
      manager.addEvents('observer-1', 100);
      manager.addEvents('observer-2', 200);
      manager.addEvents('observer-3', 300);

      const stats = manager.getStats();

      expect(stats.observerCounts.size).toBe(3);
      expect(stats.observerCounts.get('observer-1')).toBe(100);
      expect(stats.observerCounts.get('observer-2')).toBe(200);
      expect(stats.observerCounts.get('observer-3')).toBe(300);
    });
  });

  describe('Eviction Candidates - Oldest Strategy', () => {
    beforeEach(() => {
      manager = new MemoryManager(mockLogger, {
        ...defaultConfig,
        evictionStrategy: 'oldest'
      });
    });

    it('should return no candidates when below warning threshold', () => {
      manager.addEvents('observer-1', 5000);

      const candidates = manager.getEvictionCandidates(1000);

      expect(candidates).toEqual([]);
    });

    it('should distribute eviction proportionally across observers', () => {
      // Total: 8000 events (80% usage - at warning threshold)
      manager.addEvents('observer-1', 4000); // 50%
      manager.addEvents('observer-2', 2000); // 25%
      manager.addEvents('observer-3', 2000); // 25%

      const candidates = manager.getEvictionCandidates(1000);

      expect(candidates).toHaveLength(3);

      // Check proportional distribution (50%, 25%, 25%)
      const obs1Candidate = candidates.find(c => c.observerId === 'observer-1');
      const obs2Candidate = candidates.find(c => c.observerId === 'observer-2');
      const obs3Candidate = candidates.find(c => c.observerId === 'observer-3');

      expect(obs1Candidate?.evictCount).toBe(500); // 50% of 1000
      expect(obs2Candidate?.evictCount).toBe(250); // 25% of 1000
      expect(obs3Candidate?.evictCount).toBe(250); // 25% of 1000
      expect(obs1Candidate?.reason).toBe('oldest');
    });

    it('should not evict more events than available', () => {
      manager.addEvents('observer-1', 8000);
      manager.addEvents('observer-2', 100); // Small window

      const candidates = manager.getEvictionCandidates(1000);

      const obs2Candidate = candidates.find(c => c.observerId === 'observer-2');
      // Observer 2 has ~1.2% of events, so proportional eviction would be ~12 events
      // But should not exceed 100 (its total)
      expect(obs2Candidate?.evictCount).toBeLessThanOrEqual(100);
    });
  });

  describe('Eviction Candidates - Largest Window Strategy', () => {
    beforeEach(() => {
      manager = new MemoryManager(mockLogger, {
        ...defaultConfig,
        evictionStrategy: 'largest-window'
      });
    });

    it('should return no candidates when below warning threshold', () => {
      manager.addEvents('observer-1', 5000);

      const candidates = manager.getEvictionCandidates(1000);

      expect(candidates).toEqual([]);
    });

    it('should target observer with most events', () => {
      manager.addEvents('observer-1', 2000);
      manager.addEvents('observer-2', 5000); // Largest
      manager.addEvents('observer-3', 1000);

      const candidates = manager.getEvictionCandidates(500);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].observerId).toBe('observer-2');
      expect(candidates[0].evictCount).toBe(500);
      expect(candidates[0].reason).toBe('largest-window');
    });

    it('should not evict more than available in largest window', () => {
      manager.addEvents('observer-1', 8000); // Largest

      const candidates = manager.getEvictionCandidates(10000); // Try to evict more than available

      expect(candidates).toHaveLength(1);
      expect(candidates[0].evictCount).toBe(8000); // Capped at available
    });

    it('should return empty array when no observers', () => {
      const candidates = manager.getEvictionCandidates(1000);

      expect(candidates).toEqual([]);
    });
  });

  describe('Observer Management', () => {
    it('should reset observer count', () => {
      manager.addEvents('observer-1', 100);
      manager.addEvents('observer-2', 200);

      manager.resetObserver('observer-1');

      expect(manager.getObserverCount('observer-1')).toBe(0);
      expect(manager.getObserverCount('observer-2')).toBe(200);
      expect(manager.getTotalEvents()).toBe(200);
    });

    it('should handle resetting non-existent observer', () => {
      manager.resetObserver('non-existent');

      expect(manager.getTotalEvents()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero events', () => {
      const stats = manager.getStats();

      expect(stats.totalEvents).toBe(0);
      expect(stats.usagePercent).toBe(0);
      expect(stats.warningLevel).toBe(false);
    });

    it('should handle exactly at limit', () => {
      manager.addEvents('observer-1', 10000);

      expect(manager.wouldExceedLimit(0)).toBe(false);
      expect(manager.wouldExceedLimit(1)).toBe(true);

      const stats = manager.getStats();
      expect(stats.usagePercent).toBe(1.0);
      expect(stats.criticalLevel).toBe(true);
    });

    it('should handle single observer', () => {
      manager.addEvents('observer-1', 8000);

      const candidates = manager.getEvictionCandidates(1000);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].observerId).toBe('observer-1');
    });

    it('should handle rounding in proportional eviction', () => {
      // Create scenario where rounding matters
      manager.addEvents('observer-1', 8001); // 80.01%
      manager.addEvents('observer-2', 1999); // 19.99%

      const candidates = manager.getEvictionCandidates(100);

      const totalEvicted = candidates.reduce((sum, c) => sum + c.evictCount, 0);
      // Due to ceiling, might evict slightly more than requested
      expect(totalEvicted).toBeGreaterThanOrEqual(100);
      expect(totalEvicted).toBeLessThanOrEqual(102); // Small margin for rounding
    });
  });
});
