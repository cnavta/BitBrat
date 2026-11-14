/**
 * RBAC Inheritance Tests
 * Sprint 61: Composition RBAC + Validation (T3.4)
 *
 * Test suite for RBAC inheritance logic:
 * - Union user required roles
 * - Intersect allowed model tiers
 * - Handle empty allowed tiers (allow all)
 * - Take maximum trust threshold (most restrictive)
 * - Union denied roles
 * - Handle tools with no RBAC restrictions
 */

import { ToolRegistry } from '../tool-registry';
import { IDocumentStore } from '../../../../../common/persistence/interfaces';
import { IModelRegistry } from '../../models/interfaces';
import { RbacValidator } from '../../gateway/rbac-validator';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { CompositionDefinition } from '../../../../../common/composition/types';
import pino from 'pino';

describe('RBAC Inheritance Logic', () => {
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
    } as any;

    // Create mock RBAC validator
    mockRbacValidator = {
      validateToolAccess: jest.fn().mockReturnValue({ allowed: true }),
    } as any;

    // Create logger
    logger = pino({ level: 'silent' });

    // Create ToolRegistry
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

  const createTool = (
    id: string,
    rbacOverrides?: Partial<ToolRegistryDocument['rbac']>
  ): ToolRegistryDocument => ({
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

  const createComposition = (name: string, toolIds: string[]): CompositionDefinition => ({
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: { name },
    spec: {
      inputSchema: {},
      steps: toolIds.map((id, i) => ({
        id: `step${i + 1}`,
        call: id,
      })),
      return: { $ref: { namespace: 'steps', pointer: '/step1' } },
    },
  });

  const createModel = (id: string) => ({
    id,
    provider: 'openai',
    displayName: id,
    modelType: 'llm' as const,
    roles: ['model'],
    tier: 'premium' as const,
    trust: [],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    cost: { inputTokenCost: 30, outputTokenCost: 60 },
    toolPolicy: { allowedTools: [], deniedTools: [] },
    status: 'active' as const,
    registeredAt: new Date(),
    metrics: {
      totalRequests: 0,
      totalTokensUsed: 0,
      totalCostUSD: 0,
      avgResponseTimeMs: 0,
    },
  });

  // ============================================================================
  // Test 1: Union of user required roles
  // ============================================================================

  it('should union user required roles', async () => {
    const tool1 = createTool('tool1', {
      userRoles: { required: ['user'], denied: [] },
    });
    const tool2 = createTool('tool2', {
      userRoles: { required: ['admin'], denied: [] },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user', 'admin']);

    // Verify stored composition has union of required roles
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.userRoles.required).toEqual(
      expect.arrayContaining(['user', 'admin'])
    );
    expect(stored.rbac.userRoles.required.length).toBe(2);
  });

  // ============================================================================
  // Test 2: Intersect allowed model tiers
  // ============================================================================

  it('should intersect allowed model tiers', async () => {
    const tool1 = createTool('tool1', {
      modelTiers: { allowed: ['basic', 'premium'], denied: [] },
    });
    const tool2 = createTool('tool2', {
      modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition has intersection of tiers (premium only)
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.modelTiers.allowed).toEqual(['premium']);
  });

  // ============================================================================
  // Test 3: Handle empty allowed tiers (allow all)
  // ============================================================================

  it('should handle empty allowed tiers (allow all)', async () => {
    const tool1 = createTool('tool1', {
      modelTiers: { allowed: [], denied: [] }, // Allows all
    });
    const tool2 = createTool('tool2', {
      modelTiers: { allowed: ['premium'], denied: [] },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition uses tool2's tier restriction (most restrictive)
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.modelTiers.allowed).toEqual(['premium']);
  });

  // ============================================================================
  // Test 4: All tools allow all tiers
  // ============================================================================

  it('should return empty array if all tools allow all tiers', async () => {
    const tool1 = createTool('tool1', {
      modelTiers: { allowed: [], denied: [] }, // Allows all
    });
    const tool2 = createTool('tool2', {
      modelTiers: { allowed: [], denied: [] }, // Allows all
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition allows all tiers (empty array)
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.modelTiers.allowed).toEqual([]);
  });

  // ============================================================================
  // Test 5: Take maximum trust threshold (most restrictive)
  // ============================================================================

  it('should take maximum trust threshold (most restrictive)', async () => {
    const tool1 = createTool('tool1', {
      minTrustThresholds: {
        scope: 'tool-use',
        reliability: 80,
        fidelity: 70,
      },
    });
    const tool2 = createTool('tool2', {
      minTrustThresholds: {
        scope: 'tool-use',
        reliability: 90,
        fidelity: 60,
      },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition has maximum thresholds
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.minTrustThresholds?.reliability).toBe(90); // max(80, 90)
    expect(stored.rbac.minTrustThresholds?.fidelity).toBe(70); // max(70, 60)
  });

  // ============================================================================
  // Test 6: Union of denied roles
  // ============================================================================

  it('should union denied roles', async () => {
    const tool1 = createTool('tool1', {
      userRoles: { required: [], denied: ['banned'] },
    });
    const tool2 = createTool('tool2', {
      userRoles: { required: [], denied: ['restricted'] },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition has union of denied roles
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.userRoles.denied).toEqual(
      expect.arrayContaining(['banned', 'restricted'])
    );
    expect(stored.rbac.userRoles.denied.length).toBe(2);
  });

  // ============================================================================
  // Test 7: Handle tools with no RBAC restrictions
  // ============================================================================

  it('should handle tools with no RBAC restrictions', async () => {
    const tool1 = createTool('tool1', {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
    });
    const tool2 = createTool('tool2', {
      userRoles: { required: ['user'], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: ['premium'], denied: [] },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition inherits tool2's restrictions
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.userRoles.required).toEqual(['user']);
    expect(stored.rbac.modelTiers.allowed).toEqual(['premium']);
  });

  // ============================================================================
  // Test 8: No trust thresholds
  // ============================================================================

  it('should return undefined trust thresholds when no tools require trust', async () => {
    const tool1 = createTool('tool1'); // No trust thresholds
    const tool2 = createTool('tool2'); // No trust thresholds

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Verify stored composition has no trust thresholds
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;
    expect(stored.rbac.minTrustThresholds).toBeUndefined();
  });

  // ============================================================================
  // Test 9: Complex scenario - all RBAC rules combined
  // ============================================================================

  it('should correctly combine all RBAC rules', async () => {
    const tool1 = createTool('tool1', {
      userRoles: { required: ['user'], denied: ['banned'] },
      modelRoles: { required: ['llm'], denied: [] },
      modelTiers: { allowed: ['basic', 'premium'], denied: [] },
      minTrustThresholds: {
        scope: 'tool-use',
        reliability: 80,
      },
    });
    const tool2 = createTool('tool2', {
      userRoles: { required: ['admin'], denied: ['restricted'] },
      modelRoles: { required: ['model'], denied: [] },
      modelTiers: { allowed: ['premium', 'enterprise'], denied: ['free'] },
      minTrustThresholds: {
        scope: 'tool-use',
        reliability: 90,
        fidelity: 85,
      },
    });

    // Mock getTool
    mockStore.get.mockImplementation(async (collection, id) => {
      if (id === 'tool1') return tool1;
      if (id === 'tool2') return tool2;
      return null;
    });

    // Mock getModel
    mockModelRegistry.getModel.mockResolvedValue(createModel('gpt-4'));

    // Register composition
    const composition = createComposition('test_comp', ['tool1', 'tool2']);
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user', 'admin']);

    // Verify all RBAC rules correctly applied
    const stored = mockStore.set.mock.calls[0][2] as ToolRegistryDocument;

    // User roles: union of required, union of denied
    expect(stored.rbac.userRoles.required).toEqual(
      expect.arrayContaining(['user', 'admin'])
    );
    expect(stored.rbac.userRoles.denied).toEqual(
      expect.arrayContaining(['banned', 'restricted'])
    );

    // Model roles: union of required
    expect(stored.rbac.modelRoles.required).toEqual(
      expect.arrayContaining(['llm', 'model'])
    );

    // Model tiers: intersection of allowed, union of denied
    expect(stored.rbac.modelTiers.allowed).toEqual(['premium']); // Intersection
    expect(stored.rbac.modelTiers.denied).toEqual(['free']);

    // Trust thresholds: maximum of each dimension
    expect(stored.rbac.minTrustThresholds?.reliability).toBe(90); // max(80, 90)
    expect(stored.rbac.minTrustThresholds?.fidelity).toBe(85); // Only tool2 has fidelity
  });
});
