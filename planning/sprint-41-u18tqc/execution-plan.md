# Execution Plan: Sprint 41 - MCP Behavioral Compilation (Foundation Layer)

**Sprint ID**: sprint-41-u18tqc
**Lead Implementor**: Claude (Agent)
**Owner**: christophernavta
**Date**: 2026-09-03
**Status**: Planning → In Progress

---

## Executive Summary

This sprint implements the **foundational infrastructure** for MCP Behavioral Compilation: a system that enables manual authoring, validation, execution, and exposure of multi-step tool compositions. This lays the groundwork for future automated learning and reflex promotion.

### What We're Building

1. **Composition DSL**: YAML/JSON format for defining multi-step procedures
2. **Parser & Compiler**: Validation, reference resolution, cycle detection
3. **Executor**: Sequential step execution with reference resolution and conditional logic
4. **Registry**: DocumentStore-based persistence (PostgreSQL/Firestore)
5. **Tool-Gateway Integration**: MCP tool exposure + REST API
6. **Example Compositions**: `viewer_greeting` and `user_lookup` demonstrations

### What We're NOT Building (Out of Scope)

- Observation system (pattern detection)
- Learning/promotion workflows
- Reflex DSL enhancements
- Parallel execution blocks
- Automated candidate generation

### Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Load YAML composition | <100ms | Performance test |
| Execute 3-step composition | <10ms overhead | Benchmark vs direct calls |
| Compilation success rate | 100% | Test suite |
| Unit test coverage | >80% | Jest coverage report |
| Integration test pass rate | 100% | E2E test suite |

---

## Sprint Context

### Problem Statement

LLM agents repeatedly perform multi-step patterns (e.g., "get user → check memory → show alert"). Each invocation requires:
- Multiple tool calls with reasoning overhead
- Token-expensive intermediate planning
- Potential for inconsistency in repeated patterns

### Solution

**Compositions**: Reusable, validated, deterministic procedures that combine multiple tool calls into a single callable unit. Benefits:
- **Reduced complexity**: Single tool call replaces N-step reasoning
- **Consistency**: Validated, tested procedures
- **Cost reduction**: Fewer tokens, faster execution
- **Foundation for learning**: Manual compositions become training data for future automated pattern detection

### Architectural Alignment

Uses **DocumentStore pattern** (BitBrat standard):
- Vendor-neutral (PostgreSQL/Firestore)
- Document-oriented JSONB storage
- Collection-based organization
- Simplified implementation (3h saved vs SQL tables)

---

## Implementation Phases

### Phase 1: Core Infrastructure (Days 1-2)

**Goal**: Implement DSL, parser, compiler, executor

**Components**:
1. Type definitions (`src/common/composition/types.ts`)
2. Parser (`src/common/composition/parser.ts`)
3. Compiler/Validator (`src/common/composition/compiler.ts`)
4. Executor (`src/common/composition/executor.ts`)

**Deliverables**:
- ✅ Parse YAML/JSON compositions
- ✅ Validate references, detect cycles
- ✅ Execute steps sequentially
- ✅ Resolve $input/$context/$steps references
- ✅ Evaluate conditions (equals, greaterThan, etc.)

**Tests**:
- Unit tests for parser (12 tests)
- Unit tests for compiler (15 tests)
- Unit tests for executor (18 tests)

### Phase 2: Registry & Persistence (Day 3)

**Goal**: Implement DocumentStore-based composition storage

**Components**:
1. CompositionDocument schema
2. DocumentStoreCompositionRegistry implementation
3. Optional PostgreSQL indexes for performance

**Deliverables**:
- ✅ Create compositions in DocumentStore
- ✅ Retrieve by ID or name
- ✅ List active compositions
- ✅ Update status (draft/active/archived)
- ✅ Delete compositions

**Tests**:
- Registry unit tests with mocked DocumentStore (10 tests)
- Integration tests with real PostgreSQL (8 tests)

### Phase 3: Tool-Gateway Integration (Day 4)

**Goal**: Expose compositions as MCP tools and REST endpoints

**Components**:
1. Tool-gateway initialization (load compositions on startup)
2. MCP tool registration (executable compositions)
3. **MCP administrative tools (composition.* control plane)** ← **NEW**
4. REST API endpoints (CRUD + execute)
5. Composition executor integration

**Deliverables**:
- ✅ Load compositions from DocumentStore on startup
- ✅ Register compositions in ToolRegistry
- ✅ Expose via MCP `tools/list` and `tools/call`
- ✅ REST API: POST/GET/DELETE /v1/compositions
- ⏳ **MCP admin tools: composition.register/list/get/delete/stats** ← **NEW**
- ⏳ **MCP tool tests (6-8 tests)** ← **NEW**

