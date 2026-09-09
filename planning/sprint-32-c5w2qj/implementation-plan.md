# Sprint 32 Execution Plan
# Test Infrastructure Phase 3 - Complete Remediation (0 Failures Goal)

**Sprint**: sprint-32-[id-tbd]
**Goal**: Fix remaining 7 failing test suites from Sprint 31, achieve 0 failing tests and 100% pass rate
**Target**: 0 failing test suites, 100% pass rate, maintain <40s runtime
**Status**: Planning

---

## Executive Summary

Sprint 30 achieved **77% runtime improvement** and Sprint 31 achieved **additional 68% improvement**, reducing failing suites from 48 → 19 → 7. Sprint 32 focuses on **eliminating the final 7 failures** to achieve 100% pass rate.

**Key Learnings from Sprint 30 & 31**:
- Categorize failures by root cause (A/B/C/D framework)
- Isolation testing distinguishes environmental from bugs
- Extract ACTUAL test names from output (no placeholders)
- Apply quick wins before comprehensive fixes

---

## Sprint 31 Outcomes & Handoff

### Achievements ✅
- **Runtime**: 116s → 37s (68% improvement)
- **Failing suites**: 19 → 7 (63% reduction)
- **Pass rate**: 96.6% → 99.4% (+2.8%)
- **Categorization**: All 7 failures classified (A/B/D)
- **Query-analyzer bug**: Fixed

### Remaining Work - 7 Failing Suites
From Sprint 31's final validation summary:

**Category A: Docker/Infrastructure (3 suites)**
1. `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts`
   - Error: Missing .env.brat file in worktree
   - Root Cause: Agent-dev tests expect environment file

2. `tools/brat/src/dev-mcp/__tests__/environment-validation.test.ts`
   - Error: Expected 0 warnings, received 1
   - Root Cause: Docker Compose warnings

3. `tools/brat/src/infrastructure/__tests__/jetstream-validation.test.ts`
   - Error: Missing .env.brat, can't read container logs
   - Root Cause: Environment file missing

**Category B: Environmental/Resource (3 suites)**
4. `tests/common/mcp/proxy-invoker.spec.ts`
   - Error: `getaddrinfo ENOTFOUND nats`
   - Root Cause: NATS connectivity in full suite

5. `src/common/resources/redis-manager.test.ts` (NEW in Sprint 31)
   - Error: Redis not available
   - Root Cause: Environmental setup

6. `src/common/storage/drivers/filesystem-driver.test.ts` (NEW in Sprint 31)
   - Error: Filesystem permission or path issue
   - Root Cause: Environmental setup

**Category D: Legitimate Bugs (3 suites)**
7. `src/common/mcp/__tests__/client-manager-notifications.test.ts`
   - Error: 8 failures, 2 passing
   - Root Cause: **Fails in isolation** - legitimate bug

8. `tests/apps/tool-gateway-notifications.spec.ts`
   - Error: TBD (isolation test incomplete)
   - Root Cause: Requires investigation

9. `tests/common/mcp-server.spec.ts`
   - Error: 10 failures
   - Root Cause: **Fails in isolation** - legitimate bug

---

## Problem Statement

**Current State**: 7 failing test suites (25 failing tests) categorized as:
- **Category A**: Docker/Infrastructure (3 suites, 43%) - Environmental setup
- **Category B**: Environmental/Resources (3 suites, 43%) - NATS/Redis/Filesystem
- **Category D**: Legitimate Bugs (1 suite, 14%) - Code bugs requiring fixes

**Sprint 32 Objective**:
1. Fix Category A infrastructure issues (.env.brat, Docker warnings)
2. Fix Category B environmental failures (NATS, Redis, Filesystem)
3. Fix Category D legitimate bugs (client-manager-notifications, tool-gateway-notifications, mcp-server)
4. Achieve 0 failing test suites
5. Achieve 100% pass rate

---

## Execution Strategy

### Approach
**Systematic, evidence-based, complete remediation**

1. **Fix infrastructure first** - Category A (.env.brat setup) (30 min)
2. **Fix environmental issues** - Category B (NATS/Redis/Filesystem) (45 min)
3. **Fix legitimate bugs** - Category D (deep investigation) (60-90 min)
4. **Validate & celebrate** - Full test run, 100% pass rate (30 min)

