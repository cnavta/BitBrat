# Revised Tool-Orchestrator Implementation Plan
**Date**: 2026-11-11
**Status**: Active - Gap Analysis & Recovery Plan
**Context**: Sprint 59 Complete, Execution Logic Missing

---

## Executive Summary

This revised plan addresses the gap between the original Sprint 56 implementation plan and actual progress. While Sprints 57-59 successfully delivered foundation infrastructure, RBAC validation, and observability, the **core tool execution logic was not migrated from tool-gateway**. This plan provides a realistic path to complete the tool-orchestrator migration.

### Gap Analysis

| Component | Original Plan | Actual Status | Gap |
|-----------|--------------|---------------|-----|
| **ToolRegistry Module** | Sprint 57 | ✅ Complete | None |
| **ModelRegistry Module** | Sprint 57 | ✅ Complete | None |
| **RBAC Validation** | Sprint 58 | ✅ Complete | None |
| **ToolObserver Module** | Sprint 59 | ✅ Complete | None |
| **Loki Integration** | Sprint 59 | ✅ Complete | None |
| **MCP Tool Execution** | Sprint 58 | ❌ Placeholder | **MISSING** |
| **Internal Tool Execution** | Sprint 58 | ❌ Placeholder | **MISSING** |
| **Composition Execution** | Sprint 58 | ❌ Placeholder | **MISSING** |
| **Composition RBAC** | Sprint 60 | ⏳ Not Started | Blocked by execution |
| **Validation & Cutover** | Sprint 61 | ⏳ Not Started | Blocked by execution |
| **Documentation** | Sprint 62 | ⏳ Not Started | Blocked by cutover |

### Root Cause

Sprint 58 focused exclusively on RBAC validation (67 tests, comprehensive coverage) but intentionally left execution logic as placeholders with the comment:

```typescript
throw new Error('MCP tool execution not yet implemented - Sprint 58 focuses on RBAC validation');
```

This was a reasonable incremental approach, but created a gap between RBAC (complete) and execution (missing).

---

## Revised Timeline

**Completed Sprints**: 57, 58, 59 (3 sprints)
**Remaining Sprints**: 60, 61, 62 (3 sprints)
**New Sprint**: **Sprint 60 (revised)** - Tool Execution Migration
**Total Duration**: 6 sprints (same as original plan)

| Sprint | Focus | Duration | Status |
|--------|-------|----------|--------|
| **57** | Foundation (ToolRegistry, ModelRegistry) | 2-3 weeks | ✅ Complete |
| **58** | Model-Based RBAC Validation | 2-3 weeks | ✅ Complete |
| **59** | Observability (ToolObserver + Loki) | 1.5-2 weeks | ✅ Complete |
| **60** | **Tool Execution Migration** (NEW FOCUS) | **2-3 weeks** | ⏳ Next |
| **61** | Composition RBAC + Validation | 2-3 weeks | ⏳ Pending |
| **62** | Cutover + Documentation | 1-2 weeks | ⏳ Pending |

**Revised Completion Target**: End of Q1 2027 (unchanged)

---

## Sprint 60 (Revised): Tool Execution Migration

**Duration**: 2-3 weeks
**Goal**: Migrate actual tool execution logic from tool-gateway to tool-orchestrator
**Prerequisites**: Sprints 57, 58, 59 complete ✅

### Deliverables

1. **MCP Tool Execution** - Execute tools on external MCP servers
2. **Internal Tool Execution** - Execute BitBrat internal tools
3. **Composition Execution** - Execute multi-step compositions
4. **McpClientManager Integration** - Migrate MCP client lifecycle management
5. **Event Logging** - Structured logging to Loki for all executions
6. **Error Handling** - Timeout enforcement, retry logic, graceful failures
7. **Progress Updates** - Integration with feedback middleware for long operations
8. **Comprehensive Tests** - 30+ tests covering all execution paths

### Tasks

#### T1: Migrate MCP Tool Execution (5 days)

**Current State**: tool-gateway.ts has working MCP execution logic (~200 lines)
**Target**: tool-orchestrator ToolGateway module

**Implementation Steps**:

1. **Extract MCP execution from tool-gateway.ts** (1 day)
   - Read `src/apps/tool-gateway.ts` lines 200-400 (MCP execution section)
   - Identify dependencies: McpClientManager, timeout logic, error handling
   - Document execution flow

