import request from 'supertest';
import { TestWarningCheckServer } from './test-warning-check-service';

describe('test-warning-check', () => {
  let server: TestWarningCheckServer;

  beforeAll(async () => {
    server = new TestWarningCheckServer();
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
