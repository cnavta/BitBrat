# Implementation Plan: Composition DSL & Runtime (Sprint 41)

**Sprint**: sprint-41-u18tqc
**Author**: Lead Implementor (Claude)
**Date**: 2026-09-02
**Status**: Ready for Execution

---

## 1. Overview

This implementation plan breaks down the Composition DSL & Runtime into concrete, deliverable tasks organized by dependency order and risk. The plan follows a bottom-up approach: foundational types → runtime components → integration → testing.

---

## 2. Implementation Phases

### Phase 1: Foundation (Days 1-3)
**Goal**: Establish core type system and database schema

**Deliverables**:
- TypeScript type definitions
- PostgreSQL schema
- Basic test infrastructure

**Risk**: Low (no dependencies)

### Phase 2: Core Runtime (Days 4-7)
**Goal**: Implement parser, compiler, executor

**Deliverables**:
- Working parser (YAML/JSON → AST)
- Compiler with validation
- Sequential executor

**Risk**: Medium (complex logic, but isolated)

### Phase 3: Registry & Storage (Days 8-9)
**Goal**: Persistent storage for compositions

**Deliverables**:
- DocumentStore registry implementation
- CRUD operations
- Optional performance indexes

**Risk**: Low (straightforward CRUD, leverages existing DocumentStore)

### Phase 4: Tool-Gateway Integration (Days 10-12)
**Goal**: Expose compositions via MCP and REST

**Deliverables**:
- Composition loading on startup
- MCP tool registration
- REST API endpoints

**Risk**: Medium (integration with existing codebase)

### Phase 5: Testing & Validation (Days 13-15)
**Goal**: Comprehensive test coverage and validation

**Deliverables**:
- Unit tests (parser, compiler, executor)
- Integration tests (E2E flows)
- Agent-dev validation

**Risk**: Low (validation of completed work)

### Phase 6: Documentation & Examples (Days 16-17)
**Goal**: Examples and operational documentation

**Deliverables**:
- Example compositions
- Operational runbook
- Sprint retrospective

**Risk**: Low (documentation)

---

## 3. Detailed Task Breakdown

### 3.1 Foundation Tasks (Phase 1)

#### Task 1.1: Create Type Definitions
**File**: `src/common/composition/types.ts`
**Effort**: 2 hours
**Dependencies**: None

**Subtasks**:
1. Define `CompositionDefinition` interface
2. Define `CompositionSpec` interface
3. Define `Step` types (CallStep, IfValueStep)
4. Define `ValueExpression` type
5. Define `Reference` interface
6. Define `Condition` type union
7. Define `CompiledComposition` interface
8. Define `ValidationReport` and error types
9. Add JSDoc documentation
10. Export all types

**Acceptance Criteria**:
- All types compile without errors
- Types match technical architecture spec
- JSDoc comments present

#### Task 1.2: Create DocumentStore Indexes (Optional)
**File**: `infrastructure/sql/migrations/001_composition_indexes.sql`
**Effort**: 0.5 hours
**Dependencies**: None

**Subtasks**:
1. Create index on `data->>'name'` for name lookups
2. Create index on `data->>'status'` for status filtering
3. Create index on `data->>'contentHash'` for deduplication
4. Create composite index on status+name for active composition queries
5. Test index performance (optional)

**Acceptance Criteria**:
- Indexes apply cleanly to PostgreSQL backend
- Migration is idempotent
- Query performance improved (optional verification)

#### Task 1.3: Set Up Test Infrastructure
**File**: `src/common/composition/__tests__/setup.ts`
**Effort**: 1 hour
**Dependencies**: None

**Subtasks**:
1. Create test directory structure
2. Add Jest configuration
3. Create test fixtures directory
4. Create mock ToolRegistry
5. Create test utilities

**Acceptance Criteria**:
- `npm test` runs without errors
- Test infrastructure isolates composition tests

---

### 3.2 Core Runtime Tasks (Phase 2)

#### Task 2.1: Implement Parser
**File**: `src/common/composition/parser.ts`
**Effort**: 4 hours
**Dependencies**: Task 1.1

