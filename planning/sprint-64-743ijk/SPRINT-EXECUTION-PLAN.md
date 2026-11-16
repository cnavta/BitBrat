# Sprint 64 Execution Plan: Model-Based RBAC

**Sprint ID**: sprint-64-743ijk
**Duration**: 2-3 weeks (10-15 working days)
**Goal**: Implement dual-layer RBAC (User × Model) validation
**Prerequisites**: Sprint 63 complete (ToolRegistry + ModelRegistry functional)

---

## Executive Summary

Sprint 64 implements **model-based RBAC** - a fundamental shift from agent-based permissions to dual-layer validation (User × Model). The LLM model (gpt-4, claude-sonnet, etc.) becomes the security principal, not the orchestrating agent (llm-bot, query-analyzer).

**Key Innovation**: Same agent can operate with different permissions based on model choice. Example: llm-bot with gpt-4 has premium tool access, llm-bot with gpt-3.5-turbo does not.

### What We're Building

1. ✅ **ToolExecutionContext Update** - Add `modelId` (required), remove `agentName` (breaking change)
2. ✅ **RbacValidator Module** - Dual-layer validation logic (User × Model)
3. ✅ **ToolGateway Module** - Tool execution orchestration with RBAC enforcement
4. ✅ **Updated llm-bot** - Passes LLM modelId (gpt-4, claude, etc.)
5. ✅ **Updated reflex** - Passes agent modelId ('reflex')
6. ✅ **Model Tier Enforcement** - Premium tools restricted to premium models
7. ✅ **Trust Score Validation** - Tools require minimum trust scores
8. ✅ **RBAC Test Suite** - 20+ test scenarios

---

## Bootstrap Information

### Entry Point

**Primary**: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (new file)

### Current State (Sprint 63 Baseline)

**What Exists**:
- ToolRegistry module (Sprint 63) - Full CRUD operations for tools
- ModelRegistry module (Sprint 63) - Model catalog with security profiles
- PostgreSQL migrations complete - `platform_tool_registry` and `model_registry` tables
- 10+ models seeded - LLM models (gpt-4, claude, gpt-3.5-turbo) + agent models (reflex)
- MCP tools functional - tool.import, tool.update_config, model.register, model.get

**What's Missing**:
```typescript
// src/types/tools.ts - CURRENT (Sprint 63)
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;           // ❌ DEPRECATED - agent is orchestrator, not decision-maker
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // modelId does NOT exist - being added in Sprint 64
}
```

**Problems**:
1. No `modelId` field in ToolExecutionContext
2. Agent-based RBAC (agentAllowlist) - wrong security model
3. No dual-layer RBAC validation
4. llm-bot doesn't pass model ID in context
5. reflex doesn't pass model ID

### Goal State (Sprint 64 Completion)

```typescript
// src/types/tools.ts - AFTER Sprint 64
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // 🆕 REQUIRED - the LLM model making tool decisions
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // agentName removed (breaking change)
}
```

**What Will Work**:
- ToolGateway validates dual-layer RBAC (User roles ∩ Model permissions)
- llm-bot passes LLM model ID (gpt-4, claude, etc.)
- reflex passes agent model ID ('reflex')
- Premium tools (image generation, video processing) restricted to premium models
- Basic models (gpt-3.5-turbo) cannot access expensive/admin tools
- Trust score validation (tools require minimum reliability/fidelity/integrity/calibration)

---

## Architecture Impact

### Breaking Changes

**ToolExecutionContext Interface** (src/types/tools.ts):
```typescript
// BEFORE (Sprint 63)
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;           // Removed
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}

// AFTER (Sprint 64)
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // REQUIRED (breaking change)
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}
```

**Impact**:
- All tool-invoking services MUST update simultaneously
- llm-bot: Pass LLM model ID (e.g., 'gpt-4', 'claude-opus-3.5')
- reflex: Pass agent model ID ('reflex')
- Any other services using tools must update

**Migration Strategy**:
1. Update interface in `src/types/tools.ts`
2. Update llm-bot (T4)
3. Update reflex (T5)
4. Verify all consumers pass modelId
5. Deploy in single atomic commit (minimize downtime)

### New Modules

