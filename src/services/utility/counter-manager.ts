/**
 * CounterManager - Core logic for counter management
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Manages counters with hybrid storage:
 * - Metadata → DocumentStore (PostgreSQL default)
 * - Values → Redis simple keys (fast INCR/DECR)
 * - Snapshots → DocumentStore (historical tracking)
 */

import type { Logger } from '../../common/logging';
import type { RedisClientType } from 'redis';
import type { IDocumentStore } from '../../common/persistence/interfaces';
import { ScopeResolver } from './scope-resolver';
import type {
  CounterDefinition,
  CounterSnapshot,
  CreateCounterParams,
  CounterResult,
  IncrementParams,
  IncrementResult,
  DecrementParams,
  DecrementResult,
  GetCounterParams,
  GetCounterResult,
  SetCounterParams,
  SetCounterResult,
  DeleteCounterParams,
  DeleteCounterResult,
  ListCountersParams,
  SnapshotCounterParams,
  SnapshotCounterResult,
} from './types';
import { randomUUID } from 'crypto';

/**
 * CounterManager implements all counter operations
 *
 * Storage Strategy:
 * - Counter metadata → DocumentStore collection 'counter_definitions'
 * - Counter values → Redis keys with pattern 'counter:{scopeType}:{scopeValue}:{name}'
 * - Historical snapshots → DocumentStore collection 'counter_snapshots'
 *
 * Features:
 * - TTL enforcement via Redis EXPIRE
 * - Atomic increments/decrements via Redis INCR/DECR
 * - Scope-based querying via DocumentStore filters
 * - Manual and automatic snapshots
 */
