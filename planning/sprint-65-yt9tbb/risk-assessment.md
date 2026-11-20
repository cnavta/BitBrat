# Sprint 65: Migration Risk Assessment
# Tool-Gateway → Tool-Orchestrator

**Created**: 2026-11-15
**Author**: Implementation Team
**Sprint**: sprint-65-yt9tbb
**Status**: Draft v1

---

## Risk Assessment Matrix

| Risk ID | Risk | Likelihood | Impact | Severity | Mitigation |
|---------|------|------------|--------|----------|------------|
| R1 | MCP tool execution failure | **High** | **Critical** | **P0** | Initialize McpClientManager before migration |
| R2 | Composition subsystem unavailable | **High** | **Critical** | **P0** | Port composition subsystem completely |
| R3 | RBAC privilege escalation | Medium | **Critical** | **P0** | Implement per-step composition RBAC |
| R4 | Performance regression | Medium | High | P1 | Comprehensive benchmarking + load testing |
| R5 | Consumer migration failures | Low | High | P1 | Feature flag for rollback, staged migration |
| R6 | Progress message delivery broken | Medium | Medium | P1 | Enhance agent.sendProgressUpdate |
| R7 | Incomplete gap analysis | Low | High | P1 | Stakeholder review + validation |
| R8 | Integration test coverage gaps | Medium | Medium | P2 | 40+ integration tests (Sprint 65 target) |

---

## Risk Details

### R1: MCP Tool Execution Failure (P0 - CRITICAL)

**Description**: Tool-orchestrator cannot execute MCP tools from upstream services (image-gen-mcp, story-engine-mcp, etc.) because McpClientManager is not initialized.

**Root Cause**:
```typescript
// src/apps/tool-orchestrator-service.ts:70
this.toolGateway = new ToolGateway(
  this.toolRegistry,
  this.modelRegistry,
  { /* config */ },
  undefined,  // ← PROBLEM: McpClientManager not passed
  this.getLogger() as any
);
```

**Impact**:
- **Immediate failure** when any MCP tool is called (image generation, story engine, etc.)
- Error: `MCP client manager not configured`
- **Blocks all MCP-based functionality**

**Likelihood**: **High** (100% if McpClientManager not initialized)

**Severity**: **Critical** (P0 - Blocking)

**Affected Stakeholders**:
- End users (cannot generate images, stories, etc.)
- LLMs (tool calls fail)
- Dependent services (reflex, llm-bot)

**Mitigation Strategy**:

**Task 1.2 (1 day)**:
```typescript
// src/apps/tool-orchestrator-service.ts
public async setup(): Promise<void> {
  // ... existing setup ...

  // ✅ FIX: Initialize MCP Client Manager
  const mcpClientManager = new McpClientManager(this as any, this.toolRegistry);

  // Connect to external MCP servers (image-gen-mcp, story-engine-mcp)
  // Note: McpClientManager auto-discovers servers from architecture.yaml
  // or via dynamic registration on INTERNAL_MCP_REGISTRATION_V1

  this.toolGateway = new ToolGateway(
    this.toolRegistry,
    this.modelRegistry,
    { /* config */ },
    mcpClientManager,  // ✅ FIXED
    this.getLogger() as any
  );

  this.getLogger().info('tool_orchestrator.mcp_client_manager_initialized', {
    service: 'tool-orchestrator',
  });
}
```

**Validation**:
1. Deploy tool-orchestrator to agent-dev context
2. Call MCP tool (e.g., image_gen.generate)
3. Verify tool executes successfully
4. Check logs for `tool_gateway.execute_mcp.success`

**Rollback Plan**:
- If McpClientManager initialization fails, tool-orchestrator startup fails
- Service will not start, forcing rollback to tool-gateway
- Risk: Service downtime during rollback

**Success Criteria**:
- [ ] McpClientManager initialized on startup
- [ ] MCP tools callable via tool-orchestrator
- [ ] Connection health checks passing
- [ ] Integration test: MCP tool execution end-to-end

