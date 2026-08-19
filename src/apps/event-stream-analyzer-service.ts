import { Bit } from '../common/base-server';
import { RxJSWindowManager } from '../services/event-stream-analyzer/rxjs-window-manager';
import { ObserverRepository } from '../services/event-stream-analyzer/observer-repository';
import { SubscriptionManager } from '../services/event-stream-analyzer/subscription-manager';
import type { StreamObserver } from '../types/sessi';
import type { InternalEventV2 } from '../types/events';
import type { IDocumentStore } from '../common/persistence/interfaces';
import { z } from 'zod';

/**
 * EventStreamAnalyzerServer
 * Real-time event stream analysis with multi-observer support and database persistence.
 * Phase 2: Multi-observer, window types (sliding/tumbling/session), PostgreSQL persistence
 *
 * Profile: core (Phase 2 stub analysis; will upgrade to 'llm' in Phase 3 for real LLM analysis)
 * MCP Exposure: platform-only
 * Kind: pipeline-service
 */
export class EventStreamAnalyzerServer extends Bit {
  private windowManager!: RxJSWindowManager;
  private observerRepository!: ObserverRepository;
  private subscriptionManager!: SubscriptionManager;

  constructor() {
    super({ mcpExposure: 'platform-only' });

    // Register setup to run on startup (before HTTP server starts listening)
    this.onStartup(async () => {
      await this.setup();
    });
  }

  private async setup(): Promise<void> {
    // Initialize managers
    this.windowManager = new RxJSWindowManager(this.getLogger());
    this.subscriptionManager = new SubscriptionManager(this.getLogger());

    // Initialize observer repository with document store
    const documentStore = this.getResource('documentStore') as IDocumentStore;
    this.observerRepository = new ObserverRepository(documentStore, this.getLogger());

    // Load observers from database and create windows
    await this.loadObserversFromDatabase();

    this.getLogger().info('event-stream-analyzer.setup.complete', {
      service: this.serviceName,
      activeObservers: await this.observerRepository.getActiveCount(),
      subscriptionCount: this.windowManager.getSubscriptionCount(),
      activeTopics: this.subscriptionManager.getActiveTopics()
    });

    // Register MCP tools
    this.registerObserverTools();
  }

