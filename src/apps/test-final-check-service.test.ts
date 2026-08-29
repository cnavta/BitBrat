import request from 'supertest';
import { TestFinalCheckServer } from './test-final-check-service';

describe('test-final-check', () => {
  let server: TestFinalCheckServer;

  beforeAll(async () => {
    server = new TestFinalCheckServer();
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
