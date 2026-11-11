/**
 * RBAC Validator Tests
 * Sprint 58: Model-Based RBAC - Dual-Layer Validation & Context Propagation
 *
 * Comprehensive test suite covering all 27 test scenarios:
 * - User role tests (4)
 * - Model role tests (4)
 * - Combined tests (4)
 * - Tier tests (4)
 * - Trust tests (7)
 * - Policy tests (4)
 */

import { RbacValidator } from '../rbac-validator';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';

describe('RbacValidator', () => {
  let validator: RbacValidator;

  beforeEach(() => {
    validator = new RbacValidator();
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const createBasicTool = (overrides?: Partial<ToolRegistryDocument>): ToolRegistryDocument => ({
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

  const createBasicModel = (overrides?: Partial<ModelRegistryDocument>): ModelRegistryDocument => ({
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

  // ============================================================================
  // User Role Tests
  // ============================================================================

  describe('User Role Tests', () => {
    it('TS1: User has required role → ALLOWED (if model passes)', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['user'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel();
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS2: User missing required role → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel();
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
      expect(result.details).toContain('admin');
    });

    it('TS3: User has denied role → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: ['guest'] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel();
      const userRoles = ['guest'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_has_denied_role');
      expect(result.details).toContain('guest');
    });

    it('TS4: User has multiple roles, one denied → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: ['guest'] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel();
      const userRoles = ['user', 'guest'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_has_denied_role');
    });
  });

  // ============================================================================
  // Model Role Tests
  // ============================================================================

  describe('Model Role Tests', () => {
    it('TS5: Model has required role → ALLOWED (if user passes)', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: ['llm'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS6: Model missing required role → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: ['vision'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_missing_required_roles');
      expect(result.details).toContain('vision');
    });

    it('TS7: Model has denied role → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: ['basic'] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'basic'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_has_denied_role');
      expect(result.details).toContain('basic');
    });

    it('TS8: Model has multiple roles, one denied → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: ['experimental'] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm', 'experimental'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_has_denied_role');
    });
  });

  // ============================================================================
  // Combined User × Model Tests
  // ============================================================================

  describe('Combined User × Model Tests', () => {
    it('TS9: User OK, model fails → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['user'], denied: [] },
          modelRoles: { required: ['vision'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_missing_required_roles');
    });

    it('TS10: User fails, model OK → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: ['llm'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_missing_required_roles');
    });

    it('TS11: Both pass → ALLOWED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['user'], denied: [] },
          modelRoles: { required: ['llm'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS12: Both fail → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['admin'], denied: [] },
          modelRoles: { required: ['vision'], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ roles: ['model', 'llm'] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      // Should fail on user roles first (fail-fast)
      expect(result.reason).toBe('user_missing_required_roles');
    });
  });

  // ============================================================================
  // Model Tier Tests
  // ============================================================================

  describe('Model Tier Tests', () => {
    it('TS13: Model tier in allowed list → ALLOWED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
        },
      });
      const model = createBasicModel({ tier: 'premium' });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS14: Model tier not in allowed list → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
        },
      });
      const model = createBasicModel({ tier: 'basic' });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_not_allowed');
      expect(result.details).toContain('basic');
    });

    it('TS15: Model tier in denied list → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: ['free', 'basic'] },
        },
      });
      const model = createBasicModel({ tier: 'basic' });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_tier_denied');
    });

    it('TS16: Empty allowed list (allow all) → ALLOWED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
        },
      });
      const model = createBasicModel({ tier: 'free' });
      const userRoles: string[] = [];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Trust Score Tests
  // ============================================================================

  describe('Trust Score Tests', () => {
    it('TS17: All trust dimensions pass → ALLOWED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'general',
            reliability: 90,
            fidelity: 90,
            integrity: 85,
            calibration: 80,
          },
        },
      });
      const model = createBasicModel({
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
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS18: Reliability below threshold → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            reliability: 95,
          },
        },
      });
      const model = createBasicModel({
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 90,
              fidelity: 95,
              integrity: 90,
              calibration: 85,
            },
          },
        ],
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('reliability');
    });

    it('TS19: Fidelity below threshold → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            fidelity: 95,
          },
        },
      });
      const model = createBasicModel({
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 95,
              fidelity: 90,
              integrity: 90,
              calibration: 85,
            },
          },
        ],
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('fidelity');
    });

    it('TS20: Integrity below threshold → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            integrity: 95,
          },
        },
      });
      const model = createBasicModel({
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 95,
              fidelity: 95,
              integrity: 90,
              calibration: 85,
            },
          },
        ],
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('integrity');
    });

    it('TS21: Calibration below threshold → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            calibration: 90,
          },
        },
      });
      const model = createBasicModel({
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 95,
              fidelity: 95,
              integrity: 90,
              calibration: 85,
            },
          },
        ],
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_insufficient');
      expect(result.details).toContain('calibration');
    });

    it('TS22: Missing trust scope, fallback to general → ALLOWED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            scope: 'tool-use',
            reliability: 90,
          },
        },
      });
      const model = createBasicModel({
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
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS23: No trust profile → DENIED', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: [], denied: [] },
          modelRoles: { required: [], denied: [] },
          modelTiers: { allowed: [], denied: [] },
          minTrustThresholds: {
            reliability: 90,
          },
        },
      });
      const model = createBasicModel({ trust: [] });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_trust_scope_not_found');
    });
  });

  // ============================================================================
  // Model Policy Tests
  // ============================================================================

  describe('Model Policy Tests', () => {
    it('TS24: Tool in model allowlist → ALLOWED', () => {
      const tool = createBasicTool({ id: 'test-tool' });
      const model = createBasicModel({
        toolPolicy: {
          allowedTools: ['test-tool', 'other-tool'],
          deniedTools: [],
        },
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });

    it('TS25: Tool not in model allowlist (non-empty) → DENIED', () => {
      const tool = createBasicTool({ id: 'test-tool' });
      const model = createBasicModel({
        toolPolicy: {
          allowedTools: ['other-tool'],
          deniedTools: [],
        },
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_policy_tool_not_in_allowlist');
    });

    it('TS26: Tool in model denylist → DENIED', () => {
      const tool = createBasicTool({ id: 'test-tool' });
      const model = createBasicModel({
        toolPolicy: {
          allowedTools: [],
          deniedTools: ['test-tool'],
        },
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('model_policy_denies_tool');
    });

    it('TS27: Empty allowlist (allow all) → ALLOWED', () => {
      const tool = createBasicTool({ id: 'test-tool' });
      const model = createBasicModel({
        toolPolicy: {
          allowedTools: [],
          deniedTools: [],
        },
      });
      const userRoles = ['user'];

      const result = validator.validateToolAccess(tool, userRoles, model);

      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance Tests', () => {
    it('should validate in <1ms (P95)', () => {
      const tool = createBasicTool({
        rbac: {
          userRoles: { required: ['user'], denied: [] },
          modelRoles: { required: ['llm'], denied: [] },
          modelTiers: { allowed: ['premium'], denied: [] },
          minTrustThresholds: {
            reliability: 90,
            fidelity: 90,
          },
        },
      });
      const model = createBasicModel();
      const userRoles = ['user'];

      const iterations = 1000;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        validator.validateToolAccess(tool, userRoles, model);
        const end = performance.now();
        times.push(end - start);
      }

      times.sort((a, b) => a - b);
      const p95Index = Math.floor(iterations * 0.95);
      const p95Time = times[p95Index];

      expect(p95Time).toBeLessThan(1);
    });
  });
});
