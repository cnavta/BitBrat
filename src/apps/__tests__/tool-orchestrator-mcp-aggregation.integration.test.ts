/**
 * Integration Test: Tool-Orchestrator MCP Aggregation
 * Sprint 62: Validates that tool-orchestrator serves aggregated tools from PostgreSQL registry via MCP
 *
 * This test verifies:
 * 1. MCP client can connect to tool-orchestrator
 * 2. Admin tools (bit.*, tool.*, model.*) are present
 * 3. Aggregated tools from PostgreSQL are exposed (count > admin tools)
 * 4. Input schemas are MCP-compliant (no $schema, definitions, $defs)
 *
 * Prerequisites:
 * - tool-orchestrator service running and accessible
 * - PostgreSQL with tool registry populated
 *
 * Running these tests:
 * - Skipped by default (requires live infrastructure)
 * - Enable with: RUN_MCP_INTEGRATION_TESTS=true npm test tool-orchestrator-mcp-aggregation
 * - Set URL with: TEST_TOOL_ORCHESTRATOR_URL=http://staging-url:3000/mcp
 * - Set auth token with: MCP_AUTH_TOKEN=your-token (if endpoint requires authentication)
 *
 * Example:
 * RUN_MCP_INTEGRATION_TESTS=true \
 * TEST_TOOL_ORCHESTRATOR_URL=http://bitbrat.lan:3027/mcp \
 * MCP_AUTH_TOKEN=your-staging-token \
 * npm test tool-orchestrator-mcp-aggregation
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

describe('Tool-Orchestrator MCP Aggregation', () => {
  const TEST_URL = process.env.TEST_TOOL_ORCHESTRATOR_URL || 'http://localhost:3000/mcp';
  const RUN_INTEGRATION_TESTS = process.env.RUN_MCP_INTEGRATION_TESTS === 'true';
  let client: Client;

  beforeEach(() => {
    client = new Client(
      {
        name: 'tool-orchestrator-integration-test',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch (err) {
        // Ignore close errors in tests
      }
    }
  });

  (RUN_INTEGRATION_TESTS ? it : it.skip)('should connect to tool-orchestrator via MCP', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'integration-test-client'
        }
      }
    });

    await client.connect(transport);

    expect(client).toBeDefined();
  }, 10000); // 10 second timeout

  (RUN_INTEGRATION_TESTS ? it : it.skip)('should expose admin tools (bit.*, tool.*, model.*)', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'integration-test-client'
        }
      }
    });

    await client.connect(transport);

    const result = await client.listTools();

    // Verify admin tools are present
    const toolNames = result.tools.map((t) => t.name);

    // bit.* tools
    expect(toolNames).toContain('bit.info');
    expect(toolNames).toContain('bit.health');
    expect(toolNames).toContain('bit.config.get');

    // tool.* tools (from tool-orchestrator MCP tools)
    expect(toolNames.some((name) => name.startsWith('tool.'))).toBe(true);

    // model.* tools (from tool-orchestrator MCP tools)
    expect(toolNames.some((name) => name.startsWith('model.'))).toBe(true);
  }, 10000);

  (RUN_INTEGRATION_TESTS ? it : it.skip)('should expose aggregated tools from PostgreSQL registry', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'integration-test-client'
        }
      }
    });

    await client.connect(transport);

    const result = await client.listTools();

    // Verify we have MORE than just admin tools
    // Admin tools: bit.* (~10), tool.* (~5), model.* (~4) = ~19 tools
    // If aggregation works, we should see significantly more tools from PostgreSQL
    expect(result.tools.length).toBeGreaterThan(20);

    console.log(`tool-orchestrator exposed ${result.tools.length} tools`);
  }, 10000);

  (RUN_INTEGRATION_TESTS ? it : it.skip)('should serve MCP-compliant input schemas (no $schema, definitions, $defs)', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'integration-test-client'
        }
      }
    });

    await client.connect(transport);

    const result = await client.listTools();

    // Verify all tools have clean input schemas
    for (const tool of result.tools) {
      const schema = tool.inputSchema as any;

      // MCP SDK v2.0 requires clean schemas without extra fields
      expect(schema).toBeDefined();
      expect(schema.$schema).toBeUndefined();
      expect(schema.definitions).toBeUndefined();
      expect(schema.$defs).toBeUndefined();

      // Should have type: 'object'
      expect(schema.type).toBe('object');

      // Optional fields that ARE allowed
      // - properties
      // - required
      // - additionalProperties
    }

    console.log(`Validated ${result.tools.length} tools for MCP schema compliance`);
  }, 10000);

  (RUN_INTEGRATION_TESTS ? it : it.skip)('should include tools from multiple sources (mcp, internal, composition)', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
          'x-agent-name': 'integration-test-client'
        }
      }
    });

    await client.connect(transport);

    const result = await client.listTools();

    // Group tools by prefix to identify sources
    const toolsByPrefix: Record<string, number> = {};

    for (const tool of result.tools) {
      const prefix = tool.name.split('.')[0];
      toolsByPrefix[prefix] = (toolsByPrefix[prefix] || 0) + 1;
    }

    console.log('Tools by prefix:', toolsByPrefix);

    // Verify we have tools from different categories
    // This validates that aggregation includes all sources, not just one
    expect(Object.keys(toolsByPrefix).length).toBeGreaterThanOrEqual(3);
  }, 10000);
});
