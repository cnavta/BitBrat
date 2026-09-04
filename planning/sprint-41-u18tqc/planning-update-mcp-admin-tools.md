# Planning Update: Administrative MCP Tools for Composition Management

**Date**: 2026-09-03
**Sprint**: 41 (COMP-017A)
**Type**: Gap Analysis → Planning Update
**Status**: Approved - Ready for Implementation

---

## Summary

Added **COMP-017A: Administrative MCP Tools** to Sprint 41 backlog based on gap analysis revealing architectural inconsistency between compositions (REST-only) and other BitBrat subsystems (MCP control planes).

**Impact**:
- **Task Count**: 27 → 28 tasks
- **P0 Tasks**: 20 → 21 tasks
- **Estimated Effort**: 75h → 79h (+4h)
- **Phase Affected**: Phase 3 (Tool-Gateway Integration)
- **Priority**: P0 (architectural consistency)

---

## Gap Identified

### Problem

**Current State** (Phase 4 Complete):
- ✅ REST API endpoints for composition management (`/v1/compositions/*`)
- ✅ Compositions registered as executable MCP tools (e.g., `simple_greeting`)
- ❌ **NO administrative MCP tools** for composition management

**Architectural Inconsistency**:
```typescript
// Other BitBrat subsystems (MCP control planes)
bit.info(), bit.config.get(), bit.health()          // ✅ Consistent
scheduler.create(), scheduler.list()                 // ✅ Consistent
claim.event.retrieve(), claim.blob.store()           // ✅ Consistent

// Compositions (REST-only)
POST /v1/compositions, GET /v1/compositions          // ❌ Inconsistent
composition.register(), composition.list()           // ❌ NOT IMPLEMENTED
```

**Impact**:
1. LLMs cannot manage compositions via MCP (must use REST)
2. Other services cannot register compositions (MCP-only communication)
3. CLI tools require separate REST client implementation
4. Developer confusion (inconsistent management interface)

### Root Cause

Original Sprint 41 backlog focused on:
- Core runtime (parser, compiler, executor)
- REST API for external integration
- **Missed**: MCP administrative tools (assumed REST was sufficient)

**Design Principle Violated**: Every BitBrat subsystem exposes MCP control plane for management operations.

---

## Solution: COMP-017A

### New Task Details

**ID**: COMP-017A
**Title**: Implement administrative MCP tools for composition management
**Phase**: 3 (Tool-Gateway Integration)
**Priority**: P0 (architectural consistency)
**Effort**: 4h
**Dependencies**: COMP-015 (REST API must exist first)

### Required MCP Tools (5 total)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `composition.register` | Register composition from YAML/JSON | `{ definition: CompositionDefinition }` | `{ id, name, version, contentHash }` |
| `composition.list` | List all compositions | `{ filter?, limit?, offset? }` | `{ compositions: [...], total }` |
| `composition.get` | Get specific composition | `{ name, version? }` | `CompositionDefinition + metadata` |
| `composition.delete` | Delete composition | `{ name, version }` | `{ success, deleted: {...} }` |
| `composition.stats` | Get registry statistics | `{}` | `{ totalCompositions, totalVersions, ... }` |

**Optional (Stretch Goal)**:
- `composition.validate` - Validate composition without registering

### Implementation Strategy

**Key Principle**: **Reuse existing REST logic** (no code duplication)

```typescript
// Pattern: MCP tool → internal method ← REST endpoint

// Internal method (shared logic)
private async registerCompositionInternal(definition: CompositionDefinition): Promise<CompositionRecord> {
  // Validation, compilation, persistence
  const compiled = await this.compositionRegistry.register(definition);
  await this.registerCompositionTool(compiled);
  return compiled;
}

// REST endpoint (calls internal method)
app.post('/v1/compositions', async (req, res) => {
  const result = await this.registerCompositionInternal(req.body);
  res.status(201).json(result);
});

// MCP tool (calls same internal method)
this.registerTool('composition.register', schema, async (args) => {
  const result = await this.registerCompositionInternal(args.definition);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

**Benefits**:
- ✅ No code duplication
- ✅ Consistent behavior (REST and MCP use same logic)
- ✅ Easier maintenance (single source of truth)
- ✅ Faster implementation (4h vs 8h if duplicated)

---

## Planning Document Updates

### 1. execution-plan.md

**Location**: Phase 3: Tool-Gateway Integration

**Changes**:
- Added Component #3: "MCP administrative tools (composition.* control plane)"
- Added Deliverables: "MCP admin tools: composition.register/list/get/delete/stats"
- Updated test counts: 8 → 14 unit tests, 6 → 12 integration tests
- Added COMP-017A subtask with detailed implementation steps

**Before**:
```markdown
**Components**:
1. Tool-gateway initialization
2. MCP tool registration
3. REST API endpoints
4. Composition executor integration

