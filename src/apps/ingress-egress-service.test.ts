import request from 'supertest';
import { createApp } from './ingress-egress-service';

describe('generated service', () => {
  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200 and ready true', async () => {
      const res = await request(app).get('/readyz').expect(200);
      expect(res.body.ready).toBe(true);
    });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  describe('stubbed paths', () => {
  it('GET /_debug/twitch returns snapshot JSON', async () => {
    const res = await request(app).get('/_debug/twitch').expect(200);
    expect(res.body).toHaveProperty('snapshot');
    expect(res.body.snapshot).toHaveProperty('state');
    expect(typeof res.body.snapshot.state).toBe('string');
  });
  });

});
