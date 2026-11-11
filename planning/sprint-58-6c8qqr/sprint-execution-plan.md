# Sprint 58 Execution Plan: Model-Based RBAC - Dual-Layer Validation & Context Propagation

**Sprint ID**: sprint-58-6c8qqr
**Owner**: christophernavta
**Duration**: 2-3 weeks (14-21 days)
**Status**: Planning
**Based On**: Sprint 56 Implementation Plan (planning/sprint-56-rqadsk/implementation-plan.md)
**Architecture**: Sprint 55 Technical Architecture (planning/sprint-55-h17jpp/technical-architecture.md)

---

## Executive Summary

This sprint implements **model-based RBAC** (Role-Based Access Control), fundamentally shifting from agent-based permissions to model-based permissions. The LLM model (gpt-4, claude-sonnet, etc.) becomes the security principal for tool access, not the orchestrating agent (llm-bot, reflex).

### Key Transformation

| Aspect | Before Sprint 58 | After Sprint 58 |
|--------|------------------|-----------------|
| **RBAC Model** | Agent-based (`agentAllowlist`) | Model-based (dual-layer User × Model) |
| **Security Principal** | Agent (llm-bot, query-analyzer) | Model (gpt-4, claude-opus, reflex) |
| **Context Field** | `agentName?: string` | `modelId: string` (required) |
| **Permission Logic** | User roles only | User roles ∩ Model permissions |
| **Tool Access Control** | Coarse-grained (server-level) | Fine-grained (per-tool, per-model) |
| **Cost Control** | None | Model tier restrictions |
| **Trust Enforcement** | None | Multi-dimensional trust scores |

### Why Model-Based RBAC?

**Fundamental Insight**: The **LLM model is the decision-maker**, not the agent.

- **Agent (llm-bot)**: Orchestrates requests, routes events, manages context
- **Model (gpt-4, claude-sonnet)**: Decides which tools to invoke, generates arguments, interprets results

**Implications**:
1. Same agent (llm-bot) with different models has different permissions
2. Cost control: Restrict expensive tools to premium models
3. Security tiers: High-risk tools only for trusted models
4. Request-scoped permissions: Model choice cascades through lifecycle

---

## Sprint Goal

Implement dual-layer RBAC (User × Model) and propagate `modelId` through tool execution requests, enabling:
- Fine-grained security control per model
- Cost optimization (premium tools only for premium models)
- Trust-based access (high-risk tools require high-trust models)
- Request cascading (model permissions flow through nested calls)

---

## Deliverables

### 1. Updated ToolExecutionContext Interface
- **File**: `src/types/tools.ts`
- **Changes**:
  - Add `modelId: string` (required field)
  - Remove `agentName?: string` (deprecated)
- **Impact**: Breaking change for all tool invocations
- **Migration**: Update all callsites to provide `modelId`

### 2. ToolGateway Module
- **File**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
- **Interface**: `IToolGateway`
- **Responsibilities**:
  - Tool execution orchestration
  - Dual-layer RBAC validation (User × Model)
  - McpClientManager integration
  - LRU cache (tool/model metadata, 5min TTL)
  - Event logging to Loki
- **Key Methods**:
  - `execute(toolId, args, context): Promise<ToolResult>`
  - `validateToolAccess(toolId, userId, modelId, userRoles): Promise<RBACValidationResult>`
  - `listAvailableTools(userId, modelId, userRoles): Promise<string[]>`

