# Architecture Brief: Metadata Propagation in Tool Execution Chain

**Date**: 2026-11-24
**Sprint**: 66
**Author**: Claude (Architectural Analysis)
**Status**: Critical Issue - Production Impact

---

## Executive Summary

The BitBrat platform has **systematic metadata propagation failures** in the tool execution chain from llm-bot through tool-orchestrator to ToolGateway and downstream MCP servers. This causes:

1. **Tool execution failures** due to missing `modelId` required for RBAC validation
2. **Inconsistent metadata** across the 7-hop call chain
3. **Type safety violations** between interface contracts and actual implementations
4. **Silent data loss** at multiple handoff points

**Impact**: Users see tool execution errors ("Model not found: tool-gateway"), limiting platform functionality to 33 admin tools instead of 505 available tools.

---

## Problem Statement

### Current Issues

1. **Missing ModelId in ToolGateway**: Tool-orchestrator passes `modelId: "tool-gateway"` (server name) instead of actual LLM model (e.g., "gpt-4o")
2. **Metadata Loss in MCP Calls**: ToolGateway drops `modelId` when calling downstream MCP servers (line 782-787 in tool-gateway.ts)
3. **Optional vs Required Mismatch**: `ToolExecutionContext` interface declares `modelId` as required, but all code treats it as optional
4. **Defensive Optional Checks**: Every layer has `if (meta?.modelId)` checks, indicating lack of confidence in upstream propagation
5. **Multiple Handoff Points**: 7-hop chain creates 6 opportunities for metadata loss

### Business Impact

- **Tool Execution**: 100% failure rate for tools requiring model-based RBAC
- **User Experience**: Broken tool functionality after NATS purge and redeploy
- **Observability**: Incomplete correlation IDs and session tracking across service boundaries
- **Security**: RBAC validation bypassed when modelId missing

---

## Technical Deep Dive

### Complete Metadata Propagation Chain

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. llm-bot (processor.ts:760-766)                                       │
│    Creates toolContext with modelId = modelName (actual LLM model)      │
│    ✅ modelId: "gpt-4o" | "claude-opus-3.5" | etc.                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. BitBratTool.execute (bridge.ts:60-84)                                │
│    Receives context from AI SDK tool execution                          │
│    Conditionally includes modelId in _meta                              │
│    ✅ if (context?.modelId) { meta.modelId = context.modelId; }         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. ProxyInvoker.invoke (proxy-invoker.ts:51-71)                         │
│    Forwards _meta with modelId to tool-orchestrator                     │
│    ✅ Passes modelId through (lines 61-71)                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. tool-orchestrator.getMcpServer() (tool-orchestrator-service.ts:      │
│    1532-1542)                                                            │
│    Extracts meta.modelId from MCP request                               │
│    ✅ if (meta?.modelId) { combinedExtra.modelId = meta.modelId; }      │
│    Passes to ToolGateway.execute()                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. ToolGateway.execute (tool-gateway.ts:191-211)                        │
│    **REQUIRES modelId** to load model from registry                     │
│    ✅ Receives context.modelId                                          │
│    ❌ Throws "Model not found" if modelId invalid/missing               │
│    Performs dual-layer RBAC (User × Model)                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. ToolGateway.executeMcp (tool-gateway.ts:729-788)                     │
│    **DROPS modelId** when calling downstream MCP server!                │
│    ❌ _meta only includes: userRoles, userId, correlationId, sessionId  │
│    ❌ modelId LOST HERE - not forwarded to actual MCP server            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. Downstream MCP Server (reflex, image-gen, etc.)                      │
│    Receives _meta without modelId                                       │
│    ❌ Cannot perform model-based RBAC or logging                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Critical Code Locations

#### 1. ToolExecutionContext Type Mismatch
**File**: `src/types/tools.ts:13-26`

```typescript
export interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;  // ❌ REQUIRED but treated as optional everywhere
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}
```

**Problem**: Interface declares `modelId` as required (no `?`), but all consuming code treats it as optional.

