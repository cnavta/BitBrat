/**
 * Graceful Degradation Tests
 * Sprint 60: T5.3 - Unit tests for graceful error handling
 *
 * Test coverage:
 * - Sequential composition step failures
 * - Parallel composition partial failures
 * - Clear error messages with context
 * - Proper logging of failures
 * - No uncaught exceptions
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';
import { McpClientManager } from '../../../../../common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/client';

describe('ToolGateway - Graceful Degradation', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockMcpClientManager: jest.Mocked<McpClientManager>;
  let mockMcpClient: jest.Mocked<Client>;
  let mockLogger: any;

  // Helper: Create composition tool
  const createCompositionTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
    id: 'test-composition',
    canonicalName: 'test-composition',
    description: 'Test composition tool',
    source: 'composition',
    sourceMetadata: {
      composition: {
        toolIds: ['tool-1', 'tool-2'],
        strategy: 'sequential',
      },
    },
    inputSchema: { type: 'object', properties: {} },
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
    },
    config: {
      timeoutMs: 10000,
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

  // Helper: Create constituent tool (MCP tool)
  const createConstituentTool = (id: string): ToolRegistryDocument => ({
    id,
    canonicalName: id,
    description: `Tool ${id}`,
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

    // Mock MCP Client
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
      { defaultTimeoutMs: 10000, enableLogging: true },
      mockMcpClientManager,
      mockLogger
    );
  });

  describe('Sequential Composition Step Failures', () => {
    it('should handle first step failure gracefully', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2', 'tool-3'],
            strategy: 'sequential',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      // Mock composition tool
      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // Mock RBAC validation for all tools
      for (let i = 1; i <= 3; i++) {
        mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool(`tool-${i}`));
      }

      // Mock execution: tool-1 fails
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockRejectedValueOnce(new Error('Tool execution failed'));

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      // Should return error with context
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('step 1/3');
      expect(result.content[0].text).toContain('tool-1');
      expect(result.content[0].text).toContain('Tool execution failed');

      // Should log failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.execute_sequential.step_failed',
        expect.objectContaining({
          toolId: 'tool-1',
          stepIndex: 1,
          totalSteps: 3,
          completedSteps: 0,
        })
      );
    });

    it('should handle mid-step failure gracefully', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2', 'tool-3'],
            strategy: 'sequential',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      for (let i = 1; i <= 3; i++) {
        mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool(`tool-${i}`));
      }

      // Execution: tool-1 succeeds, tool-2 fails
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tool 1 success' }],
        isError: false,
      });

      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));
      mockMcpClient.callTool.mockRejectedValueOnce(new Error('Tool 2 failed'));

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('step 2/3');
      expect(result.content[0].text).toContain('tool-2');
      expect(result.content[0].text).toContain('Tool 2 failed');

      // Verify logging includes completed steps count
      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.execute_sequential.step_failed',
        expect.objectContaining({
          stepIndex: 2,
          completedSteps: 1,
        })
      );
    });

    it('should log all steps completion when successful', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution: both succeed
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tool 1 success' }],
        isError: false,
      });

      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));
      mockMcpClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tool 2 success' }],
        isError: false,
      });

      mockModelRegistry.getModel.mockResolvedValue(model);

      await toolGateway.execute(composition.id, {}, context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_sequential.all_steps_complete',
        expect.objectContaining({
          totalSteps: 2,
        })
      );
    });
  });

  describe('Parallel Composition Partial Failures', () => {
    it('should handle partial failures in parallel execution', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2', 'tool-3'],
            strategy: 'parallel',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      for (let i = 1; i <= 3; i++) {
        mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool(`tool-${i}`));
      }

      // Execution: tool-1 succeeds, tool-2 fails, tool-3 succeeds
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Tool 1 success' }],
          isError: false,
        })
        .mockRejectedValueOnce(new Error('Tool 2 failed'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Tool 3 success' }],
          isError: false,
        });

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('1/3 failures');
      expect(result.content[0].text).toContain('tool-2');
      expect(result.content[0].text).toContain('Tool 2 failed');

      // Should log completion with failure count
      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_parallel.complete',
        expect.objectContaining({
          totalSteps: 3,
          successes: 2,
          failures: 1,
        })
      );
    });

    it('should handle all failures in parallel execution', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2'],
            strategy: 'parallel',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution: both fail
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Tool 1 failed'))
        .mockRejectedValueOnce(new Error('Tool 2 failed'));

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('2/2 failures');
      expect(result.content[0].text).toContain('tool-1');
      expect(result.content[0].text).toContain('tool-2');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_parallel.complete',
        expect.objectContaining({
          successes: 0,
          failures: 2,
        })
      );
    });

    it('should succeed when all parallel steps succeed', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2'],
            strategy: 'parallel',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution: both succeed
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(false);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_parallel.complete',
        expect.objectContaining({
          successes: 2,
          failures: 0,
        })
      );
    });
  });

  describe('Error Message Clarity', () => {
    it('should provide clear error message for sequential failure', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution: tool-1 fails (use non-transient error to avoid retries)
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockRejectedValueOnce(new Error('Invalid input schema'));

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.content[0].text).toMatch(/Sequential composition failed/);
      expect(result.content[0].text).toMatch(/step 1\/2/);
      expect(result.content[0].text).toMatch(/tool: tool-1/);
      expect(result.content[0].text).toMatch(/Invalid input schema/);
    }, 10000);

    it('should provide clear error message for parallel failures', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2'],
            strategy: 'parallel',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution: tool-1 fails
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool
        .mockRejectedValueOnce(new Error('Database connection failed'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          isError: false,
        });

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.content[0].text).toMatch(/Parallel composition had 1\/2 failures/);
      expect(result.content[0].text).toMatch(/- tool-1: Database connection failed/);
    });
  });

  describe('Logging Coverage', () => {
    it('should log step start and success for sequential execution', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      mockModelRegistry.getModel.mockResolvedValue(model);

      await toolGateway.execute(composition.id, {}, context);

      // Should log step start
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_sequential.step_start',
        expect.objectContaining({
          stepIndex: 1,
          totalSteps: 2,
        })
      );

      // Should log step success
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_sequential.step_success',
        expect.objectContaining({
          stepIndex: 1,
        })
      );
    });

    it('should log parallel execution start and step results', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2'],
            strategy: 'parallel',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // RBAC validation
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-1'));
      mockToolRegistry.getTool.mockResolvedValueOnce(createConstituentTool('tool-2'));

      // Execution
      mockToolRegistry.getTool.mockResolvedValue(createConstituentTool('tool-1'));
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
      });

      mockModelRegistry.getModel.mockResolvedValue(model);

      await toolGateway.execute(composition.id, {}, context);

      // Should log parallel start
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_parallel.start',
        expect.objectContaining({
          totalSteps: 2,
        })
      );
    });
  });
});
