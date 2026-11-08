# Technical Architecture Document - Issues Backlog

**Document**: technical-architecture.md (Sprint 55)
**Date**: 2026-11-07
**Status**: HIGH and MEDIUM Issues RESOLVED
**Version**: 1.2

---

## Resolution Status

**✅ ALL HIGH and MEDIUM PRIORITY ISSUES RESOLVED** (18/23 issues)

**Remaining**: 5 LOW priority issues (editorial improvements)

**Changes Made**:
- ✅ Added Section 3.4: New Bits/Services (Issue 23)
- ✅ Added PROPOSED markers throughout (Issues 1-4, 7)
- ✅ Fixed delegation references to use future tense (Issues 17-18)
- ✅ Fixed metrics contradiction (Issue 9)
- ✅ Added Appendix B: PostgreSQL DDL (Issue 14)
- ✅ Added Appendix C: Loki/Promtail Configuration (Issues 15-16)
- ✅ Added current state documentation (Issues 5-6, 8)
- ✅ Marked validateToolAccess as PROPOSED (Issue 10)

---

## Executive Summary

Found **23 issues** across 8 categories:
- **10 High Priority** - ✅ ALL RESOLVED
- **8 Medium Priority** - ✅ ALL RESOLVED
- **5 Low Priority** - ⚠️ Remaining (non-blocking)

**Key Findings** (RESOLVED):
1. ✅ **NEW: No explicit "New Bits/Services" section** - RESOLVED (Added Section 3.4)
2. ✅ Document mixes current state and proposed architecture - RESOLVED (Added current state subsections)
3. ✅ Several proposed interfaces/types not marked as "PROPOSED" - RESOLVED (Added markers)
4. ✅ Some code examples contradict architectural statements - RESOLVED (Fixed metrics contradiction)
5. ✅ Missing implementation details for Phase 1 - RESOLVED (Added Appendices B & C)

---

## Category 0: Architecture Documentation (CRITICAL)

### Issue 23: No Explicit "New Bits/Services" Section
**Location**: Entire document (should be Section 3.4 or new Section 4)
**Severity**: **CRITICAL - High Priority**
**Description**: Document proposes 3 new Bits but doesn't explicitly call them out with full architectural details early in the document.

**Proposed New Bits** (from Section 13.1):
1. **tool-registry-service**
2. **model-registry-service**
3. **tool-observer-service**

**Current State**:
- Section 13.1 (line 2212-2214) mentions these services but only in Architecture Decisions section
- No dedicated subsection describing each new Bit
- No service architecture diagram
- Readers must piece together from scattered references

**What's Missing**:

**1. New Bits Overview Section** (should be Section 3.4 or 4.0)
```markdown
### 3.4 New Bits/Services (PROPOSED)

This architecture proposes **3 new Bits** to implement the tool-centric platform:

| Service | Profile | Category | MCP Exposure | Responsibility |
|---------|---------|----------|--------------|----------------|
| **tool-registry-service** | core | platform | platform-only | Tool import, CRUD, RBAC, health |
| **model-registry-service** | core | platform | platform-only | Model catalog, trust scores, capabilities |
| **tool-observer-service** | core | platform | platform-only | Loki queries, metrics, tracing |

**Architecture Diagram**:
```
Current Architecture:
┌─────────────┐
│tool-gateway │──> In-memory ToolRegistry
│             │──> McpClientManager
│             │──> RbacEvaluator
└─────────────┘

Proposed Architecture:
┌─────────────┐         ┌──────────────────┐
│tool-gateway │────────>│tool-registry-    │
│             │         │service (NEW)     │──> platform_tool_registry
│(unchanged)  │         │                  │──> Tool import pipeline
└─────────────┘         └──────────────────┘

                        ┌──────────────────┐
                        │model-registry-   │
                        │service (NEW)     │──> model_registry
                        │                  │──> Model RBAC
                        └──────────────────┘

                        ┌──────────────────┐
                        │tool-observer-    │
                        │service (NEW)     │──> Loki (queries)
                        │                  │──> Metrics API
                        └──────────────────┘