### Phases

```
Phase 0: Setup & Baseline (15 min)
  ↓
Phase 1: Category A - Docker/Infrastructure (30 min)
  ↓
Phase 2: Category B - Environmental (45 min)
  ↓
Phase 3: Category D - Legitimate Bugs (60-90 min)
  ↓
Phase 4: Validation & Documentation (30 min)
```

**Total Estimated Duration**: 3 - 3.5 hours

---

## Phase 0: Setup & Baseline (T0-T1)

**Objective**: Establish starting point, confirm Sprint 31 results
**Duration**: 15 minutes
**Dependencies**: None

### T0: Environment Setup (5 min)

```bash
# Start new sprint
# (This will be done via MCP tool)

cd .worktrees/sprint-32-[id]
npm ci
npm run build
```

**Acceptance Criteria**:
- ✅ Sprint 32 initialized
- ✅ Dependencies installed
- ✅ Build passes

---

### T1: Confirm Sprint 31 Results (10 min)

**Objective**: Verify 7 failing suites, capture baseline

```bash
cd .worktrees/sprint-32-[id]
npm test 2>&1 | tee planning/sprint-32-[id]/baseline-test-output.txt
```

**Expected Results** (from Sprint 31):
- 7 failing suites
- 25 failing tests
- 99.4% pass rate
- ~37-40s runtime

**Create**: `planning/sprint-32-[id]/baseline-metrics.md`

**Acceptance Criteria**:
- ✅ Baseline captured
- ✅ 7 failing suites confirmed
- ✅ All failures match Sprint 31 categorization

---

## Phase 1: Category A - Docker/Infrastructure (T2-T4)

**Objective**: Fix .env.brat and Docker infrastructure issues
**Duration**: 30 minutes
**Dependencies**: Phase 0 complete
**Expected Impact**: 3 suites fixed

### T2: Create .env.brat in Worktrees (10 min)

**Problem**: agent-dev-e2e and jetstream-validation expect `.env.brat` file

**Investigation**:
```bash
# Find where .env.brat should be located
grep -r "\.env\.brat" tools/brat/src/dev-mcp/
grep -r "\.env\.brat" tools/brat/src/infrastructure/
```

**Solution**: Create `.env.brat` template or symlink from main repo

**Options**:
1. Copy from main repo: `cp .env.brat .worktrees/sprint-32-[id]/.env.brat`
2. Symlink: `ln -s ../../.env.brat .worktrees/sprint-32-[id]/.env.brat`
3. Create template if .env.brat doesn't exist

**Validation**:
```bash
npm test -- agent-dev-e2e.test.ts
npm test -- jetstream-validation.test.ts
# Expected: PASS or better error messages
```

**Acceptance Criteria**:
- ✅ .env.brat accessible in worktree
- ✅ agent-dev-e2e test passes or progresses past file-not-found
- ✅ jetstream-validation test passes or progresses
- ✅ Commit: `fix(tests): add .env.brat to worktrees for agent-dev tests`

---

### T3: Fix Environment Validation Warnings (10 min)

**Problem**: environment-validation.test.ts expects 0 warnings but receives 1

**Investigation**:
```bash
# Run test and capture full output
npm test -- environment-validation.test.ts 2>&1 | tee env-validation-debug.txt

# Identify the warning
grep -i "warn" env-validation-debug.txt
```

**Likely Issues**:
- Docker Compose deprecation warning
- Missing optional configuration
- Version mismatch warning

**Solution Options**:
1. Fix root cause of warning
2. Update test expectations if warning is acceptable
3. Suppress specific warning if it's benign

**Validation**:
```bash
npm test -- environment-validation.test.ts
# Expected: PASS
```

**Acceptance Criteria**:
- ✅ Warning identified
- ✅ Appropriate fix applied (suppress or fix)
- ✅ Test passes
- ✅ Commit: `fix(tests): resolve environment-validation warning`

---

### T4: Validate Category A Fixes (10 min)

**Objective**: Confirm all 3 Docker/Infrastructure tests pass

