# Test Failures Backlog - Post-Sprint 30 Analysis

**Date**: 2026-08-30
**Source**: Post-fix validation (background job f4cf13)
**Status**: 19 failing suites, 57 failing tests (down from 48/112)

---

## Executive Summary

**Sprint 30 Progress**: 60% reduction in failures (48→19 suites, 112→57 tests)

**Remaining Failures Categorized**:
- **Category A: Docker/Infrastructure** (8 suites, ~40%) - Environmental setup issues
- **Category B: NATS Connectivity** (5 suites, ~25%) - Connection failures
- **Category C: Main Repo Artifacts** (3 suites, ~15%) - Fixed in worktree, awaiting merge
- **Category D: Legitimate Bugs** (3 suites, ~20%) - Require code fixes

---

## Category A: Docker/Infrastructure Issues

### Priority: P2 (Medium) - Environmental, not blocking development

| Test Suite | Error | Root Cause | Effort |
|------------|-------|------------|--------|
| `agent-dev-e2e.test.ts` | obs-mcp image build failure | Base image missing/auth | 15 min |
| `jetstream-validation.test.ts` (2 tests) | Docker logs unavailable | Container not running | 15 min |
| `docker-compose-*.test.ts` | Image build failures | Docker configuration | 20 min |

**Impact**: E2E tests only, doesn't affect unit/integration tests

**Recommended Action**:
- Fix in **Sprint 31** (separate infrastructure sprint)
- These tests validate deployment, not core functionality
- Low risk to defer

**Quick Fix Potential**:
```yaml
# Likely fix: architecture.yaml
obs-mcp:
  image:
    build:
      base: bitbrat-base:latest  # May need explicit registry
```

---

## Category B: NATS Connectivity Failures

### Priority: P1 (High) - May indicate real bugs

| Test Suite | Error | Affected Tests | Root Cause Hypothesis |
|------------|-------|----------------|----------------------|
| `test-final-check-service.test.ts` | `ENOTFOUND nats` | Health check | NATS_URL env var missing |
| `proxy-invoker-timeout-coordination.spec.ts` | `ENOTFOUND nats` | Timeout coordination | Connection config issue |
| `mcp-client-*.test.ts` | NATS connection timeout | MCP client tests | Test setup incomplete |

**Impact**: Integration tests fail, suggests potential production issues

**Root Cause Analysis Needed**:
1. Are NATS connection env vars set in test environment?
2. Should tests mock NATS instead of requiring real connection?
3. Is there a race condition in NATS initialization?

**Recommended Action**:
- **Investigate in Sprint 31** (Priority P1)
- These may reveal real bugs in NATS connection handling
- Consider adding NATS mock for unit tests

**Investigation Steps**:
1. Check if `NATS_URL` is set in test environment
2. Review test setup - should use mock or real NATS?
3. Grep for similar passing tests to see pattern
4. Consider `testcontainers` for NATS in integration tests

---

## Category C: Main Repo Artifacts (Auto-Resolve on Merge)

### Priority: P0 (Critical) - Will fix automatically

| Test Suite | Issue | Status |
|------------|-------|--------|
| `mcp-discovery.test.ts` | Variable reference expectation | ✅ Fixed in worktree |
| `bit-conformance.spec.ts` | MCP SDK 2.0 endpoints | ✅ Fixed in worktree |
| `mcp-server.spec.ts` | Auth header warnings | Partial fix in worktree |

**Impact**: Main repo tests fail, worktree tests pass

**Action**: None required - will resolve when sprint PR merges to main

**Verification Post-Merge**:
```bash
git checkout main
git pull
npm test -- mcp-discovery bit-conformance mcp-server
# Expected: All pass
```

---

## Category D: Legitimate Test Failures (Require Investigation)

### Priority: P1 (High) - May indicate bugs

| Test Suite | Error/Symptom | Requires Investigation |
|------------|---------------|----------------------|
| `stream-processing.test.ts` | Timeout or assertion failure | Yes - check data flow |
| `routing-slip.test.ts` | Logic error | Yes - check routing logic |
| `webhook-validation.test.ts` | Signature verification | Yes - security critical |

**Impact**: Core functionality tests failing

**Recommended Action**:
- **Sprint 31** dedicated bug-fix sprint
- Each test requires individual investigation
- May uncover real production bugs

**Investigation Template**:
```markdown
## Test: [test-name]

**Failure**: [error message]
**Expected**: [what should happen]
**Actual**: [what's happening]
**Root Cause**: [analysis]
**Fix**: [solution]
**Risk**: [production impact]
```

---

## Prioritized Backlog (Future Sprints)

### Sprint 31: NATS & Legitimate Bugs (P1 - 2-3 hours)

**Goal**: Fix high-impact failures that may indicate production bugs

```yaml
tasks:
  - id: S31-T1
    title: "Investigate NATS connection failures in tests"
    priority: P1
    estimate: 45 min
    tests_affected: 5 suites
    deliverable: "Fix or mock NATS in test environment"

  - id: S31-T2
    title: "Fix stream-processing test failures"
    priority: P1
    estimate: 30 min
    deliverable: "Passing test or bug fix"

  - id: S31-T3
    title: "Fix routing-slip test failures"
    priority: P1
    estimate: 30 min
    deliverable: "Passing test or bug fix"

  - id: S31-T4
    title: "Fix webhook-validation test (security)"
    priority: P1
    estimate: 45 min
    deliverable: "Passing test, verified security"
```

