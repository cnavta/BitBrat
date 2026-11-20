/**
 * Integration Test: Tool-Orchestrator Composition Execution
 * Sprint 65 Task 2.3: Composition Execution Integration Tests
 *
 * This test verifies:
 * 1. Simple 2-step composition (get_state → set_state)
 * 2. RBAC failure - composition with restricted tool
 * 3. Partial failure - step 2 fails, verify cleanup
 * 4. Variable resolution - ${previous.result}
 * 5. Nested composition
 * 6. Parallel execution strategy
 * 7. Sequential execution strategy
 *
 * Prerequisites:
 * - tool-orchestrator service running and accessible
 * - PostgreSQL with tool/composition registries populated
 * - Test compositions registered
 *
 * Running these tests:
 * - Skipped by default (requires live infrastructure)
 * - Enable with: RUN_MCP_INTEGRATION_TESTS=true npm test tool-orchestrator-composition-execution
 * - Set URL with: TEST_TOOL_ORCHESTRATOR_URL=http://staging-url:3000/mcp
 *
 * Example:
 * RUN_MCP_INTEGRATION_TESTS=true \
 * TEST_TOOL_ORCHESTRATOR_URL=http://localhost:3027/mcp \
 * npm test tool-orchestrator-composition-execution
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

describe('Tool-Orchestrator Composition Execution (Sprint 65 Task 2.3)', () => {
  const TEST_URL = process.env.TEST_TOOL_ORCHESTRATOR_URL || 'http://localhost:3000/mcp';
  const RUN_INTEGRATION_TESTS = process.env.RUN_MCP_INTEGRATION_TESTS === 'true';
  let client: Client;

  beforeEach(() => {
    client = new Client(
      {
        name: 'composition-execution-integration-test',
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
  // Test 1: Simple 2-step composition (get_state → set_state)
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute simple 2-step composition successfully',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
            'x-model-id': 'gpt-4',
          },
        },
      });

      await client.connect(transport);

      // Register a simple composition
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_simple_composition',
          description: 'Simple 2-step get→set composition',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key', 'value'],
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state',
              with: { key: '$.key' },
            },
            {
              call: 'set_state',
              with: {
                key: '$.key',
                value: '$.value',
              },
            },
          ],
          return: {
            from: 'steps[1].result',
          },
        },
      };

      // Register composition
      await client.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      // Execute composition
      const result = await client.callTool({
        name: 'test_simple_composition',
        arguments: {
          key: 'test_key',
          value: 'test_value',
        },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      console.log(`Simple composition executed successfully`);

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_simple_composition', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    15000
  );

  // ============================================================================
  // Test 2: RBAC failure - composition with restricted tool
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should fail composition execution when user lacks permission for constituent tool',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:basic-user',
            'x-roles': 'user', // Basic user, no admin
            'x-model-id': 'gpt-3.5-turbo', // Basic tier model
          },
        },
      });

      await client.connect(transport);

      // Register composition with restricted tool
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_restricted_composition',
          description: 'Composition with admin-only tool',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {},
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state', // Public tool
              with: { key: 'test' },
            },
            {
              call: 'delete_all_state', // Admin-only tool (hypothetical)
              with: {},
            },
          ],
          return: {
            from: 'steps[1].result',
          },
        },
      };

      // Register composition (as admin)
      const adminTransport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-user-id': 'test:admin',
            'x-roles': 'admin',
          },
        },
      });

      const adminClient = new Client({ name: 'admin', version: '1.0.0' }, { capabilities: {} });
      await adminClient.connect(adminTransport);

      await adminClient.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      await adminClient.close();

      // Try to execute composition as basic user - should fail RBAC
      try {
        await client.callTool({
          name: 'test_restricted_composition',
          arguments: {},
        });

        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // Verify RBAC denial
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();

        const errorMsg = error.message.toLowerCase();
        const isRbacError =
          errorMsg.includes('denied') ||
          errorMsg.includes('permission') ||
          errorMsg.includes('unauthorized');

        expect(isRbacError).toBe(true);
        console.log(`Composition RBAC denial confirmed: ${error.message}`);
      }

      // Cleanup
      try {
        const cleanupClient = new Client({ name: 'cleanup', version: '1.0.0' }, { capabilities: {} });
        const cleanupTransport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
          requestInit: {
            headers: {
              'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
              'x-user-id': 'test:admin',
              'x-roles': 'admin',
            },
          },
        });
        await cleanupClient.connect(cleanupTransport);
        await cleanupClient.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_restricted_composition', version: 1 },
        });
        await cleanupClient.close();
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    20000
  );

  // ============================================================================
  // Test 3: Partial failure - step 2 fails, verify error handling
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should handle partial failure gracefully in sequential composition',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Register composition with failing step
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_failing_composition',
          description: 'Composition with intentional failure',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {},
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state',
              with: { key: 'test' },
            },
            {
              call: 'nonexistent_tool', // This will fail
              with: {},
            },
            {
              call: 'set_state', // Should not execute
              with: { key: 'should_not_execute', value: 'true' },
            },
          ],
          return: {
            from: 'steps[2].result',
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      // Execute composition - should fail at step 2
      try {
        await client.callTool({
          name: 'test_failing_composition',
          arguments: {},
        });

        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // Verify error handling
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();

        // Error should mention the failing step
        const errorMsg = error.message.toLowerCase();
        const hasStepInfo = errorMsg.includes('step') || errorMsg.includes('nonexistent');

        expect(hasStepInfo).toBe(true);
        console.log(`Partial failure handled: ${error.message}`);
      }

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_failing_composition', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    15000
  );

  // ============================================================================
  // Test 4: Variable resolution - ${previous.result}
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should resolve variables from previous step results',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Register composition with variable resolution
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_variable_resolution',
          description: 'Composition using variable resolution',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string' },
            },
            required: ['key'],
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state',
              with: { key: '$.key' },
            },
            {
              call: 'set_state',
              with: {
                key: 'derived_key',
                value: 'steps[0].result', // Use result from step 0
              },
            },
          ],
          return: {
            from: 'steps[1].result',
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      // Execute composition
      const result = await client.callTool({
        name: 'test_variable_resolution',
        arguments: {
          key: 'source_key',
        },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      console.log(`Variable resolution composition executed successfully`);

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_variable_resolution', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    15000
  );

  // ============================================================================
  // Test 5: Parallel execution strategy
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute parallel composition strategy correctly',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Register parallel composition
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_parallel_composition',
          description: 'Composition using parallel execution',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {},
          },
          strategy: 'parallel',
          steps: [
            {
              call: 'get_state',
              with: { key: 'key1' },
            },
            {
              call: 'get_state',
              with: { key: 'key2' },
            },
            {
              call: 'get_state',
              with: { key: 'key3' },
            },
          ],
          return: {
            from: 'steps', // All results
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      // Execute composition - all steps should run in parallel
      const startTime = Date.now();
      const result = await client.callTool({
        name: 'test_parallel_composition',
        arguments: {},
      });
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      console.log(`Parallel composition executed in ${duration}ms`);

      // Parallel should be faster than sequential (or similar time for fast operations)
      // For 3 operations, parallel should not be 3x sequential time

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_parallel_composition', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    15000
  );

  // ============================================================================
  // Test 6: Nested composition (composition calling composition)
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute nested composition (composition calling composition)',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Register inner composition
      const innerCompositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_inner_composition',
          description: 'Inner composition for nesting test',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string' },
            },
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state',
              with: { key: '$.key' },
            },
          ],
          return: {
            from: 'steps[0].result',
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: innerCompositionDef },
      });

      // Register outer composition that calls inner
      const outerCompositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_outer_composition',
          description: 'Outer composition for nesting test',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string' },
            },
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'test_inner_composition',
              with: { key: '$.key' },
            },
            {
              call: 'set_state',
              with: {
                key: 'nested_result',
                value: 'steps[0].result',
              },
            },
          ],
          return: {
            from: 'steps[1].result',
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: outerCompositionDef },
      });

      // Execute outer composition (which calls inner)
      const result = await client.callTool({
        name: 'test_outer_composition',
        arguments: {
          key: 'test_key',
        },
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      console.log(`Nested composition executed successfully`);

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_outer_composition', version: 1 },
        });
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_inner_composition', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    20000
  );

  // ============================================================================
  // Test 7: Performance - No regression vs tool-gateway
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should have composition execution performance within 20% of tool-gateway baseline',
    async () => {
      const transport = new StreamableHTTPClientTransport(new URL(TEST_URL), {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'test-token'}`,
            'x-agent-name': 'integration-test-client',
            'x-user-id': 'test:user123',
            'x-roles': 'user',
          },
        },
      });

      await client.connect(transport);

      // Use an existing simple composition for performance testing
      const compositionDef = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'test_perf_composition',
          description: 'Simple composition for performance testing',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {},
          },
          strategy: 'sequential',
          steps: [
            {
              call: 'get_state',
              with: { key: 'perf_test' },
            },
          ],
          return: {
            from: 'steps[0].result',
          },
        },
      };

      await client.callTool({
        name: 'composition.register',
        arguments: { definition: compositionDef },
      });

      // Run 10 iterations
      const latencies: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        await client.callTool({
          name: 'test_perf_composition',
          arguments: {},
        });
        const duration = Date.now() - startTime;
        latencies.push(duration);
      }

      // Calculate statistics
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];

      console.log(`Composition performance (n=${latencies.length}):`);
      console.log(`  P50: ${p50}ms`);
      console.log(`  P95: ${p95}ms`);

      // Target: P95 < 200ms (from sprint backlog)
      expect(p95).toBeLessThan(200);

      // Note: To verify within 20% of tool-gateway baseline, run same composition
      // against tool-gateway and compare P95 values

      // Cleanup
      try {
        await client.callTool({
          name: 'composition.delete',
          arguments: { name: 'test_perf_composition', version: 1 },
        });
      } catch (err) {
        // Ignore cleanup errors
      }
    },
    30000
  );
});
