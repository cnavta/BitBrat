import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type { InternalEventV2 } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

const RAW_CONSUMED_TOPICS: string[] = [
  "internal.egress.v1.{instanceId}"
];

class IngressEgressServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)
    app.get('/_debug/twitch', (_req: Request, res: Response) => { res.status(200).end(); });
    app.get('/_debug/discord', (_req: Request, res: Response) => { res.status(200).end(); });
    app.get('/_debug/twilio', (_req: Request, res: Response) => { res.status(200).end(); });
    app.get('/webhooks/twilio', (_req: Request, res: Response) => { res.status(200).end(); });

    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);

      { // subscription for internal.egress.v1.{instanceId}
        const raw = "internal.egress.v1.{instanceId}";
        const destination = raw && raw.includes('{instanceId}') ? raw.replace('{instanceId}', String(instanceId)) : raw;
        const queue = raw && raw.includes('{instanceId}') ? SERVICE_NAME + '.' + String(instanceId) : SERVICE_NAME;
        try {
          await this.onMessage<InternalEventV2>(
            { destination, queue, ack: 'explicit' },
            async (msg: InternalEventV2, _attributes, ctx) => {
              try {
                this.getLogger().info('ingress-egress.message.received', {
                  destination,
                  type: (msg as any)?.type,
                  correlationId: (msg as any)?.correlationId,
                });
                // TODO: implement domain behavior for this topic
                await ctx.ack();
              } catch (e: any) {
                this.getLogger().error('ingress-egress.message.handler_error', { destination, error: e?.message || String(e) });
                await ctx.ack();
              }
            }
          );
          this.getLogger().info('ingress-egress.subscribe.ok', { destination, queue });
        } catch (e: any) {
          this.getLogger().error('ingress-egress.subscribe.error', { destination, queue, error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      this.getLogger().warn('ingress-egress.subscribe.init_error', { error: e?.message || String(e) });
    }

    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();
  }
}

export function createApp() {
  const server = new IngressEgressServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new IngressEgressServer();
  void server.start(PORT);
}
