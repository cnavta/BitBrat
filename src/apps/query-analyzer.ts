import { BaseServer } from '../common/base-server';
import { Express } from 'express';
import type { InternalEventV2 } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || 'query-analyzer';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class QueryAnalyzerServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any);
  }

  private async setupApp(_app: Express) {
    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);

      { // subscription for internal.query.analysis.v1
        const raw = "internal.query.analysis.v1";
        const destination = raw && raw.includes('{instanceId}') ? raw.replace('{instanceId}', String(instanceId)) : raw;
        const queue = raw && raw.includes('{instanceId}') ? SERVICE_NAME + '.' + String(instanceId) : SERVICE_NAME;
        try {
          await this.onMessage<InternalEventV2>(
            { destination, queue, ack: 'explicit' },
            async (msg: InternalEventV2, _attributes, ctx) => {
              try {
                this.getLogger().info('query-analyzer.message.received', {
                  destination,
                  type: (msg as any)?.type,
                  correlationId: (msg as any)?.correlationId,
                });
                
                // TODO: Implement Ollama-based analysis logic here (Sprint Execution Phase)
                
                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('query-analyzer.message.handler_error', { destination, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('query-analyzer.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('query-analyzer.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      this.getLogger().warn('query-analyzer.subscribe.init_error', { error: e?.message || String(e) });
    }
  }
}

export function createApp() {
  const server = new QueryAnalyzerServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new QueryAnalyzerServer();
  void server.start(PORT);
}
