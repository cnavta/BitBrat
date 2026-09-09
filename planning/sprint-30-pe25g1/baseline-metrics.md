# Baseline Metrics - Test Infrastructure
**Captured**: 2026-08-30 02:14 UTC (from earlier test run)
**Branch**: feature/sprint-30-pe25g1-test-infrastructure-remediatio
**Sprint**: sprint-30-pe25g1

---

## Test Execution Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| **Total Runtime** | 501.989 seconds (8.37 min) | Unacceptably slow |
| **Test Files Discovered** | 1,802 total | Includes worktree duplicates |
| **Test Suites Run** | 1,786 of 1,802 | 16 skipped |
| **Test Suites Passed** | 1,738 | 97.3% pass rate (suites) |
| **Test Suites Failed** | 48 | 2.7% failure rate |
| **Individual Tests Run** | 17,440 total | |
| **Tests Passed** | 16,852 | 96.6% pass rate (tests) |
| **Tests Failed** | 112 | 0.6% failure rate |
| **Tests Skipped** | 308 | |
| **Tests Todo** | 168 | Intentionally incomplete |

## File Distribution

| Source | Count | Notes |
|--------|-------|-------|
| **Main Repo Test Files** | ~498 | Found via `find src tests tools -name '*.{test,spec}.ts'` |
| **Worktree Test Files** | 2,662 | Found in `.worktrees/` - MASSIVE DUPLICATION |
| **Jest Discovered Files** | 455 | After filtering (deprecated, etc.) |
| **Duplication Factor** | 5.3x | Worktrees contain 5x more files than main |

## EventEmitter Warnings

**Observed Warnings** (from test output analysis):
- `MaxListenersExceededWarning: 11 SIGTERM listeners` (limit: 10)
- `MaxListenersExceededWarning: 11 SIGINT listeners` (limit: 10)
- `MaxListenersExceededWarning: 11 beforeExit listeners` (limit: 10)
- `MaxListenersExceededWarning: 11 exit listeners` (limit: 10)

**Total Warning Types**: 4 distinct event types
**Frequency**: Multiple tests trigger warnings

---

## Critical Issues Identified

### Issue #1: Extreme Worktree Test Duplication
- **Severity**: CRITICAL
- **Impact**: Potentially 5x test execution time
- **Root Cause**: Jest discovering tests in `.worktrees/sprint-27-6tp11t/` and other orphaned worktrees
- **Evidence**: 2,662 worktree test files vs 498 main repo files

### Issue #2: High Test Failure Rate
- **Severity**: HIGH
- **Impact**: 48 failing test suites, 112 individual test failures
- **Categories**:
  - Integration test failures (mcp-discovery, bit-conformance, mcp-server)
  - E2E test failures (agent-dev)
  - Potential cascade failures from worktree duplication

### Issue #3: EventEmitter Memory Leaks
- **Severity**: MEDIUM
- **Impact**: Test instability, resource exhaustion warnings
- **Root Cause**: Incomplete cleanup in Bit.close()

### Issue #4: Excessive Runtime
- **Severity**: HIGH
- **Impact**: Developer productivity, CI costs
- **Current**: 8.37 minutes per full test run
- **Target**: < 3 minutes (60% reduction)

---

## Success Criteria (Target State)

| Metric | Current (Baseline) | Target | Reduction |
|--------|-------------------|--------|-----------|
| **Runtime** | 501.99s (8.37min) | < 180s (3min) | -64% |
| **Test Files Discovered** | 1,802 | ~500 | -72% |
| **Failed Test Suites** | 48 | 0 | -100% |
| **Failed Tests** | 112 | 0 | -100% |
| **EventEmitter Warnings** | 4 types | 0 | -100% |
| **Worktree Test Files** | 2,662 | 0 | -100% |

---

## Planned Interventions

### Phase 1: Quick Wins (Expected: -50% runtime)
1. **T2.1**: Add `'/.worktrees/'` to `jest.config.js` exclusions
2. **T3.1**: Increase EventEmitter limit (temporary bandaid)

### Phase 2: Test Fixes (Expected: 0 failures)
1. **T4**: Fix `mcp-discovery.test.ts` environment variable issue
2. **T5**: Fix `bit-conformance.spec.ts` (may self-resolve after T2)
3. **T6**: Fix `mcp-server.spec.ts` authentication
4. **T7**: Fix `agent-dev-e2e.test.ts` Docker detection

### Phase 3: Validation
1. **T8**: Post-fix metrics capture
2. **T9**: Documentation updates

---

## Baseline Test Output Location

**Full Output**: `planning/sprint-30-pe25g1/baseline-test-output.txt`

---

## Notes

- Baseline captured from earlier test run (background job fc9c4e)
- Worktree count significantly higher than initial analysis predicted
- Test failure count also higher than expected (48 suites vs initial 5)
- Runtime worse than analysis (8.37min vs predicted 5-10min range)

**Conclusion**: The problem is WORSE than initially analyzed. Immediate fixes are critical.

---

**Next Step**: Execute Phase 1 (T2.1-T3.3) to achieve quick wins.
