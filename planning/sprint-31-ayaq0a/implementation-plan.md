# Test Infrastructure Phase 2 - Implementation Plan

**Sprint**: sprint-31-ayaq0a
**Goal**: Apply Sprint 30 quick wins, systematically investigate NATS connectivity failures, identify and fix ACTUAL failing tests, achieve <10 failing test suites
**Target**: Reduce failing test suites from 19 to <10, establish 100% reproducible test runs
**Status**: Planning

---

## Executive Summary

Sprint 30 achieved **77% runtime improvement** and **60% reduction in test failures** through worktree configuration fixes and EventEmitter mitigation. Sprint 31 focuses on **eliminating remaining failures** through systematic investigation and targeted fixes.

**Key Learning from Sprint 30**: Categorize failures by root cause BEFORE fixing, and verify file existence before creating tasks (avoid placeholders).

---

## Sprint 30 Outcomes & Handoff

### Achievements ✅
- **Runtime**: 501s → 116s (77% improvement)
- **Test discovery**: 1,802 → 499 files (72% reduction)
- **Failing suites**: 48 → 19 (60% reduction)
- **Jest roots configuration**: Tests now work from worktrees
- **EventEmitter warnings**: Suppressed (temporary fix)

### Remaining Work
- **19 failing test suites** (57 failing tests)
- **Quick wins identified** but not implemented
- **Category D failures**: Placeholder names, need actual identification
- **NATS failures**: Suspected environmental, not code bugs

---

## Problem Statement

**Current State**: 19 failing test suites categorized as:
- **Category A**: Docker/Infrastructure (8 suites, ~40%) - Environmental
- **Category B**: NATS Connectivity (5 suites, ~25%) - Suspected concurrency issues
- **Category C**: Main Repo Artifacts (3 suites, ~15%) - Auto-resolve on merge
- **Category D**: Legitimate Bugs (3 suites, ~20%) - **PLACEHOLDER NAMES** ⚠️

**Critical Gap**: Sprint 30's Category D test names (`stream-processing.test.ts`, `routing-slip.test.ts`, `webhook-validation.test.ts`) are placeholders and **don't exist**. Must identify ACTUAL failing tests.

**Sprint 31 Objective**:
1. Apply quick wins (NATS defaults, Docker skip)
2. Identify ACTUAL failing tests (not placeholders)
3. Investigate NATS failures using isolation testing
4. Fix legitimate bugs
5. Achieve <10 failing suites with reproducible failures

---

## Execution Strategy

### Approach
**Evidence-based, systematic, incremental**

1. **Apply quick wins first** - Low-hanging fruit (25 min)
2. **Measure current state** - Run tests, extract ACTUAL failures (15 min)
3. **Categorize by root cause** - Docker/NATS/Bugs using isolation testing (30 min)
4. **Fix high-impact issues** - NATS and legitimate bugs (60-90 min)
5. **Validate & document** - Full test run, metrics comparison (30 min)

### Phases

```
Phase 0: Setup & Quick Wins (25 min)
  ↓
Phase 1: Current State Assessment (30 min)
  ↓
Phase 2: NATS Investigation (45 min)
  ↓
Phase 3: Legitimate Bug Fixes (45-60 min)
  ↓
Phase 4: Validation & Documentation (30 min)
```

**Total Estimated Duration**: 2.5 - 3 hours

---

## Phase 0: Setup & Quick Wins (T0-T3)

**Objective**: Apply Sprint 30 quick wins to reduce noise
**Duration**: 25 minutes
**Dependencies**: None

### T0: Environment Setup (5 min)

```bash
cd .worktrees/sprint-31-ayaq0a
npm ci
npm run build
```

**Acceptance Criteria**:
- ✅ Dependencies installed
- ✅ Build passes
- ✅ Ready to run tests

---

### T1: Quick Win 1 - NATS_URL Default (5 min)

**Problem**: 5 test suites fail with `getaddrinfo ENOTFOUND nats`
**Solution**: Provide sensible default in test setup

**File**: `test-setup.js` (already exists from Sprint 30)

