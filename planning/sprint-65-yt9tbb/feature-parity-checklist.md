# Sprint 65: Feature Parity Checklist
# Tool-Gateway vs Tool-Orchestrator

**Created**: 2026-11-15
**Author**: Implementation Team
**Sprint**: sprint-65-yt9tbb
**Status**: Draft v1

---

## How to Use This Checklist

- ✅ **Complete**: Feature is implemented and tested in tool-orchestrator
- 🟡 **Partial**: Feature exists but has limitations or gaps
- ❌ **Missing**: Feature does not exist in tool-orchestrator
- ➖ **N/A**: Feature not needed in tool-orchestrator (by design)

**Priority Legend**:
- **P0**: Must have before migration (blocking)
- **P1**: Should have before migration (high priority)
- **P2**: Nice to have (can defer)
- **P3**: Low priority (monitor and add if needed)

---

## 1. Core Tool Execution

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Tool lookup from registry | ✅ | P0 | tool-gateway.ts:200 | PostgreSQL + LRU cache (better than legacy) |
| Model lookup from registry | ✅ | P0 | tool-gateway.ts:207 | PostgreSQL + LRU cache (new feature) |
| RBAC validation (dual-layer) | ✅ | P0 | tool-gateway.ts:214 | Equivalent to legacy |
| Timeout enforcement | ✅ | P0 | tool-gateway.ts:617 | AbortController-based |
| Error handling | ✅ | P0 | tool-gateway.ts:290 | Better than legacy (structured logging) |
| Result formatting | ✅ | P0 | tool-gateway.ts:289 | Compatible with ToolResult interface |

**Verdict**: ✅ Core execution is **feature-complete** with improvements over legacy.

---

## 2. Tool Source Routing

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Internal tool execution | ✅ | P0 | tool-gateway.ts:606 | Via internalTools map |
| MCP tool execution | 🟡 | **P0** | tool-gateway.ts:728 | **Needs McpClientManager initialization** |
| Composition tool execution | 🟡 | **P0** | tool-gateway.ts:867 | **Missing per-step RBAC validation** |

**Verdict**: 🟡 **Partial parity** - MCP and composition execution need fixes.

---

## 3. MCP Client Management

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| McpClientManager initialization | ❌ | **P0** | tool-orchestrator-service.ts:70 | **BLOCKING: Passed as undefined** |
| Connection to upstream MCP servers | ❌ | **P0** | N/A | Depends on initialization |
| Connection lifecycle management | ❌ | P1 | N/A | Auto-connect/reconnect |
| RegistryWatcher integration | ❌ | P2 | N/A | Watches Bit registration events |
| Connection health monitoring | ❌ | P2 | N/A | Health checks for MCP servers |

**Verdict**: ❌ **Missing** - **Blocking issue for migration**

**Action Required**:
```typescript
// src/apps/tool-orchestrator-service.ts (Task 1.2)
const mcpClientManager = new McpClientManager(this as any, this.toolRegistry);
this.toolGateway = new ToolGateway(
  this.toolRegistry,
  this.modelRegistry,
  { /* config */ },
  mcpClientManager,  // ← FIX
  this.getLogger() as any
);
```

---

## 4. Internal Tools

| Tool | Status | Priority | Location | Notes |
|------|--------|----------|----------|-------|
| agent.sendProgressUpdate | 🟡 | P1 | tool-gateway.ts:682 | **Simplified - no claim check, no Bit.next()** |
| composition.register | ❌ | **P0** | N/A | **Missing** |
| composition.list | ❌ | **P0** | N/A | **Missing** |
| composition.get | ❌ | **P0** | N/A | **Missing** |
| composition.delete | ❌ | **P0** | N/A | **Missing** |
| composition.stats | ❌ | P1 | N/A | **Missing** |
| composition.list_tools | ❌ | P1 | N/A | **Missing** |

**Verdict**: ❌ **6 of 7 tools missing** - **Blocking issue**

**Action Required** (Task 1.3):
1. Port all 6 composition admin tools from tool-gateway.ts
2. Enhance agent.sendProgressUpdate:
   - Add claim check integration for source event retrieval
   - Add Bit.next() routing for actual message delivery
   - Add egress fallback chain (claim check → args.egress → userId)

---

## 5. Composition Subsystem

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| CompositionRegistry initialization | ❌ | **P0** | N/A | **Not initialized** |
| PostgresCompositionStore setup | ❌ | **P0** | N/A | **Not connected** |
| CompositionExecutor initialization | ❌ | **P0** | N/A | **Not initialized** |
| Load compositions on startup | ❌ | **P0** | N/A | `loadCompositions()` missing |
| Register compositions as MCP tools | ❌ | **P0** | N/A | `registerCompositionTool()` missing |
| Composition hot-reload (CompositionWatcher) | ❌ | P2 | N/A | Optional - requires service restart |

**Verdict**: ❌ **Completely missing** - **Blocking issue**