```
```

**2. Dedicated Subsection for Each New Bit**

For each new Bit, document should include:

#### tool-registry-service
```markdown
**Service Name**: tool-registry-service
**Profile**: core
**Category**: platform
**MCP Exposure**: platform-only
**Entry Point**: src/apps/tool-registry-service.ts (NEW)

**Responsibilities**:
- Manage platform_tool_registry DocumentStore collection
- Tool import pipeline (MCP servers, Bits, compositions)
- Tool CRUD operations (create, read, update, disable)
- RBAC enforcement (dual-layer: User × Model)
- Health monitoring (lightweight, via registry timestamps)
- Deduplication (by canonical ID)

**Dependencies**:
- IDocumentStore (platform_tool_registry collection)
- NATS (for receiving tool registration events)
- PostgreSQL or Firestore (backend for DocumentStore)

**Collections/Tables Owned**:
- `platform_tool_registry` (DocumentStore)
- `mcp_server_registrations` (secondary, for server metadata)

**MCP Tools Exposed** (platform-only):
- `tool.import` - Import tool from source
- `tool.update_config` - Update tool configuration
- `tool.deprecate` - Mark tool as deprecated
- `tool.disable` - Disable tool
- `tool.get_metrics` - Get tool performance metrics (queries Loki)
- `tool.list` - List all tools (filterable)
- `tool.get` - Get single tool details
- `tool.search` - Search tools by description/tags
- `tool.get_schema` - Get tool input/output schemas

**REST API** (optional):
- GET    /v1/tools
- GET    /v1/tools/:id
- POST   /v1/tools/import
- PATCH  /v1/tools/:id/config
- DELETE /v1/tools/:id
- GET    /v1/tools/:id/metrics
- POST   /v1/tools/:id/health-check

**Message Topics**:
- Consumes: (TBD - tool registration events from tool-gateway)
- Produces: (TBD - tool availability notifications)

**Configuration** (architecture.yaml):
```yaml
tool-registry-service:
  profile: core
  category: platform
  mcp:
    exposure: platform-only
  env:
    - PORT=3015
    - DATABASE_URL=${DATABASE_URL}
    - NATS_URL=${NATS_URL}
  secrets:
    - DATABASE_URL
```

**Deployment**:
- Docker: Single container
- Scaling: 1 instance (for now)
- Dependencies: PostgreSQL, NATS
```

#### model-registry-service
```markdown
**Service Name**: model-registry-service
**Profile**: core
**Category**: platform
**MCP Exposure**: platform-only
**Entry Point**: src/apps/model-registry-service.ts (NEW)

**Responsibilities**:
- Manage model_registry DocumentStore collection
- Model catalog with security profiles (roles, tier, trust)
- Model capability tracking (tool-calling, vision, streaming)
- Cost configuration (token pricing)
- Tool access policies (allowlist/denylist per model)
- Usage metrics aggregation

**Dependencies**:
- IDocumentStore (model_registry collection)
- NATS (optional, for model usage events)
- PostgreSQL or Firestore (backend for DocumentStore)

**Collections/Tables Owned**:
- `model_registry` (DocumentStore)

**MCP Tools Exposed** (platform-only):
- `model.register` - Register new model
- `model.update` - Update model config
- `model.get` - Get model details
- `model.list` - List models
- `model.get_metrics` - Model usage metrics

**Message Topics**:
- Consumes: (TBD - model usage events for metrics)
- Produces: None

**Configuration** (architecture.yaml):
```yaml
model-registry-service:
  profile: core
  category: platform
  mcp:
    exposure: platform-only
  env:
    - PORT=3016
    - DATABASE_URL=${DATABASE_URL}
  secrets:
    - DATABASE_URL
```

**Deployment**:
- Docker: Single container
- Scaling: 1 instance
- Dependencies: PostgreSQL
```