**Change**:
```javascript
// test-setup.js
// ... existing EventEmitter fix ...

// Quick Win 1: Provide NATS_URL default for tests
// Fixes ENOTFOUND nats errors when NATS_URL not set
if (!process.env.NATS_URL) {
  process.env.NATS_URL = 'nats://localhost:4222';
}
```

**Validation**:
```bash
npm test -- test-final-check-service.test.ts
# Expected: PASS or skip gracefully (not ENOTFOUND)
```

**Expected Impact**: May fix 5 NATS-related test suites immediately

**Acceptance Criteria**:
- ✅ NATS_URL default added to test-setup.js
- ✅ No ENOTFOUND errors in test output
- ✅ Commit: `fix(tests): add NATS_URL default for test environment`

---

### T2: Quick Win 2 - Skip Docker Tests When Unavailable (10 min)

**Problem**: 8 test suites fail when Docker unavailable (agent-dev-e2e, obs-mcp build, etc.)
**Solution**: Conditional skip based on Docker availability

**File**: `jest.config.js`

**Change**:
```javascript
// jest.config.js
function hasDocker() {
  try {
    require('child_process').execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = () => {
  const isCI = !!process.env.CI;

  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '.',
    roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools'],
    setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
    testPathIgnorePatterns: [
      '/node_modules/',
      '/dist/',
      '/deprecated/',
      '/tools/brat/src/oclif-commands/',
      'stream-analyst-service.test.ts',
    ],
    // ... rest of config
  };

  // Skip Docker-dependent tests when Docker unavailable
  if (!hasDocker()) {
    console.log('⏭️  Docker unavailable - skipping E2E tests requiring Docker');
    base.testPathIgnorePatterns.push(
      'agent-dev-e2e.test.ts',
      'jetstream-validation.test.ts',
      'docker-compose-.*\\.test\\.ts'
    );
  }

  // ... rest of function (CI config, etc.)

  return base;
};
```

**Validation**:
```bash
# With Docker running
npm test -- agent-dev-e2e.test.ts
# Expected: Run normally

# With Docker stopped
docker stop $(docker ps -aq)
npm test
# Expected: Skip E2E tests, show message
```

**Expected Impact**: 8 test suites skip gracefully instead of failing

**Acceptance Criteria**:
- ✅ hasDocker() function added
- ✅ Conditional skip logic added
- ✅ Console message shown when skipping
- ✅ Commit: `fix(tests): skip Docker-dependent tests when Docker unavailable`

---

### T3: Quick Win 3 - Document Known Test Failures (5 min)

**Problem**: Developers don't know which test failures are environmental vs bugs
**Solution**: Add "Known Test Issues" section to README.md

**File**: `README.md`

**Change**: Add to Testing section
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

### Known Test Issues

**Environmental Failures** (not bugs):
- **Docker tests**: Require Docker daemon running (auto-skip if unavailable)
- **NATS tests**: Require NATS server or use localhost:4222 default
- **E2E tests**: May fail in CI without full infrastructure

**Active Investigation** (Sprint 31):
- Category B: NATS connectivity failures in full suite (pass in isolation)
- Category D: Legitimate test bugs (TBD - requires identification)

**Resolved** (Sprint 30):
- ✅ Worktree test duplication (fixed via jest.config.js roots)
- ✅ EventEmitter warnings (temporary fix via increased limit)
- ✅ mcp-discovery test (env var interpolation fixed)

For detailed analysis, see: \`planning/sprint-30-pe25g1/test-failures-backlog.md\`

### Test Infrastructure Notes
- Worktrees supported: Tests work from both main repo AND worktrees
- Jest roots configuration scopes discovery to src/, tests/, tools/
- EventEmitter limit increased for test stability (temporary, tracked in backlog)
- E2E tests auto-skip when Docker unavailable
\`\`\`
```

**Acceptance Criteria**:
- ✅ README.md updated with Known Test Issues section
- ✅ Links to Sprint 30 analysis
- ✅ Commit: `docs(tests): document known test issues and resolutions`

---

## Phase 1: Current State Assessment (T4-T5)

**Objective**: Identify ACTUAL failing tests (not placeholders)
**Duration**: 30 minutes
**Dependencies**: Phase 0 complete

### T4: Run Full Test Suite & Capture Output (15 min)

