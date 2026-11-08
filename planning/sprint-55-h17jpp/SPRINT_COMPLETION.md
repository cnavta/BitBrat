# Sprint 55 Completion: Tool-Centric Platform Redesign

**Sprint**: sprint-55-h17jpp
**Status**: ✅ COMPLETE - Technical Architecture Approved
**Date**: 2026-11-07
**Next Sprint**: Implementation Planning

---

## Executive Summary

Sprint 55 successfully completed the **Technical Architecture** for the Tool-Centric Platform Redesign with Model-Based RBAC. This document represents a fundamental shift from server-centric to tool-centric architecture, replacing the agent-based RBAC model with a model-based approach.

**Approved Document**: `planning/sprint-55-h17jpp/technical-architecture.md` (4,416 lines)

---

## What Was Accomplished

### 1. Comprehensive Technical Architecture (4,416 lines)

**Document Structure**:
- **15 Main Sections**: Problem → Solution → Implementation → Decisions
- **3 Appendices**: PostgreSQL schemas, Loki config, RBAC comparison
- **Complete**: Diagrams, code examples, schemas, migration strategy

**Key Sections**:
1. Current State Analysis (server-centric architecture)
2. Problem Statement (6 critical issues identified)
3. Proposed Architecture: Tool-Centric Design with Model-Based RBAC
4. Tool Registry Design (platform_tool_registry)
5. Tool Import/Discovery Process
6. Model-Based RBAC System (dual-layer: User × Model)
7. Request Flow and Tool Execution Lifecycle
8. Tool Invocation Event Log & Observability (Loki-based)
9. mcp-compose Integration (composition RBAC validation)
10. Bit Registration Decoupling
11. Migration Strategy (4 phases)
12. Implementation Considerations
13. Future Considerations
14. Architecture Decisions (8 critical decisions documented)
15. Recommendation (approval path)

### 2. Revolutionary RBAC Model

**Paradigm Shift**: Agent-based → Model-based permissions

**Before (Agent-Based)**:
- Security principal: llm-bot, query-analyzer (orchestrator)
- Problem: Permissions tied to service, not intelligence
- Limitation: No cost control, coarse security tiers

**After (Model-Based)**:
- Security principal: gpt-4, claude-sonnet, etc. (LLM model)
- Benefit: Permissions tied to decision-maker
- Enables: Cost control, security tiers, granular permissions

**Dual-Layer RBAC**:
```
Effective Access = User Permissions ∩ Model Permissions

Example:
- User has role 'user' ✓
- Tool requires model tier 'premium'
- Model is gpt-4 (tier: premium) ✓
→ ALLOWED

- User has role 'user' ✓
- Tool requires model tier 'premium'
- Model is gpt-3.5-turbo (tier: basic) ✗
→ DENIED
```

### 3. Unified tool-orchestrator Architecture

**Replaced**: tool-gateway monolith

**New Design**: Single Bit with 4 internal modules
1. **ToolRegistry module** - Manages platform_tool_registry (PostgreSQL)
2. **ModelRegistry module** - Manages model_registry (PostgreSQL)
3. **ToolObserver module** - Queries Loki for metrics/observability
4. **ToolGateway module** - Orchestrates execution, RBAC, MCP clients

**Benefits**:
- In-process communication (<1µs latency vs 10-50ms MCP overhead)
- Clean module boundaries with well-defined interfaces
- Single deployment, zero network hops
- Future-proof: Can extract modules to separate services if needed

### 4. Key Architectural Decisions

**14.1 Service Architecture**: Unified tool-orchestrator (not 3 separate services)

**14.2 Model Registry Seeding**: Auto-register well-established models on init
- Cloud: gpt-4, claude-opus-3.5, gpt-4-turbo, claude-sonnet-3.5, gpt-3.5-turbo
- Local: ollama/llama-3.1, ollama/mistral, ollama/codellama

**14.3 Tool Import**: Automatic import on MCP server registration

**14.4 Default RBAC**: Permissive by default (admin tightens as needed)
- userRoles.required: ['user']
- modelRoles.required: ['model']
- modelTiers.allowed: [] (empty = all tiers)

**14.5 Model Tiers**: Simple 4-tier system (free, basic, premium, enterprise)

**14.6 Metrics Granularity**: Per-tool + per-model tracking (Loki labels)

**14.7 Composition Validation**: Hard fail if model lacks access to constituent tools

**14.8 Migration Strategy**: Clean-slate (platform not yet live)

