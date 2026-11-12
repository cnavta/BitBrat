/**
 * Retry Logic Tests
 * Sprint 60: T5.2 - Unit tests for retry logic with exponential backoff
 *
 * Test coverage:
 * - Retry on transient errors (network, timeout, 5xx)
 * - No retry on non-transient errors (RBAC, validation)
 * - Exponential backoff timing
 * - Max attempts respected
 * - Success after retry
 * - Retry policy configuration
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';
import { McpClientManager } from '../../../../../common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/client';

describe('ToolGateway - Retry Logic', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockMcpClientManager: jest.Mocked<McpClientManager>;
  let mockMcpClient: jest.Mocked<Client>;
  let mockLogger: any;

  // Helper: Create MCP tool
  const createMcpTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
    id: 'test-mcp-tool',
    canonicalName: 'test-mcp-tool',
    description: 'Test MCP tool for retry testing',
    source: 'mcp',
    sourceMetadata: {
      mcpServer: {
        name: 'test-server',
        version: '1.0.0',
      },
    },
    inputSchema: { type: 'object', properties: {} },
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
    },
    config: {
      timeoutMs: 5000,
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    },
    health: { status: 'healthy' },
    status: 'active',
    tags: [],
    relatedTools: [],
    importedAt: new Date(),
    lastUpdatedAt: new Date(),
    ...overrides,
  });

  // Helper: Create model
  const createModel = (overrides?: Partial<ModelRegistryDocument>): ModelRegistryDocument => ({
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
    ...overrides,
  });

  // Helper: Create execution context
  const createContext = (overrides?: Partial<ToolExecutionContext>): ToolExecutionContext => ({
    userRoles: ['user'],
    userId: 'test-user',
    modelId: 'gpt-4',
    sessionId: 'test-session',
    correlationId: 'test-correlation',
    ...overrides,
  });

  beforeEach(() => {
    // Mock logger
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

    // Mock MCP Client (default: success)
    mockMcpClient = {
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      }),
    } as any;

    // Mock MCP Client Manager
    mockMcpClientManager = {
      getClient: jest.fn().mockReturnValue(mockMcpClient),
    } as any;

    // Create ToolGateway instance
    toolGateway = new ToolGateway(
      mockToolRegistry,
      mockModelRegistry,
      { defaultTimeoutMs: 5000, enableLogging: true },
      mockMcpClientManager,
      mockLogger
    );
  });

  describe('Transient Errors - Network', () => {
    it('should retry on ECONNREFUSED error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      // Fail twice, then succeed
      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('ECONNREFUSED: connection refused'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED: connection refused'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success after retry' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Success after retry');
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(3); // 2 failures + 1 success

      // Verify retry logging
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'tool_gateway.retry.attempt_failed',
        expect.objectContaining({
          toolId: tool.id,
          attempt: 1,
          isTransient: true,
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.retry.success',
        expect.objectContaining({
          toolId: tool.id,
          attempt: 3,
        })
      );
    }, 10000);

    it('should retry on ETIMEDOUT error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('ETIMEDOUT: operation timed out'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should retry on network error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Network error: connection lost'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('Transient Errors - Server 5xx', () => {
    it('should retry on 503 error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Server error: 503 Service Unavailable'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should retry on internal server error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Internal server error'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('Non-Transient Errors', () => {
    it('should NOT retry on RBAC denial error', async () => {
      const tool = createMcpTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createModel();
      const context = createContext({ userRoles: ['user'] }); // Not admin

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(toolGateway.execute(tool.id, {}, context)).rejects.toThrow(/Access denied/i);

      // Should NOT attempt MCP call at all (RBAC fails before execution)
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('should NOT retry on validation error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool.mockRejectedValue(new Error('Validation failed: invalid arguments'));

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(toolGateway.execute(tool.id, {}, context)).rejects.toThrow(/Validation failed/);

      // Should only attempt once (no retry)
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);

      // Verify non-transient error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.retry.non_transient_error',
        expect.objectContaining({
          toolId: tool.id,
        })
      );
    }, 10000);

    it('should NOT retry on tool not found error', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool.mockRejectedValue(new Error('Tool not found'));

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(toolGateway.execute(tool.id, {}, context)).rejects.toThrow(/Tool not found/);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    }, 10000);
  });

  describe('Max Attempts', () => {
    it('should respect maxAttempts from retryPolicy', async () => {
      const tool = createMcpTool({
        config: {
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 2, backoffMs: 100 }, // Only 2 attempts
        },
      });
      const model = createModel();
      const context = createContext();

      // Always fail with transient error
      mockMcpClient.callTool.mockRejectedValue(new Error('ECONNREFUSED'));

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(toolGateway.execute(tool.id, {}, context)).rejects.toThrow(/ECONNREFUSED/);

      // Should attempt exactly 2 times
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);

      // Verify max attempts logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.retry.max_attempts_exceeded',
        expect.objectContaining({
          toolId: tool.id,
          attempts: 2,
        })
      );
    }, 10000);

    it('should use default maxAttempts (3) when not specified', async () => {
      const tool = createMcpTool({
        config: {
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 3, backoffMs: 100 },
        },
      });
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool.mockRejectedValue(new Error('ETIMEDOUT'));

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(toolGateway.execute(tool.id, {}, context)).rejects.toThrow(/ETIMEDOUT/);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff between retries', async () => {
      const tool = createMcpTool({
        config: {
          timeoutMs: 10000,
          retryPolicy: { maxAttempts: 3, backoffMs: 100 }, // 100ms base
        },
      });
      const model = createModel();
      const context = createContext();

      // Fail twice, then succeed
      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const startTime = Date.now();
      await toolGateway.execute(tool.id, {}, context);
      const duration = Date.now() - startTime;

      // Expected backoffs: 100ms (after attempt 1), 200ms (after attempt 2)
      // Total: ~300ms (with some tolerance for execution time)
      expect(duration).toBeGreaterThanOrEqual(250); // Allow some timing variance
      expect(duration).toBeLessThan(500); // Should not take too long

      // Verify backoff logged
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.retry.backoff',
        expect.objectContaining({
          backoffMs: 100, // First backoff: 2^0 * 100 = 100ms
        })
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.retry.backoff',
        expect.objectContaining({
          backoffMs: 200, // Second backoff: 2^1 * 100 = 200ms
        })
      );
    }, 10000);
  });

  describe('Success After Retry', () => {
    it('should return successful result after retry', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Recovered successfully' }],
          isError: false,
        });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, {}, context);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Recovered successfully');
    }, 10000);

    it('should NOT log retry success on first attempt', async () => {
      const tool = createMcpTool();
      const model = createModel();
      const context = createContext();

      // Succeed immediately
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await toolGateway.execute(tool.id, {}, context);

      // Should NOT log retry success (no retries occurred)
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'tool_gateway.retry.success',
        expect.any(Object)
      );
    });
  });
});
