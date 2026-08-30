import { Bit } from '../common/base-server';
import type { IDocumentStore } from '../common/persistence/interfaces';
import type { RedisClientType } from 'redis';
import type { InternalEventV2 } from '../types';
import { ScopeResolver } from '../services/utility/scope-resolver';
import { CounterManager } from '../services/utility/counter-manager';
import { BidManager } from '../services/utility/bid-manager';
import { z } from 'zod';

/**
 * UtilityService - Platform utilities for counters and bidding
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Provides platform utilities for:
 * 1. Arbitrary Counters - Scoped counter management with TTL, metadata, and snapshots
 * 2. Bidding Sessions - User bidding/guessing with aggregation queries (Phase 2)
 *
 * Storage Strategy:
 * - Counter metadata → DocumentStore (PostgreSQL default)
 * - Counter values → Redis simple keys (fast INCR/DECR)
 * - Bid session metadata → DocumentStore (persistent, queryable)
 * - Active bids → Redis Hashes (fast, ephemeral, TTL)
 * - Bid results → DocumentStore (historical analytics)
 *
 * MCP Tools (platform-only):
 * Phase 1 - Counters:
 * - counter.create - Create counter with metadata
 * - counter.increment - Increment counter value
 * - counter.get - Get current value and metadata
 * - counter.delete - Remove counter
 * - counter.list - Query counters by scope
 * - counter.snapshot - Take manual snapshot
 *
 * Phase 2 - Bidding (Future):
 * - bid.session.create - Create bidding session
 * - bid.submit - Submit user bid
 * - bid.session.close - Close session and snapshot results
 * - bid.get.max - Get maximum bid
 * - bid.get.min - Get minimum bid
 * - bid.get.closest - Get closest bid to target
 * - bid.session.list - Query sessions by scope
 * - bid.results - Get historical results
 *
 * Profile: core
 * MCP Exposure: platform-only
 * Kind: pipeline-service
 */
export class UtilityService extends Bit {
  private docStore?: IDocumentStore;
  private redis?: RedisClientType;
  private counterManager?: CounterManager;
  private bidManager?: BidManager;
  private scopeResolver?: ScopeResolver;
  private setupComplete = false;

  constructor() {
    super({
      mcpExposure: 'platform-only',
    });

    // Register setup to run on startup
    this.onStartup(async () => {
      await this.setup();
    });
  }