### 3. RbacValidator (Dual-Layer)
- **File**: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`
- **Algorithm**: Sprint 55 Section 6.3
- **Validation Checks**:
  1. User required roles (must have ALL)
  2. User denied roles (must have NONE)
  3. Model required roles (must have ALL)
  4. Model denied roles (must have NONE)
  5. Model tier restrictions (allowed/denied tiers)
  6. Model tool policy (allowlist/denylist)
  7. Model trust thresholds (per dimension: reliability, fidelity, integrity, calibration)
- **Return**: `{ allowed: boolean, reason?: string, details?: string }`

### 4. Model Tier Enforcement
- **Location**: ToolGateway module
- **Logic**:
  - Check `tool.rbac.modelTiers.allowed` (whitelist)
  - Check `tool.rbac.modelTiers.denied` (blacklist)
  - Deny if model tier not in allowed list (when non-empty)
  - Deny if model tier in denied list
- **Example**: Image generation tool restricted to `['premium', 'enterprise']` tiers

### 5. Trust Score Validation
- **Location**: RbacValidator
- **Logic**:
  - Check `tool.rbac.minTrustThresholds` (optional)
  - Match on trust scope (default: 'tool-use')
  - Compare scores per dimension (reliability, fidelity, integrity, calibration)
  - Deny if any dimension below threshold
- **Multi-Dimensional Trust**:
  - **Reliability**: Produces correct, useful results (0-100)
  - **Fidelity**: Follows instructions and constraints (0-100)
  - **Integrity**: Resists manipulation, respects boundaries (0-100)
  - **Calibration**: Recognizes uncertainty and limitations (0-100)

### 6. Updated llm-bot Service
- **File**: `src/apps/llm-bot-service.ts`
- **Changes**:
  - Extract model ID from LLM provider config
  - Create `ToolExecutionContext` with `modelId`
  - Pass `modelId` to all tool invocations
- **Model Selection**:
  - Use configured LLM model ID (e.g., `gpt-4`, `claude-opus-3.5`)
  - Default to `gpt-4-turbo` if not specified
- **Context Propagation**:
  - Model ID flows through entire request lifecycle
  - Nested tool calls inherit same model ID

### 7. Updated reflex Service
- **File**: `src/apps/reflex-service.ts`
- **Changes**:
  - Use `modelId: 'reflex'` for all tool executions
  - Register `reflex` as deterministic agent model in ModelRegistry
  - Pass `modelId` in ToolExecutionContext when calling tool-orchestrator
- **Model Profile**:
  - Type: `deterministic` (rule-based, not LLM)
  - Tier: `deterministic`
  - Trust scores: Optimized for reliability (100% reliability, 0% creativity)
- **RBAC Enforcement**:
  - Per-agent tool permissions via `reflex` model RBAC
  - Enables metrics tracking per agent type

### 8. RBAC Test Suite
- **Location**: `src/apps/tool-orchestrator-service/modules/gateway/__tests__/rbac-validator.test.ts`
- **Coverage**: 20+ test scenarios
- **Test Cases**:
  - User has role, model lacks role → DENIED
  - User lacks role, model has role → DENIED
  - Both have roles → ALLOWED
  - Model tier not allowed → DENIED
  - Model tier denied → DENIED
  - Trust score below threshold (per dimension) → DENIED
  - Model policy denies tool → DENIED
  - Model policy allowlist excludes tool → DENIED
  - Combined constraints (all pass) → ALLOWED
  - Edge cases: Empty allowlists, missing trust scopes, etc.
- **Integration Tests**: Deploy to agent-dev, test RBAC scenarios

### 9. Clear Error Messages
- **Format**: Structured error responses with reason codes
- **Fields**:
  - `allowed: false`
  - `reason: string` (machine-readable code)
  - `details?: string` (human-readable explanation)
- **Example Reasons**:
  - `user_missing_required_roles`
  - `user_has_denied_role`
  - `model_missing_required_roles`
  - `model_has_denied_role`
  - `model_tier_not_allowed`
  - `model_tier_denied`
  - `model_policy_denies_tool`
  - `model_trust_insufficient`
- **Logging**: All denials logged to Loki with full context

---

## Task Breakdown

### Phase 1: Core Infrastructure (Days 1-5)

#### Task 1.1: Extend ToolExecutionContext (1 day)
**Files**: `src/types/tools.ts`

**Changes**:
```typescript
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // NEW: Required
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // Removed: agentName?: string;
}
```

**Subtasks**:
- [ ] Update `ToolExecutionContext` interface
- [ ] Remove `agentName` field (breaking change)
- [ ] Add `modelId: string` (required)
- [ ] Update all type exports
- [ ] Run type check: `npm run build`

**Acceptance**:
- TypeScript compilation succeeds
- No references to `agentName` in codebase
- `modelId` is required field

---

#### Task 1.2: Implement ToolGateway Module (5 days)
**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.interface.ts`

**Interface**:
```typescript
interface IToolGateway {
  execute(toolId: string, args: unknown, context: ToolExecutionContext): Promise<ToolResult>;
  validateToolAccess(toolId: string, userId: string, modelId: string, userRoles: string[]): Promise<RBACValidationResult>;
  listAvailableTools(userId: string, modelId: string, userRoles: string[]): Promise<string[]>;
  ensureMcpClient(serverId: string): Promise<void>;
  disconnectMcpClient(serverId: string): Promise<void>;
}
```

