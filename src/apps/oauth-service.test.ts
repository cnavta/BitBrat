import request from 'supertest';
import { createApp } from './oauth-service';

describe('generated service', () => {
  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  describe('stubbed paths', () => {
  it('stub /oauth/* -> 200', async () => {
    await request(app).get('/oauth/test').expect(200);
  });
  });

});
