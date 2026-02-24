import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { BitBratTool, BitBratResource } from '../../src/types/tools';
import { z } from 'zod';
import { ToolRegistry } from '../../src/services/llm-bot/tools/registry';
import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js';

describe('Tool Gateway MCP RBAC (Dynamic)', () => {
  let gateway: ToolGatewayServer;
  let port: number = 3334; // Use a different port to avoid conflicts
  let gatewayUrl: string = `http://localhost:${port}`;

  beforeAll(async () => {
    gateway = new ToolGatewayServer();
    await gateway.start(port);
  });

  afterAll(async () => {
    await gateway.close();
  });

  it('should enforce dynamic RBAC over shared MCP session', async () => {
    const registry = (gateway as any).registry as ToolRegistry;
    
    // Register an admin tool
    const adminTool: BitBratTool = {
      id: 'admin-only-tool',
      source: 'mcp',
      displayName: 'Admin Tool',
      description: 'Only for admins',
      inputSchema: z.object({}),
      requiredRoles: ['admin'],
      execute: async () => 'Secret Data'
    };
    registry.registerTool(adminTool);

    // 1. Connect as a "bot" with minimal roles
    const transport = new SSEClientTransport(new URL(`${gatewayUrl}/sse`), {
      requestInit: {
        headers: {
          'x-roles': 'bot',
          'x-agent-name': 'llm-bot'
        }
      }
    });
    const client = new Client({ name: 'test-bot', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // 2. Discover tools - as a trusted agent (llm-bot), admin tool SHOULD be listed (discovery bypass)
    const tools = await client.listTools();
    expect(tools.tools.find(t => t.name === 'admin-only-tool')).toBeDefined();

    // 3. Attempt to call admin tool without _meta - should fail (Forbidden)
    await expect(client.callTool({ name: 'admin-only-tool', arguments: {} }))
      .rejects.toThrow(/Forbidden/);

    // 4. Call WITH _meta containing 'admin' role - should succeed!
    // Using internal request method to pass _meta as SDK might not have it in callTool wrapper
    const result = await (client as any).request(
      {
        method: 'tools/call',
        params: {
          name: 'admin-only-tool',
          arguments: {},
          _meta: { userRoles: ['admin'] }
        }
      },
      CallToolResultSchema
    );

    expect(result.content[0].text).toBe('Secret Data');

    // 5. Call WITH _meta containing 'user' role - should fail (Forbidden)
    await expect((client as any).request({
      method: 'tools/call',
      params: {
        name: 'admin-only-tool',
        arguments: {},
        _meta: { userRoles: ['user'] }
      }
    }, CallToolResultSchema)).rejects.toThrow(/Forbidden/);

    // 6. Test ReadResource with RBAC
    const adminResource: BitBratResource = {
      uri: 'admin://secret',
      name: 'Admin Resource',
      source: 'mcp',
      requiredRoles: ['admin'],
      read: async () => ({ contents: [{ uri: 'admin://secret', text: 'top secret content' }] })
    };
    registry.registerResource(adminResource);

    // Read WITHOUT _meta - should fail (Forbidden)
    await expect(client.readResource({ uri: 'admin://secret' }))
      .rejects.toThrow(/Forbidden/);

    // Read WITH _meta containing 'admin' role - should succeed!
    const resResult = await (client as any).request({
      method: 'resources/read',
      params: {
        uri: 'admin://secret',
        _meta: { userRoles: ['admin'] }
      }
    }, ReadResourceResultSchema);
    expect(resResult.contents[0].text).toBe('top secret content');

    await client.close();
  });
});
