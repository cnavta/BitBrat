# Gap Analysis: Administrative MCP Tools for Composition Management

**Date**: 2026-09-03
**Sprint**: 41 (COMP-017)
**Author**: Claude (Agent)
**Status**: Identified Gap - Requires Implementation

---

## Executive Summary

The current Sprint 41 implementation includes REST API endpoints for composition management but lacks corresponding **administrative MCP tools**. This creates an architectural inconsistency with BitBrat's design principles and limits composition management capabilities.

**Impact**: Medium
**Effort**: 3-4 hours
**Recommendation**: Add new task COMP-017A to Phase 3

---

## Current State

### What We Have ✅

**REST API Endpoints** (COMP-015):
- `POST /v1/compositions` - Register new composition
- `GET /v1/compositions` - List all compositions
- `GET /v1/compositions/stats` - Get registry statistics
- `GET /v1/compositions/:name/:version` - Get specific version
- `GET /v1/compositions/:name` - Get latest version
- `DELETE /v1/compositions/:name/:version` - Delete composition

**MCP Tool Exposure** (COMP-014):
- Registered compositions appear as executable MCP tools
- Tool ID = `composition.metadata.name`
- Callable via MCP `tools/call` protocol
- Schema from `composition.spec.inputSchema`

### What We're Missing ❌

**Administrative MCP Tools**: No MCP-based way to manage compositions

Missing tools:
1. `composition.register` - Register new composition from YAML/JSON
2. `composition.list` - List all registered compositions
3. `composition.get` - Get specific composition by name/version
4. `composition.delete` - Delete a composition
5. `composition.stats` - Get registry statistics
6. `composition.validate` - Validate composition without registering (optional)

---

## Gap Analysis

### 1. Architectural Inconsistency

**BitBrat Design Principle**: Every subsystem exposes MCP control plane

**Current Examples**:
```typescript
// Bit control plane (all services)
bit.info()         // Get service information
bit.config.get()   // Get configuration
bit.flags.get()    // Get feature flags
bit.health()       // Health check

// Scheduler control plane
scheduler.create()   // Create schedule
scheduler.list()     // List schedules
scheduler.delete()   // Delete schedule

// Claim-check control plane
claim.event.retrieve()  // Retrieve event
claim.event.status()    // Get status
claim.blob.store()      // Store blob

// Compositions - MISSING ❌
composition.register()   // NOT IMPLEMENTED
composition.list()       // NOT IMPLEMENTED
composition.delete()     // NOT IMPLEMENTED
```

**Gap**: Compositions break this pattern by only exposing REST API.

### 2. Functional Limitations

**Current Limitations**:

1. **LLM Administration**: LLMs cannot manage compositions via MCP
   - Must use REST API (not part of standard tool interface)
   - Cannot dynamically create/update compositions in response to user requests

2. **Inter-Service Communication**: Other Bits cannot manage compositions
   - Services communicate via MCP, not HTTP
   - Reflex, scheduler, and other services can't register compositions

3. **Tooling Integration**: CLI tools prefer MCP over REST
   - `brat` CLI uses MCP for control plane operations
   - Compositions require separate REST client implementation

4. **Developer Experience**: Inconsistent management interface
   - Some subsystems: MCP tools
   - Compositions: REST API only
   - Confusion about which method to use

### 3. Use Cases

**Enabled by MCP Admin Tools**:

#### Use Case 1: LLM-Driven Composition Creation
```
User: "Create a composition that greets users and shows their points"

LLM: <calls composition.register with generated YAML>

System: Composition registered as "user_greeting_with_points"

LLM: "I've created the composition. You can now use it with /greet-user"
```

**Current State**: LLM cannot create compositions (no MCP tool).

#### Use Case 2: Dynamic Workflow Management
```typescript
// Scheduler creates composition for recurring task
await toolGateway.invokeTool('composition.register', {
  definition: {
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: { name: 'daily_report' },
    spec: { /* ... */ }
  }
});

// Schedule execution
await toolGateway.invokeTool('scheduler.create', {
  name: 'daily_report_job',
  toolId: 'daily_report',
  cron: '0 9 * * *'
});
```

**Current State**: Requires external REST calls (breaks MCP-only workflow).

