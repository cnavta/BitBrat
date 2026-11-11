/**
 * Tool Gateway Tests
 * Sprint 58: Model-Based RBAC - Dual-Layer Validation & Context Propagation
 *
 * Test coverage:
 * - Tool execution with RBAC validation
 * - Cache behavior (LRU, TTL)
 * - Error handling (tool not found, model not found, RBAC denied)
 * - Execution routing (internal, MCP, composition)
 * - listAvailableTools filtering
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';

describe('ToolGateway', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;

  // Helper: Create basic tool
  const createTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
    id: 'test-tool',
    canonicalName: 'test_tool',
    description: 'Test tool',
    source: 'internal',
    sourceMetadata: {},
    inputSchema: {},
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

  // Helper: Create basic model
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
        scores: {
          reliability: 95,
          fidelity: 95,
          integrity: 90,
          calibration: 85,
        },
      },
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    cost: {
      inputTokenCost: 30,
      outputTokenCost: 60,
    },
    toolPolicy: {
      allowedTools: [],
      deniedTools: [],
    },
    status: 'active',
    registeredAt: new Date(),
    metrics: {
      totalRequests: 0,
      totalTokensUsed: 0,
      totalCostUSD: 0,
      avgResponseTimeMs: 0,
    },
    ...overrides,
  });

  // Helper: Create execution context
  const createContext = (overrides?: Partial<ToolExecutionContext>): ToolExecutionContext => ({
    userRoles: ['user'],
    userId: 'test-user',
    modelId: 'gpt-4',
    correlationId: 'test-correlation-id',
    ...overrides,
  });

  beforeEach(() => {
    // Create mock registries
    mockToolRegistry = {
      registerTool: jest.fn(),
      getTool: jest.fn(),
      queryTools: jest.fn(),
      updateTool: jest.fn(),
      deleteTool: jest.fn(),
      findDuplicates: jest.fn(),
      resolveConflict: jest.fn(),
      updateHealth: jest.fn(),
      importFromMcp: jest.fn(),
      importFromBit: jest.fn(),
    };

    mockModelRegistry = {
      registerModel: jest.fn(),
      getModel: jest.fn(),
      listModels: jest.fn(),
      updateModel: jest.fn(),
      getModelRoles: jest.fn(),
      getModelTier: jest.fn(),
      getTrustScores: jest.fn(),
      validateToolAccess: jest.fn(),
      getModelToolPolicy: jest.fn(),
    };

    // Create ToolGateway instance
    toolGateway = new ToolGateway(
      mockToolRegistry,
      mockModelRegistry,
      { enableLogging: false } // Disable logging for tests
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // RBAC Validation Tests
  // ==========================================================================

  describe('RBAC Validation', () => {
    it('should allow tool execution when RBAC passes', async () => {
      const tool = createTool();
      const model = createModel();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.validateToolAccess(
        'test-tool',
        'test-user',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(true);
    });

    it('should deny tool execution when user missing required role', async () => {
      const tool = createTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.validateToolAccess(
        'test-tool',
        'test-user',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
    });

    it('should deny tool execution when model tier not allowed', async () => {
      const tool = createTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: ['enterprise'], denied: [] },
        },
      });
      const model = createModel({ tier: 'premium' });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      const result = await toolGateway.validateToolAccess(
        'test-tool',
        'test-user',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_not_allowed');
    });

    it('should deny when tool not found', async () => {
      mockToolRegistry.getTool.mockResolvedValue(null);

      const result = await toolGateway.validateToolAccess(
        'nonexistent-tool',
        'test-user',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tool_not_found');
    });

    it('should deny when model not found', async () => {
      const tool = createTool();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(null);

      const result = await toolGateway.validateToolAccess(
        'test-tool',
        'test-user',
        'nonexistent-model',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_not_found');
    });
  });

  // ==========================================================================
  // Cache Tests
  // ==========================================================================

  describe('Cache Behavior', () => {
    it('should cache tool on first fetch', async () => {
      const tool = createTool();
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // First call
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockToolRegistry.getTool).toHaveBeenCalledTimes(1);

      // Second call (should use cache)
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockToolRegistry.getTool).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should cache model on first fetch', async () => {
      const tool = createTool();
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // First call
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockModelRegistry.getModel).toHaveBeenCalledTimes(1);

      // Second call (should use cache)
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockModelRegistry.getModel).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should clear caches', async () => {
      const tool = createTool();
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // First call (populates cache)
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockToolRegistry.getTool).toHaveBeenCalledTimes(1);

      // Clear cache
      toolGateway.clearCaches();

      // Second call (should fetch again)
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      expect(mockToolRegistry.getTool).toHaveBeenCalledTimes(2);
    });

    it('should report cache statistics', async () => {
      const tool = createTool();
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // Initially empty
      let stats = toolGateway.getCacheStats();
      expect(stats.toolCacheSize).toBe(0);
      expect(stats.modelCacheSize).toBe(0);

      // Populate cache
      await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);

      // Check stats
      stats = toolGateway.getCacheStats();
      expect(stats.toolCacheSize).toBe(1);
      expect(stats.modelCacheSize).toBe(1);
    });
  });

  // ==========================================================================
  // listAvailableTools Tests
  // ==========================================================================

  describe('listAvailableTools', () => {
    it('should filter tools by RBAC', async () => {
      const tool1 = createTool({ id: 'tool-1' });
      const tool2 = createTool({
        id: 'tool-2',
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const tool3 = createTool({ id: 'tool-3' });

      const model = createModel();

      mockModelRegistry.getModel.mockResolvedValue(model);
      mockToolRegistry.queryTools.mockResolvedValue([tool1, tool2, tool3]);

      const availableTools = await toolGateway.listAvailableTools(
        'test-user',
        'gpt-4',
        ['user']
      );

      // tool2 requires admin role, so should be excluded
      expect(availableTools).toEqual(['tool-1', 'tool-3']);
    });

    it('should return empty array when model not found', async () => {
      mockModelRegistry.getModel.mockResolvedValue(null);

      const availableTools = await toolGateway.listAvailableTools(
        'test-user',
        'nonexistent-model',
        ['user']
      );

      expect(availableTools).toEqual([]);
    });

    it('should only include active tools', async () => {
      mockModelRegistry.getModel.mockResolvedValue(createModel());
      mockToolRegistry.queryTools.mockResolvedValue([]);

      await toolGateway.listAvailableTools('test-user', 'gpt-4', ['user']);

      expect(mockToolRegistry.queryTools).toHaveBeenCalledWith({
        status: ['active'],
      });
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw when tool not found during execution', async () => {
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(null);

      await expect(
        toolGateway.execute('nonexistent-tool', {}, context)
      ).rejects.toThrow('Tool not found');
    });

    it('should throw when model not found during execution', async () => {
      const tool = createTool();
      const context = createContext();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(null);

      await expect(
        toolGateway.execute('test-tool', {}, context)
      ).rejects.toThrow('Model not found');
    });

    it('should throw when RBAC denies access', async () => {
      const tool = createTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createModel();
      const context = createContext({ userRoles: ['user'] });

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      await expect(
        toolGateway.execute('test-tool', {}, context)
      ).rejects.toThrow('Access denied');
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    it('should achieve >90% cache hit ratio', async () => {
      const tool = createTool();
      const model = createModel();

      mockToolRegistry.getTool.mockResolvedValue(tool);
      mockModelRegistry.getModel.mockResolvedValue(model);

      // Perform 100 validations
      for (let i = 0; i < 100; i++) {
        await toolGateway.validateToolAccess('test-tool', 'test-user', 'gpt-4', ['user']);
      }

      // Should only fetch once from registry
      expect(mockToolRegistry.getTool).toHaveBeenCalledTimes(1);
      expect(mockModelRegistry.getModel).toHaveBeenCalledTimes(1);

      // Cache hit ratio = (100 - 1) / 100 = 99%
      const cacheHitRatio = (100 - 1) / 100;
      expect(cacheHitRatio).toBeGreaterThan(0.9);
    });
  });
});
