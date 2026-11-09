# Tool-Centric Platform Implementation Plan

**Sprint**: 56 (sprint-56-rqadsk)
**Owner**: christophernavta
**Date**: 2026-11-08
**Status**: Draft - Pending Approval
**Based On**: [Sprint 55 Technical Architecture](../sprint-55-h17jpp/technical-architecture.md)

---

## Executive Summary

This implementation plan breaks down the Sprint 55 Technical Architecture into 6 executable sprints for coding agents. The plan transforms the current **server-centric tool-gateway** into a **tool-centric tool-orchestrator** with model-based RBAC, enabling granular permissions, per-tool metrics, and composition-aware security.

### Key Transformation

| Aspect | Current (Sprint 55 Before) | Target (Sprint 61+ After) |
|--------|---------------------------|---------------------------|
| **Service** | tool-gateway (monolith) | tool-orchestrator (4 modules) |
| **Tool Storage** | In-memory Map (ephemeral) | PostgreSQL DocumentStore (persistent) |
| **RBAC Model** | Agent-based (llm-bot, query-analyzer) | **Model-based** (gpt-4, claude-sonnet, reflex) |
| **Model Registry** | None (hardcoded in llm-bot) | PostgreSQL model_registry collection |
| **Observability** | Basic error logs | Loki + structured events (tool.invocation) |
| **Metrics** | Server-level only | Per-tool + per-model (Loki) |
| **Context Type** | `ToolExecutionContext.agentName` | `ToolExecutionContext.modelId` |
| **Event Topics** | None (no tool events) | None (logs to Loki, not NATS) |

### Implementation Timeline

**Total Duration**: 6 sprints (11-17 weeks)
**Sprints**: 57-62
**Completion Target**: End of Q1 2027

**Note**: Timeline reduced by ~1 week due to existing Loki + Promtail infrastructure (no deployment needed in Sprint 59)

### Event Publication

**IMPORTANT**: This implementation does NOT introduce new NATS event topics. All observability is achieved through:
- **Structured JSON logs** to Loki (via stdout → Promtail)
- **New event type**: `tool.invocation` (Sprint 59) for metrics, tracing, and RBAC auditing
- **No message bus changes** - tool-orchestrator does not publish to NATS