**Subtasks**:
1. Create `CompositionParser` class
2. Implement `parse(source)` method
3. Implement YAML loading (via js-yaml)
4. Implement JSON parsing fallback
5. Implement `validateTopLevel()` method
6. Implement `canonicalize()` method
7. Implement `parseReference()` for shorthand syntax
8. Implement `canonicalizeStep()` method
9. Implement `canonicalizeValue()` method
10. Implement `canonicalizeCondition()` method
11. Add error handling and validation
12. Add comprehensive JSDoc

**Acceptance Criteria**:
- Valid YAML → AST conversion works
- Valid JSON → AST conversion works
- Shorthand references (`$input/foo`) canonicalize correctly
- Invalid input throws descriptive errors
- All edge cases handled

#### Task 2.2: Implement Parser Unit Tests
**File**: `src/common/composition/parser.test.ts`
**Effort**: 3 hours
**Dependencies**: Task 2.1

**Subtasks**:
1. Test valid YAML parsing
2. Test valid JSON parsing
3. Test reference canonicalization
4. Test invalid apiVersion → error
5. Test invalid kind → error
6. Test missing metadata.name → error
7. Test malformed YAML → error
8. Test edge cases (empty steps, null values)
9. Test all condition types
10. Achieve >90% code coverage

**Acceptance Criteria**:
- All tests pass
- Code coverage >90%
- Edge cases covered

#### Task 2.3: Implement Compiler
**File**: `src/common/composition/compiler.ts`
**Effort**: 5 hours
**Dependencies**: Task 1.1, Task 2.1

**Subtasks**:
1. Create `CompositionCompiler` class
2. Implement constructor with ToolRegistry dependency
3. Implement `compile(def)` method
4. Implement `validate(def)` method
5. Implement `extractToolIds()` helper
6. Implement `detectCycles()` with DFS algorithm
7. Implement `validateReferences()` method
8. Implement `resolveDependencies()` method
9. Implement `computeHash()` for content addressing
10. Implement `hashSchema()` for fingerprinting
11. Add comprehensive error codes
12. Add JSDoc documentation

**Acceptance Criteria**:
- Validation detects missing tools
- Cycle detection works (A → B → A)
- Reference validation catches undefined steps
- Content hashing is deterministic
- All validation errors have unique codes

#### Task 2.4: Implement Compiler Unit Tests
**File**: `src/common/composition/compiler.test.ts`
**Effort**: 3 hours
**Dependencies**: Task 2.3

**Subtasks**:
1. Test successful compilation
2. Test tool resolution (tool exists)
3. Test tool resolution (tool missing → error)
4. Test cycle detection (direct cycle)
5. Test cycle detection (indirect cycle)
6. Test cycle detection (no cycle)
7. Test reference validation
8. Test dependency extraction
9. Test content hash stability
10. Achieve >90% code coverage

**Acceptance Criteria**:
- All tests pass
- Cycle detection validated
- Code coverage >90%

#### Task 2.5: Implement Executor
**File**: `src/common/composition/executor.ts`
**Effort**: 6 hours
**Dependencies**: Task 1.1, Task 2.1

**Subtasks**:
1. Create `CompositionExecutor` class
2. Implement constructor with ToolRegistry + Logger
3. Implement `execute(compiled, ctx)` method
4. Implement `executeStep()` dispatcher
5. Implement `executeCallStep()` method
6. Implement `executeIfStep()` method
7. Implement `resolveValue()` for ValueExpressions
8. Implement `resolveReference()` for namespace resolution
9. Implement `navigatePointer()` for JSON Pointer traversal
10. Implement `evaluateCondition()` for all condition types
11. Add input/output schema validation (using AJV)
12. Add comprehensive logging
13. Add error handling and recovery

**Acceptance Criteria**:
- Sequential execution works
- References resolve correctly ($input, $context, $steps)
- All condition operators work (equals, greaterThan, etc.)
- Guarded steps (when: false) skip correctly
- Nested object/array resolution works
- Schema validation catches invalid input