2. **Implement in ToolGateway module** (2 days)
   ```typescript
   // src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts

   private async executeMcpTool(
     tool: ToolRegistryDocument,
     args: any,
     context: ToolExecutionContext,
     timeoutMs: number
   ): Promise<ToolResult> {
     // 1. Get MCP client for tool's origin server
     const client = await this.mcpClientManager.getClient(tool.metadata.mcpServer);

     // 2. Create timeout controller
     const controller = new AbortController();
     const timeout = setTimeout(() => controller.abort(), timeoutMs);

     try {
       // 3. Call MCP tool
       const result = await client.callTool({
         name: tool.name,
         arguments: args
       }, { signal: controller.signal });

       // 4. Log success event to Loki
       await this.logToolInvocation({
         toolId: tool.id,
         modelId: context.modelId,
         status: 'success',
         durationMs: Date.now() - startTime,
         ...context
       });

       return result;
     } catch (err) {
       // 5. Log error event to Loki
       await this.logToolInvocation({
         toolId: tool.id,
         modelId: context.modelId,
         status: 'error',
         errorMessage: err.message,
         ...context
       });
       throw err;
     } finally {
       clearTimeout(timeout);
     }
   }
   ```

3. **Integrate McpClientManager** (1 day)
   - Move `src/common/mcp/client-manager.ts` to tool-orchestrator module
   - Update imports and dependencies
   - Ensure lifecycle management (connect/disconnect)

4. **Add timeout enforcement** (0.5 days)
   - Respect tool.timeout field (default: 30s)
   - Graceful abort on timeout
   - Clear error messages

5. **Test MCP execution** (0.5 days)
   - Unit tests: 10 scenarios (success, timeout, error, retry)
   - Integration test: Deploy to agent-dev, call external MCP server
   - Verify Loki logging