  /**
   * Initialize utility service
   * Sets up resources, managers, and MCP tools
   */
  private async setup(): Promise<void> {
    this.getLogger().info('utility.setup.start');

    try {
      // Initialize resources (lazy pattern - resources may not be ready yet)
      this.setupResources();

      // Register MCP tools
      this.registerCounterTools();
      this.registerBidTools();

      this.setupComplete = true;
      this.getLogger().info('utility.setup.complete');
    } catch (error: any) {
      this.getLogger().error('utility.setup.error', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Setup DocumentStore and Redis resources
   * Uses lazy initialization - managers will be created when resources are accessed
   */
  private setupResources(): void {
    // Access resources from base server using getResource<T>()
    this.docStore = this.getResource<IDocumentStore>('documentStore');
    this.redis = this.getResource<RedisClientType>('redis');

    if (!this.docStore) {
      this.getLogger().warn('utility.resources.documentStore.unavailable', {
        message: 'DocumentStore not ready yet - will retry on first use',
      });
    }

    if (!this.redis) {
      this.getLogger().warn('utility.resources.redis.unavailable', {
        message: 'Redis not ready yet - will retry on first use',
      });
    }

    this.getLogger().info('utility.resources.initialized', {
      hasDocStore: !!this.docStore,
      hasRedis: !!this.redis,
    });
  }

  /**
   * Lazy initialization of CounterManager
   * Only initializes once resources are available
   */
  private ensureCounterManager(): CounterManager | null {
    if (this.counterManager) {
      return this.counterManager;
    }

    // Re-fetch resources in case they were initialized after setup()
    if (!this.docStore) {
      this.docStore = this.getResource<IDocumentStore>('documentStore');
    }
    if (!this.redis) {
      this.redis = this.getResource<RedisClientType>('redis');
    }

    // Check if resources are ready
    if (!this.docStore || !this.redis) {
      this.getLogger().debug('utility.counter_manager.resources_not_ready', {
        hasDocStore: !!this.docStore,
        hasRedis: !!this.redis,
      });
      return null;
    }

    // Ensure scope resolver is initialized first
    const scopeResolver = this.ensureScopeResolver();
    if (!scopeResolver) {
      return null;
    }

    // Initialize CounterManager
    this.counterManager = new CounterManager(
      this.docStore,
      this.redis,
      scopeResolver,
      this.getLogger()
    );

    this.getLogger().info('utility.counter_manager.initialized');
    return this.counterManager;
  }

  /**
   * Lazy initialization of ScopeResolver
   * Only initializes once, returns existing instance on subsequent calls
   */
  private ensureScopeResolver(): ScopeResolver | null {
    if (this.scopeResolver) {
      return this.scopeResolver;
    }

    // Initialize ScopeResolver
    this.scopeResolver = new ScopeResolver(this.getLogger());

    this.getLogger().info('utility.scope_resolver.initialized');
    return this.scopeResolver;
  }

  /**
   * Lazy initialization of BidManager
   * Only initializes once resources are available
   */
  private ensureBidManager(): BidManager | null {
    if (this.bidManager) {
      return this.bidManager;
    }

    // Re-fetch resources in case they were initialized after setup()
    if (!this.docStore) {
      this.docStore = this.getResource<IDocumentStore>('documentStore');
    }
    if (!this.redis) {
      this.redis = this.getResource<RedisClientType>('redis');
    }

    // Check if resources are ready
    if (!this.docStore || !this.redis) {
      this.getLogger().debug('utility.bid_manager.resources_not_ready', {
        hasDocStore: !!this.docStore,
        hasRedis: !!this.redis,
      });
      return null;
    }

    // Ensure scope resolver is initialized first
    const scopeResolver = this.ensureScopeResolver();
    if (!scopeResolver) {
      return null;
    }

    // Initialize BidManager
    this.bidManager = new BidManager(
      this.docStore,
      this.redis,
      scopeResolver,
      this.getLogger()
    );

    this.getLogger().info('utility.bid_manager.initialized');
    return this.bidManager;
  }

  /**
   * Register counter MCP tools
   * Phase 1 implementation - 6 tools for counter management
   */
  private registerCounterTools(): void {
    // counter.create - Create new counter with metadata
    this.registerTool(
      'counter.create',
      'Create a new counter with optional TTL and metadata',
      z.object({
        name: z.string().min(1).max(64).describe('Counter name (e.g., "deaths", "points")'),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional()
          .describe('Scope type (default: auto-infer from event)'),
        scopeValue: z.string().optional()
          .describe('Scope value (default: auto-infer from event)'),
        initialValue: z.number().default(0).describe('Initial counter value'),
        ttlSeconds: z.number().positive().optional()
          .describe('Time-to-live in seconds (omit for permanent counter)'),
        metadata: z.record(z.string(), z.any()).optional()
          .describe('Optional metadata (description, icon, category, etc.)'),
        createdBy: z.string().optional().describe('Creator identifier'),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available (resources not ready)' }],
            isError: true,
          };
        }

        try {
          const result = await manager.create(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error creating counter: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // counter.increment - Increment counter value
    this.registerTool(
      'counter.increment',
      'Increment a counter by a specified delta (default: 1)',
      z.object({
        name: z.string().optional().describe('Counter name (required if key not provided)'),
        key: z.string().optional().describe('Direct Redis key (overrides name/scope)'),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
        delta: z.number().default(1).describe('Amount to increment by'),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.increment(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error incrementing counter: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // counter.get - Get current counter value and metadata
    this.registerTool(
      'counter.get',
      'Get current counter value and metadata',
      z.object({
        name: z.string().optional(),
        key: z.string().optional(),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.get(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error getting counter: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // counter.delete - Delete counter
    this.registerTool(
      'counter.delete',
      'Delete a counter (removes from both Redis and DocumentStore)',
      z.object({
        name: z.string().optional(),
        key: z.string().optional(),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.delete(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error deleting counter: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // counter.list - List counters by scope
    this.registerTool(
      'counter.list',
      'List counters filtered by scope (excludes expired counters by default)',
      z.object({
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
        includeExpired: z.boolean().default(false).describe('Include expired counters'),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available' }],
            isError: true,
          };
        }

        try {
          const counters = await manager.list(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(counters, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error listing counters: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // counter.snapshot - Take snapshot of counter value
    this.registerTool(
      'counter.snapshot',
      'Take a snapshot of counter value for historical tracking',
      z.object({
        name: z.string().optional(),
        key: z.string().optional(),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
        trigger: z.enum(['periodic', 'manual', 'expiration', 'stream_end']).default('manual'),
      }),
      async (args) => {
        const manager = this.ensureCounterManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Counter manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.snapshot(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error creating snapshot: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    this.getLogger().info('utility.counter_tools.registered', {
      tools: [
        'counter.create',
        'counter.increment',
        'counter.get',
        'counter.delete',
        'counter.list',
        'counter.snapshot',
      ],
    });
  }

  /**
   * Register bidding MCP tools
   * Phase 2 implementation - 8 tools for bidding session management
   */
  private registerBidTools(): void {
    // bid.create - Create new bidding session
    this.registerTool(
      'bid.create',
      'Create a new bidding session with optional target value and TTL',
      z.object({
        name: z.string().min(1).max(64).describe('Session name (e.g., "boss_hp_guess")'),
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional()
          .describe('Scope type (default: auto-infer from event)'),
        scopeValue: z.string().optional()
          .describe('Scope value (default: auto-infer from event)'),
        targetValue: z.number().optional()
          .describe('Target value for "closest" queries'),
        ttlSeconds: z.number().positive().optional()
          .describe('Time-to-live in seconds (omit for manual close only)'),
        metadata: z.record(z.string(), z.any()).optional()
          .describe('Optional metadata (description, rules, prize, etc.)'),
        createdBy: z.string().optional().describe('Creator identifier'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available (resources not ready)' }],
            isError: true,
          };
        }

        try {
          const result = await manager.create(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error creating bid session: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.submit - Submit or update user bid
    this.registerTool(
      'bid.submit',
      'Submit or update a user bid in an active session',
      z.object({
        session: z.string().describe('Session ID or name'),
        user: z.string().describe('User ID'),
        userName: z.string().optional().describe('Display name'),
        value: z.number().describe('Bid value'),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.submit(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error submitting bid: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.getMax - Get highest bid
    this.registerTool(
      'bid.getMax',
      'Get the highest bid in a session',
      z.object({
        session: z.string().describe('Session ID or name'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.getMax(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error getting max bid: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.getMin - Get lowest bid
    this.registerTool(
      'bid.getMin',
      'Get the lowest bid in a session',
      z.object({
        session: z.string().describe('Session ID or name'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.getMin(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error getting min bid: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.getClosest - Get bid closest to target
    this.registerTool(
      'bid.getClosest',
      'Get the bid closest to the target value',
      z.object({
        session: z.string().describe('Session ID or name'),
        target: z.number().optional().describe('Override session target value'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.getClosest(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error getting closest bid: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.close - Close session and snapshot results
    this.registerTool(
      'bid.close',
      'Close a bid session and snapshot results to DocumentStore',
      z.object({
        session: z.string().describe('Session ID or name'),
        computeWinner: z.boolean().default(true).describe('Compute winner based on target value'),
        deleteRedisHash: z.boolean().default(false).describe('Delete Redis hash after close'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.close(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error closing bid session: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.list - List bid sessions
    this.registerTool(
      'bid.list',
      'List bid sessions by scope and status',
      z.object({
        scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
        scopeValue: z.string().optional(),
        status: z.enum(['active', 'closed', 'expired']).optional(),
        limit: z.number().positive().default(50).describe('Maximum results to return'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.list(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error listing bid sessions: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // bid.results - Query historical results
    this.registerTool(
      'bid.results',
      'Query historical bid results for analytics',
      z.object({
        sessionId: z.string().optional().describe('Filter by session ID'),
        scopeType: z.string().optional().describe('Filter by scope type'),
        scopeValue: z.string().optional().describe('Filter by scope value'),
        limit: z.number().positive().default(50).describe('Maximum results to return'),
        orderBy: z.enum(['closedAt', 'totalEntries']).default('closedAt')
          .describe('Sort results by field'),
      }),
      async (args) => {
        const manager = this.ensureBidManager();
        if (!manager) {
          return {
            content: [{ type: 'text', text: 'Bid manager not available' }],
            isError: true,
          };
        }

        try {
          const result = await manager.getResults(args as any);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error querying bid results: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    this.getLogger().info('utility.bid_tools.registered', {
      tools: [
        'bid.create',
        'bid.submit',
        'bid.getMax',
        'bid.getMin',
        'bid.getClosest',
        'bid.close',
        'bid.list',
        'bid.results',
      ],
    });
  }

  /**
   * Health check for utility service
   * Verifies DocumentStore and Redis connectivity
   */
  public async healthCheck(): Promise<{
    healthy: boolean;
    details: {
      documentStore: boolean;
      redis: boolean;
    };
  }> {
    const details = {
      documentStore: false,
      redis: false,
    };

    try {
      // Check DocumentStore
      if (this.docStore) {
        const docStoreHealth = await this.docStore.health();
        details.documentStore = docStoreHealth.healthy;
      }

      // Check Redis
      if (this.redis && this.redis.isReady) {
        const pong = await this.redis.ping();
        details.redis = pong === 'PONG';
      }

      const healthy = details.documentStore && details.redis;

      this.getLogger().debug('utility.health_check', {
        healthy,
        details,
      });

      return { healthy, details };
    } catch (error: any) {
      this.getLogger().error('utility.health_check.error', {
        error: error.message,
      });
      return { healthy: false, details };
    }
  }

  /**
   * Graceful shutdown
   */
  public async close(reason: string = 'manual'): Promise<void> {
    this.getLogger().info('utility.close', { reason });
    await super.close(reason);
  }
}

/**
 * Entry point when run directly
 */
if (require.main === module) {
  const server = new UtilityService();
  const port = parseInt(process.env.PORT || '3020', 10);

  server.start(port).catch((err) => {
    console.error('Failed to start utility-service:', err);
    process.exit(1);
  });
}