#### Task 2.6: Implement Executor Unit Tests
**File**: `src/common/composition/executor.test.ts`
**Effort**: 4 hours
**Dependencies**: Task 2.5

**Subtasks**:
1. Test basic call step execution
2. Test sequential multi-step execution
3. Test $input reference resolution
4. Test $context reference resolution
5. Test $steps reference resolution
6. Test nested path resolution ($steps/user/id)
7. Test all condition operators
8. Test logical combinators (all, any, not)
9. Test guarded steps (when condition)
10. Test if/else value steps
11. Test nested object construction in return
12. Test error handling (tool not found, reference missing)
13. Achieve >90% code coverage

**Acceptance Criteria**:
- All tests pass
- Reference resolution validated
- Condition evaluation validated
- Code coverage >90%

---

### 3.3 Registry & Storage Tasks (Phase 3)

#### Task 3.1: Verify DocumentStore Collection Setup
**File**: N/A (verification task)
**Effort**: 0.5 hours
**Dependencies**: Task 1.2

**Subtasks**:
1. Verify `documentStore` resource available in tool-gateway
2. Test document creation in `compositions` collection
3. Test document retrieval by ID
4. Test query operations (filter by name, status)
5. Optional: Apply performance indexes (Task 1.2)

**Acceptance Criteria**:
- DocumentStore accessible from tool-gateway
- CRUD operations work on `compositions` collection
- Query filters work correctly

#### Task 3.2: Implement Registry Interface
**File**: `src/common/composition/registry.ts`
**Effort**: 3 hours
**Dependencies**: Task 1.1, Task 1.2

**Subtasks**:
1. Define `CompositionRegistry` interface
2. Implement `DocumentStoreCompositionRegistry` class
3. Implement `create(compiled, sourceYaml)` method using `documentStore.set()`
4. Implement `get(id)` method using `documentStore.get()`
5. Implement `getByName(name)` method using `documentStore.query()`
6. Implement `listActive()` method using `documentStore.query()`
7. Implement `updateStatus(id, status)` method using `documentStore.set()` with merge
8. Implement `delete(id)` method using `documentStore.delete()`
9. Implement `docToCompiled()` helper to convert DocumentStore docs to CompiledComposition
10. Add error handling (duplicate names, not found)
11. Add logging

**Acceptance Criteria**:
- CRUD operations work with DocumentStore API
- Queries use DocumentStore filter syntax
- Error handling is comprehensive
- Status filtering works via DocumentStore queries

#### Task 3.3: Implement Registry Unit Tests
**File**: `src/common/composition/registry.test.ts`
**Effort**: 2 hours
**Dependencies**: Task 3.2

**Subtasks**:
1. Create mock IDocumentStore implementation
2. Test create operation (verifies `documentStore.set()` called correctly)
3. Test get by ID (mocks `documentStore.get()`)
4. Test get by name (mocks `documentStore.query()` with filters)
5. Test list active compositions (mocks `documentStore.query()`)
6. Test update status (verifies merge flag used)
7. Test delete operation (verifies `documentStore.delete()` called)
8. Test not found → null
9. Test error handling
10. Achieve >85% code coverage

**Acceptance Criteria**:
- All tests pass
- Tests use mocked DocumentStore (no real database needed)
- Code coverage >85%

---

### 3.4 Tool-Gateway Integration Tasks (Phase 4)

#### Task 4.1: Add Composition Dependencies to Tool-Gateway
**File**: `src/apps/tool-gateway.ts`
**Effort**: 2 hours
**Dependencies**: Task 3.2

**Subtasks**:
1. Import composition modules
2. Add `compositionRegistry` field
3. Add `compositionExecutor` field
4. Initialize registry in constructor
5. Initialize executor in constructor
6. Handle missing documentStore gracefully

**Acceptance Criteria**:
- Tool-gateway compiles
- Dependencies inject correctly
- Graceful degradation if DB unavailable

#### Task 4.2: Implement Composition Loading
**File**: `src/apps/tool-gateway.ts`
**Effort**: 3 hours
**Dependencies**: Task 4.1

