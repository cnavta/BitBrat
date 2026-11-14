# Sprint 61: Composition RBAC + Validation - Implementation Plan

**Sprint ID**: sprint-61-s03uws
**Duration**: 2-3 weeks (20 working days)
**Status**: Planning
**Owner**: christophernavta
**Prerequisites**: Sprint 60 (Tool Execution Migration) complete ✅

---

## Executive Summary

This sprint completes the tool-orchestrator migration by implementing composition RBAC validation and comprehensive end-to-end testing. It combines the original Sprint 60 (Composition RBAC) and Sprint 61 (Validation & Cutover) from the initial plan, as Sprint 60 execution migration unlocked both composition RBAC and validation testing simultaneously.

**Why This Sprint**: Sprint 60 delivered tool execution logic (MCP, internal, composition) but did NOT validate composition RBAC or perform comprehensive integration testing. This sprint fills that gap and prepares for production cutover.

**Key Deliverables**:
1. Composition RBAC Registration Validation - Validate model permissions at composition registration time
2. Composition RBAC Runtime Validation - Re-validate at execution time against invoking model
3. RBAC Inheritance Logic - Compositions inherit most restrictive RBAC from constituent tools
4. End-to-End Validation - 5 integration scenarios tested in agent-dev
5. Load Testing - 1000 invocations, P95 < 100ms
6. Migration Script - tool-gateway → tool-orchestrator migration automation
7. Production Readiness - Cutover preparation (NOT execution)

---

## Context & Background

### Gap Analysis from Sprint 60

Sprint 60 delivered:
- ✅ MCP tool execution (via McpClientManager)
- ✅ Internal tool execution (via InternalToolHandler)
- ✅ Composition execution (via CompositionExecutor)
- ✅ Event logging to Loki
- ✅ Error handling and retry logic
- ✅ 35+ tests passing

Sprint 60 did NOT deliver:
- ❌ Composition RBAC registration validation
- ❌ Composition RBAC inheritance logic
- ❌ End-to-end integration testing in agent-dev
- ❌ Load testing
- ❌ Migration script
- ❌ Production cutover preparation

**This sprint fills the gap.**

### Architecture Context

From `planning/sprint-55-h17jpp/technical-architecture.md`:

**tool-orchestrator** is a unified Bit with four internal modules:
1. **ToolRegistry Module** - Manages platform_tool_registry (PostgreSQL)
2. **ModelRegistry Module** - Manages model_registry (PostgreSQL)
3. **ToolObserver Module** - Queries Loki for metrics/traces
4. **ToolGateway Module** - Orchestrates execution (MCP/internal/composition)

**Model-Based RBAC** (Section 6):
- Dual-layer validation: User permissions ∩ Model permissions = Effective permissions
- Model is the decision-making entity (gpt-4, claude-sonnet), not the agent (llm-bot)
- Compositions inherit most restrictive RBAC from constituent tools

**Composition RBAC Requirements** (Section 8.2):
- Validate model permissions at registration time (prevent registration if model lacks tool access)
- Re-validate at runtime against invoking model (not registering model)
- Inherit RBAC from constituent tools (union of required roles, intersection of allowed tiers)

---

## Sprint Goals & Success Criteria

### Primary Goals

1. **Composition RBAC Complete** - Registration and runtime validation enforced
2. **All Integration Tests Pass** - 5 end-to-end scenarios validated in agent-dev
3. **Load Test Targets Met** - 1000 invocations, P95 < 100ms
4. **Migration Script Validated** - tool-gateway → tool-orchestrator migration tested
5. **Ready for Cutover** - Documentation, runbooks, feature flags prepared

### Success Metrics

**Implementation Success**:
- ✅ Composition registration fails if model lacks tool access
- ✅ Runtime re-validation against invoking model works
- ✅ RBAC inheritance correctly calculates most restrictive permissions
- ✅ All 5 integration scenarios pass in agent-dev
- ✅ Load test: 1000 invocations, P95 < 100ms, no memory leaks

**Operational Success**:
- ✅ Migration script runs successfully
- ✅ All tools migrated from tool-gateway
- ✅ Validation passes (tool count match)
- ✅ Rollback script tested
- ✅ Feature flag implemented
- ✅ Deployment plan documented

---

## Task Breakdown

### T1: Composition Registration RBAC (3 days)

**Goal**: Validate model permissions at composition registration time

**Current State** (Sprint 60):
- CompositionRegistry exists (src/common/composition/)
- Compositions registered via `composition.register` tool
- NO RBAC validation at registration time

**Implementation**:

**Step 1.1: Extract Tool IDs from Composition (0.5 days)**

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

private extractToolIds(steps: CompositionStep[]): string[] {
  const toolIds: Set<string> = new Set();

  for (const step of steps) {
    toolIds.add(step.toolId);

    // Handle nested compositions (recursive)
    if (step.type === 'composition') {
      const nestedIds = this.extractToolIds(step.nestedSteps || []);
      nestedIds.forEach(id => toolIds.add(id));
    }
  }

  return Array.from(toolIds);
}
```

**Step 1.2: Validate Model Access to All Constituent Tools (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

async registerComposition(
  definition: CompositionDefinition,
  registeringModelId: string,
  userRoles: string[]
): Promise<void> {
  // 1. Extract all tool IDs from composition steps
  const toolIds = this.extractToolIds(definition.spec.steps);

  this.logger.info('composition_registration_start', {
    compositionId: definition.id,
    registeringModelId,
    toolCount: toolIds.length,
    toolIds
  });

  // 2. Validate MODEL has access to ALL constituent tools
  for (const toolId of toolIds) {
    const access = await this.toolGateway.validateToolAccess(
      toolId,
      userRoles,
      registeringModelId
    );

    if (!access.allowed) {
      this.logger.warn('composition_registration_denied', {
        compositionId: definition.id,
        toolId,
        registeringModelId,
        reason: access.reason,
        details: access.details
      });

      throw new Error(
        `Model ${registeringModelId} lacks access to tool ${toolId}: ${access.reason}. ` +
        `Composition registration denied.`
      );
    }
  }

  // 3. Calculate RBAC inheritance (Section T3)
  const inheritedRbac = await this.calculateInheritedRbac(toolIds);

  // 4. Store composition with metadata
  await this.compositionRegistry.register({
    ...definition,
    metadata: {
      registeredBy: registeringModelId,
      rbacValidatedAt: new Date().toISOString(),
      constituentTools: toolIds,
      rbac: inheritedRbac
    }
  });

  this.logger.info('composition_registration_success', {
    compositionId: definition.id,
    registeringModelId,
    inheritedRbac
  });
}
```