### 5. Critical Clarifications

**Appendix C.1**: Services NOT Affected by Model-Based RBAC

**Affected Services** (tool invocation):
- ✅ llm-bot - Must pass modelId in ToolExecutionContext
- ✅ reflex - Must pass modelId if using model-driven reflexes
- ✅ Compositions - Validated against model permissions at execution

**NOT Affected Services** (direct LLM usage):
- ❌ query-analyzer - Direct LLM calls via `getLlmProvider()`, no tool invocation
- ❌ disposition-service - Direct LLM calls for analysis
- ❌ story-engine-mcp - Direct LLM calls (though exposes tools via MCP)

**Why This Matters**: The Model-Based RBAC shift is a **tool security paradigm**, not an LLM usage paradigm. Services that use LLMs directly for analysis/enrichment remain unchanged.

---

## Critical Implementation Context

### 1. PostgreSQL Database Schemas (Appendix A)

**Four Core Tables**:

**A.1 platform_tool_registry**:
- Canonical tool storage (replaces in-memory Map)
- Dual-layer RBAC (userRoles + modelRoles + modelTiers + trustThresholds)
- Health tracking (lastInvocationAt, status)
- Full-text indexes on JSONB fields

**A.2 model_registry**:
- Model catalog with security profiles
- Multi-dimensional trust scores (by scope)
- Capabilities (toolCalling, vision, streaming)
- Cost configuration (inputTokenCostUSD, outputTokenCostUSD)

**A.3 mcp_server_registrations**:
- MCP server connection metadata
- Transport details (stdio, http, sse)
- Tool tracking (tools_imported array)

**A.4 bit_registry** (PROPOSED):
- Bit service discovery
- Health tracking (last_heartbeat_at)
- Capability metadata (provides_tools, consumes_topics)

**Performance Targets**:
- Tool registry: 10-20k tools expected
- Model registry: 100-500 models expected
- Query latency: <10ms single lookup, <50ms filtered queries
- Connection pooling: 10-20 connections per service

### 2. Observability Architecture (Appendix B)

**Stack**: Promtail → Loki → Grafana

**Log Event Schema** (JSON structured logs):
```typescript
{
  eventId: string,
  correlationId: string,
  toolId: string,
  toolName: string,
  toolSource: 'internal' | 'mcp' | 'composition',
  modelId: string,       // NEW: Security principal
  modelTier: string,     // NEW: For cost/security analysis
  userId: string,
  userRoles: string[],
  service: string,
  startedAt: ISO8601,
  completedAt: ISO8601,
  durationMs: number,
  status: 'success' | 'error' | 'timeout' | 'rbac_denied',
  inputPreview: string,   // First 200 chars
  outputPreview: string,  // First 200 chars
  errorType?: string,
  errorMessage?: string,
  errorCode?: string
}
```

**Critical Loki Labels** (indexed for fast queries):
- `service` - Which Bit invoked the tool
- `toolId` - Canonical tool ID
- `modelId` - Which model invoked the tool (NEW)
- `status` - success | error | timeout | rbac_denied
- `correlationId` - Request tracing
- `level` - Log level (info, warn, error)

**LogQL Queries** (Appendix B.5):
- Tool invocation rate by model
- Error rate for specific tool
- P95 latency by tool
- RBAC denial rate
- Cost tracking by model

### 3. Request Flow Changes (Section 7)

**Current Flow** (agent-based):
```
User → llm-bot (selects model: gpt-4)
  → llm-bot queries tool-gateway for tools
  → LLM suggests tool
  → llm-bot calls tool-gateway.execute(toolId, args, {userRoles, agentName: 'llm-bot'})
  → RBAC validates user + agent
  → Execute tool
```

**PROPOSED Flow** (model-based):
```
User → llm-bot (selects model: gpt-4)
  → llm-bot queries tool-orchestrator for tools (with modelId filter)
  → tool-orchestrator returns RBAC-filtered tools for gpt-4
  → LLM suggests tool
  → llm-bot calls tool-orchestrator.execute(toolId, args, {userRoles, modelId: 'gpt-4'})
  → ToolGateway → ToolRegistry.getTool() (IN-PROCESS, <1µs)
  → ToolGateway → ModelRegistry.getModel() (IN-PROCESS, <1µs)
  → ToolGateway validates dual-layer RBAC:
      - User: requiredRoles ∩ deniedRoles
      - Model: modelRoles, modelTiers, trustThresholds
  → Execute tool
  → Log event to Loki
```

