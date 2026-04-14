import request from 'supertest';
import { createServer, StateEngineServer } from './state-engine';

describe('generated service', () => {
  const server = createServer();
  const app = server.getApp();

  afterAll(async () => {
    await server.close('test');
  });
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  it('allows wildcard disposition state keys', async () => {
    const server = new StateEngineServer();
    expect((server as any).isAllowedKey('user.disposition.user-123')).toBe(true);
    expect((server as any).isAllowedKey('user.profile.user-123')).toBe(false);
    await server.close('test');
  });

});
