# Sprint 65 Execution Plan: Tool Execution Migration & Validation

**Sprint ID**: sprint-65-execution-migration
**Duration**: 3-4 weeks (15-20 working days)
**Goal**: Complete tool execution migration from tool-gateway to tool-orchestrator, validate equivalence, migrate consumers, and prepare for tool-gateway deprecation
**Prerequisites**: ✅ Sprint 62 (MCP Aggregation), ✅ Sprint 63 (ToolRegistry + ModelRegistry), ✅ Sprint 64 (Model-Based RBAC)

---

## Executive Summary

Sprint 65 completes the tool-orchestrator vision by ensuring all tool execution paths are production-ready, fully tested, and migrated away from the legacy tool-gateway service. While the core execution methods exist in tool-orchestrator's ToolGateway module, this sprint focuses on:

1. **Gap Analysis**: Comprehensive comparison of tool-gateway vs tool-orchestrator functionality
2. **Feature Completion**: Fill any gaps in MCP client management, composition execution, and error handling
3. **Integration Testing**: End-to-end validation of all execution paths (internal, MCP, composition)
4. **Consumer Migration**: Update llm-bot and reflex to use tool-orchestrator
5. **Performance Validation**: Load testing and performance benchmarking
6. **Deprecation Preparation**: Document migration path and prepare tool-gateway for removal

---

## Current State Assessment

### ✅ Already Implemented (Sprints 62-64)

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| **ToolRegistry Module** | ✅ Complete | src/apps/tool-orchestrator-service/modules/registry/ | PostgreSQL-backed, CRUD operations |
| **ModelRegistry Module** | ✅ Complete | src/apps/tool-orchestrator-service/modules/models/ | Model catalog with trust scores |
| **ToolGateway Module** | 🟡 Partial | src/apps/tool-orchestrator-service/modules/gateway/ | Execution methods exist, need validation |
| **ToolObserver Module** | ✅ Complete | src/apps/tool-orchestrator-service/modules/observer/ | Loki integration for metrics |
| **RBAC Validation** | ✅ Complete | src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts | Dual-layer (User × Model) |
| **MCP Aggregation** | ✅ Complete | src/apps/tool-orchestrator-service.ts | Serves 19+ tools via MCP |

### ⚠️ Needs Validation/Completion

| Component | Status | Gap | Action Required |
|-----------|--------|-----|-----------------|
| **MCP Tool Execution** | 🟡 Implemented | Not fully tested vs tool-gateway | Comprehensive integration tests |
| **Internal Tool Execution** | 🟡 Implemented | Missing some internal tools | Port remaining internal tools |
| **Composition Execution** | 🟡 Implemented | No per-step RBAC validation | Add composition RBAC checks |
| **McpClientManager Integration** | 🟡 Partial | Not initialized in tool-orchestrator | Wire up McpClientManager |
| **Feedback Middleware** | ❌ Missing | No integration | Add progress update support |
| **Error Recovery** | 🟡 Basic | No retry logic | Add retry with exponential backoff |
| **Consumer Migration** | ❌ Not Started | llm-bot/reflex still use tool-gateway | Feature flag + migration |

---

## Sprint 65 Tasks Breakdown

### Phase 1: Gap Analysis & Feature Completion (Week 1)

#### Task 1.1: Comprehensive Functionality Comparison
**Duration**: 2 days
**Owner**: Implementation Lead

**Objectives**:
- Line-by-line comparison of tool-gateway.ts vs tool-orchestrator ToolGateway module
- Document all missing features, edge cases, error handling
- Create compatibility matrix

**Deliverables**:
- [ ] Functionality gap analysis document
- [ ] Feature parity checklist
- [ ] Risk assessment for migration

**Acceptance Criteria**:
- All differences documented with severity ratings
- No P0/P1 gaps remaining before next phase
- Stakeholder approval on gap remediation plan

---

#### Task 1.2: Initialize McpClientManager in tool-orchestrator
**Duration**: 1 day
**Owner**: Integration Engineer