**Key Change**: `modelId` replaces `agentName` in ToolExecutionContext

**Context Propagation**:
```typescript
// CURRENT (src/types/tools.ts:9-22)
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;     // Being removed
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}

// PROPOSED (Sprint 55)
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;        // NEW: Required
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // Removed: agentName
}
```

### 4. Tool Import Pipeline (Section 5)

**Automatic Import Flow**:
1. MCP server publishes `INTERNAL_MCP_REGISTRATION_V1`
2. tool-orchestrator receives registration message
3. ToolRegistry module establishes MCP connection (HTTP/stdio)
4. Call MCP `tools/list` RPC
5. For each tool:
   - Validate schema (Zod)
   - Generate canonical tool ID
   - Check for duplicates
   - Apply default RBAC
   - Store in platform_tool_registry
6. Store server metadata in mcp_server_registrations
7. Broadcast tool availability notification

**Tool Deduplication** (Section 5.5):
- If tool ID already exists from different source:
  - Compare schemas (exact match required)
  - If schemas match: Update source metadata, preserve RBAC
  - If schemas differ: Reject with error (admin must resolve)

**Manual Import** (via MCP tool):
```typescript
tool.import({
  serverName: 'image-gen-mcp',
  connectionConfig: {
    transport: 'http',
    url: 'http://localhost:3002/mcp'
  }
})
```

### 5. Composition RBAC Integration (Section 9)

**Registration-Time Validation**:
```typescript
async function registerComposition(
  definition: CompositionDefinition,
  registeringModelId: string,  // NEW: Model making the registration
  userRoles: string[]
) {
  // Extract all tool IDs from composition steps
  const toolIds = extractToolIds(definition.spec.steps);

  // Validate MODEL has access to ALL constituent tools
  for (const toolId of toolIds) {
    const access = validateToolAccess(
      toolId,
      userRoles,
      registeringModelId  // Check against MODEL permissions
    );

    if (!access.allowed) {
      throw new Error(
        `Model ${registeringModelId} lacks access to tool ${toolId}: ${access.reason}`
      );
    }
  }

  // Store composition with registering model metadata
  await compositionRegistry.register({
    ...definition,
    registeredBy: registeringModelId,
    rbacValidatedAt: new Date().toISOString()
  });
}
```

**Runtime Validation**:
- Composition executes with invoking model's permissions (not registering model)
- Each constituent tool re-validated against invoking model
- Prevents privilege escalation via composition chaining

### 6. Migration Strategy (Section 11)

**4 Phases**:

**Phase 1: Foundation (Sprint 1-2)**
- Implement tool-orchestrator with 4 modules
- Create PostgreSQL schemas
- Implement ToolRegistry + ModelRegistry modules
- Seed model registry
- Basic RBAC validation (user-level only)

**Phase 2: Model-Based RBAC (Sprint 3-4)**
- Implement dual-layer RBAC validation
- Add modelId to ToolExecutionContext
- Update llm-bot to pass modelId
- Implement model tier enforcement
- Trust score validation

**Phase 3: Observability (Sprint 5)**
- Implement ToolObserver module
- Loki/Promtail integration
- Event logging in ToolGateway
- Grafana dashboards

**Phase 4: Validation & Cutover (Sprint 6)**
- Integration testing (agent-dev contexts)
- Load testing
- Cutover from tool-gateway to tool-orchestrator
- Deprecate tool-gateway

**No Backward Compatibility Required**: Platform not yet live (clean-slate migration)

---

## Files and Locations

### Core Documentation

**Technical Architecture**:
- `planning/sprint-55-h17jpp/technical-architecture.md` (4,416 lines)

**Sprint Artifacts**:
- `planning/sprint-55-h17jpp/SPRINT_COMPLETION.md` (this file)

### Implementation References

**Type Definitions** (to be updated):
- `src/types/tools.ts` - BitBratTool, ToolExecutionContext
- `src/types/events.ts` - Event types (unchanged)

**Current Implementation** (to be replaced/refactored):
- `src/apps/tool-gateway.ts` - Monolithic gateway (will be replaced)
- `src/common/mcp/client-manager.ts` - MCP client management (will be moved to tool-orchestrator)
- `src/services/llm-bot/tools/registry.ts` - In-memory registry (will be replaced)
- `src/common/mcp/rbac.ts` - Current RBAC evaluator (will be rewritten)