---

### R2: Composition Subsystem Unavailable (P0 - CRITICAL)

**Description**: Tool-orchestrator does not initialize CompositionRegistry, CompositionExecutor, or load compositions on startup, making all composition functionality unavailable.

**Root Cause**:
- No composition subsystem initialization in tool-orchestrator-service.ts
- Compositions stored in PostgreSQL but never loaded
- LLMs cannot register, list, execute, or manage compositions

**Impact**:
- **LLMs lose ability to create/manage compositions** via MCP tools
- Existing compositions not available for execution
- Workflow automation breaks (reflex, complex agent flows)
- **6 composition admin tools missing**: composition.register, composition.list, composition.get, composition.delete, composition.stats, composition.list_tools

**Likelihood**: **High** (100% if not addressed)

**Severity**: **Critical** (P0 - Blocking for composition workflows)

**Affected Stakeholders**:
- LLMs (cannot manage compositions)
- Power users (workflow automation broken)
- Development team (composition iteration slowed)

**Mitigation Strategy**:

**Task 1.3 (2 days)**:

**Step 1**: Initialize composition subsystem
```typescript
// src/apps/tool-orchestrator-service.ts
async setup(): Promise<void> {
  // ... existing setup ...

  // Initialize CompositionRegistry
  const connectionString = process.env.DATABASE_URL;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });

  const compositionStore = new PostgresCompositionStore(pool);

  // Create adapter for ToolRegistry
  const toolRegistryAdapter = {
    getTool: (toolId: string) => {
      const tool = this.toolRegistry.getTool(toolId);
      if (!tool) return null;
      return {
        id: tool.id,
        inputSchema: tool.inputSchema,
        source: tool.source,
        execute: tool.execute,
      };
    },
  };

  this.compositionRegistry = new CompositionRegistry(
    compositionStore,
    toolRegistryAdapter,
    this.getLogger()
  );

  this.compositionExecutor = new CompositionExecutor(
    toolRegistryAdapter,
    this.getLogger()
  );

  this.getLogger().info('tool_orchestrator.composition_subsystem_initialized');
}
```

**Step 2**: Port 6 composition admin tools
1. composition.register - Register new composition
2. composition.list - List all compositions
3. composition.get - Get composition by name/version
4. composition.delete - Delete composition
5. composition.stats - Get composition statistics
6. composition.list_tools - List tools for authoring

**Step 3**: Load compositions on startup
```typescript
async start(port: number) {
  // Load compositions from PostgreSQL
  await this.loadCompositions();

  await super.start(port);
}

private async loadCompositions(): Promise<void> {
  if (!this.compositionRegistry) return;

  const compositions = await this.compositionRegistry.list();
  this.getLogger().info('tool_orchestrator.compositions.loaded', {
    count: compositions.length,
  });

  // Register each composition as an MCP tool
  for (const record of compositions) {
    await this.registerCompositionTool(record.compiled);
  }
}
```

**Validation**:
1. Deploy tool-orchestrator to agent-dev
2. Call composition.list → verify existing compositions returned
3. Call composition.register → create new composition
4. Execute composition tool → verify execution succeeds
5. Check logs for `tool_orchestrator.compositions.loaded`

**Rollback Plan**:
- If composition initialization fails, tool-orchestrator continues without compositions
- Fail-open design: Composition errors logged as warnings, not startup failures
- Risk: Compositions unavailable until issue fixed

**Success Criteria**:
- [ ] CompositionRegistry initialized successfully
- [ ] All 6 composition admin tools registered
- [ ] Compositions loaded on startup
- [ ] Composition execution working end-to-end
- [ ] Integration test: Create, list, execute, delete composition

---

### R3: RBAC Privilege Escalation (P0 - CRITICAL SECURITY)

**Description**: Tool-orchestrator does not validate RBAC for each step in a composition, allowing privilege escalation where a low-trust model could execute high-privilege tools via composition.