**1. ToolGateway Module** (`src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`):
- **Responsibilities**: Tool execution orchestration, RBAC enforcement, MCP client management
- **Dependencies**: ToolRegistry, ModelRegistry, ToolObserver, MCP Client Manager
- **Key Methods**:
  - `execute(toolId, args, context)` - Execute tool with RBAC validation
  - `validateToolAccess(toolId, userId, modelId, userRoles)` - RBAC validation
  - `listAvailableTools(modelId, userRoles)` - Filter tools by permissions

**2. RbacValidator Module** (`src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`):
- **Responsibilities**: Dual-layer RBAC validation (User × Model)
- **Dependencies**: ToolRegistry, ModelRegistry
- **Key Methods**:
  - `validateToolAccess(toolId, userRoles, modelId)` - Validate both user and model permissions
  - Checks: user required/denied roles, model required/denied roles, model tier restrictions, model tool policy, trust score thresholds

**3. Updated llm-bot** (`src/apps/llm-bot-service.ts`):
- **Changes**: Add `modelId` to ToolExecutionContext when executing tools
- **Model Selection**: Check annotations, user preferences, or default model
- **Impact**: Every tool invocation from llm-bot now includes model identity

**4. Updated reflex** (`src/apps/reflex-service.ts`):
- **Changes**: Pass `modelId='reflex'` in ToolExecutionContext
- **Impact**: Reflex model must be registered in ModelRegistry (Sprint 63 seeding)

---

## Task Breakdown

### Week 1: Foundation (Days 1-5)

#### **T1: Extend ToolExecutionContext (1 day)**

**Goal**: Update ToolExecutionContext interface to include `modelId`, remove `agentName`

**Files to Modify**:
- `src/types/tools.ts` - Update ToolExecutionContext interface

**Implementation**:
```typescript
// src/types/tools.ts
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // 🆕 REQUIRED
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // Removed: agentName
}
```

**Acceptance Criteria**:
- ✅ ToolExecutionContext has `modelId: string` (required)
- ✅ `agentName` removed from interface
- ✅ TypeScript compilation succeeds
- ✅ All references to `agentName` removed from codebase

**Validation Command**:
```bash
npm run build
grep -r "agentName" src/  # Should return no results
```

---

#### **T2: Implement ToolGateway Module (5 days)**

**Goal**: Create ToolGateway module for tool execution orchestration with RBAC enforcement