#### tool-observer-service
```markdown
**Service Name**: tool-observer-service
**Profile**: core
**Category**: platform
**MCP Exposure**: platform-only
**Entry Point**: src/apps/tool-observer-service.ts (NEW)

**Responsibilities**:
- Query Loki for tool invocation events
- Aggregate metrics (invocations, error rates, latencies)
- Trace requests by correlationId
- Health status derivation from event stream
- Alert on anomalies (error spikes, RBAC denials)

**Dependencies**:
- Loki (log aggregation system)
- LogQL (query language)

**Collections/Tables Owned**:
- None (read-only queries to Loki)

**MCP Tools Exposed** (platform-only):
- `tool.get_metrics` - Query tool metrics from Loki
- `tool.trace_request` - Trace request by correlationId
- `tool.get_health` - Get tool health status
- `tool.query_events` - Query raw events (advanced)

**Message Topics**:
- Consumes: None (queries Loki, doesn't consume events)
- Produces: None

**Configuration** (architecture.yaml):
```yaml
tool-observer-service:
  profile: core
  category: platform
  mcp:
    exposure: platform-only
  env:
    - PORT=3017
    - LOKI_URL=${LOKI_URL}
  secrets:
    - LOKI_URL
```

**Deployment**:
- Docker: Single container
- Scaling: 1 instance
- Dependencies: Loki
```

**3. Consistent Cross-References**

Throughout the document, when mentioning these services, use consistent format:
```markdown
**tool-registry-service** (Section 3.4.1)
**model-registry-service** (Section 3.4.2)
**tool-observer-service** (Section 3.4.3)
```

**Recommendation**:

**Add new Section 3.4 (or Section 4.0) before Tool Registry Design:**
```markdown
## 3.4 Proposed New Bits/Services

This architecture introduces **3 new platform Bits**:

1. **tool-registry-service** - Tool lifecycle management
2. **model-registry-service** - Model catalog and RBAC
3. **tool-observer-service** - Observability and metrics

### 3.4.1 tool-registry-service
[Full details as above]

### 3.4.2 model-registry-service
[Full details as above]

### 3.4.3 tool-observer-service
[Full details as above]

### 3.4.4 Architecture Impact

**Modified Bits** (behavior changes):
- **tool-gateway**: Delegates tool import to tool-registry-service (Section 5.3)
- **llm-bot**: Adds modelId to ToolExecutionContext (Section 6.4)
- **CompositionRegistry**: Validates RBAC against model permissions (Section 8.2)

**Unmodified Bits**:
- All other Bits continue unchanged
```

**Impact**:
- **Critical for Sprint Planning**: Implementation teams need clear service boundaries
- **Critical for Readers**: No guesswork about what's being built
- **Critical for Phase 1**: Can't start implementation without service definitions
- **Critical for Architecture.yaml**: Need to add these services to canonical config

**Related Issues**:
- Issue 2: Tool Registry section ambiguity
- Issue 3: Model Registry presented as current
- Issue 12: Service ownership unclear

---

## Category 1: Clarity Issues (Current vs Proposed)

### Issue 1: ModelTrust Type Not Marked as PROPOSED
**Location**: Section 3.3 (Lines 301-317)
**Severity**: High
**Description**: The `ModelTrust` type is introduced without clearly stating it's a PROPOSED new type, not part of the current codebase.

**Current State**: This type does NOT exist in `src/types/tools.ts`

**Recommendation**: Add clear marker:
```markdown
**PROPOSED**: Multi-dimensional trust model for LLM models
```

---

### Issue 2: Tool Registry Design Section Ambiguity
**Location**: Section 4 (Lines 476-686)
**Severity**: High
**Description**: Entire section describes PROPOSED architecture but reads like current state in many places.

**Examples**:
- Line 480: "Location: New service (**tool-registry-service**)" - "New" implies proposal, but not explicit
- Line 492: "MCP Tools (exposed by **tool-registry-service**)" - service doesn't exist yet
- Line 604: Shows implementation code without "PROPOSED" marker