**Subtasks**:
1. Create `loadCompositions()` method
2. Call `loadCompositions()` in `setup()`
3. Create `registerCompositionTool()` method
4. Register in ToolRegistry
5. Register via Bit's MCP interface
6. Create `executeComposition()` method
7. Add error handling
8. Add logging

**Acceptance Criteria**:
- Compositions load on startup
- Compositions appear in MCP tools/list
- Execution succeeds via MCP
- Errors logged properly

#### Task 4.3: Add REST API Endpoints
**File**: `src/apps/tool-gateway.ts`
**Effort**: 3 hours
**Dependencies**: Task 4.2

**Subtasks**:
1. Add `POST /compositions` endpoint (create)
2. Add `GET /compositions` endpoint (list)
3. Add `GET /compositions/:id` endpoint (get)
4. Add `POST /compositions/:id/execute` endpoint (execute)
5. Add `DELETE /compositions/:id` endpoint (delete)
6. Add request validation
7. Add error handling (400, 404, 500)
8. Add logging

**Acceptance Criteria**:
- All endpoints work
- Validation rejects malformed requests
- Errors return proper HTTP status codes
- Logging captures requests

#### Task 4.4: Update Tool-Gateway Tests
**File**: `src/apps/tool-gateway.test.ts`
**Effort**: 2 hours
**Dependencies**: Task 4.3

**Subtasks**:
1. Add composition fixture
2. Test composition loading
3. Test MCP registration
4. Test composition execution via MCP
5. Update existing tests (if needed)

**Acceptance Criteria**:
- All tests pass
- New functionality covered

---

### 3.5 Testing & Validation Tasks (Phase 5)

#### Task 5.1: Create Integration Test Suite
**File**: `tests/integration/composition-e2e.test.ts`
**Effort**: 4 hours
**Dependencies**: Task 4.3

**Subtasks**:
1. Set up test environment (DocumentStore with in-memory or test backend, tool-gateway)
2. Create test composition (viewer_greeting)
3. Test: Load composition from YAML
4. Test: Parse and compile
5. Test: Register in tool-gateway
6. Test: Verify in tools/list
7. Test: Execute via MCP tools/call
8. Test: Verify structured output
9. Test: Nested composition (composition calls composition)
10. Tear down test environment

**Acceptance Criteria**:
- E2E flow works
- Nested composition works
- Tests clean up properly

#### Task 5.2: Create REST API Test Suite
**File**: `tests/apps/tool-gateway-composition-rest.test.ts`
**Effort**: 3 hours
**Dependencies**: Task 4.3

**Subtasks**:
1. Set up test server
2. Test: POST /compositions (create)
3. Test: GET /compositions (list)
4. Test: GET /compositions/:id (get)
5. Test: POST /compositions/:id/execute (execute)
6. Test: DELETE /compositions/:id (delete)
7. Test error cases (404, 400, 500)
8. Tear down test server

**Acceptance Criteria**:
- All REST endpoints tested
- Error cases covered
- Tests isolated

#### Task 5.3: Agent-Dev Validation
**File**: `planning/sprint-41-u18tqc/agent-dev-validation.md`
**Effort**: 3 hours
**Dependencies**: Task 4.3

**Subtasks**:
1. Provision agent-dev context
2. Deploy tool-gateway to agent-dev
3. Create sample composition (viewer_greeting.yaml)
4. Register via REST API
5. Invoke via MCP (simulate llm-bot)
6. Verify execution logs
7. Invoke via REST (simulate reflex)
8. Verify structured output
9. Document results
10. Destroy agent-dev context

**Acceptance Criteria**:
- Deployment succeeds
- MCP invocation works
- REST invocation works
- Results documented

#### Task 5.4: Performance Testing
**File**: `tests/performance/composition-perf.test.ts`
**Effort**: 2 hours
**Dependencies**: Task 5.1

**Subtasks**:
1. Create performance test harness
2. Test composition load time (<100ms)
3. Test compilation time
4. Test execution overhead (<10ms)
5. Test concurrent execution
6. Document results

