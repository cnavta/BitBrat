import request from 'supertest';
import { BaseServer } from './base-server';

describe('BaseServer', () => {
  it('exposes health endpoints and root', async () => {
    const server = new BaseServer({ serviceName: 'test-svc' });
    const app = server.getApp();
    await request(app).get('/healthz').expect(200);
    await request(app).get('/readyz').expect(200);
    await request(app).get('/livez').expect(200);
    await request(app).get('/').expect(200);
  });

  it('accepts a setup function to register custom routes', async () => {
    const server = new BaseServer({
      serviceName: 'custom',
      setup: (app) => {
        app.get('/custom', (_req, res) => res.status(204).end());
      },
    });
    const app = server.getApp();
    await request(app).get('/custom').expect(204);
  });

  it('computes required keys from architecture.yaml for oauth-flow', () => {
    const keys = BaseServer.computeRequiredKeysFromArchitecture('oauth-flow');
    // defaults.services.env + oauth-flow.secrets
    expect(keys).toEqual(
      expect.arrayContaining([
        'LOG_LEVEL', 'MESSAGE_BUS_DRIVER', 'NATS_URL', 'BUS_PREFIX',
        'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'OAUTH_STATE_SECRET'
      ])
    );
  });
});
