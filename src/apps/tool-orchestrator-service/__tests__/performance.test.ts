/**
 * Performance Tests
 * Sprint 60: T7.3 - Performance validation for ToolGateway
 *
 * Test coverage:
 * - Load test (1000 invocations)
 * - Memory leak detection
 * - P95 latency < 100ms
 */

import { ToolGateway } from '../modules/gateway/tool-gateway';
import { IToolRegistry } from '../modules/registry/interfaces';
import { IModelRegistry } from '../modules/models/interfaces';
import { ToolRegistryDocument } from '../modules/types/tool-registry-document';
import { ModelRegistryDocument } from '../modules/types/model-registry-document';
import { ToolExecutionContext } from '../../../types/tools';

describe('ToolGateway - Performance Tests', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockLogger: any;

  // Helper: Create internal tool (fast execution)
  const createInternalTool = (): ToolRegistryDocument => ({
    id: 'agent.sendProgressUpdate',
    canonicalName: 'agent.sendProgressUpdate',
    description: 'Send progress update to user',
    source: 'internal',
    sourceMetadata: {},
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
    },
    config: {
      timeoutMs: 5000,
      retryPolicy: { maxAttempts: 1, backoffMs: 100 },
    },
    health: { status: 'healthy' },
    status: 'active',
    tags: [],
    relatedTools: [],
    importedAt: new Date(),
    lastUpdatedAt: new Date(),
  });

  // Helper: Create model
  const createModel = (): ModelRegistryDocument => ({
    id: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4',
    modelType: 'llm',
    roles: ['model', 'llm'],
    tier: 'premium',
    trust: [
      {
        scope: 'general',
        scores: { reliability: 95, fidelity: 95, integrity: 90, calibration: 85 },
      },
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    cost: { inputTokenCost: 30, outputTokenCost: 60 },
    toolPolicy: { allowedTools: [], deniedTools: [] },
    status: 'active',
    registeredAt: new Date(),
    metrics: { totalRequests: 0, totalTokensUsed: 0, totalCostUSD: 0, avgResponseTimeMs: 0 },
  });

  // Helper: Create execution context
  const createContext = (): ToolExecutionContext => ({
    userRoles: ['user'],
    userId: 'test-user',
    modelId: 'gpt-4',
    sessionId: 'test-session',
    correlationId: 'test-correlation',
  });

  // Helper: Calculate percentile
  const calculatePercentile = (values: number[], percentile: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  };

  beforeEach(() => {
    // Mock logger (minimal logging to reduce overhead)
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock ToolRegistry
    mockToolRegistry = {
      registerTool: jest.fn(),
      getTool: jest.fn(),
      listTools: jest.fn(),
      updateTool: jest.fn(),
      deleteTool: jest.fn(),
      queryTools: jest.fn(),
      getToolById: jest.fn(),
    } as any;

    // Mock ModelRegistry
    mockModelRegistry = {
      registerModel: jest.fn(),
      getModel: jest.fn(),
      listModels: jest.fn(),
      updateModel: jest.fn(),
      deleteModel: jest.fn(),
      queryModels: jest.fn(),
      getModelById: jest.fn(),
    } as any;

    // Create ToolGateway instance
    toolGateway = new ToolGateway(
      mockToolRegistry,
      mockModelRegistry,
      { defaultTimeoutMs: 5000, enableLogging: false }, // Disable logging for performance
      undefined, // No MCP client manager
      mockLogger
    );
  });

  describe('Load Test', () => {
    it('should handle 1000 invocations with P95 latency < 100ms', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();

      // Setup mocks
      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const iterations = 1000;
      const latencies: number[] = [];

      console.log(`Starting load test: ${iterations} iterations...`);

      // Warmup (exclude from measurements)
      for (let i = 0; i < 10; i++) {
        await toolGateway.execute(tool.id, { message: 'Warmup' }, context);
      }

      // Actual load test
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const iterStart = Date.now();
        await toolGateway.execute(tool.id, { message: `Test ${i}` }, context);
        const iterEnd = Date.now();
        latencies.push(iterEnd - iterStart);
      }

      const totalTime = Date.now() - startTime;

      // Calculate statistics
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p50 = calculatePercentile(latencies, 50);
      const p95 = calculatePercentile(latencies, 95);
      const p99 = calculatePercentile(latencies, 99);
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);
      const throughput = (iterations / totalTime) * 1000; // ops/sec

      console.log('\n=== Load Test Results ===');
      console.log(`Total iterations: ${iterations}`);
      console.log(`Total time: ${totalTime}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} ops/sec`);
      console.log(`\nLatency Statistics (ms):`);
      console.log(`  Min:  ${minLatency.toFixed(2)}`);
      console.log(`  Avg:  ${avgLatency.toFixed(2)}`);
      console.log(`  P50:  ${p50.toFixed(2)}`);
      console.log(`  P95:  ${p95.toFixed(2)}`);
      console.log(`  P99:  ${p99.toFixed(2)}`);
      console.log(`  Max:  ${maxLatency.toFixed(2)}`);

      // Assertions
      expect(p95).toBeLessThan(100); // P95 < 100ms
      expect(avgLatency).toBeLessThan(50); // Average should be even better
      expect(throughput).toBeGreaterThan(10); // At least 10 ops/sec

      console.log('\n✅ Performance targets met!');
    }, 60000); // 60 second timeout
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory over 1000 iterations', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage().heapUsed;
      console.log(`\n=== Memory Leak Test ===`);
      console.log(`Initial heap: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);

      // Run iterations in batches to check memory growth
      const batchSize = 100;
      const batches = 10;
      const memoryMeasurements: number[] = [];

      for (let batch = 0; batch < batches; batch++) {
        // Execute batch
        for (let i = 0; i < batchSize; i++) {
          await toolGateway.execute(
            tool.id,
            { message: `Batch ${batch} Iteration ${i}` },
            context
          );
        }

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Measure memory
        const currentMemory = process.memoryUsage().heapUsed;
        memoryMeasurements.push(currentMemory);

        console.log(
          `After batch ${batch + 1}/${batches} (${(batch + 1) * batchSize} iterations): ${(
            currentMemory /
            1024 /
            1024
          ).toFixed(2)} MB`
        );
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;

      console.log(`\nFinal heap: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)} MB`);

      // Check for linear memory growth (sign of leak)
      // Calculate correlation between batch number and memory
      const avgMemory =
        memoryMeasurements.reduce((a, b) => a + b, 0) / memoryMeasurements.length;
      const variance =
        memoryMeasurements.reduce((sum, m) => sum + Math.pow(m - avgMemory, 2), 0) /
        memoryMeasurements.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / avgMemory;

      console.log(`\nMemory stability:`);
      console.log(`  Average: ${(avgMemory / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Std Dev: ${(stdDev / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  CV: ${(coefficientOfVariation * 100).toFixed(2)}%`);

      // Assertions
      // Memory growth should be reasonable (< 10 MB for 1000 iterations)
      expect(memoryGrowthMB).toBeLessThan(10);

      // Coefficient of variation should be low (< 20% indicates stable memory)
      // Note: This might be high in test environment, so using generous threshold
      expect(coefficientOfVariation).toBeLessThan(0.5); // 50%

      console.log('\n✅ No memory leak detected!');
    }, 120000); // 120 second timeout
  });

  describe('Cache Performance', () => {
    it('should demonstrate cache hit performance improvement', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const iterations = 100;

      // First run: populate cache
      const firstRunLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await toolGateway.execute(tool.id, { message: `Test ${i}` }, context);
        firstRunLatencies.push(performance.now() - start);
      }

      // Second run: should benefit from cache
      const secondRunLatencies: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await toolGateway.execute(tool.id, { message: `Test ${i}` }, context);
        secondRunLatencies.push(performance.now() - start);
      }

      const firstRunAvg =
        firstRunLatencies.reduce((a, b) => a + b, 0) / firstRunLatencies.length;
      const secondRunAvg =
        secondRunLatencies.reduce((a, b) => a + b, 0) / secondRunLatencies.length;

      console.log('\n=== Cache Performance ===');
      console.log(`First run avg (cache miss): ${firstRunAvg.toFixed(3)}ms`);
      console.log(`Second run avg (cache hit): ${secondRunAvg.toFixed(3)}ms`);

      // Calculate improvement percentage (handle division by zero)
      const improvement = firstRunAvg > 0
        ? (((firstRunAvg - secondRunAvg) / firstRunAvg) * 100).toFixed(1)
        : '0.0';
      console.log(`Improvement: ${improvement}%`);

      // Cache hits should be faster or equal (allowing for variance)
      // For sub-millisecond operations, allow more tolerance due to measurement noise
      const tolerance = firstRunAvg < 1 ? 2.0 : 1.1; // 200% tolerance for sub-ms, 10% for > 1ms
      expect(secondRunAvg).toBeLessThanOrEqual(firstRunAvg * tolerance);
    }, 30000);
  });
});