**Current State**:
- No `tool-registry-service` exists
- No `platform_tool_registry` collection exists
- Current tool registry is in-memory Map (src/services/llm-bot/tools/registry.ts)

**Recommendation**: Add section header:
```markdown
## 4. Proposed Tool Registry Design (NEW)

**Status**: PROPOSED - This is new architecture, not current implementation
```

---

### Issue 3: Model Registry Presented as Current
**Location**: Section 6 (Lines 787-1275)
**Severity**: High
**Description**: Model Registry section describes proposed system without clearly marking as new.

**Current State**:
- No model registry exists in codebase
- No `model_registry` collection exists
- No `ModelRegistryDocument` interface exists in src/types/

**Verification**:
```bash
$ grep -r "model_registry" src/
# No results - only exists in technical-architecture.md
```

**Recommendation**: Add clear markers throughout Section 6

---

### Issue 4: INTERNAL_BIT_REGISTRATION_V1 Not Marked as New
**Location**: Section 9.3 (Lines 1976-1980)
**Severity**: High
**Description**: Document references `INTERNAL_BIT_REGISTRATION_V1` as if it exists.

**Current State**: This event type does NOT exist
```typescript
// src/types/events.ts - Current event types
export const INTERNAL_MCP_REGISTRATION_V1 = 'internal.mcp.registration.v1';
// INTERNAL_BIT_REGISTRATION_V1 does NOT exist
```

**Recommendation**: Clearly mark as proposed:
```markdown
**NEW**: Create `INTERNAL_BIT_REGISTRATION_V1` event type to replace...
```

---

### Issue 5: BitRegistry/BitRegistration Types Not Marked as Proposed
**Location**: Section 9.3 (Lines 1947-1972)
**Severity**: Medium
**Description**: `BitRegistration` interface presented without "PROPOSED" marker

**Current State**: These types don't exist in codebase
```bash
$ grep -r "BitRegistration" src/
# No results - only in technical-architecture.md
```

---

## Category 2: Interface/Schema Issues

### Issue 6: ToolExecutionContext Current State Not Documented
**Location**: Section 6.4 (Lines 1064-1073)
**Severity**: Medium
**Description**: Proposed `ToolExecutionContext` changes documented, but current state not clearly stated first.

**Current State** (src/types/tools.ts:9-22):
```typescript
export interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;        // EXISTS - being removed
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // modelId does NOT exist - being added
}
```

**Recommendation**: Add "Current State" subsection before showing proposed changes

---

### Issue 7: ToolInvocationEvent Not Marked as NEW
**Location**: Section 7.2 (Lines 1404-1445)
**Severity**: High
**Description**: Entire interface presented as if it exists

**Current State**: This interface does NOT exist in codebase
```bash
$ grep -r "ToolInvocationEvent" src/
# No results
```

**Recommendation**: Clear header:
```markdown
### 7.2 Tool Invocation Event Schema (PROPOSED - NEW)
```

---

### Issue 8: ModelRegistryDocument Location Unclear
**Location**: Section 6.2 (Lines 840-881)
**Severity**: Medium
**Description**: Interface shown but not clear which service implements it

**From Section 13.1**:
- tool-registry-service manages tool registry
- model-registry-service manages model registry
- But Section 6 doesn't clearly state model-registry-service location

**Recommendation**: Add explicit service ownership at start of Section 6

---

## Category 3: Code Examples vs Architecture Statements

### Issue 9: Metrics Storage Contradiction
**Location**: Section 4.3 (Lines 592 vs 630)
**Severity**: High
**Description**: Document contradicts itself on where metrics are stored

**Line 592**:
```markdown
# Note: Detailed metrics derived from invocation event log (Loki), not stored in registry
```

**Line 630** (code example):
```typescript
async updateMetrics(toolId: string, metrics: Partial<ToolRegistryDocument['metrics']>): Promise<void> {
  tool.metrics = { ...tool.metrics, ...metrics };  // ❌ But schema has no metrics field!
}
```

**ToolRegistryDocument Schema** (Lines 580-584):
```typescript
health: {
  lastInvocationAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  // NO metrics field!
}
```

