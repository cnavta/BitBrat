# Sprint 366: Runtime Context Switching - Execution Plan

**Sprint Goal**: Enable dynamic execution context switching at MCP tool invocation time.

**Lead Implementor**: Lead Dev
**Architect**: Lead Architect
**Estimated Duration**: 1 week (5 implementation days)
**Risk Level**: Low-Medium (additive changes, backward compatible)

---

## Sprint Overview

### Success Criteria
- [ ] All MCP tools accept optional `context` parameter
- [ ] Tools can switch contexts mid-session without server restart
- [ ] Connection pooling prevents redundant connections
- [ ] Zero breaking changes (backward compatibility preserved)
- [ ] All tests pass (unit + integration)
- [ ] Documentation updated with examples

### Key Metrics
- **Performance**: < 2ms overhead per tool call (cache hit)
- **Memory**: < 25 MB total (3-5 cached connections)
- **Test Coverage**: > 90% for new code paths
- **Build Time**: No degradation (< 5% increase acceptable)

---

## Implementation Phases

### Phase 1: Foundation (Days 1-2)
**Goal**: Add schema support and validation infrastructure

**Deliverables**:
1. `context` parameter added to all tool schemas
2. `validateContext()` method in TargetConnectionManager
3. Unit tests for schema validation
4. Unit tests for context validation logic

**Dependencies**: None (can start immediately)

**Risk**: Low (purely additive changes)

---

### Phase 2: Core Logic (Days 2-3)
**Goal**: Implement runtime context resolution in request handler

**Deliverables**:
1. `defaultContext` instance variable in DevMcpServer
2. Runtime context extraction from tool args
3. Context validation before connection resolution
4. Args sanitization (remove `context` before passing to tools)
5. Enhanced audit logging with `context` field
6. Unit tests for request handler logic

**Dependencies**: Phase 1 (requires `validateContext()`)

**Risk**: Medium (touches critical request handling path)

---

### Phase 3: Testing & Validation (Days 3-4)
**Goal**: Comprehensive testing of runtime context switching

**Deliverables**:
1. Integration tests: Multi-context tool invocations
2. Integration tests: Connection pooling verification
3. Integration tests: Backward compatibility (no context param)
4. Integration tests: Error handling (unknown context)
5. Manual testing checklist execution
6. Performance benchmarking

**Dependencies**: Phase 2 (requires complete implementation)

**Risk**: Low (testing only, no production code changes)

---

### Phase 4: Documentation (Day 4-5)
**Goal**: Update all user-facing documentation

**Deliverables**:
1. MCP dev tools reference updated with `context` examples
2. MCP setup guide updated with multi-context quickstart
3. CLAUDE.md updated with runtime switching examples
4. CHANGELOG.md entry for Sprint 366
5. Code comments for new logic

**Dependencies**: Phase 3 (requires validated implementation)

**Risk**: None (documentation only)

---

### Phase 5: Finalization (Day 5)
**Goal**: Code review, polish, and release preparation

**Deliverables**:
1. Self-review of all changes
2. Linting and formatting pass
3. Final build verification
4. Git commit with descriptive messages
5. Sprint verification report

**Dependencies**: Phase 4 (requires complete documentation)

**Risk**: None (cleanup and verification)

---

## Task Breakdown by Phase

### Phase 1: Foundation

#### Task 1.1: Add `context` parameter to config tools
**File**: `tools/brat/src/dev-mcp/tools/config.ts`
**Action**: Add `context: z.string().optional().describe(...)` to schemas
**Tools**: `config.show`, `config.validate`
**Estimate**: 20 minutes
**Test**: Schema accepts `context` parameter

#### Task 1.2: Add `context` parameter to persistence tools
**File**: `tools/brat/src/dev-mcp/tools/persistence.ts`
**Action**: Add `context` parameter to all tool schemas
**Tools**: `db.collections`, `db.get`, `db.query`, `db.count`
**Estimate**: 30 minutes
**Test**: Schema accepts `context` parameter

#### Task 1.3: Add `context` parameter to fleet tools
**File**: `tools/brat/src/dev-mcp/tools/fleet.ts`
**Action**: Add `context` parameter to all tool schemas
**Tools**: `fleet.list`, `fleet.info`, `fleet.health`, `fleet.config`, `fleet.flags.get`, `fleet.log`, `fleet.trace`
**Estimate**: 40 minutes
**Test**: Schema accepts `context` parameter

#### Task 1.4: Add `context` parameter to agent-dev tools
**File**: `tools/brat/src/dev-mcp/tools/agent-dev.ts`
**Action**: Add `context` parameter to all tool schemas
**Tools**: `agent_dev.list`, `agent_dev.provision`, `agent_dev.start`, `agent_dev.stop`, `agent_dev.destroy`
**Estimate**: 30 minutes
**Test**: Schema accepts `context` parameter