```bash
npm test -- agent-dev-e2e.test.ts
npm test -- environment-validation.test.ts
npm test -- jetstream-validation.test.ts
npm test 2>&1 | grep "Test Suites:"
# Expected: 4 failing suites (down from 7)
```

**Create**: `planning/sprint-32-[id]/category-a-results.md`

**Acceptance Criteria**:
- ✅ All 3 Category A tests pass
- ✅ Failing suites reduced from 7 → 4
- ✅ Results documented

---

## Phase 2: Category B - Environmental (T5-T7)

**Objective**: Fix NATS, Redis, and Filesystem environmental issues
**Duration**: 45 minutes
**Dependencies**: Phase 1 complete
**Expected Impact**: 3 suites fixed

### T5: Fix NATS Proxy Invoker (15 min)

**Problem**: proxy-invoker.spec.ts fails with `ENOTFOUND nats` in full suite

**Sprint 30/31 Context**: NATS_URL default already added in test-setup.js

**Investigation**:
```bash
# Test in isolation
npm test -- proxy-invoker.spec.ts 2>&1 | tee proxy-invoker-isolated.txt

# If PASS → Environmental (concurrency)
# If FAIL → Code bug
```

**If Environmental (PASS in isolation)**:
- Document as concurrency issue
- Consider marking test as sequential or adding retry logic

**If Code Bug (FAIL in isolation)**:
```bash
# Debug the test
grep -A 20 "describe.*proxy.*invoker" tests/common/mcp/proxy-invoker.spec.ts
# Review NATS connection setup
```

**Solution**:
```typescript
// If missing connection wait:
beforeAll(async () => {
  await messageBus.connect();
  await new Promise(resolve => setTimeout(resolve, 200)); // Wait for stable connection
});
```

**Validation**:
```bash
npm test -- proxy-invoker.spec.ts  # Should pass
npm test 2>&1 | grep "proxy-invoker"  # Verify in full suite
```

**Acceptance Criteria**:
- ✅ proxy-invoker test passes in isolation
- ✅ Test passes in full suite OR documented as environmental
- ✅ Commit: `fix(tests): resolve NATS connection in proxy-invoker test`

---

### T6: Fix Redis Manager Test (15 min)

**Problem**: redis-manager.test.ts NEW failure (appeared in Sprint 31 post-fix)

**Investigation**:
```bash
# Test in isolation
npm test -- redis-manager.test.ts 2>&1 | tee redis-manager-debug.txt

# Check error
grep -i "error\|fail" redis-manager-debug.txt
```

**Likely Issues**:
- Redis not available locally
- Connection timeout
- Missing REDIS_URL environment variable

**Solution Options**:
1. **Skip when Redis unavailable**:
```javascript
// In test file
beforeAll(async () => {
  try {
    await redis.ping();
  } catch {
    console.log('⏭️  Skipping redis-manager tests (Redis not available)');
    return;
  }
});
```

2. **Add Redis default** (if REDIS_URL missing):
```javascript
// test-setup.js
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://localhost:6379';
}
```

3. **Mock Redis** (if integration test):
```typescript
jest.mock('../common/resources/redis-manager', () => ({
  RedisManager: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    // ...
  }))
}));
```

**Validation**:
```bash
npm test -- redis-manager.test.ts
# Expected: PASS or SKIP
```

**Acceptance Criteria**:
- ✅ Test passes or skips gracefully when Redis unavailable
- ✅ No failure in full suite
- ✅ Commit: `fix(tests): handle Redis unavailability in redis-manager test`

---

### T7: Fix Filesystem Driver Test (15 min)

**Problem**: filesystem-driver.test.ts NEW failure (appeared in Sprint 31 post-fix)

**Investigation**:
```bash
# Test in isolation
npm test -- filesystem-driver.test.ts 2>&1 | tee filesystem-driver-debug.txt

# Check error
grep -i "error\|permission\|enoent" filesystem-driver-debug.txt
```

**Likely Issues**:
- Test directory permission issue
- Hardcoded path doesn't exist in worktree
- Cleanup not working properly