**Objective**: Get baseline AFTER quick wins applied

```bash
cd .worktrees/sprint-31-ayaq0a
npm test 2>&1 | tee planning/sprint-31-ayaq0a/baseline-test-output.txt
```

**Capture**:
- Total runtime
- Number of failing suites (target: <19 after quick wins)
- Number of failing tests
- Pass rate
- ACTUAL failing test file paths (not placeholders)

**Create**: `planning/sprint-31-ayaq0a/baseline-metrics.md`
```markdown
# Sprint 31 Baseline Metrics

**Date**: 2026-08-30
**Environment**: After Quick Wins (T1-T3)

## Metrics

| Metric | Sprint 30 End | Sprint 31 Start | Change |
|--------|---------------|-----------------|--------|
| **Runtime** | 116s | [TBD]s | [TBD]% |
| **Failing Suites** | 19 | [TBD] | [TBD] |
| **Failing Tests** | 57 | [TBD] | [TBD] |
| **Pass Rate** | 96.6% | [TBD]% | [TBD]% |

## Quick Win Impact

- NATS_URL default: [TBD] suites fixed
- Docker skip: [TBD] suites skipped
- Documentation: N/A (no runtime impact)

## Failing Test Suites (ACTUAL)

[Extract from test output - real file paths only]

1. [test-file-1.test.ts] - [error summary]
2. [test-file-2.test.ts] - [error summary]
...
```

**Acceptance Criteria**:
- ✅ Full test run completed
- ✅ Output saved to baseline-test-output.txt
- ✅ Metrics documented in baseline-metrics.md
- ✅ ACTUAL failing test file names extracted

---

### T5: Categorize Failures by Root Cause (15 min)

**Objective**: Categorize ACTUAL failures (not placeholders)

**Method**: Use Sprint 30 categorization framework + isolation testing

**Create**: `planning/sprint-31-ayaq0a/failure-categorization.md`
```markdown
# Sprint 31 Failure Categorization

**Date**: 2026-08-30
**Source**: baseline-test-output.txt

## Category A: Docker/Infrastructure

[List ACTUAL Docker-related failures]
- Should be SKIPPED if Docker unavailable (verify T2 worked)

## Category B: NATS Connectivity

[List ACTUAL NATS failures with isolation test results]

| Test File | Error | Isolated Result | Diagnosis |
|-----------|-------|----------------|-----------|
| test-1.ts | ENOTFOUND nats | [Run it] | Environmental/Bug |
| test-2.ts | Connection timeout | [Run it] | Environmental/Bug |

## Category C: Main Repo Artifacts

[Should be 0 after Sprint 30 PR merge - verify]

## Category D: Legitimate Bugs

[List ACTUAL test failures that aren't Docker/NATS/Main repo]
- Must be failures in BOTH full suite AND isolation
- Require code fixes, not configuration

## Summary

- **Category A**: [N] failures (should be skipped)
- **Category B**: [N] failures (isolation test needed)
- **Category C**: [N] failures (verify merge status)
- **Category D**: [N] failures (require fixes)
```

**Acceptance Criteria**:
- ✅ All failures categorized with ACTUAL file names
- ✅ No placeholder names used
- ✅ File existence verified before listing
- ✅ Isolation testing approach documented for Category B

---

## Phase 2: NATS Investigation (T6-T7)

**Objective**: Determine if NATS failures are environmental or bugs
**Duration**: 45 minutes
**Dependencies**: Phase 1 complete

### T6: Isolation Testing for NATS Failures (30 min)

**Objective**: Run each NATS failure in isolation to determine root cause

**Method**: (Sprint 30 learning)
```bash
# For each Category B test:
npm test -- <test-file>.test.ts

# If PASS → Environmental (concurrency issue)
# If FAIL → Code bug (needs fix)
```