**Objectives**:
- Wire up McpClientManager in tool-orchestrator's setup()
- Configure connection to external MCP servers
- Test connectivity to image-gen-mcp, story-engine-mcp

**Implementation**:
```typescript
// src/apps/tool-orchestrator-service.ts
public async setup(): Promise<void> {
  // ... existing setup ...

  // Initialize MCP Client Manager for external tool execution
  const mcpClientManager = new McpClientManager(this as any, this.toolRegistry);

  // Pass to ToolGateway
  this.toolGateway = new ToolGateway(
    this.toolRegistry,
    this.modelRegistry,
    { /* config */ },
    mcpClientManager,  // NEW: Wire up MCP client manager
    this.getLogger() as any
  );
}
```

**Deliverables**:
- [ ] McpClientManager initialized in tool-orchestrator
- [ ] Successful connection to at least 2 external MCP servers
- [ ] Connection monitoring and health checks working

**Acceptance Criteria**:
- `tool-orchestrator.mcp_client_manager_initialized` log event emitted
- External MCP tools callable via tool.execute
- Connection failures handled gracefully with retry

---

#### Task 1.3: Port Missing Internal Tools
**Duration**: 2 days
**Owner**: Feature Developer

**Objectives**:
- Audit all internal tools in tool-gateway
- Port any missing tools to tool-orchestrator's ToolGateway
- Ensure agent.sendProgressUpdate works end-to-end

**Current Internal Tools** (from tool-gateway):
- ✅ agent.sendProgressUpdate (exists in tool-orchestrator)
- ❓ composition.* tools (need to check if in tool-orchestrator)
- ❓ Any other platform-internal tools

**Deliverables**:
- [ ] All internal tools registered in tool-orchestrator
- [ ] Unit tests for each internal tool
- [ ] Integration test: Internal tool execution end-to-end

**Acceptance Criteria**:
- 100% parity with tool-gateway internal tools
- All internal tools pass unit tests
- agent.sendProgressUpdate successfully delivers messages

---

#### Task 1.4: Composition RBAC Validation
**Duration**: 2 days
**Owner**: Security Engineer

**Objectives**:
- Add per-step RBAC validation in composition execution
- Ensure model permissions cascade through composition steps
- Fail-fast if any step violates RBAC