**Files to Create**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (~800 lines)
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.interface.ts` (~100 lines)

**Key Components**:
1. **ToolGateway Class**:
   - RBAC validation (calls RbacValidator)
   - Tool execution routing (MCP/internal/composition)
   - LRU cache for tool/model metadata (5min TTL)
   - Event logging to Loki
   - Timeout enforcement
   - Error handling

2. **Execution Handlers**:
   - `executeMcpTool()` - Placeholder for Sprint 65
   - `executeInternalTool()` - Placeholder for Sprint 65
   - `executeComposition()` - Placeholder for Sprint 65

**Implementation**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
export interface IToolGateway {
  execute(toolId: string, args: unknown, context: ToolExecutionContext): Promise<ToolResult>;
  validateToolAccess(toolId: string, userId: string, modelId: string, userRoles: string[]): Promise<RBACValidationResult>;
  listAvailableTools(modelId: string, userRoles: string[]): Promise<ToolRegistryDocument[]>;
}

export class ToolGateway implements IToolGateway {
  private rbacValidator: RbacValidator;
  private toolCache: Map<string, ToolRegistryDocument>;
  private modelCache: Map<string, ModelRegistryDocument>;

  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly modelRegistry: IModelRegistry,
    private readonly logger: Logger
  ) {
    this.rbacValidator = new RbacValidator(toolRegistry, modelRegistry);
    this.toolCache = new Map();
    this.modelCache = new Map();

    // Cache invalidation every 5 minutes
    setInterval(() => {
      this.toolCache.clear();
      this.modelCache.clear();
      this.logger.debug('cache_cleared', { type: 'tool_and_model' });
    }, 5 * 60 * 1000);
  }

  async execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 1. Get tool from registry (with caching)
      const tool = await this.getCachedTool(toolId);
      if (!tool) {
        throw new Error(`Tool ${toolId} not found`);
      }

      // 2. Validate RBAC (dual-layer: User × Model)
      const rbacResult = await this.rbacValidator.validateToolAccess(
        toolId,
        context.userRoles,
        context.modelId
      );

      if (!rbacResult.allowed) {
        // Log RBAC denial
        await this.logToolInvocation({
          toolId,
          modelId: context.modelId,
          userId: context.userId,
          status: 'denied',
          durationMs: Date.now() - startTime,
          rbacReason: rbacResult.reason,
          rbacDetails: rbacResult.details
        });

        throw new Error(`Access denied: ${rbacResult.details || rbacResult.reason}`);
      }

      // 3. Route to appropriate execution handler
      let result: ToolResult;
      if (tool.source === 'mcp') {
        result = await this.executeMcpTool(tool, args, context);
      } else if (tool.source === 'internal') {
        result = await this.executeInternalTool(tool, args, context);
      } else if (tool.source === 'composition') {
        result = await this.executeComposition(tool, args, context);
      } else {
        throw new Error(`Unknown tool source: ${tool.source}`);
      }

      // 4. Log successful execution
      await this.logToolInvocation({
        toolId,
        modelId: context.modelId,
        userId: context.userId,
        status: 'success',
        durationMs: Date.now() - startTime
      });

      return result;
    } catch (err) {
      // Log error
      await this.logToolInvocation({
        toolId,
        modelId: context.modelId,
        userId: context.userId,
        status: 'error',
        durationMs: Date.now() - startTime,
        errorMessage: err instanceof Error ? err.message : String(err)
      });

      throw err;
    }
  }

  private async getCachedTool(toolId: string): Promise<ToolRegistryDocument | null> {
    if (this.toolCache.has(toolId)) {
      return this.toolCache.get(toolId)!;
    }

    const tool = await this.toolRegistry.getTool(toolId);
    if (tool) {
      this.toolCache.set(toolId, tool);
    }

    return tool;
  }

  private async executeMcpTool(tool: ToolRegistryDocument, args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    throw new Error('MCP tool execution not yet implemented - Sprint 65');
  }

  private async executeInternalTool(tool: ToolRegistryDocument, args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    throw new Error('Internal tool execution not yet implemented - Sprint 65');
  }

  private async executeComposition(tool: ToolRegistryDocument, args: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    throw new Error('Composition execution not yet implemented - Sprint 65');
  }

  private async logToolInvocation(event: any): Promise<void> {
    this.logger.info({
      service: 'tool-orchestrator',
      level: event.status === 'error' ? 'error' : 'info',
      eventType: 'tool.invocation',
      ...event
    });
  }
}
```

**Acceptance Criteria**:
- ✅ ToolGateway implements IToolGateway interface
- ✅ RBAC validation enforced on all execution paths
- ✅ LRU cache for tool/model metadata (5min TTL)
- ✅ Logging placeholders for Sprint 66
- ✅ Execution placeholders for Sprint 65
- ✅ Unit tests: cache behavior, RBAC integration

**Validation Command**:
```bash
npm test -- tool-gateway.test.ts
npm run lint src/apps/tool-orchestrator-service/modules/gateway/
```

---

### Week 2: RBAC Validation (Days 6-10)

#### **T3: Implement Dual-Layer RBAC Validator (4 days)**

**Goal**: Create RbacValidator module for dual-layer (User × Model) RBAC validation