**Create**: `planning/sprint-31-ayaq0a/nats-isolation-results.md`
```markdown
# NATS Failure Isolation Testing

**Date**: 2026-08-30
**Method**: Run each test individually

## Results

| Test File | Full Suite | Isolated | Diagnosis | Action |
|-----------|-----------|----------|-----------|--------|
| test-1.ts | FAIL | PASS | Environmental | Defer to Sprint 32 |
| test-2.ts | FAIL | FAIL | Code bug | Fix in T7 |
| test-3.ts | FAIL | PASS | Environmental | Defer to Sprint 32 |

## Environmental Failures (Concurrency Issues)

[List tests that pass in isolation]

**Root Cause**: Test concurrency causing resource contention
**Mitigation Applied**: NATS_URL default (T1)
**Long-term Fix**: Test isolation or sequential execution (Sprint 32)

## Code Bugs (Fail in Isolation)

[List tests that fail in isolation]

**Root Cause**: [Requires investigation]
**Fix**: In T7
```

**Acceptance Criteria**:
- ✅ Each NATS failure tested in isolation
- ✅ Results documented
- ✅ Environmental vs bug classification clear
- ✅ Code bugs identified for T7

---

### T7: Fix NATS Code Bugs (15 min)

**Objective**: Fix tests that fail in BOTH full suite AND isolation

**Scope**: Only tests identified as "Code bug" in T6

**Method**:
1. Review test code for actual bug
2. Fix test logic or setup
3. Validate fix in isolation
4. Validate fix in full suite

**Example Fix Pattern**:
```typescript
// Common issue: Missing NATS connection wait
beforeAll(async () => {
  await messageBus.connect();
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for connection
});
```

**Acceptance Criteria**:
- ✅ All isolated NATS bugs fixed
- ✅ Tests pass in isolation
- ✅ Tests pass in full suite
- ✅ Commit: `fix(tests): resolve NATS connection bugs in [test names]`

---

## Phase 3: Legitimate Bug Fixes (T8-T9)

**Objective**: Fix Category D failures (non-Docker, non-NATS bugs)
**Duration**: 45-60 minutes
**Dependencies**: Phase 1 complete (need actual test names)

### T8: Investigate Category D Failures (30 min)

**Objective**: Understand root cause of each legitimate bug

**Method**: For each Category D test:
1. Run test in isolation
2. Read test code
3. Identify what's being tested
4. Determine if test bug or production bug
5. Document findings

**Create**: `planning/sprint-31-ayaq0a/category-d-analysis.md`
```markdown
# Category D Bug Analysis

**Date**: 2026-08-30

## Test: [actual-test-1.test.ts]

**Failure**: [error message]
**Expected**: [what should happen]
**Actual**: [what's happening]
**Root Cause**: [analysis]
**Type**: Test bug / Production bug
**Fix Approach**: [solution]
**Risk**: Low / Medium / High (production impact)

---

## Test: [actual-test-2.test.ts]

[Same template]

---

## Summary

- **Test bugs**: [N] (fix test code)
- **Production bugs**: [N] (fix application code)
- **Total fixes needed**: [N]
```

**Acceptance Criteria**:
- ✅ Each Category D failure analyzed
- ✅ Root cause documented
- ✅ Test vs production bug classified
- ✅ Fix approach identified

---

### T9: Fix Category D Bugs (30 min)

**Objective**: Apply fixes identified in T8

**Scope**: All Category D bugs (both test and production)

**Method**:
1. Apply fix
2. Run test in isolation → verify PASS
3. Run full suite → verify PASS
4. Document fix rationale

**Acceptance Criteria**:
- ✅ All Category D bugs fixed
- ✅ Tests pass in isolation
- ✅ Tests pass in full suite
- ✅ Commit(s): `fix(tests): [description]` or `fix([service]): [description]`

---

## Phase 4: Validation & Documentation (T10-T11)

**Objective**: Confirm improvements, document results
**Duration**: 30 minutes
**Dependencies**: Phase 2-3 complete

### T10: Post-Fix Validation (15 min)

**Objective**: Measure improvement after all fixes

```bash
npm test 2>&1 | tee planning/sprint-31-ayaq0a/post-fix-test-output.txt
```