See [Section 2A: Event Publication Summary](#2a-event-publication-summary) and [Section 3A: Event Schema](#section-3a-event-schema---tool-invocation-logging) for complete details.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Architecture Mapping](#2-architecture-mapping)
   - 2A. [Event Publication Summary](#2a-event-publication-summary)
3. [Sprint Breakdown](#3-sprint-breakdown)
   - 3A. [Event Schema - Tool Invocation Logging](#section-3a-event-schema---tool-invocation-logging)
4. [Task Dependencies & Critical Path](#4-task-dependencies--critical-path)
5. [Acceptance Criteria Per Sprint](#5-acceptance-criteria-per-sprint)
6. [Testing Strategy](#6-testing-strategy)
7. [Risk Mitigation](#7-risk-mitigation)
8. [Migration Path](#8-migration-path)
9. [Success Metrics](#9-success-metrics)
10. [Open Questions](#10-open-questions)

---

## 1. Current State Analysis

### 1.1 Current Implementation Locations

**tool-gateway** (src/apps/tool-gateway.ts):
- ~26,440 tokens (too large, monolithic)
- Responsibilities:
  - In-memory ToolRegistry (Map-based)
  - McpClientManager (MCP transport)
  - RbacEvaluator (agent-based only)
  - CompositionRegistry + CompositionExecutor (Sprint 41)
  - MCP server registration handler
  - Progress update tool (Sprint 22)
  - Composition admin MCP tools

**ToolRegistry** (src/services/llm-bot/tools/registry.ts):
- Simple Map<string, BitBratTool> implementation
- No persistence (lost on restart)
- 153 lines total
- Shared by tool-gateway and llm-bot

**RbacEvaluator** (src/common/mcp/rbac.ts):
- Agent-based RBAC only (checks `agentAllowlist`)
- 92 lines total
- No model-level permissions

**ToolExecutionContext** (src/types/tools.ts:9-22):
- Current fields:
  - `userRoles: string[]` ✓ Keep
  - `userId?: string` ✓ Keep
  - **`agentName?: string`** ❌ Remove
  - `correlationId?: string` ✓ Keep
  - `signal?: AbortSignal` ✓ Keep
  - `sessionId?: string` ✓ Keep
- Missing: **`modelId: string`** (required for model-based RBAC)

**PostgreSQL Infrastructure**:
- Migration 023: `documents` table already exists
- GIN index on JSONB `data` column
- Used by CompositionRegistry (Sprint 41)
- Ready for ToolRegistry + ModelRegistry

**llm-bot** (src/apps/llm-bot-service.ts):
- Uses `McpClientProfile` for tool invocation
- Hardcoded model selection (gpt-4.1-mini default)
- No `modelId` passed to tool execution context

### 1.2 What Already Exists (Don't Rebuild)

✅ **PostgreSQL DocumentStore**:
- Table: `documents` (collection, id, data JSONB)
- GIN indexes for fast JSONB queries
- Used by compositions

✅ **CompositionRegistry + CompositionExecutor**:
- Already in tool-gateway
- PostgresCompositionStore backend
- Can be migrated to tool-orchestrator

✅ **MCP Infrastructure**:
- McpClientManager for external servers
- RegistryWatcher for server discovery
- Transport abstraction (HTTP, stdio)

✅ **Progress Feedback System**:
- agent.sendProgressUpdate tool
- Claim check for event retrieval
- Feedback middleware

✅ **NATS Messaging**:
- Event-driven orchestration
- Routing slips
- At-least-once delivery

✅ **Loki + Promtail Observability Stack**:
- Loki deployed and operational
- Promtail shipping logs from all Bits
- JSON structured logging already in use
- Ready for tool invocation event logging

### 1.3 What Needs to Be Built (New)

🆕 **tool-orchestrator Bit**:
- Replace tool-gateway (phased migration)
- 4 internal modules (ToolRegistry, ModelRegistry, ToolObserver, ToolGateway)
- MCP tools for tool/model management

🆕 **ModelRegistry Module**:
- PostgreSQL model_registry collection
- Model security profiles (roles, tier, trust scores)
- Capability tracking

🆕 **ToolRegistry Module** (Enhanced):
- PostgreSQL platform_tool_registry collection
- Persistent storage (not in-memory)
- Dual-layer RBAC metadata

🆕 **ToolObserver Module**:
- Loki integration for metrics queries (infrastructure already exists)
- Per-tool + per-model tracking
- Health monitoring

🆕 **Model-Based RBAC**:
- Dual-layer evaluation (User × Model)
- Trust score validation
- Model tier enforcement

🆕 **Tool Invocation Event Logging**:
- Structured event schema for tool invocations
- Loki label configuration for tool/model metrics
- Grafana dashboards for visualization

🆕 **Migration Scripts**:
- PostgreSQL schema for tool/model registries
- Model seeding (gpt-4, claude-opus, etc.)
- Tool import from existing in-memory registry

---

## 2. Architecture Mapping

### 2.1 Module Ownership Matrix

| Concern | Current Owner | Target Owner (Sprint 61) |
|---------|---------------|--------------------------|
| Tool metadata storage | ToolRegistry (in-memory) | ToolRegistry module (PostgreSQL) |
| Tool CRUD operations | ToolRegistry + tool-gateway | ToolRegistry module |
| Tool import pipeline | tool-gateway onMessage handler | ToolRegistry module |
| Tool RBAC validation | RbacEvaluator (agent-based) | ToolGateway module (User × Model) |
| Tool execution | tool-gateway McpClientManager | ToolGateway module |
| Model catalog | None (hardcoded in llm-bot) | ModelRegistry module (PostgreSQL) |
| Model RBAC | None | ModelRegistry module |
| Tool metrics | None | ToolObserver module (Loki) |
| Tool health checks | Basic logging | ToolObserver module |
| Composition registry | tool-gateway CompositionRegistry | tool-orchestrator (migrated) |
| Composition execution | tool-gateway CompositionExecutor | tool-orchestrator (migrated) |
| MCP client management | McpClientManager | ToolGateway module (McpClientManager) |
| MCP server registry | Firestore/PostgreSQL mcp_servers | PostgreSQL mcp_server_registrations |

### 2.2 File Structure Map

**Current** → **Target**:

```
src/apps/tool-gateway.ts (~26k tokens)
  →  src/apps/tool-orchestrator-service.ts (main entry, ~500 lines)
  →  src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts (~800 lines)
  →  src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts (~600 lines)
  →  src/apps/tool-orchestrator-service/modules/models/model-registry.ts (~500 lines)
  →  src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts (~400 lines)
  →  src/apps/tool-orchestrator-service/types/*.ts (type definitions)

src/services/llm-bot/tools/registry.ts (153 lines)
  →  DEPRECATED (replaced by ToolRegistry module)
  →  Note: llm-bot will call tool-orchestrator via MCP instead

src/common/mcp/rbac.ts (92 lines)
  →  src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts (~300 lines)
  →  Implements dual-layer RBAC (User × Model)

src/types/tools.ts (118 lines)
  →  MODIFIED: ToolExecutionContext interface (add modelId, remove agentName)
  →  NEW: ToolRegistryDocument interface
  →  NEW: ModelRegistryDocument interface

src/apps/llm-bot-service.ts (200 lines shown, likely ~2k total)
  →  MODIFIED: Pass modelId in ToolExecutionContext
  →  MODIFIED: Select model and propagate through request

src/common/composition/ (11 files)
  →  MIGRATED to tool-orchestrator-service/modules/composition/ (Sprint 59)
```

### 2.3 PostgreSQL Schema Changes

**New Tables** (to be created in migrations):

1. **platform_tool_registry** (Migration 024):
   - Replaces in-memory ToolRegistry
   - Schema: See Appendix A.1 in Sprint 55 technical-architecture.md

2. **model_registry** (Migration 025):
   - New model catalog with trust scores
   - Schema: See Appendix A.2 in Sprint 55 technical-architecture.md

3. **mcp_server_registrations** (Migration 026):
   - MCP server metadata (connection config, tools_imported)
   - Schema: See Appendix A.3 in Sprint 55 technical-architecture.md

**Modified Tables**:
- None (existing tables remain unchanged)

**Migration Strategy**:
- Create new tables in Sprint 57 (Foundation)
- Seed models in Sprint 58 (Model-Based RBAC)
- Import existing tools from in-memory registry in Sprint 57

---

## 2A. Event Publication Summary

**IMPORTANT**: This implementation plan does NOT introduce new NATS event topics. All observability data is captured via **structured JSON logs** sent to Loki.

### NATS Event Topics

**No new NATS topics are introduced.** The tool-orchestrator will:
- **Consume**: Existing platform topics (none required for core functionality)
- **Publish**: No new topics (tool invocations logged to Loki, not NATS)

### Loki Structured Log Events

**New Event Type**: `tool.invocation` (Sprint 59)
- **Purpose**: Track all tool executions for metrics, tracing, and RBAC auditing
- **Published By**: ToolGateway module in tool-orchestrator
- **Published When**: After every tool execution (success, error, or RBAC denial)
- **Transport**: stdout → Promtail → Loki
- **Schema**: See Section 3A (after Sprint 59) for complete schema
- **Key Fields**:
  - Labels: service, toolId, modelId, status, correlationId
  - Metrics: durationMs, estimatedCost
  - Context: userId, sessionId, inputPreview, outputPreview
  - RBAC: rbacDecision (allowed, reason, userRoles, modelTier)

**Use Cases**:
1. **Metrics**: Tool invocation rates, error rates, P95 latency
2. **Cost Tracking**: Estimated costs per model/tool combination
3. **RBAC Auditing**: All permission denials with detailed reasons
4. **Debugging**: Correlation tracing by correlationId
5. **Health Monitoring**: Derive tool health from recent invocation success rates

**Grafana Dashboards** (Sprint 59):
- Tool Invocation Rate (by toolId, modelId)
- Error Rate & P95 Latency (by toolId)
- RBAC Denials (by reason, modelId)
- Cost Tracking (by modelId, estimated)

---

## 3. Sprint Breakdown

### Sprint 57: Foundation (tool-orchestrator + ToolRegistry + ModelRegistry)
**Duration**: 2-3 weeks
**Goal**: Create tool-orchestrator skeleton with persistent tool/model registries

**Deliverables**:
1. **tool-orchestrator Bit** - Deployable service registered in architecture.yaml
2. **PostgreSQL Schema** - Three new tables: platform_tool_registry, model_registry, mcp_server_registrations
3. **ToolRegistry Module** - Persistent tool storage with deduplication and RBAC metadata
4. **ModelRegistry Module** - Model catalog with trust scores and capabilities
5. **Seeded Model Data** - 8+ models: LLM models (gpt-4, claude-opus, etc.) + agent models (reflex)
6. **Tool Migration** - All existing tools imported from tool-gateway to PostgreSQL
7. **Basic MCP Tools** - tool.list, tool.get, model.list, model.get
8. **Migration Scripts** - Database migrations 024, 025, 026

**Tasks**:
1. ✅ **Create tool-orchestrator Bit** (3 days)
   - Use `brat bit create tool-orchestrator --profile core --exposure platform-only`
   - Basic setup() with MCP server initialization
   - No tool registration yet

2. ✅ **Implement ToolRegistry Module** (5 days)
   - Location: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`
   - Interface: `IToolRegistry` (getTool, queryTools, registerTool, etc.)
   - Storage: PostgreSQL DocumentStore (collection: `platform_tool_registry`)
   - Import pipeline: MCP schema → ToolRegistryDocument transformation
   - Deduplication logic (by canonical ID)

3. ✅ **Implement ModelRegistry Module** (4 days)
   - Location: `src/apps/tool-orchestrator-service/modules/models/model-registry.ts`
   - Interface: `IModelRegistry` (getModel, listModels, registerModel, etc.)
   - Storage: PostgreSQL DocumentStore (collection: `model_registry`)
   - Seed well-known models (gpt-4, claude-opus, gpt-3.5-turbo, etc.)

4. ✅ **Create PostgreSQL Migrations** (2 days)
   - Migration 024: platform_tool_registry table
   - Migration 025: model_registry table
   - Migration 026: mcp_server_registrations table
   - Run migrations in local environment

5. ✅ **Implement Basic MCP Tools** (3 days)
   - tool.list - List all tools (no RBAC filtering yet)
   - tool.get - Get single tool metadata
   - model.list - List all models
   - model.get - Get single model metadata
   - All delegated to appropriate modules

6. ✅ **Seed Model Registry** (1 day)
   - Create seed script: `scripts/seed-model-registry.ts`
   - LLM Models: gpt-4, gpt-4-turbo, claude-opus-3.5, claude-sonnet-3.5, gpt-3.5-turbo (tier='basic'/'premium')
   - Deterministic Agent Models: reflex (tier='deterministic', modelType='rule-based')
   - Include trust scores, capabilities, cost data
   - Configure reflex with trust scores optimized for reliability (100% reliability, 0% creativity)
   - Run on tool-orchestrator startup (if empty)

7. ✅ **Import Existing Tools** (2 days)
   - Read tools from current tool-gateway in-memory registry
   - Transform to ToolRegistryDocument format
   - Insert into platform_tool_registry
   - Preserve existing RBAC (user roles only for now)

**Acceptance Criteria**:
- ✅ tool-orchestrator Bit deploys successfully
- ✅ PostgreSQL tables created and indexed
- ✅ Model registry seeded with 8+ well-known models
- ✅ Existing tools imported from tool-gateway
- ✅ MCP tools (tool.list, tool.get, model.list, model.get) functional
- ✅ No breaking changes to existing services (tool-gateway still operational)

**Testing**:
- Unit tests for ToolRegistry + ModelRegistry modules
- Integration test: Deploy to agent-dev, verify MCP tools work
- Validation: Use bitbrat-dev MCP client to query tool/model lists

---

### Sprint 58: Model-Based RBAC (Dual-Layer Validation + Context Propagation)
**Duration**: 2-3 weeks
**Goal**: Implement dual-layer RBAC (User × Model) and propagate modelId through requests

**Deliverables**:
1. **Updated ToolExecutionContext** - modelId field added (required), agentName removed (breaking change)
2. **ToolGateway Module** - Tool execution orchestration with dual-layer RBAC enforcement
3. **RbacValidator** - Dual-layer validation logic (User × Model) with 20+ test scenarios
4. **Model Tier Enforcement** - Premium tools restricted to premium models, system tools to system tier
5. **Trust Score Validation** - Tools require minimum model trust scores per dimension
6. **Updated llm-bot** - Passes actual LLM modelId (gpt-4, claude-opus, etc.) in all tool invocations
7. **Updated reflex** - Passes modelId='reflex' for direct tool execution (registered as deterministic agent model)
8. **RBAC Test Suite** - Comprehensive test coverage for all permission scenarios (LLM + deterministic)
9. **Clear Error Messages** - All RBAC denials include detailed reason codes

**Tasks**:
1. ✅ **Extend ToolExecutionContext** (1 day)
   - Location: `src/types/tools.ts`
   - Add `modelId: string` (required)
   - Remove `agentName?: string` (deprecated)
   - Update all callsites to provide modelId

2. ✅ **Implement ToolGateway Module** (5 days)
   - Location: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
   - Interface: `IToolGateway` (execute, validateToolAccess, listAvailableTools)
   - RBAC validation: Dual-layer (User × Model)
   - LRU cache for tool/model metadata (5min TTL)
   - McpClientManager integration (for external MCP servers)

3. ✅ **Implement Dual-Layer RBAC Validator** (4 days)
   - Location: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`
   - Algorithm: Sprint 55 Section 6.3
   - Checks:
     - User required roles / denied roles
     - Model required roles / denied roles
     - Model tier restrictions
     - Model trust thresholds (optional)
   - Return: `{ allowed: boolean, reason?: string }`

4. ✅ **Update llm-bot to Pass modelId** (3 days)
   - Location: `src/apps/llm-bot-service.ts`
   - Extract model ID from LLM provider config
   - Create ToolExecutionContext with modelId
   - Pass to all tool invocations

5. ✅ **Implement Model Tier Enforcement** (2 days)
   - In ToolGateway module
   - Check tool.rbac.modelTiers.allowed / denied
   - Deny if model tier not in allowed list
   - Example: Image generation tool restricted to 'premium' tier

6. ✅ **Implement Trust Score Validation** (3 days)
   - In RbacValidator
   - Check tool.rbac.minTrustThresholds
   - Match on trust scope (default: 'tool-use')
   - Compare scores (reliability, fidelity, integrity, calibration)

7. ✅ **Update reflex to Pass modelId** (2 days)
   - Location: `src/apps/reflex-service.ts`
   - Use modelId: 'reflex' for all tool executions (reflex registered as a model)
   - reflex executes tools directly (deterministic), not via LLM
   - Pass modelId in ToolExecutionContext when calling tool-orchestrator
   - RBAC enforced via reflex model permissions (tier='deterministic')
   - Enables per-agent tool permissions and metrics tracking

8. ✅ **Create RBAC Testing Suite** (3 days)
   - Test cases:
     - User has role, model lacks role → DENIED
     - User lacks role, model has role → DENIED
     - Both have roles → ALLOWED
     - Model tier not allowed → DENIED
     - Trust score below threshold → DENIED
   - Use agent-dev for integration testing

**Acceptance Criteria**:
- ✅ ToolExecutionContext has modelId field (required)
- ✅ llm-bot passes modelId in all tool invocations
- ✅ Dual-layer RBAC validation functional
- ✅ Model tier enforcement working (premium tools blocked for basic models)
- ✅ Trust score validation working
- ✅ All RBAC denials logged with clear reasons
- ✅ Backward compatibility: tool-gateway still operational (legacy agent support)

**Testing**:
- Unit tests for RbacValidator (20+ test cases)
- Integration tests: Deploy to agent-dev, test RBAC scenarios
- Validation: Send messages via bitbrat-dev, verify denials for basic models

---

### Sprint 59: Observability (ToolObserver + Loki Integration)
**Duration**: 1.5-2 weeks
**Goal**: Integrate with existing Loki infrastructure for tool-centric metrics and tracing

**Note**: Loki and Promtail are already deployed and operational. This sprint focuses on integrating tool-orchestrator with the existing observability stack.

**Deliverables**:
1. **ToolObserver Module** - Loki integration for metrics queries and aggregation
2. **Tool Invocation Event Logging** - Structured events with toolId, modelId, status, durationMs
3. **Loki Label Configuration** - Labels: service, toolId, modelId, status, correlationId, level
4. **Metrics MCP Tools** - tool.get_metrics, model.get_metrics, tool.trace_request, tool.get_health
5. **Grafana Dashboards** - 4 dashboards: Invocation Rate, Error Rate/Latency, RBAC Denials, Cost Tracking
6. **Health Tracking** - Tool registry updated with health status from Loki queries
7. **Verified Loki Integration** - Confirmed compatibility with existing infrastructure (no disruption)
8. **Correlation Tracing** - End-to-end request tracing by correlationId

**Tasks**:
1. ✅ **Verify Loki Configuration** (0.5 days)
   - Confirm Promtail is scraping JSON logs from all Bits
   - Verify existing label configuration
   - Document current Loki retention policy
   - Validate log ingestion is working

2. ✅ **Implement ToolObserver Module** (4 days)
   - Location: `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts`
   - Interface: `IToolObserver` (queryToolMetrics, traceToolInvocation, getToolHealth)
   - Loki client with LogQL queries
   - Metric aggregation (invocations, errors, latencies)
   - Use existing Loki endpoint (no new deployment)

3. ✅ **Add Event Logging to ToolGateway** (3 days)
   - Log all tool invocations to Loki via existing structured logging
   - **NOT a new NATS topic** - uses existing JSON structured logging to stdout
   - Promtail picks up logs and forwards to Loki
   - Event type: 'tool.invocation' (new log event type)
   - Schema (see detailed schema in Section 3A below):
     - Loki labels: service, toolId, modelId, status, level, correlationId
     - Log fields: timestamp, durationMs, inputPreview, outputPreview, errorMessage, userId, rbacDecision
   - Ensure Promtail picks up new event types

4. ✅ **Implement Tool Metrics MCP Tools** (2 days)
   - tool.get_metrics - Query Loki for tool metrics
   - model.get_metrics - Query Loki for model metrics
   - tool.trace_request - Trace by correlationId
   - tool.get_health - Derive health from recent events

5. ✅ **Create Grafana Dashboards** (3 days)
   - Dashboard 1: Tool Invocation Rate (by toolId, modelId)
   - Dashboard 2: Error Rate & P95 Latency (by toolId)
   - Dashboard 3: RBAC Denials (by reason, modelId)
   - Dashboard 4: Cost Tracking (by modelId, estimated)
   - Import to existing Grafana instance

6. ✅ **Update Health Tracking** (2 days)
   - ToolRegistry stores lightweight health status
   - Updated from ToolObserver queries (every 5 min)
   - Fields: lastInvocationAt, lastSuccessAt, lastErrorAt, status

**Acceptance Criteria**:
- ✅ ToolObserver successfully queries existing Loki instance
- ✅ ToolObserver queries return accurate metrics
- ✅ All tool invocations logged with structured events
- ✅ Grafana dashboards render tool/model metrics
- ✅ Correlation tracing works (follow request by correlationId)
- ✅ Tool health derived from Loki event stream
- ✅ No disruption to existing Loki/Promtail infrastructure

**Testing**:
- Integration test: Deploy to agent-dev, send 100 messages
- Verify: Loki contains 100+ tool invocation events
- Validation: Query tool.get_metrics, verify counts match
- Dashboard smoke test: Render all 4 Grafana dashboards
- Verify: Existing Loki queries still work (no breaking changes)

---

### Section 3A: Event Schema - Tool Invocation Logging

**IMPORTANT**: This sprint does NOT introduce new NATS event topics. Tool invocation events are **structured JSON logs** sent to stdout, collected by Promtail, and forwarded to Loki.

#### Event Type: `tool.invocation`

**When Published**:
- On every tool execution (success or failure)
- Emitted by ToolGateway module after tool execution completes
- Published to: stdout (JSON structured log) → Promtail → Loki

**Log Event Schema**:

```typescript
{
  // Loki Labels (indexed for fast querying)
  service: string;           // 'tool-orchestrator'
  level: string;             // 'info' | 'error'
  eventType: string;         // 'tool.invocation'
  toolId: string;            // 'get_weather', 'send_message', etc.
  modelId: string;           // 'gpt-4', 'claude-opus-3.5', 'reflex', etc.
  status: string;            // 'success' | 'error' | 'denied'
  correlationId: string;     // Request correlation ID

  // Log Message Fields (JSON body)
  timestamp: string;         // ISO 8601 timestamp
  message: string;           // Human-readable summary
  durationMs: number;        // Tool execution duration
  toolName: string;          // Human-readable tool name
  modelName: string;         // Human-readable model name
  userId?: string;           // User ID (if available)
  sessionId?: string;        // Session ID (if available)

  // Input/Output (preview only, max 500 chars)
  inputPreview?: string;     // JSON string of tool input (truncated)
  outputPreview?: string;    // JSON string of tool output (truncated)

  // Error Details (if status='error')
  errorMessage?: string;     // Error message
  errorStack?: string;       // Stack trace (only in dev/staging)

  // RBAC Details (if status='denied')
  rbacDecision: {
    allowed: boolean;        // false for denials
    reason?: string;         // "User lacks role 'admin'" | "Model tier 'basic' not allowed"
    userRoles?: string[];    // User roles at time of denial
    modelTier?: string;      // Model tier at time of denial
    requiredRoles?: string[];// Required roles for tool
    deniedRoles?: string[];  // Denied roles for tool
  };

  // Cost Tracking (if available)
  estimatedCost?: {
    tokens?: number;         // Token count (for LLM models)
    costUsd?: number;        // Estimated cost in USD
  };
}
```

**Example Success Event**:
```json
{
  "service": "tool-orchestrator",
  "level": "info",
  "eventType": "tool.invocation",
  "toolId": "get_weather",
  "modelId": "gpt-4",
  "status": "success",
  "correlationId": "msg-abc-123",
  "timestamp": "2026-11-09T10:30:45.123Z",
  "message": "Tool invocation succeeded",
  "durationMs": 234,
  "toolName": "Get Weather",
  "modelName": "GPT-4",
  "userId": "user-456",
  "inputPreview": "{\"location\":\"San Francisco\"}",
  "outputPreview": "{\"temp\":68,\"condition\":\"sunny\"}",
  "rbacDecision": {
    "allowed": true
  }
}
```

**Example Denial Event**:
```json
{
  "service": "tool-orchestrator",
  "level": "info",
  "eventType": "tool.invocation",
  "toolId": "delete_database",
  "modelId": "gpt-3.5-turbo",
  "status": "denied",
  "correlationId": "msg-xyz-789",
  "timestamp": "2026-11-09T10:31:12.456Z",
  "message": "Tool invocation denied by RBAC",
  "durationMs": 2,
  "toolName": "Delete Database",
  "modelName": "GPT-3.5 Turbo",
  "userId": "user-789",
  "rbacDecision": {
    "allowed": false,
    "reason": "Model tier 'basic' not allowed for this tool (requires 'premium')",
    "userRoles": ["user", "developer"],
    "modelTier": "basic",
    "requiredRoles": ["admin"],
    "deniedRoles": []
  }
}
```

**Loki Query Examples**:

```logql
# All tool invocations for gpt-4
{service="tool-orchestrator", eventType="tool.invocation", modelId="gpt-4"}

# Error rate by tool
sum by (toolId) (rate({service="tool-orchestrator", eventType="tool.invocation", status="error"}[5m]))

# RBAC denials in last hour
{service="tool-orchestrator", eventType="tool.invocation", status="denied"} |= "denied" | json

# P95 latency for specific tool
quantile_over_time(0.95, {service="tool-orchestrator", eventType="tool.invocation", toolId="get_weather"} | json | unwrap durationMs [5m])
```

**Cardinality Considerations**:
- 6 labels total (service, level, eventType, toolId, modelId, status, correlationId)
- Estimated cardinality: ~500 tools × ~10 models × 3 statuses = ~15,000 label combinations
- Within Loki's recommended cardinality limits (< 100k)

---

### Sprint 60: Composition RBAC Integration
**Duration**: 1-2 weeks
**Goal**: Validate composition RBAC against model permissions at registration and execution

**Deliverables**:
1. **Registration-Time Validation** - Compositions validate model has access to all constituent tools
2. **Runtime RBAC Re-Validation** - Execution validates against invoking model (not registering model)
3. **RBAC Inheritance Logic** - Compositions inherit most restrictive RBAC from constituent tools
4. **Updated Composition MCP Tools** - composition.register, composition.execute, composition.list accept/use modelId
5. **Composition Metadata** - registeredBy modelId stored, RBAC requirements calculated
6. **Filtered Composition Listings** - composition.list returns only compositions accessible to model
7. **Composition RBAC Test Suite** - Tests for registration denials, execution denials, inheritance
8. **Clear Denial Messages** - Registration/execution failures explain which tool/permission blocked access

**Tasks**:
1. ✅ **Implement Registration-Time RBAC Validation** (3 days)
   - In CompositionRegistry.register()
   - Extract all tool IDs from composition steps
   - Validate MODEL has access to ALL tools
   - Reject registration if any tool inaccessible
   - Store registeredBy modelId in composition metadata

2. ✅ **Implement Runtime RBAC Validation** (2 days)
   - In CompositionExecutor.execute()
   - Re-validate all constituent tools against invoking model
   - Use invoking model's permissions (not registering model)
   - Deny execution if any tool denied

3. ✅ **Update Composition MCP Tools** (2 days)
   - composition.register - Accept modelId parameter
   - composition.execute - Accept modelId in context
   - composition.list - Filter by model RBAC
   - composition.get - Include RBAC validation status

4. ✅ **Implement Composition RBAC Inheritance** (3 days)
   - Composition inherits most restrictive RBAC from tools
   - Calculate: Union of required roles, intersection of allowed tiers
   - Store in composition metadata for quick filtering

5. ✅ **Create Composition Testing Suite** (2 days)
   - Test: Register composition with gpt-4, execute with gpt-3.5-turbo → May fail
   - Test: Composition with premium tool, basic model tries to execute → DENIED
   - Test: All tools accessible → ALLOWED

**Acceptance Criteria**:
- ✅ Registration fails if model lacks tool access
- ✅ Execution re-validates against invoking model
- ✅ Composition RBAC inherited from tools
- ✅ composition.list filtered by model permissions
- ✅ All denials logged with clear reasons

**Testing**:
- Unit tests for composition RBAC validation
- Integration test: Deploy to agent-dev, register + execute compositions
- Validation: Use different models, verify RBAC enforcement

---

### Sprint 61: Validation & Cutover (Integration Testing + Migration)
**Duration**: 2-3 weeks
**Goal**: Comprehensive testing, cutover from tool-gateway to tool-orchestrator

**Deliverables**:
1. **Validated E2E Flows** - 5 integration scenarios tested and passing (chat, RBAC, composition, upgrade, metrics)
2. **Load Test Results** - 1000 invocations, P95 < 100ms, documented performance baseline
3. **Migration Script** - scripts/migrate-to-tool-orchestrator.ts with rollback capability
4. **Production Deployment** - tool-orchestrator deployed to all environments (local, staging, production)
5. **Updated Services** - llm-bot uses LLM modelId (gpt-4, claude, etc.), reflex uses agent modelId ('reflex')
6. **Deprecated tool-gateway** - Marked deprecated in architecture.yaml, scheduled for removal Sprint 63
7. **Operational Monitoring** - Loki dashboards showing live tool/model metrics
8. **Zero-Downtime Cutover** - Phased migration with no user-facing incidents
9. **Production Validation Report** - First week monitoring results, RBAC denial analysis

**Tasks**:
1. ✅ **End-to-End Integration Testing** (5 days)
   - Deploy tool-orchestrator + all dependencies to agent-dev
   - Test scenarios:
     - User message → llm-bot → tool execution → response
     - RBAC denial (basic model, premium tool)
     - Composition registration + execution
     - Model upgrade (user switches to premium)
     - Metrics query (verify Loki data)
   - Validation: All 5 scenarios pass

2. ✅ **Load Testing** (3 days)
   - 1000 tool invocations across 10 models
   - 100 composition executions
   - Verify:
     - P95 tool registry lookup < 10ms
     - P95 RBAC validation < 1ms
     - Loki ingestion keeps up
     - No memory leaks

3. ✅ **Migration Script: tool-gateway → tool-orchestrator** (3 days)
   - Script: `scripts/migrate-to-tool-orchestrator.ts`
   - Steps:
     - Export in-memory tool registry from tool-gateway
     - Import to PostgreSQL platform_tool_registry
     - Seed model registry
     - Update architecture.yaml (swap services)
   - Rollback plan: Revert architecture.yaml, restart tool-gateway

4. ✅ **Update All Tool-Invoking Services** (1 day)
   - Services to update:
     - llm-bot (already done in Sprint 58, uses LLM modelId: gpt-4, claude-opus, etc.)
     - reflex (already done in Sprint 58, uses agent modelId: 'reflex')
   - Services NOT to update:
     - query-analyzer (direct LLM usage, no tools)
     - disposition-service (direct LLM usage)

5. ✅ **Cutover to tool-orchestrator** (2 days)
   - Update architecture.yaml: Replace tool-gateway with tool-orchestrator
   - Deploy tool-orchestrator to all environments (local, staging, production)
   - Run migration script
   - Validate: tool.list returns all tools, model.list returns all models
   - Monitor: Loki logs, Grafana dashboards, error rates

6. ✅ **Deprecate tool-gateway** (1 day)
   - Mark tool-gateway as deprecated in architecture.yaml
   - Add deprecation notice in README
   - Schedule removal for 2 sprints later (Sprint 63)

**Acceptance Criteria**:
- ✅ All integration tests pass
- ✅ Load test: 1000 invocations, P95 < 100ms
- ✅ Migration script runs successfully
- ✅ tool-orchestrator deployed to all environments
- ✅ tool-gateway deprecated (not removed yet)
- ✅ Zero RBAC-related user complaints
- ✅ Loki dashboards showing tool/model metrics

**Testing**:
- Full regression test suite
- Manual testing in agent-dev
- Production smoke test (monitor first hour closely)

---

### Sprint 62: Documentation & Cleanup
**Duration**: 1 week
**Goal**: Comprehensive documentation and final cleanup

**Deliverables**:
1. **Implementation Guide** - documentation/guides/tool-orchestrator.md (architecture, modules, RBAC, troubleshooting)
2. **API Reference** - documentation/reference/tool-orchestrator-api.md (all MCP tools, interfaces, error codes)
3. **Migration Runbook** - documentation/guides/migrate-to-tool-orchestrator.md (step-by-step, rollback, validation)
4. **Architecture Diagrams** - Updated platform-flow.md, new tool-orchestrator-architecture.md
5. **Removed Legacy Code** - tool-gateway deleted, old in-memory ToolRegistry removed
6. **Updated Configuration Files** - architecture.yaml, docker-compose.yaml cleaned of tool-gateway references
7. **Verified Documentation** - Peer-reviewed implementation guide and migration runbook
8. **Clean Codebase** - No broken references to deprecated code, all imports validated

**Tasks**:
1. ✅ **Write Implementation Guide** (2 days)
   - Document: `documentation/guides/tool-orchestrator.md`
   - Sections:
     - Architecture overview
     - Module responsibilities
     - RBAC model explanation
     - Observability setup
     - Troubleshooting

2. ✅ **Write API Reference** (2 days)
   - Document: `documentation/reference/tool-orchestrator-api.md`
   - All MCP tools with examples
   - TypeScript interfaces
   - Error codes

3. ✅ **Create Migration Runbook** (1 day)
   - Document: `documentation/guides/migrate-to-tool-orchestrator.md`
   - Step-by-step migration from tool-gateway
   - Rollback procedures
   - Validation checklist

4. ✅ **Update Architecture Diagrams** (1 day)
   - Update: `documentation/architecture/platform-flow.md`
   - Add: `documentation/architecture/tool-orchestrator-architecture.md`
   - Include: Module interactions, RBAC flow, observability pipeline

5. ✅ **Remove tool-gateway** (1 day)
   - Delete: `src/apps/tool-gateway.ts`
   - Delete: `src/services/llm-bot/tools/registry.ts` (old in-memory)
   - Update: architecture.yaml (remove tool-gateway entry)
   - Update: docker-compose.yaml (remove tool-gateway service)

**Acceptance Criteria**:
- ✅ All documentation complete and reviewed
- ✅ Migration runbook tested in agent-dev
- ✅ tool-gateway fully removed from codebase
- ✅ No broken references to deprecated code

**Testing**:
- Documentation review by another engineer
- Migration runbook dry-run in agent-dev

---

## 4. Task Dependencies & Critical Path

### 4.1 Dependency Graph

```
Sprint 57: Foundation
  ├─> Task 1: Create tool-orchestrator Bit (CRITICAL PATH)
  │   └─> Task 2: ToolRegistry Module
  │   └─> Task 3: ModelRegistry Module
  ├─> Task 4: PostgreSQL Migrations (CRITICAL PATH)
  │   └─> Task 2, 3 (blocked until migrations run)
  ├─> Task 5: Basic MCP Tools
  │   └─> Task 2, 3 (depends on modules)
  ├─> Task 6: Seed Model Registry
  │   └─> Task 3, 4 (depends on ModelRegistry + migrations)
  └─> Task 7: Import Existing Tools
      └─> Task 2, 4 (depends on ToolRegistry + migrations)

Sprint 58: Model-Based RBAC
  ├─> Task 1: Extend ToolExecutionContext (CRITICAL PATH)
  │   └─> Task 4, 5, 6, 7, 8 (all RBAC tasks depend on this)
  ├─> Task 2: ToolGateway Module (CRITICAL PATH)
  │   └─> Task 3 (RBAC validator used by gateway)
  ├─> Task 3: Dual-Layer RBAC Validator
  │   └─> Task 5, 6 (tier + trust enforcement)
  ├─> Task 4: Update llm-bot (CRITICAL PATH)
  │   └─> Task 1 (depends on context extension)
  ├─> Task 5: Model Tier Enforcement
  │   └─> Task 2, 3
  ├─> Task 6: Trust Score Validation
  │   └─> Task 2, 3
  ├─> Task 7: Update reflex
  │   └─> Task 1, Sprint 57 Task 6 (depends on context + reflex model registration)
  └─> Task 8: RBAC Testing Suite
      └─> All tasks above (integration test)

Sprint 59: Observability
  ├─> Task 1: Verify Loki Configuration (0.5 days - existing infrastructure)
  │   └─> Task 2, 3, 4 (validation before integration)
  ├─> Task 2: ToolObserver Module
  │   └─> Task 1 (depends on Loki config verification)
  ├─> Task 3: Add Event Logging
  │   └─> Sprint 58 Task 2 (ToolGateway module) + Task 1 (Loki config)
  ├─> Task 4: Implement Metrics MCP Tools
  │   └─> Task 2, 3
  ├─> Task 5: Create Grafana Dashboards
  │   └─> Task 1, 3 (depends on Loki config + event logging)
  └─> Task 6: Update Health Tracking
      └─> Task 2 (ToolObserver queries)

Sprint 60: Composition RBAC
  ├─> Task 1: Registration-Time Validation
  │   └─> Sprint 58 Task 3 (RBAC validator)
  ├─> Task 2: Runtime Validation
  │   └─> Sprint 58 Task 2, 3 (ToolGateway + RBAC)
  ├─> Task 3: Update Composition MCP Tools
  │   └─> Task 1, 2
  ├─> Task 4: RBAC Inheritance
  │   └─> Task 1 (composition metadata)
  └─> Task 5: Composition Testing Suite
      └─> All tasks above (integration test)

Sprint 61: Validation & Cutover
  ├─> Task 1: End-to-End Testing
  │   └─> Sprint 57-60 (all previous sprints)
  ├─> Task 2: Load Testing
  │   └─> Sprint 57-60
  ├─> Task 3: Migration Script
  │   └─> Sprint 57 (ToolRegistry + ModelRegistry)
  ├─> Task 4: Update Services
  │   └─> Sprint 58 (model-based RBAC)
  ├─> Task 5: Cutover (CRITICAL PATH)
  │   └─> Task 1, 2, 3, 4 (all validation complete)
  └─> Task 6: Deprecate tool-gateway
      └─> Task 5 (after cutover)

Sprint 62: Documentation & Cleanup
  ├─> Task 1: Implementation Guide
  │   └─> Sprint 57-61 (all implementation complete)
  ├─> Task 2: API Reference
  │   └─> Sprint 57-61
  ├─> Task 3: Migration Runbook
  │   └─> Sprint 61 Task 3 (migration script)
  ├─> Task 4: Architecture Diagrams
  │   └─> Sprint 57-61
  └─> Task 5: Remove tool-gateway
      └─> Sprint 61 Task 6 (after deprecation period)
```

### 4.2 Critical Path

**Sprints 57-62** (all critical for completion):

1. **Sprint 57 Task 1** → Create tool-orchestrator Bit
2. **Sprint 57 Task 4** → PostgreSQL Migrations
3. **Sprint 57 Task 2** → ToolRegistry Module
4. **Sprint 57 Task 3** → ModelRegistry Module
5. **Sprint 58 Task 1** → Extend ToolExecutionContext
6. **Sprint 58 Task 2** → ToolGateway Module
7. **Sprint 58 Task 4** → Update llm-bot
8. **Sprint 59 Task 2** → ToolObserver Module (integrate with existing Loki)
9. **Sprint 59 Task 3** → Event Logging
10. **Sprint 61 Task 5** → Cutover to tool-orchestrator

**Total Critical Path Duration**: ~15 weeks (reduced from 16 weeks due to existing Loki infrastructure)

---

## 5. Acceptance Criteria Per Sprint

### Sprint 57: Foundation
- [ ] tool-orchestrator Bit created and registered in architecture.yaml
- [ ] PostgreSQL migrations (024, 025, 026) run successfully
- [ ] ToolRegistry module implements IToolRegistry interface
- [ ] ModelRegistry module implements IModelRegistry interface
- [ ] Model registry seeded with 8+ well-known models (gpt-4, claude, etc.)
- [ ] Existing tools imported from tool-gateway to platform_tool_registry
- [ ] MCP tools functional: tool.list, tool.get, model.list, model.get
- [ ] Unit tests: 80%+ coverage for ToolRegistry + ModelRegistry
- [ ] Integration test: Deploy to agent-dev, verify MCP tools work
- [ ] tool-gateway remains operational (no breaking changes)

### Sprint 58: Model-Based RBAC
- [ ] ToolExecutionContext extended with `modelId: string`
- [ ] `agentName` field removed from ToolExecutionContext
- [ ] ToolGateway module implements dual-layer RBAC validation
- [ ] RbacValidator tests: 20+ scenarios (user/model role combinations)
- [ ] llm-bot passes modelId in all tool invocations
- [ ] Model tier enforcement: premium tools blocked for basic models
- [ ] Trust score validation: tools require minimum trust scores
- [ ] All RBAC denials logged with clear reasons
- [ ] Integration test: Deploy to agent-dev, test RBAC scenarios
- [ ] Validation: Send messages via bitbrat-dev, verify denials work

### Sprint 59: Observability
- [ ] Existing Loki configuration verified and documented
- [ ] ToolObserver module successfully integrates with existing Loki instance
- [ ] ToolObserver module queries Loki via LogQL
- [ ] Tool invocations logged with: toolId, modelId, status, durationMs, correlationId
- [ ] Grafana dashboards created and imported: Tool Invocation, Error Rate, RBAC Denials, Cost
- [ ] tool.get_metrics MCP tool returns accurate metrics
- [ ] Correlation tracing works (tool.trace_request by correlationId)
- [ ] Tool health derived from Loki event stream
- [ ] Integration test: 100 messages → 100+ events in Loki
- [ ] Dashboard smoke test: All 4 Grafana dashboards render
- [ ] No disruption to existing Loki/Promtail infrastructure

### Sprint 60: Composition RBAC
- [ ] Composition registration validates model has tool access
- [ ] Registration fails if model lacks required tool permissions
- [ ] Composition execution re-validates against invoking model
- [ ] Composition RBAC inherited from constituent tools
- [ ] composition.list filtered by model permissions
- [ ] Composition metadata stores registeredBy modelId
- [ ] Unit tests: 10+ composition RBAC scenarios
- [ ] Integration test: Register with gpt-4, execute with gpt-3.5-turbo → May fail
- [ ] Validation: Premium composition blocked for basic model

### Sprint 61: Validation & Cutover
- [ ] End-to-end tests: 5 scenarios all pass
- [ ] Load test: 1000 invocations, P95 < 100ms
- [ ] Migration script runs successfully (tool-gateway → tool-orchestrator)
- [ ] tool-orchestrator deployed to all environments (local, staging, production)
- [ ] llm-bot passes LLM modelId (gpt-4, claude-opus, etc.)
- [ ] reflex passes agent modelId ('reflex') for deterministic tool execution
- [ ] tool-gateway deprecated (marked in architecture.yaml)
- [ ] Zero RBAC-related user complaints (monitored for 1 week)
- [ ] Loki dashboards showing tool/model metrics
- [ ] Production smoke test: First hour monitored, no errors

### Sprint 62: Documentation & Cleanup
- [ ] Implementation guide complete: `documentation/guides/tool-orchestrator.md`
- [ ] API reference complete: `documentation/reference/tool-orchestrator-api.md`
- [ ] Migration runbook complete: `documentation/guides/migrate-to-tool-orchestrator.md`
- [ ] Architecture diagrams updated
- [ ] tool-gateway removed from codebase
- [ ] Old in-memory ToolRegistry removed
- [ ] All deprecated code references fixed
- [ ] Documentation review by another engineer
- [ ] Migration runbook tested in agent-dev

---

## 6. Testing Strategy

### 6.1 Unit Testing

**Per Module**:

**ToolRegistry Module**:
- Tool import (MCP, Bit, composition)
- Deduplication logic (exact match, schema mismatch)
- RBAC filtering (user + model constraints)
- Health tracking updates
- Target: 80%+ code coverage

**ModelRegistry Module**:
- Model registration
- Capability queries
- Trust score retrieval and scope matching
- Tool access validation
- Target: 80%+ code coverage

**ToolObserver Module**:
- Loki query construction
- Metric aggregation
- Error rate calculation
- P95 latency queries
- Target: 70%+ code coverage (Loki integration mocked)

**ToolGateway Module**:
- Dual-layer RBAC validation (20+ test cases)
- LRU cache behavior (hit/miss/invalidation)
- MCP client connection management
- Tool execution orchestration
- Target: 85%+ code coverage

**RbacValidator**:
- User role checks (required, denied)
- Model role checks (required, denied)
- Model tier checks (allowed, denied)
- Trust score validation (per dimension)
- Comprehensive test matrix (User × Model combinations)
- Target: 95%+ code coverage

### 6.2 Integration Testing

**Scenario 1: Tool Import Flow**:
1. Admin calls `tool.import` via MCP
2. ToolGateway delegates to ToolRegistry
3. ToolRegistry connects to MCP server
4. ToolRegistry stores tool in platform_tool_registry
5. ToolGateway invalidates cache
6. Verify: tool.list returns new tool

**Scenario 2: Model-Based RBAC Enforcement**:
1. llm-bot calls `tool.execute` with modelId='gpt-3.5-turbo'
2. ToolGateway queries ToolRegistry.getTool() (in-process)
3. ToolGateway queries ModelRegistry.getModel() (in-process)
4. ToolGateway validates user roles
5. ToolGateway validates model tier (tool requires 'premium', model is 'basic')
6. Verify: RBAC denial with clear reason

**Scenario 3: Composition Registration**:
1. User calls `composition.register` with modelId='gpt-4'
2. CompositionRegistry extracts tool IDs
3. CompositionRegistry calls ToolGateway.validateToolAccess() for each tool
4. All tools accessible by gpt-4
5. CompositionRegistry stores composition with registeredBy='gpt-4'
6. Verify: Composition registered successfully

**Scenario 4: Observability Pipeline**:
1. llm-bot executes tool via tool-orchestrator
2. ToolGateway logs event to Loki
3. Wait for Promtail ingestion (5 seconds)
4. Admin calls `tool.get_metrics`
5. ToolObserver queries Loki
6. Verify: Metrics include invocation event

**Scenario 5: End-to-End Request Flow**:
1. User sends message: "Generate an image of a sunset"
2. ingress-egress normalizes to InternalEventV2
3. event-router attaches routing slip → llm-bot
4. llm-bot selects model (gpt-4) and creates context with modelId
5. LLM suggests tool: generate_image
6. llm-bot calls tool-orchestrator.execute(generate_image, args, { modelId: 'gpt-4' })
7. ToolGateway validates RBAC (gpt-4 has access)
8. ToolGateway executes tool via MCP
9. ToolGateway logs event to Loki
10. Result returned to llm-bot
11. llm-bot sends response via egress
12. Verify: User receives image, Loki contains event

### 6.3 End-to-End Testing (Agent-Dev)

**Test Environment**: agent-dev context with full stack deployed

**Test Scenarios** (Sprint 61):
1. **Happy Path**: User message → llm-bot → tool execution → response
2. **RBAC Denial**: Basic model tries premium tool → Denied
3. **Tool Import**: New MCP server → Auto-import → Tools available
4. **Composition RBAC**: Register composition → Validate constituent tools
5. **Model Upgrade**: User switches to premium model → More tools available
6. **Metrics Query**: Tool invocation → Loki ingestion → Metrics retrieval

**Validation Steps**:
- Use `fleet.logs` to verify event logging
- Use `fleet.trace` to verify correlationId propagation
- Use MCP tools (tool.list, model.list) to query registries
- Use Grafana to visualize metrics

### 6.4 Load Testing

**Load Profile**:
- 1000 tool invocations across 10 models
- 100 composition executions
- 50 concurrent requests

**Performance Targets**:
- P95 tool registry lookup < 10ms
- P95 RBAC validation < 1ms
- P95 end-to-end tool invocation < 100ms (including external MCP call)
- Loki ingestion keeps up (no backlog)
- No memory leaks (stable memory usage over 1 hour)

**Tools**:
- Custom load test script: `scripts/load-test-tool-orchestrator.ts`
- Use bitbrat-dev MCP client to send concurrent requests
- Monitor with Grafana dashboards

### 6.5 Regression Testing

**Pre-Cutover Validation** (Sprint 61):
- Run full test suite for llm-bot
- Run full test suite for reflex
- Verify existing MCP servers still connect
- Verify existing compositions still execute
- No breaking changes to public APIs

**Post-Cutover Monitoring** (Sprint 61):
- Monitor error rates for 1 week
- Monitor RBAC denial rates
- Monitor tool invocation latency
- User feedback collection

---

## 7. Risk Mitigation

### 7.1 High Risk Items

#### Risk 1: PostgreSQL Performance at Scale

**Risk**: Slow queries on 10k+ tools with complex JSONB filtering

**Impact**: High (tool invocations blocked, degraded user experience)

**Probability**: Medium (JSONB queries can be slow without proper indexes)

**Mitigation**:
1. Comprehensive GIN indexes on JSONB columns (Sprint 57)
2. Query optimization with EXPLAIN ANALYZE
3. LRU cache in ToolGateway (5min TTL) to reduce DB hits
4. Connection pooling (10-20 connections per service)
5. Load testing with 10k+ tools (Sprint 61)

**Monitoring**:
- P95/P99 query latencies in Loki
- PostgreSQL slow query logs
- Cache hit/miss ratios

**Rollback Plan**:
- Increase cache TTL to 15 minutes
- Add more specific indexes on commonly queried fields
- Scale PostgreSQL vertically (more CPU/RAM)

---

#### Risk 2: LRU Cache Invalidation Bugs

**Risk**: Stale cache serving outdated RBAC config

**Impact**: Critical (users get access they shouldn't, or denied when they should have access)

**Probability**: Medium (cache invalidation is notoriously hard)

**Mitigation**:
1. Thorough unit tests for cache invalidation paths (Sprint 58)
2. Cache TTL as safety net (5 minutes max staleness)
3. Manual cache clear MCP tool: `tool.cache.clear`
4. Cache invalidation on config updates (tool.update_config → invalidate)
5. Monitoring: Cache invalidation event logs

**Monitoring**:
- Cache hit/miss ratios
- Invalidation event logs (Loki)
- RBAC denial logs (detect stale cache symptoms)

**Rollback Plan**:
- Reduce cache TTL to 1 minute
- Disable cache entirely (query DB on every request)

---

#### Risk 3: Model-Based RBAC Complexity

**Risk**: Hard to debug permission denials (users confused, support tickets increase)

**Impact**: High (user frustration, increased support burden)

**Probability**: High (new permission model, users not familiar)

**Mitigation**:
1. Clear error messages with reason codes (Sprint 58)
   - Example: "Tool 'generate_image' requires model tier 'premium', but gpt-3.5-turbo is tier 'basic'"
2. RBAC denial logs with full context (user, model, tool, reason)
3. Debug tool: `tool.explain_access(toolId, userId, modelId)` → detailed explanation
4. User-facing documentation explaining model tiers
5. Support runbook with common RBAC issues

**Monitoring**:
- RBAC denial rate (alert if > 10% of requests)
- User support tickets tagged "RBAC"
- Denial reason distribution (identify common issues)

**Rollback Plan**:
- Loosen RBAC temporarily (allow all models for specific tools)
- Revert to agent-based RBAC (emergency only)

---

### 7.2 Medium Risk Items

#### Risk 4: Loki Cardinality Explosion

**Risk**: Too many unique label combinations → High memory usage in Loki

**Impact**: Medium (Loki becomes slow/unstable, dashboards unusable)

**Probability**: Medium (common Loki pitfall with unconstrained labels)

**Note**: Loki and Promtail are already deployed and operational. This risk focuses on **not disrupting existing infrastructure** while adding tool invocation labels.

**Mitigation**:
1. **Verify existing label configuration** before adding new labels (Sprint 59 Task 1)
2. Limit new labels to 6: service, toolId, modelId, status, correlationId, level
3. NO high-cardinality labels: userId, messageText, timestamps
4. Test label cardinality in agent-dev before production deployment
5. Monitor Loki cardinality metrics for impact on existing queries

**Monitoring**:
- Loki cardinality per label (existing Grafana dashboard)
- Loki memory usage (monitor for increases after tool-orchestrator deployment)
- Query performance (compare before/after metrics)
- Existing Loki queries continue working (no breaking changes)

**Rollback Plan**:
- Remove correlationId from labels (move to log body)
- Reduce label count to 4 (service, toolId, status, level)
- Disable tool invocation logging temporarily if Loki degrades

---

#### Risk 5: Tool Deduplication Edge Cases

**Risk**: Schema mismatch between identical tools from different sources

**Impact**: Medium (tool registration rejected, manual admin intervention needed)

**Probability**: Low (rare for same tool to have different schemas)

**Mitigation**:
1. Clear error message: "Tool 'get_state' already exists with different schema. Admin must resolve."
2. Admin workflow: Compare schemas, choose canonical version
3. MCP tool: `tool.resolve_duplicate(toolId, preferredSource)` → mark one as canonical
4. Deduplication logs for auditing

**Monitoring**:
- Deduplication rejection logs (Loki)
- Admin intervention rate

**Rollback Plan**:
- Allow duplicates temporarily (append source suffix: get_state_mcp, get_state_firestore)
- Manual cleanup later

---

### 7.3 Low Risk Items

#### Risk 6: Trust Score Scope Matching

**Risk**: Complex matching logic for multi-scope trust profiles

**Impact**: Low (mostly affects edge cases with custom trust scopes)

**Probability**: Low (most tools use default 'tool-use' scope)

**Mitigation**:
1. Fallback to 'general' scope if tool-specific scope not found
2. Clear validation rules documented
3. Comprehensive unit tests for scope matching

**Monitoring**:
- Trust score validation logs (Loki)
- Denials due to missing trust scope

**Rollback Plan**:
- Disable trust score validation (allow all models)
- Re-enable after fixing scope matching logic

---

## 8. Migration Path

### 8.1 Migration Strategy

**Approach**: Phased migration (tool-orchestrator deployed alongside tool-gateway, then cutover)

**Phases**:

#### Phase 1: Deploy tool-orchestrator (Sprint 57, Non-Breaking)
- Deploy tool-orchestrator Bit
- Seed PostgreSQL with tool/model metadata (LLM models: gpt-4, claude, etc. + agent models: reflex)
- Validate via MCP tools (tool.list, model.list)
- **No changes to llm-bot** (continue using tool-gateway)
- **No changes to reflex** (continue using tool-gateway)

#### Phase 2: Migrate llm-bot and reflex (Sprint 58, Feature Flag)
- Add feature flag: `ENABLE_TOOL_ORCHESTRATOR=false` (default)
- Update llm-bot to conditionally use tool-orchestrator with LLM modelId (gpt-4, claude, etc.)
- Update reflex to conditionally use tool-orchestrator with agent modelId ('reflex')
- Test in agent-dev with flag enabled
- Deploy to staging with flag disabled
- Enable flag in production after validation

#### Phase 3: Cutover (Sprint 61)
- Set `ENABLE_TOOL_ORCHESTRATOR=true` in all environments
- Monitor logs/metrics for 1 week
- Deprecate tool-gateway (mark in architecture.yaml)
- Remove tool-gateway 2 sprints later (Sprint 63)

### 8.2 Migration Script

**Script**: `scripts/migrate-to-tool-orchestrator.ts`

**Steps**:
1. Export in-memory tool registry from tool-gateway
   - Query: `tool-gateway` MCP client → `tool.list`
   - Transform: `BitBratTool` → `ToolRegistryDocument`
2. Import to PostgreSQL `platform_tool_registry`
   - Bulk insert via ToolRegistry.registerTool()
3. Seed model registry (if empty)
   - Insert 8+ well-known models
4. Update architecture.yaml
   - Replace `tool-gateway` entry with `tool-orchestrator`
   - Preserve all environment variables
5. Restart services
   - Deploy tool-orchestrator
   - Stop tool-gateway

**Rollback**:
1. Revert architecture.yaml changes
2. Restart tool-gateway
3. Verify tool.list returns all tools
4. No data loss (tool-gateway uses in-memory registry, re-populated on startup)

### 8.3 Backward Compatibility

**No Breaking Changes** (until cutover):
- tool-gateway remains operational during Sprints 57-60
- llm-bot continues using tool-gateway (until Sprint 58 feature flag enabled)
- All existing MCP servers continue working
- Existing compositions continue executing

**Breaking Changes** (at cutover, Sprint 61):
- `ToolExecutionContext.agentName` removed (replaced by `modelId`)
- Services must pass `modelId` in tool execution context
- Tools must be imported to PostgreSQL (not in-memory)
- Agent-based RBAC deprecated (model-based enforced)

### 8.4 Rollback Plan

**If Issues Discovered After Cutover**:
1. Revert architecture.yaml to tool-gateway
2. Restart tool-gateway (will re-discover tools)
3. Disable `ENABLE_TOOL_ORCHESTRATOR` flag
4. Monitor for 24 hours
5. Investigate root cause
6. Fix and retry cutover

**Data Recovery**:
- PostgreSQL has full tool/model registry (no data loss)
- Loki retains all event logs (configurable retention: 7-30 days)
- tool-gateway can be restarted with in-memory registry

---

## 9. Success Metrics

### 9.1 Implementation Phase Success

**Sprint 57 (Foundation)**:
- ✅ tool-orchestrator Bit deployed
- ✅ PostgreSQL schemas created and migrated
- ✅ 10+ models seeded in model_registry
- ✅ All existing tools imported to platform_tool_registry
- ✅ Basic tool import working (manual + automatic)

**Sprint 58 (Model-Based RBAC)**:
- ✅ llm-bot passing modelId in all tool invocations
- ✅ Dual-layer RBAC enforcement (user + model)
- ✅ Model tier restrictions working
- ✅ Trust score validation working
- ✅ 0 RBAC false denials (no bugs)

**Sprint 59 (Observability)**:
- ✅ Loki/Promtail deployed and ingesting logs
- ✅ ToolObserver queries returning accurate metrics
- ✅ Grafana dashboards showing tool/model metrics
- ✅ 100% tool invocations logged

**Sprint 60 (Composition RBAC)**:
- ✅ Composition registration validates model permissions
- ✅ Composition execution re-validates at runtime
- ✅ 0 privilege escalation via compositions

**Sprint 61 (Cutover)**:
- ✅ All tool invocations routed through tool-orchestrator
- ✅ tool-gateway deprecated and removed
- ✅ 0 RBAC-related user complaints
- ✅ P95 latency < 100ms

**Sprint 62 (Documentation)**:
- ✅ All documentation complete
- ✅ Migration runbook tested
- ✅ tool-gateway removed from codebase

### 9.2 Operational Success (Post-Launch)

**Performance**:
- P95 tool registry lookup < 10ms
- P95 RBAC validation < 1ms
- P95 end-to-end tool invocation < 100ms (including MCP call)
- Cache hit ratio > 90%

**Reliability**:
- Tool import success rate > 99%
- RBAC validation accuracy > 99.9% (no false denials)
- Loki ingestion lag < 5 seconds
- PostgreSQL query success rate > 99.99%

**Observability**:
- 100% tool invocations logged to Loki
- Correlation tracing success rate > 99%
- Grafana dashboards rendering < 5s
- Alert response time < 5 minutes

**Security**:
- 0 privilege escalation incidents
- 0 RBAC bypass incidents
- All tool access denials logged and auditable
- All high-risk tools restricted to premium models

**User Experience**:
- 0 user complaints about RBAC denials (after education)
- Clear error messages for all denials
- Support ticket volume < 5 per week (RBAC-related)

---

## 10. Open Questions

### 10.1 Technical Clarifications Needed

1. **PostgreSQL Connection Pooling**:
   - Q: How many concurrent connections per service?
   - A: Start with 10-20, monitor, adjust based on load
   - Q: Connection pool configuration (min/max)?
   - A: Min: 2, Max: 20 (configurable via env var)
   - Q: Connection timeout strategy?
   - A: 30 seconds (with exponential backoff retry)

2. **Loki Retention Policy**:
   - Q: How long to retain tool invocation logs?
   - A: 7 days (local), 30 days (production)
   - Q: Log rotation strategy?
   - A: Loki automatic compaction (configured in loki.yaml)
   - Q: Backup/export requirements?
   - A: Weekly backup to S3 (production only)

3. **Cache Warming Strategy**:
   - Q: Pre-warm cache on tool-orchestrator startup?
   - A: Yes, load top 100 most-used tools into cache
   - Q: Periodic background refresh?
   - A: No, rely on TTL expiration and lazy loading
   - Q: Cache persistence across restarts?
   - A: No, ephemeral cache (rebuilt on startup)

4. **Model Registry Seeding**:
   - Q: Static seed data (YAML file)?
   - A: Yes, `config/model-registry-seed.yaml`
   - Q: Dynamic seed (API calls to providers)?
   - A: No, manual updates only (too dynamic for auto-sync)
   - Q: How often to refresh model capabilities?
   - A: Manual refresh (quarterly), or on new model release

5. **Error Handling**:
   - Q: Fail-open or fail-closed on RBAC validation errors?
   - A: **Fail-closed** (deny access on error, for security)
   - Q: Retry strategy for transient DB failures?
   - A: Exponential backoff, 3 retries, 1s/2s/4s delays
   - Q: Graceful degradation if Loki unavailable?
   - A: **Fail-open** for observability (log error, continue execution)

### 10.2 Process Questions

1. **Testing Approach**:
   - Q: Test-first (TDD) or test-after?
   - A: Test-after (write tests after implementation, before PR)
   - Q: Code coverage targets?
   - A: 80%+ for core modules, 70%+ for others
   - Q: Integration test frequency?
   - A: Every PR (automated in CI), plus manual testing in agent-dev

2. **Deployment Strategy**:
   - Q: Deploy all modules together or incrementally?
   - A: Deploy all modules together (single Bit deployment)
   - Q: Blue/green deployment or rolling update?
   - A: Rolling update (zero-downtime, monitor first instance closely)
   - Q: Rollback plan if issues discovered?
   - A: Revert architecture.yaml, restart tool-gateway (see Section 8.4)

3. **Documentation Requirements**:
   - Q: API documentation format (JSDoc, OpenAPI)?
   - A: JSDoc for TypeScript interfaces, OpenAPI for REST API (future)
   - Q: User-facing documentation (MCP tool usage)?
   - A: Markdown in `documentation/guides/` (Sprint 62)
   - Q: Runbook for operational tasks?
   - A: `documentation/guides/tool-orchestrator-ops.md` (Sprint 62)

4. **Performance Testing**:
   - Q: Synthetic load generation or real traffic replay?
   - A: Synthetic load (custom script, controlled scenario)
   - Q: Load test environment (agent-dev or dedicated)?
   - A: Agent-dev (isolated, full stack)
   - Q: Performance regression detection strategy?
   - A: Grafana dashboards with baseline metrics, alert on P95 > 150ms

---

## Appendices

### Appendix A: PostgreSQL Schema Definitions

See Sprint 55 Technical Architecture Appendix A for full schema definitions:
- A.1: platform_tool_registry table
- A.2: model_registry table
- A.3: mcp_server_registrations table

### Appendix B: Loki Configuration

**Note**: Loki and Promtail are already deployed and operational in the BitBrat platform.

See Sprint 55 Technical Architecture Appendix B for:
- B.1: Log event schema (JSON structured logs) - to be extended for tool invocation events
- B.2: Loki label configuration - verify compatibility with existing setup
- B.3: Promtail scrape config - already in place, ensure tool-orchestrator logs are picked up
- B.4: Grafana data source setup - already configured, import new dashboards
- B.5: Example LogQL queries - for tool/model metrics queries

### Appendix C: Model-Based RBAC Examples

See Sprint 55 Technical Architecture Section 6.3 for:
- Dual-layer RBAC evaluation algorithm
- Trust score validation logic
- Model tier enforcement
- Request context propagation

### Appendix D: Sprint 55 Technical Architecture References

**Critical Sections for Implementation**:
- Section 3.4: tool-orchestrator Architecture (modules, interfaces)
- Section 6: Model-Based RBAC System (evaluation algorithm)
- Section 7: Request Flow and Tool Execution Lifecycle
- Section 8: Tool Invocation Event Log & Observability
- Section 9: mcp-compose Integration (composition RBAC)
- Section 11: Migration Strategy

**Files to Reference**:
- `planning/sprint-55-h17jpp/technical-architecture.md` (4,416 lines)
- `planning/sprint-55-h17jpp/SPRINT_COMPLETION.md` (1,037 lines)

---

## Conclusion

This implementation plan provides a comprehensive roadmap for transforming the BitBrat platform from a server-centric tool-gateway to a tool-centric tool-orchestrator with model-based RBAC. The plan is broken down into 6 executable sprints (57-62) with clear task dependencies, acceptance criteria, testing strategies, and risk mitigation plans.

**Key Success Factors**:
1. **Modular Architecture**: 4 internal modules (ToolRegistry, ModelRegistry, ToolObserver, ToolGateway) with clean interfaces
2. **Model-Based RBAC**: Dual-layer permissions (User × Model) enable cost control and security tiers
3. **Persistent Storage**: PostgreSQL-backed registries replace ephemeral in-memory storage
4. **Comprehensive Observability**: Integrates with existing Loki/Promtail infrastructure for per-tool and per-model tracking
5. **Phased Migration**: Zero-downtime cutover from tool-gateway to tool-orchestrator
6. **Leverages Existing Infrastructure**: Builds on already-deployed Loki, Promtail, PostgreSQL, and NATS

**Next Steps**:
1. Review and approve this implementation plan
2. Start Sprint 57: Foundation (create tool-orchestrator Bit, PostgreSQL migrations)
3. Execute Sprints 58-62 sequentially
4. Continuous monitoring and iteration based on feedback

**Document Status**: Draft - Pending Approval

---

**End of Implementation Plan**
