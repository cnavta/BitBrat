# Sprint 60 Implementation Plan: Tool Execution Migration

**Sprint ID**: sprint-60-j880fj
**Duration**: 2-3 weeks (12-15 working days)
**Owner**: christophernavta
**Status**: Planning → In Progress
**Goal**: Migrate actual tool execution logic (MCP, internal, composition) from tool-gateway to tool-orchestrator

---

## Executive Summary

Sprint 60 addresses the critical gap identified after Sprint 59: **core tool execution logic was NOT migrated from tool-gateway**. While Sprints 57-59 successfully delivered foundation infrastructure (ToolRegistry, ModelRegistry), RBAC validation, and observability (ToolObserver + Loki), the actual execution handlers remain as placeholders throwing errors.

This sprint migrates ~500 lines of execution logic from `src/apps/tool-gateway.ts` to the new tool-orchestrator ToolGateway module, implementing:
- MCP tool execution (external servers via stdio/HTTP)
- Internal tool execution (BitBrat platform tools)
- Composition execution (multi-step workflows with per-step RBAC)
- Comprehensive error handling (timeouts, retries, graceful failures)
- Event logging to Loki (100% coverage)
- Integration with feedback middleware (long-running operations)
- 30+ tests validating all execution paths

---

## Context & Dependencies

### Prerequisites (✅ Complete from Sprints 57-59)
- **Sprint 57**: ToolRegistry module (PostgreSQL-backed tool metadata storage)
- **Sprint 57**: ModelRegistry module (Model catalog with security profiles)
- **Sprint 58**: Dual-layer RBAC validation (User × Model permissions)
- **Sprint 59**: ToolObserver module (Loki-based metrics/traces)
- **Sprint 59**: Loki integration (structured event logging)

### Current State
**tool-orchestrator Bit** exists with four modules:
1. **ToolRegistry** ✅ - Manages `platform_tool_registry` (PostgreSQL)
2. **ModelRegistry** ✅ - Manages `model_registry` (PostgreSQL)
3. **ToolObserver** ✅ - Queries Loki for metrics/health
4. **ToolGateway** ⚠️ - **INCOMPLETE** - Execution methods throw "not yet implemented" errors

**Location**: `src/apps/tool-orchestrator-service/`

### Gap Analysis
Sprint 58 intentionally left execution as placeholders:
```typescript
// Current state in ToolGateway module
private async executeMcpTool(...): Promise<ToolResult> {
  throw new Error('MCP tool execution not yet implemented - Sprint 58 focuses on RBAC validation');
}
```

**Source Code**: tool-gateway.ts (~500 lines of execution logic to migrate)
- MCP execution: Lines 200-400 (McpClientManager integration)
- Internal tools: Lines 100-200 (internal handler routing)
- Compositions: Lines 300-600 (step sequencing, variable resolution)

---

## Implementation Tasks

### Phase 1: Core Execution Migration (Days 1-8)

#### T1: Migrate MCP Tool Execution (Days 1-5)
**Goal**: Enable tool-orchestrator to execute tools on external MCP servers

**Steps**:
1. **Extract MCP execution logic** (Day 1)
   - Read `src/apps/tool-gateway.ts` lines 200-400
   - Identify dependencies: McpClientManager, timeout logic, error handling
   - Document execution flow and edge cases

2. **Implement in ToolGateway module** (Days 2-3)
   - File: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
   - Create `executeMcpTool()` method
   - Integrate with existing McpClientManager
   - Add timeout enforcement (AbortController)
   - Implement result transformation

3. **Migrate McpClientManager** (Day 4)
   - Move `src/common/mcp/client-manager.ts` to tool-orchestrator module
   - Update imports and dependencies
   - Ensure lifecycle management (connect/disconnect)

4. **Test MCP execution** (Day 5)
   - Unit tests: Success, timeout, error, retry scenarios (10 tests)
   - Integration test: Deploy to agent-dev, call external MCP server
   - Verify Loki logging

**Files Modified**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (~150 lines)
- `src/apps/tool-orchestrator-service/modules/gateway/mcp-client-manager.ts` (migrated)

**Acceptance Criteria**:
- ✅ MCP tools execute successfully
- ✅ Timeout enforcement working (configurable per tool)
- ✅ Error handling graceful (no crashes)
- ✅ Events logged to Loki with correlationId
- ✅ 10+ unit tests passing

