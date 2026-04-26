import { McpServer } from '../common/mcp-server';
import { Express, Request, Response } from 'express';
import { StreamAnalystEngine } from '../services/stream-analyst/engine';
import type { SummarizationRequest, StreamObserver } from '../types/sessi';
import type { Egress } from '../types/events';
import { createMessagePublisher } from '../services/message-bus';
import { z } from 'zod';
import { BaseServerOptions } from '../common/base-server';
import parser from 'cron-parser';

/**
 * Stream Analyst Service
 * Orchestrates event stream summarization and inspection.
 * Triggers:
 * - Pub/Sub: internal.summarization.request.v1
 * - HTTP: POST /summarize (used by tool-gateway)
 */
export class StreamAnalystServer extends McpServer {
  private engineInstance?: StreamAnalystEngine;

  constructor(opts: BaseServerOptions = {}) {
    super({ 
      ...opts,
      serviceName: 'stream-analyst' 
    });
    // BaseServer automatically registers health checks and middleware
    this.setupRoutes(this.getApp());
    this.setupMcpTools();
  }

  protected static CONFIG_DEFAULTS: Record<string, any> = {
    SERVICE_NAME: 'stream-analyst',
    PORT: 3010,
    LLM_MODEL: 'gpt-4o'
  };

  /**
   * Lazy-loaded engine to ensure Firestore is ready.
   */
  private get engine(): StreamAnalystEngine {
    if (!this.engineInstance) {
      const firestore = this.getResource<any>('firestore');
      if (!firestore) {
        throw new Error('Firestore resource not available. Ensure SERVICE_NAME is correct and Firestore is enabled.');
      }
      this.engineInstance = new StreamAnalystEngine(firestore, this.getLogger());
    }
    return this.engineInstance;
  }

  async start(port: number) {
    // Wait for internal resource initialization (BaseServer.start calls this too, but we need it for subscriptions)
    await this.setupSubscriptions();
    return super.start(port);
  }

  private async setupSubscriptions() {
    this.getLogger().info('stream-analyst.subscriptions.setup');

    // Listen for system.timer.v1 to trigger observer polling
    await this.onMessage(
      {
        destination: 'system.timer.v1',
        queue: 'stream-analyst-poller',
        ack: 'explicit'
      },
      async (_data, _attributes, ctx) => {
        try {
          this.getLogger().debug('stream-analyst.poller.triggered', { 
            subject: 'system.timer.v1',
            at: new Date().toISOString()
          });
          await this.pollObservers();
          await ctx.ack();
        } catch (e: any) {
          this.getLogger().error('stream-analyst.poller.failed', { error: e.message });
          await ctx.ack(); // Avoid loops
        }
      }
    );

    // Listen for summarization requests via Pub/Sub
    await this.onMessage<SummarizationRequest>(
      { 
        destination: 'internal.summarization.request.v1', 
        queue: 'stream-analyst', 
        ack: 'explicit' 
      },
      async (data, _attributes, ctx) => {
        const req = data as SummarizationRequest;
        try {
          this.getLogger().debug('stream-analyst.request.received', { 
            requestId: req.requestId,
            observerId: req.observerId,
            streamType: req.streamType,
            filters: req.filters
          });

          const summary = await this.engine.summarize(req);
          
          this.getLogger().debug('stream-analyst.summary.generated', { 
            requestId: req.requestId,
            summaryLength: summary.length
          });

          // Publish report
          const pub = createMessagePublisher('internal.summarization.report.v1');
          await pub.publishJson({
            requestId: req.requestId,
            observerId: req.observerId,
            summary,
            at: new Date().toISOString()
          }, { 
            correlationId: req.requestId,
            type: 'internal.summarization.report.v1'
          });

          // BL-003: Complete Egress Path Integration
          if (req.observerId) {
            await this.handleEgress(req.observerId, req.requestId, summary);
          }
          
          await ctx.ack();
        } catch (e: any) {
          this.getLogger().error('stream-analyst.request.failed', { 
            error: e.message, 
            requestId: req.requestId 
          });
          // We ack even on failure to avoid poison pill loops in this specific case,
          // as summarization is often a non-critical side-effect or on-demand request.
          await ctx.ack();
        }
      }
    );
  }

  private async pollObservers() {
    this.getLogger().debug('stream-analyst.poll_observers.start');
    const firestore = this.getResource<any>('firestore');
    const snapshot = await firestore.collection('stream_observers')
      .where('active', '==', true)
      .get();

    const observers = snapshot.docs.map((doc: any) => ({ 
      id: doc.id, 
      ...doc.data() 
    })) as StreamObserver[];

    this.getLogger().debug('stream-analyst.poll_observers.active_count', { count: observers.length });

    const now = new Date();
    const pub = createMessagePublisher('internal.summarization.request.v1');

    for (const observer of observers) {
      if (observer.trigger.type === 'cron' && observer.trigger.expression) {
        try {
          const interval = parser.parseExpression(observer.trigger.expression, {
            currentDate: new Date(now.getTime() - 60000) // Look back 1 minute
          });
          const next = interval.next().toDate();
          
          this.getLogger().debug('stream-analyst.observer.check_trigger', { 
            observerId: observer.id, 
            cron: observer.trigger.expression,
            nextRun: next.toISOString(),
            now: now.toISOString()
          });

          // If the next execution time is between (now - 1m) and now, it's time to run.
          if (next <= now) {
            this.getLogger().info('stream-analyst.observer.triggered', { 
              observerId: observer.id, 
              cron: observer.trigger.expression 
            });

            await pub.publishJson({
              requestId: `auto-${observer.id}-${Date.now()}`,
              observerId: observer.id,
              streamType: observer.source.filters.streamType || 'chat',
              windowMinutes: observer.trigger.windowMs ? Math.floor(observer.trigger.windowMs / 60000) : 10,
              filters: observer.source.filters,
              inspectionEnabled: observer.analysis.inspectionEnabled,
            } as SummarizationRequest, {
              type: 'internal.summarization.request.v1',
              observerId: observer.id,
              correlationId: `auto-${observer.id}-${Date.now()}`
            });
          }
        } catch (e: any) {
          this.getLogger().error('stream-analyst.cron.parse.error', { 
            observerId: observer.id, 
            error: e.message 
          });
        }
      }
    }
  }

