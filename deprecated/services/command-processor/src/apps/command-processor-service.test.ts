import request from 'supertest';
import { createApp } from './command-processor-service';

describe('generated service', () => {
  const prev = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
  beforeAll(() => {
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '1';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prev;
  });

  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

});
