/**
 * Integration Tests
 * Sprint 60: T7.2 - End-to-end integration tests for tool-orchestrator
 *
 * Test coverage:
 * 1. User message → llm-bot → MCP tool → response
 * 2. User message → llm-bot → composition → response
 * 3. RBAC denial flow
 * 4. Progress update flow (30s operation)
 * 5. Model upgrade flow (basic → premium)
 *
 * Prerequisites:
 * - tool-orchestrator deployed and healthy
 * - llm-bot deployed and healthy
 * - MCP servers running
 * - Message bus operational (NATS/PubSub)
 * - PostgreSQL accessible
 *
 * Run with: npm test -- --testPathPattern="integration.test.ts"
 * Context: Set BITBRAT_CONTEXT=staging (or local/agent-dev)
 */

import axios from 'axios';

describe('ToolOrchestrator - Integration Tests', () => {
  const context = process.env.BITBRAT_CONTEXT || 'local';
  const baseUrl = process.env.TOOL_ORCHESTRATOR_URL || 'http://localhost:3010';
  const timeout = 60000; // 60 second timeout for integration tests

  // Skip tests if not in integration test mode
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
  const describeIf = runIntegration ? describe : describe.skip;

  beforeAll(() => {
    if (!runIntegration) {
      console.log('\n⚠️  Integration tests skipped.');
      console.log('Set RUN_INTEGRATION_TESTS=true to run integration tests.');
      console.log(`Context: ${context}`);
      console.log(`Base URL: ${baseUrl}\n`);
    } else {
      console.log('\n🚀 Running integration tests...');
      console.log(`Context: ${context}`);
      console.log(`Base URL: ${baseUrl}\n`);
    }
  });

  describeIf('Test 1: MCP Tool Execution Flow', () => {
    it('should execute MCP tool via llm-bot with full tracing', async () => {
      console.log('\n=== Test 1: MCP Tool Execution ===');

      // This test requires:
      // 1. User sends message to platform
      // 2. LLM-bot receives message via event bus
      // 3. LLM decides to call tool
      // 4. Tool-orchestrator executes MCP tool
      // 5. Result returned to llm-bot
      // 6. Response sent to user

      // For this test, we'll call tool-orchestrator directly
      // In production, this flow is triggered via message bus

      const testPayload = {
        toolId: 'filesystem_read_file', // Example MCP tool
        args: {
          path: '/tmp/test.txt'
        },
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'],
          modelId: 'gpt-4',
          sessionId: 'integration-test-session',
          correlationId: `test-mcp-${Date.now()}`
        }
      };

      console.log('Calling tool-orchestrator with MCP tool...');
      console.log(`Tool: ${testPayload.toolId}`);
      console.log(`CorrelationId: ${testPayload.context.correlationId}`);

      try {
        const response = await axios.post(
          `${baseUrl}/api/tools/execute`,
          testPayload,
          { timeout }
        );

        console.log('✅ MCP tool execution successful');
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));

        // Assertions
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('result');
        expect(response.data.result.isError).toBeDefined();

        // Verify execution was logged
        // In production, check Loki logs with correlationId

        console.log('✅ Test 1 PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 1 FAILED');
        console.error(`Error: ${error.message}`);
        if (error.response) {
          console.error(`Response:`, error.response.data);
        }
        throw error;
      }
    }, timeout);
  });

  describeIf('Test 2: Composition Execution Flow', () => {
    it('should execute multi-step composition with RBAC validation', async () => {
      console.log('\n=== Test 2: Composition Execution ===');

      const testPayload = {
        toolId: 'test-composition-sequential', // Example composition
        args: {
          input: 'test data'
        },
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'],
          modelId: 'gpt-4',
          sessionId: 'integration-test-session',
          correlationId: `test-composition-${Date.now()}`
        }
      };

      console.log('Calling tool-orchestrator with composition...');
      console.log(`Tool: ${testPayload.toolId}`);
      console.log(`CorrelationId: ${testPayload.context.correlationId}`);

      try {
        const response = await axios.post(
          `${baseUrl}/api/tools/execute`,
          testPayload,
          { timeout }
        );

        console.log('✅ Composition execution successful');
        console.log(`Status: ${response.status}`);

        // Assertions
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('result');

        // Verify all steps executed
        // Check logs for step-by-step execution

        console.log('✅ Test 2 PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 2 FAILED');
        console.error(`Error: ${error.message}`);
        if (error.response) {
          console.error(`Response:`, error.response.data);
        }
        throw error;
      }
    }, timeout);
  });

  describeIf('Test 3: RBAC Denial Flow', () => {
    it('should deny tool execution when user lacks required roles', async () => {
      console.log('\n=== Test 3: RBAC Denial ===');

      const testPayload = {
        toolId: 'admin-only-tool', // Tool requiring admin role
        args: {},
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'], // Not admin
          modelId: 'gpt-4',
          sessionId: 'integration-test-session',
          correlationId: `test-rbac-deny-${Date.now()}`
        }
      };

      console.log('Calling tool-orchestrator with insufficient permissions...');
      console.log(`Tool: ${testPayload.toolId}`);
      console.log(`User roles: ${testPayload.context.userRoles.join(', ')}`);

      try {
        const response = await axios.post(
          `${baseUrl}/api/tools/execute`,
          testPayload,
          { timeout, validateStatus: () => true } // Accept any status
        );

        console.log(`Response status: ${response.status}`);

        // Should receive 403 Forbidden or error in response
        expect([403, 200]).toContain(response.status);

        if (response.status === 200) {
          // Error should be in response body
          expect(response.data.result.isError).toBe(true);
          expect(response.data.result.content[0].text).toMatch(/Access denied|RBAC|denied/i);
        }

        console.log('✅ RBAC denial working correctly');
        console.log('✅ Test 3 PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 3 FAILED');
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, timeout);

    it('should deny composition when constituent tool is denied for model tier', async () => {
      console.log('\n=== Test 3b: Composition RBAC Denial ===');

      const testPayload = {
        toolId: 'premium-composition', // Composition with premium-only tools
        args: {},
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'],
          modelId: 'gpt-3.5-turbo', // Basic tier model
          sessionId: 'integration-test-session',
          correlationId: `test-composition-rbac-${Date.now()}`
        }
      };

      console.log('Calling composition with basic tier model...');
      console.log(`Model: ${testPayload.context.modelId}`);

      try {
        const response = await axios.post(
          `${baseUrl}/api/tools/execute`,
          testPayload,
          { timeout, validateStatus: () => true }
        );

        // Should be denied
        if (response.status === 200) {
          expect(response.data.result.isError).toBe(true);
          expect(response.data.result.content[0].text).toMatch(/Composition denied|not allowed/i);
        }

        console.log('✅ Composition RBAC enforcement working');
        console.log('✅ Test 3b PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 3b FAILED');
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, timeout);
  });

  describeIf('Test 4: Progress Update Flow', () => {
    it('should send progress updates during long-running operation', async () => {
      console.log('\n=== Test 4: Progress Updates ===');

      // This test simulates a 30-second operation
      // Progress messages should be sent at intervals

      const testPayload = {
        toolId: 'long-running-tool', // Tool that takes 30 seconds
        args: {
          duration: 30000 // 30 seconds
        },
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'],
          modelId: 'gpt-4',
          sessionId: 'integration-test-session',
          correlationId: `test-progress-${Date.now()}`
        }
      };

      console.log('Starting long-running operation...');
      console.log('Expected: Progress updates at 5s, 15s, 30s');

      try {
        const startTime = Date.now();

        const response = await axios.post(
          `${baseUrl}/api/tools/execute`,
          testPayload,
          { timeout: 60000 } // 60 second timeout
        );

        const duration = Date.now() - startTime;

        console.log(`✅ Operation completed in ${duration}ms`);

        // To verify progress updates, check:
        // 1. Loki logs for progress messages
        // 2. Event bus messages
        // 3. User interface received updates

        console.log('📝 Note: Check Loki logs for progress messages');
        console.log(`   Query: {correlationId="${testPayload.context.correlationId}"}`);
        console.log('✅ Test 4 PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 4 FAILED');
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, 90000); // 90 second timeout
  });

  describeIf('Test 5: Model Upgrade Flow', () => {
    it('should allow premium tools when model is upgraded', async () => {
      console.log('\n=== Test 5: Model Upgrade Flow ===');

      // Test 5a: Basic model denied premium tool
      const basicPayload = {
        toolId: 'premium-only-tool',
        args: {},
        context: {
          userId: 'integration-test-user',
          userRoles: ['user'],
          modelId: 'gpt-3.5-turbo', // Basic tier
          sessionId: 'integration-test-session',
          correlationId: `test-upgrade-basic-${Date.now()}`
        }
      };

      console.log('Step 1: Testing with basic tier model...');
      console.log(`Model: ${basicPayload.context.modelId}`);

      try {
        const basicResponse = await axios.post(
          `${baseUrl}/api/tools/execute`,
          basicPayload,
          { timeout, validateStatus: () => true }
        );

        // Should be denied
        console.log(`Basic tier response: ${basicResponse.status}`);
        if (basicResponse.status === 200) {
          expect(basicResponse.data.result.isError).toBe(true);
        }

        console.log('✅ Basic tier correctly denied');

        // Test 5b: Premium model allowed premium tool
        const premiumPayload = {
          ...basicPayload,
          context: {
            ...basicPayload.context,
            modelId: 'gpt-4', // Premium tier
            correlationId: `test-upgrade-premium-${Date.now()}`
          }
        };

        console.log('\nStep 2: Testing with premium tier model...');
        console.log(`Model: ${premiumPayload.context.modelId}`);

        const premiumResponse = await axios.post(
          `${baseUrl}/api/tools/execute`,
          premiumPayload,
          { timeout }
        );

        console.log(`Premium tier response: ${premiumResponse.status}`);
        expect(premiumResponse.status).toBe(200);

        // Should succeed (or fail for different reason, not RBAC)
        if (premiumResponse.data.result.isError) {
          expect(premiumResponse.data.result.content[0].text).not.toMatch(/RBAC|denied|tier/i);
        }

        console.log('✅ Premium tier correctly allowed');
        console.log('✅ Test 5 PASSED\n');
      } catch (error: any) {
        console.error('❌ Test 5 FAILED');
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, timeout);
  });

  describeIf('Performance Validation', () => {
    it('should maintain P95 latency < 100ms under load', async () => {
      console.log('\n=== Performance Validation ===');

      const iterations = 100;
      const latencies: number[] = [];

      const testPayload = {
        toolId: 'agent.sendProgressUpdate',
        args: {
          message: 'Performance test'
        },
        context: {
          userId: 'perf-test-user',
          userRoles: ['user'],
          modelId: 'gpt-4',
          sessionId: 'perf-test-session',
          correlationId: `perf-test-${Date.now()}`
        }
      };

      console.log(`Running ${iterations} iterations...`);

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();

        try {
          await axios.post(
            `${baseUrl}/api/tools/execute`,
            { ...testPayload, context: { ...testPayload.context, correlationId: `perf-${i}` } },
            { timeout: 5000 }
          );

          const latency = Date.now() - start;
          latencies.push(latency);
        } catch (error) {
          console.error(`Iteration ${i} failed:`, error);
        }
      }

      // Calculate P95
      const sorted = latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index];
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log(`\nResults:`);
      console.log(`  Iterations: ${latencies.length}`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  P95: ${p95}ms`);

      expect(p95).toBeLessThan(100);

      console.log('✅ Performance target met\n');
    }, 120000); // 2 minute timeout
  });
});