**Files to Create**:
- `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (~300 lines)

**Implementation**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts
export interface RBACValidationResult {
  allowed: boolean;
  reason?: string;
  details?: string;
}

export class RbacValidator {
  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly modelRegistry: IModelRegistry
  ) {}

  async validateToolAccess(
    toolId: string,
    userRoles: string[],
    modelId: string
  ): Promise<RBACValidationResult> {
    // 1. Get tool and model
    const tool = await this.toolRegistry.getTool(toolId);
    if (!tool) {
      return { allowed: false, reason: 'tool_not_found' };
    }

    const model = await this.modelRegistry.getModel(modelId);
    if (!model) {
      return { allowed: false, reason: 'model_not_found' };
    }

    const rbac = tool.rbac;

    // 2. Check user required roles
    const userHasRequiredRoles = rbac.userRoles.required.every(role =>
      userRoles.includes(role)
    );
    if (!userHasRequiredRoles) {
      return {
        allowed: false,
        reason: 'user_missing_required_roles',
        details: `User requires roles: ${rbac.userRoles.required.join(', ')}`
      };
    }

    // 3. Check user denied roles
    const userHasDeniedRole = rbac.userRoles.denied.some(role =>
      userRoles.includes(role)
    );
    if (userHasDeniedRole) {
      return {
        allowed: false,
        reason: 'user_has_denied_role',
        details: 'User has a role that is explicitly denied for this tool'
      };
    }

    // 4. Check model required roles
    const modelHasRequiredRoles = rbac.modelRoles.required.every(role =>
      model.roles.includes(role)
    );
    if (!modelHasRequiredRoles) {
      return {
        allowed: false,
        reason: 'model_missing_required_roles',
        details: `Model ${modelId} lacks required roles: ${rbac.modelRoles.required.join(', ')}`
      };
    }

    // 5. Check model denied roles
    const modelHasDeniedRole = rbac.modelRoles.denied.some(role =>
      model.roles.includes(role)
    );
    if (modelHasDeniedRole) {
      return {
        allowed: false,
        reason: 'model_has_denied_role',
        details: `Model ${modelId} is explicitly denied for this tool`
      };
    }

    // 6. Check model tier restrictions
    if (rbac.modelTiers.allowed.length > 0) {
      if (!rbac.modelTiers.allowed.includes(model.tier)) {
        return {
          allowed: false,
          reason: 'model_tier_not_allowed',
          details: `Tool requires model tier: ${rbac.modelTiers.allowed.join(' or ')}, but ${modelId} is tier ${model.tier}`
        };
      }
    }

    if (rbac.modelTiers.denied.includes(model.tier)) {
      return {
        allowed: false,
        reason: 'model_tier_denied',
        details: `Tool explicitly denies model tier: ${model.tier}`
      };
    }

    // 7. Check model's tool policy (allowlist/denylist)
    if (model.toolPolicy.deniedTools.includes(toolId)) {
      return {
        allowed: false,
        reason: 'model_policy_denies_tool',
        details: `Model ${modelId} policy denies tool ${toolId}`
      };
    }

    if (model.toolPolicy.allowedTools.length > 0) {
      if (!model.toolPolicy.allowedTools.includes(toolId)) {
        return {
          allowed: false,
          reason: 'model_policy_allows_only_specific_tools',
          details: `Model ${modelId} only allows specific tools, ${toolId} not included`
        };
      }
    }

    // 8. Check model trust thresholds (if tool requires minimum trust)
    if (rbac.minTrustThresholds) {
      const scope = rbac.minTrustThresholds.scope || 'tool-use';
      const modelTrust = model.trust.find(t => t.scope === scope);

      if (!modelTrust) {
        return {
          allowed: false,
          reason: 'model_trust_scope_not_found',
          details: `Model ${modelId} has no trust profile for scope: ${scope}`
        };
      }

      // Check each trust dimension threshold
      const thresholds = rbac.minTrustThresholds;
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

    // 9. All checks passed
    return { allowed: true };
  }
}
```

**Acceptance Criteria**:
- ✅ Validates user required/denied roles
- ✅ Validates model required/denied roles
- ✅ Validates model tier restrictions
- ✅ Validates model tool policy (allowlist/denylist)
- ✅ Validates model trust score thresholds
- ✅ Clear error messages with details
- ✅ 20+ unit test scenarios

**Test Scenarios**:
1. User has required roles, model has required roles → Allow
2. User missing required role → Deny (user_missing_required_roles)
3. User has denied role → Deny (user_has_denied_role)
4. Model missing required role → Deny (model_missing_required_roles)
5. Model has denied role → Deny (model_has_denied_role)
6. Model tier not allowed → Deny (model_tier_not_allowed)
7. Model tier denied → Deny (model_tier_denied)
8. Model policy denies tool → Deny (model_policy_denies_tool)
9. Model allowlist doesn't include tool → Deny (model_policy_allows_only_specific_tools)
10. Model trust score insufficient → Deny (model_trust_insufficient)

**Validation Command**:
```bash
npm test -- rbac-validator.test.ts --verbose
npm run lint src/apps/tool-orchestrator-service/modules/gateway/
```

---

### Week 3: Service Integration (Days 11-15)

#### **T4: Update llm-bot to Pass modelId (3 days)**

**Goal**: Update llm-bot to pass LLM model ID in ToolExecutionContext

**Files to Modify**:
- `src/apps/llm-bot-service.ts` - Add modelId to ToolExecutionContext