**Action Required** (Task 1.3):
```typescript
// src/apps/tool-orchestrator-service.ts
async setup(): Promise<void> {
  // ... existing setup ...

  // Initialize CompositionRegistry
  const compositionStore = new PostgresCompositionStore(pool);
  this.compositionRegistry = new CompositionRegistry(
    compositionStore,
    toolRegistryAdapter,
    this.getLogger()
  );

  // Initialize CompositionExecutor
  this.compositionExecutor = new CompositionExecutor(
    toolRegistryAdapter,
    this.getLogger()
  );

  // Load all compositions on startup
  await this.loadCompositions();
}
```

---

## 6. Composition Execution (Detailed)

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Sequential execution strategy | ✅ | P0 | tool-gateway.ts:998 | Implemented with error handling |
| Parallel execution strategy | ✅ | P0 | tool-gateway.ts:1066 | Promise.allSettled for graceful failures |
| Conditional execution strategy | ❌ | P2 | tool-gateway.ts:1152 | Throws error |
| Per-step RBAC validation | ✅ | **P0** | tool-gateway.ts:897-937 | **✅ IMPLEMENTED in Sprint 60 T3.3 + Sprint 61 T2.2** |
| Graceful partial failure handling | ✅ | P1 | tool-gateway.ts:1101 | Promise.allSettled |
| Detailed error messages with step context | ✅ | P1 | tool-gateway.ts:1026 | Good error reporting |

**Verdict**: ✅ **Full parity** - All P0 composition execution features implemented