**Acceptance Criteria**:
- Load time <100ms per composition
- Execution overhead <10ms
- No memory leaks

---

### 3.6 Documentation & Examples Tasks (Phase 6)

#### Task 6.1: Create Example Compositions
**Directory**: `compositions/examples/`
**Effort**: 3 hours
**Dependencies**: Task 4.3

**Subtasks**:
1. Create `viewer_greeting.yaml` (full example from arch doc)
2. Create `user_lookup.yaml` (simple 2-step example)
3. Create `conditional_alert.yaml` (demonstrates conditionals)
4. Create `nested_composition.yaml` (demonstrates nesting)
5. Add README explaining examples
6. Validate all examples compile

**Acceptance Criteria**:
- All examples are valid YAML
- All examples compile without errors
- README explains each example

#### Task 6.2: Create Operational Runbook
**File**: `documentation/guides/composition-operations.md`
**Effort**: 2 hours
**Dependencies**: Task 6.1

**Subtasks**:
1. Document composition authoring workflow
2. Document composition registration (REST API)
3. Document composition deployment
4. Document troubleshooting
5. Document common errors and solutions

**Acceptance Criteria**:
- Runbook is complete
- Examples are actionable
- Troubleshooting section useful

#### Task 6.3: Update Architecture Documentation
**File**: `documentation/architecture/composition-dsl.md`
**Effort**: 2 hours
**Dependencies**: Task 6.1

**Subtasks**:
1. Document DSL syntax
2. Document reference syntax ($input, $context, $steps)
3. Document condition operators
4. Document step types
5. Add examples for each concept
6. Link to operational runbook

**Acceptance Criteria**:
- Documentation is comprehensive
- Examples are clear
- Cross-references work

#### Task 6.4: Sprint Retrospective
**File**: `planning/sprint-41-u18tqc/retrospective.md`
**Effort**: 1 hour
**Dependencies**: Task 5.3

**Subtasks**:
1. Document what went well
2. Document challenges encountered
3. Document lessons learned
4. Document metrics achieved
5. Document next sprint recommendations

**Acceptance Criteria**:
- Retrospective is honest and actionable
- Metrics documented
- Recommendations clear

---

## 4. Risk Management

### 4.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Reference resolution complexity | High | Extensive unit tests, JSON Pointer spec compliance |
| Cycle detection edge cases | Medium | Use proven DFS algorithm, comprehensive test cases |
| Tool registry integration | Medium | Mock registry for tests, graceful degradation |
| DocumentStore integration | Low | Leverage existing abstraction, verify in tests |
| Performance issues | Medium | Performance testing, profiling, optimization if needed |

### 4.2 Schedule Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Executor complexity underestimated | High | Build in 20% buffer, prioritize core features |
| Integration issues with tool-gateway | Medium | Early integration testing, incremental approach |
| Agent-dev environment issues | Low | Documented fallback to manual testing |

---

## 5. Dependencies

### 5.1 External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| js-yaml | ^4.1.0 | YAML parsing |
| ajv | ^8.12.0 | JSON Schema validation |
| DocumentStore | Platform | Vendor-neutral composition storage |

### 5.2 Internal Dependencies

| Component | Purpose |
|-----------|---------|
| ToolRegistry | Tool resolution for compiler/executor |
| IDocumentStore | Database abstraction for registry |
| Bit base class | MCP integration |
| Logger | Structured logging |

---

## 6. Testing Strategy

### 6.1 Test Pyramid

```text
                    E2E Tests (5%)
                   /            \
              Integration (15%)
             /                  \
        Component Tests (30%)
       /                        \
  Unit Tests (50%)
```

**Coverage Targets**:
- Parser: >90%
- Compiler: >90%
- Executor: >90%
- Registry: >85%
- Overall: >80%

### 6.2 Test Types

1. **Unit Tests**: Isolated component testing
2. **Component Tests**: Module integration testing
3. **Integration Tests**: E2E flow testing
4. **Agent-Dev Tests**: Real environment validation
5. **Performance Tests**: Load/latency validation

