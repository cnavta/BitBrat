import { Bit } from '../common/base-server';
import { RxJSWindowManager } from '../services/event-stream-analyzer/rxjs-window-manager';
import type { StreamObserver } from '../types/sessi';
import type { InternalEventV2 } from '../types/events';
import { z } from 'zod';

/**
 * EventStreamAnalyzerServer
 * Real-time event stream analysis using RxJS sliding windows.
 * Phase 1 POC implementation with minimal features.
 *
 * Profile: core (Phase 1 stub analysis; will upgrade to 'llm' in Phase 2)
 * MCP Exposure: platform-only
 * Kind: pipeline-service
 */
export class EventStreamAnalyzerServer extends Bit {
  private windowManager!: RxJSWindowManager;
  private observers: Map<string, StreamObserver> = new Map();

  constructor() {
    super({ mcpExposure: 'platform-only' });
  }

  async setup(): Promise<void> {
    this.windowManager = new RxJSWindowManager(this.getLogger());

    // Subscribe to internal.contextualization.v1 as passive observer
    await this.subscribeToEventStream();

    this.getLogger().info('event-stream-analyzer.setup.complete', {
      service: this.serviceName,
      subscriptionCount: this.windowManager.getSubscriptionCount()
    });

    // Register MCP tools
    this.registerObserverTools();
  }

  /**
   * Subscribe to internal.contextualization.v1 as passive observer.
   * Does NOT advance routing slip - just observes and feeds events to windows.
   */
  private async subscribeToEventStream(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.contextualization.v1',
      async (event, attrs, ctx) => {
        this.getLogger().debug('event.received', {
          correlationId: event.correlationId,
          type: event.type,
          platform: event.ingress?.source,
          hasMessage: !!event.message
        });

        // Feed event to window manager (will route to matching observers)
        this.windowManager.addEvent(event);

        // CRITICAL: ACK without calling next() - passive observation only
        await ctx.ack();
      }
    );

    this.getLogger().info('event-stream.subscribed', {
      topic: 'internal.contextualization.v1',
      mode: 'passive'
    });
  }

  async shutdown(): Promise<void> {
    this.getLogger().info('event-stream-analyzer.shutdown.start');

    // Cleanup all windows
    this.windowManager.destroy();

    this.getLogger().info('event-stream-analyzer.shutdown.complete');
  }

  /**
   * Register MCP tools for observer management
   */
  private registerObserverTools(): void {
    const ok = (data: any) => ({
      content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    });

    // Create observer
    this.registerTool(
      'event_stream_analyzer.observer.create',
      'Create a new stream observer with sliding window configuration',
      z.object({
        id: z.string().describe('Unique observer ID'),
        windowSizeMs: z.number().optional().describe('Window size in milliseconds (default: 300000 = 5 min)'),
        slideMs: z.number().optional().describe('Slide interval in milliseconds (default: 60000 = 1 min)'),
        platforms: z.array(z.string()).optional().describe('Filter by platforms (e.g., ["twitch", "discord"])'),
        eventTypes: z.array(z.string()).optional().describe('Filter by event types'),
        promptId: z.string().describe('Prompt ID for LLM analysis'),
        egressTopic: z.string().describe('Topic for publishing results')
      }),
      async (params) => {
        const observer: StreamObserver = {
          id: params.id,
          active: true,
          mcpEnabled: true,
          source: {
            mode: 'stream',
            topics: ['internal.contextualization.v1'],
            filters: {
              platforms: params.platforms,
              eventTypes: params.eventTypes
            }
          },
          window: {
            type: 'sliding',
            sizeMs: params.windowSizeMs || 300000,
            slideMs: params.slideMs || 60000
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        this.observers.set(observer.id, observer);

        // Create sliding window subscription
        this.windowManager.createSlidingWindow(observer, async (events, observerId) => {
          await this.handleWindowClose(events, observerId);
        });

        this.getLogger().info('observer.created', {
          observerId: observer.id,
          windowSizeMs: observer.window?.sizeMs,
          slideMs: observer.window?.slideMs
        });

        return ok({
          success: true,
          observerId: observer.id,
          config: observer
        });
      }
    );

    // List observers
    this.registerTool(
      'event_stream_analyzer.observer.list',
      'List all active stream observers',
      z.object({}),
      async () => {
        const observers = Array.from(this.observers.values()).map(o => ({
          id: o.id,
          active: o.active,
          windowSizeMs: o.window?.sizeMs,
          slideMs: o.window?.slideMs,
          platforms: o.source?.filters?.platforms,
          createdAt: o.createdAt
        }));

        return ok({
          count: observers.length,
          observers
        });
      }
    );

    // Remove observer
    this.registerTool(
      'event_stream_analyzer.observer.remove',
      'Remove a stream observer and cleanup its subscription',
      z.object({
        observerId: z.string().describe('Observer ID to remove')
      }),
      async (params) => {
        const observer = this.observers.get(params.observerId);

        if (!observer) {
          throw new Error(`Observer not found: ${params.observerId}`);
        }

        this.windowManager.removeObserver(params.observerId);
        this.observers.delete(params.observerId);

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
        const observer = this.observers.get(params.observerId);

        if (!observer) {
          throw new Error(`Observer not found: ${params.observerId}`);
        }

        return ok({
          observer,
          subscriptionCount: this.windowManager.getSubscriptionCount()
        });
      }
    );
  }

  /**
   * Handle window closure - called by RxJSWindowManager
   * Phase 1 POC: Minimal implementation with stub analysis
   */
  private async handleWindowClose(events: InternalEventV2[], observerId: string): Promise<void> {
    try {
      this.getLogger().info('window.closed.analyzing', {
        observerId,
        eventCount: events.length
      });

      const observer = this.observers.get(observerId);
      if (!observer) {
        this.getLogger().warn('window.closed.observer_not_found', { observerId });
        return;
      }

      // Phase 1 POC: Stub analysis (formatted event summary)
      // TODO: Replace with StreamAnalystEngine.summarize() integration
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
   * Generate stub summary for Phase 1 POC
   * TODO: Replace with LLM-powered analysis
   */
  private generateStubSummary(events: InternalEventV2[], observer: StreamObserver): string {
    const platforms = new Set(events.map(e => e.ingress?.source).filter(Boolean));
    const messageCount = events.filter(e => e.message).length;
    const eventTypes = new Set(events.map(e => e.type));

    return `# Stream Analysis Report

**Observer:** ${observer.id}
**Window:** ${new Date().toISOString()}
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
*Generated by event-stream-analyzer (Phase 1 POC)*
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
