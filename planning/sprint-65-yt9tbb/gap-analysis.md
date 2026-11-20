# Sprint 65: Tool Execution Migration - Gap Analysis

**Created**: 2026-11-15
**Author**: Implementation Team
**Status**: Draft v1
**Sprint**: sprint-65-yt9tbb

---

## Executive Summary

This document provides a comprehensive line-by-line comparison of `tool-gateway.ts` (legacy) vs `tool-orchestrator` (new) to identify functionality gaps, migration risks, and missing features before completing the tool execution migration.

### Key Findings

| Category | Status | Risk Level | Action Required |
|----------|--------|------------|-----------------|
| **Core Tool Execution** | ✅ Complete | Low | Validation testing |
| **RBAC Validation** | ✅ Complete | Low | Integration tests |
| **MCP Client Management** | ⚠️ Not Initialized | **HIGH** | Wire up McpClientManager |
| **Composition Execution** | 🟡 Partial | **CRITICAL** | Missing admin tools, hot-reload |
| **Session Management** | ❌ Missing | Medium | Evaluate necessity |
| **Internal Tools** | 🟡 Partial | Medium | Port composition.* tools |
| **Progress Updates** | 🟡 Simplified | Low | Add claim check integration |
| **Caching** | ✅ Better | Low | None (improvement) |
| **Retry Logic** | ✅ Better | Low | None (improvement) |
| **Event Logging** | ✅ Better | Low | None (improvement) |

**Overall Assessment**: Tool-orchestrator has **7 P0/P1 gaps** that must be addressed before production migration.

---

## Architecture Comparison

### tool-gateway.ts (Legacy)

```typescript
class ToolGatewayServer extends Bit {
  private registry = new ToolRegistry();              // In-memory tool registry
  private mcpManager = new McpClientManager(...);     // MCP client pool
  private registryWatcher?: RegistryWatcher;          // Firestore watcher for Bit registration
  private compositionRegistry?: CompositionRegistry;  // PostgreSQL-backed compositions
  private compositionExecutor?: CompositionExecutor;  // Composition execution engine
  private compositionWatcher?: CompositionWatcher;    // Hot-reload for compositions
  private sessionContexts: Map<...>;                  // Active MCP sessions
  private sessionServers: Map<...>;                   // Session-based MCP servers
  private contextProviders: Map<...>;                 // Just-in-Time context provisioning
  private inFlightRequests: Map<...>;                 // Request deduplication
  private rbac = new RbacEvaluator();                 // RBAC validation
}
```

**Characteristics**:
- Stateful service (session management)
- Extensive composition subsystem
- Firestore/PostgreSQL dual support
- Hot-reload capabilities
- Request deduplication
- Context provisioning

### tool-orchestrator (New)

```typescript
class ToolOrchestratorServer extends Bit {
  private toolRegistry?: ToolRegistry;       // PostgreSQL-backed tool registry
  private modelRegistry?: ModelRegistry;     // PostgreSQL-backed model registry
  private toolObserver?: ToolObserver;       // Loki integration for metrics
  private healthUpdater?: HealthUpdater;     // Background health monitoring
  private toolGateway?: ToolGateway;         // Execution module
  private toolCache: ToolRegistryDocument[]; // In-memory cache (eager-loaded)
}

class ToolGateway {
  private toolRegistry: IToolRegistry;
  private modelRegistry: IModelRegistry;
  private rbacValidator: RbacValidator;
  private mcpClientManager?: McpClientManager;  // ⚠️ OPTIONAL - not initialized
  private toolCache: LRUCache<...>;             // LRU cache (5min TTL)
  private modelCache: LRUCache<...>;
  private internalTools: Map<...>;              // Internal tool handlers
}
```

**Characteristics**:
- Stateless execution module (ToolGateway)
- Persistent registries (PostgreSQL)
- LRU caching with TTL
- Retry logic with exponential backoff
- Structured event logging (Loki)
- **No composition admin tools**
- **No session management**
- **No hot-reload**

---

## Detailed Gap Analysis

### 1. MCP Client Management

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| McpClientManager initialization | ✅ Always | ❌ Optional, not initialized | **P0** | **CRITICAL** |
| Connection lifecycle | ✅ Auto-connect | ❌ N/A | **P0** | **CRITICAL** |
| RegistryWatcher integration | ✅ Yes | ❌ No | P1 | High |
| Upstream MCP tool execution | ✅ Yes | ⚠️ Exists but untested | **P0** | **CRITICAL** |