**Implementation**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
private async executeComposition(
  tool: ToolRegistryDocument,
  args: unknown,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const compositionId = tool.sourceMetadata?.composition?.compositionId;
  const composition = await this.loadComposition(compositionId);

  // NEW: Pre-validate RBAC for ALL constituent tools
  for (const step of composition.steps) {
    const stepTool = await this.getToolCached(step.toolId);
    const stepModel = await this.getModelCached(context.modelId);

    const rbacResult = this.rbacValidator.validateToolAccess(
      stepTool,
      context.userRoles,
      stepModel
    );

    if (!rbacResult.allowed) {
      throw new Error(
        `Composition step ${step.name} RBAC denied: ${rbacResult.reason}`
      );
    }
  }

  // Execute composition...
}
```

**Deliverables**:
- [ ] Per-step RBAC validation implemented
- [ ] Test cases for RBAC failures at each step
- [ ] Error messages clearly indicate which step failed

**Acceptance Criteria**:
- Compositions with restricted tools fail with clear RBAC error
- RBAC validation happens BEFORE execution starts
- All 5 RBAC dimensions validated (user roles, model roles, tier, trust, policy)

---

### Phase 2: Integration Testing (Week 2)

#### Task 2.1: MCP Tool Execution Integration Tests
**Duration**: 3 days
**Owner**: QA Engineer

**Objectives**:
- End-to-end tests for MCP tool execution via tool-orchestrator
- Validate timeout enforcement, retry logic, error handling
- Compare behavior with tool-gateway baseline

**Test Scenarios**:
1. **Happy Path**: Execute image-gen-mcp tool successfully
2. **Timeout**: Tool exceeds timeout, verify graceful failure
3. **RBAC Denial**: Model lacks permission, verify denial
4. **MCP Server Down**: Server unavailable, verify error handling
5. **Invalid Arguments**: Schema validation failure
6. **Large Response**: Handle large MCP responses (>1MB)

**Deliverables**:
- [ ] 15+ integration test cases for MCP execution
- [ ] All tests passing with tool-orchestrator
- [ ] Behavior matches tool-gateway baseline

**Acceptance Criteria**:
- 100% of MCP tool execution tests passing
- Response times within 10% of tool-gateway
- Error messages are user-friendly and actionable

---

#### Task 2.2: Internal Tool Execution Integration Tests
**Duration**: 2 days
**Owner**: QA Engineer

**Objectives**:
- Test all internal tools via tool-orchestrator
- Validate agent.sendProgressUpdate end-to-end
- Ensure internal tools bypass MCP overhead

**Test Scenarios**:
1. **Progress Updates**: Send progress message, verify delivery to user
2. **Multi-User**: Concurrent progress updates to different users
3. **Error Handling**: Invalid egress metadata, verify graceful failure

**Deliverables**:
- [ ] 10+ integration test cases for internal tools
- [ ] Progress message delivery validated end-to-end
- [ ] Performance benchmarks (should be <10ms)

**Acceptance Criteria**:
- All internal tools execute without MCP roundtrip
- Progress messages delivered within 100ms
- No regressions vs tool-gateway

---

#### Task 2.3: Composition Execution Integration Tests
**Duration**: 3 days
**Owner**: QA Engineer

**Objectives**:
- Test multi-step compositions via tool-orchestrator
- Validate RBAC at each step
- Test variable resolution and state management

**Test Scenarios**:
1. **Simple Composition**: 2-step composition (get_state → set_state)
2. **RBAC Failure**: Composition with restricted tool, verify failure
3. **Partial Failure**: Step 2 fails, verify rollback/cleanup
4. **Variable Resolution**: Steps reference ${previous.result}
5. **Nested Composition**: Composition calling another composition

**Deliverables**:
- [ ] 12+ integration test cases for compositions
- [ ] RBAC validation working at each step
- [ ] State management validated across steps

**Acceptance Criteria**:
- All composition tests passing
- RBAC failures caught before execution starts
- No regressions vs tool-gateway composition executor

---

#### Task 2.4: Feedback Middleware Integration
**Duration**: 2 days
**Owner**: Integration Engineer

**Objectives**:
- Integrate feedback middleware for long-running operations
- Test progress messages during image generation (30-60s)
- Validate progress message timing (5s, 15s, 30s intervals)

**Implementation**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
async execute(toolId, args, context): Promise<ToolResult> {
  // Add operation_context annotation for long-running tools
  if (tool.config.timeoutMs > 10000) {
    event.annotations.push({
      kind: 'operation_context',
      value: {
        operation: toolId,
        estimatedDurationMs: tool.config.timeoutMs,
        startedAt: new Date().toISOString(),
      },
      source: 'tool-orchestrator',
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });

    // Trigger feedback middleware
    await this.startProgressTracking(event);
  }

  // Execute tool...
  const result = await this.executeMcp(tool, args, context);

  // Feedback middleware auto-cleans up on next()
  return result;
}
```

**Deliverables**:
- [ ] Feedback middleware integration complete
- [ ] Progress messages sent at correct intervals
- [ ] Integration test: 60s operation sends 3 progress messages

**Acceptance Criteria**:
- First progress message at 5s
- Subsequent messages every 10s
- Progress stops automatically when operation completes
- No progress messages for fast operations (<5s)

---

### Phase 3: Consumer Migration (Week 3)

#### Task 3.1: llm-bot Migration to tool-orchestrator
**Duration**: 3 days
**Owner**: Migration Lead

**Objectives**:
- Add feature flag to llm-bot for tool provider selection
- Test llm-bot with tool-orchestrator in agent-dev context
- Validate all tool calling scenarios

**Implementation**:
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

**Deliverables**:
- [ ] Feature flag implemented in llm-bot
- [ ] Integration test: llm-bot calls tools via tool-orchestrator
- [ ] Validation in agent-dev context (5+ test scenarios)