**Step 1.3: Add Registration Tests (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/registry/__tests__/composition-registration.test.ts

describe('Composition Registration RBAC', () => {
  it('should allow registration when model has access to all tools', async () => {
    // Setup: gpt-4 has access to tool1, tool2
    // Composition uses tool1 + tool2
    const result = await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);
    expect(result).toBeTruthy();
  });

  it('should deny registration when model lacks access to one tool', async () => {
    // Setup: gpt-3.5-turbo lacks access to premium_tool
    // Composition uses basic_tool + premium_tool
    await expect(
      toolRegistry.registerComposition(composition, 'gpt-3.5-turbo', ['user'])
    ).rejects.toThrow('lacks access to tool premium_tool');
  });

  it('should validate nested compositions recursively', async () => {
    // Composition A uses tool1 + Composition B
    // Composition B uses tool2 + tool3
    // Validate gpt-4 has access to tool1, tool2, tool3
    const result = await toolRegistry.registerComposition(compositionA, 'gpt-4', ['user']);
    expect(result).toBeTruthy();
  });

  it('should log RBAC metadata in composition document', async () => {
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);
    const stored = await toolRegistry.getTool(composition.id);
    expect(stored.metadata.registeredBy).toBe('gpt-4');
    expect(stored.metadata.rbacValidatedAt).toBeDefined();
    expect(stored.metadata.constituentTools).toEqual(['tool1', 'tool2']);
  });

  it('should prevent re-registration with different model', async () => {
    // Register with gpt-4
    await toolRegistry.registerComposition(composition, 'gpt-4', ['user']);

    // Try to re-register with gpt-3.5-turbo (different model)
    await expect(
      toolRegistry.registerComposition(composition, 'gpt-3.5-turbo', ['user'])
    ).rejects.toThrow('already registered');
  });
});
```

**Step 1.4: Update CompositionRegistry Integration (0.5 days)**

Update `src/common/composition/registry.ts` to call new RBAC validation:

```typescript
// src/common/composition/registry.ts

async register(
  composition: CompositionDefinition,
  context: { modelId: string; userRoles: string[] }
): Promise<void> {
  // NEW: Validate RBAC via tool-orchestrator
  await this.toolOrchestrator.registerComposition(
    composition,
    context.modelId,
    context.userRoles
  );

  // Store composition (existing logic)
  await this.store.set('compositions', composition.id, composition);
}
```

**Acceptance Criteria**:
- ✅ Registration fails if model lacks tool access
- ✅ RBAC inherited from constituent tools
- ✅ Metadata stored (registeredBy, rbacValidatedAt, constituentTools)
- ✅ 5+ tests passing
- ✅ Nested compositions validated recursively

**Deliverables**:
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` (registerComposition method)
- `src/apps/tool-orchestrator-service/modules/registry/__tests__/composition-registration.test.ts` (5+ tests)
- `src/common/composition/registry.ts` (integration update)

---

### T2: Composition Runtime RBAC (2 days)

**Goal**: Re-validate composition RBAC at execution time against invoking model

**Context**: Sprint 60 implemented basic composition execution (src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts) but did NOT re-validate RBAC at runtime.

**Implementation**:

**Step 2.1: Update Composition Execution to Re-Validate (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts

private async executeComposition(
  tool: ToolRegistryDocument, // Composition is a "tool" in registry
  args: any,
  context: ToolExecutionContext
): Promise<ToolResult> {
  // 1. Load composition definition
  const composition = await this.compositionRegistry.get(tool.id);

  this.logger.info('composition_execution_start', {
    compositionId: tool.id,
    invokingModelId: context.modelId,
    registeredBy: composition.metadata.registeredBy,
    stepCount: composition.spec.steps.length
  });

  // 2. CRITICAL: Re-validate RBAC against INVOKING model (not registering model)
  // This prevents privilege escalation if user switches models after registration
  for (const step of composition.spec.steps) {
    const access = await this.validateToolAccess(
      step.toolId,
      context.userRoles,
      context.modelId // INVOKING model, not composition.metadata.registeredBy
    );

    if (!access.allowed) {
      this.logger.warn('composition_step_rbac_denied', {
        compositionId: tool.id,
        stepToolId: step.toolId,
        invokingModelId: context.modelId,
        registeredBy: composition.metadata.registeredBy,
        reason: access.reason,
        details: access.details
      });

      throw new Error(
        `RBAC denied for composition step ${step.name} (tool: ${step.toolId}): ${access.reason}. ` +
        `Invoking model: ${context.modelId}, Registered by: ${composition.metadata.registeredBy}`
      );
    }
  }

  // 3. Execute steps sequentially (existing Sprint 60 logic)
  let state = { input: args };
  for (const step of composition.spec.steps) {
    // Execute step (recursive call to execute())
    const stepResult = await this.execute(
      step.toolId,
      this.resolveStepArgs(step.args, state),
      context // Propagate context (modelId flows through)
    );

    // Update state
    state = { ...state, [step.name]: stepResult };
  }

  this.logger.info('composition_execution_success', {
    compositionId: tool.id,
    invokingModelId: context.modelId,
    stepCount: composition.spec.steps.length
  });

  return state;
}

private resolveStepArgs(argsTemplate: any, state: any): any {
  // JSONPath variable resolution (existing logic)
  // e.g., { prompt: "$.step1.result" } → { prompt: state.step1.result }
  return this.resolveVariables(argsTemplate, state);
}
```

**Step 2.2: Add Runtime Validation Tests (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/__tests__/composition-runtime-rbac.test.ts

describe('Composition Runtime RBAC', () => {
  it('should allow execution when invoking model has access to all tools', async () => {
    // Composition registered by gpt-4
    // Invoked by gpt-4 (same model)
    const result = await toolGateway.execute(compositionId, args, {
      modelId: 'gpt-4',
      userRoles: ['user']
    });
    expect(result.isError).toBe(false);
  });

  it('should deny execution when invoking model lacks access to one tool', async () => {
    // Composition registered by gpt-4 (has access to premium_tool)
    // Invoked by gpt-3.5-turbo (lacks access to premium_tool)
    await expect(
      toolGateway.execute(compositionId, args, {
        modelId: 'gpt-3.5-turbo',
        userRoles: ['user']
      })
    ).rejects.toThrow('RBAC denied for composition step');
  });

  it('should validate each step individually at runtime', async () => {
    // Composition: step1 (basic_tool) + step2 (premium_tool)
    // gpt-3.5-turbo can execute step1 but FAILS on step2
    await expect(
      toolGateway.execute(compositionId, args, {
        modelId: 'gpt-3.5-turbo',
        userRoles: ['user']
      })
    ).rejects.toThrow('tool: premium_tool');
  });

  it('should log RBAC denial with invoking and registering model info', async () => {
    // Verify logs contain both modelIds for debugging
    const logSpy = jest.spyOn(logger, 'warn');

    await expect(
      toolGateway.execute(compositionId, args, {
        modelId: 'gpt-3.5-turbo',
        userRoles: ['user']
      })
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(
      'composition_step_rbac_denied',
      expect.objectContaining({
        invokingModelId: 'gpt-3.5-turbo',
        registeredBy: 'gpt-4',
        reason: expect.any(String)
      })
    );
  });

  it('should allow execution after model upgrade', async () => {
    // User registers composition with gpt-3.5-turbo (only basic tools)
    // User upgrades to gpt-4 (premium tools available)
    // Composition should work with new model
    const result = await toolGateway.execute(compositionId, args, {
      modelId: 'gpt-4',
      userRoles: ['user', 'premium']
    });
    expect(result.isError).toBe(false);
  });
});
```

**Acceptance Criteria**:
- ✅ Runtime re-validation against invoking model (not registering model)
- ✅ Denies if invoking model lacks access to any step
- ✅ Logs contain both invokingModelId and registeredBy for debugging
- ✅ 5+ tests passing
- ✅ Prevents privilege escalation via model switching

**Deliverables**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (executeComposition update)
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/composition-runtime-rbac.test.ts` (5+ tests)

---

### T3: RBAC Inheritance Logic (2 days)

**Goal**: Compositions inherit most restrictive RBAC from constituent tools

**Background**: From `planning/sprint-55-h17jpp/technical-architecture.md` Section 6.3:

RBAC Inheritance Rules:
- **Union** of all required roles (need ALL)
- **Intersection** of allowed tiers (most restrictive)
- **Union** of model required roles
- **Highest** trust threshold across all tools

**Implementation**:

**Step 3.1: Implement RBAC Inheritance Algorithm (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

private async calculateInheritedRbac(
  toolIds: string[]
): Promise<ToolRbacConfig> {
  // Fetch all constituent tools
  const tools = await Promise.all(
    toolIds.map(id => this.getTool(id))
  );

  // Validate all tools found
  const missing = tools.filter(t => !t).map((_, i) => toolIds[i]);
  if (missing.length > 0) {
    throw new Error(`Constituent tools not found: ${missing.join(', ')}`);
  }

  this.logger.debug('rbac_inheritance_calculation', {
    toolCount: tools.length,
    toolIds
  });

  // RULE 1: Union of all user required roles (composition needs ALL)
  const userRequiredRoles = [
    ...new Set(tools.flatMap(t => t.rbac.userRoles.required))
  ];

  // RULE 2: Union of user denied roles (if ANY tool denies, composition denies)
  const userDeniedRoles = [
    ...new Set(tools.flatMap(t => t.rbac.userRoles.denied))
  ];

  // RULE 3: Union of model required roles
  const modelRequiredRoles = [
    ...new Set(tools.flatMap(t => t.rbac.modelRoles.required))
  ];

  // RULE 4: Union of model denied roles
  const modelDeniedRoles = [
    ...new Set(tools.flatMap(t => t.rbac.modelRoles.denied))
  ];

  // RULE 5: Intersection of allowed tiers (most restrictive)
  // If tool1 allows [basic, premium] and tool2 allows [premium, enterprise],
  // composition allows [premium] (intersection)
  const allowedTiers = this.intersectTiers(
    tools.map(t => t.rbac.modelTiers.allowed)
  );

  // RULE 6: Union of denied tiers (if ANY tool denies, composition denies)
  const deniedTiers = [
    ...new Set(tools.flatMap(t => t.rbac.modelTiers.denied))
  ];

  // RULE 7: Highest trust threshold across all tools (most restrictive)
  const minTrustThresholds = this.mergeMinTrustThresholds(tools);

  const inherited: ToolRbacConfig = {
    userRoles: {
      required: userRequiredRoles,
      denied: userDeniedRoles
    },
    modelRoles: {
      required: modelRequiredRoles,
      denied: modelDeniedRoles
    },
    modelTiers: {
      allowed: allowedTiers,
      denied: deniedTiers
    },
    minTrustThresholds
  };

  this.logger.info('rbac_inheritance_calculated', {
    toolCount: tools.length,
    inherited
  });

  return inherited;
}

private intersectTiers(tierLists: string[][]): string[] {
  // If ANY tool has empty allowedTiers (allows all), filter it out
  const nonEmptyLists = tierLists.filter(list => list.length > 0);

  if (nonEmptyLists.length === 0) {
    // All tools allow all tiers → composition allows all tiers
    return [];
  }

  // Intersection: tier must be in ALL lists
  const firstList = nonEmptyLists[0];
  return firstList.filter(tier =>
    nonEmptyLists.every(list => list.includes(tier))
  );
}

private mergeMinTrustThresholds(
  tools: ToolRegistryDocument[]
): ToolRbacConfig['minTrustThresholds'] | undefined {
  // Collect all trust thresholds from tools
  const allThresholds = tools
    .map(t => t.rbac.minTrustThresholds)
    .filter(th => th !== undefined);

  if (allThresholds.length === 0) {
    // No tools require trust thresholds → composition doesn't either
    return undefined;
  }

  // Group by scope
  const scopeMap = new Map<string, any[]>();
  for (const th of allThresholds) {
    const scope = th.scope || 'tool-use';
    if (!scopeMap.has(scope)) {
      scopeMap.set(scope, []);
    }
    scopeMap.get(scope)!.push(th);
  }

  // For each scope, take MAXIMUM threshold across all tools (most restrictive)
  const merged: any = {};

  for (const [scope, thresholds] of scopeMap) {
    merged.scope = scope; // Use first scope (or most common)

    // For each dimension, take MAX threshold
    const dimensions = ['reliability', 'fidelity', 'integrity', 'calibration'];
    for (const dim of dimensions) {
      const values = thresholds
        .map(th => th[dim])
        .filter(v => v !== undefined);

      if (values.length > 0) {
        merged[dim] = Math.max(...values); // Highest threshold (most restrictive)
      }
    }
  }

  return merged;
}
```

**Step 3.2: Add RBAC Inheritance Tests (1 day)**

```typescript
// src/apps/tool-orchestrator-service/modules/registry/__tests__/rbac-inheritance.test.ts

describe('RBAC Inheritance Logic', () => {
  it('should union user required roles', async () => {
    // tool1: requires ['user']
    // tool2: requires ['admin']
    // composition: requires ['user', 'admin']
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.userRoles.required).toEqual(['user', 'admin']);
  });

  it('should intersect allowed model tiers', async () => {
    // tool1: allows [basic, premium]
    // tool2: allows [premium, enterprise]
    // composition: allows [premium] (intersection)
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.modelTiers.allowed).toEqual(['premium']);
  });

  it('should handle empty allowed tiers (allow all)', async () => {
    // tool1: allows [] (all tiers)
    // tool2: allows [premium]
    // composition: allows [premium] (most restrictive)
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.modelTiers.allowed).toEqual(['premium']);
  });

  it('should take maximum trust threshold (most restrictive)', async () => {
    // tool1: minTrust.reliability = 80
    // tool2: minTrust.reliability = 90
    // composition: minTrust.reliability = 90
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.minTrustThresholds?.reliability).toBe(90);
  });

  it('should union denied roles', async () => {
    // tool1: denies ['banned']
    // tool2: denies ['restricted']
    // composition: denies ['banned', 'restricted']
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.userRoles.denied).toEqual(['banned', 'restricted']);
  });

  it('should handle tools with no RBAC restrictions', async () => {
    // tool1: no RBAC (allows all)
    // tool2: requires ['user']
    // composition: requires ['user']
    const rbac = await toolRegistry.calculateInheritedRbac(['tool1', 'tool2']);
    expect(rbac.userRoles.required).toEqual(['user']);
  });
});
```

**Acceptance Criteria**:
- ✅ Union of required roles (user and model)
- ✅ Intersection of allowed tiers
- ✅ Maximum trust thresholds (most restrictive)
- ✅ 6+ tests passing
- ✅ Handles edge cases (empty lists, undefined thresholds)

**Deliverables**:
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` (calculateInheritedRbac, intersectTiers, mergeMinTrustThresholds)
- `src/apps/tool-orchestrator-service/modules/registry/__tests__/rbac-inheritance.test.ts` (6+ tests)

---

### T4: End-to-End Validation (5 days)

**Goal**: Validate all critical flows in agent-dev environment

**Test Scenarios** (from REVISED-IMPLEMENTATION-PLAN.md):

**Scenario 1: Happy Path (1 day)**

Test: User message → llm-bot → tool execution → response

```bash
# Setup agent-dev context
agent_dev.provision({ name: "agent-dev-sprint-61-happy-path" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-happy-path
bit deploy llm-bot --context agent-dev-sprint-61-happy-path

# Send test message
message.send({
  context: 'agent-dev-sprint-61-happy-path',
  text: 'Get the current state',
  platform: 'api',
  userId: 'test-user',
  waitForResponse: true,
  timeoutMs: 15000
})

# Verify logs
fleet.logs({
  bit: 'tool-orchestrator',
  context: 'agent-dev-sprint-61-happy-path',
  limit: 20
})

# Verify Loki events
tool.get_metrics({
  toolId: 'get_state',
  context: 'agent-dev-sprint-61-happy-path'
})

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-happy-path", confirm: true })
```

**Acceptance Criteria**:
- ✅ Tool executes successfully
- ✅ Response received by user
- ✅ Loki contains tool.invocation event
- ✅ RBAC decision logged (allowed)

**Scenario 2: RBAC Denial (1 day)**

Test: Basic model tries premium tool → Denied

```bash
# Setup
agent_dev.provision({ name: "agent-dev-sprint-61-rbac-denial" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-rbac-denial
bit deploy llm-bot --context agent-dev-sprint-61-rbac-denial

# Configure llm-bot to use gpt-3.5-turbo (basic tier)
# Configure tool: generate_image with modelTiers.allowed = ['premium']

# Send test message
message.send({
  context: 'agent-dev-sprint-61-rbac-denial',
  text: 'Generate an image of a cat',
  platform: 'api',
  userId: 'test-user',
  waitForResponse: true
})

# Verify logs contain RBAC denial
fleet.logs({
  bit: 'tool-orchestrator',
  context: 'agent-dev-sprint-61-rbac-denial',
  level: ['warn'],
  limit: 10
})

# Expected log: "rbac_decision: denied, reason: model_tier_not_allowed"

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-rbac-denial", confirm: true })
```

**Acceptance Criteria**:
- ✅ Tool execution denied
- ✅ Clear error message to user
- ✅ Loki contains RBAC denial event
- ✅ Denial reason: model_tier_not_allowed

**Scenario 3: Tool Import (1 day)**

Test: New MCP server → Auto-import → Tools available

```bash
# Setup
agent_dev.provision({ name: "agent-dev-sprint-61-tool-import" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-tool-import

# Import tool from MCP server
tool.import({
  source: 'mcp-server',
  serverId: 'test-mcp-server',
  serverConfig: {
    transport: 'stdio',
    command: 'node',
    args: ['test-server.js']
  },
  context: 'agent-dev-sprint-61-tool-import'
})

# List tools
tool.list({
  context: 'agent-dev-sprint-61-tool-import'
})

# Verify new tool appears
# Expected: { id: 'test_tool', source: 'mcp', status: 'active' }

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-tool-import", confirm: true })
```

**Acceptance Criteria**:
- ✅ Tool imported successfully
- ✅ tool.list returns new tool
- ✅ Tool metadata correct (source, server, schema)

**Scenario 4: Composition RBAC (1 day)**

Test: Register composition → Validate constituent tools → Execute composition → Runtime re-validation

```bash
# Setup
agent_dev.provision({ name: "agent-dev-sprint-61-composition" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-composition

# Register composition with gpt-4 (premium tier)
composition.register({
  id: 'test_composition',
  steps: [
    { name: 'step1', toolId: 'basic_tool', args: {} },
    { name: 'step2', toolId: 'premium_tool', args: {} }
  ],
  context: 'agent-dev-sprint-61-composition',
  modelId: 'gpt-4',
  userRoles: ['user']
})

# Verify registration succeeded
tool.get({
  toolId: 'test_composition',
  context: 'agent-dev-sprint-61-composition'
})

# Expected: { metadata: { registeredBy: 'gpt-4', constituentTools: ['basic_tool', 'premium_tool'] }}

# Execute with gpt-4 (should succeed)
tool.execute({
  toolId: 'test_composition',
  args: {},
  context: {
    modelId: 'gpt-4',
    userRoles: ['user']
  }
})

# Execute with gpt-3.5-turbo (should fail - lacks access to premium_tool)
tool.execute({
  toolId: 'test_composition',
  args: {},
  context: {
    modelId: 'gpt-3.5-turbo',
    userRoles: ['user']
  }
})

# Verify logs show runtime RBAC denial
fleet.logs({
  bit: 'tool-orchestrator',
  context: 'agent-dev-sprint-61-composition',
  level: ['warn'],
  limit: 10
})

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-composition", confirm: true })
```

**Acceptance Criteria**:
- ✅ Composition registered successfully with gpt-4
- ✅ Execution with gpt-4 succeeds
- ✅ Execution with gpt-3.5-turbo fails (RBAC denial)
- ✅ Runtime re-validation logged

**Scenario 5: Model Upgrade (1 day)**

Test: User switches to premium model → More tools available

```bash
# Setup
agent_dev.provision({ name: "agent-dev-sprint-61-model-upgrade" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-model-upgrade
bit deploy llm-bot --context agent-dev-sprint-61-model-upgrade

# List tools with gpt-3.5-turbo (basic tier)
tool.list({
  context: {
    modelId: 'gpt-3.5-turbo',
    userRoles: ['user']
  }
})

# Expected: Only basic tier tools (no generate_image)

# List tools with gpt-4 (premium tier)
tool.list({
  context: {
    modelId: 'gpt-4',
    userRoles: ['user']
  }
})

# Expected: Basic + premium tier tools (includes generate_image)

# Verify tool counts differ
# basic tier: ~10 tools
# premium tier: ~25 tools

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-model-upgrade", confirm: true })
```

**Acceptance Criteria**:
- ✅ Basic model has fewer tools than premium
- ✅ tool.list filtered by model tier
- ✅ Premium tools (generate_image) not visible to basic model

**Deliverables**:
- `planning/sprint-61-s03uws/validation/scenario-1-happy-path.md` (test results)
- `planning/sprint-61-s03uws/validation/scenario-2-rbac-denial.md` (test results)
- `planning/sprint-61-s03uws/validation/scenario-3-tool-import.md` (test results)
- `planning/sprint-61-s03uws/validation/scenario-4-composition-rbac.md` (test results)
- `planning/sprint-61-s03uws/validation/scenario-5-model-upgrade.md` (test results)

---

### T5: Load Testing (3 days)

**Goal**: Validate performance targets (1000 invocations, P95 < 100ms)

**Load Profile** (from REVISED-IMPLEMENTATION-PLAN.md):
- 1000 tool invocations across 10 models
- 100 composition executions
- 50 concurrent requests

**Implementation**:

**Step 5.1: Create Load Test Script (1 day)**

```typescript
// scripts/load-test-tool-orchestrator.ts

import { ToolOrchestratorClient } from '../src/apps/tool-orchestrator-service/client';

interface LoadTestConfig {
  totalInvocations: number;
  concurrentRequests: number;
  models: string[];
  tools: string[];
}

interface LoadTestResults {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  rbacDenialCount: number;
  latencies: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  durationMs: number;
  throughput: number; // req/sec
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestResults> {
  const client = new ToolOrchestratorClient({ context: 'local' });

  const startTime = Date.now();
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  let rbacDenialCount = 0;

  // Create promise pool for concurrency control
  const promises: Promise<void>[] = [];

  for (let i = 0; i < config.totalInvocations; i++) {
    const model = config.models[i % config.models.length];
    const tool = config.tools[i % config.tools.length];

    const task = async () => {
      const invocationStart = Date.now();

      try {
        const result = await client.executeTool(tool, {}, {
          modelId: model,
          userRoles: ['user'],
          correlationId: `load-test-${i}`
        });

        const latency = Date.now() - invocationStart;
        latencies.push(latency);

        if (result.isError) {
          if (result.content[0].text.includes('RBAC')) {
            rbacDenialCount++;
          } else {
            errorCount++;
          }
        } else {
          successCount++;
        }
      } catch (err) {
        errorCount++;
        latencies.push(Date.now() - invocationStart);
      }
    };

    promises.push(task());

    // Limit concurrency
    if (promises.length >= config.concurrentRequests) {
      await Promise.race(promises);
      promises.splice(promises.findIndex(p => p), 1);
    }
  }

  // Wait for all remaining
  await Promise.all(promises);

  const durationMs = Date.now() - startTime;

  // Calculate percentiles
  const sorted = latencies.sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];

  return {
    totalInvocations: config.totalInvocations,
    successCount,
    errorCount,
    rbacDenialCount,
    latencies: { p50, p95, p99, max },
    durationMs,
    throughput: (config.totalInvocations / durationMs) * 1000
  };
}

async function main() {
  console.log('Starting load test...');

  const config: LoadTestConfig = {
    totalInvocations: 1000,
    concurrentRequests: 50,
    models: ['gpt-4', 'gpt-3.5-turbo', 'claude-sonnet-3.5', 'claude-opus-3.5'],
    tools: ['get_state', 'set_state', 'list_tools', 'get_model']
  };

  const results = await runLoadTest(config);

  console.log('Load Test Results:');
  console.log(`Total Invocations: ${results.totalInvocations}`);
  console.log(`Success: ${results.successCount}`);
  console.log(`Errors: ${results.errorCount}`);
  console.log(`RBAC Denials: ${results.rbacDenialCount}`);
  console.log(`Duration: ${results.durationMs}ms`);
  console.log(`Throughput: ${results.throughput.toFixed(2)} req/sec`);
  console.log(`Latencies:`);
  console.log(`  P50: ${results.latencies.p50}ms`);
  console.log(`  P95: ${results.latencies.p95}ms`);
  console.log(`  P99: ${results.latencies.p99}ms`);
  console.log(`  Max: ${results.latencies.max}ms`);

  // Validate targets
  const passed = results.latencies.p95 < 100;
  console.log(`\nTarget: P95 < 100ms: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  process.exit(passed ? 0 : 1);
}

main();
```

**Step 5.2: Run Load Test in Agent-Dev (1 day)**

```bash
# Setup agent-dev
agent_dev.provision({ name: "agent-dev-sprint-61-load-test" })
bit deploy tool-orchestrator --context agent-dev-sprint-61-load-test

# Seed PostgreSQL with test tools/models
npm run seed:tools -- --context agent-dev-sprint-61-load-test

# Run load test
npm run load-test:tool-orchestrator -- --context agent-dev-sprint-61-load-test

# Expected output:
# Total Invocations: 1000
# Success: 950
# Errors: 20
# RBAC Denials: 30
# Duration: 15000ms
# Throughput: 66.67 req/sec
# Latencies:
#   P50: 45ms
#   P95: 85ms  ✅ < 100ms target
#   P99: 120ms
#   Max: 250ms

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-61-load-test", confirm: true })
```

**Step 5.3: Analyze Results and Optimize (1 day)**

If P95 > 100ms:
- Check cache hit ratio (should be >90%)
- Profile PostgreSQL queries (add indexes if needed)
- Check Loki logging overhead (fire-and-forget)
- Review RBAC validation logic (should be <1ms)

**Acceptance Criteria**:
- ✅ 1000 invocations complete
- ✅ P95 < 100ms
- ✅ No memory leaks (check heap usage)
- ✅ Loki keeps up (no dropped events)
- ✅ Error rate < 5%

**Deliverables**:
- `scripts/load-test-tool-orchestrator.ts` (load test script)
- `planning/sprint-61-s03uws/validation/load-test-results.md` (results + analysis)

---

### T6: Migration Script (3 days)

**Goal**: Automate tool-gateway → tool-orchestrator migration

**Implementation**:

**Step 6.1: Export from tool-gateway (1 day)**

```typescript
// scripts/migrate-to-tool-orchestrator.ts

import fs from 'fs/promises';
import path from 'path';

async function exportFromToolGateway(context: string): Promise<void> {
  const toolGatewayClient = getMcpClient('tool-gateway', context);

  console.log('Exporting tools from tool-gateway...');

  // 1. Query tool-gateway for all tools
  const toolsResult = await toolGatewayClient.callTool('tool.list', {});
  const tools = JSON.parse(toolsResult.content[0].text);

  console.log(`Found ${tools.length} tools in tool-gateway`);

  // 2. Transform to ToolRegistryDocument format
  const documents = tools.map(transformToDocument);

  // 3. Export to JSON
  const exportPath = path.join(__dirname, '../migration/tools.json');
  await fs.writeFile(exportPath, JSON.stringify(documents, null, 2));

  console.log(`Exported ${documents.length} tools to ${exportPath}`);
}

function transformToDocument(legacyTool: any): ToolRegistryDocument {
  return {
    id: legacyTool.id,
    canonicalName: legacyTool.displayName || legacyTool.id,
    description: legacyTool.description || '',
    source: legacyTool.source,
    sourceMetadata: {
      serverName: legacyTool.originServer,
      transportType: legacyTool.transportType
    },
    inputSchema: legacyTool.inputSchema,
    outputSchema: legacyTool.outputSchema,
    rbac: {
      // IMPORTANT: Convert agent-based to model-based RBAC
      userRoles: {
        required: legacyTool.requiredRoles || [],
        denied: []
      },
      modelRoles: {
        required: [], // Default: no model restrictions
        denied: []
      },
      modelTiers: {
        allowed: [], // Default: all tiers
        denied: []
      }
    },
    config: {
      timeoutMs: legacyTool.timeoutMs || 60000,
      maxRetryAttempts: 3,
      retryBackoffMs: 1000,
      costTier: 'standard'
    },
    health: {
      status: 'healthy'
    },
    status: 'active',
    importedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    tags: legacyTool.tags || [],
    category: legacyTool.category,
    relatedTools: []
  };
}
```

**Step 6.2: Import to tool-orchestrator (1 day)**

```typescript
// scripts/migrate-to-tool-orchestrator.ts (continued)

async function importToToolOrchestrator(context: string): Promise<void> {
  const toolOrchestratorClient = getMcpClient('tool-orchestrator', context);

  console.log('Importing tools to tool-orchestrator...');

  // 1. Load JSON
  const exportPath = path.join(__dirname, '../migration/tools.json');
  const toolsJson = await fs.readFile(exportPath, 'utf-8');
  const tools = JSON.parse(toolsJson);

  console.log(`Loaded ${tools.length} tools from ${exportPath}`);

  // 2. Bulk insert to PostgreSQL
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const tool of tools) {
    try {
      await toolOrchestratorClient.callTool('tool.register', {
        tool,
        skipDuplicateCheck: false // Allow deduplication
      });
      imported++;
    } catch (err) {
      if (err.message.includes('already exists')) {
        skipped++;
      } else {
        console.error(`Error importing tool ${tool.id}:`, err.message);
        errors++;
      }
    }
  }

  console.log(`Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`);
}
```

**Step 6.3: Validation Script (0.5 days)**

```typescript
// scripts/migrate-to-tool-orchestrator.ts (continued)

async function validateMigration(context: string): Promise<void> {
  const toolGatewayClient = getMcpClient('tool-gateway', context);
  const toolOrchestratorClient = getMcpClient('tool-orchestrator', context);

  console.log('Validating migration...');

  // 1. Compare tool counts
  const oldToolsResult = await toolGatewayClient.callTool('tool.list', {});
  const oldTools = JSON.parse(oldToolsResult.content[0].text);

  const newToolsResult = await toolOrchestratorClient.callTool('tool.list', {});
  const newTools = JSON.parse(newToolsResult.content[0].text);

  console.log(`Old count: ${oldTools.length}, New count: ${newTools.length}`);

  if (oldTools.length !== newTools.length) {
    throw new Error(`Tool count mismatch: ${oldTools.length} vs ${newTools.length}`);
  }

  // 2. Compare tool IDs
  const oldIds = new Set(oldTools.map(t => t.id));
  const newIds = new Set(newTools.map(t => t.id));

  const missing = [...oldIds].filter(id => !newIds.has(id));
  const extra = [...newIds].filter(id => !oldIds.has(id));

  if (missing.length > 0) {
    console.error(`Missing tools in tool-orchestrator: ${missing.join(', ')}`);
    throw new Error('Migration incomplete');
  }

  if (extra.length > 0) {
    console.warn(`Extra tools in tool-orchestrator: ${extra.join(', ')}`);
  }

  console.log('✅ Migration validated successfully');
}
```

**Step 6.4: Rollback Script (0.5 days)**

```bash
#!/bin/bash
# scripts/rollback-tool-orchestrator.sh

set -e

echo "Rolling back to tool-gateway..."

# 1. Revert architecture.yaml
git checkout HEAD~1 -- architecture.yaml

# 2. Restart tool-gateway
npm run brat -- bit deploy tool-gateway --context local

# 3. Verify health
npm run brat -- fleet health tool-gateway

# 4. Disable tool-orchestrator
npm run brat -- bit stop tool-orchestrator --context local

echo "✅ Rollback complete - tool-gateway is now active"
```

**Acceptance Criteria**:
- ✅ Migration script runs successfully
- ✅ All tools migrated (count match)
- ✅ Validation passes
- ✅ Rollback script tested

**Deliverables**:
- `scripts/migrate-to-tool-orchestrator.ts` (migration script)
- `scripts/rollback-tool-orchestrator.sh` (rollback script)
- `planning/sprint-61-s03uws/migration-guide.md` (step-by-step guide)

---

### T7: Cutover Preparation (2 days)

**Goal**: Prepare for production cutover (NOT execute)

**Implementation**:

**Step 7.1: Feature Flag Implementation (0.5 days)**

```typescript
// src/apps/llm-bot-service/index.ts

async setup(): Promise<void> {
  // Feature flag: ENABLE_TOOL_ORCHESTRATOR (env var)
  const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';

  if (useToolOrchestrator) {
    this.logger.info('Using tool-orchestrator for tool execution');
    this.toolProvider = this.mcpClientManager.getClient('tool-orchestrator');
  } else {
    this.logger.info('Using tool-gateway for tool execution (legacy)');
    this.toolProvider = this.mcpClientManager.getClient('tool-gateway');
  }
}

async executeTool(toolId: string, args: unknown): Promise<ToolResult> {
  // Same interface, different backend
  return await this.toolProvider.callTool('tool.execute', {
    toolId,
    args,
    context: {
      userRoles: this.userRoles,
      modelId: this.selectedModel,
      correlationId: this.correlationId
    }
  });
}
```

**Step 7.2: Deployment Plan Documentation (0.5 days)**

Create `planning/sprint-61-s03uws/deployment-plan.md`:

```markdown
# Tool-Orchestrator Cutover Deployment Plan

## Pre-Cutover Checklist

- [ ] Sprint 61 complete (all tests passing)
- [ ] Migration script validated
- [ ] Rollback script tested
- [ ] Feature flag implemented in llm-bot
- [ ] Feature flag implemented in reflex
- [ ] Stakeholders notified
- [ ] On-call engineer assigned

## Cutover Steps

### Day 1: Staging Deployment

1. Deploy tool-orchestrator to staging
2. Run migration script (tool-gateway → tool-orchestrator)
3. Enable feature flag: `ENABLE_TOOL_ORCHESTRATOR=true`
4. Monitor for 4 hours
5. Validate: tool.list, model.list, test message flow
6. Check Loki for errors

### Day 2: Production Deployment (Phased)

**Phase 1: 10% traffic (09:00-13:00)**
1. Deploy tool-orchestrator to production
2. Enable feature flag for 10% of traffic (load balancer config)
3. Monitor error rates, RBAC denials
4. Check Loki dashboards

**Phase 2: 50% traffic (13:00-17:00)**
1. Increase to 50% if Phase 1 stable
2. Monitor for 4 hours
3. Check RBAC denial rates (< 1% expected)

**Phase 3: 100% traffic (17:00-21:00)**
1. Increase to 100% if Phase 2 stable
2. Monitor for 4 hours
3. Verify all critical flows

### Day 3: Final Validation

1. Monitor for 24 hours at 100%
2. Validate all critical flows
3. Check RBAC denial rates
4. Verify Loki dashboards
5. Collect user feedback

## Rollback Triggers

**IMMEDIATE ROLLBACK** if:
- Error rate > 5%
- RBAC denial rate > 10%
- P95 latency > 200ms
- User complaints > 10

**Rollback Procedure**:
```bash
./scripts/rollback-tool-orchestrator.sh
```

## Monitoring

**Grafana Dashboards**:
- Tool Invocation Rate
- Error Rate & Latency
- RBAC Denials
- Cost Tracking

**Loki Queries**:
- `{service="tool-orchestrator", status="error"}` - Errors
- `{service="tool-orchestrator", status="denied"}` - RBAC denials
- `{service="tool-orchestrator", eventType="tool.invocation"}` - All invocations

## Success Criteria

- ✅ tool-orchestrator handling 100% traffic
- ✅ Error rate < 1%
- ✅ RBAC denial rate < 5%
- ✅ P95 latency < 100ms
- ✅ Zero user-facing incidents
```

**Step 7.3: Runbook Creation (0.5 days)**

Create `planning/sprint-61-s03uws/runbook.md`:

```markdown
# Tool-Orchestrator Operational Runbook

## Common Operations

### Check Tool-Orchestrator Health

```bash
npm run brat -- fleet health tool-orchestrator
```

### List All Tools

```bash
tool.list({ context: 'production' })
```

### Get Tool Metrics

```bash
tool.get_metrics({ toolId: 'generate_image', timeRange: '1h' })
```

### Trace Request by Correlation ID

```bash
tool.trace_request({ correlationId: 'abc123' })
```

## Troubleshooting

### RBAC Denials

**Symptom**: User reports "Access denied" error

**Diagnosis**:
```bash
# Query Loki for recent RBAC denials
{service="tool-orchestrator", status="denied"}

# Explain access decision
tool.explain_access({
  toolId: 'generate_image',
  userId: 'user123',
  modelId: 'gpt-3.5-turbo'
})
```

**Resolution**:
- Check if user has required roles
- Check if model has required tier
- Update tool RBAC config if needed

### Performance Issues

**Symptom**: Slow tool execution

**Diagnosis**:
```bash
# Check cache hit ratio
tool.get_metrics({ toolId: 'all', metric: 'cache_hit_ratio' })

# Check PostgreSQL slow queries
psql -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
```

**Resolution**:
- Add indexes to platform_tool_registry
- Increase cache TTL (default: 5min)
- Scale tool-orchestrator (horizontal scaling)

### Tool Import Failures

**Symptom**: New MCP server not appearing in tool list

**Diagnosis**:
```bash
# Check tool-orchestrator logs
fleet.logs({ bit: 'tool-orchestrator', level: ['error'], limit: 50 })
```

**Resolution**:
- Verify MCP server is running
- Check connection config (transport, URL)
- Re-import: `tool.import({ serverId: '...' })`
```

**Step 7.4: Stakeholder Communication (0.5 days)**

Create `planning/sprint-61-s03uws/stakeholder-communication.md`:

```markdown
# Tool-Orchestrator Cutover - Stakeholder Communication

## Timeline

- **Sprint 61 Complete**: 2026-12-06 (estimated)
- **Staging Deployment**: 2026-12-09
- **Production Cutover**: 2026-12-10 (phased)
- **Final Validation**: 2026-12-11

## User Impact Assessment

**Expected Impact**: ZERO user-facing changes

**Why**: tool-orchestrator is a backend migration. Tool execution interface remains identical.

**Monitoring**: Real-time error tracking, RBAC denial alerts

## Support Team Briefing

**What Changed**:
- Tool execution moved from tool-gateway to tool-orchestrator
- Model-based RBAC enforced (was agent-based)
- Compositions now validate RBAC at registration + runtime

**What Stayed the Same**:
- Tool execution interface (MCP)
- Tool IDs and schemas
- User-facing error messages

**Troubleshooting Changes**:
- Use `tool.explain_access()` for RBAC debugging
- Loki queries for metrics (not in-memory stats)
- Feature flag for instant rollback
```

**Acceptance Criteria**:
- ✅ Feature flag implemented
- ✅ Deployment plan documented
- ✅ Runbook created
- ✅ Stakeholders informed

**Deliverables**:
- `src/apps/llm-bot-service/index.ts` (feature flag)
- `planning/sprint-61-s03uws/deployment-plan.md`
- `planning/sprint-61-s03uws/runbook.md`
- `planning/sprint-61-s03uws/stakeholder-communication.md`

---

## Sprint Summary

**Total Duration**: 2-3 weeks (20 working days)

**Task Breakdown**:
1. T1: Composition Registration RBAC (3 days)
2. T2: Composition Runtime RBAC (2 days)
3. T3: RBAC Inheritance Logic (2 days)
4. T4: End-to-End Validation (5 days)
5. T5: Load Testing (3 days)
6. T6: Migration Script (3 days)
7. T7: Cutover Preparation (2 days)

**Total**: 20 days (4 weeks with parallel execution)

**Critical Path**: T1 → T2 → T4 → T7 (Registration RBAC enables runtime validation, which enables E2E testing, which validates cutover readiness)

**Acceptance Criteria**:
- ✅ Composition RBAC complete (registration + runtime)
- ✅ All integration tests pass (5 scenarios)
- ✅ Load test targets met (P95 < 100ms)
- ✅ Migration script validated
- ✅ Ready for cutover (Sprint 62)

---

## Dependencies

**External Dependencies**:
- PostgreSQL (platform_tool_registry, model_registry)
- Loki (observability queries)
- agent-dev contexts (validation environments)

**Code Dependencies**:
- Sprint 60 complete (tool execution logic migrated)
- tool-orchestrator deployed and operational
- ToolRegistry, ModelRegistry, ToolGateway modules functional

**Documentation Dependencies**:
- `planning/sprint-55-h17jpp/technical-architecture.md` (tool-orchestrator design)
- `planning/REVISED-IMPLEMENTATION-PLAN.md` (overall migration plan)

---

## Risks & Mitigations

### High Risk

**1. Load Test Failures (P95 > 100ms)**
- **Mitigation**: Profile early, optimize PostgreSQL queries, add indexes
- **Fallback**: Accept higher latency (200ms) temporarily, optimize in Sprint 62

**2. Migration Data Loss**
- **Mitigation**: Dry-run migration in staging first, validate tool counts
- **Fallback**: Rollback script tested, can revert to tool-gateway instantly

### Medium Risk

**3. Agent-Dev Environment Issues**
- **Mitigation**: Pre-provision agent-dev contexts, test infrastructure before validation
- **Fallback**: Use local Docker Compose for E2E testing if agent-dev unavailable

**4. RBAC Denial Rate Too High**
- **Mitigation**: Monitor denial reasons, adjust RBAC config if needed
- **Fallback**: Loosen RBAC temporarily, iterate in Sprint 62

---

## Success Metrics

**Implementation Success**:
- ✅ All 35+ tests passing (T1-T3: 16+ new tests)
- ✅ All 5 integration scenarios pass in agent-dev (T4)
- ✅ Load test: 1000 invocations, P95 < 100ms (T5)
- ✅ Migration script validated (T6)

**Operational Success**:
- ✅ Feature flag implemented
- ✅ Deployment plan documented
- ✅ Runbook created
- ✅ Stakeholders informed
- ✅ Ready for Sprint 62 cutover

---

## Next Sprint (Sprint 62)

**Sprint 62: Cutover + Documentation + Cleanup**

**Duration**: 1-2 weeks

**Goals**:
1. Production cutover (phased rollout)
2. tool-gateway deprecation
3. Comprehensive documentation
4. Code cleanup
5. Final monitoring (7 days stable)

**Prerequisites**: Sprint 61 complete ✅
