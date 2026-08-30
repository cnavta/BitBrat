# Test Infrastructure Remediation - Implementation Plan

**Sprint**: sprint-30-pe25g1
**Goal**: Fix failing tests, eliminate worktree duplication, resolve EventEmitter leaks, establish test execution paths
**Target**: Reduce test time from 5-10 minutes to 2-3 minutes
**Status**: Planning

---

## Execution Strategy

### Approach
**Incremental, risk-averse, data-driven**

1. **Measure before/after** - Capture baseline metrics
2. **Fix high-impact issues first** - Worktree duplication = 50% time reduction
3. **One fix at a time** - Validate each change independently
4. **No regressions** - Full test suite must pass after each phase
5. **Document learnings** - Update analysis with actual results

### Phases

```
Phase 0: Baseline Measurement (15 min)
  ↓
Phase 1: Quick Wins (30 min) ← THIS SPRINT FOCUS
  ↓
Phase 2: Test Failures (60 min)
  ↓
Phase 3: Validation & Documentation (30 min)
  ↓
Phase 4: (Future) Test Stratification
  ↓
Phase 5: (Future) Infrastructure Refactoring
```

---

## Phase 0: Baseline Measurement (T1)

**Objective**: Establish quantitative baseline for comparison
**Duration**: 15 minutes
**Dependencies**: None

### Tasks
1. **T1.1**: Run full test suite, capture metrics
   - Total runtime
   - Number of passing/failing tests
   - Number of test files discovered
   - EventEmitter warnings count
   - Memory usage

2. **T1.2**: Document current test file counts
   - Main repo test files
   - Worktree test files (duplication)
   - Total files discovered by Jest

3. **T1.3**: Create baseline snapshot
   - Save test output to `planning/sprint-30-pe25g1/baseline-test-output.txt`
   - Document metrics in `planning/sprint-30-pe25g1/baseline-metrics.md`

### Acceptance Criteria
- ✅ Full test run completed
- ✅ Metrics captured in structured format
- ✅ Baseline files committed to sprint branch

---

## Phase 1: Quick Wins (T2-T3)

**Objective**: Eliminate worktree duplication, patch EventEmitter warnings
**Duration**: 30 minutes
**Dependencies**: Phase 0 complete
**Expected Impact**: 50% reduction in test time

### T2: Fix Worktree Test Duplication (P0 - Critical)

**Problem**: Jest discovers tests in `.worktrees/sprint-27-6tp11t/` and runs duplicates

#### T2.1: Update jest.config.js (5 min)
```javascript
// jest.config.js:12-18
testPathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  '/deprecated/',
  '/.worktrees/',      // ADD THIS LINE
  '/tools/brat/src/oclif-commands/',
  'stream-analyst-service.test.ts',
],
```

**File**: `jest.config.js:12-18`

**Validation**:
```bash
npm test -- --listTests | grep -c ".worktrees"  # Should be 0
```

#### T2.2: Verify no worktree tests discovered (5 min)
- Run `npm test -- --listTests`
- Confirm no `.worktrees/` paths in output
- Count test files before/after

**Expected Reduction**: ~75 duplicate test files removed from discovery

#### T2.3: Run full test suite, measure improvement (10 min)
- Capture new runtime
- Compare to baseline (expect ~50% reduction)
- Document results in `planning/sprint-30-pe25g1/t2-results.md`

**Acceptance Criteria**:
- ✅ Zero test files from `.worktrees/` discovered
- ✅ Test time reduced by 40-60%
- ✅ All tests that were passing still pass
- ✅ Commit: `fix(tests): exclude .worktrees from Jest discovery`

**Rollback Plan**: Revert jest.config.js change

---

### T3: Patch EventEmitter Memory Leak (P0 - Critical)

**Problem**: 11 SIGTERM/SIGINT/beforeExit/exit listeners (limit: 10)

#### T3.1: Increase EventEmitter limit (temporary fix) (5 min)
```javascript
// jest.config.js (add to setup)
module.exports = () => {
  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/test-setup.js'],  // ADD THIS
    testPathIgnorePatterns: [
      '/node_modules/',
      '/dist/',
      '/deprecated/',
      '/.worktrees/',
      '/tools/brat/src/oclif-commands/',
      'stream-analyst-service.test.ts',
    ],
    // ... rest
  };
  // ... CI logic
};
```

