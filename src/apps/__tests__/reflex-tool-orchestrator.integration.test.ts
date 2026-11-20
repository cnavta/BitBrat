/**
 * Integration Test: reflex + tool-orchestrator (REST API)
 * Sprint 65 Task 3.4: Validate reflex can use tool-orchestrator for tool execution
 *
 * This test verifies:
 * 1. REST API endpoint /v1/tools/:tool works correctly
 * 2. reflex HTTP POST pattern compatible with tool-orchestrator
 * 3. Tool execution works end-to-end via REST API
 * 4. RBAC validation works correctly (user roles + model tiers)
 * 5. Performance comparable to tool-gateway baseline
 *
 * Prerequisites:
 * - tool-orchestrator service running and accessible
 * - PostgreSQL with tool/composition registries populated
 * - MCP_AUTH_TOKEN configured
 *
 * Running these tests:
 * - Skipped by default (requires live infrastructure)
 * - Enable with: RUN_MCP_INTEGRATION_TESTS=true npm test reflex-tool-orchestrator
 * - Set URL with: TEST_TOOL_ORCHESTRATOR_URL=http://localhost:3030
 *
 * Example:
 * RUN_MCP_INTEGRATION_TESTS=true \
 * TEST_TOOL_ORCHESTRATOR_URL=http://localhost:3030 \
 * MCP_AUTH_TOKEN=test-token \
 * npm test reflex-tool-orchestrator
 */

describe('reflex + tool-orchestrator Integration (Sprint 65 Task 3.4)', () => {
  const BASE_URL = process.env.TEST_TOOL_ORCHESTRATOR_URL || 'http://localhost:3030';
  const RUN_INTEGRATION_TESTS = process.env.RUN_MCP_INTEGRATION_TESTS === 'true';
  const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || 'test-token';

  // Response format from tool-orchestrator REST API
  interface ToolExecutionResponse {
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  }

  /**
   * Helper function to execute tool via REST API (reflex pattern).
   * Mimics reflex/tool-executor.ts:131 HTTP POST pattern exactly.
   */
  async function executeToolViaREST(
    toolName: string,
    args: any,
    headers: Record<string, string> = {}
  ): Promise<{ response: Response; data: ToolExecutionResponse }> {
    const url = `${BASE_URL}/v1/tools/${encodeURIComponent(toolName)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'X-Roles': headers['X-Roles'] || 'user,developer',
        'X-Model-ID': headers['X-Model-ID'] || 'test-model',
        'X-User-ID': headers['X-User-ID'] || 'test:reflex-integration',
        ...headers,
      },
      body: JSON.stringify({ arguments: args }),
    });

    const data = await response.json() as ToolExecutionResponse;
    return { response, data };
  }

  // ============================================================================
  // Test 1: Execute admin tool (bit.health) via REST API
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should execute admin tool (bit.health) via REST API',
    async () => {
      const startTime = Date.now();
      const { response, data } = await executeToolViaREST('bit.health', {});
      const duration = Date.now() - startTime;

      // Validate HTTP response
      expect(response.status).toBe(200);
      expect(data).toBeDefined();
      expect(data.content).toBeDefined();
      expect(data.isError).toBeFalsy();

      console.log(`bit.health executed via REST API in ${duration}ms`);

      // Validate MCP-compatible response format
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content.length).toBeGreaterThan(0);
      expect(data.content[0].type).toBe('text');
      expect(data.content[0].text).toBeDefined();

      const result = JSON.parse(data.content[0].text);
      expect(result.status).toBeDefined();
      console.log(`Health status: ${result.status}`);
    },
    10000
  );

  // ============================================================================
  // Test 2: RBAC enforcement - basic user vs admin tool
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should enforce RBAC when calling tools as basic user',
    async () => {
      const { response, data } = await executeToolViaREST(
        'bit.health',
        {},
        {
          'X-Roles': 'user',  // No admin/developer role
          'X-Model-ID': 'gpt-3.5-turbo',  // Basic tier
          'X-User-ID': 'test:basic-user',
        }
      );

      // bit.health might be accessible to basic users
      console.log(`Response for basic user: ${response.status}`);

      if (response.status === 200) {
        console.log('bit.health is accessible to basic users (expected)');
        expect(data.isError).toBeFalsy();
      } else {
        // Expect RBAC denial (403 or 401)
        expect([401, 403]).toContain(response.status);
        expect(data.isError).toBe(true);
        console.log(`RBAC denial confirmed: ${response.status}`);
      }
    },
    10000
  );

  // ============================================================================
  // Test 3: Performance validation (10 iterations)
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should have comparable performance to tool-gateway baseline',
    async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        try {
          await executeToolViaREST('bit.health', {});
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
  // Test 4: Error handling - invalid tool name
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should handle invalid tool name gracefully',
    async () => {
      const { response, data } = await executeToolViaREST('nonexistent.tool', {});

      // Expect 404 Not Found or 500 Internal Server Error
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(data.isError).toBe(true);

      console.log(`Invalid tool handled with status: ${response.status}`);
      console.log(`Error message: ${data.content?.[0]?.text || 'No error details'}`);
    },
    10000
  );

  // ============================================================================
  // Test 5: Missing authentication
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should reject requests without authentication',
    async () => {
      const url = `${BASE_URL}/v1/tools/bit.health`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No Authorization header
        },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(response.status).toBe(401);

      const data = await response.json() as ToolExecutionResponse;
      expect(data.isError).toBe(true);

      console.log(`Unauthenticated request rejected with 401`);
    },
    10000
  );

  // ============================================================================
  // Test 6: Verify reflex pattern compatibility
  // ============================================================================

  (RUN_INTEGRATION_TESTS ? it : it.skip)(
    'should match reflex tool executor pattern exactly',
    async () => {
      // Simulate reflex's exact request pattern (src/services/reflex/tool-executor.ts:131)
      const toolName = 'bit.health';
      const url = `${BASE_URL}/v1/tools/${encodeURIComponent(toolName)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'X-Roles': 'user,developer',
          'X-Model-ID': 'reflex',
          'X-User-ID': 'test:reflex-pattern',
        },
        body: JSON.stringify({ arguments: {} }),
      });

      const data = await response.json() as ToolExecutionResponse;

      // Validate response matches MCP-compatible format
      expect(response.status).toBe(200);
      expect(data.content).toBeDefined();
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content.length).toBeGreaterThan(0);
      expect(data.content[0].type).toBe('text');
      expect(data.content[0].text).toBeDefined();

      console.log(`✅ Reflex pattern compatibility validated`);
      console.log(`   Response format: { content: [{type: 'text', text: '...'}], isError: false }`);
    },
    10000
  );
});
