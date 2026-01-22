import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type { InternalEventV2 } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || 'command-processor';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

const RAW_CONSUMED_TOPICS: string[] = [
  "internal.command.v1"
];

class CommandProcessorServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)


    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);

      { // subscription for internal.command.v1
        const raw = "internal.command.v1";
        const destination = raw && raw.includes('{instanceId}') ? raw.replace('{instanceId}', String(instanceId)) : raw;
        const queue = raw && raw.includes('{instanceId}') ? SERVICE_NAME + '.' + String(instanceId) : SERVICE_NAME;
        try {
          await this.onMessage<InternalEventV2>(
            { destination, queue, ack: 'explicit' },
            async (msg: InternalEventV2, _attributes, ctx) => {
              try {
                this.getLogger().info('command-processor.message.received', {
                  destination,
                  type: (msg as any)?.type,
                  correlationId: (msg as any)?.correlationId,
                });
                // TODO: implement domain behavior for this topic
                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('command-processor.message.handler_error', { destination, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('command-processor.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('command-processor.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      this.getLogger().warn('command-processor.subscribe.init_error', { error: e?.message || String(e) });
    }

    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();
  }
}

export function createApp() {
  const server = new CommandProcessorServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new CommandProcessorServer();
  void server.start(PORT);
}