**File**: Create `test-setup.js`:
```javascript
// test-setup.js
// Temporary fix for EventEmitter warnings during test execution
// Root cause (Bit cleanup) tracked in Phase 5
require('events').EventEmitter.defaultMaxListeners = 20;
```

**Acceptance Criteria**:
- ✅ No MaxListenersExceededWarning in test output
- ✅ Tests still pass
- ✅ Comment added explaining temporary nature
- ✅ Commit: `fix(tests): increase EventEmitter limit (temporary)`

**Note**: This is a **bandaid**. Root cause fix (Bit cleanup refactoring) deferred to Phase 5.

**Rollback Plan**: Delete test-setup.js, revert jest.config.js

---

## Phase 2: Fix Failing Tests (T4-T7)

**Objective**: Achieve 100% test pass rate
**Duration**: 60 minutes
**Dependencies**: Phase 1 complete

### T4: Fix MCP Discovery Test (P1 - High)

**File**: `tests/integration/mcp-discovery.test.ts`
**Failure**: Environment variable not interpolated in test mock

#### T4.1: Analyze root cause (10 min)
- Review test setup in `beforeAll()`
- Confirm env var interpolation timing issue
- Identify where `${MCP_AUTH_TOKEN}` should be resolved

#### T4.2: Fix env var setup (10 min)
**Problem**: `process.env.MCP_AUTH_TOKEN` set after server starts

**Solution**: Set env var before any server instantiation
```typescript
// tests/integration/mcp-discovery.test.ts:60-70
beforeAll(async () => {
  // MOVE THIS UP BEFORE ANY SERVER CREATION
  process.env.MCP_AUTH_TOKEN = 'dummy-token';
  process.env.MCP_EXTERNAL_URL = 'http://dummy-server/sse';

  // Force production mode to enable subscriptions
  process.env.NODE_ENV = 'production';
  delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;

  // Config for tool-gateway
  process.env.SERVICE_NAME = 'tool-gateway';

  toolGateway = new ToolGatewayServer();
  await toolGateway.start(0);
});
```

#### T4.3: Validate fix (5 min)
```bash
npm test -- tests/integration/mcp-discovery.test.ts
```

**Acceptance Criteria**:
- ✅ Test passes consistently (3 runs)
- ✅ Mock receives `Bearer dummy-token` (not template string)
- ✅ Commit: `fix(test): resolve env var interpolation in mcp-discovery test`

**Rollback Plan**: Revert test file changes

---

### T5: Fix Bit Conformance Test (P1 - High)

**File**: `tests/common/bit-conformance.spec.ts`

**Status**: May self-resolve after T2 (worktree duplication fix)

#### T5.1: Re-run test after worktree fix (5 min)
```bash
npm test -- tests/common/bit-conformance.spec.ts
```

**If passing**: Mark T5 complete, no changes needed
**If failing**: Proceed to T5.2

#### T5.2: Investigate remaining failures (15 min)
- Compare test behavior in worktree vs main
- Check for resource conflicts (ports, event listeners)
- Identify root cause

#### T5.3: Apply targeted fix (10 min)
- Based on T5.2 findings
- Document fix rationale

**Acceptance Criteria**:
- ✅ Test passes in main repo location
- ✅ No worktree-specific issues
- ✅ Commit: `fix(test): resolve bit-conformance test failures`

**Rollback Plan**: Revert test file changes

---

### T6: Fix MCP Server Test (P1 - High)

**File**: `tests/common/mcp-server.spec.ts`

**Failure**: Auth warnings treated as failures

#### T6.1: Analyze auth failure warnings (10 min)
```
console.warn mcp_server.auth_failed path=/sse ip=::ffff:127.0.0.1
```

**Question**: Is this expected behavior in test? (unauthenticated request test)

#### T6.2: Update test expectations (10 min)
**Option A**: Suppress expected auth warnings in test
```typescript
// Mock console.warn for expected auth failures
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = jest.fn();
});
afterEach(() => {
  console.warn = originalWarn;
});
```

