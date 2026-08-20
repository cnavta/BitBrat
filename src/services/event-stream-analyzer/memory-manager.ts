/**
 * MemoryManager
 *
 * Manages memory usage across all event windows by tracking total event count
 * and evicting oldest events when memory limit is approached.
 *
 * Phase 3: Production Readiness - Memory Management
 * Sprint: sprint-20-xc3pcu
 * Task: P3-007
 */

export interface MemoryManagerConfig {
  maxEvents: number;           // Total event limit across all windows (default: 10,000)
  warningThreshold: number;    // Warning threshold percentage (default: 0.8 = 80%)
  evictionStrategy: 'oldest' | 'largest-window'; // Eviction strategy
}

export interface MemoryStats {
  totalEvents: number;
  maxEvents: number;
  usagePercent: number;
  observerCounts: Map<string, number>;
  warningLevel: boolean;
  criticalLevel: boolean;
}

export interface EvictionCandidate {
  observerId: string;
  evictCount: number;
  reason: 'oldest' | 'largest-window';
}

/**
 * MemoryManager tracks event counts across all observers and determines
 * eviction candidates when memory limits are approached.
 */
export class MemoryManager {
  private observerEventCounts = new Map<string, number>();
  private logger: any;
  private config: MemoryManagerConfig;

  constructor(logger: any, config: MemoryManagerConfig) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Track events added to an observer's window
   */
  addEvents(observerId: string, count: number): void {
    const current = this.observerEventCounts.get(observerId) || 0;
    this.observerEventCounts.set(observerId, current + count);

    this.logger.debug('memory-manager.add_events', {
      observerId,
      added: count,
      newTotal: current + count,
      globalTotal: this.getTotalEvents()
    });
  }

  /**
   * Track events removed from an observer's window
   */
  removeEvents(observerId: string, count: number): void {
    const current = this.observerEventCounts.get(observerId) || 0;
    const newCount = Math.max(0, current - count);

    if (newCount === 0) {
      this.observerEventCounts.delete(observerId);
    } else {
      this.observerEventCounts.set(observerId, newCount);
    }

    this.logger.debug('memory-manager.remove_events', {
      observerId,
      removed: count,
      newTotal: newCount,
      globalTotal: this.getTotalEvents()
    });
  }

  /**
   * Check if adding events would exceed memory limit
   */
  wouldExceedLimit(additionalEvents: number): boolean {
    const totalAfterAdd = this.getTotalEvents() + additionalEvents;
    return totalAfterAdd > this.config.maxEvents;
  }

  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    const totalEvents = this.getTotalEvents();
    const usagePercent = totalEvents / this.config.maxEvents;
    const warningLevel = usagePercent >= this.config.warningThreshold;
    const criticalLevel = usagePercent >= 0.95;

    return {
      totalEvents,
      maxEvents: this.config.maxEvents,
      usagePercent,
      observerCounts: new Map(this.observerEventCounts),
      warningLevel,
      criticalLevel
    };
  }

  /**
   * Get total events across all observers
   */
  getTotalEvents(): number {
    let total = 0;
    for (const count of this.observerEventCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get eviction candidates to bring memory usage below threshold
   * Returns observers and event counts to evict based on strategy
   */
  getEvictionCandidates(targetEvictionCount: number): EvictionCandidate[] {
    const stats = this.getStats();

    if (!stats.warningLevel) {
      return [];
    }

    this.logger.info('memory-manager.eviction.needed', {
      totalEvents: stats.totalEvents,
      maxEvents: this.config.maxEvents,
      usagePercent: stats.usagePercent,
      targetEvictionCount,
      strategy: this.config.evictionStrategy
    });

    if (this.config.evictionStrategy === 'oldest') {
      return this.getEvictionCandidatesOldest(targetEvictionCount);
    } else {
      return this.getEvictionCandidatesLargestWindow(targetEvictionCount);
    }
  }

  /**
   * Oldest strategy: Evict from all observers proportionally
   * Distributes eviction across all observers based on their event count
   */
  private getEvictionCandidatesOldest(targetEvictionCount: number): EvictionCandidate[] {
    const candidates: EvictionCandidate[] = [];
    const totalEvents = this.getTotalEvents();

    if (totalEvents === 0) {
      return candidates;
    }

    // Calculate proportional eviction for each observer
    for (const [observerId, eventCount] of this.observerEventCounts.entries()) {
      const proportion = eventCount / totalEvents;
      const evictCount = Math.ceil(targetEvictionCount * proportion);

      if (evictCount > 0) {
        candidates.push({
          observerId,
          evictCount: Math.min(evictCount, eventCount), // Don't evict more than available
          reason: 'oldest'
        });
      }
    }

    this.logger.info('memory-manager.eviction.candidates_oldest', {
      candidateCount: candidates.length,
      totalToEvict: candidates.reduce((sum, c) => sum + c.evictCount, 0)
    });

    return candidates;
  }

  /**
   * Largest-window strategy: Evict from observer with most events
   * Targets single largest window for eviction
   */
  private getEvictionCandidatesLargestWindow(targetEvictionCount: number): EvictionCandidate[] {
    const candidates: EvictionCandidate[] = [];

    if (this.observerEventCounts.size === 0) {
      return candidates;
    }

    // Find observer with most events
    let largestObserver: string | null = null;
    let largestCount = 0;

    for (const [observerId, eventCount] of this.observerEventCounts.entries()) {
      if (eventCount > largestCount) {
        largestCount = eventCount;
        largestObserver = observerId;
      }
    }

    if (largestObserver) {
      candidates.push({
        observerId: largestObserver,
        evictCount: Math.min(targetEvictionCount, largestCount),
        reason: 'largest-window'
      });

      this.logger.info('memory-manager.eviction.candidates_largest', {
        observerId: largestObserver,
        eventCount: largestCount,
        evictCount: candidates[0].evictCount
      });
    }

    return candidates;
  }

  /**
   * Reset observer count (called when observer is removed)
   */
  resetObserver(observerId: string): void {
    this.observerEventCounts.delete(observerId);
    this.logger.debug('memory-manager.reset_observer', { observerId });
  }

  /**
   * Get observer event count
   */
  getObserverCount(observerId: string): number {
    return this.observerEventCounts.get(observerId) || 0;
  }
}