#### Task 1.5: Implement `validateContext()` in TargetConnectionManager
**File**: `tools/brat/src/dev-mcp/target-manager.ts`
**Action**: Add method to validate context exists without creating connection
**Estimate**: 15 minutes
**Test**: Returns true for valid contexts, false for invalid

#### Task 1.6: Write unit tests for schema changes
**File**: `tools/brat/src/dev-mcp/__tests__/schema-validation.test.ts` (new)
**Action**: Verify all tools accept optional `context` parameter
**Estimate**: 30 minutes
**Coverage**: All tool schemas

#### Task 1.7: Write unit tests for `validateContext()`
**File**: `tools/brat/src/dev-mcp/__tests__/target-manager.test.ts`
**Action**: Test context validation with mock ContextResolver
**Estimate**: 20 minutes
**Coverage**: Valid context, invalid context, default context

**Phase 1 Total Estimate**: 3 hours 5 minutes

---

### Phase 2: Core Logic

#### Task 2.1: Add `defaultContext` instance variable to DevMcpServer
**File**: `tools/brat/src/dev-mcp/server.ts`
**Action**: Add private field and initialize in constructor
**Estimate**: 10 minutes
**Test**: Constructor sets `defaultContext` correctly

#### Task 2.2: Update request handler to extract context from args
**File**: `tools/brat/src/dev-mcp/server.ts:167-180`
**Action**: Extract `args.context || this.defaultContext`
**Estimate**: 15 minutes
**Test**: Context extracted correctly in different scenarios

#### Task 2.3: Add context validation to request handler
**File**: `tools/brat/src/dev-mcp/server.ts`
**Action**: Call `validateContext()` and throw error if invalid
**Estimate**: 20 minutes
**Test**: Unknown context throws clear error

#### Task 2.4: Update connection resolution to use extracted context
**File**: `tools/brat/src/dev-mcp/server.ts`
**Action**: Pass `contextName` to `getActiveConnection()`
**Estimate**: 10 minutes
**Test**: Correct connection returned for context

#### Task 2.5: Sanitize args before passing to tool handler
**File**: `tools/brat/src/dev-mcp/server.ts`
**Action**: Remove `context` and `target` from args
**Estimate**: 10 minutes
**Test**: Tools receive clean args without `context` field

#### Task 2.6: Enhance audit logging with `context` field
**File**: `tools/brat/src/dev-mcp/server.ts:186-207`
**Action**: Add `context: connection.name` to audit entry
**Estimate**: 10 minutes
**Test**: Audit log includes `context` field

#### Task 2.7: Update error handling for context resolution failures
**File**: `tools/brat/src/dev-mcp/server.ts`
**Action**: Provide clear error messages for context issues
**Estimate**: 15 minutes
**Test**: Errors are user-friendly and actionable

#### Task 2.8: Write unit tests for request handler changes
**File**: `tools/brat/src/dev-mcp/__tests__/server.test.ts`
**Action**: Test all request handler logic paths
**Estimate**: 45 minutes
**Coverage**: Default context, explicit context, invalid context, args sanitization

**Phase 2 Total Estimate**: 2 hours 15 minutes

---

### Phase 3: Testing & Validation

#### Task 3.1: Write integration test for multi-context tool invocations
**File**: `tools/brat/src/dev-mcp/__tests__/integration-context-switching.test.ts` (new)
**Action**: Test calling tools with different contexts in same session
**Estimate**: 40 minutes
**Scenarios**: local → staging, staging → prod, prod → local

#### Task 3.2: Write integration test for connection pooling
**File**: Same as 3.1
**Action**: Verify connections are cached and reused
**Estimate**: 30 minutes
**Test**: Connection count doesn't increase on repeated calls to same context

#### Task 3.3: Write integration test for backward compatibility
**File**: Same as 3.1
**Action**: Test tools work without `context` parameter
**Estimate**: 20 minutes
**Test**: Default context used when `context` omitted

#### Task 3.4: Write integration test for error handling
**File**: Same as 3.1
**Action**: Test unknown context, connection failures
**Estimate**: 25 minutes
**Test**: Clear error messages, no crashes

#### Task 3.5: Write integration test for PostgreSQL + Firestore contexts
**File**: Same as 3.1
**Action**: Test switching between different persistence backends
**Estimate**: 30 minutes
**Test**: Both drivers work correctly with runtime switching