**Root Cause**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:867
private async executeComposition(tool, args, context) {
  const constituentToolIds = composition.toolIds || [];

  // ⚠️ MISSING: No per-step RBAC validation
  // A composition registered by a high-privilege model could include
  // restricted tools, then be executed by a low-privilege model

  // Execute composition strategies directly...
  switch (composition.strategy) {
    case 'sequential': return await this.executeSequential(...);
    case 'parallel': return await this.executeParallel(...);
  }
}
```

**Attack Scenario**:
1. Privileged model (gpt-4, tier=enterprise) registers composition "admin-workflow"
2. Composition includes restricted tool "user.delete" (requires role=admin)
3. Low-privilege model (gpt-3.5-turbo, tier=free) executes "admin-workflow"
4. Tool-orchestrator executes composition WITHOUT validating each step
5. **Result**: Low-privilege model deletes users (privilege escalation)

**Impact**:
- **Security vulnerability**: Low-trust models can execute high-privilege tools
- **RBAC bypass**: Composition becomes privilege escalation vector
- **Compliance risk**: Violates least-privilege principle

**Likelihood**: Medium (requires malicious or buggy composition)

**Severity**: **Critical** (P0 - Security vulnerability)

**Affected Stakeholders**:
- Security team (compliance risk)
- End users (unauthorized actions possible)
- Platform integrity (trust boundaries violated)

**Mitigation Strategy**:

**Task 1.4 (2 days)**:

**Step 1**: Add pre-execution RBAC validation
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
private async executeComposition(tool, args, context) {
  const constituentToolIds = composition.toolIds || [];

  // ✅ FIX: Validate RBAC for EVERY constituent tool BEFORE execution
  this.logger?.debug('tool_gateway.execute_composition.rbac_validation_start', {
    toolId: tool.id,
    constituentToolIds,
    modelId: context.modelId,
    correlationId: context.correlationId,
  });

  for (const constituentToolId of constituentToolIds) {
    // Get tool and model from cache
    const stepTool = await this.getToolCached(constituentToolId);
    if (!stepTool) {
      throw new Error(`Composition constituent tool not found: ${constituentToolId}`);
    }

    const stepModel = await this.getModelCached(context.modelId);
    if (!stepModel) {
      throw new Error(`Model not found: ${context.modelId}`);
    }

    // Validate RBAC for this step (against INVOKING model, not REGISTERING model)
    const rbacResult = this.rbacValidator.validateToolAccess(
      stepTool,
      context.userRoles,
      stepModel
    );

    if (!rbacResult.allowed) {
      this.logger?.warn('tool_gateway.execute_composition.rbac_denied', {
        toolId: tool.id,
        constituentToolId,
        modelId: context.modelId,
        reason: rbacResult.reason,
        details: rbacResult.details,
        correlationId: context.correlationId,
      });

      // Log RBAC denial for audit trail
      this.logEvent('tool_gateway.composition_rbac_denied', {
        compositionId: tool.id,
        constituentToolId,
        userId: context.userId,
        modelId: context.modelId,
        reason: rbacResult.reason,
        details: rbacResult.details,
      }, true);

      // Fail-fast: Reject composition execution immediately
      throw new Error(
        `Composition denied: constituent tool "${constituentToolId}" not allowed for model ${context.modelId}. Reason: ${rbacResult.reason}`
      );
    }
  }

  this.logger?.debug('tool_gateway.execute_composition.rbac_validation_passed', {
    toolId: tool.id,
    constituentToolsValidated: constituentToolIds.length,
    correlationId: context.correlationId,
  });

  // Execute composition (now RBAC-validated)...
}
```