**Solution**:
```typescript
// In test file
const testDir = path.join(__dirname, '__test-data__');

beforeAll(async () => {
  // Ensure test directory exists with proper permissions
  await fs.promises.mkdir(testDir, { recursive: true, mode: 0o755 });
});

afterAll(async () => {
  // Clean up
  await fs.promises.rm(testDir, { recursive: true, force: true });
});
```

**Validation**:
```bash
npm test -- filesystem-driver.test.ts
# Expected: PASS
```

**Acceptance Criteria**:
- ✅ Test passes
- ✅ Proper setup/teardown implemented
- ✅ Commit: `fix(tests): fix filesystem-driver test directory setup`

---

## Phase 3: Category D - Legitimate Bugs (T8-T11)

**Objective**: Fix real bugs in client-manager-notifications, tool-gateway-notifications, and mcp-server
**Duration**: 60-90 minutes
**Dependencies**: Phase 0 complete (can run in parallel with Phases 1-2)
**Expected Impact**: 3 suites fixed

### T8: Investigate client-manager-notifications (20 min)

**Problem**: 8 failures, 2 passing - **fails in isolation** (confirmed Category D bug)

**Investigation**:
```bash
# Run in isolation with verbose output
npm test -- client-manager-notifications.test.ts --verbose 2>&1 | tee client-manager-debug.txt

# Extract failing test names
grep "✕" client-manager-debug.txt
```

**Analysis Steps**:
1. Read test file structure
2. Identify common failure pattern across 8 tests
3. Check recent changes to client-manager or notification system
4. Review mock setup in test

**Common Issues**:
- Mock expectations wrong (like query-analyzer in Sprint 31)
- Async timing issue (missing await)
- State pollution between tests
- Recent feature change not reflected in tests

**Create**: `planning/sprint-32-[id]/client-manager-analysis.md`

**Acceptance Criteria**:
- ✅ All 8 failures analyzed
- ✅ Root cause identified
- ✅ Fix approach documented
- ✅ Ready for T9

---

### T9: Fix client-manager-notifications (20 min)

**Objective**: Apply fix identified in T8

**Method**:
Based on T8 findings, apply appropriate fix:

**Example Fix Patterns**:
```typescript
// Pattern 1: Mock call count (like Sprint 31 query-analyzer)
expect(mockNotify).toHaveBeenCalledTimes(3); // Was 2, should be 3

// Pattern 2: Async await missing
await clientManager.notify(...); // Was missing await

// Pattern 3: Test isolation
beforeEach(() => {
  jest.clearAllMocks(); // Add this
});
```

**Validation**:
```bash
npm test -- client-manager-notifications.test.ts
# Expected: 10/10 passing (was 2/10)

npm test 2>&1 | grep "client-manager-notifications"
# Verify in full suite
```

**Acceptance Criteria**:
- ✅ All 10 tests pass
- ✅ Fix aligns with code/comments
- ✅ No regressions in full suite
- ✅ Commit: `fix(tests): correct client-manager-notifications test expectations`

---

### T10: Investigate & Fix tool-gateway-notifications (20 min)

**Problem**: TBD - isolation test incomplete in Sprint 31

**Investigation**:
```bash
# Test in isolation first
npm test -- tool-gateway-notifications.spec.ts 2>&1 | tee tool-gateway-debug.txt

# If PASS → Environmental (defer or document)
# If FAIL → Continue investigation
```

**If Fails in Isolation**:
1. Extract error message
2. Read test expectations
3. Compare to similar tests (e.g., client-manager-notifications)
4. Apply similar fix if pattern matches

**If Passes in Isolation**:
1. Document as environmental
2. Consider if fix is needed or acceptable

**Validation**:
```bash
npm test -- tool-gateway-notifications.spec.ts
npm test 2>&1 | grep "tool-gateway-notifications"
```

**Acceptance Criteria**:
- ✅ Test behavior understood (environmental or bug)
- ✅ If bug: fixed and passing
- ✅ If environmental: documented
- ✅ Commit: `fix(tests): resolve tool-gateway-notifications test`

---

### T11: Investigate & Fix mcp-server (30 min)

**Problem**: 10 failures - **fails in isolation** (confirmed Category D bug)

**Sprint 30 Context**: Sprint 30 attempted auth header fix, partial success

