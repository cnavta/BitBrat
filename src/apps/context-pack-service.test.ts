import request from 'supertest';
import { ContextPackServer } from './context-pack-service';

describe('context-pack', () => {
  let server: ContextPackServer;

  beforeAll(async () => {
    server = new ContextPackServer();
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