**Acceptance Criteria**:
- llm-bot successfully calls tools via tool-orchestrator
- No regressions in tool calling behavior
- Feature flag works in both directions (true/false)

---

#### Task 3.2: reflex Migration to tool-orchestrator
**Duration**: 2 days
**Owner**: Migration Lead

**Objectives**:
- Update reflex composition templates to use tool-orchestrator
- Test deterministic agent flow with tool-orchestrator
- Validate modelId propagation in reflex context

**Implementation**:
```typescript
// src/apps/reflex-service.ts
async executeComposition(template: CompositionTemplate): Promise<void> {
  const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
  const toolProvider = useToolOrchestrator ? 'tool-orchestrator' : 'tool-gateway';

  const context = {
    userRoles: event.identity.user?.roles || [],
    modelId: 'reflex',  // Reflex is registered as deterministic model
    correlationId: event.correlationId
  };

  await this.mcpClient.callTool(
    `${toolProvider}.execute`,
    { toolId, args, context }
  );
}
```

**Deliverables**:
- [ ] reflex migrated to use tool-orchestrator
- [ ] Integration test: reflex composition execution
- [ ] Validation of deterministic model permissions

**Acceptance Criteria**:
- reflex successfully executes compositions via tool-orchestrator
- modelId='reflex' propagates correctly
- RBAC validation works for deterministic models

---

### Phase 4: Performance & Load Testing (Week 3-4)

#### Task 4.1: Performance Benchmarking
**Duration**: 2 days
**Owner**: Performance Engineer

**Objectives**:
- Benchmark tool-orchestrator vs tool-gateway
- Measure P50, P95, P99 latencies for all execution types
- Identify performance bottlenecks

**Test Scenarios**:
1. **Internal Tool**: 1000 invocations, measure latency
2. **MCP Tool**: 500 invocations of image-gen-mcp
3. **Composition**: 200 composition executions
4. **Cache Hit Rate**: Measure ToolRegistry cache effectiveness

**Deliverables**:
- [ ] Performance benchmark report
- [ ] Latency comparison chart (tool-gateway vs tool-orchestrator)
- [ ] Optimization recommendations

**Acceptance Criteria**:
- P95 latency within 20% of tool-gateway baseline
- Cache hit rate >80% for tool/model lookups
- No memory leaks during sustained load

---

#### Task 4.2: Load Testing (1000 concurrent operations)
**Duration**: 2 days
**Owner**: Performance Engineer

**Objectives**:
- Test tool-orchestrator under sustained load
- Validate connection pooling and resource management
- Measure error rates and timeout behavior

**Load Profile**:
- 1000 concurrent tool invocations over 10 minutes
- Mix: 70% internal, 20% MCP, 10% composition
- Ramp-up: 100 requests/sec → 1000 requests/sec over 2 minutes

**Deliverables**:
- [ ] Load test execution results
- [ ] Error rate analysis (<0.1% target)
- [ ] Resource utilization graphs (CPU, memory, DB connections)

**Acceptance Criteria**:
- <0.1% error rate under load
- No connection pool exhaustion
- Graceful degradation if load exceeds capacity

---

### Phase 5: Migration & Deprecation (Week 4)

#### Task 5.1: Staging Validation
**Duration**: 2 days
**Owner**: DevOps Engineer

**Objectives**:
- Deploy tool-orchestrator to staging environment
- Enable ENABLE_TOOL_ORCHESTRATOR feature flag
- Monitor for 48 hours, validate no regressions

**Monitoring**:
- Error rate (target: <0.1%)
- P95 latency (target: <200ms)
- RBAC denial rate (compare to tool-gateway baseline)
- Tool invocation success rate (target: >99.9%)

**Deliverables**:
- [ ] Staging deployment successful
- [ ] 48-hour monitoring report
- [ ] Stakeholder approval for production cutover

**Acceptance Criteria**:
- No P0/P1 incidents in staging
- Metrics within acceptable ranges
- User-facing behavior identical to tool-gateway

---