#### Use Case 3: CLI Administration
```bash
# Current (REST API):
curl -X POST http://localhost:3002/v1/compositions \
  -H "Content-Type: application/json" \
  -d @composition.yaml

# Desired (MCP):
brat composition register --file composition.yaml
# Uses MCP internally, consistent with other brat commands
```

### 4. Comparison with Other Subsystems

| Subsystem | MCP Tools | REST API | Notes |
|-----------|-----------|----------|-------|
| Bit Control | ✅ bit.* | ❌ | MCP-only (standard) |
| Scheduler | ✅ scheduler.* | ❌ | MCP-only |
| Claim-Check | ✅ claim.* | ❌ | MCP-only |
| **Compositions** | ❌ | ✅ | **REST-only (inconsistent)** |

**Finding**: Compositions are the ONLY subsystem with REST API but no MCP tools.

---

## Proposed Solution

### New Task: COMP-017A

**Title**: Implement administrative MCP tools for composition management
**Phase**: 3 (Tool-Gateway Integration)
**Priority**: P0 (architectural consistency)
**Effort**: 3h
**Dependencies**: COMP-015 (REST API)

### Required Tools

#### 1. `composition.register`

**Purpose**: Register a new composition from YAML/JSON source

**Input Schema**:
```typescript
{
  definition: {
    apiVersion: string,
    kind: 'Composition',
    metadata: { name: string, description: string, ... },
    spec: { inputSchema, steps, return, ... }
  }
}
```

**Output**:
```typescript
{
  id: string,
  name: string,
  version: number,
  contentHash: string,
  createdAt: string
}
```

**Implementation**: Wraps existing REST POST /v1/compositions logic

---

#### 2. `composition.list`

**Purpose**: List all registered compositions

**Input Schema**:
```typescript
{
  filter?: {
    name?: string,
    status?: 'active' | 'draft' | 'archived'
  },
  limit?: number,
  offset?: number
}
```

**Output**:
```typescript
{
  compositions: [
    {
      id: string,
      name: string,
      version: number,
      description: string,
      contentHash: string,
      createdAt: string,
      updatedAt: string
    }
  ],
  total: number
}
```

**Implementation**: Wraps existing REST GET /v1/compositions logic

---

#### 3. `composition.get`

**Purpose**: Get a specific composition by name and optional version

**Input Schema**:
```typescript
{
  name: string,
  version?: number  // Latest if omitted
}
```

**Output**:
```typescript
{
  id: string,
  metadata: { name, description, version, ... },
  spec: { inputSchema, steps, return, ... },
  contentHash: string,
  createdAt: string
}
```

**Implementation**: Wraps existing REST GET /v1/compositions/:name/:version logic

---

#### 4. `composition.delete`

**Purpose**: Delete a specific composition version

**Input Schema**:
```typescript
{
  name: string,
  version: number
}
```

**Output**:
```typescript
{
  success: boolean,
  message: string,
  deleted: {
    name: string,
    version: number
  }
}
```

**Implementation**: Wraps existing REST DELETE /v1/compositions/:name/:version logic

---

#### 5. `composition.stats`

**Purpose**: Get composition registry statistics

**Input Schema**:
```typescript
{}  // No parameters
```

**Output**:
```typescript
{
  totalCompositions: number,
  totalVersions: number,
  compositionsByName: {
    [name: string]: number  // version count
  }
}
```

**Implementation**: Wraps existing REST GET /v1/compositions/stats logic

---

#### 6. `composition.validate` (Optional - Stretch Goal)

**Purpose**: Validate a composition definition without registering

**Input Schema**:
```typescript
{
  definition: CompositionDefinition
}
```

**Output**:
```typescript
{
  valid: boolean,
  errors: Array<{
    code: string,
    message: string,
    path?: string
  }>,
  warnings: Array<{
    code: string,
    message: string,
    path?: string
  }>
}
```

**Implementation**: Uses CompositionCompiler.validate() without persisting

---

## Implementation Plan

### File Changes

**Primary File**: `src/apps/tool-gateway.ts`

**Changes Required**:

1. **Add MCP tool registrations** (in `setup()` method):
   ```typescript
   // Register administrative composition tools
   if (this.compositionsEnabled) {
     this.registerCompositionAdminTools();
   }
   ```