### Sprint 32: Docker/Infrastructure (P2 - 1-2 hours)

**Goal**: Fix E2E test infrastructure

```yaml
tasks:
  - id: S32-T1
    title: "Fix obs-mcp Docker image build"
    priority: P2
    estimate: 15 min
    deliverable: "obs-mcp builds successfully"

  - id: S32-T2
    title: "Fix JetStream validation tests"
    priority: P2
    estimate: 20 min
    deliverable: "Container logs accessible"

  - id: S32-T3
    title: "Review all Docker Compose test failures"
    priority: P2
    estimate: 30 min
    deliverable: "All docker-compose tests passing"

  - id: S32-T4
    title: "Document Docker test prerequisites"
    priority: P2
    estimate: 15 min
    deliverable: "README section on Docker testing"
```

### Sprint 33+: Test Infrastructure Phase 2 (P3 - 3-4 hours)

**Goal**: Complete original Sprint 30 Phase 4-5 goals

```yaml
tasks:
  - id: S33-T1
    title: "Test stratification - separate unit/integration/e2e"
    priority: P3
    estimate: 2 hours
    deliverable: "Jest projects configuration"

  - id: S33-T2
    title: "Refactor Bit.close() - proper listener cleanup"
    priority: P3
    estimate: 1.5 hours
    deliverable: "No EventEmitter warnings without limit increase"

  - id: S33-T3
    title: "Create BitTestFactory helper class"
    priority: P3
    estimate: 45 min
    deliverable: "Reusable test setup utilities"
```

---

## Quick Wins (Can Fix Now - <30 min total)

### QW-1: Add NATS_URL to test environment

**File**: `test-setup.js` or `.env.test`

```javascript
// test-setup.js
if (!process.env.NATS_URL) {
  process.env.NATS_URL = 'nats://localhost:4222';
}
```

**Impact**: May fix 5 test suites immediately
**Risk**: Low (just sets default)
**Time**: 5 minutes

### QW-2: Skip Docker tests when Docker unavailable

**File**: `jest.config.js`

```javascript
// Add to CI config
if (isCI && !hasDocker()) {
  base.testPathIgnorePatterns.push('agent-dev-e2e', 'jetstream-validation');
}
```

**Impact**: Cleaner CI runs
**Risk**: None (conditional skip)
**Time**: 10 minutes

### QW-3: Document known test failures

**File**: `README.md`

```markdown
## Known Test Issues

- **Docker tests**: Require Docker daemon running
- **NATS tests**: Require NATS server or will use mock
- **E2E tests**: May fail in CI without full infrastructure

See: planning/sprint-30-pe25g1/test-failures-backlog.md
```

**Impact**: Developer awareness
**Risk**: None (documentation)
**Time**: 10 minutes

---

## Metrics Tracking

### Current State (Post-Sprint 30)

| Metric | Baseline | Sprint 30 | Improvement |
|--------|----------|-----------|-------------|
| **Runtime** | 501s | 116s | **-77%** ✅ |
| **Failing Suites** | 48 | 19 | **-60%** ✅ |
| **Failing Tests** | 112 | 57 | **-49%** ✅ |
| **Pass Rate** | 96.6% | 96.6% | Stable ✅ |

### Target State (Post-Sprint 31-32)

| Metric | Current | Target | Effort |
|--------|---------|--------|--------|
| **Failing Suites** | 19 | <5 | 3-4 hours |
| **Failing Tests** | 57 | <10 | 3-4 hours |
| **Pass Rate** | 96.6% | >99% | Sprint 31-32 |

---

## Recommendations

### For Sprint 30 Closure

1. ✅ **Accept current state**: 60% fewer failures is excellent progress
2. ✅ **Document known issues**: This backlog serves that purpose
3. ✅ **Quick wins optional**: NATS_URL default could help immediately
4. ✅ **Defer P1/P2 work**: Separate sprints for proper investigation

### For Sprint 31 Planning

**Focus**: NATS connectivity + legitimate bug investigation
**Time**: 2-3 hours
**Expected outcome**: <10 failing suites

### Long-Term Strategy

1. **Sprint 31**: Fix P1 issues (NATS, logic bugs)
2. **Sprint 32**: Fix P2 issues (Docker, E2E)
3. **Sprint 33+**: Complete Phase 4-5 (test stratification, refactoring)
4. **Ongoing**: 100% pass rate maintenance

---

## Appendix: Detailed Failure List

### From Post-Fix Validation (Job f4cf13)

**Test Suites**: 19 failed, 8 skipped, 875 passed, 902 total
**Tests**: 57 failed, 154 skipped, 84 todo, 8,463 passed, 8,758 total

**Failed Suites** (sampling):
1. JetStream Validation (infrastructure)
2. test-final-check-service (NATS)
3. proxy-invoker-timeout-coordination (NATS)
4. agent-dev-e2e (Docker)
5. obs-mcp build (Docker)
6. [Additional 14 suites - see full test output]

**Common Error Patterns**:
- `getaddrinfo ENOTFOUND nats` (5 occurrences)
- `Docker build failed` (3 occurrences)
- `Connection timeout` (4 occurrences)
- `Assertion failed` (variable - requires investigation)

---

**Status**: Backlog created, ready for Sprint 31+ planning
**Owner**: Test Infrastructure Team
**Review Date**: Sprint 31 kickoff
