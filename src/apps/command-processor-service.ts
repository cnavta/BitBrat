import { BaseServer } from '../common/base-server';
import { Express, Request, Response } from 'express';

const SERVICE_NAME = process.env.SERVICE_NAME || 'command-processor';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export function createApp() {
  const server = new BaseServer({
    serviceName: SERVICE_NAME,
    setup: (app: Express) => {
      // Architecture-specified explicit stub handlers (GET)

    },
  });
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const app = createApp();
  app.listen(PORT, () => {
    console.log('[command-processor] listening on port ' + PORT);
  });
}