**Step 2**: Add integration tests for privilege escalation scenarios
```typescript
// src/apps/__tests__/tool-orchestrator-composition-rbac.test.ts
it('should deny composition execution if any step violates RBAC', async () => {
  // 1. Create composition with restricted tool
  const composition = await registry.register({
    metadata: { name: 'admin-workflow' },
    spec: {
      steps: [
        { call: 'user.list' },     // Allowed for all models
        { call: 'user.delete' },   // Requires role=admin
      ],
    },
  });

  // 2. Attempt execution as low-privilege model (no admin role)
  const context = {
    modelId: 'gpt-3.5-turbo',  // tier=basic, no admin role
    userRoles: ['user'],       // No admin role
    userId: 'test-user',
  };

  // 3. Expect RBAC denial
  await expect(
    toolGateway.execute('admin-workflow', {}, context)
  ).rejects.toThrow('Composition denied: constituent tool "user.delete" not allowed');
});

it('should allow composition execution if all steps pass RBAC', async () => {
  // 1. Create composition with unrestricted tools
  const composition = await registry.register({
    metadata: { name: 'safe-workflow' },
    spec: {
      steps: [
        { call: 'user.list' },
        { call: 'user.get' },
      ],
    },
  });

  // 2. Execute as low-privilege model
  const context = {
    modelId: 'gpt-3.5-turbo',
    userRoles: ['user'],
    userId: 'test-user',
  };

  // 3. Expect success
  const result = await toolGateway.execute('safe-workflow', {}, context);
  expect(result.isError).toBe(false);
});
```

**Validation**:
1. Deploy tool-orchestrator with RBAC fix
2. Create composition with restricted tool
3. Attempt execution as low-privilege model
4. Verify RBAC denial with clear error message
5. Check audit logs for `tool_gateway.composition_rbac_denied`

**Rollback Plan**:
- If RBAC validation causes false positives, temporarily disable with feature flag
- Risk: Privilege escalation vulnerability remains open
- Mitigation: Thoroughly test RBAC logic before deployment

**Success Criteria**:
- [ ] Per-step RBAC validation implemented
- [ ] RBAC failures caught BEFORE execution starts
- [ ] All 5 RBAC dimensions validated (user roles, model roles, tier, trust, policy)
- [ ] Integration tests passing for privilege escalation scenarios
- [ ] Audit logs capture RBAC denials with full context

---

### R4: Performance Regression (P1 - HIGH)

**Description**: Tool-orchestrator may have higher latency or lower throughput than tool-gateway due to PostgreSQL lookups, additional RBAC checks, or retry logic overhead.

**Root Cause**:
- PostgreSQL queries for tool/model lookup (vs in-memory in tool-gateway)
- LRU cache mitigates but adds complexity
- Retry logic adds latency on transient errors
- Structured logging has overhead

**Impact**:
- Slower tool execution (target: <20% regression)
- Reduced throughput under load
- Poor user experience for time-sensitive operations

**Likelihood**: Medium (depends on cache hit rate and DB performance)

**Severity**: High (P1 - Affects UX)

**Affected Stakeholders**:
- End users (slower responses)
- LLMs (longer tool execution times)
- Platform scalability (lower capacity)

**Mitigation Strategy**:

**Task 4.1 (2 days)**: Performance Benchmarking

**Benchmark Scenarios**:
1. **Internal Tool** (1000 invocations): Measure baseline latency
2. **MCP Tool** (500 invocations): Measure MCP overhead + network latency
3. **Composition** (200 invocations): Measure composition orchestration overhead
4. **Cache Hit Rate**: Measure ToolRegistry/ModelRegistry cache effectiveness

**Metrics**:
- P50, P95, P99 latencies
- Cache hit rate (target: >80%)
- Throughput (requests/sec)
- Memory usage
- DB connection pool utilization

**Acceptance Criteria**:
- P95 latency within 20% of tool-gateway baseline
- Cache hit rate >80% for tool/model lookups
- No memory leaks during sustained load

**Optimization Strategies**:
1. **Increase cache TTL** (from 5min to 10min) if cache hit rate <80%
2. **Increase cache size** (from 1000 to 5000 entries) for large deployments
3. **Optimize PostgreSQL queries** (add indexes, query plan analysis)
4. **Batch tool/model lookups** (fetch multiple tools in single query)
5. **Connection pooling** (tune pool size based on load)

