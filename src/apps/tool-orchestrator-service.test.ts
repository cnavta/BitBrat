import request from 'supertest';
import { ToolOrchestratorServer } from './tool-orchestrator-service';

describe('tool-orchestrator', () => {
  let server: ToolOrchestratorServer;

  beforeAll(async () => {
    server = new ToolOrchestratorServer();
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