**Impact**: Without McpClientManager initialization, tool-orchestrator **cannot execute MCP tools** from upstream services (image-gen-mcp, story-engine-mcp). This is a **blocking issue** for migration.

**Location**:
- Legacy: `src/apps/tool-gateway.ts:135` (always initialized in constructor)
- New: `src/apps/tool-orchestrator-service.ts:70` (passed as `undefined`)

**Remediation** (Task 1.2):
```typescript
// src/apps/tool-orchestrator-service.ts
public async setup(): Promise<void> {
  // ... existing setup ...

  // Initialize MCP Client Manager
  const mcpClientManager = new McpClientManager(this as any, this.toolRegistry);

  // Pass to ToolGateway
  this.toolGateway = new ToolGateway(
    this.toolRegistry,
    this.modelRegistry,
    { /* config */ },
    mcpClientManager,  // ← FIX: Wire up MCP client manager
    this.getLogger() as any
  );
}
```

---

### 2. Composition Subsystem

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| CompositionRegistry | ✅ PostgreSQL-backed | ❌ Not initialized | **P0** | **CRITICAL** |
| CompositionExecutor | ✅ Full support | ⚠️ Basic support | P1 | High |
| composition.register | ✅ MCP tool | ❌ Missing | **P0** | **CRITICAL** |
| composition.list | ✅ MCP tool | ❌ Missing | **P0** | **CRITICAL** |
| composition.get | ✅ MCP tool | ❌ Missing | **P0** | **CRITICAL** |
| composition.delete | ✅ MCP tool | ❌ Missing | **P0** | **CRITICAL** |
| composition.stats | ✅ MCP tool | ❌ Missing | P1 | High |
| composition.list_tools | ✅ MCP tool | ❌ Missing | P1 | High |
| Composition hot-reload | ✅ CompositionWatcher | ❌ Missing | P2 | Medium |
| Load compositions on startup | ✅ Yes | ❌ No | **P0** | **CRITICAL** |

**Impact**: Tool-orchestrator **completely lacks** the composition subsystem. LLMs cannot register, list, execute, or manage compositions via tool-orchestrator.

**Location**:
- Legacy: `src/apps/tool-gateway.ts:166-257` (initialization)
- Legacy: `src/apps/tool-gateway.ts:643-1413` (admin tools)
- New: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:867-992` (basic execution only)

**Affected Tools** (all missing from tool-orchestrator):
1. `composition.register` - Register new composition
2. `composition.list` - List all compositions
3. `composition.get` - Get composition by name/version
4. `composition.delete` - Delete composition
5. `composition.stats` - Get composition statistics
6. `composition.list_tools` - List available tools for authoring

**Remediation** (Task 1.3):
- Port CompositionRegistry initialization to tool-orchestrator-service.ts
- Port all 6 composition admin tools
- Add composition loading on startup (`loadCompositions()`)
- (Optional P2): Port CompositionWatcher for hot-reload

---

### 3. Internal Tools

| Tool | tool-gateway | tool-orchestrator | Gap | Severity |
|------|--------------|-------------------|-----|----------|
| agent.sendProgressUpdate | ✅ Full (claim check) | 🟡 Simplified | P1 | High |
| composition.register | ✅ Yes | ❌ No | **P0** | **CRITICAL** |
| composition.list | ✅ Yes | ❌ No | **P0** | **CRITICAL** |
| composition.get | ✅ Yes | ❌ No | **P0** | **CRITICAL** |
| composition.delete | ✅ Yes | ❌ No | **P0** | **CRITICAL** |
| composition.stats | ✅ Yes | ❌ No | P1 | High |
| composition.list_tools | ✅ Yes | ❌ No | P1 | High |

**Impact**: Tool-orchestrator is missing **6 composition admin tools** that LLMs actively use for composition management.

**agent.sendProgressUpdate Differences**:

**tool-gateway** (full implementation):
- Retrieves source event from claim check if `correlationId` provided
- Uses egress from source event (preserves exact routing)
- Fallback chain: claim check → args.egress → userId-based
- Creates full InternalEventV2 with routing slip
- Routes via `this.next()` for platform safeguards

**tool-orchestrator** (simplified):
- Validates args, builds progress message
- Returns acknowledgment string
- **Does NOT** retrieve from claim check
- **Does NOT** route via Bit.next()
- **Does NOT** deliver actual progress message to user

**Location**:
- Legacy: `src/apps/tool-gateway.ts:349-636` (full implementation)
- New: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:682-722` (placeholder)

**Remediation** (Task 1.3):
1. Port all 6 composition admin tools to tool-orchestrator
2. Enhance agent.sendProgressUpdate to match tool-gateway behavior:
   - Add claim check integration
   - Add Bit.next() routing
   - Add egress fallback chain

