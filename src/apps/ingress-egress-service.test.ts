import request from 'supertest';
import { createApp } from './ingress-egress-service';

describe('generated service', () => {
  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  describe('stubbed paths', () => {
  it('stub /_debug/twitch -> 200', async () => {
    await request(app).get('/_debug/twitch').expect(200);
  });
  it('stub /_debug/discord -> 200', async () => {
    await request(app).get('/_debug/discord').expect(200);
  });
  it('stub /_debug/twilio -> 200', async () => {
    await request(app).get('/_debug/twilio').expect(200);
  });
  it('stub /webhooks/twilio -> 200', async () => {
    await request(app).get('/webhooks/twilio').expect(200);
  });
  });

});