**Services That Will Change**:
- `src/apps/llm-bot-service.ts` - Must pass modelId in context
- `src/apps/reflex-service.ts` - Must pass modelId if using models
- `src/common/composition/` - Must validate model-based RBAC

**Services That Will NOT Change**:
- `src/apps/query-analyzer.ts` - Direct LLM usage, no tool invocation
- `src/apps/disposition-service.ts` - Direct LLM usage
- `src/apps/story-engine-mcp.ts` - Direct LLM usage (tool exposure unchanged)

**Architecture Configuration**:
- `architecture.yaml` - Service definitions (will add tool-orchestrator entry)

---

## Critical Gotchas and Edge Cases

### 1. Model-Based RBAC Is NOT for Direct LLM Usage

**Common Misconception**: "All services using LLMs need to pass modelId"

**Reality**: Only services that **invoke tools via tool-orchestrator** need modelId.

**Why This Matters**:
- query-analyzer uses `getLlmProvider()` directly → No modelId needed
- llm-bot uses tool-orchestrator to execute tools → modelId required
- Don't conflate LLM usage (analysis/generation) with tool invocation (security)

### 2. In-Process vs MCP Communication

**In-Process** (<1µs latency):
- ToolGateway → ToolRegistry
- ToolGateway → ModelRegistry
- ToolGateway → ToolObserver
- Module method calls within tool-orchestrator

**MCP** (10-50ms latency):
- llm-bot → tool-orchestrator (tool.list, tool.execute)
- reflex → tool-orchestrator (tool.execute)
- tool-orchestrator → External MCP servers (image-gen-mcp, obs-mcp, etc.)

**Don't Confuse**: Internal module communication (fast) vs external service communication (slower)

### 3. Tool Deduplication Complexity

**Scenario**: Multiple sources provide same tool (e.g., "generate_image")

**Current Decision** (Section 5.5):
- Exact schema match: Allow, update source metadata
- Schema mismatch: Reject, admin must resolve

**Future Consideration**: Multi-source routing (route to different providers based on cost/latency)

**Implementation Note**: Deduplication logic must be in ToolRegistry module, not import pipeline

### 4. Composition Registration vs Execution Context

**Registration Context** (composition.register):
- Uses registering model's permissions
- Validates at registration time
- Stores metadata: `registeredBy: modelId`

**Execution Context** (composition.execute):
- Uses invoking model's permissions
- Re-validates all constituent tools
- May differ from registering model

**Why Both**: Prevent creation of invalid compositions AND runtime privilege escalation

### 5. Trust Score Validation Scope

**Multi-Dimensional Trust** (Section 6.3.4):
```typescript
trust: [
  {
    scope: 'general',
    scores: {reliability: 95, fidelity: 92, integrity: 88, calibration: 90}
  },
  {
    scope: 'medical',
    scores: {reliability: 75, fidelity: 70, integrity: 85, calibration: 65}
  }
]
```

**Tool RBAC**:
```typescript
trustThresholds: [
  {scope: 'general', min: {reliability: 80}}
]
```

**Validation Logic**:
- Match on scope (fallback to 'general' if tool scope not found)
- Check ALL specified thresholds (AND logic)
- Fail if model lacks trust profile for required scope

**Implementation Note**: Trust score matching is complex, needs thorough testing

### 6. LRU Cache Invalidation

**Caching Strategy** (Section 7.6):
- ToolGateway caches tools (5min TTL)
- ToolGateway caches models (5min TTL)

**Invalidation Triggers**:
- Tool update via `tool.update_config` → Must invalidate cache
- Tool deprecation via `tool.deprecate` → Must invalidate cache
- Model update via `model.update` → Must invalidate cache

**Implementation Note**: ToolGateway must subscribe to registry change notifications

### 7. Latency Budget Breakdown

**Total Target**: <50ms for RBAC + registry lookups

**Components**:
- ToolRegistry.getTool() (cached): <1µs
- ToolRegistry.getTool() (DB query): <5ms
- ModelRegistry.getModel() (cached): <1µs
- ModelRegistry.getModel() (DB query): <5ms
- RBAC validation (in-memory): <1ms
- Total (cached): ~1ms
- Total (cold): ~11ms

**Implementation Note**: Monitor P95/P99 latencies in Loki, optimize slow queries

---

## Interface Contracts

### 1. ToolRegistry Module Interface

