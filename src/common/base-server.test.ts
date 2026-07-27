import request from 'supertest';
import { Bit } from './base-server';

describe('BaseServer', () => {
  let server: Bit;

  afterEach(async () => {
    // Cleanup to prevent open handles and resource leaks
    if (server) {
      await server.close('test-cleanup');
    }
  });

  it('exposes health endpoints and root', async () => {
    server = new Bit({ serviceName: 'test-svc' });
    const app = server.getApp();
    // Small delay to ensure async initialization completes (race condition fix)
    await new Promise(resolve => setImmediate(resolve));
    await request(app).get('/healthz').expect(200);
    await request(app).get('/readyz').expect(200);
    await request(app).get('/livez').expect(200);
    await request(app).get('/').expect(200);
  });

  it('accepts a setup function to register custom routes', async () => {
    server = new Bit({
      serviceName: 'custom',
      setup: (app) => {
        app.get('/custom', (_req, res) => res.status(204).end());
      },
    });
    const app = server.getApp();
    await new Promise(resolve => setImmediate(resolve));
    await request(app).get('/custom').expect(204);
  });

  it('computes required keys from architecture.yaml for oauth-flow', () => {
    const keys = Bit.computeRequiredKeysFromArchitecture('oauth-flow');
    // defaults.services.env + oauth-flow.secrets
    expect(keys).toEqual(
      expect.arrayContaining([
        'LOG_LEVEL', 'MESSAGE_BUS_DRIVER', 'NATS_URL', 'BUS_PREFIX',
        'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'OAUTH_STATE_SECRET'
      ])
    );
  });
});