**Files Modified**:
- `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (~150 lines added)
- `src/apps/tool-orchestrator-service/modules/gateway/mcp-client-manager.ts` (migrated)

**Acceptance Criteria**:
- ✅ MCP tools execute successfully
- ✅ Timeout enforcement working
- ✅ Error handling graceful
- ✅ Events logged to Loki
- ✅ 10+ tests passing

---

#### T2: Migrate Internal Tool Execution (3 days)

**Current State**: tool-gateway.ts has internal tool routing (~100 lines)
**Target**: tool-orchestrator ToolGateway module

**Implementation Steps**:

1. **Extract internal tool execution** (0.5 days)
   - Identify internal tool execution logic in tool-gateway.ts
   - Document BitBrat internal tool interface

2. **Implement in ToolGateway** (1.5 days)
   ```typescript
   private async executeInternalTool(
     tool: ToolRegistryDocument,
     args: any,
     context: ToolExecutionContext
   ): Promise<ToolResult> {
     // 1. Resolve internal tool handler
     const handler = await this.resolveInternalHandler(tool.id);

     // 2. Execute with context
     const result = await handler.execute(args, context);

     // 3. Log to Loki
     await this.logToolInvocation({
       toolId: tool.id,
       modelId: context.modelId,
       status: 'success',
       ...context
     });

     return result;
   }
   ```

3. **Add internal tool registry** (0.5 days)
   - Map of toolId → handler function
   - Register built-in tools (agent.sendProgressUpdate, etc.)

4. **Test internal execution** (0.5 days)
   - Unit tests: 5 scenarios
   - Verify agent.sendProgressUpdate works

**Acceptance Criteria**:
- ✅ Internal tools execute successfully
- ✅ Progress updates work
- ✅ 5+ tests passing

---

#### T3: Migrate Composition Execution (4 days)

**Current State**: tool-gateway.ts has composition executor (~300 lines)
**Target**: tool-orchestrator ToolGateway module

**Implementation Steps**:

1. **Extract composition executor** (1 day)
   - Read `src/apps/tool-gateway.ts` composition execution
   - Identify dependencies: step sequencing, variable resolution

2. **Implement in ToolGateway** (2 days)
   ```typescript
   private async executeComposition(
     tool: ToolRegistryDocument, // Composition is a "tool" in registry
     args: any,
     context: ToolExecutionContext
   ): Promise<ToolResult> {
     // 1. Load composition definition
     const composition = await this.compositionRegistry.get(tool.id);

     // 2. Execute steps sequentially
     let state = { input: args };
     for (const step of composition.steps) {
       // 3. Validate RBAC for each constituent tool
       const access = await this.validateToolAccess(
         step.toolId,
         context.userRoles,
         context.modelId
       );

       if (!access.allowed) {
         throw new Error(`RBAC denied for step ${step.name}: ${access.reason}`);
       }

       // 4. Execute step (recursive call to execute())
       const stepResult = await this.execute(
         step.toolId,
         step.args(state),
         context
       );

       // 5. Update state
       state = { ...state, [step.name]: stepResult };
     }

     return state;
   }
   ```

3. **Add composition RBAC validation** (0.5 days)
   - Validate each step against modelId
   - Prevent privilege escalation

4. **Test composition execution** (0.5 days)
   - Unit tests: 8 scenarios (success, RBAC denial, step failure)
   - Integration test: Multi-step composition

**Acceptance Criteria**:
- ✅ Compositions execute successfully
- ✅ Per-step RBAC validation
- ✅ 8+ tests passing

---

#### T4: Event Logging Integration (2 days)

**Goal**: Ensure all execution paths log to Loki

**Implementation**:

1. **Centralize logging** (1 day)
   ```typescript
   private async logToolInvocation(event: {
     toolId: string;
     modelId: string;
     status: 'success' | 'error' | 'denied';
     durationMs?: number;
     errorMessage?: string;
     userId?: string;
     correlationId?: string;
   }): Promise<void> {
     this.logger.info({
       service: 'tool-orchestrator',
       level: event.status === 'error' ? 'error' : 'info',
       eventType: 'tool.invocation',
       toolId: event.toolId,
       modelId: event.modelId,
       status: event.status,
       correlationId: event.correlationId,
       timestamp: new Date().toISOString(),
       durationMs: event.durationMs,
       errorMessage: event.errorMessage,
       userId: event.userId,
     });
   }
   ```

2. **Add to all execution paths** (0.5 days)
   - MCP execution: log start + end
   - Internal execution: log start + end
   - Composition execution: log start + end + each step
   - RBAC denial: log denial reason

3. **Verify Loki ingestion** (0.5 days)
   - Deploy to agent-dev
   - Execute 20 tools
   - Query Loki for events
   - Verify all 20 logged

**Acceptance Criteria**:
- ✅ 100% tool invocations logged
- ✅ All execution paths covered
- ✅ Loki queries return accurate data

---

#### T5: Error Handling & Recovery (2 days)

**Goal**: Graceful failure handling for all execution types

**Implementation**:

1. **Timeout enforcement** (0.5 days)
   - AbortController for all async operations
   - Configurable timeouts per tool
   - Clear timeout error messages

2. **Retry logic** (0.5 days)
   ```typescript
   private async executeWithRetry<T>(
     fn: () => Promise<T>,
     maxRetries: number = 3
   ): Promise<T> {
     for (let attempt = 0; attempt < maxRetries; attempt++) {
       try {
         return await fn();
       } catch (err) {
         if (attempt === maxRetries - 1) throw err;
         await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
       }
     }
   }
   ```

3. **Graceful degradation** (0.5 days)
   - MCP server unavailable → Return clear error
   - Internal tool missing → Return error, don't crash
   - Composition step fails → Rollback, log state

4. **Test error scenarios** (0.5 days)
   - Unit tests: 10 error scenarios
   - Verify error messages clear

**Acceptance Criteria**:
- ✅ Timeouts enforced
- ✅ Retry logic working
- ✅ No crashes on errors
- ✅ 10+ error tests passing

---

#### T6: Integration with Feedback Middleware (1 day)

**Goal**: Support long-running operations (Sprint 36 pattern)

**Implementation**:

1. **Detect long operations** (0.5 days)
   - Check for `operation_context` annotation
   - Call feedbackMiddleware.startTracking()

2. **Auto-complete on finish** (0.5 days)
   - Middleware detects `next()` call
   - Automatically calls completeOperation()

**Acceptance Criteria**:
- ✅ Long operations send progress updates
- ✅ No manual middleware calls needed

---

#### T7: Comprehensive Testing (3 days)

**Goal**: 30+ tests covering all execution paths

**Test Coverage**:

**MCP Execution (10 tests)**:
- MCP tool success
- MCP tool timeout
- MCP tool error
- MCP server unavailable
- MCP tool retry (transient failure)
- MCP tool with progress updates
- MCP tool RBAC denial
- MCP tool missing
- MCP tool argument validation
- MCP tool response parsing

**Internal Execution (5 tests)**:
- Internal tool success
- Internal tool error
- Internal handler missing
- Progress update tool
- Internal tool RBAC denial

**Composition Execution (10 tests)**:
- Simple composition (2 steps)
- Complex composition (5 steps)
- Composition with variable passing
- Composition RBAC denial (step 2)
- Composition step timeout
- Composition step error (rollback)
- Composition with conditional logic
- Nested composition
- Composition with parallel steps
- Composition state management

**Error Handling (5 tests)**:
- Timeout enforcement
- Retry logic (3 attempts)
- Graceful degradation
- Error message clarity
- Loki logging on errors

**Integration Tests (5 tests)**:
- End-to-end: User message → llm-bot → MCP tool → response
- End-to-end: User message → llm-bot → composition → response
- RBAC denial flow
- Progress update flow (30s operation)
- Model upgrade flow (basic → premium)

**Performance Tests (2 tests)**:
- P95 execution latency < 100ms (excluding MCP call time)
- No memory leaks (1000 invocations)

**Acceptance Criteria**:
- ✅ 35+ tests passing
- ✅ 85%+ code coverage
- ✅ All execution paths tested
- ✅ Performance targets met

---

### Sprint 60 Summary

**Total Duration**: 2-3 weeks (12-15 working days)

**Task Breakdown**:
1. T1: MCP Tool Execution (5 days)
2. T2: Internal Tool Execution (3 days)
3. T3: Composition Execution (4 days)
4. T4: Event Logging (2 days)
5. T5: Error Handling (2 days)
6. T6: Feedback Middleware (1 day)
7. T7: Comprehensive Testing (3 days)

**Total**: 20 days (4 weeks with testing overlap)

**Critical Path**: T1 → T3 → T7 (MCP execution required for compositions, testing validates all)

**Acceptance Criteria**:
- ✅ All execution types working (MCP, internal, composition)
- ✅ 35+ tests passing
- ✅ Event logging to Loki
- ✅ Error handling graceful
- ✅ RBAC enforced on all paths
- ✅ Integration tests pass in agent-dev

---

## Sprint 61 (Revised): Composition RBAC + Validation

**Duration**: 2-3 weeks
**Goal**: Complete composition RBAC integration and comprehensive validation
**Prerequisites**: Sprint 60 complete

### Changes from Original Plan

**Original Sprint 60** (Composition RBAC) + **Original Sprint 61** (Validation & Cutover) are now combined into **Revised Sprint 61**.

**Why**: Sprint 60 execution migration unlocks both composition RBAC and validation testing simultaneously.

### Deliverables

1. **Composition RBAC Registration Validation** - Validate model permissions at composition registration time
2. **Composition RBAC Runtime Validation** - Re-validate at execution time against invoking model
3. **RBAC Inheritance Logic** - Compositions inherit most restrictive RBAC from constituent tools
4. **End-to-End Validation** - 5 integration scenarios tested in agent-dev
5. **Load Testing** - 1000 invocations, P95 < 100ms
6. **Migration Script** - tool-gateway → tool-orchestrator migration automation
7. **Production Readiness** - Cutover preparation (NOT execution)

### Tasks

#### T1: Composition Registration RBAC (3 days)

**Implementation**:

```typescript
async registerComposition(
  definition: CompositionDefinition,
  registeringModelId: string,
  userRoles: string[]
): Promise<void> {
  // 1. Extract all tool IDs from composition steps
  const toolIds = this.extractToolIds(definition.spec.steps);

  // 2. Validate MODEL has access to ALL constituent tools
  for (const toolId of toolIds) {
    const access = await this.toolGateway.validateToolAccess(
      toolId,
      userRoles,
      registeringModelId
    );

    if (!access.allowed) {
      throw new Error(
        `Model ${registeringModelId} lacks access to tool ${toolId}: ${access.reason}`
      );
    }
  }

  // 3. Calculate RBAC inheritance
  const inheritedRbac = await this.calculateInheritedRbac(toolIds);

  // 4. Store composition with metadata
  await this.compositionRegistry.register({
    ...definition,
    registeredBy: registeringModelId,
    rbacValidatedAt: new Date().toISOString(),
    rbac: inheritedRbac
  });
}
```

**Acceptance Criteria**:
- ✅ Registration fails if model lacks tool access
- ✅ RBAC inherited from constituent tools
- ✅ Metadata stored (registeredBy, rbacValidatedAt)

---

#### T2: Composition Runtime RBAC (2 days)

**Implementation**:

- Already implemented in Sprint 60 T3 (composition execution validates each step)
- Add tests to verify runtime re-validation
- Ensure invoking model (not registering model) is checked

**Acceptance Criteria**:
- ✅ Runtime re-validation against invoking model
- ✅ Denies if invoking model lacks access

---

#### T3: RBAC Inheritance Logic (2 days)

**Implementation**:

```typescript
private async calculateInheritedRbac(
  toolIds: string[]
): Promise<ToolRbacConfig> {
  const tools = await Promise.all(
    toolIds.map(id => this.toolRegistry.getTool(id))
  );

  return {
    // Union of all required roles (need ALL)
    userRoles: {
      required: [...new Set(tools.flatMap(t => t.rbac.userRoles.required))],
      denied: [] // Empty (can't inherit denials)
    },

    // Intersection of allowed tiers (most restrictive)
    modelTiers: {
      allowed: this.intersectTiers(tools.map(t => t.rbac.modelTiers.allowed)),
      denied: []
    },

    // Union of model required roles
    modelRoles: {
      required: [...new Set(tools.flatMap(t => t.rbac.modelRoles.required))],
      denied: []
    },

    // Highest trust threshold across all tools
    minTrustThresholds: this.mergeMinTrustThresholds(tools)
  };
}
```

**Acceptance Criteria**:
- ✅ Composition inherits most restrictive RBAC
- ✅ Union of required roles
- ✅ Intersection of allowed tiers

---

#### T4: End-to-End Validation (5 days)

**Test Scenarios**:

1. **Happy Path** (1 day)
   - User message → llm-bot → tool execution → response
   - Verify: Tool executes, response received, Loki logged

2. **RBAC Denial** (1 day)
   - Basic model tries premium tool → Denied
   - Verify: Clear error message, Loki logged denial

3. **Tool Import** (1 day)
   - New MCP server → Auto-import → Tools available
   - Verify: tool.list returns new tool

4. **Composition RBAC** (1 day)
   - Register composition → Validate constituent tools
   - Execute composition → Runtime re-validation
   - Verify: RBAC enforced at both stages

5. **Model Upgrade** (1 day)
   - User switches to premium model → More tools available
   - Verify: tool.list filtered by model tier

**Acceptance Criteria**:
- ✅ All 5 scenarios pass in agent-dev
- ✅ Loki contains all events
- ✅ No regressions

---

#### T5: Load Testing (3 days)

**Load Profile**:
- 1000 tool invocations across 10 models
- 100 composition executions
- 50 concurrent requests

**Metrics**:
- P95 tool registry lookup < 10ms
- P95 RBAC validation < 1ms
- P95 end-to-end tool invocation < 100ms
- Loki ingestion keeps up
- No memory leaks

**Implementation**:

```typescript
// scripts/load-test-tool-orchestrator.ts
async function runLoadTest() {
  const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-opus-3.5', 'reflex'];
  const tools = await getAllTools();

  // Concurrent execution
  const promises = [];
  for (let i = 0; i < 1000; i++) {
    const model = models[i % models.length];
    const tool = tools[i % tools.length];

    promises.push(
      executeTool(tool.id, {}, { modelId: model, userRoles: ['user'] })
    );
  }

  const results = await Promise.allSettled(promises);

  // Analyze results
  const latencies = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.durationMs);

  console.log(`P50: ${percentile(latencies, 0.50)}ms`);
  console.log(`P95: ${percentile(latencies, 0.95)}ms`);
  console.log(`P99: ${percentile(latencies, 0.99)}ms`);
}
```

**Acceptance Criteria**:
- ✅ 1000 invocations complete
- ✅ P95 < 100ms
- ✅ No memory leaks
- ✅ Loki keeps up

---

#### T6: Migration Script (3 days)

**Script**: `scripts/migrate-to-tool-orchestrator.ts`

**Steps**:

1. **Export tool-gateway data** (1 day)
   ```typescript
   async function exportFromToolGateway() {
     // 1. Query tool-gateway MCP client
     const tools = await toolGatewayClient.callTool('tool.list', {});

     // 2. Transform to ToolRegistryDocument format
     const documents = tools.map(transformToDocument);

     // 3. Export to JSON
     await fs.writeFile('migration/tools.json', JSON.stringify(documents));
   }
   ```

2. **Import to tool-orchestrator** (1 day)
   ```typescript
   async function importToToolOrchestrator() {
     // 1. Load JSON
     const tools = JSON.parse(await fs.readFile('migration/tools.json'));

     // 2. Bulk insert to PostgreSQL
     for (const tool of tools) {
       await toolRegistry.registerTool(tool);
     }

     // 3. Verify import
     const count = await toolRegistry.queryTools({}).length;
     console.log(`Imported ${count} tools`);
   }
   ```

3. **Validation script** (0.5 days)
   ```typescript
   async function validateMigration() {
     // Compare tool counts
     const oldCount = await queryToolGateway();
     const newCount = await queryToolOrchestrator();

     if (oldCount !== newCount) {
       throw new Error(`Tool count mismatch: ${oldCount} vs ${newCount}`);
     }

     // Compare tool definitions
     // ... detailed validation
   }
   ```

4. **Rollback script** (0.5 days)
   ```bash
   #!/bin/bash
   # Revert architecture.yaml
   git checkout HEAD~1 -- architecture.yaml

   # Restart tool-gateway
   brat bit deploy tool-gateway --context local

   # Verify
   brat fleet health tool-gateway
   ```

**Acceptance Criteria**:
- ✅ Migration script runs successfully
- ✅ All tools migrated
- ✅ Validation passes
- ✅ Rollback script tested

---

#### T7: Cutover Preparation (2 days)

**NOT executing cutover yet** - just preparing:

1. **Feature flag implementation** (0.5 days)
   ```typescript
   // In llm-bot
   const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';

   if (useToolOrchestrator) {
     // Call tool-orchestrator
   } else {
     // Call tool-gateway (legacy)
   }
   ```

2. **Deployment plan documentation** (0.5 days)
   - Step-by-step cutover procedure
   - Monitoring checklist
   - Rollback triggers

3. **Runbook creation** (0.5 days)
   - Operational procedures
   - Troubleshooting guide
   - RBAC denial debugging

4. **Stakeholder communication** (0.5 days)
   - Cutover timeline
   - User impact assessment
   - Support team briefing

**Acceptance Criteria**:
- ✅ Feature flag implemented
- ✅ Deployment plan documented
- ✅ Runbook created
- ✅ Stakeholders informed

---

### Sprint 61 Summary

**Total Duration**: 2-3 weeks

**Tasks**:
1. T1: Composition Registration RBAC (3 days)
2. T2: Composition Runtime RBAC (2 days)
3. T3: RBAC Inheritance (2 days)
4. T4: End-to-End Validation (5 days)
5. T5: Load Testing (3 days)
6. T6: Migration Script (3 days)
7. T7: Cutover Preparation (2 days)

**Total**: 20 days (4 weeks with parallel execution)

**Acceptance Criteria**:
- ✅ Composition RBAC complete
- ✅ All integration tests pass
- ✅ Load test targets met
- ✅ Migration script validated
- ✅ Ready for cutover (Sprint 62)

---

## Sprint 62 (Revised): Cutover + Documentation + Cleanup

**Duration**: 1-2 weeks
**Goal**: Execute cutover, comprehensive documentation, remove tool-gateway
**Prerequisites**: Sprint 61 complete

### Deliverables

1. **Production Cutover** - Switch all services from tool-gateway to tool-orchestrator
2. **Zero-Downtime Migration** - Feature flag rollout, monitoring
3. **tool-gateway Deprecation** - Mark deprecated, schedule removal
4. **Comprehensive Documentation** - Implementation guide, API reference, migration runbook
5. **Code Cleanup** - Remove deprecated code, fix broken references
6. **Final Validation** - 1 week production monitoring

### Tasks

#### T1: Production Cutover (3 days)

**Day 1: Staging Deployment**
1. Deploy tool-orchestrator to staging
2. Enable feature flag: `ENABLE_TOOL_ORCHESTRATOR=true`
3. Monitor for 4 hours
4. Validate: tool.list, model.list, test message flow
5. Check Loki for errors

**Day 2: Production Deployment (Phased)**
1. Deploy tool-orchestrator to production
2. Enable feature flag for 10% of traffic
3. Monitor for 4 hours (error rates, RBAC denials)
4. Increase to 50% if stable
5. Monitor for 4 hours
6. Increase to 100% if stable

**Day 3: Final Validation**
1. Monitor for 24 hours at 100%
2. Validate all critical flows
3. Check RBAC denial rates (< 1% expected)
4. Verify Loki dashboards
5. Collect user feedback

**Rollback Trigger**:
- Error rate > 5%
- RBAC denial rate > 10%
- P95 latency > 200ms
- User complaints > 10

**Acceptance Criteria**:
- ✅ tool-orchestrator handling 100% traffic
- ✅ Error rate < 1%
- ✅ RBAC denial rate < 5%
- ✅ P95 latency < 100ms
- ✅ Zero user-facing incidents

---

#### T2: tool-gateway Deprecation (1 day)

1. **Mark deprecated in architecture.yaml** (0.5 days)
   ```yaml
   tool-gateway:
     status: deprecated
     deprecationDate: 2026-11-15
     removalDate: 2026-12-15
     replacedBy: tool-orchestrator
   ```

2. **Add deprecation notice** (0.5 days)
   - Update README.md
   - Add comment in tool-gateway.ts
   - Notify stakeholders

**Acceptance Criteria**:
- ✅ tool-gateway marked deprecated
- ✅ Removal date scheduled (30 days)
- ✅ Stakeholders notified

---

#### T3: Documentation (4 days)

**1. Implementation Guide** (1.5 days)

Create `documentation/guides/tool-orchestrator.md`:

```markdown
# Tool-Orchestrator Implementation Guide