**Implementation**:
```typescript
// src/apps/llm-bot-service.ts
export class LlmBotServer extends Bit {
  private currentModel: string = 'gpt-4.1-mini'; // Default model

  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      async (event, attrs, ctx) => {
        // Extract model from event or use default
        const modelId = this.selectModel(event);

        // Create tool execution context with modelId
        const toolContext: ToolExecutionContext = {
          userRoles: event.identity?.user?.roles || [],
          userId: event.identity?.user?.id,
          modelId, // 🆕 NEW: Pass LLM model ID
          correlationId: event.correlationId,
          sessionId: event.sessionId
        };

        // Execute tools with model context
        const result = await this.executeLlmWithTools(
          event.message?.text || '',
          toolContext
        );

        event.candidates = [{ text: result }];
        await this.next(event);
        await ctx.ack();
      }
    );
  }

  private selectModel(event: InternalEventV2): string {
    // Check for explicit model selection in annotations
    const modelAnnotation = event.annotations.find(
      a => a.kind === 'model_selection'
    );

    if (modelAnnotation?.value?.modelId) {
      return modelAnnotation.value.modelId;
    }

    // Check user preferences
    if (event.identity?.user?.preferences?.preferredModel) {
      return event.identity.user.preferences.preferredModel;
    }

    // Default model
    return this.currentModel;
  }

  private async executeLlmWithTools(
    prompt: string,
    context: ToolExecutionContext
  ): Promise<string> {
    // LLM inference with tool calling
    // Context now includes modelId for RBAC validation
    // ...
  }
}
```

**Acceptance Criteria**:
- ✅ llm-bot passes LLM modelId (gpt-4, claude, etc.)
- ✅ Model selection logic functional
- ✅ All tool invocations include modelId
- ✅ Integration test: Send message, verify modelId propagates

**Validation Command**:
```bash
npm test -- llm-bot-service.test.ts -t "modelId"
npm run build
```

---

#### **T5: Update reflex to Pass modelId (2 days)**

**Goal**: Update reflex to pass agent model ID in ToolExecutionContext

**Files to Modify**:
- `src/apps/reflex-service.ts` - Add modelId='reflex' to ToolExecutionContext

**Implementation**:
```typescript
// src/apps/reflex-service.ts
export class ReflexServer extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.reaction.v1',
      async (event, attrs, ctx) => {
        // Execute deterministic rules
        const actions = await this.evaluateRules(event);

        for (const action of actions) {
          if (action.type === 'tool_execution') {
            // Create tool execution context with reflex model ID
            const toolContext: ToolExecutionContext = {
              userRoles: event.identity?.user?.roles || [],
              userId: event.identity?.user?.id,
              modelId: 'reflex', // 🆕 NEW: reflex is a registered model
              correlationId: event.correlationId,
              sessionId: event.sessionId
            };

            // Execute tool via tool-orchestrator
            await this.executeTool(action.toolId, action.args, toolContext);
          }
        }

        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

**Acceptance Criteria**:
- ✅ reflex passes modelId='reflex'
- ✅ reflex registered as deterministic model (Sprint 63)
- ✅ All tool invocations include modelId
- ✅ RBAC validation works for reflex model

**Validation Command**:
```bash
npm test -- reflex-service.test.ts -t "modelId"
npm run build
```

---

## Testing Strategy

### Unit Tests (20+ tests)

**ToolGateway Tests** (10 tests):
- Cache behavior (hit/miss)
- RBAC integration (allowed/denied)
- Error handling (tool not found, RBAC denied)
- Logging (success, error, denied)

**RbacValidator Tests** (10 tests):
- User role checks (required/denied)
- Model role checks (required/denied)
- Model tier checks (allowed/denied)
- Model policy checks (allowlist/denylist)
- Trust score checks (threshold validation)

**Test Command**:
```bash
npm test -- tool-gateway.test.ts rbac-validator.test.ts
```

### Integration Tests (agent-dev)

**Scenario 1: Premium Tool Access**
```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-sprint64-premium" })

# 2. Deploy tool-orchestrator
bit deploy tool-orchestrator --context agent-dev-sprint64-premium