```typescript
interface IToolRegistry {
  // Tool CRUD
  getTool(toolId: string): Promise<ToolRegistryDocument | null>;
  queryTools(filter: ToolFilter): Promise<ToolRegistryDocument[]>;
  importTool(tool: BitBratTool, source: ToolSource): Promise<void>;
  updateToolConfig(toolId: string, config: Partial<ToolConfig>): Promise<void>;
  deprecateTool(toolId: string, reason: string): Promise<void>;
  disableTool(toolId: string, reason: string): Promise<void>;

  // Health
  updateToolHealth(toolId: string, health: ToolHealthUpdate): Promise<void>;
  getToolHealth(toolId: string): Promise<ToolHealth>;

  // Deduplication
  findDuplicateTools(canonicalName: string): Promise<ToolRegistryDocument[]>;
}

interface ToolFilter {
  source?: ToolSource | ToolSource[];
  status?: 'active' | 'deprecated' | 'disabled';
  category?: string;
  tags?: string[];
  costTier?: string;
  modelId?: string;  // Filter by model RBAC
  userRoles?: string[];  // Filter by user RBAC
}
```

### 2. ModelRegistry Module Interface

```typescript
interface IModelRegistry {
  // Model CRUD
  getModel(modelId: string): Promise<ModelRegistryDocument | null>;
  listModels(filter: ModelFilter): Promise<ModelRegistryDocument[]>;
  registerModel(model: ModelDefinition): Promise<void>;
  updateModel(modelId: string, updates: Partial<ModelDefinition>): Promise<void>;
  deprecateModel(modelId: string, reason: string): Promise<void>;

  // Capabilities
  getModelCapabilities(modelId: string): Promise<ModelCapabilities>;
  getTrustScore(modelId: string, scope: string): Promise<TrustScores | null>;

  // Tool Access
  validateModelToolAccess(modelId: string, toolId: string): Promise<AccessResult>;
}

interface ModelFilter {
  provider?: string | string[];
  tier?: ModelTier | ModelTier[];
  status?: 'active' | 'deprecated' | 'experimental';
  capabilities?: Partial<ModelCapabilities>;  // e.g., {toolCalling: true}
}
```

### 3. ToolObserver Module Interface

```typescript
interface IToolObserver {
  // Metrics Queries (Loki)
  getToolMetrics(toolId: string, window: TimeWindow): Promise<ToolMetrics>;
  getModelMetrics(modelId: string, window: TimeWindow): Promise<ModelMetrics>;
  getToolErrorRate(toolId: string, window: TimeWindow): Promise<number>;
  getToolP95Latency(toolId: string, window: TimeWindow): Promise<number>;

  // Health Checks
  checkToolHealth(toolId: string): Promise<ToolHealthStatus>;
  getRecentErrors(toolId: string, limit: number): Promise<ErrorEvent[]>;

  // Correlation Tracing
  getToolInvocationsByCorrelation(correlationId: string): Promise<ToolInvocation[]>;
}

interface TimeWindow {
  start?: string;  // ISO8601
  end?: string;    // ISO8601
  duration?: string;  // e.g., "5m", "1h", "24h"
}
```

### 4. ToolGateway Module Interface

```typescript
interface IToolGateway {
  // Tool Execution
  execute(
    toolId: string,
    args: any,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  // Tool Discovery (RBAC-filtered)
  listAvailableTools(
    userRoles: string[],
    modelId: string
  ): Promise<BitBratTool[]>;

  // RBAC Validation
  validateToolAccess(
    toolId: string,
    userRoles: string[],
    modelId: string
  ): Promise<AccessResult>;

  // MCP Client Management
  connectToMcpServer(serverName: string, config: McpConnectionConfig): Promise<void>;
  disconnectFromMcpServer(serverName: string): Promise<void>;
  getMcpServerStatus(serverName: string): Promise<McpServerStatus>;
}

interface AccessResult {
  allowed: boolean;
  reason?: string;
  restrictions?: string[];
}
```

---

## MCP Tool Catalog (tool-orchestrator exposure)

**Exposure**: platform-only (not exposed to domain agents)

**Tool Categories**:

### Tool Management (ToolRegistry module)
- `tool.import` - Import tool from MCP server or Bit
- `tool.update_config` - Update tool configuration
- `tool.deprecate` - Mark tool as deprecated
- `tool.disable` - Disable tool (block invocations)
- `tool.get_metrics` - Get tool performance metrics (delegates to ToolObserver)
- `tool.list` - List all tools (filterable by source, status, category, RBAC)
- `tool.get` - Get single tool details