  /**
   * Load all active observers from database and create their windows
   * Phase 2: Database-driven observer lifecycle
   */
  private async loadObserversFromDatabase(): Promise<void> {
    this.getLogger().info('event-stream-analyzer.load_observers.start');

    try {
      const observers = await this.observerRepository.list({ active: true });

      this.getLogger().info('event-stream-analyzer.load_observers.found', {
        count: observers.length
      });

      if (observers.length === 0) {
        this.getLogger().info('event-stream-analyzer.load_observers.empty');
        return;
      }

      // Create windows and subscriptions for each observer
      for (const observer of observers) {
        await this.createObserverWindow(observer);
      }

      this.getLogger().info('event-stream-analyzer.load_observers.complete', {
        observerCount: observers.length,
        subscriptionCount: this.subscriptionManager.getSubscriptionCount()
      });
    } catch (error: any) {
      this.getLogger().error('event-stream-analyzer.load_observers.error', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Create window and subscription for an observer
   */
  private async createObserverWindow(observer: StreamObserver): Promise<void> {
    this.getLogger().info('event-stream-analyzer.create_observer_window', {
      observerId: observer.id,
      windowType: observer.window?.type,
      topics: observer.source?.topics
    });

    // Create window in WindowManager
    this.windowManager.createWindow(observer, async (events, observerId) => {
      await this.handleWindowClose(events, observerId);
    });

    // Add topic subscriptions via SubscriptionManager
    const topics = observer.source?.topics || ['internal.contextualization.v1'];
    for (const topic of topics) {
      await this.subscriptionManager.addTopic(topic, async () => {
        return await this.subscribeToTopic(topic);
      });
    }
  }

  /**
   * Subscribe to a NATS topic and route events to WindowManager
   */
  private async subscribeToTopic(topic: string): Promise<() => Promise<void>> {
    this.getLogger().info('event-stream-analyzer.subscribe_topic', { topic });

    await this.onMessage<InternalEventV2>(
      topic,
      async (event, attrs, ctx) => {
        this.getLogger().debug('event.received', {
          correlationId: event.correlationId,
          type: event.type,
          platform: event.ingress?.source,
          topic,
          hasMessage: !!event.message
        });

        // Feed event to window manager (will route to matching observers)
        this.windowManager.addEvent(event);

        // CRITICAL: ACK without calling next() - passive observation only
        await ctx.ack();
      }
    );

    // Return unsubscribe function (for now, no-op as onMessage doesn't expose unsubscribe)
    // TODO: Future enhancement - expose unsubscribe from base-server.ts
    return async () => {
      this.getLogger().debug('event-stream-analyzer.unsubscribe_topic', { topic });
    };
  }

  async shutdown(): Promise<void> {
    this.getLogger().info('event-stream-analyzer.shutdown.start');

    // Cleanup all windows (if initialized)
    if (this.windowManager) {
      this.windowManager.destroy();
    }

    // Cleanup all subscriptions (if initialized)
    if (this.subscriptionManager) {
      await this.subscriptionManager.destroy();
    }

    this.getLogger().info('event-stream-analyzer.shutdown.complete');
  }

  /**
   * Register MCP tools for observer management
   * Phase 2: Full CRUD operations with database persistence
   */
  private registerObserverTools(): void {
    const ok = (data: any) => ({
      content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    });

    // Create observer (P2-004)
    this.registerTool(
      'event_stream_analyzer.observer.create',
      'Create a new stream observer with database persistence',
      z.object({
        id: z.string().describe('Unique observer ID'),
        windowType: z.enum(['sliding', 'tumbling', 'session']).optional().describe('Window type (default: sliding)'),
        windowSizeMs: z.number().optional().describe('Window size in milliseconds (default: 300000 = 5 min)'),
        slideMs: z.number().optional().describe('Slide interval for sliding windows (default: 60000 = 1 min)'),
        sessionGapMs: z.number().optional().describe('Inactivity gap for session windows (default: 60000 = 1 min)'),
        platforms: z.array(z.string()).optional().describe('Filter by platforms (e.g., ["twitch", "discord"])'),
        eventTypes: z.array(z.string()).optional().describe('Filter by event types'),
        topics: z.array(z.string()).optional().describe('NATS topics to subscribe to (default: ["internal.contextualization.v1"])'),
        promptId: z.string().describe('Prompt ID for LLM analysis'),
        egressTopic: z.string().describe('Topic for publishing results')
      }),
      async (params) => {
        const windowType = params.windowType || 'sliding';

        const observer: StreamObserver = {
          id: params.id,
          active: true,
          mcpEnabled: true,
          source: {
            mode: 'stream',
            topics: params.topics || ['internal.contextualization.v1'],
            filters: {
              platforms: params.platforms,
              eventTypes: params.eventTypes
            }
          },
          window: {
            type: windowType,
            sizeMs: params.windowSizeMs || 300000,
            ...(windowType === 'sliding' && { slideMs: params.slideMs || 60000 }),
            ...(windowType === 'session' && { sessionGapMs: params.sessionGapMs || 60000 })
          },
          trigger: {
            type: 'time'
          },
          analysis: {
            promptId: params.promptId,
            inspectionEnabled: false,
            outputFormat: 'markdown'
          },
          delivery: {
            egressTopic: params.egressTopic
          },
          updatedAt: new Date().toISOString()
        };

        // Persist to database
        const created = await this.observerRepository.create(observer);

        // Create window and subscription
        await this.createObserverWindow(created);

        this.getLogger().info('observer.created', {
          observerId: created.id,
          windowType: created.window?.type,
          topics: created.source?.topics
        });

        return ok({
          success: true,
          observerId: created.id,
          config: created
        });
      }
    );

    // List observers (P2-005)
    this.registerTool(
      'event_stream_analyzer.observer.list',
      'List all stream observers with optional filtering',
      z.object({
        active: z.boolean().optional().describe('Filter by active status')
      }),
      async (params) => {
        const observers = await this.observerRepository.list(params.active !== undefined ? { active: params.active } : undefined);

        const summary = observers.map(o => ({
          id: o.id,
          active: o.active,
          windowType: o.window?.type,
          windowSizeMs: o.window?.sizeMs,
          platforms: o.source?.filters?.platforms,
          topics: o.source?.topics,
          createdAt: o.createdAt
        }));

        return ok({
          count: observers.length,
          observers: summary
        });
      }
    );

    // Update observer (P2-006)
    this.registerTool(
      'event_stream_analyzer.observer.update',
      'Update an existing observer configuration',
      z.object({
        observerId: z.string().describe('Observer ID to update'),
        active: z.boolean().optional().describe('Enable/disable observer'),
        windowType: z.enum(['sliding', 'tumbling', 'session']).optional().describe('Window type'),
        windowSizeMs: z.number().optional().describe('Window size in milliseconds'),
        slideMs: z.number().optional().describe('Slide interval for sliding windows'),
        sessionGapMs: z.number().optional().describe('Inactivity gap for session windows'),
        platforms: z.array(z.string()).optional().describe('Filter by platforms'),
        eventTypes: z.array(z.string()).optional().describe('Filter by event types')
      }),
      async (params) => {
        const existing = await this.observerRepository.get(params.observerId);
        if (!existing) {
          throw new Error(`Observer not found: ${params.observerId}`);
        }

        // Build partial update
        const changes: Partial<StreamObserver> = {};

        if (params.active !== undefined) {
          changes.active = params.active;
        }

        if (params.windowType || params.windowSizeMs || params.slideMs || params.sessionGapMs) {
          const windowType = params.windowType || existing.window?.type || 'sliding';
          changes.window = {
            type: windowType,
            sizeMs: params.windowSizeMs || existing.window?.sizeMs || 300000,
            ...(windowType === 'sliding' && { slideMs: params.slideMs || existing.window?.slideMs || 60000 }),
            ...(windowType === 'session' && { sessionGapMs: params.sessionGapMs || existing.window?.sessionGapMs || 60000 })
          };
        }

        if (params.platforms || params.eventTypes) {
          changes.source = {
            ...existing.source!,
            filters: {
              ...existing.source?.filters,
              ...(params.platforms && { platforms: params.platforms }),
              ...(params.eventTypes && { eventTypes: params.eventTypes })
            }
          };
        }

        // Update in database
        await this.observerRepository.update(params.observerId, changes);

        // Recreate window if configuration changed
        if (changes.window || changes.source) {
          // Remove old window
          this.windowManager.removeObserver(params.observerId);

          // Get updated observer
          const updated = await this.observerRepository.get(params.observerId);
          if (updated && updated.active) {
            // Create new window
            await this.createObserverWindow(updated);
          }
        }

        this.getLogger().info('observer.updated', {
          observerId: params.observerId,
          changes: Object.keys(changes)
        });

        return ok({
          success: true,
          observerId: params.observerId
        });
      }
    );

    // Delete observer (P2-007)
    this.registerTool(
      'event_stream_analyzer.observer.remove',
      'Remove a stream observer and cleanup its resources',
      z.object({
        observerId: z.string().describe('Observer ID to remove')
      }),
      async (params) => {
        const observer = await this.observerRepository.get(params.observerId);
        if (!observer) {
          throw new Error(`Observer not found: ${params.observerId}`);
        }

        // Remove window
        this.windowManager.removeObserver(params.observerId);

        // Remove topic subscriptions
        const topics = observer.source?.topics || [];
        for (const topic of topics) {
          await this.subscriptionManager.removeTopic(topic);
        }

        // Delete from database
        await this.observerRepository.delete(params.observerId);

        this.getLogger().info('observer.removed', {
          observerId: params.observerId
        });

        return ok({
          success: true,
          observerId: params.observerId
        });
      }
    );

    // Get observer status
    this.registerTool(
      'event_stream_analyzer.observer.status',
      'Get detailed status of a stream observer',
      z.object({
        observerId: z.string().describe('Observer ID')
      }),
      async (params) => {
        const observer = await this.observerRepository.get(params.observerId);
        if (!observer) {
          throw new Error(`Observer not found: ${params.observerId}`);
        }

        return ok({
          observer,
          subscriptionCount: this.windowManager.getSubscriptionCount(),
          subscriptionManager: this.subscriptionManager.getStats()
        });
      }
    );
  }

  /**
   * Handle window closure - called by RxJSWindowManager
   * Phase 2: Stub analysis (same as Phase 1)
   * TODO Phase 3: Replace with StreamAnalystEngine.summarize() integration
   */
  private async handleWindowClose(events: InternalEventV2[], observerId: string): Promise<void> {
    try {
      this.getLogger().info('window.closed.analyzing', {
        observerId,
        eventCount: events.length
      });

      const observer = await this.observerRepository.get(observerId);
      if (!observer) {
        this.getLogger().warn('window.closed.observer_not_found', { observerId });
        return;
      }

      // Phase 2: Stub analysis (formatted event summary)
      // TODO: Replace with StreamAnalystEngine.summarize() integration in Phase 3
      const summary = this.generateStubSummary(events, observer);

      // Publish to internal.summarization.report.v1 (audit trail)
      await this.publishSummaryReport(summary, observerId);

      // Publish to internal.egress.v1 (user delivery)
      if (observer.delivery.egressTopic) {
        await this.publishToEgress(summary, observer);
      }

      this.getLogger().info('window.closed.complete', {
        observerId,
        eventCount: events.length,
        summaryLength: summary.length
      });
    } catch (error: any) {
      this.getLogger().error('window.closed.error', {
        observerId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Generate stub summary for Phase 2
   * TODO: Replace with LLM-powered analysis
   */
  private generateStubSummary(events: InternalEventV2[], observer: StreamObserver): string {
    const platforms = new Set(events.map(e => e.ingress?.source).filter(Boolean));
    const messageCount = events.filter(e => e.message).length;
    const eventTypes = new Set(events.map(e => e.type));

    return `# Stream Analysis Report

**Observer:** ${observer.id}
**Window Type:** ${observer.window?.type || 'sliding'}
**Timestamp:** ${new Date().toISOString()}
**Event Count:** ${events.length}

## Summary
- **Platforms:** ${Array.from(platforms).join(', ') || 'none'}
- **Message Events:** ${messageCount}
- **Event Types:** ${Array.from(eventTypes).join(', ')}

## Sample Events
${events.slice(0, 5).map(e =>
  `- [${e.type}] ${e.message?.text?.substring(0, 100) || 'No message'}`
).join('\n')}

${events.length > 5 ? `\n... and ${events.length - 5} more events` : ''}

---
*Generated by event-stream-analyzer (Phase 2)*
`;
  }

  /**
   * Publish summary to internal.summarization.report.v1 (audit trail)
   */
  private async publishSummaryReport(summary: string, observerId: string): Promise<void> {
    const reportEvent: InternalEventV2 = {
      v: '2',
      correlationId: `summary-${observerId}-${Date.now()}`,
      type: 'system.summarization.report.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'event-stream-analyzer',
        connector: 'system'
      },
      identity: {
        external: {
          id: 'system',
          platform: 'bitbrat'
        }
      },
      egress: {
        destination: 'internal',
        connector: 'system'
      },
      payload: {
        observerId,
        summary,
        eventCount: summary.split('\n').length,
        generatedAt: new Date().toISOString()
      },
      routing: {
        stage: 'response',
        slip: [{
          id: 'event-stream-analyzer',
          status: 'OK',
          nextTopic: 'internal.summarization.report.v1'
        }],
        history: []
      }
    };

    // Use next() to publish the event to the message bus
    await this.next(reportEvent);

    this.getLogger().info('summary.published', {
      topic: 'internal.summarization.report.v1',
      observerId,
      correlationId: reportEvent.correlationId
    });
  }

  /**
   * Publish summary to internal.egress.v1 (user delivery)
   */
  private async publishToEgress(summary: string, observer: StreamObserver): Promise<void> {
    const destType = observer.delivery.destination?.type as 'chat' | 'dm' | 'event' | undefined;

    const egressEvent: InternalEventV2 = {
      v: '2',
      correlationId: `egress-${observer.id}-${Date.now()}`,
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'event-stream-analyzer',
        connector: 'system'
      },
      identity: {
        external: {
          id: 'system',
          platform: 'bitbrat'
        }
      },
      egress: {
        destination: observer.delivery.destination?.target || 'default',
        type: destType || 'chat',
        connector: 'system'
      },
      message: {
        id: `summary-${Date.now()}`,
        role: 'assistant',
        text: summary
      },
      routing: {
        stage: 'response',
        slip: [{
          id: 'event-stream-analyzer',
          status: 'OK',
          nextTopic: observer.delivery.egressTopic
        }],
        history: []
      }
    };

    // Use next() to publish the event to the message bus
    await this.next(egressEvent);

    this.getLogger().info('summary.egress.published', {
      topic: observer.delivery.egressTopic,
      observerId: observer.id,
      correlationId: egressEvent.correlationId
    });
  }

  public async close(reason: string = 'manual'): Promise<void> {
    await this.shutdown();
    await super.close(reason);
  }
}

if (require.main === module) {
  const server = new EventStreamAnalyzerServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  server.start(port).catch((err) => {
    console.error('Failed to start event-stream-analyzer:', err);
    process.exit(1);
  });
}
