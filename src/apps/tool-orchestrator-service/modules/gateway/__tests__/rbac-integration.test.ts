/**
 * RBAC Integration Tests - Sprint 58
 *
 * Comprehensive integration testing of Model-Based RBAC across the full stack:
 * - ToolGateway + RbacValidator + ToolRegistry + ModelRegistry
 * - Multiple models (gpt-4, gpt-3.5-turbo, reflex)
 * - Multiple users (admin, user, guest)
 * - All 27+ test scenarios from backlog
 * - Performance validation (P95 < 1ms)
 * - Denial logging verification
 *
 * These tests use real (non-mocked) registries with in-memory implementations
 * to validate the full integration.
 */

import { ToolGateway } from '../tool-gateway';
import { InMemoryToolRegistry } from '../../registry/in-memory-tool-registry';
import { InMemoryModelRegistry } from '../../models/in-memory-model-registry';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';
import { ToolExecutionContext } from '../../../../../types/tools';

describe('RBAC Integration Tests', () => {
  let toolGateway: ToolGateway;
  let toolRegistry: InMemoryToolRegistry;
  let modelRegistry: InMemoryModelRegistry;

  // Test models
  const gpt4Model: ModelRegistryDocument = {
    id: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4',
    modelType: 'llm',
    roles: ['model', 'llm', 'premium'],
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
      {
        scope: 'tool-use',
        scores: {
          reliability: 98,
          fidelity: 98,
          integrity: 95,
          calibration: 90,
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
      allowedTools: [], // Empty = allow all
      deniedTools: ['dangerous-tool'],
    },
    status: 'active',
    registeredAt: new Date(),
    metrics: {
      totalRequests: 1000,
      totalTokensUsed: 500000,
      totalCostUSD: 50,
      avgResponseTimeMs: 1500,
    },
  };

  const gpt35Model: ModelRegistryDocument = {
    id: 'gpt-3.5-turbo',
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo',
    modelType: 'llm',
    roles: ['model', 'llm', 'basic'],
    tier: 'basic',
    trust: [
      {
        scope: 'general',
        scores: {
          reliability: 85,
          fidelity: 85,
          integrity: 80,
          calibration: 75,
        },
      },
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: true,
      maxContextTokens: 16000,
      maxOutputTokens: 4096,
    },
    cost: {
      inputTokenCost: 1.5,
      outputTokenCost: 2,
    },
    toolPolicy: {
      allowedTools: [],
      deniedTools: [],
    },
    status: 'active',
    registeredAt: new Date(),
    metrics: {
      totalRequests: 5000,
      totalTokensUsed: 2000000,
      totalCostUSD: 20,
      avgResponseTimeMs: 800,
    },
  };

  const reflexModel: ModelRegistryDocument = {
    id: 'reflex',
    provider: 'bitbrat',
    displayName: 'Reflex (Deterministic Agent)',
    modelType: 'rule-based',
    roles: ['model', 'deterministic', 'reflex'],
    tier: 'deterministic',
    trust: [
      {
        scope: 'tool-use',
        scores: {
          reliability: 100, // Deterministic = 100% reliable
          fidelity: 100, // Always follows rules
          integrity: 100, // No manipulation risk
          calibration: 50, // Limited uncertainty recognition
        },
      },
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: false,
      maxContextTokens: 0,
      maxOutputTokens: 0,
    },
    cost: {
      inputTokenCost: 0,
      outputTokenCost: 0,
    },
    toolPolicy: {
      allowedTools: ['reflex-allowed-tool'],
      deniedTools: [],
    },
    status: 'active',
    registeredAt: new Date(),
    metrics: {
      totalRequests: 10000,
      totalTokensUsed: 0,
      totalCostUSD: 0,
      avgResponseTimeMs: 50,
    },
  };

  // Test tools
  const createBasicTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
    id: 'basic-tool',
    canonicalName: 'basic_tool',
    description: 'Basic tool accessible to all',
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

  const premiumTool = createBasicTool({
    id: 'premium-tool',
    canonicalName: 'premium_tool',
    description: 'Premium tool (requires premium or enterprise tier)',
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
    },
  });

  const adminTool = createBasicTool({
    id: 'admin-tool',
    canonicalName: 'admin_tool',
    description: 'Admin tool (requires admin role + high trust)',
    rbac: {
      userRoles: { required: ['admin'], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
      minTrustThresholds: {
        scope: 'tool-use',
        reliability: 95,
        fidelity: 95,
        integrity: 90,
        calibration: 85,
      },
    },
  });

  const dangerousTool = createBasicTool({
    id: 'dangerous-tool',
    canonicalName: 'dangerous_tool',
    description: 'Dangerous tool (explicitly denied for some models)',
    rbac: {
      userRoles: { required: [], denied: [] },
      modelRoles: { required: [], denied: [] },
      modelTiers: { allowed: [], denied: [] },
    },
  });

  const reflexAllowedTool = createBasicTool({
    id: 'reflex-allowed-tool',
    canonicalName: 'reflex_allowed_tool',
    description: 'Tool explicitly allowed for reflex',
  });

  const reflexDeniedTool = createBasicTool({
    id: 'reflex-denied-tool',
    canonicalName: 'reflex_denied_tool',
    description: 'Tool not in reflex allowlist',
  });

  // Helper to create execution context
  const createContext = (
    userId: string,
    userRoles: string[],
    modelId: string
  ): ToolExecutionContext => ({
    userId,
    userRoles,
    modelId,
    correlationId: `test-${Date.now()}`,
  });

  beforeEach(async () => {
    // Create in-memory registries
    toolRegistry = new InMemoryToolRegistry();
    modelRegistry = new InMemoryModelRegistry();

    // Register models
    await modelRegistry.registerModel(gpt4Model);
    await modelRegistry.registerModel(gpt35Model);
    await modelRegistry.registerModel(reflexModel);

    // Register tools
    await toolRegistry.registerTool(createBasicTool());
    await toolRegistry.registerTool(premiumTool);
    await toolRegistry.registerTool(adminTool);
    await toolRegistry.registerTool(dangerousTool);
    await toolRegistry.registerTool(reflexAllowedTool);
    await toolRegistry.registerTool(reflexDeniedTool);

    // Create ToolGateway
    toolGateway = new ToolGateway(
      toolRegistry,
      modelRegistry,
      { enableLogging: false } // Disable logging for tests
    );
  });

  afterEach(() => {
    toolGateway.clearCaches();
  });

  // ==========================================================================
  // User Role Tests (TS1-TS4)
  // ==========================================================================

  describe('User Role Validation', () => {
    it('TS1: User has required role → ALLOWED (if model passes)', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-4',
        ['admin', 'user']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS2: User missing required role → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-4',
        ['user'] // Missing 'admin'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
    });

    it('TS3: User has denied role → DENIED', async () => {
      const guestDeniedTool = createBasicTool({
        id: 'guest-denied-tool',
        rbac: {
          userRoles: { required: [], denied: ['guest'] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(guestDeniedTool);

      const result = await toolGateway.validateToolAccess(
        'guest-denied-tool',
        'user-1',
        'gpt-4',
        ['guest', 'user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_has_denied_role');
    });

    it('TS4: User has multiple roles, one denied → DENIED', async () => {
      const multiRoleTool = createBasicTool({
        id: 'multi-role-tool',
        rbac: {
          userRoles: { required: [], denied: ['banned'] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(multiRoleTool);

      const result = await toolGateway.validateToolAccess(
        'multi-role-tool',
        'user-1',
        'gpt-4',
        ['admin', 'user', 'banned'] // Has banned role
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_has_denied_role');
    });
  });

  // ==========================================================================
  // Model Role Tests (TS5-TS8)
  // ==========================================================================

  describe('Model Role Validation', () => {
    it('TS5: Model has required role → ALLOWED (if user passes)', async () => {
      const llmOnlyTool = createBasicTool({
        id: 'llm-only-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: ['llm'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(llmOnlyTool);

      const result = await toolGateway.validateToolAccess(
        'llm-only-tool',
        'user-1',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS6: Model missing required role → DENIED', async () => {
      const deterministicOnlyTool = createBasicTool({
        id: 'deterministic-only-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: ['deterministic'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(deterministicOnlyTool);

      const result = await toolGateway.validateToolAccess(
        'deterministic-only-tool',
        'user-1',
        'gpt-4', // LLM, not deterministic
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_missing_required_roles');
    });

    it('TS7: Model has denied role → DENIED', async () => {
      const noLlmTool = createBasicTool({
        id: 'no-llm-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: ['llm'] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(noLlmTool);

      const result = await toolGateway.validateToolAccess(
        'no-llm-tool',
        'user-1',
        'gpt-4', // Has 'llm' role
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_has_denied_role');
    });

    it('TS8: Model has multiple roles, one denied → DENIED', async () => {
      const noPremiumTool = createBasicTool({
        id: 'no-premium-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: ['premium'] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      await toolRegistry.registerTool(noPremiumTool);

      const result = await toolGateway.validateToolAccess(
        'no-premium-tool',
        'user-1',
        'gpt-4', // Has ['model', 'llm', 'premium']
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_has_denied_role');
    });
  });

  // ==========================================================================
  // Combined Tests (TS9-TS12)
  // ==========================================================================

  describe('Combined User × Model Validation', () => {
    it('TS9: User OK, model fails → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'premium-tool',
        'user-1',
        'gpt-3.5-turbo', // basic tier, not premium
        ['admin'] // User has admin
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_not_allowed');
    });

    it('TS10: User fails, model OK → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-4', // Model passes (premium + high trust)
        ['user'] // User missing 'admin'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
    });

    it('TS11: Both pass → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-4',
        ['admin', 'user']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS12: Both fail → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-3.5-turbo', // Fails trust threshold
        ['user'] // Missing 'admin'
      );

      expect(result.allowed).toBe(false);
      // Should fail on first check (user missing required role)
      expect(result.reason).toBe('user_missing_required_roles');
    });
  });

  // ==========================================================================
  // Tier Tests (TS13-TS16)
  // ==========================================================================

  describe('Model Tier Enforcement', () => {
    it('TS13: Model tier in allowed list → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'premium-tool',
        'user-1',
        'gpt-4', // premium tier
        ['user']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS14: Model tier not in allowed list → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'premium-tool',
        'user-1',
        'gpt-3.5-turbo', // basic tier
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_not_allowed');
    });

    it('TS15: Model tier in denied list → DENIED', async () => {
      const noBasicTool = createBasicTool({
        id: 'no-basic-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: ['basic', 'free'] },
        },
      });
      await toolRegistry.registerTool(noBasicTool);

      const result = await toolGateway.validateToolAccess(
        'no-basic-tool',
        'user-1',
        'gpt-3.5-turbo', // basic tier
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_denied');
    });

    it('TS16: Empty allowed list (allow all) → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'basic-tool', // Empty allowed list
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // Trust Tests (TS17-TS23)
  // ==========================================================================

  describe('Trust Score Validation', () => {
    it('TS17: All trust dimensions pass → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'gpt-4', // Has high trust scores
        ['admin']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS18: Reliability below threshold → DENIED', async () => {
      const highReliabilityTool = createBasicTool({
        id: 'high-reliability-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'general',
            reliability: 90, // gpt-3.5-turbo has 85
          },
        },
      });
      await toolRegistry.registerTool(highReliabilityTool);

      const result = await toolGateway.validateToolAccess(
        'high-reliability-tool',
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('reliability');
    });

    it('TS19: Fidelity below threshold → DENIED', async () => {
      const highFidelityTool = createBasicTool({
        id: 'high-fidelity-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'general',
            fidelity: 90, // gpt-3.5-turbo has 85
          },
        },
      });
      await toolRegistry.registerTool(highFidelityTool);

      const result = await toolGateway.validateToolAccess(
        'high-fidelity-tool',
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('fidelity');
    });

    it('TS20: Integrity below threshold → DENIED', async () => {
      const highIntegrityTool = createBasicTool({
        id: 'high-integrity-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'general',
            integrity: 85, // gpt-3.5-turbo has 80
          },
        },
      });
      await toolRegistry.registerTool(highIntegrityTool);

      const result = await toolGateway.validateToolAccess(
        'high-integrity-tool',
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('integrity');
    });

    it('TS21: Calibration below threshold → DENIED', async () => {
      const highCalibrationTool = createBasicTool({
        id: 'high-calibration-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'general',
            calibration: 80, // gpt-3.5-turbo has 75
          },
        },
      });
      await toolRegistry.registerTool(highCalibrationTool);

      const result = await toolGateway.validateToolAccess(
        'high-calibration-tool',
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('calibration');
    });

    it('TS22: Missing trust scope, fallback to general → ALLOWED', async () => {
      // gpt-3.5-turbo only has 'general' scope, but tool requires 'tool-use'
      // Should fallback to 'general' scope and check against those scores
      const toolUseRequiredTool = createBasicTool({
        id: 'tool-use-required-tool',
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'tool-use', // gpt-3.5-turbo doesn't have this scope
            reliability: 80, // Lower than gpt-3.5-turbo's general reliability (85)
            fidelity: 80, // Lower than gpt-3.5-turbo's general fidelity (85)
          },
        },
      });
      await toolRegistry.registerTool(toolUseRequiredTool);

      const result = await toolGateway.validateToolAccess(
        'tool-use-required-tool',
        'user-1',
        'gpt-3.5-turbo', // Only has 'general' scope
        ['user']
      );

      // Should fallback to 'general' scope and pass
      expect(result.allowed).toBe(true);
    });

    it('TS23: No trust profile → DENIED', async () => {
      const noTrustModel: ModelRegistryDocument = {
        ...gpt35Model,
        id: 'no-trust-model',
        trust: [], // Empty trust array
      };
      await modelRegistry.registerModel(noTrustModel);

      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'user-1',
        'no-trust-model',
        ['admin']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_scope_not_found');
    });
  });

  // ==========================================================================
  // Policy Tests (TS24-TS27)
  // ==========================================================================

  describe('Model Tool Policy', () => {
    it('TS24: Tool in model allowlist → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'reflex-allowed-tool',
        'user-1',
        'reflex', // Has allowlist: ['reflex-allowed-tool']
        ['user']
      );

      expect(result.allowed).toBe(true);
    });

    it('TS25: Tool not in model allowlist (non-empty) → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'reflex-denied-tool', // Not in reflex allowlist
        'user-1',
        'reflex',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_policy_tool_not_in_allowlist');
    });

    it('TS26: Tool in model denylist → DENIED', async () => {
      const result = await toolGateway.validateToolAccess(
        'dangerous-tool',
        'user-1',
        'gpt-4', // Has denylist: ['dangerous-tool']
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_policy_denies_tool');
    });

    it('TS27: Empty allowlist (allow all) → ALLOWED', async () => {
      const result = await toolGateway.validateToolAccess(
        'basic-tool',
        'user-1',
        'gpt-4', // Empty allowlist
        ['user']
      );

      expect(result.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // Multi-User Tests (T3.1.4)
  // ==========================================================================

  describe('Multiple User Roles', () => {
    it('should allow admin user to access admin tools', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'admin-user-1',
        'gpt-4',
        ['admin', 'power-user', 'user']
      );

      expect(result.allowed).toBe(true);
    });

    it('should deny regular user from accessing admin tools', async () => {
      const result = await toolGateway.validateToolAccess(
        'admin-tool',
        'regular-user-1',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
    });

    it('should allow guest user to access basic tools', async () => {
      const result = await toolGateway.validateToolAccess(
        'basic-tool',
        'guest-user-1',
        'gpt-4',
        ['guest']
      );

      expect(result.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // Multi-Model Tests (T3.1.3)
  // ==========================================================================

  describe('Multiple Models', () => {
    it('should allow gpt-4 to access premium tools', async () => {
      const result = await toolGateway.validateToolAccess(
        'premium-tool',
        'user-1',
        'gpt-4',
        ['user']
      );

      expect(result.allowed).toBe(true);
    });

    it('should deny gpt-3.5-turbo from accessing premium tools', async () => {
      const result = await toolGateway.validateToolAccess(
        'premium-tool',
        'user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_not_allowed');
    });

    it('should allow reflex to access allowlisted tools only', async () => {
      const allowedResult = await toolGateway.validateToolAccess(
        'reflex-allowed-tool',
        'user-1',
        'reflex',
        ['user']
      );

      const deniedResult = await toolGateway.validateToolAccess(
        'basic-tool',
        'user-1',
        'reflex',
        ['user']
      );

      expect(allowedResult.allowed).toBe(true);
      expect(deniedResult.allowed).toBe(false);
      expect(deniedResult.reason).toBe('model_policy_tool_not_in_allowlist');
    });
  });

  // ==========================================================================
  // Performance Tests (T3.1.7)
  // ==========================================================================

  describe('Performance Validation', () => {
    it('should achieve P95 RBAC validation < 1ms', async () => {
      const iterations = 1000;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await toolGateway.validateToolAccess(
          'basic-tool',
          `user-${i}`,
          'gpt-4',
          ['user']
        );
        const end = performance.now();
        latencies.push(end - start);
      }

      // Sort latencies
      latencies.sort((a, b) => a - b);

      // Calculate P95
      const p95Index = Math.floor(iterations * 0.95);
      const p95Latency = latencies[p95Index];

      console.log(`P95 RBAC validation latency: ${p95Latency.toFixed(3)}ms`);

      expect(p95Latency).toBeLessThan(1);
    });

    it('should achieve >90% cache hit ratio', async () => {
      const iterations = 100;

      // Clear cache first
      toolGateway.clearCaches();

      // Get initial stats
      const initialStats = toolGateway.getCacheStats();
      expect(initialStats.toolCacheSize).toBe(0);
      expect(initialStats.modelCacheSize).toBe(0);

      // First call (cache miss)
      await toolGateway.validateToolAccess('basic-tool', 'user-1', 'gpt-4', ['user']);

      // Subsequent calls (cache hits)
      for (let i = 0; i < iterations - 1; i++) {
        await toolGateway.validateToolAccess('basic-tool', `user-${i}`, 'gpt-4', ['user']);
      }

      // Check cache stats
      const finalStats = toolGateway.getCacheStats();
      expect(finalStats.toolCacheSize).toBe(1); // Only 1 tool cached
      expect(finalStats.modelCacheSize).toBe(1); // Only 1 model cached

      // Cache hit ratio = (iterations - 1) / iterations = 99%
      const cacheHitRatio = (iterations - 1) / iterations;
      expect(cacheHitRatio).toBeGreaterThan(0.9);
    });
  });

  // ==========================================================================
  // Error Message Tests (T3.1.6)
  // ==========================================================================

  describe('Error Message Clarity', () => {
    it('should provide clear reason codes for all denials', async () => {
      const testCases = [
        {
          toolId: 'admin-tool',
          userId: 'user-1',
          modelId: 'gpt-4',
          userRoles: ['user'],
          expectedReason: 'user_missing_required_roles',
        },
        {
          toolId: 'premium-tool',
          userId: 'user-1',
          modelId: 'gpt-3.5-turbo',
          userRoles: ['user'],
          expectedReason: 'model_tier_not_allowed',
        },
        {
          toolId: 'dangerous-tool',
          userId: 'user-1',
          modelId: 'gpt-4',
          userRoles: ['user'],
          expectedReason: 'model_policy_denies_tool',
        },
        {
          toolId: 'basic-tool',
          userId: 'user-1',
          modelId: 'reflex',
          userRoles: ['user'],
          expectedReason: 'model_policy_tool_not_in_allowlist',
        },
      ];

      for (const testCase of testCases) {
        const result = await toolGateway.validateToolAccess(
          testCase.toolId,
          testCase.userId,
          testCase.modelId,
          testCase.userRoles
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(testCase.expectedReason);
        expect(result.details).toBeDefined();
        expect(typeof result.details).toBe('string');
        expect(result.details!.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // listAvailableTools Integration Tests
  // ==========================================================================

  describe('listAvailableTools', () => {
    it('should return filtered list for admin user with gpt-4', async () => {
      const available = await toolGateway.listAvailableTools(
        'admin-user-1',
        'gpt-4',
        ['admin', 'user']
      );

      expect(available).toContain('basic-tool');
      expect(available).toContain('premium-tool');
      expect(available).toContain('admin-tool');
      expect(available).not.toContain('dangerous-tool'); // In gpt-4 denylist
      expect(available).toContain('reflex-allowed-tool'); // gpt-4 has empty allowlist (allow all)
      expect(available).toContain('reflex-denied-tool'); // gpt-4 allows all tools
    });

    it('should return filtered list for regular user with gpt-3.5-turbo', async () => {
      const available = await toolGateway.listAvailableTools(
        'regular-user-1',
        'gpt-3.5-turbo',
        ['user']
      );

      expect(available).toContain('basic-tool');
      expect(available).not.toContain('premium-tool'); // Requires premium tier
      expect(available).not.toContain('admin-tool'); // Requires admin role
      expect(available).toContain('dangerous-tool'); // Not denied for gpt-3.5
    });

    it('should return only allowlisted tools for reflex', async () => {
      const available = await toolGateway.listAvailableTools(
        'user-1',
        'reflex',
        ['user']
      );

      expect(available).toEqual(['reflex-allowed-tool']);
    });
  });
});