**Subtasks**:
- [ ] Create `tool-gateway.interface.ts`
- [ ] Create `tool-gateway.ts` implementation
- [ ] Implement LRU cache (tool/model metadata, 5min TTL)
- [ ] Implement `execute()` method
- [ ] Implement `validateToolAccess()` method
- [ ] Integrate McpClientManager for MCP servers
- [ ] Add execution routing (MCP/internal/composition)
- [ ] Add event logging (Loki structured logs)
- [ ] Add timeout enforcement
- [ ] Write unit tests (80%+ coverage)

**Dependencies**:
- ToolRegistry module (Sprint 57)
- ModelRegistry module (Sprint 57)
- McpClientManager (existing)

**Acceptance**:
- ToolGateway executes tools successfully
- Cache hit ratio > 90% in tests
- All methods fully tested
- Integration with ToolRegistry/ModelRegistry working

---

#### Task 1.3: Implement Dual-Layer RBAC Validator (4 days)
**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.test.ts`

**Algorithm** (from Sprint 55 Section 6.3):
```typescript
function validateToolAccess(
  tool: ToolRegistryDocument,
  userRoles: string[],
  model: ModelRegistryDocument
): { allowed: boolean; reason?: string; details?: string } {
  // 1. User required roles
  // 2. User denied roles
  // 3. Model required roles
  // 4. Model denied roles
  // 5. Model tier restrictions
  // 6. Model tool policy
  // 7. Model trust thresholds
}
```

**Subtasks**:
- [ ] Create `rbac-validator.ts`
- [ ] Implement user role validation (required/denied)
- [ ] Implement model role validation (required/denied)
- [ ] Implement model tier enforcement (allowed/denied)
- [ ] Implement model tool policy (allowlist/denylist)
- [ ] Implement trust score validation (multi-dimensional)
- [ ] Add clear error messages with reason codes
- [ ] Write comprehensive test suite (20+ scenarios)
- [ ] Test edge cases (empty lists, missing scopes)

**Test Scenarios**:
1. User has role, model lacks role → DENIED
2. User lacks role, model has role → DENIED
3. Both have roles → ALLOWED
4. Model tier not in allowed list → DENIED
5. Model tier in denied list → DENIED
6. Trust score below threshold (reliability) → DENIED
7. Trust score below threshold (fidelity) → DENIED
8. Trust score below threshold (integrity) → DENIED
9. Trust score below threshold (calibration) → DENIED
10. Model policy denies tool → DENIED
11. Model policy allowlist excludes tool → DENIED
12. All constraints pass → ALLOWED
13. Empty allowlist (allow all) → ALLOWED
14. Missing trust scope → Use 'general' scope fallback
15. Tool has no trust requirements → Skip trust validation
16. User has denied role → DENIED
17. Model has denied role → DENIED
18. Both user and model denied → DENIED (fail early)
19. Model allowlist empty (allow all tools) → ALLOWED
20. Combined: User + Model + Tier + Trust all pass → ALLOWED

**Acceptance**:
- All 20+ test scenarios pass
- Clear error messages for all denial reasons
- Sub-millisecond validation performance (<1ms P95)

---

### Phase 2: Service Integration (Days 6-10)

#### Task 2.1: Update llm-bot Service (3 days)
**Files**:
- `src/apps/llm-bot-service.ts`
- `src/apps/llm-bot-service.test.ts`

**Changes**:
```typescript
// Extract model ID from LLM config
const modelId = this.llmProvider.getModelId(); // e.g., 'gpt-4', 'claude-opus-3.5'

// Create context with modelId
const context: ToolExecutionContext = {
  userRoles: event.identity.user?.roles || [],
  userId: event.identity.user?.id,
  modelId: modelId,  // NEW
  correlationId: event.correlationId,
  sessionId: event.identity.session?.id
};

// Execute tool with model context
const result = await this.toolGateway.execute(toolId, args, context);
```

**Subtasks**:
- [ ] Extract model ID from LLM provider config
- [ ] Update `ToolExecutionContext` creation (add `modelId`)
- [ ] Remove `agentName` from context (breaking change)
- [ ] Pass `modelId` to all tool invocations
- [ ] Update tool execution flow
- [ ] Add model ID logging (for debugging)
- [ ] Write integration tests
- [ ] Test with multiple models (gpt-4, claude-opus, gpt-3.5-turbo)

**Model Selection Logic**:
```typescript
getModelId(): string {
  // Priority: Event override > User config > Service default
  return this.event.config?.modelId
    || this.userConfig.preferredModel
    || this.config.DEFAULT_MODEL
    || 'gpt-4-turbo';
}
```

**Acceptance**:
- llm-bot passes `modelId` in all tool invocations
- Context includes correct model ID
- Integration tests pass with multiple models
- No references to `agentName` remain

---

#### Task 2.2: Implement Model Tier Enforcement (2 days)
**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (update)
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.test.ts` (update)

