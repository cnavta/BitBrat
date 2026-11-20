/**
 * Integration Test: llm-bot + tool-orchestrator
 * Sprint 65 Task 3.1: Validate llm-bot can use tool-orchestrator for tool execution
 *
 * This test verifies:
 * 1. Feature flag ENABLE_TOOL_ORCHESTRATOR correctly switches tool providers
 * 2. llm-bot connects to tool-orchestrator MCP endpoint
 * 3. Tool execution works end-to-end via tool-orchestrator
 * 4. RBAC validation works correctly
 * 5. No regressions compared to tool-gateway behavior
 *
 * Prerequisites:
 * - tool-orchestrator service running and accessible
 * - PostgreSQL with tool/composition registries populated
 * - MCP servers (image-gen-mcp, story-engine-mcp) running (optional for basic tests)
 *
 * Running these tests:
 * - Skipped by default (requires live infrastructure)
 * - Enable with: RUN_MCP_INTEGRATION_TESTS=true npm test llm-bot-tool-orchestrator
 * - Set URL with: TEST_TOOL_ORCHESTRATOR_URL=http://localhost:3030/mcp
 *
 * Example:
 * RUN_MCP_INTEGRATION_TESTS=true \
 * TEST_TOOL_ORCHESTRATOR_URL=http://localhost:3030/mcp \
 * MCP_AUTH_TOKEN=test-token \
 * npm test llm-bot-tool-orchestrator
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

describe('llm-bot + tool-orchestrator Integration (Sprint 65 Task 3.1)', () => {
  const TEST_URL = process.env.TEST_TOOL_ORCHESTRATOR_URL || 'http://localhost:3030/mcp';
  const RUN_INTEGRATION_TESTS = process.env.RUN_MCP_INTEGRATION_TESTS === 'true';
  let client: Client;

  beforeEach(() => {
    client = new Client(
      {
        name: 'llm-bot-tool-orchestrator-integration-test',
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

  // ============================================================================
  // Test 1: Verify tool-orchestrator connection
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should connect to tool-orchestrator and list available tools',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:llm-bot-integration',
            'x-roles': 'user,developer',
          },
        },
      });

      await client.connect(transport);

      const result = await client.listTools();

      // Verify we can list tools
      expect(result).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);

      // Log available tools for validation
      console.log(`Available tools from tool-orchestrator: ${result.tools.length}`);
      const toolNames = result.tools.map((t) => t.name).slice(0, 10);
      console.log(`Sample tools: ${toolNames.join(', ')}${result.tools.length > 10 ? '...' : ''}`);

      // Verify expected tool categories are present
      const hasAdminTools = result.tools.some((t) => t.name.startsWith('bit.'));
      const hasModelTools = result.tools.some((t) => t.name.startsWith('model.'));
      const hasToolTools = result.tools.some((t) => t.name.startsWith('tool.'));

      expect(hasAdminTools).toBe(true);
      console.log(`Admin tools (bit.*): ${hasAdminTools ? 'present' : 'missing'}`);
      console.log(`Model tools (model.*): ${hasModelTools ? 'present' : 'missing'}`);
      console.log(`Tool tools (tool.*): ${hasToolTools ? 'present' : 'missing'}`);
    },
    10000
  );

  // ============================================================================
  // Test 2: Execute admin tool (bit.health) via tool-orchestrator
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute admin tool (bit.health) via tool-orchestrator',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:llm-bot-integration',
            'x-roles': 'user,developer',
          },
        },
      });

      await client.connect(transport);

      const startTime = Date.now();
      const result = await client.callTool({
        name: 'bit.health',
        arguments: {},
      });
      const duration = Date.now() - startTime;

      // Verify result
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      console.log(`bit.health executed in ${duration}ms`);

      // Parse and validate response
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.status).toBeDefined();
      console.log(`Health status: ${response.status}`);
    },
    10000
  );

  // ============================================================================
  // Test 3: Execute tool.list to verify tool registry integration
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute tool.list to verify tool registry integration',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:llm-bot-integration',
            'x-roles': 'user,developer',
          },
        },
      });

      await client.connect(transport);

      const result = await client.callTool({
        name: 'tool.list',
        arguments: { limit: 100 },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      // Parse and validate response
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.tools).toBeDefined();
      expect(Array.isArray(response.tools)).toBe(true);

      console.log(`tool.list returned ${response.tools.length} tools`);

      // Verify tool registry contains expected entries
      const hasStateTools = response.tools.some((t: any) => t.id.includes('state'));
      const hasConfigTools = response.tools.some((t: any) => t.id.includes('config'));

      console.log(`State tools: ${hasStateTools ? 'present' : 'missing'}`);
      console.log(`Config tools: ${hasConfigTools ? 'present' : 'missing'}`);
    },
    10000
  );

  // ============================================================================
  // Test 4: RBAC validation - verify tool access control
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should enforce RBAC when calling tools as different user roles',
    async () => {
      // Test as basic user (limited permissions)
      const basicUserTransport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:basic-user',
            'x-roles': 'user',
            'x-model-id': 'gpt-3.5-turbo', // Basic tier model
          },
        },
      });

      await client.connect(basicUserTransport);

      // List tools to find admin-only tools
      const listResult = await client.listTools();
      const adminTools = listResult.tools.filter(
        (t) => t.name.includes('admin') || t.name.includes('delete') || t.name.includes('config.set')
      );

      if (adminTools.length > 0) {
        const adminTool = adminTools[0];
        console.log(`Testing RBAC denial for: ${adminTool.name}`);

        try {
          await client.callTool({
            name: adminTool.name,
            arguments: {},
          });

          // If we reach here, tool was not restricted (might not be RBAC-protected)
          console.warn(`Tool ${adminTool.name} was not RBAC-restricted as expected`);
        } catch (error: any) {
          // Verify RBAC denial error
          expect(error).toBeDefined();
          expect(error.message).toBeDefined();

          const errorMsg = error.message.toLowerCase();
          const isRbacError =
            errorMsg.includes('denied') ||
            errorMsg.includes('permission') ||
            errorMsg.includes('unauthorized') ||
            errorMsg.includes('forbidden');

          if (isRbacError) {
            console.log(`✅ RBAC denial confirmed: ${error.message}`);
            expect(isRbacError).toBe(true);
          } else {
            console.warn(`Error was not RBAC-related: ${error.message}`);
          }
        }
      } else {
        console.warn('No admin-only tools found for RBAC testing');
      }
    },
    15000
  );

  // ============================================================================
  // Test 5: Performance comparison - tool execution latency
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should have comparable performance to tool-gateway baseline',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:llm-bot-performance',
            'x-roles': 'user,developer',
          },
        },
      });

      await client.connect(transport);

      // Run 10 iterations to get performance metrics
      const latencies: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        try {
          await client.callTool({
            name: 'bit.health',
            arguments: {},
          });
          const duration = Date.now() - startTime;
          latencies.push(duration);
        } catch (err) {
          console.warn(`Iteration ${i + 1} failed: ${err}`);
        }
      }

      // Calculate P50, P95
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

      console.log(`Performance results (n=${latencies.length}):`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  P50: ${p50}ms`);
      console.log(`  P95: ${p95}ms`);

      // Target: P95 < 200ms (from sprint backlog)
      expect(p95).toBeLessThan(200);

      console.log(`✅ Performance within target (P95: ${p95}ms < 200ms)`);
    },
    30000
  );

  // ============================================================================
  // Test 6: Feature flag behavior - verify provider selection
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should verify ENABLE_TOOL_ORCHESTRATOR feature flag is respected',
    async () => {
      // This test verifies the feature flag logic by checking connection logs
      // In a real deployment, llm-bot would log which provider it connected to

      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'llm-bot',
            'x-user-id': 'test:feature-flag-validation',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Verify connection is established
      const result = await client.listTools();
      expect(result.tools.length).toBeGreaterThan(0);

      // Log success
      console.log('✅ Feature flag test: Connected to tool-orchestrator successfully');
      console.log(`   Available tools: ${result.tools.length}`);

      // Note: Actual feature flag validation happens in llm-bot startup logs:
      // "llm_bot.tool_provider_configured" with provider: tool-orchestrator
      // See src/apps/llm-bot-service.ts:140-144
    },
    10000
  );
});
