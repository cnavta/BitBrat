import request from 'supertest';
import { ReflexServer } from './reflex-service';

describe('reflex', () => {
  let server: ReflexServer;

  beforeAll(async () => {
    server = new ReflexServer();
    // Server starts automatically via constructor
  });

  afterAll(async () => {
    await server.close('test');
  });

  it('should respond to health check', async () => {
    const response = await request(server.getApp()).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