**Logic**:
```typescript
// In RbacValidator.validateToolAccess()
if (tool.rbac.modelTiers.allowed.length > 0) {
  if (!tool.rbac.modelTiers.allowed.includes(model.tier)) {
    return {
      allowed: false,
      reason: 'model_tier_not_allowed',
      details: `Tool requires model tier: ${tool.rbac.modelTiers.allowed.join(' or ')}, but ${modelId} is tier ${model.tier}`
    };
  }
}

if (tool.rbac.modelTiers.denied.includes(model.tier)) {
  return {
    allowed: false,
    reason: 'model_tier_denied',
    details: `Tool explicitly denies model tier: ${model.tier}`
  };
}
```

**Subtasks**:
- [ ] Add tier enforcement to RbacValidator
- [ ] Write tests for allowed tiers (whitelist)
- [ ] Write tests for denied tiers (blacklist)
- [ ] Test edge case: Empty allowed list (allow all)
- [ ] Test combined: Denied tier + allowed list
- [ ] Integration test: Premium tool with basic model → DENIED

**Example Tool Configuration**:
```yaml
# Image generation tool (premium only)
rbac:
  modelTiers:
    allowed: ['premium', 'enterprise']
    denied: ['free', 'basic']
```

**Acceptance**:
- Premium tools blocked for basic models
- Basic tools accessible to all models
- Clear error messages for tier denials
- Tests cover all tier scenarios

---

#### Task 2.3: Implement Trust Score Validation (3 days)
**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (update)
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.test.ts` (update)

**Logic**:
```typescript
// In RbacValidator.validateToolAccess()
if (tool.rbac.minTrustThresholds) {
  const scope = tool.rbac.minTrustThresholds.scope || 'tool-use';
  const modelTrust = model.trust.find(t => t.scope === scope);

  if (!modelTrust) {
    // Fallback to 'general' scope
    modelTrust = model.trust.find(t => t.scope === 'general');
    if (!modelTrust) {
      return {
        allowed: false,
        reason: 'model_trust_scope_not_found',
        details: `Model ${modelId} has no trust profile for scope: ${scope} or 'general'`
      };
    }
  }

  // Check each trust dimension
  const thresholds = tool.rbac.minTrustThresholds;
  for (const [dimension, minScore] of Object.entries(thresholds)) {
    if (dimension === 'scope') continue; // Skip scope field

    const actualScore = modelTrust.scores[dimension as keyof typeof modelTrust.scores];
    if (actualScore < minScore) {
      return {
        allowed: false,
        reason: 'model_trust_insufficient',
        details: `Tool requires ${dimension} >= ${minScore}, but ${modelId} has ${actualScore} (scope: ${scope})`
      };
    }
  }
}
```

**Trust Dimensions**:
1. **Reliability** (0-100): Produces correct, useful results
2. **Fidelity** (0-100): Follows instructions and constraints
3. **Integrity** (0-100): Resists manipulation, respects boundaries
4. **Calibration** (0-100): Recognizes uncertainty and limitations

**Subtasks**:
- [ ] Add trust validation to RbacValidator
- [ ] Implement scope matching ('tool-use', 'general' fallback)
- [ ] Implement dimension threshold checks
- [ ] Write tests for each dimension (reliability, fidelity, integrity, calibration)
- [ ] Test scope fallback logic
- [ ] Test missing trust profile → DENIED
- [ ] Test all dimensions pass → ALLOWED
- [ ] Integration test: High-risk tool with low-trust model → DENIED

**Example Tool Configuration**:
```yaml
# Admin tool (high trust required)
rbac:
  minTrustThresholds:
    scope: 'tool-use'
    reliability: 95
    fidelity: 95
    integrity: 90
    calibration: 85