**Task 4.2 (2 days)**: Load Testing

**Load Profile**:
- 1000 concurrent tool invocations over 10 minutes
- Mix: 70% internal, 20% MCP, 10% composition
- Ramp-up: 100 req/sec → 1000 req/sec over 2 minutes

**Metrics**:
- Error rate (target: <0.1%)
- P95 latency (target: <200ms)
- Resource utilization (CPU, memory, DB connections)
- Graceful degradation behavior

**Rollback Plan**:
- If performance >20% worse, feature flag to tool-gateway
- Investigate bottlenecks via profiling
- Optimize and re-test before migration

**Success Criteria**:
- [ ] P95 latency within 20% of tool-gateway
- [ ] <0.1% error rate under load
- [ ] No connection pool exhaustion
- [ ] Graceful degradation if load exceeds capacity

---

### R5: Consumer Migration Failures (P1 - HIGH)

**Description**: llm-bot and reflex migration to tool-orchestrator may fail due to behavioral differences, breaking tool calling workflows.

**Root Cause**:
- llm-bot and reflex have tight coupling to tool-gateway behavior
- Differences in tool execution flow, error handling, or response format
- Feature flag logic may have bugs

**Impact**:
- LLM tool calling broken (image generation, state management, etc.)
- Reflex deterministic workflows broken
- Production incidents during cutover

**Likelihood**: Low (with proper testing and feature flag)

**Severity**: High (P1 - Affects production)

**Affected Stakeholders**:
- End users (broken tool functionality)
- LLMs (tool calls fail)
- On-call engineers (incident response)

**Mitigation Strategy**:

**Task 3.1 (3 days)**: llm-bot Migration

**Step 1**: Add feature flag
```typescript
// src/apps/llm-bot-service.ts
async setup(): Promise<void> {
  const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';

  if (useToolOrchestrator) {
    this.logger.info('llm_bot.using_tool_orchestrator');
    this.toolProvider = this.mcpClientManager.getClient('tool-orchestrator');
  } else {
    this.logger.info('llm_bot.using_tool_gateway');
    this.toolProvider = this.mcpClientManager.getClient('tool-gateway');
  }
}
```

**Step 2**: Validation in agent-dev
1. Deploy llm-bot + tool-orchestrator to agent-dev
2. Enable feature flag: `ENABLE_TOOL_ORCHESTRATOR=true`
3. Test 10+ tool calling scenarios (image gen, state mgmt, compositions)
4. Verify all tests pass with tool-orchestrator
5. Compare behavior with tool-gateway baseline

**Step 3**: Staged rollout
1. Deploy tool-orchestrator to production (alongside tool-gateway)
2. Enable feature flag for 10% of llm-bot instances
3. Monitor error rates, latency, tool execution success rate
4. If stable, increase to 50%, then 100%
5. Disable tool-gateway once 100% migrated

**Task 3.2 (2 days)**: reflex Migration

**Step 1**: Add feature flag (same pattern as llm-bot)

**Step 2**: Validation
1. Test deterministic agent flow with tool-orchestrator
2. Verify modelId='reflex' propagates correctly
3. Test RBAC validation for deterministic models
4. Verify composition execution works

**Step 3**: Staged rollout (same as llm-bot)

**Rollback Plan**:
- If errors >0.5%, disable feature flag immediately
- If latency >300ms P95, rollback to tool-gateway
- If P0/P1 incident, disable feature flag and investigate

**Success Criteria**:
- [ ] llm-bot successfully calls tools via tool-orchestrator
- [ ] reflex successfully executes compositions via tool-orchestrator
- [ ] No regressions in tool calling behavior
- [ ] Feature flag works in both directions (true/false)
- [ ] Zero P0/P1 production incidents during migration

---