export class CounterManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,
    private logger: Logger
  ) {}

  /**
   * Create a new counter with metadata and initial value
   *
   * @param params Counter creation parameters
   * @returns Result with counter ID and Redis key
   */
  async create(params: CreateCounterParams): Promise<CounterResult> {
    try {
      // Resolve scope
      const scope = this.scopeResolver.resolve({
        scopeType: params.scopeType,
        scopeValue: params.scopeValue,
        event: params.event,
      });

      // Build counter ID and Redis key
      const id = this.scopeResolver.buildId(scope, params.name);
      const key = this.scopeResolver.buildKey('counter', scope, params.name);

      // Check if counter already exists
      const existingDefinition = await this.docStore.get<CounterDefinition>(
        'counter_definitions',
        id
      );

      if (existingDefinition) {
        throw new Error(`Counter already exists: ${id}`);
      }

      // Create counter definition
      const definition: CounterDefinition = {
        id,
        name: params.name,
        scopeType: scope.scopeType,
        scopeValue: scope.scopeValue,
        ttlSeconds: params.ttlSeconds,
        metadata: params.metadata || {},
        createdAt: new Date().toISOString(),
        expiresAt: params.ttlSeconds
          ? new Date(Date.now() + params.ttlSeconds * 1000).toISOString()
          : undefined,
        createdBy: params.createdBy || 'system',
      };

      // Store definition in DocumentStore
      await this.docStore.set('counter_definitions', id, definition);

      // Initialize value in Redis
      const initialValue = params.initialValue ?? 0;
      await this.redis.set(key, String(initialValue));

      // Set TTL if specified
      if (params.ttlSeconds) {
        await this.redis.expire(key, params.ttlSeconds);
      }

      this.logger.info('counter.created', { id, key, initialValue, ttl: params.ttlSeconds });

      return {
        success: true,
        counterId: id,
        key,
      };
    } catch (error: any) {
      this.logger.error('counter.create.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Increment counter value
   *
   * @param params Increment parameters
   * @returns New value after increment
   */
  async increment(params: IncrementParams): Promise<IncrementResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);

      // Increment value in Redis (atomic)
      const delta = params.delta ?? 1;
      const newValue = await this.redis.incrBy(key, delta);

      this.logger.debug('counter.incremented', { key, delta, newValue });

      return {
        success: true,
        newValue,
        key,
      };
    } catch (error: any) {
      this.logger.error('counter.increment.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Decrement counter value
   *
   * @param params Decrement parameters
   * @returns New value after decrement
   */
  async decrement(params: DecrementParams): Promise<DecrementResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);

      // Decrement value in Redis (atomic)
      const delta = params.delta ?? 1;
      const newValue = await this.redis.decrBy(key, delta);

      this.logger.debug('counter.decremented', { key, delta, newValue });

      return {
        success: true,
        newValue,
        key,
      };
    } catch (error: any) {
      this.logger.error('counter.decrement.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Get current counter value and metadata
   *
   * @param params Get parameters
   * @returns Current value and metadata
   */
  async get(params: GetCounterParams): Promise<GetCounterResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);

      // Get value from Redis
      const valueStr = await this.redis.get(key);
      const value = valueStr ? parseInt(valueStr, 10) : 0;

      // Get metadata from DocumentStore (if needed)
      let metadata: Record<string, any> | undefined;
      if (!params.key) {
        // If key was resolved from name, get metadata
        const id = key.replace('counter:', '');
        const definition = await this.docStore.get<CounterDefinition>(
          'counter_definitions',
          id
        );
        metadata = definition?.metadata;
      }

      this.logger.debug('counter.get', { key, value });

      return {
        success: true,
        value,
        key,
        metadata,
      };
    } catch (error: any) {
      this.logger.error('counter.get.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Set counter value to a specific number
   *
   * @param params Set parameters
   * @returns New value
   */
  async set(params: SetCounterParams): Promise<SetCounterResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);

      // Set value in Redis
      await this.redis.set(key, String(params.value));

      this.logger.debug('counter.set', { key, value: params.value });

      return {
        success: true,
        value: params.value,
        key,
      };
    } catch (error: any) {
      this.logger.error('counter.set.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Delete counter (removes from both DocumentStore and Redis)
   *
   * @param params Delete parameters
   * @returns Success status
   */
  async delete(params: DeleteCounterParams): Promise<DeleteCounterResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);
      const id = key.replace('counter:', '');

      // Delete from Redis
      await this.redis.del(key);

      // Delete from DocumentStore
      await this.docStore.delete('counter_definitions', id);

      this.logger.info('counter.deleted', { key, id });

      return {
        success: true,
        key,
      };
    } catch (error: any) {
      this.logger.error('counter.delete.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * List counters by scope with filters
   *
   * @param params List parameters
   * @returns Array of counter definitions
   */
  async list(params: ListCountersParams): Promise<CounterDefinition[]> {
    try {
      const filters: Array<{ field: string; operator: any; value: any }> = [];

      // Filter by scope type
      if (params.scopeType) {
        filters.push({ field: 'scopeType', operator: '==', value: params.scopeType });
      }

      // Filter by scope value
      if (params.scopeValue) {
        filters.push({ field: 'scopeValue', operator: '==', value: params.scopeValue });
      }

      // Filter out expired counters (unless includeExpired is true)
      if (!params.includeExpired) {
        filters.push({
          field: 'expiresAt',
          operator: '>',
          value: new Date().toISOString(),
        });
      }

      const counters = await this.docStore.query<CounterDefinition>(
        'counter_definitions',
        { filters: filters.length > 0 ? filters : undefined }
      );

      this.logger.debug('counter.list', {
        count: counters.length,
        scopeType: params.scopeType,
        scopeValue: params.scopeValue,
      });

      return counters;
    } catch (error: any) {
      this.logger.error('counter.list.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Take a snapshot of counter value
   * Stores current value in DocumentStore for historical tracking
   *
   * @param params Snapshot parameters
   * @returns Snapshot result with snapshot ID
   */
  async snapshot(params: SnapshotCounterParams): Promise<SnapshotCounterResult> {
    try {
      // Resolve key
      const key = await this.resolveKey(params);
      const counterId = key.replace('counter:', '');

      // Get current value from Redis
      const valueStr = await this.redis.get(key);
      const value = valueStr ? parseInt(valueStr, 10) : 0;

      // Create snapshot
      const snapshotId = randomUUID();
      const snapshotAt = new Date().toISOString();

      const snapshot: CounterSnapshot = {
        id: snapshotId,
        counterId,
        value,
        snapshotAt,
        trigger: params.trigger || 'manual',
      };

      // Store snapshot in DocumentStore
      await this.docStore.set('counter_snapshots', snapshotId, snapshot);

      this.logger.info('counter.snapshot.created', {
        snapshotId,
        counterId,
        value,
        trigger: params.trigger,
      });

      return {
        success: true,
        snapshotId,
        value,
        snapshotAt,
      };
    } catch (error: any) {
      this.logger.error('counter.snapshot.error', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Resolve Redis key from parameters
   * If key is provided directly, use it. Otherwise, resolve from name and scope.
   *
   * @param params Parameters that may contain key or name
   * @returns Resolved Redis key
   */
  private async resolveKey(
    params: { key?: string; name?: string } & Partial<IncrementParams>
  ): Promise<string> {
    // Priority 1: Use explicit key
    if (params.key) {
      return params.key;
    }

    // Priority 2: Resolve from name and scope
    if (!params.name) {
      throw new Error('Either key or name must be provided');
    }

    const scope = this.scopeResolver.resolve({
      scopeType: params.scopeType,
      scopeValue: params.scopeValue,
      event: params.event,
    });

    return this.scopeResolver.buildKey('counter', scope, params.name);
  }
}