**Option B**: Fix test to provide auth headers
```typescript
const res = await request(bit.getApp())
  .get('/sse')
  .set('Authorization', 'Bearer test-token');
expect(res.status).not.toBe(404);
```

**Decision**: Choose Option B (proper test authentication)

#### T6.3: Validate fix (5 min)
```bash
npm test -- tests/common/mcp-server.spec.ts
```

**Acceptance Criteria**:
- ✅ No auth_failed warnings in test output
- ✅ Test passes consistently
- ✅ Commit: `fix(test): add auth headers to mcp-server test requests`

**Rollback Plan**: Revert test file changes

---

### T7: Fix/Skip Agent-Dev E2E Test (P2 - Medium)

**File**: `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts`

**Failure**: Race condition or Docker unavailability

#### T7.1: Add Docker detection (10 min)
```typescript
// tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts:36-37
const skipIfNoDocker = async () => {
  try {
    await execAsync('docker info');
    return false;
  } catch {
    return true;
  }
};

beforeAll(async () => {
  if (await skipIfNoDocker()) {
    console.log('⏭️  Skipping E2E test (Docker not available)');
    return;
  }
  // ... rest of setup
}, 300000);
```

#### T7.2: Improve skip logic (5 min)
```typescript
it.skipIf(await skipIfNoDocker())('should respond to !ping with pong', async () => {
  // ... test
});
```

**Note**: Jest doesn't support async skipIf, use alternative:
```typescript
it('should respond to !ping with pong', async () => {
  if (await skipIfNoDocker()) {
    console.log('⏭️  Skipping (Docker unavailable)');
    return;
  }
  // ... test
});
```

#### T7.3: Validate fix (5 min)
- Run test with Docker running (should pass)
- Run test with Docker stopped (should skip gracefully)

**Acceptance Criteria**:
- ✅ Test passes when Docker available
- ✅ Test skips gracefully when Docker unavailable
- ✅ No error thrown, only console message
- ✅ Commit: `fix(test): gracefully skip agent-dev e2e when Docker unavailable`

**Rollback Plan**: Revert test file changes

---

## Phase 3: Validation & Documentation (T8-T9)

**Objective**: Confirm improvements, update documentation
**Duration**: 30 minutes
**Dependencies**: Phase 2 complete

### T8: Post-Fix Validation (P1 - High)

#### T8.1: Run full test suite (10 min)
```bash
npm test 2>&1 | tee planning/sprint-30-pe25g1/post-fix-test-output.txt
```

#### T8.2: Capture post-fix metrics (5 min)
- Total runtime
- Passing/failing tests count
- EventEmitter warnings (should be 0)
- Memory usage

#### T8.3: Compare to baseline (10 min)
Create `planning/sprint-30-pe25g1/metrics-comparison.md`:
```markdown
# Test Infrastructure Metrics Comparison

## Before (Baseline)
- Runtime: X minutes
- Test files discovered: Y
- Failing tests: 5
- EventEmitter warnings: 4 types × N tests

## After (Post-Fix)
- Runtime: X minutes (-50%)
- Test files discovered: Y (-75 files)
- Failing tests: 0
- EventEmitter warnings: 0

## Impact
- Time reduction: 50%
- Test stability: 100% pass rate
- Developer experience: ✅ Improved
```

**Acceptance Criteria**:
- ✅ All tests passing (0 failures)
- ✅ No EventEmitter warnings
- ✅ 40-60% time reduction achieved
- ✅ Metrics comparison document created

---

### T9: Update Documentation (P2 - Medium)

#### T9.1: Update README.md (10 min)
Add test execution guidance:
```markdown
## Testing

### Quick Test (All tests)
\`\`\`bash
npm test
\`\`\`

### Run Specific Tests
\`\`\`bash
npm test -- path/to/test.spec.ts
npm test -- --testPathPattern=integration
\`\`\`

### Test Infrastructure Notes
- Worktrees excluded from test discovery
- EventEmitter limit increased for test stability
- E2E tests require Docker (auto-skip if unavailable)
\`\`\`
```

#### T9.2: Update CONTRIBUTING.md (if exists) (5 min)
- Document test expectations
- Link to test infrastructure analysis