**Analysis**:
- Document says metrics come from Loki (correct per architecture)
- But shows code updating non-existent `tool.metrics` field
- Schema only has `health` field with timestamps

**Recommendation**: Remove `updateMetrics` method or clarify it only updates health timestamps

---

### Issue 10: validateToolAccess Function Doesn't Exist
**Location**: Section 6.3 (Lines 936-1057)
**Severity**: Medium
**Description**: Entire function presented as if it exists

**Current State**:
- Current RBAC is in `RbacEvaluator` class (src/common/mcp/rbac.ts)
- Current method: `isAllowedTool(tool, serverConfig, context): boolean`
- No `validateToolAccess` function exists

**Recommendation**: Mark as PROPOSED and rename to avoid confusion:
```markdown
### 6.3 RBAC Evaluation Algorithm (PROPOSED)

**NOTE**: This replaces current `RbacEvaluator.isAllowedTool()` method
```

---

### Issue 11: updateToolHealth Function Undefined
**Location**: Section 7.3 (Line 1542, 1560)
**Severity**: Low
**Description**: Function called but never defined

```typescript
// Line 1542
await updateToolHealth(toolId, { lastSuccessAt: new Date().toISOString() });
// Line 1560
await updateToolHealth(toolId, {
  lastErrorAt: new Date().toISOString(),
  status: deriveHealthStatus(toolId),
});
```

**Question**: Is this part of Tool Registry API? Should be defined in Section 4.2

**Recommendation**: Add to Tool Registry API or inline the implementation

---

## Category 4: Internal Inconsistencies

### Issue 12: Service Ownership Unclear
**Location**: Section 13.1 vs Sections 4, 6, 7
**Severity**: Medium
**Description**: Section 13.1 defines 3 new services but earlier sections don't consistently reference them

**Section 13.1 Decision**:
```markdown
**New Services**:
- tool-registry-service: Manages platform_tool_registry and tool import pipeline
- model-registry-service: Manages model_registry and model metadata
- tool-observer-service: Queries Loki for metrics, health checks, and observability
```

**Issues**:
- Section 4.1 (line 480): Only mentions tool-registry-service
- Section 6: Never explicitly states model-registry-service owns it
- Section 7.5 (line 1660): First mention of tool-observer-service

**Recommendation**: Add service ownership table at start of Section 3 or 4

---

### Issue 13: MCP Tool Ownership After Fixes
**Location**: Sections 4.2, 6.5, 7.5
**Severity**: Low
**Description**: After recent fixes, tool ownership is correct but could be more prominent

**Current State** (after your fixes):
- ✅ Section 4.2: "exposed by **tool-registry-service**"
- ✅ Section 6.5: "exposed by **model-registry-service**"
- ✅ Section 7.5: "exposed by **tool-observer-service**"

**Recommendation**: These are correct now. Consider adding summary table for quick reference.

---

## Category 5: Missing Implementation Details

### Issue 14: No PostgreSQL DDL Provided
**Location**: Section 10.1 (Phase 1: Tool Registry Foundation)
**Severity**: High
**Description**: Document says "Initialize DocumentStore with proper indexes" but no schema provided

**Phase 1 Task**:
```markdown
- Create DocumentStore collections for `platform_tool_registry` and `model_registry`
- Initialize DocumentStore with proper indexes (PostgreSQL: GIN indexes for arrays, Firestore: composite indexes)
```

**Missing**:
- PostgreSQL table DDL for `platform_tool_registry`
- PostgreSQL table DDL for `model_registry`
- Index definitions (which fields need GIN indexes?)
- Firestore index definitions

**Recommendation**: Add Appendix B: Database Schemas with full DDL

---

### Issue 15: Loki Configuration Not Specified
**Location**: Section 7 (Observability)
**Severity**: Medium
**Description**: Document assumes Loki/Promtail exists but doesn't verify or configure