## Overview
tool-orchestrator is the central tool execution service for BitBrat Platform, replacing the legacy tool-gateway.

## Architecture
- **ToolRegistry Module**: Persistent tool storage (PostgreSQL)
- **ModelRegistry Module**: Model catalog with RBAC profiles
- **ToolObserver Module**: Loki-based metrics and observability
- **ToolGateway Module**: Execution orchestration with dual-layer RBAC

## RBAC Model
### Dual-Layer Validation
Effective Access = User Permissions ∩ Model Permissions

### Model Tiers
- free: Free tier models
- basic: Basic tier (e.g., gpt-3.5-turbo)
- premium: Premium tier (e.g., gpt-4)
- enterprise: Enterprise tier
- deterministic: Rule-based agents (e.g., reflex)
- system: Platform agents

### Trust Scores
4 dimensions: reliability, fidelity, integrity, calibration

## Observability
### Loki Events
- tool.invocation - Every tool execution
- Labels: service, toolId, modelId, status, correlationId

### Grafana Dashboards
- Tool Invocation Rate
- Error Rate & Latency
- RBAC Denials
- Cost Tracking

## Troubleshooting
### RBAC Denials
Query: `{service="tool-orchestrator", status="denied"}`

Debug tool: `tool.explain_access(toolId, userId, modelId)`