### Model Management (ModelRegistry module)
- `model.register` - Register new model
- `model.update` - Update model metadata
- `model.deprecate` - Mark model as deprecated
- `model.list` - List all models (filterable by provider, tier, capabilities)
- `model.get` - Get single model details
- `model.get_trust_scores` - Get multi-dimensional trust scores

### Observability (ToolObserver module)
- `observer.tool_metrics` - Query Loki for tool metrics
- `observer.model_metrics` - Query Loki for model metrics
- `observer.tool_health` - Check tool health status
- `observer.recent_errors` - Get recent error events
- `observer.trace_correlation` - Get all tool invocations by correlationId

### Server Management (ToolGateway module)
- `server.connect` - Connect to MCP server
- `server.disconnect` - Disconnect from MCP server
- `server.status` - Get MCP server connection status
- `server.list` - List all registered MCP servers

**Implementation Note**: All tools delegate to appropriate module via in-process method calls

---

## Testing Strategy

### 1. Unit Tests (Per Module)

**ToolRegistry Module**:
- Tool import (MCP, Bit, composition)
- Deduplication logic (exact match, schema mismatch)
- RBAC filtering (user + model constraints)
- Health tracking updates

**ModelRegistry Module**:
- Model registration
- Capability queries
- Trust score retrieval and scope matching
- Tool access validation

**ToolObserver Module**:
- Loki query construction
- Metric aggregation
- Error rate calculation
- P95 latency queries

**ToolGateway Module**:
- Dual-layer RBAC validation
- LRU cache behavior (hit/miss/invalidation)
- MCP client connection management
- Tool execution orchestration

### 2. Integration Tests (Module Interactions)

**Scenario 1: Tool Import Flow**
1. Admin calls `tool.import` via MCP
2. ToolGateway delegates to ToolRegistry
3. ToolRegistry connects to MCP server
4. ToolRegistry stores tool in platform_tool_registry
5. ToolGateway invalidates cache
6. Verify: tool.list returns new tool

**Scenario 2: Model-Based RBAC Enforcement**
1. llm-bot calls `tool.execute` with modelId='gpt-3.5-turbo'
2. ToolGateway queries ToolRegistry.getTool() (in-process)
3. ToolGateway queries ModelRegistry.getModel() (in-process)
4. ToolGateway validates user roles
5. ToolGateway validates model tier (tool requires 'premium', model is 'basic')
6. Verify: RBAC denial with clear reason

**Scenario 3: Composition Registration**
1. User calls `composition.register` with modelId='gpt-4'
2. CompositionRegistry extracts tool IDs
3. CompositionRegistry calls ToolGateway.validateToolAccess() for each tool
4. All tools accessible by gpt-4
5. CompositionRegistry stores composition with registeredBy='gpt-4'
6. Verify: Composition registered successfully

**Scenario 4: Observability Pipeline**
1. llm-bot executes tool via tool-orchestrator
2. ToolGateway logs event to Loki
3. Wait for Promtail ingestion
4. Admin calls `observer.tool_metrics`
5. ToolObserver queries Loki
6. Verify: Metrics include invocation event

### 3. End-to-End Tests (Agent-Dev Contexts)

**Test Scenarios**:
1. **Happy Path**: User message → llm-bot → tool execution → response
2. **RBAC Denial**: Basic model tries premium tool → Denied
3. **Tool Import**: New MCP server → Auto-import → Tools available
4. **Composition RBAC**: Register composition → Validate constituent tools
5. **Model Upgrade**: User switches to premium model → More tools available
6. **Metrics Query**: Tool invocation → Loki ingestion → Metrics retrieval

**Validation**:
- Use `fleet.logs` to verify event logging
- Use `fleet.trace` to verify correlationId propagation
- Use MCP tools to query tool/model registry
- Use Grafana to visualize metrics

---

## Risk Assessment

### High Risk

**1. PostgreSQL Performance at Scale**
- **Risk**: Slow queries on 10k+ tools with complex JSONB filtering
- **Mitigation**: Comprehensive indexes (GIN on JSONB), query optimization
- **Monitor**: P95/P99 query latencies in production

**2. LRU Cache Invalidation Bugs**
- **Risk**: Stale cache serving outdated RBAC config
- **Mitigation**: Thorough testing of invalidation paths
- **Monitor**: Cache hit/miss ratios, invalidation event logs