---

#### T2: Migrate Internal Tool Execution (Days 6-8)
**Goal**: Enable execution of BitBrat internal tools (platform tools)

**Steps**:
1. **Extract internal tool logic** (Day 6)
   - Read `src/apps/tool-gateway.ts` lines 100-200
   - Document internal tool interface
   - Identify existing internal tools (agent.sendProgressUpdate, etc.)

2. **Implement in ToolGateway** (Day 7)
   - Create `executeInternalTool()` method
   - Add internal tool registry (Map<toolId, handler>)
   - Register built-in tools during setup()

3. **Test internal execution** (Day 8)
   - Unit tests: Success, error, missing handler (5 tests)
   - Verify agent.sendProgressUpdate works end-to-end

**Acceptance Criteria**:
- ✅ Internal tools execute successfully
- ✅ Progress updates working (feedback middleware integration)
- ✅ 5+ tests passing

---

### Phase 2: Composition & Infrastructure (Days 9-12)

#### T3: Migrate Composition Execution (Days 9-12)
**Goal**: Enable multi-step composition execution with per-step RBAC

**Steps**:
1. **Extract composition executor** (Day 9)
   - Read `src/apps/tool-gateway.ts` lines 300-600
   - Document step sequencing, variable resolution, RBAC checks

2. **Implement in ToolGateway** (Days 10-11)
   - Create `executeComposition()` method
   - Load composition definition from registry
   - Execute steps sequentially
   - Validate RBAC for EACH constituent tool (recursive call to validateToolAccess)
   - Implement state management (variable passing between steps)

3. **Add composition RBAC validation** (Day 11)
   - Prevent privilege escalation (invoking model must have access to ALL constituent tools)
   - Re-validate at runtime (not just registration time)

4. **Test composition execution** (Day 12)
   - Unit tests: Success, RBAC denial, step failure, variable passing (8 tests)
   - Integration test: Multi-step composition in agent-dev

**Acceptance Criteria**:
- ✅ Compositions execute successfully
- ✅ Per-step RBAC validation enforced
- ✅ 8+ tests passing
- ✅ No privilege escalation possible

---

#### T4: Event Logging Integration (Days 13-14)
**Goal**: Ensure 100% tool invocations logged to Loki

**Steps**:
1. **Centralize logging** (Day 13)
   - Create `logToolInvocation()` method in ToolGateway
   - Log structure: toolId, modelId, status, durationMs, errorMessage, correlationId

2. **Add to all execution paths** (Day 13)
   - MCP execution: log start + end
   - Internal execution: log start + end
   - Composition execution: log start + end + each step
   - RBAC denial: log denial reason

3. **Verify Loki ingestion** (Day 14)
   - Deploy to agent-dev
   - Execute 20 tools (mix of MCP, internal, composition)
   - Query Loki for events
   - Verify all 20 logged with correct labels

**Acceptance Criteria**:
- ✅ 100% tool invocations logged
- ✅ All execution paths covered
- ✅ Loki queries return accurate data
- ✅ Events include correlationId, toolId, modelId, status

---

### Phase 3: Error Handling & Testing (Days 15-20)

#### T5: Error Handling & Recovery (Days 15-16)
**Goal**: Graceful failure handling for all execution types

**Steps**:
1. **Timeout enforcement** (Day 15)
   - AbortController for all async operations
   - Configurable timeouts per tool (tool.config.timeoutMs)
   - Clear timeout error messages

2. **Retry logic** (Day 15)
   - Exponential backoff (1s, 2s, 4s)
   - Configurable max retries (default: 3)
   - Only retry transient errors (network, timeout)

3. **Graceful degradation** (Day 16)
   - MCP server unavailable → return clear error
   - Internal tool missing → return error, don't crash
   - Composition step fails → rollback, log state

4. **Test error scenarios** (Day 16)
   - Unit tests: Timeout, retry, unavailable server, missing tool (10 tests)

**Acceptance Criteria**:
- ✅ Timeouts enforced (no infinite hangs)
- ✅ Retry logic working (exponential backoff)
- ✅ No crashes on errors
- ✅ 10+ error tests passing

---

#### T6: Integration with Feedback Middleware (Day 17)
**Goal**: Support long-running operations (Sprint 36 pattern)