### R6: Progress Message Delivery Broken (P1 - MEDIUM)

**Description**: Tool-orchestrator's simplified `agent.sendProgressUpdate` doesn't actually deliver progress messages to users, breaking long-running operation UX.

**Root Cause**:
```typescript
// tool-orchestrator ToolGateway (simplified implementation)
private async handleSendProgressUpdate(args, context) {
  const progressMessage = `${args.emoji || '🔄'} ${args.message}`;

  // ⚠️ PROBLEM: Just returns acknowledgment, doesn't deliver message
  return {
    content: [{
      type: 'text',
      text: `Progress update acknowledged: "${progressMessage}"`
    }],
    isError: false
  };
}
```

**Impact**:
- Users don't receive progress updates during long operations
- Poor UX for image generation (30-60s), LLM inference (10-30s)
- Users may think operation is frozen

**Likelihood**: Medium (100% if agent.sendProgressUpdate called)

**Severity**: Medium (P1 - UX degradation)

**Affected Stakeholders**:
- End users (no progress feedback)
- LLMs (progress updates not delivered)

**Mitigation Strategy**:

**Task 1.3 Enhancement (1 day)**:

**Step 1**: Add claim check integration
```typescript
private async handleSendProgressUpdate(args, context) {
  const correlationId = context.correlationId;
  let sourceEvent: InternalEventV2 | null = null;

  // 1. Try to retrieve source event from claim check
  if (correlationId) {
    const claimTool = this.registry.getTool('claim.event.retrieve');
    if (claimTool?.execute) {
      const result = await claimTool.execute(
        { correlationId },
        { sessionId: context.sessionId, userRoles: context.userRoles }
      );

      if (result && !result.isError) {
        sourceEvent = JSON.parse(result.content[0].text);
      }
    }
  }

  // 2. Use egress from source event if available
  let egressInfo;
  if (sourceEvent?.egress) {
    egressInfo = sourceEvent.egress;
  } else if (args.egress) {
    egressInfo = args.egress;
  } else {
    // Fallback: construct from userId
    const [platform, externalId] = (context.userId || '').split(':', 2);
    egressInfo = {
      destination: 'internal.egress.v1',
      connector: platform,
      channel: 'unknown',
    };
  }

  // 3. Build progress event
  const progressEvent: InternalEventV2 = {
    // ... full event structure ...
    egress: egressInfo,
    candidates: [{
      text: progressMessage,
      // ...
    }],
  };

  // 4. Route via Bit.next() (requires access to Bit instance)
  // PROBLEM: ToolGateway is not a Bit, doesn't have next()
  // SOLUTION: Add callback to ToolGateway constructor
}
```

**Step 2**: Add Bit.next() callback to ToolGateway
```typescript
// src/apps/tool-orchestrator-service.ts
this.toolGateway = new ToolGateway(
  this.toolRegistry,
  this.modelRegistry,
  { /* config */ },
  mcpClientManager,
  this.getLogger() as any,
  (event) => this.next(event)  // ✅ NEW: Callback for routing events
);

// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
constructor(
  toolRegistry,
  modelRegistry,
  config,
  mcpClientManager,
  logger,
  nextCallback?: (event: InternalEventV2) => Promise<void>  // ✅ NEW
) {
  // ...
  this.nextCallback = nextCallback;
}

private async handleSendProgressUpdate(args, context) {
  // ...
  if (this.nextCallback) {
    await this.nextCallback(progressEvent);
  } else {
    this.logger?.warn('No next callback configured - progress message not routed');
  }
}
```

**Validation**:
1. Deploy tool-orchestrator to agent-dev
2. Call LLM with long-running operation (image generation)
3. Verify progress messages delivered to user at 5s, 15s, 30s intervals
4. Check egress logs for progress message delivery