**3. Model-Based RBAC Complexity**
- **Risk**: Hard to debug permission denials
- **Mitigation**: Clear error messages with reason codes
- **Monitor**: RBAC denial logs, user support tickets

### Medium Risk

**4. Loki Cardinality Explosion**
- **Risk**: Too many unique label combinations → High memory usage
- **Mitigation**: Limit labels (service, toolId, modelId, status, correlationId only)
- **Monitor**: Loki cardinality metrics

**5. Tool Deduplication Edge Cases**
- **Risk**: Schema mismatch between identical tools
- **Mitigation**: Admin workflow for conflict resolution
- **Monitor**: Deduplication rejection logs

### Low Risk

**6. Trust Score Scope Matching**
- **Risk**: Complex matching logic for multi-scope trust profiles
- **Mitigation**: Fallback to 'general' scope, clear validation rules
- **Monitor**: Trust score validation logs

---

## Success Metrics

### Implementation Phase Success

**Phase 1 (Foundation)**:
- ✅ tool-orchestrator Bit deployed
- ✅ PostgreSQL schemas created and migrated
- ✅ 10+ models seeded in model_registry
- ✅ Basic tool import working (manual + automatic)

**Phase 2 (Model-Based RBAC)**:
- ✅ llm-bot passing modelId in all tool invocations
- ✅ Dual-layer RBAC enforcement (user + model)
- ✅ Model tier restrictions working
- ✅ Trust score validation working

**Phase 3 (Observability)**:
- ✅ Loki/Promtail deployed and ingesting logs
- ✅ ToolObserver queries returning accurate metrics
- ✅ Grafana dashboards showing tool/model metrics

**Phase 4 (Cutover)**:
- ✅ All tool invocations routed through tool-orchestrator
- ✅ tool-gateway deprecated and removed
- ✅ Zero RBAC-related user complaints

### Operational Success (Post-Launch)

**Performance**:
- P95 tool registry lookup < 10ms
- P95 RBAC validation < 1ms
- P95 end-to-end tool invocation < 100ms (including external MCP call)

**Reliability**:
- Tool import success rate > 99%
- RBAC validation accuracy > 99.9% (no false denials)
- Cache hit ratio > 90%

**Observability**:
- 100% tool invocations logged to Loki
- Correlation tracing success rate > 99%
- Grafana dashboards rendering < 5s

**Security**:
- Zero privilege escalation incidents
- Zero RBAC bypass incidents
- All tool access denials logged and auditable

---

## Next Sprint: Implementation Planning

### Objectives

1. **Break Down Architecture into Sprintable Tasks**
   - Define 6 implementation sprints (1-2 weeks each)
   - Assign tasks to each sprint
   - Identify dependencies and critical path

2. **Create Detailed Implementation Plans**
   - Code structure (directory layout, module boundaries)
   - API contracts (TypeScript interfaces)
   - Database migration scripts
   - Test suites (unit, integration, e2e)

3. **Define Acceptance Criteria**
   - Per-sprint deliverables
   - Testing requirements
   - Performance benchmarks
   - Deployment checklist

4. **Identify Blockers and Unknowns**
   - Technical unknowns (e.g., Loki query performance)
   - External dependencies (e.g., PostgreSQL schema changes)
   - Resource constraints (e.g., agent-dev context capacity)

### Recommended Sprint Breakdown

**Sprint 1-2: Foundation (tool-orchestrator + ToolRegistry + ModelRegistry)**
- Create tool-orchestrator Bit skeleton
- Implement ToolRegistry module (PostgreSQL backend)
- Implement ModelRegistry module (PostgreSQL backend)
- Seed model registry with well-known models
- Basic MCP tool exposure

**Sprint 3-4: Model-Based RBAC (Dual-layer validation + Context propagation)**
- Extend ToolExecutionContext (add modelId, remove agentName)
- Implement ToolGateway module (RBAC validation)
- Update llm-bot to pass modelId
- Update reflex to pass modelId
- Implement trust score validation

**Sprint 5: Observability (ToolObserver + Loki integration)**
- Deploy Loki/Promtail stack
- Implement ToolObserver module
- Add event logging to ToolGateway
- Create Grafana dashboards
- Test correlation tracing

**Sprint 6: Validation & Cutover (Testing + Migration)**
- Integration testing in agent-dev
- Load testing (10k tools, 100 models)
- Update all tool-invoking services
- Cutover from tool-gateway to tool-orchestrator
- Deprecate and remove tool-gateway

### Key Artifacts to Create