  private async handleEgress(observerId: string, requestId: string, summary: string) {
    this.getLogger().debug('stream-analyst.egress.start', { observerId, requestId });
    try {
      const firestore = this.getResource<any>('firestore');
      const doc = await firestore.collection('stream_observers').doc(observerId).get();
      if (!doc.exists) {
        this.getLogger().debug('stream-analyst.egress.no_observer', { observerId });
        return;
      }

      const observer = doc.data() as StreamObserver;
      if (!observer.delivery || !observer.delivery.egressTopic) {
        this.getLogger().debug('stream-analyst.egress.no_delivery_config', { observerId });
        return;
      }

      const pub = createMessagePublisher(observer.delivery.egressTopic);
      
      const egress: Egress = {
        destination: observer.delivery.destination?.target || 'unknown',
        connector: (observer.delivery.destination?.type as any) || 'system',
        type: 'chat'
      };

      // If summary is JSON (from inspection), parse it to get only the summary text for egress
      let textToDeliver = summary;
      try {
        const parsed = JSON.parse(summary);
        if (parsed.summary) textToDeliver = parsed.summary;
      } catch {
        // Not JSON, use as is
      }

      this.getLogger().debug('stream-analyst.egress.publishing', { 
        topic: observer.delivery.egressTopic, 
        destination: egress.destination,
        connector: egress.connector
      });

      await pub.publishJson({
        requestId,
        egress,
        message: {
          id: `report-${Date.now()}`,
          role: 'assistant',
          text: textToDeliver,
          at: new Date().toISOString()
        }
      }, {
        correlationId: requestId,
        type: 'internal.egress.v1'
      });

      this.getLogger().info('stream-analyst.egress.published', { 
        observerId, 
        topic: observer.delivery.egressTopic 
      });
    } catch (e: any) {
      this.getLogger().error('stream-analyst.egress.failed', { 
        observerId, 
        error: e.message 
      });
    }
  }

  private setupRoutes(app: Express) {
    app.post('/summarize', async (req: Request, res: Response) => {
      try {
        const summary = await this.engine.summarize(req.body);
        res.json({ summary });
      } catch (e: any) {
        this.getLogger().error('stream-analyst.http.error', { error: e.message });
        res.status(500).json({ error: e.message });
      }
    });
  }

  private setupMcpTools() {
    this.registerTool(
      'summarize_stream',
      'Summarize a specific event stream window (e.g. chat, logs, errors).',
      z.object({
        observer_id: z.string().optional().describe('ID of a StreamObserver to use for configuration'),
        stream_type: z.string().optional().describe('The type of stream to summarize (e.g., "chat", "logs", "errors")'),
        window_minutes: z.number().optional().default(10).describe('Window size in minutes'),
        filters: z.record(z.any()).optional().describe('Optional filters for the stream (e.g. channel: "#bitbrat")')
      }),
      async (args) => {
        const firestore = this.getResource<any>('firestore');
        let request: SummarizationRequest = {
          requestId: `mcp-${Date.now()}`,
          streamType: args.stream_type as string || 'chat',
          windowMinutes: args.window_minutes as number,
          filters: args.filters as Record<string, any>,
        };

        if (args.observer_id) {
          const doc = await firestore.collection('stream_observers').doc(args.observer_id).get();
          if (!doc.exists) {
            throw new Error(`Observer ${args.observer_id} not found.`);
          }
          const observer = doc.data() as StreamObserver;
          if (!observer.mcpEnabled) {
            throw new Error(`Observer ${args.observer_id} is not enabled for MCP access.`);
          }
          request = {
            ...request,
            observerId: args.observer_id,
            streamType: observer.source.filters.streamType || request.streamType,
            inspectionEnabled: observer.analysis.inspectionEnabled,
          };
        }

        const summary = await this.engine.summarize(request);
        
        // Publish report
        const pub = createMessagePublisher('internal.summarization.report.v1');
        await pub.publishJson({
          requestId: request.requestId,
          observerId: request.observerId,
          summary,
          at: new Date().toISOString()
        }, { 
          correlationId: request.requestId,
          type: 'internal.summarization.report.v1'
        });

        // Handle egress if observer used
        if (request.observerId) {
          await this.handleEgress(request.observerId, request.requestId, summary);
        }

        return {
          content: [{ type: 'text', text: summary }]
        };
      }
    );
  }
}

export function createApp() {
  return new StreamAnalystServer();
}

if (require.main === module) {
  const server = createApp();
  server.start(Number(process.env.PORT) || 3010).catch((e) => {
    console.error('FAILED_TO_START_STREAM_ANALYST_SERVER', e);
    process.exit(1);
  });
}
