import request from 'supertest';
import { Express } from 'express';
import { ToolRegistry } from '../../src/services/llm-bot/tools/registry';
import { RbacEvaluator } from '../../src/common/mcp/rbac';
import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { BitBratTool, BitBratResource } from '../../src/types/tools';
import { z } from 'zod';

describe('Tool Gateway REST API', () => {
  let app: Express;
  let server: ToolGatewayServer;
  let registry: ToolRegistry;

  beforeEach(() => {
    server = new ToolGatewayServer();
    app = server.getApp() as any;
    registry = (server as any).registry;
  });

  it('GET /v1/tools should return an empty list initially', async () => {
    const res = await request(app).get('/v1/tools');
    expect(res.status).toBe(200);
    expect(res.body.tools).toBeDefined();
    expect(Array.isArray(res.body.tools)).toBe(true);
  });

  it('POST /v1/tools/:id should return 404 for unknown tool', async () => {
    const res = await request(app).post('/v1/tools/unknown').send({});
    expect(res.status).toBe(404);
  });

  it('GET /v1/resources should return an empty list initially', async () => {
    const res = await request(app).get('/v1/resources');
    expect(res.status).toBe(200);
    expect(res.body.resources).toBeDefined();
  });

  it('should list and invoke tools', async () => {
    const testTool: BitBratTool = {
      id: 'test:tool',
      source: 'mcp',
      displayName: 'Test Tool',
      description: 'A test tool',
      inputSchema: z.object({ msg: z.string() }),
      execute: async (args: any) => `Hello ${args.msg}`,
    };
    registry.registerTool(testTool);

    const listRes = await request(app).get('/v1/tools');
    expect(listRes.body.tools.find((t: any) => t.id === 'test:tool')).toBeDefined();

    const invokeRes = await request(app).post('/v1/tools/test:tool').send({ msg: 'World' });
    expect(invokeRes.status).toBe(200);
    expect(invokeRes.body.result).toBe('Hello World');
  });

  it('should list and read resources', async () => {
    const testResource: BitBratResource = {
      uri: 'test://resource',
      name: 'Test Resource',
      source: 'mcp',
      read: async () => ({ contents: [{ uri: 'test://resource', text: 'content' }] }),
    };
    registry.registerResource(testResource);

    const listRes = await request(app).get('/v1/resources');
    expect(listRes.body.resources.find((r: any) => r.uri === 'test://resource')).toBeDefined();

    const readRes = await request(app).get('/v1/resources?uri=test://resource');
    expect(readRes.status).toBe(200);
    expect(readRes.body.result.contents[0].text).toBe('content');
  });

  it('should enforce RBAC on REST endpoints', async () => {
    const adminTool: BitBratTool = {
      id: 'admin:tool',
      source: 'mcp',
      requiredRoles: ['admin'],
      inputSchema: z.object({}),
      execute: async () => 'secret',
    };
    registry.registerTool(adminTool);

    // No roles -> Forbidden
    const res1 = await request(app).get('/v1/tools');
    expect(res1.body.tools.find((t: any) => t.id === 'admin:tool')).toBeUndefined();

    const res2 = await request(app).post('/v1/tools/admin:tool').send({});
    expect(res2.status).toBe(403);

    // With roles -> OK (we mock roles via x-roles header)
    const res3 = await request(app).get('/v1/tools').set('x-roles', 'admin');
    expect(res3.body.tools.find((t: any) => t.id === 'admin:tool')).toBeDefined();

    const res4 = await request(app).post('/v1/tools/admin:tool').send({}).set('x-roles', 'admin');
    expect(res4.status).toBe(200);
    expect(res4.body.result).toBe('secret');
  });
});