**Investigation**:
```bash
# Run in isolation with verbose output
npm test -- mcp-server.spec.ts --verbose 2>&1 | tee mcp-server-debug.txt

# Extract failures
grep "✕" mcp-server-debug.txt

# Compare to Sprint 30 changes
git log --oneline --grep="mcp-server" -10
git show [commit-hash]:tests/common/mcp-server.spec.ts
```

**Likely Issues**:
- Auth expectations changed (MCP SDK 2.0 migration)
- Endpoint changes not reflected in tests
- Mock configuration incomplete

**Sprint 30 Pattern** (bit-conformance): Updated to MCP SDK 2.0 endpoints

**Possible Fix**:
```typescript
// Check for endpoint changes
expect(res.status).toBe(200); // Was 404 expectation?

// Check for auth header requirements
.set('Authorization', 'Bearer test-token')

// Check for SSE endpoint updates
.get('/sse') // Was different endpoint?
```

**Validation**:
```bash
npm test -- mcp-server.spec.ts
# Expected: All tests passing

npm test 2>&1 | grep "mcp-server"
```

**Acceptance Criteria**:
- ✅ All 10 tests analyzed
- ✅ Root cause identified
- ✅ All tests pass
- ✅ Commit: `fix(tests): update mcp-server test expectations for SDK 2.0`

---

## Phase 4: Validation & Documentation (T12-T13)

**Objective**: Confirm 0 failures, celebrate 100% pass rate, document completion
**Duration**: 30 minutes
**Dependencies**: Phases 1-3 complete

### T12: Final Validation - 100% Pass Rate (15 min)

**Objective**: Confirm 0 failing tests across entire suite

```bash
npm test 2>&1 | tee planning/sprint-32-[id]/final-test-output.txt

# Verify metrics
tail -10 planning/sprint-32-[id]/final-test-output.txt
```

**Expected Results**:
- **Test Suites**: 0 failed, X skipped, XXX passed
- **Tests**: 0 failed, X skipped, X todo, XXXX passed
- **Pass Rate**: 100%
- **Runtime**: <45s (maintain Sprint 31 gains)

**Create**: `planning/sprint-32-[id]/metrics-comparison.md`

```markdown
# Sprint 32 Metrics Comparison

## Sprint Progression

| Metric | Sprint 30 End | Sprint 31 End | Sprint 32 End | Total Improvement |
|--------|---------------|---------------|---------------|-------------------|
| **Runtime** | 116s | 37s | [TBD]s | **[TBD]%** ✅ |
| **Failing Suites** | 19 | 7 | **0** | **100%** ✅ |
| **Failing Tests** | 57 | 25 | **0** | **100%** ✅ |
| **Pass Rate** | 96.6% | 99.4% | **100%** | **+3.4%** ✅ |

## Sprint 32 Impact

- **Category A Fixed**: 3 suites (.env.brat, Docker warnings)
- **Category B Fixed**: 3 suites (NATS, Redis, Filesystem)
- **Category D Fixed**: 1 suite (client-manager-notifications, tool-gateway-notifications, mcp-server)
- **Total Fixed**: 7 suites

## Cumulative Achievements

From Sprint 30 baseline to Sprint 32 completion:
- **Runtime**: 501s → [TBD]s (**[TBD]% reduction**)
- **Failing Suites**: 48 → 0 (**100% resolution**)
- **Failing Tests**: 112 → 0 (**100% resolution**)
```

**Acceptance Criteria**:
- ✅ 0 failing test suites
- ✅ 0 failing tests
- ✅ 100% pass rate achieved
- ✅ Runtime maintained <45s
- ✅ Metrics comparison documented

---

### T13: Complete Sprint Artifacts (15 min)

**Objective**: Document victory, capture learnings

**Artifacts to Create**:

1. **verification-report.md** - 100% pass rate validation
2. **retro.md** - What went well, final push to 100%
3. **key-learnings.md** - Technical insights from final fixes
4. **celebration.md** - Acknowledge 3-sprint journey to 100% pass rate

**Key Content**:
- Document fix patterns that worked (mock counts, async/await, env setup)
- Sprint 30 → 31 → 32 progression story
- Compound improvements (77% + 68% + X% = cumulative win)
- Template for future test remediation efforts

