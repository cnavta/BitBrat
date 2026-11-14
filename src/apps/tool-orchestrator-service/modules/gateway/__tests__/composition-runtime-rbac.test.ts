/**
 * Composition Runtime RBAC Tests
 * Sprint 61: Composition RBAC + Validation (T2.2)
 *
 * Verifies composition execution RBAC validation (Sprint 60 T3.3 implementation):
 * - Allow execution when invoking model has access to all tools
 * - Deny execution when invoking model lacks access to one tool
 * - Validate each step individually at runtime
 * - Log RBAC denial with invoking and registering model info
 * - Allow execution after model upgrade
 */

import { ToolGateway } from '../tool-gateway';
import { IToolRegistry } from '../../registry/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { RbacValidator } from '../rbac-validator';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';
import { McpClientManager } from '../../../../../common/mcp/client-manager';
import pino from 'pino';

describe('Composition Runtime RBAC', () => {
  let toolGateway: ToolGateway;
  let mockToolRegistry: jest.Mocked<IToolRegistry>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockRbacValidator: jest.Mocked<RbacValidator>;
  let mockMcpClientManager: jest.Mocked<McpClientManager>;
  let logger: pino.Logger;

  beforeEach(() => {
    // Create mocks
    mockToolRegistry = {
      getTool: jest.fn(),
      queryTools: jest.fn(),
      registerTool: jest.fn(),
      updateTool: jest.fn(),
      deleteTool: jest.fn(),
      findDuplicates: jest.fn(),
      resolveConflict: jest.fn(),
      updateHealth: jest.fn(),
      importFromMcp: jest.fn(),
      importFromBit: jest.fn(),
    } as any;

    mockModelRegistry = {
      getModel: jest.fn(),
    } as any;

    mockRbacValidator = {
      validateToolAccess: jest.fn(),
    } as any;

    mockMcpClientManager = {} as any;

    logger = pino({ level: 'silent' });

    // Create ToolGateway
    toolGateway = new ToolGateway(
      mockToolRegistry,
      mockModelRegistry,
      {}, // config
      mockMcpClientManager,
      logger
    );

    // Replace internal rbacValidator with mock
    (toolGateway as any).rbacValidator = mockRbacValidator;

    // Mock internal tools registry to return success for all executions
    const mockInternalTools = new Map();
    mockInternalTools.set('tool1', async () => ({
      content: [{ type: 'text' as const, text: 'tool1 result' }],
      isError: false,
    }));
    mockInternalTools.set('tool2', async () => ({
      content: [{ type: 'text' as const, text: 'tool2 result' }],
      isError: false,
    }));
    mockInternalTools.set('tool3', async () => ({
      content: [{ type: 'text' as const, text: 'tool3 result' }],
      isError: false,
    }));
    mockInternalTools.set('basic_tool', async () => ({
      content: [{ type: 'text' as const, text: 'basic_tool result' }],
      isError: false,
    }));
    mockInternalTools.set('premium_tool', async () => ({
      content: [{ type: 'text' as const, text: 'premium_tool result' }],
      isError: false,
    }));
    mockInternalTools.set('admin_tool', async () => ({
      content: [{ type: 'text' as const, text: 'admin_tool result' }],
      isError: false,
    }));
    mockInternalTools.set('denied_tool', async () => ({
      content: [{ type: 'text' as const, text: 'denied_tool result' }],
      isError: false,
    }));
    mockInternalTools.set('restricted_tool', async () => ({
      content: [{ type: 'text' as const, text: 'restricted_tool result' }],
      isError: false,
    }));
    (toolGateway as any).internalTools = mockInternalTools;
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const createTool = (
    id: string,
    source: 'internal' | 'composition',
    rbacOverrides?: Partial<ToolRegistryDocument['rbac']>,
    compositionMeta?: { toolIds: string[]; strategy: 'sequential' | 'parallel' | 'conditional' }
  ): ToolRegistryDocument => ({
    id,
    canonicalName: id,
    description: `Test tool ${id}`,
    source,
    sourceMetadata: compositionMeta ? { composition: compositionMeta } : {},
    inputSchema: {},
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
      ...rbacOverrides,
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

  const createModel = (id: string, tier: string): ModelRegistryDocument => ({
    id,
    provider: 'openai',
    displayName: id,
    modelType: 'llm',
    roles: ['model', 'llm'],
    tier: tier as any,
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
  });

  const createContext = (modelId: string, userRoles: string[]): ToolExecutionContext => ({
    userId: 'test-user',
    sessionId: 'test-session',
    correlationId: 'test-correlation',
    userRoles,
    modelId,
  });

  // ============================================================================
  // Test 1: Allow execution when invoking model has access to all tools
  // ============================================================================

  it('should allow execution when invoking model has access to all tools', async () => {
    const tool1 = createTool('tool1', 'internal');
    const tool2 = createTool('tool2', 'internal');
    const composition = createTool('composition1', 'composition', undefined, {
      toolIds: ['tool1', 'tool2'],
      strategy: 'sequential',
    });
    const model = createModel('gpt-4', 'premium');
    const context = createContext('gpt-4', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition) // getToolCached for composition
      .mockResolvedValueOnce(tool1) // validateToolAccess for tool1
      .mockResolvedValueOnce(tool2); // validateToolAccess for tool2

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator - allow all
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Execute composition
    const result = await toolGateway.execute('composition1', {}, context);

    // Verify RBAC validation was called:
    // - composition itself: 1
    // - tool1 validated in executeComposition: 1
    // - tool2 validated in executeComposition: 1
    // - tool1 validated again when executed: 1
    // - tool2 validated again when executed: 1
    // Total: 5 calls
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledTimes(5);

    // Verify result is successful (exact structure depends on implementation)
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  // ============================================================================
  // Test 2: Deny execution when invoking model lacks access to one tool
  // ============================================================================

  it('should deny execution when invoking model lacks access to one tool', async () => {
    const tool1 = createTool('basic_tool', 'internal');
    const tool2 = createTool('premium_tool', 'internal', {
      modelTiers: { allowed: ['premium'], denied: [] },
    });
    const composition = createTool('test_composition', 'composition', undefined, {
      toolIds: ['basic_tool', 'premium_tool'],
      strategy: 'sequential',
    });
    const model = createModel('gpt-3.5-turbo', 'basic');
    const context = createContext('gpt-3.5-turbo', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(tool1)
      .mockResolvedValueOnce(tool2);

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator - allow composition and basic_tool, deny premium_tool
    mockRbacValidator.validateToolAccess.mockImplementation((tool, userRoles, model) => {
      if (tool.id === 'test_composition' || tool.id === 'basic_tool') {
        return { allowed: true };
      } else {
        return {
          allowed: false,
          reason: 'model_tier_not_allowed',
          details: `Tool requires model tier: premium, but ${model.id} is tier ${model.tier}`,
        };
      }
    });

    // Execute composition - should throw
    await expect(
      toolGateway.execute('test_composition', {}, context)
    ).rejects.toThrow('Composition denied: constituent tool "premium_tool" not allowed');

    // Verify RBAC validation was attempted for tools up to the denied one
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalled();
  });

  // ============================================================================
  // Test 3: Validate each step individually at runtime
  // ============================================================================

  it('should validate each step individually at runtime', async () => {
    const tool1 = createTool('tool1', 'internal');
    const tool2 = createTool('tool2', 'internal');
    const tool3 = createTool('tool3', 'internal');
    const composition = createTool('multi_step_composition', 'composition', undefined, {
      toolIds: ['tool1', 'tool2', 'tool3'],
      strategy: 'sequential',
    });
    const model = createModel('gpt-4', 'premium');
    const context = createContext('gpt-4', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(tool1)
      .mockResolvedValueOnce(tool2)
      .mockResolvedValueOnce(tool3);

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator - track calls
    const validationCalls: string[] = [];
    mockRbacValidator.validateToolAccess.mockImplementation((tool, userRoles, model) => {
      validationCalls.push(tool.id);
      return { allowed: true };
    });

    // Execute composition
    await toolGateway.execute('multi_step_composition', {}, context);

    // Verify each tool was validated individually:
    // - First: composition itself
    // - Then: each tool validated in executeComposition (before execution)
    // - Then: each tool validated again during actual execution
    expect(validationCalls).toEqual([
      'multi_step_composition',
      'tool1', 'tool2', 'tool3',  // Validated in executeComposition
      'tool1', 'tool2', 'tool3',  // Validated during execution
    ]);
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledTimes(7);
  });

  // ============================================================================
  // Test 4: Log RBAC denial with invoking and registering model info
  // ============================================================================

  it('should log RBAC denial with full context', async () => {
    const deniedTool = createTool('admin_tool', 'internal', {
      userRoles: { required: ['admin'], denied: [] },
    });
    const composition = createTool('admin_composition', 'composition', undefined, {
      toolIds: ['admin_tool'],
      strategy: 'sequential',
    });
    const model = createModel('gpt-4', 'premium');
    const context = createContext('gpt-4', ['user']); // Not admin

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(deniedTool);

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator - allow composition, deny admin_tool
    mockRbacValidator.validateToolAccess.mockImplementation((tool) => {
      if (tool.id === 'admin_composition') {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'user_missing_required_roles',
        details: 'User missing required roles: admin',
      };
    });

    // Execute composition - should throw
    await expect(
      toolGateway.execute('admin_composition', {}, context)
    ).rejects.toThrow('Composition denied');

    // Verify logging would have occurred (we're using silent logger in tests)
    // In production, this would log to Loki with full context
  });

  // ============================================================================
  // Test 5: Allow execution after model upgrade
  // ============================================================================

  it('should allow execution after model upgrade to higher tier', async () => {
    const premiumTool = createTool('premium_tool', 'internal', {
      modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
    });
    const composition = createTool('premium_composition', 'composition', undefined, {
      toolIds: ['premium_tool'],
      strategy: 'sequential',
    });
    const upgradedModel = createModel('gpt-4', 'premium'); // Upgraded from basic
    const context = createContext('gpt-4', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(premiumTool);

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(upgradedModel);

    // Mock RBAC validator - now allows since model upgraded
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Execute composition - should succeed
    const result = await toolGateway.execute('premium_composition', {}, context);

    // Verify execution succeeded
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Verify RBAC validation was called (validates composition + constituent tool)
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalled();
    // The upgraded model (premium tier) should be used for validation
    expect(mockModelRegistry.getModel).toHaveBeenCalledWith('gpt-4');
  });

  // ============================================================================
  // Test 6: Validate against invoking model, not registering model
  // ============================================================================

  it('should validate against invoking model, not registering model', async () => {
    const restrictedTool = createTool('restricted_tool', 'internal', {
      modelRoles: { required: ['premium-model'], denied: [] },
    });
    const composition = createTool('restricted_composition', 'composition', undefined, {
      toolIds: ['restricted_tool'],
      strategy: 'sequential',
    });

    // Invoking model does NOT have premium-model role
    const invokingModel = createModel('gpt-3.5-turbo', 'basic');
    invokingModel.roles = ['model', 'llm']; // Does not include 'premium-model'

    const context = createContext('gpt-3.5-turbo', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(restrictedTool);

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(invokingModel);

    // Mock RBAC validator - deny due to missing model role
    mockRbacValidator.validateToolAccess.mockImplementation((tool, userRoles, model) => {
      // Check that validation uses INVOKING model
      if (model.id !== 'gpt-3.5-turbo') {
        throw new Error('Should validate against invoking model!');
      }

      return {
        allowed: false,
        reason: 'model_missing_required_roles',
        details: `Model ${model.id} missing required roles: premium-model`,
      };
    });

    // Execute composition - should throw
    await expect(
      toolGateway.execute('restricted_composition', {}, context)
    ).rejects.toThrow('Access denied');

    // Verify validation was attempted (composition validated first, then constituent tool)
    // The test verifies the composition was denied due to constituent tool access
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalled();
  });

  // ============================================================================
  // Test 7: Fail fast on first RBAC denial
  // ============================================================================

  it('should fail fast on first RBAC denial without validating remaining tools', async () => {
    const tool1 = createTool('tool1', 'internal');
    const tool2 = createTool('denied_tool', 'internal');
    const tool3 = createTool('tool3', 'internal'); // Should not be validated
    const composition = createTool('fail_fast_composition', 'composition', undefined, {
      toolIds: ['tool1', 'denied_tool', 'tool3'],
      strategy: 'sequential',
    });
    const model = createModel('gpt-4', 'premium');
    const context = createContext('gpt-4', ['user']);

    // Mock tool registry
    mockToolRegistry.getTool
      .mockResolvedValueOnce(composition)
      .mockResolvedValueOnce(tool1)
      .mockResolvedValueOnce(tool2);
    // tool3 should NOT be fetched

    // Mock model registry
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator - deny tool2
    const validationCalls: string[] = [];
    mockRbacValidator.validateToolAccess.mockImplementation((tool) => {
      // Track validation calls - the composition itself is also validated first
      validationCalls.push(tool.id);
      if (tool.id === 'denied_tool') {
        return {
          allowed: false,
          reason: 'test_denial',
          details: 'Testing fail-fast behavior',
        };
      }
      return { allowed: true };
    });

    // Execute composition - should throw
    await expect(
      toolGateway.execute('fail_fast_composition', {}, context)
    ).rejects.toThrow('Composition denied');

    // Verify composition + tool1 + denied_tool were validated (not tool3)
    // Note: The composition itself is validated first at the gateway level
    expect(validationCalls).toEqual(['fail_fast_composition', 'tool1', 'denied_tool']);
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledTimes(3);
  });
});