**Questions**:
1. Is Loki currently deployed in BitBrat?
2. What Promtail configuration is needed for label extraction?
3. How are labels mapped from log JSON to Loki labels?

**From Section 7.2** (Line 1449-1458):
```typescript
// Loki Labels (indexed for fast filtering):
{
  tool: toolId,
  model: modelId,
  status: 'success' | 'error' | 'timeout' | 'rbac_denied',
  tier: modelTier,
  source: toolSource,
  service: sourceService,
  correlation_id: correlationId
}
```

**Recommendation**: Add Appendix C: Loki/Promtail Configuration

---

### Issue 16: Event Logging Integration Unclear
**Location**: Section 7.3 (Lines 1463-1498)
**Severity**: Medium
**Description**: Flow diagram shows Promtail shipping to Loki but doesn't explain integration

**Questions**:
1. Do Bits use structured JSON logging already?
2. Does Promtail auto-discover all Bit containers?
3. What's the label extraction configuration?

**Recommendation**: Add subsection on Promtail setup and Bit logger configuration

---

## Category 6: References to Non-Existent Code

### Issue 17: Delegation to Non-Existent Service (Section 5.3)
**Location**: Lines 762-767
**Severity**: High
**Description**: Document describes delegation pattern that doesn't exist yet

**Document States**:
```markdown
3. **NEW**: tool-gateway delegates to **tool-registry-service**:
   - tool-registry-service extracts tool metadata
   - Calls import pipeline for each tool
   - Applies Bit-specific defaults (RBAC, config)
```

**Current State**:
- tool-gateway currently handles this directly (src/apps/tool-gateway.ts)
- No tool-registry-service exists
- No delegation pattern implemented

**Recommendation**: Mark as PROPOSED behavior:
```markdown
3. **PROPOSED**: tool-gateway will delegate to **tool-registry-service** (new):
```

---

### Issue 18: Section 9.3 Delegation Pattern
**Location**: Line 1978
**Severity**: High
**Description**: Same issue - describes future behavior as current

**Document States**:
```markdown
3. tool-gateway notifies **tool-registry-service** of new Bit
4. **tool-registry-service** imports tools from Bit
```

**Current State**: This flow doesn't exist yet

**Recommendation**: Use future tense: "will notify", "will import"

---

## Category 7: Minor Improvements

### Issue 19: Editorial Tone in Current State Section
**Location**: Section 1.3 (Line 95-96)
**Severity**: Low
**Description**: Current state section includes editorial commentary

**Current Text**:
```typescript
agentAllowlist?: string[];   // Agent RBAC (coarse-grained, WRONG MODEL)
```

**Recommendation**: Keep current state neutral, save critique for Section 2:
```typescript
agentAllowlist?: string[];   // Agent RBAC (coarse-grained)
```

Then in Section 2.1, explain why this is the wrong model.

---

### Issue 20: Missing Trust Score Sources
**Location**: Section 6.2 (Lines 822-839) and 6.5 (Lines 1096-1264)
**Severity**: Low
**Description**: Default model trust scores provided but no source cited

**Example**:
```yaml
- id: gpt-4
  trust:
    - scope: general
      scores:
        reliability: 95
        fidelity: 95
        integrity: 90
        calibration: 85
```

**Question**: Where do these scores come from?
- Benchmarks? (which ones?)
- Observed behavior?
- Manual estimates?

**Recommendation**: Add footnote or reference to trust score methodology

---

### Issue 21: No Error Handling for Model Not Found
**Location**: Section 6.3 (Line 944)
**Severity**: Low
**Description**: RBAC algorithm doesn't handle missing model gracefully in all paths

**Code**:
```typescript
const model = modelRegistry.getModel(modelId);
if (!model) return { allowed: false, reason: 'model_not_found' };
```

**Issue**: Later in the function (line 1030), code accesses `model.trust` without re-checking null

**Recommendation**: Add defensive null check or restructure early returns

---

### Issue 22: Composition RBAC Derivation Edge Case
**Location**: Section 8.2 (Lines 1817-1838)
**Severity**: Low
**Description**: `deriveCompositionRbac` uses intersection for allowed tiers but doesn't handle empty arrays

