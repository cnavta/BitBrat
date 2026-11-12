/**
 * Composition Execution Tests
 * Sprint 60: T3.4 - Unit tests for composition execution with per-step RBAC
 *
 * Test coverage:
 * - Simple composition (2 steps)
 * - Complex composition (5 steps)
 * - Composition RBAC denial (constituent tool denied)
 * - Composition RBAC success (all tools allowed)
 * - Sequential execution strategy
 * - Parallel execution strategy
 * - Conditional execution strategy
 * - Missing composition metadata
 * - Empty constituent tools list
 * - Composition step error handling
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';
import { McpClientManager } from '../../../../../common/mcp/client-manager';
import { Client } from '@modelcontextprotocol/client';

describe('ToolGateway - Composition Execution', () => {
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

  // Helper: Create constituent tool (MCP tool for testing)
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
        content: [{ type: 'text', text: 'Mock MCP result' }],
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

  describe('Simple Composition (2 steps)', () => {
    it('should execute composition with 2 sequential steps', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext();

      // Mock constituent tools
      const tool1 = createConstituentTool('tool-1');
      const tool2 = createConstituentTool('tool-2');

      mockToolRegistry.getTool
        .mockResolvedValueOnce(composition)  // Main composition
        .mockResolvedValueOnce(tool1)        // tool-1 for RBAC
        .mockResolvedValueOnce(tool2)        // tool-2 for RBAC
        .mockResolvedValueOnce(tool1)        // tool-1 for execution
        .mockResolvedValueOnce(tool2);       // tool-2 for execution

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      // Should return combined results
      expect(result.isError).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.success',
        expect.objectContaining({
          toolId: composition.id,
          strategy: 'sequential',
          stepsExecuted: 2,
        })
      );
    });
  });

  describe('Complex Composition (5 steps)', () => {
    it('should execute composition with 5 sequential steps', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5'],
            strategy: 'sequential',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      // Mock composition tool first
      mockToolRegistry.getTool.mockResolvedValueOnce(composition);

      // Mock all constituent tools for RBAC validation (5 calls)
      for (let i = 1; i <= 5; i++) {
        const tool = createConstituentTool(`tool-${i}`);
        mockToolRegistry.getTool.mockResolvedValueOnce(tool);
      }

      // Mock all constituent tools for execution (5 calls)
      for (let i = 1; i <= 5; i++) {
        const tool = createConstituentTool(`tool-${i}`);
        mockToolRegistry.getTool.mockResolvedValueOnce(tool);
      }

      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.success',
        expect.objectContaining({
          stepsExecuted: 5,
        })
      );
    });
  });

  describe('Composition RBAC', () => {
    it('should deny composition when constituent tool is denied for model', async () => {
      const composition = createCompositionTool();
      const model = createModel({ tier: 'basic' });
      const context = createContext({ modelId: 'gpt-3.5' });

      // tool-1: allowed
      const tool1 = createConstituentTool('tool-1');

      // tool-2: denied for basic tier models
      const tool2 = createConstituentTool('tool-2');
      tool2.rbac.modelTiers.denied = ['basic'];

      mockToolRegistry.getTool
        .mockResolvedValueOnce(composition)
        .mockResolvedValueOnce(tool1)
        .mockResolvedValueOnce(tool2);

      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/Composition denied.*tool-2/);

      // Verify RBAC denial logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.rbac_denied',
        expect.objectContaining({
          constituentToolId: 'tool-2',
          modelId: 'gpt-3.5',
        })
      );
    });

    it('should allow composition when all constituent tools are allowed', async () => {
      const composition = createCompositionTool();
      const model = createModel({ tier: 'premium' });
      const context = createContext();

      // Both tools allowed for premium tier
      const tool1 = createConstituentTool('tool-1');
      tool1.rbac.modelTiers.allowed = ['premium'];

      const tool2 = createConstituentTool('tool-2');
      tool2.rbac.modelTiers.allowed = ['premium'];

      mockToolRegistry.getTool.mockResolvedValue(tool1);
      mockToolRegistry.getTool.mockResolvedValue(tool2);
      mockToolRegistry.getTool.mockResolvedValueOnce(composition);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.rbac_validation_passed',
        expect.objectContaining({
          constituentToolsValidated: 2,
        })
      );
    });

    it('should deny composition when user lacks required roles for constituent tool', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext({ userRoles: ['user'] });

      const tool1 = createConstituentTool('tool-1');

      // tool-2 requires 'admin' role
      const tool2 = createConstituentTool('tool-2');
      tool2.rbac.userRoles.required = ['admin'];

      mockToolRegistry.getTool
        .mockResolvedValueOnce(composition)
        .mockResolvedValueOnce(tool1)
        .mockResolvedValueOnce(tool2);

      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/Composition denied/);
    });
  });

  describe('Execution Strategies', () => {
    it('should execute composition with parallel strategy', async () => {
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

      const tool1 = createConstituentTool('tool-1');
      const tool2 = createConstituentTool('tool-2');

      mockToolRegistry.getTool.mockResolvedValue(tool1);
      mockToolRegistry.getTool.mockResolvedValue(tool2);
      mockToolRegistry.getTool.mockResolvedValueOnce(composition);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(composition.id, {}, context);

      expect(result.isError).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.success',
        expect.objectContaining({
          strategy: 'parallel',
        })
      );
    });

    it('should throw error for conditional strategy (not implemented)', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1', 'tool-2'],
            strategy: 'conditional',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      const tool1 = createConstituentTool('tool-1');
      const tool2 = createConstituentTool('tool-2');

      mockToolRegistry.getTool
        .mockResolvedValueOnce(composition)
        .mockResolvedValueOnce(tool1)
        .mockResolvedValueOnce(tool2);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // Conditional execution not yet implemented - should throw error
      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/Conditional composition not yet implemented/);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when composition metadata is missing', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {},  // No composition metadata
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(composition);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/missing metadata/);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.missing_metadata',
        expect.objectContaining({
          toolId: composition.id,
        })
      );
    });

    it('should throw error when composition has no constituent tools', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: [],  // Empty toolIds
            strategy: 'sequential',
          },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(composition);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/no constituent tools/);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.no_constituent_tools',
        expect.objectContaining({
          toolId: composition.id,
        })
      );
    });

    it('should throw error for unknown composition strategy', async () => {
      const composition = createCompositionTool({
        sourceMetadata: {
          composition: {
            toolIds: ['tool-1'],
            strategy: 'unknown-strategy' as any,
          },
        },
      });
      const model = createModel();
      const context = createContext();

      const tool1 = createConstituentTool('tool-1');

      mockToolRegistry.getTool
        .mockResolvedValueOnce(composition)
        .mockResolvedValueOnce(tool1);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(composition.id, {}, context)
      ).rejects.toThrow(/Unknown composition strategy/);
    });
  });

  describe('Logging & Metrics', () => {
    it('should log composition execution start, RBAC validation, and success', async () => {
      const composition = createCompositionTool();
      const model = createModel();
      const context = createContext();

      const tool1 = createConstituentTool('tool-1');
      const tool2 = createConstituentTool('tool-2');

      mockToolRegistry.getTool.mockResolvedValue(tool1);
      mockToolRegistry.getTool.mockResolvedValue(tool2);
      mockToolRegistry.getTool.mockResolvedValueOnce(composition);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await toolGateway.execute(composition.id, {}, context);

      // Verify logging sequence
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.start',
        expect.any(Object)
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.rbac_validation_start',
        expect.any(Object)
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.rbac_validation_passed',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'tool_gateway.execute_composition.success',
        expect.objectContaining({
          durationMs: expect.any(Number),
        })
      );
    });
  });
});