2. **Implement `registerCompositionAdminTools()` method**:
   ```typescript
   private registerCompositionAdminTools(): void {
     // composition.register
     this.registerTool(
       'composition.register',
       'Register a new composition from YAML/JSON definition',
       compositionRegisterSchema,
       this.handleCompositionRegister.bind(this)
     );

     // composition.list
     this.registerTool(
       'composition.list',
       'List all registered compositions',
       compositionListSchema,
       this.handleCompositionList.bind(this)
     );

     // ... other tools
   }
   ```

3. **Implement handler methods**:
   - `handleCompositionRegister()`
   - `handleCompositionList()`
   - `handleCompositionGet()`
   - `handleCompositionDelete()`
   - `handleCompositionStats()`
   - `handleCompositionValidate()` (optional)

4. **Reuse existing REST logic**: Handlers call same internal methods as REST endpoints

### Test Changes

**File**: `src/apps/tool-gateway.test.ts`

**New Tests** (6-8 tests):
1. Test `composition.register` tool registration
2. Test `composition.register` execution (valid composition)
3. Test `composition.register` execution (invalid composition)
4. Test `composition.list` tool execution
5. Test `composition.get` tool execution
6. Test `composition.delete` tool execution
7. Test `composition.stats` tool execution
8. Test graceful degradation (compositions disabled)

### Integration Tests

**File**: `src/apps/__tests__/composition-mcp-admin.integration.test.ts` (new)

**Tests** (6 tests):
1. Register composition via MCP → verify in registry
2. List compositions via MCP → verify results
3. Get composition via MCP → verify full definition
4. Delete composition via MCP → verify removal
5. Get stats via MCP → verify counts
6. Validate composition via MCP → verify errors (if implemented)

---

## Effort Estimate

| Activity | Effort | Notes |
|----------|--------|-------|
| Implement MCP tools in tool-gateway | 2h | Straightforward wrappers |
| Write unit tests | 1h | 6-8 tests |
| Write integration tests | 1h | 6 tests (new file) |
| Update documentation | 0.5h | Add to composition-usage.md |
| **Total** | **4.5h** | Fits within 1 day |

---

## Risk Assessment

**Risks**: Low

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Implementation complexity | Low | Low | Reuses existing REST logic |
| Breaking changes | Very Low | Low | Additive-only changes |
| Test failures | Low | Medium | Comprehensive unit/integration tests |
| Performance impact | Very Low | Low | Same code paths as REST |

**Overall Risk**: **Low** - Straightforward implementation with high value.

---

## Recommendation

**Add COMP-017A to Sprint 41 backlog**:
- **Priority**: P0 (architectural consistency)
- **Phase**: 3 (Tool-Gateway Integration)
- **Insert After**: COMP-015 (REST API)
- **Insert Before**: COMP-016 (Unit tests - update to include MCP tests)
- **Effort**: 4.5h
- **Impact**: Fixes architectural inconsistency, enables LLM/inter-service composition management

**Benefits**:
1. ✅ Architectural consistency with other BitBrat subsystems
2. ✅ Enables LLM-driven composition management
3. ✅ Enables inter-service composition registration
4. ✅ Improved developer experience (unified MCP interface)
5. ✅ CLI integration (`brat composition *` commands)

**Alternatives Considered**:
- **Do nothing**: Violates BitBrat design principles, limits functionality
- **REST-only**: Inconsistent with ecosystem, requires special-case handling
- **MCP-only (remove REST)**: Breaking change, external tools need REST

**Decision**: **Implement both** (REST + MCP) for maximum compatibility.

---

## Next Steps

1. ✅ Create this gap analysis document
2. ⏳ Update `execution-plan.md` to add MCP tools to Phase 3
3. ⏳ Update `backlog.yaml` to add COMP-017A task
4. ⏳ Implement COMP-017A (if approved)
5. ⏳ Update documentation to include MCP tool examples

---

## References

- Sprint 41 Backlog: `planning/sprint-41-u18tqc/backlog.yaml`
- Execution Plan: `planning/sprint-41-u18tqc/execution-plan.md`
- Composition Usage Guide: `documentation/guides/composition-usage.md`
- BitBrat Bit Model: `documentation/concepts/bit-model.md`
- MCP Tools Reference: `documentation/reference/mcp-tools.md`