```

**Acceptance**:
- Trust score validation working for all 4 dimensions
- Scope fallback logic (tool-use → general) working
- Clear error messages with dimension details
- Tests cover all edge cases

---

#### Task 2.4: Update reflex Service (2 days)
**Files**:
- `src/apps/reflex-service.ts`
- `src/apps/reflex-service.test.ts`

**Changes**:
```typescript
// Register reflex as a model (in ModelRegistry)
const reflexModel: ModelRegistryDocument = {
  id: 'reflex',
  provider: 'bitbrat',
  displayName: 'Reflex (Deterministic Agent)',
  description: 'Rule-based deterministic agent',
  roles: ['model', 'deterministic', 'reflex'],
  tier: 'deterministic',
  trust: [{
    scope: 'tool-use',
    scores: {
      reliability: 100,  // Deterministic = 100% reliable
      fidelity: 100,     // Always follows rules
      integrity: 100,    // No manipulation risk
      calibration: 50    // Limited uncertainty recognition
    },
    evidence: {
      source: 'manual',
      samples: 0,
      updatedAt: new Date().toISOString()
    }
  }],
  capabilities: {
    toolCalling: true,
    vision: false,
    streaming: false,
    maxContextTokens: 0,
    maxOutputTokens: 0
  },
  cost: {
    inputTokenCost: 0,
    outputTokenCost: 0
  },
  toolPolicy: {
    allowedTools: [],  // Empty = allow all
    deniedTools: [],
    maxCostPerCall: undefined,
    maxConcurrentTools: undefined
  },
  metrics: {
    totalRequests: 0,
    totalTokensUsed: 0,
    totalCostUSD: 0
  }
};

// In reflex service:
const context: ToolExecutionContext = {
  userRoles: event.identity.user?.roles || [],
  userId: event.identity.user?.id,
  modelId: 'reflex',  // NEW: Use 'reflex' as model ID
  correlationId: event.correlationId,
  sessionId: event.identity.session?.id
};

// Execute tool with reflex model context
await this.toolGateway.execute(toolId, args, context);
```

**Subtasks**:
- [ ] Register `reflex` model in ModelRegistry (seed script)
- [ ] Update reflex service to use `modelId: 'reflex'`
- [ ] Remove `agentName` from context
- [ ] Update composition templates to include `modelId`
- [ ] Write tests for reflex tool execution
- [ ] Verify RBAC enforcement for reflex model
- [ ] Integration test: Deploy to agent-dev, test reflex

**Acceptance**:
- reflex passes `modelId: 'reflex'` in all tool invocations
- reflex model registered in ModelRegistry
- RBAC enforced via reflex model permissions
- Metrics track reflex separately from LLMs

---

### Phase 3: Testing & Validation (Days 11-14)

#### Task 3.1: Create RBAC Testing Suite (3 days)
**Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/rbac-integration.test.ts`
- `scripts/test-rbac-scenarios.ts`

**Test Scenarios** (20+ cases):

**User Role Tests**:
1. User has required role → ALLOWED (if model also passes)
2. User missing required role → DENIED
3. User has denied role → DENIED
4. User has multiple roles, one denied → DENIED

**Model Role Tests**:
5. Model has required role → ALLOWED (if user also passes)
6. Model missing required role → DENIED
7. Model has denied role → DENIED
8. Model has multiple roles, one denied → DENIED

**Combined User × Model Tests**:
9. User OK, model fails → DENIED
10. User fails, model OK → DENIED
11. Both pass → ALLOWED
12. Both fail → DENIED

**Model Tier Tests**:
13. Model tier in allowed list → ALLOWED
14. Model tier not in allowed list → DENIED
15. Model tier in denied list → DENIED
16. Empty allowed list (allow all tiers) → ALLOWED

**Trust Score Tests**:
17. All trust dimensions pass → ALLOWED
18. Reliability below threshold → DENIED
19. Fidelity below threshold → DENIED
20. Integrity below threshold → DENIED
21. Calibration below threshold → DENIED
22. Missing trust scope, fallback to 'general' → ALLOWED
23. No trust profile → DENIED

**Model Policy Tests**:
24. Tool in model allowlist → ALLOWED
25. Tool not in model allowlist (non-empty) → DENIED
26. Tool in model denylist → DENIED
27. Empty allowlist (allow all) → ALLOWED

**Subtasks**:
- [ ] Write unit tests for each scenario
- [ ] Create integration test suite (agent-dev)
- [ ] Test with multiple models (gpt-4, gpt-3.5-turbo, reflex)
- [ ] Test with multiple users (admin, user, guest)
- [ ] Verify all denials logged to Loki
- [ ] Verify clear error messages
- [ ] Load test: 1000 RBAC validations, P95 < 1ms

