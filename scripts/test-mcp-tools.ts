/**
 * MCP Tools Integration Test Script
 *
 * Tests MCP tools in any execution context (local, staging, production).
 * Validates tool-orchestrator deployment and new Sprint 63 features:
 * - model.register
 * - model.get
 * - tool.update_config
 * - tool.import (stub)
 *
 * Usage:
 *   npm run test:mcp              # Test local context
 *   npm run test:mcp staging      # Test staging context
 *   npm run test:mcp --url http://custom:3000/mcp --token xyz
 */

import { McpTestClient, createMcpClientForContext } from '../tools/test-utils/mcp-client';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

interface TestResult {
  test: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

/**
 * Run a test and record result
 */
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ test: name, passed: true, duration });
    logger.info({ test: name, duration }, '✓ PASS');
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ test: name, passed: false, duration, error });
    logger.error({ test: name, duration, error }, '✗ FAIL');
  }
}

/**
 * Test Suite: MCP Connection and Discovery
 */
async function testConnection(client: McpTestClient): Promise<void> {
  await runTest('MCP: Initialize connection', async () => {
    await client.initialize();
  });

  await runTest('MCP: List tools', async () => {
    const tools = await client.listTools();
    if (tools.length === 0) {
      throw new Error('No tools found - expected at least 10');
    }
    logger.info({ toolCount: tools.length }, 'Tools discovered');
    results[results.length - 1].details = { toolCount: tools.length };
  });
}

/**
 * Test Suite: Model Registry Tools (Sprint 63)
 */
async function testModelRegistry(client: McpTestClient): Promise<void> {
  const testModelId = `test-model-${Date.now()}`;

  // Test 1: Register a new model
  await runTest('model.register: Create new model', async () => {
    const result = await client.callTool('model.register', {
      id: testModelId,
      provider: 'test-provider',
      displayName: 'Test Model',
      modelType: 'llm',
      tier: 'basic',
      capabilities: {
        toolCalling: true,
        vision: false,
        streaming: true,
        maxContextTokens: 8192,
        maxOutputTokens: 2048,
      },
      cost: {
        inputTokenCost: 1.0,
        outputTokenCost: 2.0,
      },
    });

    McpTestClient.assertSuccess(result, 'model.register failed');
    const text = McpTestClient.extractText(result);
    if (!text.includes(testModelId)) {
      throw new Error(`Expected response to mention model ID ${testModelId}`);
    }
    logger.info({ modelId: testModelId }, 'Model registered');
  });

  // Test 2: Retrieve the model
  await runTest('model.get: Retrieve registered model', async () => {
    const result = await client.callTool('model.get', { id: testModelId });

    McpTestClient.assertSuccess(result, 'model.get failed');
    const model = McpTestClient.parseJson(result);

    if (model.id !== testModelId) {
      throw new Error(`Expected model.id=${testModelId}, got ${model.id}`);
    }
    if (model.provider !== 'test-provider') {
      throw new Error(`Expected provider=test-provider, got ${model.provider}`);
    }
    if (model.tier !== 'basic') {
      throw new Error(`Expected tier=basic, got ${model.tier}`);
    }

    logger.info({ model }, 'Model retrieved successfully');
    results[results.length - 1].details = { model };
  });

  // Test 3: Verify idempotence - re-register should update
  await runTest('model.register: Idempotent update', async () => {
    const result = await client.callTool('model.register', {
      id: testModelId,
      provider: 'test-provider',
      displayName: 'Test Model (Updated)',
      modelType: 'llm',
      tier: 'premium', // Changed tier
      capabilities: {
        toolCalling: true,
        vision: true, // Changed capability
        streaming: true,
        maxContextTokens: 16384, // Changed
        maxOutputTokens: 4096, // Changed
      },
      cost: {
        inputTokenCost: 5.0, // Changed
        outputTokenCost: 10.0, // Changed
      },
    });

    McpTestClient.assertSuccess(result, 'model.register update failed');

    // Verify changes persisted
    const getResult = await client.callTool('model.get', { id: testModelId });
    const updated = McpTestClient.parseJson(getResult);

    if (updated.tier !== 'premium') {
      throw new Error(`Expected tier to update to premium, got ${updated.tier}`);
    }
    if (!updated.capabilities.vision) {
      throw new Error('Expected vision capability to update to true');
    }

    logger.info('Model updated successfully');
  });
}