**Evidence**:
- bridge.ts:74: `if (context?.modelId)`
- tool-orchestrator-service.ts:1540: `if (meta?.modelId)`
- processor.ts:763: Creates context with modelId, but downstream doesn't enforce it

#### 2. Metadata Loss in executeMcp
**File**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:729-788`

```typescript
private async executeMcp(
  tool: ToolRegistryDocument,
  args: unknown,
  context: ToolExecutionContext  // ✅ Has modelId
): Promise<ToolResult> {
  // ... (lines 734-778)

  return await client.callTool({
    name: tool.canonicalName,
    arguments: args,
    _meta: {
      userRoles: context.userRoles,
      userId: context.userId,
      correlationId: context.correlationId,
      sessionId: context.sessionId,
      // ❌ modelId NOT INCLUDED - LOST HERE
    }
  } as any);
}
```

**Impact**: Downstream MCP servers cannot:
- Perform model-based RBAC checks
- Log which model invoked the tool
- Apply model-specific rate limits or quotas
- Track model-specific usage metrics

#### 3. Incorrect ModelId Passed to ToolGateway
**File**: `src/apps/tool-orchestrator-service.ts:1540-1542`

```typescript
// Only include modelId if present in _meta (don't use invalid fallback)
if (meta?.modelId) {
  combinedExtra.modelId = meta.modelId;
}
```

**Current Behavior**:
- When llm-bot doesn't set modelId (or it gets lost), `combinedExtra.modelId` is `undefined`
- ToolGateway tries to load model from registry with `undefined` as key
- Registry returns `null`
- Error: "Model not found: undefined"

**Actual Issue in Production**:
- Logs show "Model not found: tool-gateway"
- This suggests somewhere "tool-gateway" is being used as modelId (server name, not model name)
- Need to trace where this substitution happens

#### 4. Model Registry Lookup
**File**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:207-211`

```typescript
const model = await this.getModelCached(context.modelId);
if (!model) {
  this.logEvent('model_not_found', { toolId, modelId: context.modelId }, true);
  throw new Error(`Model not found: ${context.modelId}`);
}
```

**Problem**: Hard requirement for model to exist in registry, but:
1. Model registry is not populated with LLM models (gpt-4o, claude-opus, etc.)
2. Model registry is intended for custom agent models (reflex, etc.)
3. LLM model names from llm-bot don't map to registry entries

**Architectural Mismatch**: Sprint 58 introduced model-based RBAC expecting models in registry, but llm-bot uses provider model names (OpenAI API model IDs) that aren't registered.

---

## Root Causes

### 1. Architectural Mismatch: Model Registry vs LLM Model Names

**Design Assumption**: Model-based RBAC expects `modelId` to reference a `ModelRegistryDocument` in PostgreSQL.

**Reality**: llm-bot uses actual LLM provider model names:
- OpenAI: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- Anthropic: `claude-opus-3.5`, `claude-sonnet-3.5`
- Local: `ollama/llama3`

**Gap**: These LLM model names are **not registered** in the model registry. The registry contains custom agent models (reflex, etc.) but not provider models.

**Impact**: Even with perfect propagation, ToolGateway would fail to find LLM models in registry.

### 2. No Metadata Propagation Standard

**Current State**: Each hop implements its own metadata extraction/forwarding logic:
- Some use `_meta` top-level field
- Some merge `_meta` into arguments
- Some use HTTP headers as fallback
- No consistent field naming or structure

**Result**: Metadata gets transformed, renamed, or dropped at each boundary.

### 3. Defensive Programming Indicates Distrust

**Pattern**: Every layer has optional checks:
```typescript
if (context?.modelId) { ... }
if (meta?.modelId) { ... }
```

**Interpretation**: Each layer **expects upstream to fail** to provide metadata, so implements defensive fallbacks. This becomes self-fulfilling prophecy.

### 4. Type Safety Not Enforced

**Interface Contract**: `modelId: string` (required)

**Runtime Reality**: `modelId: string | undefined` (optional)

**TypeScript Bypass**: Code uses `as any` casts to bypass type checking:
- bridge.ts:84: `} as any)`
- tool-orchestrator-service.ts:1560: `combinedExtra as any`