**Tests**:
- Tool-gateway unit tests (8 tests + 6 MCP admin tool tests = 14 tests)
- REST API integration tests (12 tests)
- **MCP admin tool integration tests (6 tests)** ← **NEW**

**New Subtask - COMP-017A**: Administrative MCP Tools
- Implement `composition.register` tool (register from YAML/JSON)
- Implement `composition.list` tool (list all compositions)
- Implement `composition.get` tool (get by name/version)
- Implement `composition.delete` tool (delete composition)
- Implement `composition.stats` tool (registry statistics)
- Write unit tests (6-8 tests)
- Write integration tests (6 tests)
- Update documentation with MCP tool examples

### Phase 4: Example Compositions & Documentation (Day 5)

**Goal**: Create working examples and validate E2E flow

**Components**:
1. Example compositions (viewer_greeting, user_lookup)
2. E2E integration tests
3. Agent-dev validation
4. Documentation updates

**Deliverables**:
- ✅ `compositions/examples/viewer_greeting.yaml`
- ✅ `compositions/examples/user_lookup.yaml`
- ✅ E2E test: Load → Parse → Register → Execute via MCP
- ✅ E2E test: Execute via REST API
- ✅ Agent-dev validation: Deploy tool-gateway, test compositions

**Tests**:
- E2E integration test (1 comprehensive test)
- Agent-dev validation script

### Phase 5: Testing & Validation (Day 6)

**Goal**: Comprehensive testing, coverage validation, agent-dev deployment

**Activities**:
1. Run full test suite
2. Validate test coverage (>80%)
3. Deploy to agent-dev context
4. Execute validation protocol
5. Address any failures

**Deliverables**:
- ✅ All tests passing (95+ total tests)
- ✅ Coverage report (>80%)
- ✅ Agent-dev validation complete
- ✅ Performance benchmarks collected
- ✅ Sprint retrospective

---

## Dependencies & Critical Path

### Critical Path

```
Day 1-2: Core Infrastructure (COMP-003 → COMP-009)
   ↓
Day 3: Registry (COMP-010 → COMP-012)
   ↓
Day 4: Tool-Gateway (COMP-013 → COMP-018)
   ↓
Day 5: Examples & E2E (COMP-019 → COMP-022)
   ↓
Day 6: Validation (COMP-023 → COMP-026)
```

### Key Dependencies

| Task | Depends On | Blocker Risk |
|------|-----------|--------------|
| COMP-004 (Parser) | COMP-003 (Types) | Low - well-defined types |
| COMP-006 (Compiler) | COMP-003, COMP-004 | Low - AST is stable |
| COMP-008 (Executor) | COMP-003, COMP-004 | Medium - requires ToolRegistry integration |
| COMP-011 (Registry) | COMP-010 (DocumentStore) | Low - DocumentStore exists |
| COMP-013 (Tool-Gateway) | COMP-008, COMP-011 | Medium - integration complexity |
| COMP-019 (Examples) | COMP-013 | High - requires working runtime |
| COMP-021 (E2E Tests) | COMP-019 | High - requires examples |

### Parallel Work Opportunities

**Can be done in parallel**:
- COMP-005 (Parser tests) + COMP-007 (Compiler tests) + COMP-009 (Executor tests)
- COMP-014 (Tool registration) + COMP-015 (REST API) during integration phase
- COMP-019 (viewer_greeting) + COMP-020 (user_lookup) example compositions
- Documentation updates throughout implementation

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| ToolRegistry integration complexity | Medium | High | Review existing registry code early; prototype executor integration |
| DocumentStore not available in tool-gateway | Low | High | Verify resource injection in Bit base class; graceful degradation if missing |
| Circular dependency detection bugs | Medium | Medium | Implement comprehensive test cases; use proven graph algorithms (DFS) |
| Reference resolution edge cases | Medium | Medium | Extensive unit tests; fuzzing with varied reference patterns |
| Performance regression in tool-gateway | Low | Medium | Benchmark existing tool-call performance; compare after integration |

### Process Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Scope creep (adding learning/observation) | Medium | High | Strict adherence to "IN SCOPE" list; defer all learning features |
| Incomplete testing before merge | Low | High | Mandatory agent-dev validation; >80% coverage gate |
| Breaking changes to ToolRegistry | Low | Critical | Review existing tool-gateway code; integration tests for existing tools |