**Integration Test Plan**:
1. Deploy tool-orchestrator to agent-dev
2. Seed models: gpt-4 (premium), gpt-3.5-turbo (basic), reflex (deterministic)
3. Create test tools with varying RBAC requirements
4. Execute tests via bitbrat-dev MCP client
5. Verify denials in Loki logs
6. Verify allowed invocations succeed

**Acceptance**:
- All 27+ test scenarios pass
- Integration tests pass in agent-dev
- P95 RBAC validation < 1ms
- Clear error messages for all denials
- All denials logged to Loki with full context

---

#### Task 3.2: End-to-End Validation (1 day)
**Activities**:
- [ ] Deploy tool-orchestrator to agent-dev
- [ ] Deploy llm-bot with modelId support
- [ ] Deploy reflex with modelId support
- [ ] Send test messages via bitbrat-dev
- [ ] Verify RBAC enforcement in Loki logs
- [ ] Test premium tool with basic model → DENIED
- [ ] Test basic tool with premium model → ALLOWED
- [ ] Test admin tool with high-trust model → ALLOWED
- [ ] Test admin tool with low-trust model → DENIED
- [ ] Verify no regressions in existing functionality

**Acceptance**:
- All E2E tests pass
- No RBAC false positives (allowed when should deny)
- No RBAC false negatives (denied when should allow)
- Backward compatibility: tool-gateway still operational

---

## Dependencies

### Completed (Sprint 57)
- ✅ tool-orchestrator Bit created
- ✅ ToolRegistry module implemented
- ✅ ModelRegistry module implemented
- ✅ PostgreSQL migrations (platform_tool_registry, model_registry)
- ✅ Model registry seeded with 8+ models
- ✅ Existing tools imported to platform_tool_registry

### Required for Sprint 58
- tool-orchestrator deployed and operational
- ModelRegistry contains seeded models (gpt-4, claude-opus, gpt-3.5-turbo, etc.)
- ToolRegistry contains imported tools
- PostgreSQL DocumentStore accessible
- Loki deployed for event logging

### Blocked By
None (Sprint 57 completed)

### Blocks
- Sprint 59: Observability (ToolObserver + Loki Integration)
- Sprint 60: Composition RBAC Integration
- Sprint 61: Validation & Cutover

---

## Risk Mitigation

### Risk 1: Breaking Changes to ToolExecutionContext
**Impact**: High (all tool invocations affected)
**Probability**: High (intentional breaking change)

**Mitigation**:
1. Feature flag: `ENABLE_MODEL_BASED_RBAC` (default: false)
2. Dual-path execution (legacy agent-based vs. new model-based)
3. Gradual rollout: llm-bot first, then reflex
4. Rollback plan: Revert to Sprint 57 (agent-based RBAC)

**Validation**:
- Comprehensive test suite (20+ scenarios)
- Integration testing in agent-dev
- Staged deployment (local → staging → production)

---

### Risk 2: Performance Degradation (RBAC Validation)
**Impact**: Medium (latency increase)
**Probability**: Low (optimized algorithm)

**Mitigation**:
1. LRU cache (tool/model metadata, 5min TTL)
2. In-memory validation (no network calls)
3. Early exit on denials (fail-fast)
4. Benchmark: P95 < 1ms target

**Monitoring**:
- Loki queries for RBAC validation latency
- Alerting: P95 > 5ms
- Cache hit ratio monitoring (target: >90%)

---

### Risk 3: Model Trust Score Accuracy
**Impact**: Medium (incorrect access denials)
**Probability**: Low (manual seeding, conservative thresholds)

**Mitigation**:
1. Conservative trust scores (manual seeding)
2. Scope fallback ('tool-use' → 'general')
3. Clear error messages (dimension details)
4. Admin override tool: `model.update_trust_scores`

**Validation**:
- Test with known models (gpt-4, claude-opus)
- Benchmark against published trust scores
- User feedback collection (false denials)

---

## Success Metrics

### Implementation Success
- [ ] ToolExecutionContext updated (`modelId` required, `agentName` removed)
- [ ] ToolGateway module implemented (dual-layer RBAC)
- [ ] RbacValidator implemented (7-step validation)
- [ ] Model tier enforcement working
- [ ] Trust score validation working
- [ ] llm-bot passes `modelId` in all invocations
- [ ] reflex passes `modelId: 'reflex'`
- [ ] 20+ RBAC test scenarios passing
- [ ] Clear error messages for all denials