**Tests**:
- Tool-gateway unit tests (8 tests)
- REST API integration tests (6 tests)
```

**After**:
```markdown
**Components**:
1. Tool-gateway initialization
2. MCP tool registration (executable compositions)
3. **MCP administrative tools (composition.* control plane)** ← NEW
4. REST API endpoints
5. Composition executor integration

**Tests**:
- Tool-gateway unit tests (14 tests) ← +6 tests
- REST API integration tests (12 tests)
- **MCP admin tool integration tests (6 tests)** ← NEW
```

### 2. backlog.yaml

**Location**: Phase 4 (Integration), inserted after COMP-015

**Changes**:
- Added new task: COMP-017A (4h, P0)
- Updated COMP-016 dependencies to include COMP-017A
- Updated summary: 27 → 28 tasks, 75h → 79h effort
- Updated deliverables: Added COMP-017A to "Tool-gateway integration"

**New Task Structure**:
```yaml
- id: COMP-017A
  title: Implement administrative MCP tools for composition management
  phase: integration
  priority: P0
  status: todo
  effort: 4h
  dependencies: [COMP-015]

  subtasks:
    - Implement registerCompositionAdminTools() method
    - Implement 5 MCP tools (register, list, get, delete, stats)
    - Add Zod schemas for input validation
    - Reuse REST endpoint logic internally
    - Write unit tests (6-8 tests)
    - Write integration tests (6 tests)
    - Update documentation with MCP examples

  acceptance:
    - All 5 admin tools registered and callable via MCP
    - Tools reuse existing REST logic (no duplication)
    - Graceful error handling (compositions disabled)
    - Comprehensive test coverage
```

### 3. gap-analysis-mcp-admin-tools.md (NEW)

**Created**: Comprehensive gap analysis document (350+ lines)

**Sections**:
1. Executive Summary
2. Current State (what we have vs. missing)
3. Gap Analysis (4 detailed sections)
   - Architectural inconsistency
   - Functional limitations
   - Use cases
   - Comparison with other subsystems
4. Proposed Solution (detailed tool specs)
5. Implementation Plan
6. Effort Estimate
7. Risk Assessment
8. Recommendation

**Key Findings**:
- Compositions are the ONLY subsystem with REST API but no MCP tools
- 4 use cases blocked by missing MCP tools
- Low risk, high value implementation
- Estimated 4.5h effort

---

## Use Cases Enabled

### 1. LLM-Driven Composition Creation

**Before** (Current):
```
User: "Create a composition that greets users"
LLM: "I cannot create compositions via MCP. You need to use the REST API."
```

**After** (With COMP-017A):
```
User: "Create a composition that greets users"
LLM: <calls composition.register with generated YAML>
System: Composition registered as "user_greeting"
LLM: "I've created the composition. You can now use it!"
```

### 2. Dynamic Workflow Management

```typescript
// Scheduler creates composition for recurring task
await toolGateway.invokeTool('composition.register', {
  definition: dailyReportComposition
});

await toolGateway.invokeTool('scheduler.create', {
  name: 'daily_report_job',
  toolId: 'daily_report',
  cron: '0 9 * * *'
});
```

**Current State**: Requires external REST calls (breaks MCP-only workflow)
**After COMP-017A**: Fully MCP-based workflow

### 3. CLI Administration

```bash
# Current (REST API):
curl -X POST http://localhost:3002/v1/compositions -d @composition.yaml

# After COMP-017A (MCP):
brat composition register --file composition.yaml
# Uses MCP internally, consistent with other brat commands
```

---

## Testing Strategy

### Unit Tests (6-8 tests)

**File**: `src/apps/tool-gateway.test.ts`

**Tests**:
1. Test `composition.register` tool registration
2. Test `composition.register` execution (valid composition)
3. Test `composition.register` execution (invalid composition → error)
4. Test `composition.list` tool execution
5. Test `composition.get` tool execution (found)
6. Test `composition.get` tool execution (not found → error)
7. Test `composition.delete` tool execution
8. Test graceful degradation (compositions disabled → clear error)

### Integration Tests (6 tests)

**File**: `src/apps/__tests__/composition-mcp-admin.integration.test.ts` (NEW)

**Tests**:
1. Register composition via MCP → verify in registry
2. List compositions via MCP → verify results
3. Get composition via MCP → verify full definition
4. Delete composition via MCP → verify removal
5. Get stats via MCP → verify counts
6. End-to-end: Register → List → Get → Delete (full lifecycle)

### E2E Validation

**Agent-Dev Protocol** (updated):
```bash
# 1. Deploy tool-gateway
bit deploy tool-gateway --context agent-dev-test

