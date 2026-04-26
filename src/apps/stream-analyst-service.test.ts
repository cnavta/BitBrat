import request from 'supertest';
import { StreamAnalystServer } from './stream-analyst-service';

describe('stream-analyst-service', () => {
  let server: StreamAnalystServer;

  beforeAll(async () => {
    server = new StreamAnalystServer();
    // We don't necessarily need to call server.start() if we just want to test routes via supertest
  });

  afterAll(async () => {
    await server.close('test');
  });

  it('GET /healthz returns 200', async () => {
    const response = await request(server.getApp()).get('/healthz');
    expect(response.status).toBe(200);
    // BaseServer response might differ slightly if it uses registerHealth, but let's assume our override for now
    expect(response.body.status).toBe('ok');
  });
});