**Rollback Plan**:
- If claim check integration breaks, fallback to args.egress only
- If Bit.next() callback fails, return error to LLM (don't block operation)

**Success Criteria**:
- [ ] agent.sendProgressUpdate delivers messages to users
- [ ] Claim check integration working
- [ ] Egress fallback chain implemented (claim check → args.egress → userId)
- [ ] Integration test: Progress message delivery end-to-end

---

### R7: Incomplete Gap Analysis (P1 - HIGH)

**Description**: Gap analysis may have missed critical functionality differences, leading to unexpected failures during migration.

**Root Cause**:
- tool-gateway.ts is very large (27929 tokens, ~2800 lines)
- Complex nested functionality (compositions, session management, context provisioning)
- May have missed edge cases or subtle behavioral differences

**Impact**:
- Unexpected failures during migration
- Rollback required
- Schedule delays

**Likelihood**: Low (comprehensive review completed)

**Severity**: High (P1 - Affects schedule)

**Affected Stakeholders**:
- Implementation team (rework required)
- Project management (schedule slips)
- Stakeholders (delayed value delivery)

**Mitigation Strategy**:

**Stakeholder Review (1 day)**:
1. Present gap analysis to Architecture Review Board
2. Present feature parity checklist to product team
3. Present risk assessment to security team
4. Collect feedback and address concerns
5. Get approval to proceed with implementation

**Peer Review (2 days)**:
1. Code review of tool-gateway.ts (line-by-line)
2. Code review of tool-orchestrator ToolGateway (line-by-line)
3. Identify any missed functionality
4. Update gap analysis with new findings

**Integration Testing (Week 2)**:
1. 15+ MCP tool execution tests
2. 10+ internal tool execution tests
3. 12+ composition execution tests
4. 10+ RBAC validation tests
5. Any test failures reveal missed gaps

**Rollback Plan**:
- If critical gap discovered after migration, feature flag to tool-gateway
- Fix gap in tool-orchestrator
- Re-test and re-migrate

**Success Criteria**:
- [ ] Stakeholder review completed with approval
- [ ] No new gaps identified during peer review
- [ ] All integration tests passing
- [ ] Zero unexpected failures during migration

---

### R8: Integration Test Coverage Gaps (P2 - MEDIUM)

**Description**: Integration tests may not cover all execution paths, error scenarios, or edge cases, leading to bugs in production.

**Root Cause**:
- Complex tool execution flow (internal, MCP, composition)
- Multiple error paths (timeout, RBAC denial, transient errors, MCP server down)
- Edge cases (large responses, nested compositions, partial failures)

**Impact**:
- Bugs discovered in production
- User-facing errors
- Rollback required

**Likelihood**: Medium (depends on test coverage)

**Severity**: Medium (P2 - Quality issue)

**Affected Stakeholders**:
- End users (bugs, errors)
- On-call engineers (incident response)
- QA team (missed test scenarios)

**Mitigation Strategy**:

**Task 2.1 (3 days)**: MCP Tool Execution Integration Tests

**Test Scenarios** (15+ tests):
1. Happy path: Execute image-gen-mcp tool successfully
2. Timeout: Tool exceeds timeout, verify graceful failure
3. RBAC denial: Model lacks permission, verify denial
4. MCP server down: Server unavailable, verify error handling
5. Invalid arguments: Schema validation failure
6. Large response: Handle >1MB responses
7. Retry success: Transient error resolved on retry
8. Retry exhausted: Max retries exceeded
9. Network error: Connection refused
10. Timeout error: Operation timed out
11. Server 5xx error: Internal server error
12. Concurrent execution: Multiple MCP calls in parallel
13. Cache hit: Tool metadata from cache
14. Cache miss: Tool metadata from PostgreSQL
15. Missing MCP server: Tool references unknown server

**Task 2.2 (2 days)**: Internal Tool Execution Integration Tests

**Test Scenarios** (10+ tests):
1. agent.sendProgressUpdate delivery
2. Concurrent progress updates to different users
3. Invalid egress metadata handling
4. Claim check retrieval success
5. Claim check retrieval failure (graceful degradation)
6. Progress message routing via Bit.next()
7. Egress fallback chain (claim check → args.egress → userId)
8. Missing userId (error handling)
9. Invalid userId format (error handling)
10. Performance: <10ms execution time

**Task 2.3 (3 days)**: Composition Execution Integration Tests

**Test Scenarios** (12+ tests):
1. Simple composition (2-step sequential)
2. RBAC failure: Composition with restricted tool
3. Partial failure: Step 2 fails, verify cleanup
4. Variable resolution: Steps reference ${previous.result}
5. Nested composition: Composition calling another composition
6. Sequential execution: 5 steps in order
7. Parallel execution: 3 steps concurrently
8. Partial parallel failure: 1 of 3 steps fails
9. Conditional execution (not implemented - should error)
10. Per-step RBAC validation (all 5 dimensions)
11. Large composition: 20+ steps
12. Composition with MCP tools: Mix internal + MCP steps

**Coverage Target**: 90%+ statement coverage (measured by Jest)

**Rollback Plan**:
- If test coverage <80%, delay migration until gaps filled
- If critical bug discovered in testing, fix before migration

**Success Criteria**:
- [ ] 40+ integration tests passing
- [ ] 90%+ statement coverage
- [ ] All error paths tested
- [ ] All edge cases covered
- [ ] No regressions vs tool-gateway

---

## Risk Mitigation Timeline

| Week | Risks Mitigated | Tasks |
|------|-----------------|-------|
| **Week 1** | R1, R2, R3, R7 | Tasks 1.2, 1.3, 1.4, Stakeholder review |
| **Week 2** | R8 | Tasks 2.1, 2.2, 2.3, 2.4 (integration tests) |
| **Week 3** | R5, R6 | Tasks 3.1, 3.2 (consumer migration) |
| **Week 4** | R4 | Tasks 4.1, 4.2, 5.1 (performance, staging) |

---

## Overall Risk Score

**Before Mitigation**: **HIGH** (3 P0 risks, 4 P1 risks, 1 P2 risk)

**After Mitigation (Projected)**: **LOW** (0 P0 risks, 1 P1 risk, 1 P2 risk)

**Migration Readiness**: **Not Ready** (3 P0 blocking risks)

**Estimated Time to Readiness**: **5-7 days** (Tasks 1.2, 1.3, 1.4 completion)

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| P0 risks closed | 3/3 | 0/3 | ❌ |
| P1 risks closed | 4/4 | 0/4 | ❌ |
| Integration tests passing | 40+ | 0 | ❌ |
| Performance regression | <20% | Unknown | ⚠️ |
| Stakeholder approval | Yes | Pending | ⚠️ |
| Zero P0/P1 incidents | Yes | N/A | ⚠️ |

---

## Recommendations

### Immediate Actions (This Week)

1. **Stakeholder Review** (1 day): Present gap analysis, get approval
2. **Task 1.2** (1 day): Initialize McpClientManager
3. **Task 1.3** (2 days): Port composition subsystem + admin tools
4. **Task 1.4** (2 days): Add composition per-step RBAC

### Next Sprint (Week 2+)

1. **Integration Testing** (5 days): 40+ integration tests
2. **Performance Testing** (4 days): Benchmarking + load testing
3. **Consumer Migration** (5 days): llm-bot + reflex migration
4. **Staging Validation** (2 days): 48-hour monitoring

### Contingency Planning

1. **Feature Flag**: Always have rollback path to tool-gateway
2. **Staged Rollout**: 10% → 50% → 100% migration
3. **Monitoring**: Error rate, latency, RBAC denials, tool success rate
4. **Rollback Criteria**: Error rate >0.5%, P95 latency >300ms, any P0/P1 incident

---

**Document Status**: Ready for Review
**Approval Required**: Architecture Review Board, Security Team, Product Team
**Next Review Date**: 2026-11-16
**Approver Sign-off**: [ ] Architecture [ ] Security [ ] Product