# 3. Test premium model (gpt-4) accessing premium tool
message.send({
  context: 'agent-dev-sprint64-premium',
  text: 'Generate an image of a sunset',
  platform: 'api',
  userId: 'test-premium-user',
  waitForResponse: true
})
# Expected: Success (gpt-4 has premium tier)

# 4. Test basic model (gpt-3.5-turbo) accessing premium tool
message.send({
  context: 'agent-dev-sprint64-premium',
  text: 'Generate an image of a sunset',
  platform: 'api',
  userId: 'test-basic-user',
  waitForResponse: true
})
# Expected: Access denied (gpt-3.5-turbo lacks premium tier)

# 5. Clean up
agent_dev.destroy({ name: "agent-dev-sprint64-premium", confirm: true })
```

**Scenario 2: Model Tier Enforcement**
```bash
# Premium tools restricted to premium models
# Basic models cannot access expensive/admin tools
```

**Scenario 3: Trust Score Validation**
```bash
# Tools requiring high trust scores
# Basic models fail trust score thresholds
```

---

## Risk Assessment

### High Risk

**1. Breaking Change in ToolExecutionContext**
- **Impact**: All tool-invoking services break if not updated simultaneously
- **Mitigation**: Single atomic commit updating all consumers (llm-bot, reflex, tool-gateway)
- **Validation**: Deploy to agent-dev first, verify all services start

**2. RBAC Validation Complexity**
- **Impact**: 8-step validation logic (user roles, model roles, tier, policy, trust)
- **Mitigation**: Comprehensive unit tests (20+ scenarios), clear error messages
- **Validation**: Test each RBAC dimension independently

### Medium Risk

**3. Model Selection Logic**
- **Impact**: llm-bot must correctly select model from annotations/preferences
- **Mitigation**: Fallback to default model if selection fails
- **Validation**: Integration tests with different model selection methods

**4. LRU Cache Invalidation**
- **Impact**: Stale tool/model metadata if cache not invalidated
- **Mitigation**: 5min TTL, manual invalidation on config updates
- **Validation**: Test cache behavior with time-based expiration

### Low Risk

**5. Logging Overhead**
- **Impact**: Every tool invocation logged (potential performance impact)
- **Mitigation**: Async logging, fire-and-forget pattern
- **Validation**: Load test with 100+ tool invocations

---

## Completion Criteria

### Code Deliverables
- [ ] ToolExecutionContext has `modelId` (required), `agentName` removed
- [ ] ToolGateway implements IToolGateway interface
- [ ] RbacValidator validates dual-layer (User × Model)
- [ ] Model tier enforcement working
- [ ] Trust score validation working
- [ ] llm-bot passes LLM modelId
- [ ] reflex passes agent modelId ('reflex')
- [ ] 20+ RBAC test scenarios passing

### Testing
- [ ] 20+ unit tests passing
- [ ] Integration test: agent-dev validation
- [ ] Code coverage >80% for ToolGateway and RbacValidator

### Documentation
- [ ] Inline JSDoc for all public methods
- [ ] RBAC validation logic documented
- [ ] Model selection logic documented

### Validation
- [ ] Deployed to agent-dev
- [ ] No errors in logs
- [ ] Premium tools restricted to premium models
- [ ] Basic models cannot access expensive/admin tools

### Sprint Artifacts
- [ ] Sprint completion summary (sprint-64-completion.md)
- [ ] Backlog updated (all tasks marked completed)
- [ ] Bootstrap info for Sprint 65 documented

---

## Bootstrap for Sprint 65

**Entry Point**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:executeMcpTool()` (replace placeholder)

**Current State**:
- ToolGateway exists with RBAC enforcement
- All execution methods throw errors (placeholders from Sprint 64)
- tool-gateway.ts has working MCP/internal/composition execution (~500+ lines)
- Need to migrate execution logic to tool-orchestrator

**Goal**: Replace all execution placeholders with actual working implementations

**Key Files to Modify**:
1. `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (replace 3 placeholder methods)
2. `src/apps/tool-orchestrator-service/modules/gateway/mcp-client-manager.ts` (migrate from tool-gateway)
3. `src/apps/tool-orchestrator-service/modules/gateway/internal-tool-handler.ts` (new file)
4. `src/apps/tool-orchestrator-service/modules/gateway/composition-executor.ts` (migrate from tool-gateway)

---

**Last Updated**: 2026-11-16
**Status**: Ready for execution
