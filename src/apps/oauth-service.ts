import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';
import type { InternalEventV2 } from '../types/events';

const SERVICE_NAME = process.env.SERVICE_NAME || 'oauth-flow';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

const RAW_CONSUMED_TOPICS: string[] = [];

class OauthFlowServer extends BaseServer {
  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.setupApp(this.getApp() as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, _cfg: any) {
    // Architecture-specified explicit stub handlers (GET)
    app.get('/oauth/*', (_req: Request, res: Response) => { res.status(200).end(); });

    // Message subscriptions for consumed topics declared in architecture.yaml
    try {
      const instanceId =
        process.env.K_REVISION ||
        process.env.EGRESS_INSTANCE_ID ||
        process.env.SERVICE_INSTANCE_ID ||
        process.env.HOSTNAME ||
        Math.random().toString(36).slice(2);

    } catch (e: any) {
      this.getLogger().warn('oauth-flow.subscribe.init_error', { error: e?.message || String(e) });
    }

    // Example resource access patterns (uncomment and adapt):
    // const publisher = this.getResource<any>('publisher');
    // publisher?.publishJson({ hello: 'world' });
    // const firestore = this.getResource<any>('firestore');
    // const doc = await firestore?.collection('demo').doc('x').get();
  }
}

export function createApp() {
  const server = new OauthFlowServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new OauthFlowServer();
  void server.start(PORT);
}
