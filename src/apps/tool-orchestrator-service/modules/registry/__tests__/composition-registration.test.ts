/**
 * Composition Registration RBAC Tests
 * Sprint 61: Composition RBAC + Validation (T1.3)
 *
 * Test suite for composition registration RBAC validation:
 * - Allow registration when model has access to all tools
 * - Deny registration when model lacks access to one tool
 * - Validate nested compositions recursively
 * - Log RBAC metadata in composition document
 * - Prevent re-registration with different model
 */

import { ToolRegistry } from '../tool-registry';
import { IDocumentStore } from '../../../../../common/persistence/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { RbacValidator } from '../../gateway/rbac-validator';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { CompositionDefinition } from '../../../../../common/composition/types';
import pino from 'pino';

describe('Composition Registration RBAC', () => {
  let toolRegistry: ToolRegistry;
  let mockStore: jest.Mocked<IDocumentStore>;
  let mockModelRegistry: jest.Mocked<IModelRegistry>;
  let mockRbacValidator: jest.Mocked<RbacValidator>;
  let logger: pino.Logger;

  beforeEach(() => {
    // Create mock store
    mockStore = {
      set: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      query: jest.fn(),
      getAll: jest.fn(),
    } as any;

    // Create mock model registry
    mockModelRegistry = {
      getModel: jest.fn(),
      registerModel: jest.fn(),
      listModels: jest.fn(),
      updateModel: jest.fn(),
      getModelRoles: jest.fn(),
      getModelTier: jest.fn(),
      getTrustScores: jest.fn(),
      validateToolAccess: jest.fn(),
      getModelToolPolicy: jest.fn(),
    } as any;

    // Create mock RBAC validator
    mockRbacValidator = {
      validateToolAccess: jest.fn(),
    } as any;

    // Create logger
    logger = pino({ level: 'silent' });

    // Create ToolRegistry with mocked dependencies
    toolRegistry = new ToolRegistry(
      mockStore,
      logger,
      mockModelRegistry,
      mockRbacValidator
    );
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const createBasicTool = (id: string, overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
    id,
    canonicalName: id,
    description: `Test tool ${id}`,
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

  const createBasicModel = (id: string, tier: string, overrides?: Partial<ModelRegistryDocument>): ModelRegistryDocument => ({
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
    ...overrides,
  });

  const createCompositionDefinition = (
    name: string,
    toolIds: string[]
  ): CompositionDefinition => ({
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: {
      name,
      description: `Test composition ${name}`,
    },
    spec: {
      inputSchema: {},
      steps: toolIds.map((toolId, i) => ({
        id: `step${i + 1}`,
        call: toolId,
      })),
      return: { $ref: { namespace: 'steps', pointer: '/step1' } },
    },
  });

  // ============================================================================
  // Test 1: Allow registration when model has access to all tools
  // ============================================================================

  it('should allow registration when model has access to all tools', async () => {
    const tool1 = createBasicTool('tool1');
    const tool2 = createBasicTool('tool2');
    const model = createBasicModel('gpt-4', 'premium');
    const composition = createCompositionDefinition('test_composition', ['tool1', 'tool2']);

    // Mock getTool to return constituent tools
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel to return registering model
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator to allow access
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Register composition
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify store.set was called with composition document
    expect(mockStore.set).toHaveBeenCalledWith(
      'platform_tool_registry',
      'test_composition',
      expect.objectContaining({
        id: 'test_composition',
        canonicalName: 'test_composition',
        source: 'composition',
        sourceMetadata: {
          composition: {
            toolIds: ['tool1', 'tool2'],
            strategy: 'sequential',
          },
        },
      })
    );

    // Verify RBAC validation was called for each tool
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledTimes(2);
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledWith(
      tool1,
      ['user'],
      model
    );
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledWith(
      tool2,
      ['user'],
      model
    );
  });

  // ============================================================================
  // Test 2: Deny registration when model lacks access to one tool
  // ============================================================================

  it('should deny registration when model lacks access to one tool', async () => {
    const tool1 = createBasicTool('basic_tool');
    const tool2 = createBasicTool('premium_tool', {
      rbac: {
        userRoles: { required: [], denied: [] },
        modelRoles: { required: [], denied: [] },
        modelTiers: { allowed: ['premium'], denied: [] },
      },
    });
    const model = createBasicModel('gpt-3.5-turbo', 'basic');
    const composition = createCompositionDefinition('test_composition', [
      'basic_tool',
      'premium_tool',
    ]);

    // Mock getTool to return constituent tools
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'basic_tool') return tool1;
      if (id === 'premium_tool') return tool2;
      return null;
    });

    // Mock getModel to return registering model
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator: allow basic_tool, deny premium_tool
    mockRbacValidator.validateToolAccess.mockImplementation((tool, userRoles, model) => {
      if (tool.id === 'basic_tool') {
        return { allowed: true };
      } else {
        return {
          allowed: false,
          reason: 'model_tier_not_allowed',
          details: `Tool requires model tier: premium, but ${model.id} is tier ${model.tier}`,
        };
      }
    });

    // Attempt to register composition - should throw
    await expect(
      toolRegistry.registerComposition(composition, 'gpt-3.5-turbo', ['user'])
    ).rejects.toThrow('Model gpt-3.5-turbo lacks access to tool premium_tool');

    // Verify store.set was NOT called
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Test 3: Validate nested compositions recursively
  // ============================================================================

  it('should validate nested compositions recursively', async () => {
    // Create primitive tools
    const tool1 = createBasicTool('tool1');
    const tool2 = createBasicTool('tool2');
    const tool3 = createBasicTool('tool3');

    // Create nested composition (compositionB uses tool2 + tool3)
    const compositionB = createBasicTool('compositionB', {
      source: 'composition',
      sourceMetadata: {
        composition: {
          toolIds: ['tool2', 'tool3'],
          strategy: 'sequential',
        },
      },
    });

    // Create parent composition (compositionA uses tool1 + compositionB)
    const compositionA = createCompositionDefinition('compositionA', [
      'tool1',
      'compositionB',
    ]);

    const model = createBasicModel('gpt-4', 'premium');

    // Mock getTool to return tools and nested composition
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      if (id === 'tool3') return tool3;
      if (id === 'compositionB') return compositionB;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator to allow all tools
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Register parent composition
    await toolRegistry.registerComposition(compositionA, 'gpt-4', ['user']);

    // Verify all primitive tools were validated (tool1, tool2, tool3)
    // compositionB is expanded to tool2 + tool3
    expect(mockRbacValidator.validateToolAccess).toHaveBeenCalledTimes(3);

    // Verify composition was stored with flattened tool IDs
    const storedComposition = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(storedComposition.sourceMetadata.composition?.toolIds).toEqual([
      'tool1',
      'tool2',
      'tool3',
    ]);
  });

  // ============================================================================
  // Test 4: Log RBAC metadata in composition document
  // ============================================================================

  it('should log RBAC metadata in composition document', async () => {
    const tool1 = createBasicTool('tool1', {
      rbac: {
        userRoles: { required: ['user'], denied: [] },
        modelRoles: { required: [], denied: [] },
        modelTiers: { allowed: ['premium'], denied: [] },
      },
    });
    const tool2 = createBasicTool('tool2', {
      rbac: {
        userRoles: { required: ['admin'], denied: [] },
        modelRoles: { required: [], denied: [] },
        modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
      },
    });
    const model = createBasicModel('gpt-4', 'premium');
    const composition = createCompositionDefinition('test_composition', ['tool1', 'tool2']);

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Register composition
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user', 'admin']);

    // Verify stored composition has inherited RBAC
    const storedComposition = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;

    // Inherited RBAC should be union of required roles, intersection of allowed tiers
    expect(storedComposition.rbac.userRoles.required).toEqual(
      expect.arrayContaining(['user', 'admin'])
    );
    expect(storedComposition.rbac.modelTiers.allowed).toEqual(['premium']); // Intersection
  });

  // ============================================================================
  // Test 5: Prevent re-registration with different model (not implemented yet)
  // ============================================================================

  it('should allow re-registration (no uniqueness constraint yet)', async () => {
    const tool1 = createBasicTool('tool1');
    const model1 = createBasicModel('gpt-4', 'premium');
    const model2 = createBasicModel('gpt-3.5-turbo', 'basic');
    const composition = createCompositionDefinition('test_composition', ['tool1']);

    // Mock getTool
    mockStore.get.mockResolvedValue(tool1);

    // Mock getModel - first call returns gpt-4, second returns gpt-3.5-turbo
    mockModelRegistry.getModel
      .mockResolvedValueOnce(model1)
      .mockResolvedValueOnce(model2);

    // Mock RBAC validator
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Register with gpt-4
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Register again with gpt-3.5-turbo (should succeed - no uniqueness check yet)
    await toolRegistry.registerComposition(composition, 'gpt-3.5-turbo', ['user']);

    // Verify store.set was called twice
    expect(mockStore.set).toHaveBeenCalledTimes(2);
  });

  // ============================================================================
  // Test 6: Error handling - Model not found
  // ============================================================================

  it('should throw error if registering model not found', async () => {
    const composition = createCompositionDefinition('test_composition', ['tool1']);

    // Mock getModel to return null
    mockModelRegistry.getModel.mockResolvedValue(null);

    // Attempt to register - should throw
    await expect(
      toolRegistry.registerComposition(composition, 'nonexistent-model', ['user'])
    ).rejects.toThrow('Registering model not found: nonexistent-model');

    // Verify store.set was NOT called
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Test 7: Error handling - Constituent tool not found
  // ============================================================================

  it('should throw error if constituent tool not found', async () => {
    const model = createBasicModel('gpt-4', 'premium');
    const composition = createCompositionDefinition('test_composition', [
      'tool1',
      'nonexistent_tool',
    ]);

    // Mock getTool - tool1 exists, nonexistent_tool does not
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return createBasicTool('tool1');
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(model);

    // Mock RBAC validator (in case tool1 validation happens before nonexistent_tool check)
    mockRbacValidator.validateToolAccess.mockReturnValue({ allowed: true });

    // Attempt to register - should throw
    await expect(
      toolRegistry.registerComposition(composition, 'gpt-4', ['user'])
    ).rejects.toThrow('Constituent tool not found: nonexistent_tool');

    // Verify store.set was NOT called
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Test 8: Error handling - Dependencies not configured
  // ============================================================================

  it('should throw error if modelRegistry or rbacValidator not configured', async () => {
    // Create ToolRegistry without dependencies
    const registryWithoutDeps = new ToolRegistry(mockStore, logger);
    const composition = createCompositionDefinition('test_composition', ['tool1']);

    // Attempt to register - should throw
    await expect(
      registryWithoutDeps.registerComposition(composition, 'gpt-4', ['user'])
    ).rejects.toThrow('ToolRegistry not configured for composition RBAC validation');
  });
});