**Create**: `planning/sprint-31-ayaq0a/metrics-comparison.md`
```markdown
# Sprint 31 Metrics Comparison

## Before (Sprint 30 End)
- Runtime: 116s
- Failing suites: 19
- Failing tests: 57
- Pass rate: 96.6%

## After Sprint 31 Quick Wins
- Runtime: [TBD]s
- Failing suites: [TBD]
- Failing tests: [TBD]
- Pass rate: [TBD]%

## After Sprint 31 Fixes
- Runtime: [TBD]s
- Failing suites: [TBD]
- Failing tests: [TBD]
- Pass rate: [TBD]%

## Impact

- **Quick wins**: [TBD] suites fixed/skipped
- **NATS fixes**: [TBD] suites fixed
- **Category D fixes**: [TBD] suites fixed
- **Total reduction**: [TBD]% fewer failures

## Target Achievement

- **Goal**: <10 failing suites
- **Actual**: [TBD] failing suites
- **Status**: ✅ Achieved / ⚠️ Partial / ❌ Not achieved

## Remaining Failures

[List any remaining failures with categorization]
```

**Acceptance Criteria**:
- ✅ Full test run completed
- ✅ Metrics captured and compared
- ✅ Target achievement assessed
- ✅ Remaining failures documented

---

### T11: Create Sprint Artifacts (15 min)

**Objective**: Complete sprint documentation

**Artifacts to Create**:

1. **verification-report.md** - Deliverable validation
2. **retro.md** - What went well, what to improve
3. **key-learnings.md** - Technical and process learnings
4. **request-log.md** - Update with sprint progress

**Templates**: Follow Sprint 30 format

**Acceptance Criteria**:
- ✅ All sprint artifacts created
- ✅ Learnings documented
- ✅ Next steps identified
- ✅ Commit: `docs(sprint-31): complete sprint artifacts`

---

## Success Criteria

### Must Have (P0-P1)
- ✅ Quick wins applied (NATS default, Docker skip, docs)
- ✅ ACTUAL failing tests identified (no placeholders)
- ✅ NATS failures categorized (environmental vs bugs)
- ✅ Category D bugs analyzed and fixed
- ✅ <10 failing test suites (target)
- ✅ 100% reproducible test runs (no flaky failures)

### Nice to Have (P2)
- ✅ >98% pass rate
- ✅ All environmental failures skip gracefully
- ✅ Comprehensive failure categorization framework

### Out of Scope
- ❌ Docker infrastructure fixes (Sprint 32)
- ❌ Test stratification (unit/integration/e2e) (Sprint 33)
- ❌ Bit.close() cleanup refactoring (Sprint 33)

---

## Risk Management

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Category D test names still placeholders | High | Medium | T4-T5 extract ACTUAL names from test output |
| NATS failures all environmental (nothing to fix) | Medium | Low | Quick wins still provide value |
| More than 10 failures after fixes | Medium | Medium | Document remaining for Sprint 32 |
| Production bugs discovered in tests | Low | High | Fix and validate thoroughly |

### Rollback Strategy
Each phase has granular commits. Can cherry-pick successful fixes if needed.

---

## Timeline

### Sprint Duration: 2.5 - 3 hours (focused work)

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Quick Wins | 25 min | 25 min |
| Phase 1: Assessment | 30 min | 55 min |
| Phase 2: NATS | 45 min | 100 min |
| Phase 3: Category D | 45-60 min | 145-160 min |
| Phase 4: Validation | 30 min | 175-190 min |

**Total**: ~3 hours (conservative estimate)

---

## Key Learnings Applied from Sprint 30

1. ✅ **Categorize by root cause before fixing** - Categories A/B/C/D framework
2. ✅ **Verify file existence before creating tasks** - No placeholders in this sprint
3. ✅ **Isolation testing for environmental vs bugs** - NATS investigation approach
4. ✅ **Baseline metrics before and after** - T4 and T10
5. ✅ **Configuration > constraints** - Quick wins use defaults, not restrictions
6. ✅ **User questions lead to better solutions** - Open to feedback during sprint

---

## Next Steps

1. **Get user approval** for this plan
2. **Update sprint status** to `in-progress`
3. **Execute Phase 0** (setup & quick wins)
4. **Execute Phases 1-4** sequentially
5. **Complete sprint** with verification report

---

**Plan Status**: ✅ Ready for execution
**Approval**: ⏳ Pending user confirmation
**Branch**: `feature/sprint-31-ayaq0a-test-infrastructure-phase-2-na`