**Code** (Line 1834):
```typescript
modelTiers: {
  allowed: intersection(tools.map(t => t.rbac.modelTiers.allowed)),  // What if all are empty []?
  denied: union(tools.map(t => t.rbac.modelTiers.denied))
}
```

**Edge Case**: If all constituent tools have `allowed: []` (meaning all tiers allowed), intersection is `[]` (meaning no tiers allowed!)

**Recommendation**: Handle empty array as "all tiers allowed" semantic

---

## Summary Table

| ID | Category | Severity | Location | Issue | Status |
|----|----------|----------|----------|-------|--------|
| **23** | **Architecture** | **CRITICAL** | **Document-wide** | **No explicit "New Bits/Services" section** | ✅ RESOLVED |
| 1 | Clarity | High | 3.3:301-317 | ModelTrust not marked PROPOSED | ✅ RESOLVED |
| 2 | Clarity | High | 4:476-686 | Tool Registry section ambiguity | ✅ RESOLVED |
| 3 | Clarity | High | 6:787-1275 | Model Registry not marked PROPOSED | ✅ RESOLVED |
| 4 | Clarity | High | 9.3:1976-1980 | INTERNAL_BIT_REGISTRATION_V1 not marked new | ✅ RESOLVED |
| 5 | Clarity | Medium | 9.3:1947-1972 | BitRegistry types not marked PROPOSED | ✅ RESOLVED |
| 6 | Interface | Medium | 6.4:1064-1073 | ToolExecutionContext current state missing | ✅ RESOLVED |
| 7 | Interface | High | 7.2:1404-1445 | ToolInvocationEvent not marked NEW | ✅ RESOLVED |
| 8 | Interface | Medium | 6.2:840-881 | ModelRegistryDocument service unclear | ✅ RESOLVED |
| 9 | Code Example | High | 4.3:592,630 | Metrics storage contradiction | ✅ RESOLVED |
| 10 | Code Example | Medium | 6.3:936-1057 | validateToolAccess doesn't exist | ✅ RESOLVED |
| 11 | Code Example | Low | 7.3:1542,1560 | updateToolHealth undefined | ⚠️ Pending |
| 12 | Consistency | Medium | 13.1 vs 4,6,7 | Service ownership unclear | ✅ RESOLVED |
| 13 | Consistency | Low | 4.2,6.5,7.5 | MCP tool ownership (fixed) | ✅ RESOLVED |
| 14 | Implementation | High | 10.1 | No PostgreSQL DDL | ✅ RESOLVED |
| 15 | Implementation | Medium | 7 | Loki configuration missing | ✅ RESOLVED |
| 16 | Implementation | Medium | 7.3:1463-1498 | Event logging integration unclear | ✅ RESOLVED |
| 17 | Non-Existent | High | 5.3:762-767 | Delegation to non-existent service | ✅ RESOLVED |
| 18 | Non-Existent | High | 9.3:1978 | Section 9.3 delegation pattern | ✅ RESOLVED |
| 19 | Minor | Low | 1.3:95-96 | Editorial tone in current state | ⚠️ Pending |
| 20 | Minor | Low | 6.2,6.5 | Trust score sources missing | ⚠️ Pending |
| 21 | Minor | Low | 6.3:944,1030 | Model not found edge case | ⚠️ Pending |
| 22 | Minor | Low | 8.2:1817-1838 | Composition RBAC empty array edge case | ⚠️ Pending |

---

## Recommendations by Priority

### CRITICAL Priority ✅ COMPLETE
1. ✅ **Add "New Bits/Services" Section** - Created Section 3.4 with full architectural details for all 3 new Bits (Issue 23)
   - ✅ Include service architecture diagram
   - ✅ Document each Bit: profile, category, exposure, responsibilities, dependencies
   - ✅ List collections/tables owned
   - ✅ List MCP tools exposed
   - ✅ Add architecture.yaml configuration
   - ✅ Document message topics
   - ✅ Define deployment requirements