### Performance Success
- [ ] P95 RBAC validation < 1ms
- [ ] Cache hit ratio > 90%
- [ ] P95 tool execution latency < 100ms (unchanged from Sprint 57)
- [ ] No memory leaks (stable over 1 hour)

### Quality Success
- [ ] 80%+ unit test coverage (ToolGateway, RbacValidator)
- [ ] 100% E2E test pass rate
- [ ] 0 RBAC false positives (allowed when should deny)
- [ ] 0 RBAC false negatives (denied when should allow)
- [ ] All denials logged to Loki with full context

### Operational Success
- [ ] tool-orchestrator deployed to agent-dev
- [ ] llm-bot integrated with modelId support
- [ ] reflex integrated with modelId support
- [ ] Backward compatibility: tool-gateway still operational
- [ ] No production incidents

---

## Acceptance Criteria

### Must Have (Blocking)
1. ✅ ToolExecutionContext has `modelId: string` (required)
2. ✅ `agentName` field removed from ToolExecutionContext
3. ✅ ToolGateway module implements dual-layer RBAC
4. ✅ RbacValidator validates User × Model permissions
5. ✅ Model tier enforcement working (premium tools blocked for basic models)
6. ✅ Trust score validation working (all 4 dimensions)
7. ✅ llm-bot passes `modelId` in all tool invocations
8. ✅ reflex passes `modelId: 'reflex'` in all tool invocations
9. ✅ 20+ RBAC test scenarios passing
10. ✅ Clear error messages for all denials
11. ✅ All denials logged to Loki with full context
12. ✅ Integration tests pass in agent-dev

### Should Have (Important)
1. ✅ LRU cache (tool/model metadata, 5min TTL)
2. ✅ P95 RBAC validation < 1ms
3. ✅ Cache hit ratio > 90%
4. ✅ 80%+ unit test coverage
5. ✅ E2E tests pass (llm-bot + reflex)

### Could Have (Nice to Have)
1. ⭕ Model trust score benchmarking
2. ⭕ Admin tools: `model.update_trust_scores`, `tool.explain_access`
3. ⭕ Grafana dashboards for RBAC denials

---

## Timeline

### Week 1 (Days 1-7)
- **Days 1-2**: Task 1.1 - Extend ToolExecutionContext
- **Days 2-6**: Task 1.2 - Implement ToolGateway Module
- **Days 3-7**: Task 1.3 - Implement Dual-Layer RBAC Validator (parallel)

### Week 2 (Days 8-14)
- **Days 8-10**: Task 2.1 - Update llm-bot Service
- **Days 9-10**: Task 2.2 - Implement Model Tier Enforcement (parallel)
- **Days 11-13**: Task 2.3 - Implement Trust Score Validation
- **Days 12-13**: Task 2.4 - Update reflex Service (parallel)
- **Days 11-13**: Task 3.1 - Create RBAC Testing Suite (parallel)
- **Day 14**: Task 3.2 - End-to-End Validation

### Sprint End (Day 14-21)
- **Day 15**: Buffer for issues/refinements
- **Days 16-17**: Documentation updates
- **Days 18-20**: Agent-dev validation
- **Day 21**: Sprint completion & PR

---

## Next Steps (Post-Sprint 58)

### Sprint 59: Observability
- ToolObserver module (Loki integration)
- Tool invocation event logging
- Grafana dashboards (RBAC denials, tool metrics)
- Health tracking

### Sprint 60: Composition RBAC
- Registration-time RBAC validation
- Runtime re-validation
- RBAC inheritance logic

### Sprint 61: Validation & Cutover
- E2E integration testing
- Load testing (1000 invocations)
- Migration script (tool-gateway → tool-orchestrator)
- Production deployment
- tool-gateway deprecation

---

## References

- **Sprint 56 Implementation Plan**: `planning/sprint-56-rqadsk/implementation-plan.md`
- **Sprint 55 Technical Architecture**: `planning/sprint-55-h17jpp/technical-architecture.md`
- **Sprint 57 Completion**: `planning/sprint-57-54vza9/` (foundation)
- **CLAUDE.md**: Platform development guidelines
- **AGENTS.md**: Sprint protocol

---

**End of Sprint Execution Plan**