**Steps**:
1. **Detect long operations** (Day 17)
   - Check for `operation_context` annotation
   - Auto-call feedbackMiddleware.startTracking()

2. **Auto-complete on finish** (Day 17)
   - Middleware detects `next()` call
   - Automatically calls completeOperation()

3. **Test progress updates** (Day 17)
   - Deploy to agent-dev
   - Execute 30-second operation
   - Verify progress messages sent at 5s, 15s, 30s

**Acceptance Criteria**:
- ✅ Long operations send progress updates
- ✅ No manual middleware calls needed
- ✅ Auto-cleanup on completion

---

#### T7: Comprehensive Testing (Days 18-20)
**Goal**: 30+ tests covering all execution paths

**Test Categories**:

**MCP Execution (10 tests)**:
1. MCP tool success
2. MCP tool timeout
3. MCP tool error
4. MCP server unavailable
5. MCP tool retry (transient failure)
6. MCP tool with progress updates
7. MCP tool RBAC denial
8. MCP tool missing
9. MCP tool argument validation
10. MCP tool response parsing

**Internal Execution (5 tests)**:
1. Internal tool success
2. Internal tool error
3. Internal handler missing
4. Progress update tool
5. Internal tool RBAC denial

**Composition Execution (10 tests)**:
1. Simple composition (2 steps)
2. Complex composition (5 steps)
3. Composition with variable passing
4. Composition RBAC denial (step 2)
5. Composition step timeout
6. Composition step error (rollback)
7. Composition with conditional logic
8. Nested composition
9. Composition with parallel steps
10. Composition state management

**Error Handling (5 tests)**:
1. Timeout enforcement
2. Retry logic (3 attempts)
3. Graceful degradation
4. Error message clarity
5. Loki logging on errors

**Integration Tests (5 tests)** (agent-dev):
1. End-to-end: User message → llm-bot → MCP tool → response
2. End-to-end: User message → llm-bot → composition → response
3. RBAC denial flow
4. Progress update flow (30s operation)
5. Model upgrade flow (basic → premium)

**Performance Tests (2 tests)**:
1. P95 execution latency < 100ms (excluding MCP call time)
2. No memory leaks (1000 invocations)

**Test Files**:
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/tool-gateway.test.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/mcp-execution.test.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/internal-execution.test.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/composition-execution.test.ts`
- `src/apps/tool-orchestrator-service/modules/gateway/__tests__/error-handling.test.ts`
- `src/apps/tool-orchestrator-service/__tests__/integration.test.ts`

**Acceptance Criteria**:
- ✅ 35+ tests passing
- ✅ 85%+ code coverage
- ✅ All execution paths tested
- ✅ Performance targets met (P95 < 100ms)

---

## Validation Strategy

### Agent-Dev Deployment
After each task completion, deploy to agent-dev context:

```bash
# Provision agent-dev environment
agent_dev.provision({ name: "agent-dev-sprint-60" })

# Deploy tool-orchestrator
bit deploy tool-orchestrator --context agent-dev-sprint-60

# Verify service health
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint-60" })

# Test execution paths
message.send({
  context: "agent-dev-sprint-60",
  text: "test tool execution",
  platform: "api",
  waitForResponse: true
})

# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint-60", limit: 50 })

# Query Loki for events
observer.tool_metrics({ toolId: "test-tool", timeRange: "5m" })