**Acceptance Criteria**:
- ✅ All sprint artifacts created
- ✅ 3-sprint journey documented
- ✅ Fix patterns captured for reuse
- ✅ Commit: `docs(sprint-32): complete sprint artifacts - 100% pass rate achieved`

---

## Success Criteria

### Must Have (P0-P1)
- ✅ All 7 failing suites from Sprint 31 fixed
- ✅ 0 failing test suites (100% goal)
- ✅ 0 failing tests
- ✅ 100% pass rate achieved
- ✅ Runtime maintained <45s
- ✅ All fixes validated in full suite

### Nice to Have (P2)
- ✅ Runtime improved beyond Sprint 31 (<35s)
- ✅ Comprehensive documentation of fix patterns
- ✅ Celebration artifact documenting 3-sprint journey

### Out of Scope
- ❌ Test stratification (unit/integration/e2e) - Sprint 33
- ❌ Bit.close() cleanup refactoring - Sprint 33
- ❌ Parallel test execution - Sprint 33

---

## Risk Management

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Category D bugs more complex than expected | Medium | High | Timebox investigation to 30min per suite, defer if blocked |
| Environmental fixes create new issues | Low | Medium | Test in isolation AND full suite after each fix |
| Can't reach 100% pass rate | Low | High | Document remaining failures clearly, defer to Sprint 33 |
| Fixes introduce regressions | Low | High | Run full suite after each phase |

### Rollback Strategy
Granular commits per task. Can cherry-pick successful fixes if regressions occur.

---

## Timeline

### Sprint Duration: 3 - 3.5 hours (focused work)

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Setup & Baseline | 15 min | 15 min |
| Phase 1: Category A (Infrastructure) | 30 min | 45 min |
| Phase 2: Category B (Environmental) | 45 min | 90 min |
| Phase 3: Category D (Bugs) | 60-90 min | 150-180 min |
| Phase 4: Validation | 30 min | 180-210 min |

**Total**: ~3-3.5 hours (conservative estimate)

### Execution Order
1. **T0-T1**: Setup and baseline
2. **T2-T4**: Category A fixes (sequential)
3. **T5-T7**: Category B fixes (sequential)
4. **T8-T11**: Category D fixes (can parallelize investigation)
5. **T12-T13**: Validation and documentation

---

## Sprint 30 & 31 Learnings Applied

1. ✅ **Categorize before fixing** - Categories A/B/D from Sprint 31
2. ✅ **Isolation testing for environmental vs bugs** - Will apply to all Category B
3. ✅ **Extract ACTUAL test names** - All 7 failures have real file paths
4. ✅ **Baseline before changes** - T1 captures starting point
5. ✅ **One fix at a time, validate** - Each task has validation step
6. ✅ **Document fix patterns** - T13 captures reusable patterns
7. ✅ **Mock call count bugs** - Pattern from Sprint 31 query-analyzer fix

---

## Key Insights from Sprint 31

### Environmental Auto-Fixes
Sprint 31 discovered 5 tests that failed in Sprint 30 now pass without code changes due to Sprint 30's Jest roots configuration. May see similar auto-fixes in Sprint 32 from Sprint 31 improvements.

### Quick Wins Effectiveness
Sprint 31's quick wins (NATS defaults, Docker skip) reduced failures 42% before any code fixes. Sprint 32 builds on this foundation.

### Compound Improvements
- Sprint 30: 501s → 116s (77% reduction)
- Sprint 31: 116s → 37s (68% reduction)
- Sprint 32: 37s → ??? (targeting 0 failures, maintain speed)

**Cumulative**: 93% runtime reduction from Sprint 30 baseline

---

## Next Steps

1. **Get user approval** for this plan
2. **Start Sprint 32** via MCP tool
3. **Execute Phases 0-4** sequentially
4. **Achieve 100% pass rate** 🎉
5. **Celebrate 3-sprint journey**

---

**Plan Status**: ✅ Ready for execution
**Approval**: ⏳ Pending user confirmation
**Expected Branch**: `feature/sprint-32-[id]-test-infrastructure-phase-3-complete-remediation`