#### T9.3: Create sprint retrospective stub (5 min)
`planning/sprint-30-pe25g1/retrospective.md`:
```markdown
# Sprint 30 Retrospective

## What Went Well
- [To be filled at sprint completion]

## What Could Be Improved
- [To be filled at sprint completion]

## Key Learnings
- [To be filled at sprint completion]

## Metrics Achieved
- [Reference metrics-comparison.md]
```

**Acceptance Criteria**:
- ✅ README.md updated with test guidance
- ✅ Retrospective template created
- ✅ Commit: `docs(tests): update test execution guidance and create retrospective`

---

## Phase 4: Future Work - Test Stratification (Deferred)

**Not in this sprint - documented for future reference**

### Tasks (Future Sprint)
- Implement Jest projects (unit/integration/e2e separation)
- Create npm scripts: `test:unit`, `test:integration`, `test:e2e`
- Update CI pipeline to run stratified tests
- Add test coverage reporting

**Tracked in**: `planning/sprint-30-pe25g1/backlog.yaml` (future section)

---

## Phase 5: Future Work - Infrastructure Refactoring (Deferred)

**Not in this sprint - documented for future reference**

### Tasks (Future Sprint)
- Create BitTestFactory for shared fixtures
- Refactor Bit.close() to track/remove process listeners
- Enable parallel test execution (remove maxWorkers:1)
- Add test performance monitoring

**Tracked in**: `planning/sprint-30-pe25g1/backlog.yaml` (future section)

---

## Risk Management

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Worktree fix breaks valid tests | Low | High | Rollback plan, validate with full suite |
| EventEmitter limit masks real leaks | High | Low | Document as temporary, track root cause in Phase 5 |
| Test fixes introduce regressions | Medium | Medium | One fix at a time, validate after each |
| Time estimates too optimistic | Medium | Low | Timebox tasks, defer non-critical work |

### Rollback Strategy
Each task has explicit rollback plan. Git commits are granular (one per task). Can cherry-pick successful fixes if needed.

---

## Success Criteria (Sprint Completion)

### Must Have (P0-P1)
- ✅ All tests passing (100% pass rate)
- ✅ No EventEmitter warnings
- ✅ Test time reduced by 40-60%
- ✅ Worktree duplication eliminated
- ✅ Baseline and post-fix metrics documented

### Nice to Have (P2)
- ✅ Documentation updated
- ✅ Retrospective template created
- ⬜ Test stratification plan documented (defer to future)

### Out of Scope
- ❌ Jest projects implementation (Phase 4)
- ❌ Bit cleanup refactoring (Phase 5)
- ❌ Parallel test execution (Phase 5)

---

## Timeline

### Sprint Duration: 1-2 hours (focused work)

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Baseline | 15 min | 15 min |
| Phase 1: Quick Wins | 30 min | 45 min |
| Phase 2: Test Fixes | 60 min | 105 min |
| Phase 3: Validation | 30 min | 135 min |

**Total**: ~2.25 hours (conservative estimate)

### Execution Order
1. T1: Baseline measurement
2. T2: Worktree fix (highest impact)
3. T3: EventEmitter patch
4. T4-T7: Test fixes (parallel if possible)
5. T8: Post-fix validation
6. T9: Documentation

---

## Metrics & Reporting

### Key Metrics to Track
1. **Test execution time** (before/after)
2. **Test file count** (discovered by Jest)
3. **Pass/fail rate** (0 failures target)
4. **Warning count** (EventEmitter)
5. **Memory usage** (if available)

### Reporting Format
- Baseline metrics: `planning/sprint-30-pe25g1/baseline-metrics.md`
- Post-fix metrics: `planning/sprint-30-pe25g1/metrics-comparison.md`
- Task results: `planning/sprint-30-pe25g1/t{N}-results.md`

---

## Next Steps

1. **Get user approval** for this plan
2. **Update sprint status** to `in-progress`
3. **Execute Phase 0** (baseline measurement)
4. **Execute Phases 1-3** sequentially
5. **Complete sprint** with verification report

---

**Plan Status**: ✅ Ready for execution
**Approval**: ⏳ Pending user confirmation
**Branch**: `feature/sprint-30-pe25g1-test-infrastructure-remediatio`