### High Priority ✅ COMPLETE
2. ✅ **Add PROPOSED markers** throughout Sections 3-9 (Issues 1-4, 7, 9)
3. ✅ **Fix metrics contradiction** - Renamed to updateHealth, clarified health-only (Issue 9)
4. ✅ **Add PostgreSQL DDL** - Added Appendix B with full DDL (Issue 14)
5. ✅ **Fix delegation references** - Marked as future behavior with PROPOSED (Issues 17-18)

### Medium Priority ✅ COMPLETE
6. ✅ **Add current state documentation** before proposed changes (Issues 5-6, 8)
7. ✅ **Clarify service ownership** - Addressed by Section 3.4 (Issue 12)
8. ✅ **Document Loki setup** - Added Appendix C with Promtail config (Issues 15-16)
9. ✅ **Mark validateToolAccess as PROPOSED** - Added current state and PROPOSED marker (Issue 10)

### Low Priority (Nice to Have)
10. **Improve tone** - Make current state neutral (Issue 19)
11. **Add trust score sources** - Cite benchmarks or methodology (Issue 20)
12. **Handle edge cases** - Model not found, empty arrays (Issues 21-22)
13. **Define updateToolHealth** - Add to API or inline (Issue 11)

---

## Verification Checklist

To verify fixes, check:

### Current State Accuracy
- [x] BitBratTool interface (src/types/tools.ts:27-48) - ✅ Correct
- [x] ToolRegistry implementation (src/services/llm-bot/tools/registry.ts) - ✅ Correct
- [x] ToolExecutionContext (src/types/tools.ts:9-22) - ⚠️ Has `agentName`, no `modelId`
- [x] RbacEvaluator (src/common/mcp/rbac.ts) - ✅ Correct agent-based RBAC
- [x] File paths - ✅ All correct
- [x] Event types (src/types/events.ts) - ⚠️ `INTERNAL_BIT_REGISTRATION_V1` doesn't exist

### Proposed Architecture Clarity
- [ ] **CRITICAL: Explicit "New Bits/Services" section added (Issue 23)**
- [ ] All new types marked "PROPOSED"
- [ ] All new services clearly identified with full architectural details
- [ ] All new message types marked "NEW"
- [ ] Clear distinction: current state vs future state
- [ ] Service architecture diagram showing current vs proposed

### Implementation Readiness
- [ ] PostgreSQL DDL for all new collections
- [ ] Loki/Promtail configuration documented
- [ ] Migration path validated
- [ ] All code examples use correct schema fields

---

---

## Appendix: New Bits Quick Reference

For quick reference, the 3 new Bits proposed:

| Bit Name | Port | Profile | Exposure | Primary Responsibility |
|----------|------|---------|----------|------------------------|
| **tool-registry-service** | 3015 | core | platform-only | Tool lifecycle & RBAC |
| **model-registry-service** | 3016 | core | platform-only | Model catalog & trust |
| **tool-observer-service** | 3017 | core | platform-only | Metrics & observability |

**Collections/Tables**:
- `platform_tool_registry` (owned by tool-registry-service)
- `model_registry` (owned by model-registry-service)
- `mcp_server_registrations` (owned by tool-registry-service)

**External Dependencies**:
- PostgreSQL (for DocumentStore)
- NATS (for message bus)
- Loki (for log aggregation - tool-observer-service only)

**Next Steps After Fixing Issue 23**:
1. Add these services to `architecture.yaml`
2. Create Dockerfiles (likely using standard `Dockerfile.service`)
3. Create service entry points in `src/apps/`
4. Add to docker-compose for local development
5. Update Phase 1 implementation plan with service creation tasks

---

**Document Version**: 1.1
**Last Updated**: 2026-11-07
**Verified Against**: `/Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-55-h17jpp/`
**Changelog**:
- v1.1 (2026-11-07): Added Issue 23 - New Bits/Services documentation
- v1.0 (2026-11-07): Initial verification pass