---

## 7. Deployment Plan

### 7.1 Database Setup (Optional)

```bash
# Optional: Apply performance indexes (PostgreSQL backend only)
psql -U bitbrat -d bitbrat -f infrastructure/sql/migrations/001_composition_indexes.sql

# Verify indexes (PostgreSQL)
psql -U bitbrat -d bitbrat -c "\d+ documents"

# Note: No schema migration needed - DocumentStore uses existing 'documents' table
# Compositions stored in 'compositions' collection
```

### 7.2 Service Deployment

```bash
# Build
npm run build

# Deploy to agent-dev (validation)
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint41

# Deploy to local
npm run brat -- bit deploy tool-gateway --context local

# Deploy to staging
npm run brat -- bit deploy tool-gateway --context staging
```

### 7.3 Composition Registration

```bash
# Register example composition
curl -X POST http://localhost:3000/compositions \
  -H "Content-Type: application/yaml" \
  --data-binary @compositions/examples/viewer_greeting.yaml

# Verify registration
curl http://localhost:3000/compositions
```

---

## 8. Success Metrics

### 8.1 Development Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Unit test coverage | >80% | Jest coverage report |
| Integration test coverage | 100% of critical paths | Test suite pass rate |
| Code review approval | 100% | PR reviews |
| Build success rate | 100% | CI/CD pipeline |

### 8.2 Runtime Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Composition load time | <100ms | Performance tests |
| Execution overhead | <10ms | Benchmark suite |
| Compilation success rate | 100% for valid YAML | Error logs |
| API response time | <200ms | REST API tests |

### 8.3 Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Zero critical bugs | 0 | Bug tracker |
| Documentation completeness | 100% | Review checklist |
| Example composition validity | 100% | Validation suite |

---

## 9. Timeline

### Week 1: Foundation + Core Runtime

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| Mon | 1.1, 1.2, 1.3 | Type system + schema |
| Tue | 2.1, 2.2 | Parser + tests |
| Wed | 2.3, 2.4 | Compiler + tests |
| Thu | 2.5 (partial) | Executor (50%) |
| Fri | 2.5, 2.6 (partial) | Executor + tests (partial) |

### Week 2: Registry + Integration

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| Mon | 2.6 (complete), 3.1, 3.2 | Executor tests + Registry |
| Tue | 3.3, 4.1, 4.2 | Registry tests + Loading |
| Wed | 4.3, 4.4 | REST API + tests |
| Thu | 5.1, 5.2 | Integration tests |
| Fri | 5.3, 5.4 | Agent-dev + perf tests |

### Week 3: Polish + Documentation

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| Mon | 6.1, 6.2 | Examples + runbook |
| Tue | 6.3, 6.4 | Docs + retrospective |
| Wed | Buffer | Bug fixes, polish |
| Thu | Buffer | Final validation |
| Fri | Sprint review | Demo + closure |

---

## 10. Definition of Done

A task is considered complete when:

1. ✅ Code is written and follows style guide
2. ✅ Unit tests written and passing (>80% coverage)
3. ✅ Integration tests passing (if applicable)
4. ✅ Code reviewed and approved
5. ✅ Documentation updated
6. ✅ No regression in existing tests
7. ✅ Deployed to agent-dev (if applicable)
8. ✅ Acceptance criteria met

The sprint is considered complete when:

1. ✅ All 11 acceptance criteria met (from technical architecture)
2. ✅ All tests passing
3. ✅ Agent-dev validation successful
4. ✅ Documentation complete
5. ✅ Retrospective conducted

---

## 11. Communication Plan

### Daily Standup
- Format: Async (written update)
- Timing: Morning
- Content: Yesterday's progress, today's plan, blockers

### Mid-Sprint Review
- Timing: End of Week 1
- Content: Demo working parser/compiler/executor
- Attendees: Platform team

### Sprint Review
- Timing: End of Week 3 (Friday)
- Content: Full demo, retrospective
- Attendees: Platform team + stakeholders

---

**End of Implementation Plan**
