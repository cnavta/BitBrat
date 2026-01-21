import request from 'supertest';
import { TestSvcServer } from './test-svc';

describe('test-svc', () => {
  let server: TestSvcServer;

  beforeAll(async () => {
    server = new TestSvcServer();
    // We don't necessarily need to call server.start() if we just want to test routes via supertest
  });

  afterAll(async () => {
    await server.close('test');
  });

  it('GET /health returns 200', async () => {
    const response = await request(server.getApp()).get('/health');
    expect(response.status).toBe(200);
    // BaseServer response might differ slightly if it uses registerHealth, but let's assume our override for now
    expect(response.body.status).toBe('ok');
  });
});