**Per-Sprint**:
1. **Execution Plan** - Detailed task breakdown with time estimates
2. **API Contracts** - TypeScript interfaces for all public APIs
3. **Migration Scripts** - Database schema creation/updates
4. **Test Plans** - Unit/integration/e2e test scenarios
5. **Deployment Checklist** - Agent-dev validation steps

**Cross-Sprint**:
1. **Code Structure Map** - Directory layout and module organization
2. **Dependency Graph** - Task dependencies and critical path
3. **Risk Mitigation Plan** - Contingencies for high/medium risks
4. **Performance Baseline** - Target metrics and measurement strategy

---

## Questions for Implementation Planning Sprint

### Technical Clarifications

1. **PostgreSQL Connection Pooling**:
   - How many concurrent connections per service?
   - Connection pool configuration (min/max)?
   - Connection timeout strategy?

2. **Loki Retention Policy**:
   - How long to retain tool invocation logs?
   - Log rotation strategy?
   - Backup/export requirements?

3. **Cache Warming Strategy**:
   - Pre-warm cache on tool-orchestrator startup?
   - Periodic background refresh?
   - Cache persistence across restarts?

4. **Model Registry Seeding**:
   - Static seed data (YAML file)?
   - Dynamic seed (API calls to providers)?
   - How often to refresh model capabilities?

5. **Error Handling**:
   - Fail-open or fail-closed on RBAC validation errors?
   - Retry strategy for transient DB failures?
   - Graceful degradation if Loki unavailable?

### Process Questions

1. **Testing Approach**:
   - Test-first (TDD) or test-after?
   - Code coverage targets?
   - Integration test frequency?

2. **Deployment Strategy**:
   - Deploy all modules together or incrementally?
   - Blue/green deployment or rolling update?
   - Rollback plan if issues discovered?

3. **Documentation Requirements**:
   - API documentation format (JSDoc, OpenAPI)?
   - User-facing documentation (MCP tool usage)?
   - Runbook for operational tasks?

4. **Performance Testing**:
   - Synthetic load generation or real traffic replay?
   - Load test environment (agent-dev or dedicated)?
   - Performance regression detection strategy?

---

## Key Contacts and Resources

### Technical Resources

**Architecture Reference**:
- Primary: `planning/sprint-55-h17jpp/technical-architecture.md`
- Type Definitions: `src/types/tools.ts`, `src/types/events.ts`
- Current Implementation: `src/apps/tool-gateway.ts`, `src/common/mcp/`

**External Documentation**:
- MCP Specification: https://spec.modelcontextprotocol.io/
- PostgreSQL JSONB: https://www.postgresql.org/docs/current/datatype-json.html
- Loki LogQL: https://grafana.com/docs/loki/latest/query/
- AI SDK: https://sdk.vercel.ai/docs

### Platform Context

**BitBrat Architecture**:
- `architecture.yaml` - Single source of truth for service definitions
- `CLAUDE.md` - Platform coding standards and patterns
- `documentation/concepts/platform-flow.md` - Event lifecycle

**Deployment**:
- `tools/brat/` - Platform CLI for fleet management
- `infrastructure/docker-compose/` - Local development stack
- Agent-dev contexts - Ephemeral testing environments

### Sprint Protocol

**Sprint Workflow**:
- `AGENTS.md` - Sprint protocol (planning → execution → validation)
- Sprint MCP tools - `start-sprint`, `update-sprint-status`, `complete-sprint`
- Planning directory - `planning/sprint-*/` artifacts

---

## Conclusion

Sprint 55 successfully delivered a comprehensive **Technical Architecture** for the Tool-Centric Platform Redesign with Model-Based RBAC. The approved architecture represents a fundamental shift from server-centric to tool-centric design, replacing agent-based permissions with model-based permissions.

**Critical Success Factors**:
1. ✅ **Unified tool-orchestrator** replaces 3-service architecture (zero network overhead)
2. ✅ **Model-Based RBAC** enables cost control and security tiers
3. ✅ **PostgreSQL persistence** replaces in-memory storage
4. ✅ **Loki observability** provides comprehensive metrics
5. ✅ **Clean interfaces** enable modular implementation
6. ✅ **query-analyzer clarification** prevents implementation confusion

**Next Sprint Focus**: Convert this architecture into actionable implementation plans with detailed task breakdowns, API contracts, test strategies, and deployment checklists.

**Document Status**: APPROVED - Ready for Implementation Planning

---

**End of Sprint 55 Completion Document**
