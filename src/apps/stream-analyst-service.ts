import { McpServer } from '../common/mcp-server';
import { Express, Request, Response } from 'express';
import { StreamAnalystEngine } from '../services/stream-analyst/engine';
import type { SummarizationRequest } from '../types/sessi';
import { createMessagePublisher } from '../services/message-bus';
import { z } from 'zod';
import { BaseServerOptions } from '../common/base-server';

/**
 * Stream Analyst Service
 * Orchestrates event stream summarization and inspection.
 * Triggers:
 * - Pub/Sub: internal.summarization.request.v1
 * - HTTP: POST /summarize (used by tool-gateway)
 */
class StreamAnalystServer extends McpServer {
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
          this.getLogger().info('stream-analyst.request.received', { 
            requestId: req.requestId,
            observerId: req.observerId,
            streamType: req.streamType
          });

          const summary = await this.engine.summarize(req);
          
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
        stream_type: z.string().describe('The type of stream to summarize (e.g., "chat", "logs", "errors")'),
        window_minutes: z.number().optional().default(10).describe('Window size in minutes'),
        filters: z.record(z.any()).optional().describe('Optional filters for the stream (e.g. channel: "#bitbrat")')
      }),
      async (args) => {
        const summary = await this.engine.summarize({
          streamType: args.stream_type as string,
          windowMinutes: args.window_minutes as number,
          filters: args.filters as Record<string, any>,
          requestId: `mcp-${Date.now()}`
        });
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