/**
 * Test Suite: Tool Registry Tools (Sprint 63)
 */
async function testToolRegistry(client: McpTestClient): Promise<void> {
  // Test 1: Update tool configuration
  await runTest('tool.update_config: Update tool timeout', async () => {
    const result = await client.callTool('tool.update_config', {
      toolId: 'bit.info',
      config: {
        timeoutMs: 10000,
        maxRetryAttempts: 3,
      },
    });

    McpTestClient.assertSuccess(result, 'tool.update_config failed');
    const text = McpTestClient.extractText(result);
    if (!text.includes('bit.info') && !text.includes('updated')) {
      logger.warn({ text }, 'Unexpected response format');
    }
  });

  // Test 2: Update tool RBAC
  await runTest('tool.update_config: Update tool RBAC', async () => {
    const result = await client.callTool('tool.update_config', {
      toolId: 'bit.info',
      config: {
        rbac: {
          allowedRoles: ['admin', 'developer'],
          allowedUserIds: [],
          deniedRoles: [],
          deniedUserIds: [],
        },
      },
    });

    McpTestClient.assertSuccess(result, 'tool.update_config RBAC failed');
  });

  // Test 3: tool.import (stub implementation)
  await runTest('tool.import: Stub implementation', async () => {
    const result = await client.callTool('tool.import', {
      source: 'mcp',
      serverId: 'test-server',
      toolIds: ['test-tool-1', 'test-tool-2'],
    });

    // Stub implementation - expect either success or specific error message
    if (result.isError) {
      const error = McpTestClient.extractText(result);
      if (!error.includes('not implemented') && !error.includes('stub')) {
        throw new Error(`Unexpected error: ${error}`);
      }
      logger.info('tool.import stub confirmed');
    } else {
      logger.info('tool.import executed (implementation may be complete)');
    }
  });
}

/**
 * Test Suite: Seed Data Verification
 */
async function testSeedData(client: McpTestClient): Promise<void> {
  const expectedModels = [
    'gpt-4',
    'gpt-4-turbo',
    'claude-opus-3.5',
    'claude-sonnet-3.5',
    'gpt-3.5-turbo',
    'ollama/llama3',
    'gpt-4o-mini',
    'claude-haiku-3.5',
    'reflex',
    'system',
  ];

  for (const modelId of expectedModels) {
    await runTest(`Seed Data: Verify ${modelId} exists`, async () => {
      const result = await client.callTool('model.get', { id: modelId });
      McpTestClient.assertSuccess(result, `Model ${modelId} not found`);

      const model = McpTestClient.parseJson(result);
      if (model.id !== modelId) {
        throw new Error(`Expected id=${modelId}, got ${model.id}`);
      }

      logger.debug({ modelId, provider: model.provider }, 'Seed model verified');
    });
  }
}

/**
 * Print test summary
 */
function printSummary(): void {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const duration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '='.repeat(60));
  console.log('MCP TOOLS TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total:   ${total}`);
  console.log(`Passed:  ${passed} ✓`);
  console.log(`Failed:  ${failed} ✗`);
  console.log(`Duration: ${duration}ms`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\nFailed Tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ✗ ${r.test}`);
        console.log(`    ${r.error}`);
      });
  }

  console.log('');
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let client: McpTestClient;

  // Parse arguments
  if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url');
    const url = args[urlIndex + 1];
    const tokenIndex = args.indexOf('--token');
    const authToken = tokenIndex >= 0 ? args[tokenIndex + 1] : undefined;

    logger.info({ url }, 'Creating client with custom URL');
    client = new McpTestClient({ url, authToken });
  } else {
    const context = args[0] || 'local';
    logger.info({ context }, 'Creating client for context');
    client = await createMcpClientForContext(context);
  }

  logger.info('Starting MCP tools integration tests...');

  try {
    // Test suites
    await testConnection(client);
    await testModelRegistry(client);
    await testToolRegistry(client);
    await testSeedData(client);

    printSummary();

    // Exit with code based on results
    const failed = results.filter(r => !r.passed).length;
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Test suite failed');
    printSummary();
    process.exit(1);
  }
}

// Run tests
main();