# Cleanup
agent_dev.destroy({ name: "agent-dev-sprint-60", confirm: true })
```

### Integration Testing
1. Deploy llm-bot + tool-orchestrator to agent-dev
2. Send test message requiring tool execution
3. Verify tool executes successfully
4. Check Loki for complete event trace
5. Validate RBAC enforcement
6. Test composition execution

### Performance Validation
1. Load test: 1000 tool invocations
2. Measure P95 latency (target: <100ms)
3. Memory leak test: Monitor heap over 1000 invocations
4. Verify cache hit ratio (target: >90%)

---

## File Structure

```
src/apps/tool-orchestrator-service/
├── index.ts                                    # Main Bit entry point
├── modules/
│   ├── gateway/
│   │   ├── tool-gateway.ts                    # ✏️ MODIFY: Add execution methods
│   │   ├── tool-gateway.interface.ts          # Interface definition
│   │   ├── mcp-client-manager.ts              # ➕ NEW: Migrated from common/mcp
│   │   └── __tests__/
│   │       ├── tool-gateway.test.ts           # ➕ NEW: Unit tests
│   │       ├── mcp-execution.test.ts          # ➕ NEW: MCP tests
│   │       ├── internal-execution.test.ts     # ➕ NEW: Internal tests
│   │       ├── composition-execution.test.ts  # ➕ NEW: Composition tests
│   │       └── error-handling.test.ts         # ➕ NEW: Error tests
│   ├── registry/                              # ✅ Complete (Sprint 57)
│   ├── models/                                # ✅ Complete (Sprint 57)
│   └── observer/                              # ✅ Complete (Sprint 59)
├── types/
│   ├── tool-registry-document.ts              # ✅ Complete
│   ├── model-registry-document.ts             # ✅ Complete
│   ├── tool-metrics.ts                        # ✅ Complete
│   └── tool-execution-context.ts              # ✅ Complete (Sprint 58)
└── __tests__/
    └── integration.test.ts                    # ➕ NEW: Integration tests
```

---

## Risk Mitigation

### High Risk: Execution Logic Complexity
**Risk**: Migrating 500+ lines of execution logic introduces bugs
**Mitigation**:
- Extract code in small chunks (MCP → Internal → Composition)
- Comprehensive testing (35+ tests)
- Parallel operation with tool-gateway (feature flag)
- Agent-dev validation after each task

### Medium Risk: Performance Regression
**Risk**: New execution path slower than tool-gateway
**Mitigation**:
- LRU cache (already 99% hit ratio from Sprint 58)
- Load testing (1000 invocations)
- Performance benchmarks (P95 < 100ms)
- In-process module calls (<1µs latency)

### Medium Risk: RBAC Bypass
**Risk**: Composition execution allows privilege escalation
**Mitigation**:
- Per-step RBAC validation (recursive validateToolAccess)
- Runtime re-validation (not just registration time)
- Security-focused test scenarios
- RBAC denial logging to Loki

---

## Success Metrics

### Implementation Success
- ✅ All execution types working (MCP, internal, composition)
- ✅ 35+ tests passing
- ✅ 100% tool invocations logged to Loki
- ✅ P95 latency < 100ms
- ✅ 85%+ code coverage

### Operational Success
- ✅ No crashes on errors
- ✅ Graceful timeout enforcement
- ✅ Progress updates for long operations
- ✅ RBAC denials logged (audit trail)

### Quality Metrics
- ✅ Zero security vulnerabilities (RBAC bypass)
- ✅ Zero memory leaks (1000 invocations)
- ✅ 100% Loki event coverage

---

## Timeline

| Task | Duration | Dependencies | Deliverable |
|------|----------|--------------|-------------|
| **T1: MCP Execution** | 5 days | Sprints 57-59 | MCP tools execute, 10 tests |
| **T2: Internal Execution** | 3 days | T1 | Internal tools execute, 5 tests |
| **T3: Composition Execution** | 4 days | T1, T2 | Compositions execute, 8 tests |
| **T4: Event Logging** | 2 days | T1, T2, T3 | 100% Loki coverage |
| **T5: Error Handling** | 2 days | T1, T2, T3 | Graceful failures, 10 tests |
| **T6: Feedback Middleware** | 1 day | T1, T2 | Progress updates working |
| **T7: Comprehensive Testing** | 3 days | All tasks | 35+ tests, integration |

**Total**: 20 days (4 weeks with parallel execution)
**Critical Path**: T1 → T3 → T7

---

## Next Sprint Preview

**Sprint 61** (after Sprint 60 complete):
- Composition RBAC registration validation
- End-to-end integration testing (5 scenarios)
- Load testing (1000 invocations, P95 < 100ms)
- Migration script (tool-gateway → tool-orchestrator)
- Cutover preparation (feature flag, runbook)

---

## Approval Checklist

Before starting implementation:
- [ ] User reviewed and approved this plan
- [ ] All prerequisites validated (Sprints 57-59 complete)
- [ ] Agent-dev environment available
- [ ] Loki accessible for event logging
- [ ] Test strategy approved

**Status**: ⏳ Awaiting User Approval

---

**Document Version**: 1.0
**Last Updated**: 2026-11-11
**Approver**: christophernavta