---

### 4. Session Management

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| sessionContexts tracking | ✅ Yes | ❌ No | P2 | Medium |
| sessionServers (MCP clients) | ✅ Yes | ❌ No | P2 | Medium |
| Session-based MCP endpoint | ✅ Yes | ❌ No | P2 | Medium |
| Broadcast list changed notifications | ✅ Yes | ❌ No | P2 | Medium |

**Impact**: Tool-orchestrator cannot track active MCP sessions or broadcast tool list changes when new tools are registered.

**Use Cases**:
- Track which MCP clients (llm-bot, reflex) are connected
- Broadcast `tools/list_changed` notifications when compositions are added/updated
- Associate tool calls with specific sessions for debugging

**Location**:
- Legacy: `src/apps/tool-gateway.ts:152-155` (session tracking)
- Legacy: `src/apps/tool-gateway.ts:277-289` (session-based MCP endpoint)

**Remediation**:
- **Decision needed**: Is session tracking required for tool-orchestrator?
- If yes: Port sessionContexts + sessionServers + broadcast logic
- If no: Document that tool-orchestrator is stateless (requires service restart for tool list updates)

**Recommendation**: Skip session management (P2 priority). Tool-orchestrator can be fully stateless. Tool list changes propagate via periodic cache refresh (60s interval).

---

### 5. Request Deduplication

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| inFlightRequests deduplication | ✅ Yes | ❌ No | P3 | Low |
| completedRequests cleanup | ✅ Yes | ❌ No | P3 | Low |

**Impact**: Tool-orchestrator may execute duplicate requests if MCP SDK sends duplicate messages.

**Location**:
- Legacy: `src/apps/tool-gateway.ts:158-161` (deduplication maps)

**Remediation**:
- **Decision needed**: Has the MCP SDK message duplication bug been fixed?
- If bug still exists: Port deduplication logic to ToolGateway
- If bug is fixed: No action needed

**Recommendation**: Skip for now (P3 priority). Monitor production logs for duplicate execution. Add if needed.

---

### 6. Context Provisioning

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| contextProviders (Just-in-Time) | ✅ Yes | ❌ No | P3 | Low |
| Registration signatures (heartbeat optimization) | ✅ Yes | ❌ No | P3 | Low |

**Impact**: Tool-orchestrator does not support Just-in-Time context provisioning for tool calls.

**Location**:
- Legacy: `src/apps/tool-gateway.ts:142-148` (context providers + signatures)

**Remediation**:
- **Decision needed**: Is JIT context provisioning still used?
- If yes: Port contextProviders logic
- If no: No action needed

**Recommendation**: Skip for now (P3 priority). Context provisioning is a specialized feature not critical for core tool execution.

---

### 7. Composition Execution (Detailed)

**tool-gateway executeComposition** (full-featured):
```typescript
private async executeComposition(composition, args, extra) {
  // 1. Extract constituent tools from composition metadata
  const constituentToolIds = composition.sourceMetadata.composition.toolIds;

  // 2. Pre-validate RBAC for EACH constituent tool (prevent privilege escalation)
  for (const constituentToolId of constituentToolIds) {
    const rbacResult = await this.validateToolAccess(
      constituentToolId,
      context.userId,
      context.modelId,  // ← Validates against INVOKING model
      context.userRoles
    );

    if (!rbacResult.allowed) {
      throw new Error(`Composition denied: ${rbacResult.reason}`);
    }
  }

  // 3. Execute composition using CompositionExecutor
  const result = await this.compositionExecutor.execute(composition, executionContext);

  // 4. Return formatted result
  return { content: [{ type: 'text', text: JSON.stringify(result.output) }] };
}
```

**tool-orchestrator executeComposition** (basic):
```typescript
private async executeComposition(tool, args, context) {
  // 1. Extract constituent tools from sourceMetadata.composition
  const composition = tool.sourceMetadata.composition;
  const constituentToolIds = composition.toolIds || [];

  // 2. ⚠️ NO PER-STEP RBAC VALIDATION (Sprint 65 Task 1.4)

  // 3. Execute based on strategy (sequential/parallel/conditional)
  switch (composition.strategy) {
    case 'sequential':
      return await this.executeSequential(constituentToolIds, args, context);
    case 'parallel':
      return await this.executeParallel(constituentToolIds, args, context);
    case 'conditional':
      throw new Error('Conditional composition not yet implemented');
  }
}
```

