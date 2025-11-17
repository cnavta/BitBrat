import request from 'supertest';
import { createApp } from './oauth-service';

describe('oauth-service health endpoints', () => {
  const app = createApp();

  const expectHealthShape = (body: any) => {
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('service');
    expect(typeof body.service).toBe('string');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
    expect(body).toHaveProperty('uptimeSec');
    expect(typeof body.uptimeSec).toBe('number');
  };

  it('GET /healthz returns 200 and health payload', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expectHealthShape(res.body);
  });

  it('GET /readyz returns 200 and health payload', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expectHealthShape(res.body);
  });

  it('GET /livez returns 200 and health payload', async () => {
    const res = await request(app).get('/livez');
    expect(res.status).toBe(200);
    expectHealthShape(res.body);
  });
});
