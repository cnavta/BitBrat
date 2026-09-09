import { IDocumentStore } from '../../common/persistence/interfaces';
import { RedisClientType } from 'redis';
import { ScopeResolver } from './scope-resolver';
import type { Logger } from '../../common/logging';
import {
  BidSession,
  BidEntry,
  BidResult,
  CreateBidSessionParams,
  SubmitBidParams,
  CloseBidSessionParams,
  GetMaxBidParams,
  GetMinBidParams,
  GetClosestBidParams,
  ListBidSessionsParams,
  GetBidResultsParams,
  BidSessionResult,
  SubmitBidResult,
  CloseBidSessionResult,
} from './types';

/**
 * BidManager - Manages bidding sessions with hybrid storage
 *
 * Storage Strategy:
 * - Active sessions: Redis Hashes (fast, ephemeral)
 * - Session metadata: DocumentStore (persistent, queryable)
 * - Historical results: DocumentStore (analytics, auditing)
 *
 * Key Patterns:
 * - Redis Hash key: bid:session:{session_id}
 * - Hash fields: _metadata (JSON), user:{userId} (value string)
 * - DocumentStore collections: bid_sessions, bid_results
 */
export class BidManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,
    private logger: Logger
  ) {}

  /**
   * Create a new bid session with optional target value and TTL
   */
  async create(params: CreateBidSessionParams): Promise<BidSessionResult> {
    try {
      // 1. Resolve scope (explicit params or auto-inference from event)
      const scope = this.scopeResolver.resolve({
        scopeType: params.scopeType,
        scopeValue: params.scopeValue,
        event: params.event,
      });

      const id = `${scope.scopeType}:${scope.scopeValue}:${params.name}`;

      // 2. Create session metadata in DocumentStore
      const session: BidSession = {
        id,
        name: params.name,
        scopeType: scope.scopeType,
        scopeValue: scope.scopeValue,
        targetValue: params.targetValue,
        ttlSeconds: params.ttlSeconds,
        metadata: params.metadata || {},
        createdAt: new Date().toISOString(),
        expiresAt: params.ttlSeconds
          ? new Date(Date.now() + params.ttlSeconds * 1000).toISOString()
          : undefined,
        createdBy: params.createdBy || 'system',
        status: 'active',
      };

      await this.docStore.set('bid_sessions', id, session);

      // 3. Initialize Redis hash with metadata field
      const hashKey = `bid:session:${id}`;
      await this.redis.hSet(hashKey, '_metadata', JSON.stringify({
        targetValue: params.targetValue,
        createdAt: session.createdAt,
      }));

      // 4. Set TTL if specified
      if (params.ttlSeconds) {
        await this.redis.expire(hashKey, params.ttlSeconds);
      }

      this.logger.info('bid.session.created', {
        id,
        hashKey,
        ttlSeconds: params.ttlSeconds,
        targetValue: params.targetValue,
      });

      return {
        success: true,
        sessionId: id,
        sessionKey: hashKey,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      this.logger.error('bid.create.failed', { error, params });
      return {
        success: false,
        sessionId: '',
        sessionKey: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Submit or update a user's bid in an active session
   */
  async submit(params: SubmitBidParams): Promise<SubmitBidResult> {
    try {
      const hashKey = `bid:session:${params.session}`;
      const userKey = `user:${params.user}`;

      // Get previous value (if any) for audit trail
      const previousValue = await this.redis.hGet(hashKey, userKey);

      // Atomic upsert (create or update)
      await this.redis.hSet(hashKey, userKey, String(params.value));

      this.logger.info('bid.submitted', {
        session: params.session,
        user: params.user,
        value: params.value,
        previousValue: previousValue ? parseFloat(previousValue) : null,
      });

      return {
        success: true,
        entryId: `${params.session}:${params.user}`,
        previousValue: previousValue ? parseFloat(previousValue) : undefined,
        newValue: params.value,
      };
    } catch (error) {
      this.logger.error('bid.submit.failed', { error, params });
      return {
        success: false,
        entryId: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Close a session, compute statistics, and snapshot results to DocumentStore
   */
  async close(params: CloseBidSessionParams): Promise<CloseBidSessionResult> {
    try {
      const hashKey = `bid:session:${params.session}`;
      const allBids = await this.redis.hGetAll(hashKey);

      const entries = this.parseHashEntries(allBids);
      const closedAt = new Date().toISOString();

      // Compute statistics
      const values = entries.map(e => e.value);
      const statistics = {
        max: Math.max(...values),
        min: Math.min(...values),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        median: this.computeMedian(values),
      };

      // Compute winner if targetValue exists
      let winner: CloseBidSessionResult['winner'];
      if (params.computeWinner !== false) {
        const metadataJson = allBids['_metadata'];
        if (metadataJson) {
          const metadata = JSON.parse(metadataJson);
          if (metadata.targetValue !== undefined) {
            const sorted = entries.sort((a, b) =>
              Math.abs(a.value - metadata.targetValue) - Math.abs(b.value - metadata.targetValue)
            );
            const winnerEntry = sorted[0];
            winner = {
              userId: winnerEntry.user,
              value: winnerEntry.value,
              difference: Math.abs(winnerEntry.value - metadata.targetValue),
            };
          }
        }
      }

      // Update session metadata in DocumentStore
      await this.docStore.set('bid_sessions', params.session, {
        closedAt,
        status: 'closed',
      }, true); // merge

      // Snapshot results to DocumentStore
      const resultId = `${params.session}:${Date.now()}`;
      await this.docStore.set('bid_results', resultId, {
        id: resultId,
        sessionId: params.session,
        closedAt,
        totalEntries: entries.length,
        winner: winner ? {
          userId: winner.userId,
          value: winner.value,
          difference: winner.difference,
        } : undefined,
        statistics,
        allEntries: entries.map(e => ({
          userId: e.user,
          value: e.value,
          submittedAt: closedAt, // Approximate
        })),
        metadata: {},
      });

      // Optionally delete Redis hash
      if (params.deleteRedisHash) {
        await this.redis.del(hashKey);
      }

      this.logger.info('bid.session.closed', {
        session: params.session,
        totalEntries: entries.length,
        winner: winner ? `${winner.userId} (${winner.value})` : 'none',
      });

      return {
        success: true,
        sessionId: params.session,
        closedAt,
        finalCount: entries.length,
        winner,
        statistics,
      };
    } catch (error) {
      this.logger.error('bid.close.failed', { error, params });
      throw error;
    }
  }

  /**
   * Get the highest bid in a session
   */
  async getMax(params: GetMaxBidParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    const maxEntry = entries.reduce((max, entry) =>
      entry.value > max.value ? entry : max
    );

    return this.toBidEntry(params.session, maxEntry);
  }

  /**
   * Get the lowest bid in a session
   */
  async getMin(params: GetMinBidParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    const minEntry = entries.reduce((min, entry) =>
      entry.value < min.value ? entry : min
    );

    return this.toBidEntry(params.session, minEntry);
  }

  /**
   * Get the bid closest to the target value
   */
  async getClosest(params: GetClosestBidParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    // Get target from params or session metadata
    let target = params.target;
    if (!target) {
      const metadataJson = allBids['_metadata'];
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson);
        target = metadata.targetValue;
      }
    }

    if (!target) {
      throw new Error('No target value specified');
    }

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    // Sort by distance to target
    const sorted = entries.sort((a, b) =>
      Math.abs(a.value - target!) - Math.abs(b.value - target!)
    );

    const winner = sorted[0];
    return {
      ...this.toBidEntry(params.session, winner),
      difference: Math.abs(winner.value - target),
    };
  }

  /**
   * List bid sessions by scope and status
   */
  async list(params: ListBidSessionsParams): Promise<BidSession[]> {
    const filters: any[] = [];

    if (params.scopeType) {
      filters.push({ field: 'scopeType', operator: '==', value: params.scopeType });
    }

    if (params.scopeValue) {
      filters.push({ field: 'scopeValue', operator: '==', value: params.scopeValue });
    }

    if (params.status) {
      filters.push({ field: 'status', operator: '==', value: params.status });
    }

    return await this.docStore.query<BidSession>('bid_sessions', {
      filters,
      limit: params.limit || 50,
    });
  }

  /**
   * Query historical bid results for analytics
   */
  async getResults(params: GetBidResultsParams): Promise<BidResult[]> {
    const filters: any[] = [];

    if (params.sessionId) {
      filters.push({ field: 'sessionId', operator: '==', value: params.sessionId });
    }

    if (params.scopeType) {
      filters.push({ field: 'metadata.scopeType', operator: '==', value: params.scopeType });
    }

    if (params.scopeValue) {
      filters.push({ field: 'metadata.scopeValue', operator: '==', value: params.scopeValue });
    }

    return await this.docStore.query<BidResult>('bid_results', {
      filters,
      limit: params.limit || 50,
      orderBy: params.orderBy
        ? { field: params.orderBy, direction: 'desc' }
        : { field: 'closedAt', direction: 'desc' },
    });
  }

  /**
   * Parse Redis Hash entries, filtering out metadata field
   */
  private parseHashEntries(hash: Record<string, string>): Array<{ user: string; value: number }> {
    return Object.entries(hash)
      .filter(([key]) => key.startsWith('user:'))
      .map(([key, value]) => ({
        user: key.replace('user:', ''),
        value: parseFloat(value),
      }));
  }

  /**
   * Convert parsed entry to BidEntry format
   */
  private toBidEntry(sessionId: string, entry: { user: string; value: number }): BidEntry {
    return {
      sessionId,
      userId: entry.user,
      userName: entry.user, // Could lookup from user service in future
      value: entry.value,
      submittedAt: new Date().toISOString(),
    };
  }

  /**
   * Compute median value from array of numbers
   */
  private computeMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