### Mitigation Strategies

1. **Early Integration Validation**: Test DocumentStore + ToolRegistry integration on Day 1-2
2. **Incremental Testing**: Run tests after each component (don't batch)
3. **Agent-Dev First**: Deploy to agent-dev before marking Phase 4 complete
4. **Graceful Degradation**: If DocumentStore unavailable, compositions disabled (log warning)
5. **Rollback Plan**: Feature flag for composition loading (`ENABLE_COMPOSITIONS=true/false`)

---

## Testing Strategy

### Unit Tests (Target: 45 tests, >80% coverage)

**Parser Tests** (`parser.test.ts`):
- Valid YAML → AST (3 tests)
- Valid JSON → AST (2 tests)
- Reference canonicalization (4 tests)
- Invalid structure → Error (3 tests)

**Compiler Tests** (`compiler.test.ts`):
- Tool resolution success (3 tests)
- Tool not found → Error (2 tests)
- Cycle detection (4 tests)
- Reference validation (4 tests)
- Hash computation (2 tests)

**Executor Tests** (`executor.test.ts`):
- Sequential step execution (3 tests)
- Reference resolution ($input, $context, $steps) (6 tests)
- Condition evaluation (6 tests)
- Guarded steps (when: false) (2 tests)
- Nested object/array resolution (1 test)

**Registry Tests** (`registry.test.ts`):
- Create composition (2 tests)
- Get by ID (2 tests)
- Get by name (2 tests)
- List active (2 tests)
- Update status (1 test)
- Delete (1 test)

### Integration Tests (Target: 14 tests)

**Tool-Gateway REST API** (`tool-gateway-composition-rest.test.ts`):
- POST /compositions (create) (2 tests)
- GET /compositions (list) (1 test)
- GET /compositions/:id (retrieve) (1 test)
- POST /compositions/:id/execute (1 test)
- DELETE /compositions/:id (1 test)

**E2E Composition** (`composition-e2e.test.ts`):
- Load viewer_greeting.yaml (1 test)
- Parse & compile (1 test)
- Register in tool-gateway (1 test)
- Verify in tools/list (1 test)
- Execute via MCP tools/call (1 test)
- Verify structured output (1 test)

**DocumentStore Integration** (`registry-integration.test.ts`):
- Full CRUD lifecycle with PostgreSQL (1 test)
- Query performance with 100 compositions (1 test)
- Concurrent access (1 test)

### Agent-Dev Validation (Manual)

**Validation Protocol**:

```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-sprint-41-validation" })

# 2. Deploy tool-gateway
bit deploy tool-gateway --context agent-dev-sprint-41-validation

# 3. Verify service started
fleet.info({ bit: "tool-gateway", context: "agent-dev-sprint-41-validation" })

# 4. Check logs for composition loading
fleet.logs({
  bit: "tool-gateway",
  context: "agent-dev-sprint-41-validation",
  level: ["info", "debug"],
  limit: 50
})

# 5. Register sample composition via REST API
curl -X POST http://localhost:3002/compositions \
  -H "Content-Type: application/yaml" \
  --data-binary @compositions/examples/viewer_greeting.yaml

# 6. Verify composition appears in MCP tools/list
# (Use MCP client to call tools/list)

# 7. Execute composition via MCP tools/call
# (Use MCP client to call viewer_greeting)

# 8. Execute composition via REST API
curl -X POST http://localhost:3002/compositions/viewer_greeting/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"user_id": "123"}, "context": {"channel_id": "abc"}}'

# 9. Check execution logs
fleet.logs({
  bit: "tool-gateway",
  context: "agent-dev-sprint-41-validation",
  correlationId: "<from step 8>",
  limit: 100
})

# 10. Clean up
agent_dev.destroy({ name: "agent-dev-sprint-41-validation", confirm: true })
```

**Success Criteria**:
- ✅ Tool-gateway starts without errors
- ✅ Compositions loaded from DocumentStore (log: "tool_gateway.compositions.loaded")
- ✅ Composition registered successfully (201 Created)
- ✅ Composition appears in MCP tools/list
- ✅ MCP tools/call executes successfully
- ✅ REST API execute returns 200 OK with structured result
- ✅ No errors in execution logs

---

## Validation & Acceptance

### Acceptance Criteria (from Technical Architecture)

Sprint complete when:

1. ✅ Load a YAML composition from disk
2. ✅ Parse, validate, and compile composition
3. ✅ Detect and reject circular dependencies
4. ✅ Execute 3-step composition calling primitive tools
5. ✅ Composition appears in MCP `tools/list`
6. ✅ LLM agent can invoke composition via `tools/call`
7. ✅ Reflex can invoke composition via REST API
8. ✅ Nested composition works (composition calls composition)
9. ✅ All unit tests pass (>45 tests)
10. ✅ Integration test validates E2E flow
11. ✅ Agent-dev validation confirms functionality

### Definition of Done

**Code Quality**:
- [ ] All TypeScript compiles without errors (`npm run build`)
- [ ] ESLint passes (`npm run lint`)
- [ ] No imports from `/deprecated`
- [ ] Follows naming conventions (kebab-case files, PascalCase classes)

**Testing**:
- [ ] Unit tests: >80% coverage
- [ ] Integration tests: All passing
- [ ] E2E tests: All passing
- [ ] Agent-dev validation: All steps completed successfully

**Documentation**:
- [ ] Code comments for complex logic
- [ ] JSDoc for public interfaces
- [ ] README updates (if needed)
- [ ] CHANGELOG entry

**Integration**:
- [ ] No breaking changes to existing tool-gateway functionality
- [ ] Graceful degradation if DocumentStore unavailable
- [ ] Feature flag for enabling/disabling compositions

**Performance**:
- [ ] Composition load time <100ms
- [ ] Execution overhead <10ms vs direct tool calls
- [ ] No memory leaks (long-running test)

### Sprint Completion Checklist

**Code**:
- [ ] All COMP-* tasks completed (see backlog.yaml)
- [ ] Code reviewed (self-review against architecture)
- [ ] No TODOs or FIXMEs in production code

**Testing**:
- [ ] Test suite passes: `npm test`
- [ ] Coverage report generated: `npm run test:coverage`
- [ ] Agent-dev validation script executed successfully

**Documentation**:
- [ ] Execution plan (this document) marked complete
- [ ] Backlog.yaml updated with status: completed
- [ ] Retrospective written
- [ ] Key learnings documented

**Sprint Artifacts**:
- [ ] Implementation plan (architecture documents)
- [ ] Execution plan (this document)
- [ ] Backlog (backlog.yaml)
- [ ] Test report (test-report.md)
- [ ] Validation script (validate-sprint-41.sh)
- [ ] Retrospective (retrospective.md)
- [ ] Request log (request-log.md)

**Deployment Readiness**:
- [ ] Tool-gateway deploys successfully to agent-dev
- [ ] Sample compositions registered and executable
- [ ] No regressions in existing tool-gateway functionality
- [ ] Ready for merge to main branch

---

## Implementation Timeline

### Estimated Effort: 6 days (48 hours)

| Phase | Days | Hours | Key Deliverables |
|-------|------|-------|------------------|
| Phase 1: Core Infrastructure | 1-2 | 16h | Parser, Compiler, Executor + tests |
| Phase 2: Registry & Persistence | 3 | 8h | DocumentStore registry + tests |
| Phase 3: Tool-Gateway Integration | 4 | 12h | MCP + REST API + tests |
| Phase 4: Examples & E2E | 5 | 8h | Compositions + E2E tests |
| Phase 5: Testing & Validation | 6 | 4h | Coverage + agent-dev validation |

### Daily Goals

**Day 1-2** (Core Infrastructure):
- Morning: Implement types, parser, parser tests
- Afternoon: Implement compiler, compiler tests
- Evening: Implement executor, executor tests
- **Checkpoint**: All core unit tests passing (45+ tests)

**Day 3** (Registry):
- Morning: Implement DocumentStoreCompositionRegistry
- Afternoon: Registry unit tests + integration tests
- Evening: Optional PostgreSQL indexes
- **Checkpoint**: Registry CRUD operations working

**Day 4** (Tool-Gateway):
- Morning: Tool-gateway initialization + composition loading
- Afternoon: MCP tool registration + REST API endpoints
- Evening: Integration tests
- **Checkpoint**: Compositions exposed via MCP + REST

**Day 5** (Examples & E2E):
- Morning: Create viewer_greeting and user_lookup compositions
- Afternoon: E2E integration tests
- Evening: Agent-dev validation
- **Checkpoint**: E2E flow validated end-to-end

**Day 6** (Validation):
- Morning: Full test suite run + coverage report
- Afternoon: Agent-dev deployment + validation protocol
- Evening: Sprint retrospective + documentation
- **Checkpoint**: All acceptance criteria met

---

## Rollout Strategy

### Phase 1: Feature Flag

```yaml
# architecture.yaml - tool-gateway
env:
  - ENABLE_COMPOSITIONS=false  # Default: disabled
```

**Rollout**:
1. Merge to main with feature flag disabled
2. Deploy to staging with feature flag enabled
3. Validate compositions in staging
4. Enable in production after 1 week

### Phase 2: Production Deployment

**Validation checklist before enabling in production**:
- [ ] Staging deployment stable for 7 days
- [ ] No memory leaks detected
- [ ] Performance benchmarks within targets
- [ ] Sample compositions tested end-to-end
- [ ] Monitoring/alerting configured

**Monitoring**:
- Composition execution time (p50, p95, p99)
- Composition load time on startup
- Registry query performance
- Error rate (compilation failures, execution failures)
- Memory usage trend

**Rollback Plan**:
1. Set `ENABLE_COMPOSITIONS=false`
2. Restart tool-gateway
3. Compositions no longer loaded or exposed
4. No data loss (compositions remain in DocumentStore)

---

## Future Work (Post-Sprint)

Deferred to future sprints:

### Sprint 42: Observation System
- Capture LLM tool-use patterns
- Pattern detection algorithms
- Candidate composition generation

### Sprint 43: Learning & Promotion
- Composition candidate validation
- Automated testing framework
- Promotion workflow (candidate → validated → published)

### Sprint 44: Reflex Enhancement
- Composition targets in reflex DSL
- Deterministic dispatch to compositions
- Composition chaining in reflexes

### Sprint 45: Advanced Features
- Parallel execution blocks
- Foreach loops (bounded)
- Retry/fallback strategies
- Advanced condition operators (regex, contains)

---

## Appendix A: File Locations

### Core Implementation

```
src/
  common/
    composition/
      types.ts                       # Type definitions
      parser.ts                      # YAML/JSON → AST parser
      parser.test.ts                 # Parser unit tests
      compiler.ts                    # Validator + compiler
      compiler.test.ts               # Compiler unit tests
      executor.ts                    # Runtime executor
      executor.test.ts               # Executor unit tests
      registry.ts                    # DocumentStore registry
      registry.test.ts               # Registry unit tests
      registry-integration.test.ts   # Registry integration tests

  apps/
    tool-gateway.ts                  # Enhanced with composition support
    tool-gateway-composition.test.ts # Tool-gateway unit tests
```

### Examples & Tests

```
compositions/
  examples/
    viewer_greeting.yaml             # Example composition
    user_lookup.yaml                 # Example composition

tests/
  integration/
    composition-e2e.test.ts          # End-to-end tests
  apps/
    tool-gateway-composition-rest.test.ts  # REST API tests
```

### Infrastructure

```
infrastructure/
  sql/
    migrations/
      001_composition_indexes.sql    # Optional performance indexes

planning/
  sprint-41-u18tqc/
    technical-architecture.md        # Full architecture spec
    architecture-revision-documentstore.md  # DocumentStore correction
    execution-plan.md                # This document
    backlog.yaml                     # Task breakdown
    test-report.md                   # Test results (post-implementation)
    validate-sprint-41.sh            # Agent-dev validation script
    retrospective.md                 # Post-sprint retrospective
    request-log.md                   # Change log
```

---

## Appendix B: Key Design Decisions

### 1. DocumentStore vs SQL Tables

**Decision**: Use DocumentStore abstraction
**Rationale**: Platform consistency, vendor neutrality, schema flexibility
**Impact**: -3h implementation time, simpler testing

### 2. Sequential vs Parallel Execution

**Decision**: V1 is sequential only
**Rationale**: Simplicity, fewer edge cases, faster delivery
**Future**: Parallel blocks in Sprint 45

### 3. Composition Storage Location

**Decision**: DocumentStore (dynamic) + file-based YAML (source control)
**Rationale**: DocumentStore for runtime, YAML for versioning and review
**Workflow**: YAML → Parser → Compiler → DocumentStore → MCP tool

### 4. Authorization Model

**Decision**: Inherit caller's roles (no privilege escalation)
**Rationale**: Security, principle of least privilege
**Alternative**: Composition-specific roles (rejected for V1 complexity)

### 5. Error Handling Strategy

**Decision**: Fail-fast on compilation, graceful degradation on execution
**Rationale**: Catch errors early, tolerate runtime issues
**Example**: Invalid tool → compilation error; DocumentStore unavailable → disable compositions

### 6. Versioning Strategy

**Decision**: V1 has no versioning (simple replacement)
**Rationale**: Simplicity for foundation layer
**Future**: Version management in Sprint 46

---

**End of Execution Plan**
