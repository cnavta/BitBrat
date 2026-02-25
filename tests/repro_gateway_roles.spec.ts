import request from 'supertest';
import { Express } from 'express';
import { ToolGatewayServer } from '../src/apps/tool-gateway';
import { ToolRegistry } from '../src/services/llm-bot/tools/registry';
import { BitBratTool } from '../src/types/tools';
import { z } from 'zod';

describe('Tool Gateway RBAC Repro', () => {
  let app: Express;
  let server: ToolGatewayServer;
  let registry: ToolRegistry;

  beforeEach(() => {
    server = new ToolGatewayServer();
    app = server.getApp() as any;
    registry = (server as any).registry;

    // Register 2 tools with no roles
    for (let i = 1; i <= 2; i++) {
      registry.registerTool({
        id: `public:tool:${i}`,
        source: 'mcp',
        displayName: `Public Tool ${i}`,
        description: `Description ${i}`,
        inputSchema: z.object({}),
        execute: async () => `Result ${i}`,
      });
    }

    // Register 5 tools with 'admin' role
    for (let i = 1; i <= 5; i++) {
      registry.registerTool({
        id: `admin:tool:${i}`,
        source: 'mcp',
        displayName: `Admin Tool ${i}`,
        description: `Admin Description ${i}`,
        requiredRoles: ['admin'],
        inputSchema: z.object({}),
        execute: async () => `Admin Result ${i}`,
      });
    }

    // Register 1 tool with 'admin' role AND 'llm-bot' allowlist
    registry.registerTool({
      id: 'admin:llm:tool',
      source: 'mcp',
      displayName: 'Admin LLM Tool',
      description: 'Admin tool allowlisted for llm-bot',
      requiredRoles: ['admin'],
      agentAllowlist: ['llm-bot'],
      inputSchema: z.object({}),
      execute: async () => 'Admin LLM Result',
    });
  });

  it('GET /v1/tools without roles returns only public tools', async () => {
    const res = await request(app).get('/v1/tools');
    expect(res.status).toBe(200);
    expect(res.body.tools.length).toBe(2);
    expect(res.body.tools.every((t: any) => t.id.startsWith('public:'))).toBe(true);
  });

  it('GET /v1/tools with admin role returns matching tools', async () => {
    const res = await request(app).get('/v1/tools').set('x-roles', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.tools.length).toBe(7); // 2 public + 5 admin (admin:llm tool excluded because agent not matched)
  });

  it('GET /v1/tools for llm-bot agent returns allowlisted tools even without roles', async () => {
    const res = await request(app).get('/v1/tools').set('x-agent-name', 'llm-bot');
    expect(res.status).toBe(200);
    // Should see 2 public tools + 1 admin:llm tool = 3 tools
    expect(res.body.tools.length).toBe(3);
    expect(res.body.tools.find((t: any) => t.id === 'admin:llm:tool')).toBeDefined();
    expect(res.body.tools.find((t: any) => t.id === 'admin:tool:1')).toBeUndefined();
  });

  it('GET /v1/tools for llm-bot with server-level allowlist returns all server tools', async () => {
    // Set up a restricted server with llm-bot allowlisted
    (server as any).serverConfigs.set('restricted-server', {
      name: 'restricted-server',
      agentAllowlist: ['llm-bot'],
      requiredRoles: ['admin']
    });

    registry.registerTool({
      id: 'restricted:tool',
      source: 'mcp',
      originServer: 'restricted-server',
      requiredRoles: ['admin'],
      inputSchema: z.object({}),
      execute: async () => 'Restricted Result',
    });

    const res = await request(app).get('/v1/tools').set('x-agent-name', 'llm-bot');
    expect(res.status).toBe(200);
    // Should see public tools (2) + admin:llm tool (1) + restricted tool (1) = 4
    expect(res.body.tools.find((t: any) => t.id === 'restricted:tool')).toBeDefined();
  });
});
