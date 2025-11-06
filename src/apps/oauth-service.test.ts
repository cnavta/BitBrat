import request from 'supertest';
import { createApp } from './oauth-service';

describe('oauth-service health endpoints', () => {
  const app = createApp();

  it('GET /healthz returns 200 and JSON', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.status).toBe('ok');
  });

  it('GET /readyz returns 200', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
  });

  it('GET /livez returns 200', async () => {
    const res = await request(app).get('/livez');
    expect(res.status).toBe(200);
  });
});