#### Task 5.2: Production Cutover Plan
**Duration**: 1 day
**Owner**: Migration Lead

**Objectives**:
- Document step-by-step cutover procedure
- Define rollback criteria and procedure
- Create runbook for production operators

**Cutover Steps**:
1. **Pre-Cutover** (T-24h):
   - Deploy tool-orchestrator to production (alongside tool-gateway)
   - Validate health checks passing
   - Confirm feature flag disabled

2. **Cutover** (T+0):
   - Enable ENABLE_TOOL_ORCHESTRATOR=true in llm-bot, reflex
   - Monitor metrics for 1 hour
   - Validate tool executions routing to tool-orchestrator

3. **Post-Cutover** (T+24h):
   - Monitor for 24 hours
   - If stable, disable tool-gateway
   - Schedule tool-gateway deprecation (Sprint 66)

**Rollback Criteria**:
- Error rate >0.5%
- P95 latency >300ms
- Any P0/P1 production incident

**Deliverables**:
- [ ] Production cutover runbook
- [ ] Rollback procedure documented
- [ ] On-call engineer training completed

**Acceptance Criteria**:
- Runbook validated in staging dry-run
- Rollback procedure tested
- Stakeholder approval obtained

---

#### Task 5.3: Documentation & Knowledge Transfer
**Duration**: 2 days
**Owner**: Documentation Lead

**Objectives**:
- Update all documentation to reflect tool-orchestrator
- Create migration guide for future service migrations
- Document lessons learned from Sprint 65

**Documentation Deliverables**:
- [ ] Updated architecture diagrams (remove tool-gateway)
- [ ] Tool execution flow documentation
- [ ] RBAC validation guide (dual-layer model)
- [ ] Troubleshooting runbook for tool-orchestrator
- [ ] Migration postmortem (lessons learned)

**Acceptance Criteria**:
- All outdated tool-gateway references removed
- New documentation reviewed by 2+ stakeholders
- Runbook validated by on-call engineers

---

## Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Performance Regression** | Medium | High | Comprehensive benchmarking, staged rollout with feature flag |
| **RBAC Bypasses** | Low | Critical | Security review of all RBAC validation paths, penetration testing |
| **Composition Breaking Changes** | Medium | Medium | Extensive composition integration tests, backward compatibility checks |
| **MCP Server Connectivity Issues** | Medium | Medium | Connection pooling, retry logic, graceful degradation |
| **Consumer Migration Failures** | Low | High | Feature flag for easy rollback, staged migration (llm-bot first, reflex second) |
| **Incomplete Gap Analysis** | Medium | High | Line-by-line code comparison, stakeholder review of gap analysis |

---

## Success Criteria

### Must-Have (P0)
- ✅ All tool execution types working (internal, MCP, composition)
- ✅ RBAC validation equivalent to tool-gateway
- ✅ llm-bot and reflex successfully migrated
- ✅ Performance within 20% of tool-gateway baseline
- ✅ Zero P0/P1 regressions in production

### Should-Have (P1)
- ✅ Feedback middleware integration complete
- ✅ Comprehensive integration test suite (40+ tests)
- ✅ Load testing validates 1000 concurrent operations
- ✅ Documentation updated and approved

### Nice-to-Have (P2)
- 🎯 Performance better than tool-gateway
- 🎯 tool-gateway fully deprecated and removed
- 🎯 Composition RBAC inheritance implemented

---

## Sprint Backlog (YAML Format)

See `sprint-65-backlog.yaml` for detailed task tracking with priorities, dependencies, and acceptance criteria.

---

## Next Steps (Sprint 66+)

1. **Sprint 66**: Tool-gateway deprecation and removal
2. **Sprint 67**: Composition RBAC inheritance and validation
3. **Sprint 68**: Advanced observability (Grafana dashboards, alerting)
4. **Sprint 69**: Platform verb extensions (tool.schedule, tool.batch, tool.stream)

---

**Document Status**: Draft v1
**Last Updated**: 2026-11-15
**Author**: Implementation Team
**Approval Required**: Architecture Review Board