**Key Differences**:

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| Per-step RBAC validation | ✅ Pre-validates ALL steps | ❌ No validation | **P0** | **CRITICAL** |
| Composition loading | ✅ From CompositionRegistry | 🟡 From sourceMetadata only | P1 | High |
| Execution context | ✅ Full ExecutionContext | 🟡 Minimal ToolExecutionContext | P2 | Medium |
| Strategy support | ✅ All 3 (seq/par/cond) | 🟡 2 of 3 (no conditional) | P2 | Medium |
| Error handling | ✅ Detailed | ✅ Good | ✓ | - |

**Remediation** (Task 1.4):
Add per-step RBAC validation to tool-orchestrator ToolGateway:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts
private async executeComposition(tool, args, context) {
  const constituentToolIds = composition.toolIds || [];

  // ✅ NEW: Pre-validate RBAC for ALL constituent tools
  for (const constituentToolId of constituentToolIds) {
    const stepTool = await this.getToolCached(constituentToolId);
    const stepModel = await this.getModelCached(context.modelId);

    const rbacResult = this.rbacValidator.validateToolAccess(
      stepTool,
      context.userRoles,
      stepModel
    );

    if (!rbacResult.allowed) {
      throw new Error(
        `Composition step ${constituentToolId} RBAC denied: ${rbacResult.reason}`
      );
    }
  }

  // Execute composition...
}
```

---

### 8. RBAC Validation

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| Dual-layer RBAC (User × Model) | ✅ Yes | ✅ Yes | ✓ | - |
| Composition per-step RBAC | ✅ Yes | ❌ No | **P0** | **CRITICAL** |
| RBAC evaluator | ✅ RbacEvaluator | ✅ RbacValidator | ✓ | - |
| 5 RBAC dimensions | ✅ Yes | ✅ Yes | ✓ | - |

**Status**: Core RBAC validation is **equivalent**. Only gap is composition per-step RBAC (covered in Section 7).

---

### 9. Tool Execution Flow

**tool-gateway**:
```
1. Parse request → extract toolId, args, context
2. Get tool from ToolRegistry (in-memory)
3. Get model from ??? (not clear - may be missing)
4. RBAC validation (RbacEvaluator)
5. Route by source:
   - internal: Execute directly via ToolRegistry
   - mcp: Execute via McpClientManager
   - composition: Execute via CompositionExecutor
6. Log to Loki (if enabled)
7. Return result
```

**tool-orchestrator**:
```
1. Parse request → extract toolId, args, context
2. Get tool from ToolRegistry (PostgreSQL + LRU cache)
3. Get model from ModelRegistry (PostgreSQL + LRU cache)
4. RBAC validation (RbacValidator - dual-layer)
5. Route by source:
   - internal: Execute via internalTools map
   - mcp: Execute via McpClientManager + retry logic
   - composition: Execute sequential/parallel strategies