---

## Recommended Solution

### Phase 1: Immediate Fix (Sprint 66) - Make ModelId Optional in ToolGateway

**Goal**: Restore tool execution functionality without requiring full architectural redesign.

**Changes**:

1. **Update ToolExecutionContext** to match reality:
```typescript
// src/types/tools.ts
export interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId?: string;  // ✅ Now optional to match actual usage
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}
```

2. **Make model lookup optional in ToolGateway**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:207-218
const model = context.modelId
  ? await this.getModelCached(context.modelId)
  : null;

if (!model && context.modelId) {
  // Only error if modelId was explicitly provided but not found
  this.logEvent('model_not_found', { toolId, modelId: context.modelId }, true);
  throw new Error(`Model not found: ${context.modelId}`);
}

// RBAC validation: Use user-only rules if no model available
const rbacResult = model
  ? this.rbacValidator.validateToolAccess(tool, context.userRoles, model)
  : this.rbacValidator.validateToolAccessUserOnly(tool, context.userRoles);
```

3. **Add validateToolAccessUserOnly** to RbacValidator:
```typescript
// New method: User-only RBAC when model not available
validateToolAccessUserOnly(
  tool: ToolRegistryDocument,
  userRoles: string[]
): RBACValidationResult {
  // Check user roles only (skip model-based rules)
  // ... implementation
}
```

4. **Forward modelId in executeMcp**:
```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:782-788
_meta: {
  userRoles: context.userRoles,
  userId: context.userId,
  correlationId: context.correlationId,
  sessionId: context.sessionId,
  modelId: context.modelId,  // ✅ ADD THIS
}
```

**Benefits**:
- ✅ Restores tool execution immediately
- ✅ Maintains backward compatibility
- ✅ Minimal code changes (4 files)
- ✅ No breaking changes to APIs

**Limitations**:
- ⚠️ Model-based RBAC bypassed when modelId missing
- ⚠️ Logging incomplete without modelId
- ⚠️ Doesn't solve architectural issues

---

### Phase 2: Structural Fix (Sprint 67+) - Standardize Metadata Propagation

**Goal**: Establish platform-wide metadata propagation standard.

#### 2.1 Define Standard Metadata Context

```typescript
// src/types/execution-context.ts (NEW FILE)

/**
 * Standard metadata context propagated across all service boundaries.
 *
 * Sprint 67: Unified metadata standard to prevent propagation failures.
 */
export interface ExecutionContext {
  /** Correlation ID for distributed tracing (REQUIRED) */
  correlationId: string;

  /** User identity (REQUIRED for user-initiated requests) */
  user: {
    id: string;
    roles: string[];
    platform?: string;  // e.g., 'twitch', 'discord'
  };

  /** LLM model executing the request (OPTIONAL - only for LLM requests) */
  model?: {
    provider: string;   // e.g., 'openai', 'anthropic'
    name: string;       // e.g., 'gpt-4o', 'claude-opus-3.5'
    tier?: string;      // e.g., 'premium', 'standard'
  };

  /** Session tracking (OPTIONAL) */
  session?: {
    id: string;
    startedAt: string;
  };

  /** Request metadata (OPTIONAL) */
  request?: {
    source: string;     // e.g., 'llm-bot', 'api-gateway'
    timestamp: string;
  };
}
```

#### 2.2 Context Propagation Utility

```typescript
// src/common/context-propagation.ts (NEW FILE)

/**
 * Utility for standardized context extraction and propagation.
 */