# 2. Register composition via MCP (not REST)
composition.register({ definition: simpleGreetingYaml })

# 3. List compositions via MCP
composition.list()

# 4. Execute composition
simple_greeting({ username: "Alice" })

# 5. Delete composition via MCP
composition.delete({ name: "simple_greeting", version: 1 })
```

---

## Timeline Impact

**Original Sprint 41**: 17 days (75h)
**Updated Sprint 41**: 17 days (79h) - **NO CHANGE in duration**

**Reasoning**: +4h fits within existing day's budget

**Updated Phase 3 Timeline**:
- COMP-013: Tool-gateway init (2h)
- COMP-014: MCP tool registration (3h)
- COMP-015: REST API (3h)
- **COMP-017A: MCP admin tools (4h)** ← NEW
- COMP-016: Unit tests (2h) - updated to cover MCP
- **Total**: 14h (was 10h) - **+4h in Phase 3**

**Day 4 Schedule** (updated):
- Morning: COMP-013 + COMP-014 (5h)
- Afternoon: COMP-015 + start COMP-017A (4h)
- Evening: Complete COMP-017A + COMP-016 (3h)
- **Total**: 12h day → **Fits within normal sprint pacing**

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Implementation complexity | Low | Low | Reuses existing REST logic |
| Breaking changes | Very Low | Low | Additive-only changes |
| Test failures | Low | Medium | Comprehensive unit/integration tests |
| Performance impact | Very Low | Low | Same code paths as REST |
| Timeline slip | Very Low | Low | 4h fits within day's budget |

**Overall Risk**: **Low**

**Confidence Level**: **High** (straightforward implementation, clear requirements)

---

## Approval & Next Steps

### Decision

**APPROVED** - Add COMP-017A to Sprint 41 backlog

**Rationale**:
1. ✅ Fixes architectural inconsistency
2. ✅ Low risk, high value
3. ✅ Enables important use cases (LLM admin, inter-service)
4. ✅ Fits within sprint timeline
5. ✅ Consistent with BitBrat design principles

### Implementation Order

```
Phase 4 (Complete) ✅
   ↓
COMP-017A (Next) ⏳
   ├─ Implement registerCompositionAdminTools()
   ├─ Implement 5 MCP tools
   ├─ Add Zod schemas
   ├─ Write unit tests (6-8)
   ├─ Write integration tests (6)
   └─ Update documentation
   ↓
COMP-016 (Updated) ⏳
   └─ Update unit tests to cover MCP
   ↓
Phase 5 (Validation) ⏳
```

### Success Criteria

**COMP-017A Complete** when:
- ✅ All 5 MCP tools registered and callable
- ✅ Tools reuse existing REST logic (no duplication)
- ✅ 6-8 unit tests passing
- ✅ 6 integration tests passing
- ✅ Documentation updated with MCP examples
- ✅ No regressions in existing functionality

---

## Documentation Updates Required

### 1. composition-usage.md

**Add Section**: "MCP Administrative Tools"

**Content**:
```markdown
## MCP Administrative Tools

### composition.register

Register a new composition:

typescript
await toolGateway.invokeTool('composition.register', {
  definition: {
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: { name: 'my_composition', description: '...' },
    spec: { inputSchema, steps, return }
  }
});


### composition.list

List all compositions:

typescript
const result = await toolGateway.invokeTool('composition.list', {
  filter: { status: 'active' },
  limit: 10
});


[... examples for all 5 tools ...]
```

### 2. CLAUDE.md

**Add Pattern**: "Managing Compositions via MCP"

**Content**:
```markdown
### Quick Reference Patterns

**Managing Compositions**:
typescript
// Register composition
this.registry.getTool('composition.register').execute({ definition });

// List compositions
this.registry.getTool('composition.list').execute();

// Get composition
this.registry.getTool('composition.get').execute({ name, version });
```

---

## References

- Gap Analysis: `planning/sprint-41-u18tqc/gap-analysis-mcp-admin-tools.md`
- Updated Execution Plan: `planning/sprint-41-u18tqc/execution-plan.md`
- Updated Backlog: `planning/sprint-41-u18tqc/backlog.yaml`
- BitBrat Design Principles: `documentation/concepts/bit-model.md`
- MCP Tools Reference: `documentation/reference/mcp-tools.md`

---

**Status**: Planning complete - Ready for implementation
**Assigned**: Next available development sprint
**Estimated Completion**: +4h to existing Phase 3 timeline