6. Log structured ToolInvocationEvent to Loki
7. Return result
```

**Differences**:

| Feature | tool-gateway | tool-orchestrator | Advantage |
|---------|--------------|-------------------|-----------|
| Tool lookup | In-memory (fast) | PostgreSQL + LRU cache (fast + persistent) | **tool-orchestrator** |
| Model lookup | Unclear | PostgreSQL + LRU cache | **tool-orchestrator** |
| Retry logic | None | Exponential backoff | **tool-orchestrator** |
| Event logging | Basic | Structured ToolInvocationEvent | **tool-orchestrator** |
| Caching | None | LRU with TTL | **tool-orchestrator** |

**Verdict**: Tool-orchestrator has **better** execution flow with persistent registries, caching, retry logic, and structured logging.

---

### 10. Error Handling & Resilience

| Feature | tool-gateway | tool-orchestrator | Gap | Severity |
|---------|--------------|-------------------|-----|----------|
| Timeout enforcement | ✅ Yes | ✅ Yes (AbortController) | ✓ | - |
| Retry with exponential backoff | ❌ No | ✅ Yes | ✓ | **tool-orchestrator better** |
| Transient error detection | ❌ No | ✅ Yes | ✓ | **tool-orchestrator better** |
| Graceful partial failure (parallel) | ❌ No | ✅ Promise.allSettled | ✓ | **tool-orchestrator better** |
| Error normalization | ✅ normalizeError() | ✅ normalizeError() | ✓ | - |

**Verdict**: Tool-orchestrator has **superior** error handling and resilience.

**tool-orchestrator advantages**:
- `executeWithRetry()` with exponential backoff (src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:520)
- `isTransientError()` detection (network, timeout, 5xx errors)
- `Promise.allSettled()` for parallel execution (captures both successes and failures)

---

## Summary of Gaps

### P0 Gaps (Blocking)

| Gap | Location | Impact | Task |
|-----|----------|--------|------|
| McpClientManager not initialized | tool-orchestrator-service.ts:70 | Cannot execute MCP tools | 1.2 |
| Composition admin tools missing | N/A | LLMs cannot manage compositions | 1.3 |
| Composition per-step RBAC missing | tool-gateway.ts:867 | Privilege escalation risk | 1.4 |
| CompositionRegistry not initialized | N/A | Cannot load compositions | 1.3 |
| Load compositions on startup missing | N/A | Compositions not available | 1.3 |

### P1 Gaps (High Priority)

| Gap | Location | Impact | Task |
|-----|----------|--------|------|
| agent.sendProgressUpdate simplified | tool-gateway.ts:682 | Progress messages not delivered | 1.3 |
| composition.stats missing | N/A | No composition metrics | 1.3 |
| composition.list_tools missing | N/A | Harder to author compositions | 1.3 |

### P2 Gaps (Medium Priority)

| Gap | Location | Impact | Task |
|-----|----------|--------|------|
| Session management missing | N/A | Cannot track MCP clients | - |
| Composition hot-reload missing | N/A | Requires service restart | - |
| Conditional composition strategy | tool-gateway.ts:1152 | One strategy unavailable | - |

### P3 Gaps (Low Priority)

| Gap | Location | Impact | Task |
|-----|----------|--------|------|
| Request deduplication missing | N/A | Potential duplicate execution | - |
| Context provisioning missing | N/A | No JIT context injection | - |

---

## Migration Risks

### High Risk

1. **MCP Tool Execution**: If McpClientManager is not initialized, tool-orchestrator **cannot execute ANY MCP tools**. This will cause immediate failures for image generation, story engine, and all other MCP-based services.

2. **Composition Management**: Missing composition admin tools means LLMs cannot register new compositions via tool-orchestrator. This breaks a core workflow.

3. **RBAC Bypass**: Lack of per-step composition RBAC validation creates a privilege escalation vulnerability where a low-trust model could execute high-privilege tools via composition.

### Medium Risk

1. **Progress Message Delivery**: Simplified agent.sendProgressUpdate doesn't actually deliver messages to users, breaking long-running operation UX.

2. **Composition Hot-Reload**: Missing hot-reload means composition changes require service restart, slowing development iteration.

### Low Risk

1. **Session Tracking**: Loss of session management means less visibility into active MCP clients, but doesn't impact functionality.

2. **Request Deduplication**: If MCP SDK still has duplication bug, may see duplicate executions, but this is rare.

---

## Recommendations

### Must-Fix Before Migration (P0)

1. **Task 1.2**: Initialize McpClientManager in tool-orchestrator (1 day)
2. **Task 1.3**: Port composition admin tools (2 days)
3. **Task 1.4**: Add composition per-step RBAC validation (2 days)

### Should-Fix Before Migration (P1)

1. **Task 1.3**: Enhance agent.sendProgressUpdate with claim check integration (1 day)
2. **Task 1.3**: Port composition.stats and composition.list_tools (0.5 day)

### Can-Defer (P2/P3)

1. Session management (evaluate need first)
2. Composition hot-reload (nice-to-have)
3. Request deduplication (monitor first)
4. Context provisioning (evaluate need first)

---

## Next Steps

1. **Stakeholder Review**: Present this gap analysis to Architecture Review Board for approval
2. **Task Prioritization**: Confirm P0/P1 priorities with product team
3. **Implementation**: Begin Task 1.2 (McpClientManager initialization)
4. **Testing**: Develop integration tests for each closed gap
5. **Documentation**: Update architecture.yaml and migration guide

---

## Appendix: File References

### Legacy (tool-gateway)
- Main service: `src/apps/tool-gateway.ts`
- Composition executor: `src/common/composition/executor.ts`
- Composition registry: `src/common/composition/registry.ts`
- Composition watcher: `src/common/composition/composition-watcher.ts`
- RBAC evaluator: `src/common/mcp/rbac.ts`
- MCP client manager: `src/common/mcp/client-manager.ts`

### New (tool-orchestrator)
- Main service: `src/apps/tool-orchestrator-service.ts`
- ToolGateway module: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
- RbacValidator: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`
- ToolRegistry module: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`
- ModelRegistry module: `src/apps/tool-orchestrator-service/modules/models/model-registry.ts`

---

**Document Status**: Ready for Review
**Approver**: Architecture Review Board
**Next Review Date**: 2026-11-16
