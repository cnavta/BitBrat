import { Bit } from '../common/base-server';
import type { IDocumentStore } from '../common/persistence/interfaces';
import type { RedisClientType } from 'redis';
import type { InternalEventV2 } from '../types';
import { ScopeResolver } from '../services/utility/scope-resolver';
import { CounterManager } from '../services/utility/counter-manager';
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
  private bidManager?: any; // Will be BidManager (Phase 2)
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
    // TODO: Implement bid tools (Phase 2)
    // Will register:
    // - bid.session.create
    // - bid.submit
    // - bid.session.close
    // - bid.get.max
    // - bid.get.min
    // - bid.get.closest
    // - bid.session.list
    // - bid.results

    this.getLogger().info('utility.bid_tools.placeholder', {
      message: 'Bid tools will be registered in Phase 2',
    });

    // Placeholder - tools will be registered in Phase 2
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