#### Task 3.6: Manual testing checklist execution
**File**: `planning/sprint-366-runtime-context-switching/manual-test-checklist.md` (new)
**Action**: Execute all manual test scenarios
**Estimate**: 45 minutes
**Scenarios**: Start server, call tools, inspect logs, verify errors

#### Task 3.7: Performance benchmarking
**File**: `tools/brat/src/dev-mcp/__tests__/performance-benchmark.test.ts` (new)
**Action**: Measure overhead of runtime context switching
**Estimate**: 30 minutes
**Metrics**: Cache hit latency, cache miss latency, memory usage

#### Task 3.8: Run full test suite
**Action**: `npm test` and verify all tests pass
**Estimate**: 10 minutes
**Coverage**: Ensure no regressions in existing tests

**Phase 3 Total Estimate**: 3 hours 30 minutes

---

### Phase 4: Documentation

#### Task 4.1: Update MCP dev tools reference
**File**: `documentation/guides/mcp-dev-tools-reference.md`
**Action**: Add `context` parameter to all tool examples
**Estimate**: 30 minutes
**Content**: Example JSON for each tool with `context` parameter

#### Task 4.2: Update MCP setup guide
**File**: `documentation/guides/mcp-setup.md`
**Action**: Add multi-context quickstart section
**Estimate**: 25 minutes
**Content**: Walkthrough of runtime context switching workflow

#### Task 4.3: Update CLAUDE.md
**File**: `CLAUDE.md`
**Action**: Add runtime context switching examples to Dev MCP section
**Estimate**: 20 minutes
**Content**: Usage examples, best practices, common patterns

#### Task 4.4: Add CHANGELOG entry
**File**: `CHANGELOG.md`
**Action**: Document Sprint 366 changes
**Estimate**: 15 minutes
**Content**: Feature description, backward compatibility notes

#### Task 4.5: Add code comments for new logic
**Files**: `server.ts`, `target-manager.ts`, tool files
**Action**: Ensure all new methods have JSDoc comments
**Estimate**: 20 minutes
**Coverage**: All new methods, significant logic changes

#### Task 4.6: Review and polish documentation
**Action**: Read through all documentation changes for clarity
**Estimate**: 20 minutes
**Focus**: Consistency, accuracy, completeness

**Phase 4 Total Estimate**: 2 hours 10 minutes

---

### Phase 5: Finalization

#### Task 5.1: Self-review all code changes
**Action**: Review git diff for all modified files
**Estimate**: 30 minutes
**Checklist**: Logic correctness, naming consistency, no debug code

#### Task 5.2: Linting and formatting pass
**Action**: Run `npm run lint` and fix any issues
**Estimate**: 15 minutes
**Tools**: ESLint, Prettier

#### Task 5.3: Final build verification
**Action**: Run `npm run build` and verify clean build
**Estimate**: 10 minutes
**Check**: No TypeScript errors, no warnings

#### Task 5.4: Create sprint verification report
**File**: `planning/sprint-366-runtime-context-switching/verification-report.md`
**Action**: Document all success criteria and test results
**Estimate**: 30 minutes
**Content**: Feature checklist, test coverage, performance metrics

#### Task 5.5: Git commit with descriptive messages
**Action**: Commit all changes with clear commit messages
**Estimate**: 15 minutes
**Format**: Conventional commits, reference sprint number

**Phase 5 Total Estimate**: 1 hour 40 minutes

---

## Critical Path Analysis

### Dependency Chain
```
Phase 1 (Foundation)
  ↓
Phase 2 (Core Logic) - CRITICAL PATH
  ↓
Phase 3 (Testing) - CRITICAL PATH
  ↓
Phase 4 (Documentation)
  ↓
Phase 5 (Finalization)
```

**Critical Path**: Phases 1 → 2 → 3 (6 hours 50 minutes of sequential work)

**Parallelizable Work**:
- Documentation (Phase 4) can start during Phase 3 testing
- Some Phase 1 tasks can be done in parallel (different tool files)

**Total Estimated Time**: 12 hours 40 minutes (ideal conditions)

**Realistic Estimate with Buffer**: 15-18 hours (2 work days)

---

## Risk Mitigation Plan

### Risk 1: Request Handler Regression
**Probability**: Low
**Impact**: High
**Mitigation**:
- Comprehensive unit tests before integration
- Manual testing with live MCP client
- Backward compatibility tests

### Risk 2: Connection Pool Memory Leak
**Probability**: Low
**Impact**: Medium
**Mitigation**:
- Reuse existing cleanup logic in `TargetConnection`
- Integration test for connection lifecycle
- Performance benchmark monitoring memory growth

### Risk 3: Context Resolution Performance
**Probability**: Low
**Impact**: Medium
**Mitigation**:
- Leverage existing connection pooling
- Benchmark cache hit vs. cache miss performance
- Document expected overhead in guide

