import request from 'supertest';
import { TestFromMainWithWarningServer } from './test-from-main-with-warning-service';

describe('test-from-main-with-warning', () => {
  let server: TestFromMainWithWarningServer;

  beforeAll(async () => {
    server = new TestFromMainWithWarningServer();
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