**Implementation Verification (Sprint 65 Task 1.4):**
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts (lines 897-937)
// T3.3: Validate RBAC for EACH constituent tool (prevent privilege escalation)
for (const constituentToolId of constituentToolIds) {
  const rbacResult = await this.validateToolAccess(
    constituentToolId,
    context.userId || 'anonymous',
    context.modelId,  // Validate against INVOKING model
    context.userRoles
  );

  if (!rbacResult.allowed) {
    // Fail-fast: Throw immediately on first RBAC denial
    throw new Error(
      `Composition denied: constituent tool "${constituentToolId}" not allowed for model ${context.modelId}. Reason: ${rbacResult.reason}`
    );
  }
}
```

**Test Coverage:** `composition-runtime-rbac.test.ts` - 7 tests, all passing ✅
- ✅ Allow execution when invoking model has access to all tools
- ✅ Deny execution when invoking model lacks access to one tool
- ✅ Validate each step individually at runtime
- ✅ Log RBAC denial with full context
- ✅ Allow execution after model upgrade
- ✅ Validate against invoking model (not registering model)
- ✅ Fail fast on first RBAC denial without validating remaining tools

---

## 7. RBAC Validation

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| User roles validation | ✅ | P0 | rbac-validator.ts:50 | Required/denied lists |
| Model roles validation | ✅ | P0 | rbac-validator.ts:75 | Required/denied lists |
| Model tier validation | ✅ | P0 | rbac-validator.ts:95 | Allowed/denied tiers |
| Model trust score validation | ✅ | P0 | rbac-validator.ts:120 | Minimum trust threshold |
| Model tool policy validation | ✅ | P0 | rbac-validator.ts:140 | Allowed/denied tool lists |
| Composition per-step RBAC | ✅ | **P0** | tool-gateway.ts:897-937 | **✅ Implemented (Sprint 60 T3.3 + Sprint 61 T2.2)** |

**Verdict**: ✅ **Full parity** - All RBAC features complete, including composition per-step validation

---

## 8. Caching & Performance

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Tool metadata caching | ✅ | P0 | tool-gateway.ts:160 | LRU cache with 5min TTL (better than legacy) |
| Model metadata caching | ✅ | P0 | tool-gateway.ts:164 | LRU cache with 5min TTL (new feature) |
| Cache TTL configuration | ✅ | P1 | tool-gateway.ts:120 | Configurable via ToolGatewayConfig |
| Cache size limits | ✅ | P1 | tool-gateway.ts:118 | LRU eviction |
| Cache invalidation | ✅ | P1 | tool-gateway.ts:1278 | clearCaches() method |
| Cache statistics | ✅ | P2 | tool-gateway.ts:1286 | getCacheStats() method |

**Verdict**: ✅ **Better than legacy** - Tool-orchestrator has superior caching with LRU + TTL

---

## 9. Retry & Resilience

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Exponential backoff retry | ✅ | P1 | tool-gateway.ts:520 | **New feature** (better than legacy) |
| Transient error detection | ✅ | P1 | tool-gateway.ts:470 | Network, timeout, 5xx errors |
| Retry policy configuration | ✅ | P1 | tool-gateway.ts:753 | Per-tool maxAttempts + backoffMs |
| Timeout enforcement | ✅ | P0 | tool-gateway.ts:756 | AbortController-based |
| Graceful degradation | ✅ | P1 | tool-gateway.ts:1101 | Promise.allSettled for parallel |

**Verdict**: ✅ **Better than legacy** - Tool-orchestrator has superior resilience

---

## 10. Observability & Logging

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| Structured event logging (Loki) | ✅ | P0 | tool-gateway.ts:1191 | ToolInvocationEvent schema |
| RBAC denial logging | ✅ | P0 | tool-gateway.ts:224 | Audit trail for denials |
| Tool execution success logging | ✅ | P0 | tool-gateway.ts:270 | Duration, context |
| Tool execution error logging | ✅ | P0 | tool-gateway.ts:298 | Error details, stack trace |
| Input/output preview truncation | ✅ | P1 | tool-gateway.ts:1206 | 500 char limit (privacy) |
| Cost estimation | ✅ | P2 | tool-gateway.ts:1215 | Token-based cost (from ModelCost) |
| Fail-open logging errors | ✅ | P1 | tool-gateway.ts:1266 | Logging errors never block execution |

**Verdict**: ✅ **Better than legacy** - Tool-orchestrator has structured, Loki-compatible logging

---

## 11. Session Management

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| sessionContexts tracking | ❌ | P2 | N/A | Optional - tool-orchestrator is stateless |
| sessionServers (MCP clients) | ❌ | P2 | N/A | Optional |
| Session-based MCP endpoint | ❌ | P2 | N/A | Optional |
| Broadcast list changed notifications | ❌ | P2 | N/A | Optional |

**Verdict**: ➖ **N/A** - Tool-orchestrator is stateless by design (acceptable trade-off)

**Decision**: Skip session management. Tool list changes propagate via periodic cache refresh (60s).

---

## 12. Request Deduplication

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| inFlightRequests deduplication | ❌ | P3 | N/A | Optional - MCP SDK bug may be fixed |
| completedRequests cleanup | ❌ | P3 | N/A | Optional |

**Verdict**: ➖ **N/A** - Monitor production logs first, add if duplicate execution observed

**Decision**: Skip for now. Add if MCP SDK message duplication bug is still present.

---

## 13. Context Provisioning

| Feature | Status | Priority | Location | Notes |
|---------|--------|----------|----------|-------|
| contextProviders (Just-in-Time) | ❌ | P3 | N/A | Optional - specialized feature |
| Registration signatures (heartbeat optimization) | ❌ | P3 | N/A | Optional |

**Verdict**: ➖ **N/A** - Not critical for core tool execution

**Decision**: Skip for now. Evaluate if JIT context provisioning is still used.

---

## Overall Feature Parity Summary

### By Category

| Category | Complete | Partial | Missing | N/A |
|----------|----------|---------|---------|-----|
| Core Execution | ✅ 6/6 | - | - | - |
| MCP Client Management | - | - | ❌ 5/5 | - |
| Internal Tools | - | 🟡 1/7 | ❌ 6/7 | - |
| Composition Subsystem | - | - | ❌ 6/6 | - |
| Composition Execution | ✅ 4/6 | - | ❌ 2/6 | - |
| RBAC Validation | ✅ 5/6 | - | ❌ 1/6 | - |
| Caching & Performance | ✅ 6/6 | - | - | - |
| Retry & Resilience | ✅ 5/5 | - | - | - |
| Observability | ✅ 7/7 | - | - | - |
| Session Management | - | - | - | ➖ 4/4 |
| Request Deduplication | - | - | - | ➖ 2/2 |
| Context Provisioning | - | - | - | ➖ 2/2 |

### By Priority

| Priority | Complete | Partial | Missing | Total |
|----------|----------|---------|---------|-------|
| **P0** | 20 | 3 | **15** | 38 |
| **P1** | 11 | 1 | **3** | 15 |
| **P2** | 1 | 0 | 8 | 9 |
| **P3** | 0 | 0 | 4 (N/A) | 4 |

### Critical Gaps (P0 Missing)

1. ❌ McpClientManager initialization (5 features)
2. ❌ Composition subsystem (6 features)
3. ❌ Composition admin tools (4 tools)
4. ❌ Composition per-step RBAC (1 feature)

**Total P0 Gaps**: **15 features** must be implemented before migration

---

## Acceptance Criteria

### For Task 1.1 (Gap Analysis) ✅

- [x] All differences documented with severity ratings
- [x] No P0/P1 gaps remaining unidentified
- [x] Stakeholder approval on gap remediation plan (pending review)

### For Sprint 65 Completion

- [ ] **All 15 P0 gaps closed**
- [ ] All 3 P0 partial features completed
- [ ] All 3 P1 missing features implemented
- [ ] Integration tests passing for all closed gaps
- [ ] Performance within 20% of tool-gateway baseline
- [ ] Zero regressions in functionality

---

## Next Steps

1. **Stakeholder Review**: Architecture Review Board approval (1 day)
2. **Task 1.2**: Initialize McpClientManager (1 day) - **NEXT**
3. **Task 1.3**: Port composition subsystem + admin tools (2 days)
4. **Task 1.4**: Add composition per-step RBAC validation (2 days)
5. **Phase 2**: Integration testing (Week 2)
6. **Phase 3**: Consumer migration (Week 3)

---

**Document Status**: Ready for Review
**Last Updated**: 2026-11-15
**Next Review**: After Task 1.2 completion