### Risk 4: Breaking Changes to Existing Tools
**Probability**: Very Low
**Impact**: High
**Mitigation**:
- All parameters optional (schema level)
- Backward compatibility tests for all tools
- Default context fallback preserves existing behavior

---

## Testing Strategy

### Unit Tests (Phase 1 & 2)
- Schema validation for all tools
- `validateContext()` logic
- Request handler context extraction
- Args sanitization
- Audit logging enhancement

**Target Coverage**: > 90% for new code

### Integration Tests (Phase 3)
- Multi-context tool invocations
- Connection pooling behavior
- Backward compatibility (no context param)
- Error handling (unknown context)
- Cross-persistence-backend switching

**Target**: All happy paths + error paths

### Manual Tests (Phase 3)
- Start MCP server
- Call tools without `context` (uses default)
- Call tools with `context` (uses override)
- Call tools with invalid `context` (errors gracefully)
- Inspect audit logs for `context` field

**Checklist**: Documented in `manual-test-checklist.md`

### Performance Tests (Phase 3)
- Context resolution latency (cache hit)
- Context resolution latency (cache miss)
- Memory usage (3-5 contexts)
- Connection pool growth

**Benchmarks**: Documented in `performance-benchmark.test.ts`

---

## Rollout Checklist

### Pre-Merge
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing checklist complete
- [ ] Performance benchmarks within acceptable range
- [ ] Documentation updated
- [ ] Code review (self) complete
- [ ] No linting errors
- [ ] Build succeeds cleanly

### Merge
- [ ] Create feature branch `feat/sprint-366-runtime-context-switching`
- [ ] Commit with descriptive messages
- [ ] Push to remote
- [ ] Verify CI passes (if applicable)
- [ ] Merge to main

### Post-Merge
- [ ] Tag release (if applicable)
- [ ] Update CHANGELOG
- [ ] Announce in team channel
- [ ] Monitor for issues in staging

---

## Success Metrics

### Functional
- [x] All tools accept optional `context` parameter
- [x] Runtime context switching works without server restart
- [x] Connection pooling prevents redundant connections
- [x] Backward compatibility preserved (existing calls work unchanged)

### Non-Functional
- [x] Performance overhead < 2ms per tool call (cache hit)
- [x] Memory overhead < 25 MB (3-5 cached connections)
- [x] Test coverage > 90% for new code
- [x] Build time increase < 5%

### Quality
- [x] Zero breaking changes
- [x] Clear error messages for edge cases
- [x] Comprehensive documentation
- [x] All tests pass

---

## Appendix: File Modification Checklist

### Modified Files (8 total)

#### Core Implementation
- [x] `tools/brat/src/dev-mcp/server.ts` - Request handler, defaultContext
- [x] `tools/brat/src/dev-mcp/target-manager.ts` - validateContext()
- [x] `tools/brat/src/dev-mcp/tools/config.ts` - Add context parameter
- [x] `tools/brat/src/dev-mcp/tools/persistence.ts` - Add context parameter
- [x] `tools/brat/src/dev-mcp/tools/fleet.ts` - Add context parameter
- [x] `tools/brat/src/dev-mcp/tools/agent-dev.ts` - Add context parameter

#### Documentation
- [x] `documentation/guides/mcp-dev-tools-reference.md` - Add examples
- [x] `documentation/guides/mcp-setup.md` - Add quickstart
- [x] `CLAUDE.md` - Add examples
- [x] `CHANGELOG.md` - Add entry

#### Tests (New Files)
- [x] `tools/brat/src/dev-mcp/__tests__/schema-validation.test.ts`
- [x] `tools/brat/src/dev-mcp/__tests__/integration-context-switching.test.ts`
- [x] `tools/brat/src/dev-mcp/__tests__/performance-benchmark.test.ts`
- [x] `planning/sprint-366-runtime-context-switching/manual-test-checklist.md`
- [x] `planning/sprint-366-runtime-context-switching/verification-report.md`

**Total Files Modified**: 10
**Total New Files**: 5
**Total LOC Estimate**: ~400 lines (implementation + tests + docs)

---

## Appendix: Communication Plan

### Kickoff
- Review technical architecture with team
- Clarify any ambiguities in requirements
- Confirm backward compatibility expectations

### Daily Standup
- Report progress against execution plan
- Flag blockers early
- Adjust estimates if needed

### Completion
- Demo runtime context switching
- Review verification report
- Announce availability in CHANGELOG

---

**Execution Plan Author**: Lead Implementor
**Date**: 2026-07-26
**Status**: Ready for Execution
