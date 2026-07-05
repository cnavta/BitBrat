/**
 * Reflex Cache for In-Memory Storage
 *
 * Provides fast in-memory access to active reflexes with real-time synchronization
 * from Firestore. Automatically maintains sorted order by priority.
 *
 * Features:
 * - In-memory Map storage for O(1) lookups
 * - Real-time sync via Firestore onSnapshot
 * - Automatic priority sorting
 * - Thread-safe operations
 * - Cache warming on initialization
 */

import { logger } from '../../common/logging';
import { Reflex } from '../../types/reflex.js';
import { ReflexRepository, ReflexSubscriptionCallback } from './reflex-repository.js';
import { metrics } from './reflex-metrics.js';

/**
 * Cache statistics for monitoring and debugging.
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  updates: number;
  lastSyncAt?: string;
}

/**
 * In-memory cache for reflexes with real-time Firestore synchronization.
 *
 * Usage:
 * ```typescript
 * const cache = new ReflexCache(repository);
 * await cache.initialize(); // Loads initial data + sets up subscription
 *
 * const reflexes = cache.getAll(); // O(1) access, sorted by priority
 * const reflex = cache.getById('reflex-123'); // O(1) lookup
 *
 * cache.close(); // Cleanup subscription when service stops
 * ```
 */
export class ReflexCache {
  private cache: Map<string, Reflex> = new Map();
  private repository: ReflexRepository;
  private unsubscribe?: () => void;
  private stats: CacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    updates: 0,
  };

  constructor(repository: ReflexRepository) {
    this.repository = repository;
  }

  /**
   * Initializes the cache by loading all active reflexes and setting up
   * real-time synchronization.
   *
   * Must be called before using the cache.
   *
   * @throws {Error} If initialization fails
   *
   * @example
   * const cache = new ReflexCache(repository);
   * await cache.initialize();
   * console.log('Cache ready with', cache.getAll().length, 'reflexes');
   */
  async initialize(): Promise<void> {
    try {
      logger.info('reflex.cache.initialize');

      // Step 1: Load initial data from repository
      const reflexes = await this.repository.getAll();
      this.refresh(reflexes);

      logger.info('reflex.cache.loaded', {
        size: this.cache.size,
      });

      // Step 2: Set up real-time subscription
      this.unsubscribe = this.repository.subscribe((updatedReflexes: Reflex[]) => {
        logger.debug('reflex.cache.update_received', {
          count: updatedReflexes.length,
        });

        this.refresh(updatedReflexes);
        this.stats.updates++;
        this.stats.lastSyncAt = new Date().toISOString();

        logger.info('reflex.cache.synchronized', {
          size: this.cache.size,
          updates: this.stats.updates,
        });
      });

      logger.info('reflex.cache.subscription_active');
    } catch (error) {
      logger.error('reflex.cache.initialize_failed', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(
        `Cache initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gets all active reflexes, sorted by priority (ascending).
   *
   * Returns cached data (no Firestore query).
   *
   * @returns Array of reflexes sorted by priority
   *
   * @example
   * const reflexes = cache.getAll();
   * // [{ id: '1', priority: 1, ... }, { id: '2', priority: 2, ... }]
   */
  getAll(): Reflex[] {
    const reflexes = Array.from(this.cache.values());

    // Sort by priority (ascending: lower priority number = higher priority)
    reflexes.sort((a, b) => a.priority - b.priority);

    return reflexes;
  }

  /**
   * Gets a single reflex by ID.
   *
   * O(1) lookup from Map.
   *
   * @param id - Reflex ID
   * @returns Reflex if found in cache, undefined otherwise
   *
   * @example
   * const reflex = cache.getById('reflex-123');
   * if (reflex) {
   *   console.log('Found in cache:', reflex.name);
   * }
   */
  getById(id: string): Reflex | undefined {
    const reflex = this.cache.get(id);

    if (reflex) {
      this.stats.hits++;
      logger.debug('reflex.cache.hit', { id });
    } else {
      this.stats.misses++;
      logger.debug('reflex.cache.miss', { id });
    }

    return reflex;
  }

  /**
   * Refreshes the entire cache with a new set of reflexes.
   *
   * Called during initialization and when Firestore snapshot updates arrive.
   *
   * @param reflexes - New set of reflexes (only active reflexes)
   *
   * @example
   * cache.refresh(reflexes); // Replaces entire cache
   */
  refresh(reflexes: Reflex[]): void {
    logger.debug('reflex.cache.refresh_start', {
      count: reflexes.length,
    });

    // Clear existing cache
    this.cache.clear();

    // Populate with new reflexes
    for (const reflex of reflexes) {
      this.cache.set(reflex.id, reflex);
    }

    // Update stats
    this.stats.size = this.cache.size;
    this.stats.lastSyncAt = new Date().toISOString();

    // Update metrics
    metrics.setCacheSize(this.cache.size);

    logger.debug('reflex.cache.refresh_complete', {
      size: this.stats.size,
    });
  }

  /**
   * Gets cache statistics for monitoring.
   *
   * @returns Cache statistics
   *
   * @example
   * const stats = cache.getStats();
   * console.log('Cache size:', stats.size);
   * console.log('Hit rate:', stats.hits / (stats.hits + stats.misses));
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Resets cache statistics (useful for testing).
   */
  resetStats(): void {
    this.stats = {
      size: this.cache.size,
      hits: 0,
      misses: 0,
      updates: 0,
      lastSyncAt: this.stats.lastSyncAt,
    };

    logger.debug('reflex.cache.stats_reset');
  }

  /**
   * Checks if the cache has been initialized.
   *
   * @returns true if initialize() was called and subscription is active
   */
  isInitialized(): boolean {
    return !!this.unsubscribe;
  }

  /**
   * Closes the cache and unsubscribes from Firestore updates.
   *
   * Should be called when the service is shutting down.
   *
   * @example
   * process.on('SIGTERM', () => {
   *   cache.close();
   *   process.exit(0);
   * });
   */
  close(): void {
    if (this.unsubscribe) {
      logger.info('reflex.cache.closing');
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    this.cache.clear();
    this.stats.size = 0;

    logger.info('reflex.cache.closed');
  }

  /**
   * Gets the number of reflexes in the cache.
   *
   * @returns Number of cached reflexes
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Creates and initializes a singleton reflex cache.
 *
 * @param repository - ReflexRepository instance
 * @returns Initialized ReflexCache
 *
 * @example
 * const cache = await createReflexCache(repository);
 * console.log('Cache ready with', cache.size, 'reflexes');
 */
export async function createReflexCache(repository: ReflexRepository): Promise<ReflexCache> {
  const cache = new ReflexCache(repository);
  await cache.initialize();
  return cache;
}