### Performance Issues
Check cache hit ratio, PostgreSQL slow queries
```

**2. API Reference** (1.5 days)

Create `documentation/reference/tool-orchestrator-api.md`:

```markdown
# Tool-Orchestrator API Reference

## MCP Tools (Platform-Only)

### Tool Management
- `tool.list` - List all tools (RBAC-filtered)
- `tool.get` - Get single tool metadata
- `tool.import` - Import tool from MCP server
- `tool.update_config` - Update tool configuration
- `tool.deprecate` - Mark tool deprecated
- `tool.disable` - Disable tool
- `tool.get_metrics` - Query Loki for tool metrics
- `tool.get_health` - Derive health from recent events

### Model Management
- `model.list` - List all models
- `model.get` - Get single model
- `model.register` - Register new model
- `model.update` - Update model metadata
- `model.get_trust_scores` - Get trust scores

### Observability
- `observer.tool_metrics` - Query Loki
- `observer.model_metrics` - Query Loki
- `observer.trace_correlation` - Trace by correlationId

## TypeScript Interfaces
... (full interface definitions)

## Error Codes
... (comprehensive error catalog)
```

**3. Migration Runbook** (0.5 days)

Create `documentation/guides/migrate-to-tool-orchestrator.md`:

```markdown
# Migration Runbook: tool-gateway → tool-orchestrator

