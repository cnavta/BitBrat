import request from 'supertest';
import { createServer } from './tool-gateway';

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

});