export class ContextPropagator {
  /**
   * Extract ExecutionContext from MCP _meta field.
   */
  static fromMcp(meta: any): ExecutionContext {
    return {
      correlationId: meta.correlationId || generateCorrelationId(),
      user: {
        id: meta.userId || 'anonymous',
        roles: Array.isArray(meta.userRoles) ? meta.userRoles : [],
        platform: meta.platform,
      },
      model: meta.modelId ? {
        provider: meta.modelProvider || 'unknown',
        name: meta.modelId,
        tier: meta.modelTier,
      } : undefined,
      session: meta.sessionId ? {
        id: meta.sessionId,
        startedAt: meta.sessionStartedAt,
      } : undefined,
      request: {
        source: meta.source || 'unknown',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Convert ExecutionContext to MCP _meta field.
   */
  static toMcp(context: ExecutionContext): any {
    return {
      correlationId: context.correlationId,
      userId: context.user.id,
      userRoles: context.user.roles,
      platform: context.user.platform,
      modelId: context.model?.name,
      modelProvider: context.model?.provider,
      modelTier: context.model?.tier,
      sessionId: context.session?.id,
      sessionStartedAt: context.session?.startedAt,
      source: context.request?.source,
    };
  }

  /**
   * Merge contexts (later values override earlier values).
   */
  static merge(...contexts: Partial<ExecutionContext>[]): ExecutionContext {
    // Deep merge implementation
    // ...
  }
}
```

#### 2.3 Update All Handoff Points

**Goal**: Replace ad-hoc metadata extraction with standard ContextPropagator.

**Files to Update**:
1. `src/common/mcp/bridge.ts` (line 60-84)
2. `src/common/mcp/proxy-invoker.ts` (line 51-71, 110-127, 149-165)
3. `src/apps/tool-orchestrator-service.ts` (line 1532-1542, 1635-1645)
4. `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (line 782-788)

**Example Refactor** (bridge.ts):
```typescript
// BEFORE (bridge.ts:60-84)
const meta: any = context ? {
  userRoles: context.userRoles,
  userId: context.userId,
  correlationId: context.correlationId,
  sessionId: context.sessionId,
} : undefined;

if (context?.modelId) {
  meta.modelId = context.modelId;
}

// AFTER
const execContext = ContextPropagator.fromToolContext(context);
const meta = ContextPropagator.toMcp(execContext);
```

**Benefits**:
- ✅ Single source of truth for metadata structure
- ✅ Compile-time type safety
- ✅ Automatic validation
- ✅ Traceable metadata lineage
- ✅ Easy to extend with new fields

---

### Phase 3: Architectural Fix (Sprint 68+) - Resolve Model Registry Mismatch

**Goal**: Align model-based RBAC with actual LLM model usage.

#### Option A: Populate Model Registry with LLM Models

**Approach**: Register LLM provider models in model registry at startup.

```typescript
// src/apps/tool-orchestrator-service.ts (new method)
private async registerLlmModels(): Promise<void> {
  const llmModels: ModelRegistryDocument[] = [
    {
      id: 'gpt-4o',
      displayName: 'GPT-4 Optimized',
      provider: 'openai',
      tier: 'premium',
      capabilities: ['tools', 'vision'],
      rbac: {
        allowedUserRoles: [],
        deniedUserRoles: ['banned'],
        allowedFor: ['all'],
      },
      config: {
        maxTokens: 128000,
        supportsStreaming: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // ... more models
  ];

  for (const model of llmModels) {
    await this.modelRegistry!.registerModel(model);
  }
}
```

**Pros**:
- ✅ Maintains model-based RBAC architecture
- ✅ Enables fine-grained model permissions
- ✅ Centralized model configuration

**Cons**:
- ❌ Requires maintaining model list in sync with providers
- ❌ New models require code deploy
- ❌ Duplicate configuration (provider + registry)

#### Option B: Make Model-Based RBAC Optional

**Approach**: Skip model lookup if modelId doesn't exist in registry (Phase 1 approach).

**Pros**:
- ✅ Flexible - works with or without models in registry
- ✅ Graceful degradation
- ✅ No maintenance burden

**Cons**:
- ⚠️ Inconsistent RBAC (sometimes model-based, sometimes not)
- ⚠️ Security implications unclear

#### Option C: Two-Tier Model System

**Approach**: Distinguish between "LLM models" and "Agent models".

```typescript
export type ModelType = 'llm' | 'agent';

export interface ModelRegistryDocument {
  id: string;
  type: ModelType;  // ✅ NEW FIELD
  // ... rest of fields
}
```

**Rules**:
- **LLM models** (gpt-4o, claude-opus): User RBAC only (no model-specific rules)
- **Agent models** (reflex, scheduler): Full RBAC (user + model rules)

**Implementation**:
```typescript
// In ToolGateway.execute()
const model = await this.getModelCached(context.modelId);

if (!model) {
  // Assume LLM model (not in registry) - use user-only RBAC
  rbacResult = this.rbacValidator.validateToolAccessUserOnly(tool, context.userRoles);
} else if (model.type === 'agent') {
  // Agent model - use full dual-layer RBAC
  rbacResult = this.rbacValidator.validateToolAccess(tool, context.userRoles, model);
} else {
  // LLM model (in registry but marked as LLM) - use user-only RBAC
  rbacResult = this.rbacValidator.validateToolAccessUserOnly(tool, context.userRoles);
}
```

**Pros**:
- ✅ Explicit distinction between model types
- ✅ Flexible RBAC strategy per model type
- ✅ No breaking changes
- ✅ Clear security model

**Cons**:
- ⚠️ Complexity in RBAC logic
- ⚠️ Need to register LLM models with type='llm' (but no RBAC rules needed)

**Recommendation**: **Option C** provides best balance of flexibility, security, and maintainability.

---

## Implementation Roadmap

### Sprint 66 (Immediate)
**Priority**: P0 - Critical
**Goal**: Restore tool execution

- [ ] Fix 1: Make modelId optional in ToolExecutionContext interface
- [ ] Fix 2: Make model lookup optional in ToolGateway.execute()
- [ ] Fix 3: Add RbacValidator.validateToolAccessUserOnly()
- [ ] Fix 4: Forward modelId in ToolGateway.executeMcp()
- [ ] Test: Verify 505 tools execute successfully
- [ ] Test: Verify RBAC still enforces user roles

**Estimated Effort**: 4 hours
**Risk**: Low (backward compatible)

### Sprint 67 (Structural)
**Priority**: P1 - High
**Goal**: Standardize metadata propagation

- [ ] Design: Define ExecutionContext standard
- [ ] Implement: ContextPropagator utility
- [ ] Refactor: Update bridge.ts
- [ ] Refactor: Update proxy-invoker.ts
- [ ] Refactor: Update tool-orchestrator-service.ts
- [ ] Refactor: Update tool-gateway.ts
- [ ] Test: End-to-end metadata propagation test
- [ ] Docs: Update CLAUDE.md with propagation pattern

**Estimated Effort**: 2 days
**Risk**: Medium (affects all call paths)

### Sprint 68 (Architectural)
**Priority**: P2 - Medium
**Goal**: Resolve model registry mismatch

- [ ] Design: Finalize two-tier model system
- [ ] Update: ModelRegistryDocument schema
- [ ] Implement: LLM model auto-registration
- [ ] Update: RbacValidator with type-aware logic
- [ ] Test: Verify model-based RBAC for agents
- [ ] Test: Verify user-only RBAC for LLMs
- [ ] Docs: Document model type system

**Estimated Effort**: 3 days
**Risk**: Low (additive changes)

---

## Success Criteria

### Sprint 66
- [ ] All 505 tools execute successfully without "Model not found" errors
- [ ] Tool execution trace shows modelId propagated end-to-end
- [ ] RBAC user role enforcement continues to work
- [ ] No regression in existing tool functionality

### Sprint 67
- [ ] All metadata fields (correlationId, userId, userRoles, sessionId, modelId) propagate consistently
- [ ] No `as any` type casts in metadata propagation code
- [ ] Zero metadata loss in traces
- [ ] ContextPropagator unit tests at 100% coverage

### Sprint 68
- [ ] LLM models registered in model registry with type='llm'
- [ ] Agent models registered with type='agent'
- [ ] RBAC validator applies correct rules based on model type
- [ ] Model-based tool restrictions work for agent models
- [ ] No RBAC failures for LLM models

---

## Open Questions

1. **Model Registry Population**: Should LLM models be registered at service startup or via admin tool?
   - **Recommendation**: Startup auto-registration for core models (gpt-4o, claude-opus), admin tool for custom models

2. **Backward Compatibility**: How to handle existing code that doesn't use ContextPropagator?
   - **Recommendation**: Gradual migration, maintain compatibility shim for 2 sprints

3. **Performance Impact**: Does context validation add measurable latency?
   - **Action**: Benchmark context extraction/validation in hot path

4. **Multi-Tenant**: How does ExecutionContext handle multi-tenant scenarios?
   - **Action**: Add `tenantId` field to ExecutionContext in Phase 2

5. **Observability**: Should metadata propagation failures emit metrics/alerts?
   - **Recommendation**: Yes - add `metadata.propagation.failure` metric

---

## References

### Code Locations
- **ToolExecutionContext**: `src/types/tools.ts:13-26`
- **llm-bot toolContext creation**: `src/services/llm-bot/processor.ts:760-766`
- **bridge.ts execute**: `src/common/mcp/bridge.ts:60-84`
- **ProxyInvoker.invoke**: `src/common/mcp/proxy-invoker.ts:51-71`
- **tool-orchestrator getMcpServer**: `src/apps/tool-orchestrator-service.ts:1532-1542`
- **ToolGateway.execute**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:191-211`
- **ToolGateway.executeMcp**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:729-788`

### Related Sprints
- **Sprint 58**: Introduced model-based RBAC and modelId field
- **Sprint 61**: Tool-orchestrator aggregation and getMcpServer override
- **Sprint 65**: MCP metadata propagation (_meta field)
- **Sprint 66**: NATS purge revealed tool execution failures

### Documentation
- [Sprint 58 Architecture](../planning/sprint-58-model-based-rbac/architecture.md)
- [MCP Aggregation Pattern](./CLAUDE.md#11-building-mcp-aggregator-services-tool-gateway-tool-orchestrator)
- [Tool Execution Flow](./documentation/concepts/tool-execution-flow.md)

---

## Appendix: Diagnostic Logs

### Error Log (Production - Sprint 66)
```json
{
  "ts": "2026-11-24T01:05:13.844Z",
  "service": "tool-orchestrator",
  "level": "error",
  "msg": "tool_gateway.execute_mcp.error",
  "toolId": "mcp:reflex_bit.health",
  "serverName": "tool-gateway",
  "error": "MCP Tool Error: [{\"type\":\"text\",\"text\":\"Model not found: tool-gateway\"}]",
  "correlationId": "940ea310-b742-402a-bb14-a36d369e5a89"
}
```

### Trace Analysis
- **Correlation ID**: `940ea310-b742-402a-bb14-a36d369e5a89`
- **Duration**: 25 seconds
- **Services**: 11 (ingress-egress → event-router → auth → reflex → query-analyzer → llm-bot → tool-orchestrator → egress)
- **Schema Injection**: ✅ Working (300+ tools injected)
- **Tool Calls**: 4 attempted (reflex.list, reflex.bit.health, reflex.bit.readiness, reflex.stats)
- **Tool Execution**: ❌ All 4 failed with "Model not found: tool-gateway"

---

## Conclusion

The metadata propagation issue is **solvable in phases**:

1. **Phase 1 (Sprint 66)**: Quick fix to restore functionality - make modelId optional
2. **Phase 2 (Sprint 67)**: Structural fix for consistency - standardize propagation
3. **Phase 3 (Sprint 68)**: Architectural fix for correctness - resolve model registry mismatch

**Recommended Immediate Action**: Implement Phase 1 fixes (4 hours) to unblock production, then plan Phase 2/3 as separate initiatives.

**Risk Assessment**:
- Phase 1: **Low risk** - backward compatible, minimal changes
- Phase 2: **Medium risk** - requires coordination across team, thorough testing
- Phase 3: **Low risk** - additive changes, no breaking changes

**Next Steps**:
1. Review this architecture brief with team
2. Get approval for Phase 1 implementation
3. Create tickets for Phase 2/3 planning
4. Schedule architecture review for ExecutionContext standard