## Prerequisites
- PostgreSQL accessible
- Loki/Promtail operational
- Model registry seeded

## Migration Steps
1. Run migration script
2. Validate tool count
3. Enable feature flag (10%)
4. Monitor for 4 hours
5. Increase to 100%
6. Deprecate tool-gateway

## Validation
- Compare tool counts
- Test RBAC scenarios
- Check Loki events

## Rollback
- Disable feature flag
- Restart tool-gateway
- Verify stability
```

**4. Architecture Diagrams** (0.5 days)

Update `documentation/architecture/tool-orchestrator-architecture.md` with module diagrams.

**Acceptance Criteria**:
- ✅ All 4 documents complete
- ✅ Peer-reviewed
- ✅ Accurate and comprehensive

---

#### T4: Code Cleanup (2 days)

**1. Remove tool-gateway** (1 day)
- Delete `src/apps/tool-gateway.ts`
- Delete old in-memory ToolRegistry
- Update architecture.yaml
- Update docker-compose.yaml

**2. Fix broken references** (0.5 days)
- Search for imports of deleted files
- Update or remove

**3. Validation** (0.5 days)
- Run `npm run build`
- Run `npm test`
- Verify no broken imports

**Acceptance Criteria**:
- ✅ tool-gateway removed
- ✅ No broken references
- ✅ Build successful
- ✅ All tests passing

---

#### T5: Final Monitoring (1 week)

**Monitor for 7 days**:
- Error rates (target: < 1%)
- RBAC denial rates (target: < 5%)
- P95 latency (target: < 100ms)
- User complaints (target: 0)
- Loki ingestion (target: 100% coverage)

**Daily checklist**:
- Review Grafana dashboards
- Check RBAC denial reasons
- Scan error logs
- Respond to user feedback

**Success criteria**:
- ✅ 7 days stable
- ✅ No critical incidents
- ✅ Performance targets met

---

### Sprint 62 Summary

**Total Duration**: 1-2 weeks (plus 1 week monitoring)

**Tasks**:
1. T1: Production Cutover (3 days)
2. T2: tool-gateway Deprecation (1 day)
3. T3: Documentation (4 days)
4. T4: Code Cleanup (2 days)
5. T5: Final Monitoring (7 days)

**Acceptance Criteria**:
- ✅ tool-orchestrator handling 100% traffic
- ✅ tool-gateway deprecated and removed
- ✅ All documentation complete
- ✅ 7 days stable production operation
- ✅ Zero user-facing incidents

---

## Comparison: Original vs Revised Plan

| Aspect | Original Plan (Sprint 56) | Actual Progress | Revised Plan |
|--------|--------------------------|-----------------|--------------|
| **Sprint 57** | Foundation | ✅ Complete | ✅ Complete |
| **Sprint 58** | RBAC + Execution | ⚠️ RBAC only (execution missing) | ✅ Complete (RBAC) |
| **Sprint 59** | Observability | ✅ Complete | ✅ Complete |
| **Sprint 60** | Composition RBAC | ⏳ Not Started | **NEW: Tool Execution Migration** |
| **Sprint 61** | Validation & Cutover | ⏳ Not Started | **Composition RBAC + Validation** |
| **Sprint 62** | Documentation | ⏳ Not Started | **Cutover + Documentation** |
| **Total Sprints** | 6 sprints | 3 complete | 6 sprints (unchanged) |
| **Completion** | End of Q1 2027 | ~50% complete | End of Q1 2027 (unchanged) |

---

## Risk Assessment (Updated)

### High Risk (Mitigated)

**1. Execution Logic Migration Complexity**
- **Risk**: Migrating 500+ lines of execution logic introduces bugs
- **Mitigation**:
  - Extract code in small chunks (MCP → Internal → Composition)
  - Comprehensive testing (35+ tests)
  - Parallel operation with tool-gateway (feature flag)
- **Status**: Managed via incremental approach

**2. Performance Regression**
- **Risk**: New execution path slower than tool-gateway
- **Mitigation**:
  - LRU cache (already 99% hit ratio)
  - Load testing (1000 invocations)
  - Performance benchmarks (P95 < 100ms)
- **Status**: Mitigated via testing

### Medium Risk

**3. Production Cutover Issues**
- **Risk**: Unexpected errors during cutover
- **Mitigation**:
  - Phased rollout (10% → 50% → 100%)
  - Feature flag for instant rollback
  - 24-hour monitoring window
- **Status**: Managed via phased approach

**4. RBAC Denial Rate**
- **Risk**: Too many legitimate requests denied
- **Mitigation**:
  - Monitor denial reasons
  - Debug tool (`tool.explain_access`)
  - Ability to loosen RBAC quickly
- **Status**: Monitored continuously

---

## Success Metrics (Updated)

### Implementation Success

**Sprint 60 (Execution Migration)**:
- ✅ All execution types working (MCP, internal, composition)
- ✅ 35+ tests passing
- ✅ 100% tool invocations logged to Loki
- ✅ P95 latency < 100ms

**Sprint 61 (Validation)**:
- ✅ All integration tests pass
- ✅ Load test: 1000 invocations, P95 < 100ms
- ✅ Migration script validated
- ✅ Composition RBAC enforced

**Sprint 62 (Cutover)**:
- ✅ tool-orchestrator handling 100% traffic
- ✅ tool-gateway removed
- ✅ All documentation complete
- ✅ 7 days stable production

### Operational Success (Post-Launch)

**Performance**:
- P95 tool execution < 100ms
- P95 RBAC validation < 1ms (already achieved: 0.002ms)
- Cache hit ratio > 90% (already achieved: 99%)

**Reliability**:
- Error rate < 1%
- RBAC denial rate < 5%
- 100% tool invocations logged

**Security**:
- 0 privilege escalation incidents
- 0 RBAC bypass incidents
- All denials logged and auditable

---

## Conclusion

This revised plan provides a realistic path to complete the tool-orchestrator migration by addressing the execution logic gap discovered after Sprint 59. The plan maintains the original 6-sprint timeline while reorganizing sprint focuses to account for actual progress.

**Key Changes**:
1. **Sprint 60 (Revised)**: Focus on tool execution migration (was "Composition RBAC")
2. **Sprint 61 (Revised)**: Combine composition RBAC + validation (was separate sprints)
3. **Sprint 62 (Revised)**: Cutover + documentation (same as original)

**Remaining Work**: 3 sprints (60, 61, 62) estimated at 6-8 weeks total

**Completion Target**: End of Q1 2027 (unchanged from original plan)

---

**Document Status**: Active Recovery Plan
**Next Sprint**: Sprint 60 - Tool Execution Migration
**Approval**: Pending User Review
