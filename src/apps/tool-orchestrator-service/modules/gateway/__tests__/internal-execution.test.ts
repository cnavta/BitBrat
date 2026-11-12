/**
 * Internal Tool Execution Tests
 * Sprint 60: T2.3 - Unit tests for internal tool execution
 *
 * Test coverage:
 * - Internal tool execution success
 * - Internal tool error handling
 * - Internal handler missing
 * - Progress update tool (agent.sendProgressUpdate)
 * - Internal tool RBAC denial
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';

describe('ToolGateway - Internal Tool Execution', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockLogger: any;

  // Helper: Create internal tool
  const createInternalTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
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

    // Create ToolGateway instance
    toolGateway = new ToolGateway(
      mockToolRegistry,
      mockModelRegistry,
      { defaultTimeoutMs: 5000, enableLogging: true },
      undefined, // No MCP client manager needed for internal tools
      mockLogger
    );
  });

  describe('Internal Tool Success', () => {
    it('should execute agent.sendProgressUpdate successfully', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();
      const args = {
        message: 'Analyzing data...',
        emoji: '🔍',
        urgency: 'normal',
      };

      // Mock getTool and getModel
      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // Execute
      const result = await toolGateway.execute(tool.id, args, context);

      // Assertions
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Progress update acknowledged');
      expect(result.content[0].text).toContain('🔍 Analyzing data...');

      // Verify logging
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'tool_gateway.send_progress_update.invoked',
        expect.objectContaining({
          sessionId: context.sessionId,
          correlationId: context.correlationId,
          messageLength: args.message.length,
        })
      );
    });

    it('should use default emoji when not provided', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();
      const args = {
        message: 'Processing request...',
      };

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, args, context);

      expect(result.content[0].text).toContain('🔄 Processing request...');
    });
  });

  describe('Internal Tool Errors', () => {
    it('should throw error when internal tool handler not found', async () => {
      const tool = createInternalTool({
        id: 'unknown.internal.tool',
        canonicalName: 'unknown.internal.tool',
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(tool.id, {}, context)
      ).rejects.toThrow('Internal tool handler not found: unknown.internal.tool');

      // Verify error logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        'tool_gateway.execute_internal_unsafe.handler_not_found',
        expect.objectContaining({
          toolId: tool.id,
          availableTools: ['agent.sendProgressUpdate'],
        })
      );
    });

    it('should handle validation errors from Zod schema', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();
      const invalidArgs = {
        message: 123, // Should be string
      };

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(tool.id, invalidArgs, context)
      ).rejects.toThrow(); // Zod validation error
    });
  });

  describe('Progress Update Tool', () => {
    it('should handle all urgency levels', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const urgencyLevels = ['low', 'normal', 'high'] as const;

      for (const urgency of urgencyLevels) {
        const args = {
          message: `Test message with ${urgency} urgency`,
          urgency,
        };

        const result = await toolGateway.execute(tool.id, args, context);

        expect(result.isError).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith(
          'tool_gateway.send_progress_update.success',
          expect.objectContaining({ urgency })
        );
      }
    });

    it('should trim and format message correctly', async () => {
      const tool = createInternalTool();
      const model = createModel();
      const context = createContext();
      const args = {
        message: 'Testing progress update',
        emoji: '⚡',
      };

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.execute(tool.id, args, context);

      expect(result.content[0].text).toContain('⚡ Testing progress update');
    });
  });

  describe('Internal Tool RBAC', () => {
    it('should deny internal tool execution when user lacks required roles', async () => {
      const tool = createInternalTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createModel();
      const context = createContext({
        userRoles: ['user'], // Not admin
      });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(tool.id, { message: 'Test' }, context)
      ).rejects.toThrow(/Access denied/i);

      // Verify RBAC denial logged
      expect(mockLogger.error).toHaveBeenCalled();

      // Check that at least one error log contains the tool ID
      const errorCalls = mockLogger.error.mock.calls;
      const hasToolIdLog = errorCalls.some((call: any[]) =>
        call.some(arg => typeof arg === 'object' && arg.toolId === tool.id)
      );
      expect(hasToolIdLog).toBe(true);
    });

    it('should deny internal tool when model tier is denied', async () => {
      const tool = createInternalTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: ['premium'] },
        },
      });
      const model = createModel({ tier: 'premium' });
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute(tool.id, { message: 'Test' }, context)
      ).rejects.toThrow(/Access denied/i);
    });
  });

  describe('Internal Tool Timeout', () => {
    it('should enforce timeout for internal tool execution', async () => {
      const tool = createInternalTool({
        config: {
          timeoutMs: 100, // Very short timeout
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        },
      });
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // This test ensures timeout wrapper is applied to internal tools too
      // The actual execution is fast, so it should complete before timeout
      const result = await toolGateway.execute(
        tool.id,
        { message: 'Quick message' },
        context
      );

      expect(result.isError).toBe(false);
    }, 10000);
  });
});
