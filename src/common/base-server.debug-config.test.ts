import request from 'supertest';
import { BaseServer } from './base-server';

describe('/_debug/config endpoint', () => {
  it('returns redacted configuration and required env keys', async () => {
    const server = new BaseServer({
      serviceName: 'test-svc',
      configOverrides: {
        port: 0,
        logLevel: 'debug',
        twitchClientId: 'cid',
        twitchClientSecret: 'super-secret',
        oauthStateSecret: 'state-secret',
      },
    });
    const app = server.getApp();

    const res = await request(app).get('/_debug/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('service', 'test-svc');
    expect(res.body).toHaveProperty('config');
    const cfg = res.body.config as Record<string, unknown>;
    // Secrets should be redacted/not present
    expect(cfg.twitchClientSecret).toBe('***REDACTED***');
    expect(cfg.oauthStateSecret).toBe('***REDACTED***');
    // Non-secret fields should appear
    expect(cfg.port).toBe(0);
    expect(cfg.logLevel).toBe('debug');

    // requiredEnv should be an array (may be empty in test env)
    expect(Array.isArray(res.body.requiredEnv)).toBe(true);
  });
});
