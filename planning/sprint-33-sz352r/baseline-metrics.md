# Sprint 33 - Baseline Metrics

## Sprint Context
**Starting From**: Sprint 32 final state
**Sprint 32 Final**: 5 failing suites, 9 failing tests, 34.9s runtime
**Sprint 33 Start** (Run 1): 4 failing suites, 8 failing tests, 77.0s runtime

## Single-Run Baseline (Run 1)

**Test Suites**: 4 failed, 4 skipped, 441 passed, 445 of 449 total
**Tests**: 8 failed, 77 skipped, 42 todo, 4248 passed, 4375 total
**Runtime**: 77.0 seconds (1:16.99)

## Failing Test Suites

### 1. tests/common/mcp-server.spec.ts (Category D)
**Failures**: 3 tests
**Issue**: Auth tests expecting 401 but receiving 404
**Example**:
```
Expected: 400
Received: 404
at tests/common/mcp-server.spec.ts:89:31
```

### 2. src/apps/test-from-main-with-warning-service.test.ts (Category B/C)
**Failures**: 1 test
**Issue**: NATS connection error
```
getaddrinfo ENOTFOUND nats
```
**Note**: May be flaky or environmental issue

### 3. tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts (Category A)
**Failures**: 2 tests
**Issue**: Docker compose file not found in worktree
```
Error: open /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-33-sz352r/infrastructure/docker-compose/docker-compose.agent-dev-e2e-test-*.yaml: no such file or directory
```
**Root Cause**: Missing bitbrat-base Docker image, infrastructure dependency

### 4. tools/brat/src/infrastructure/__tests__/jetstream-validation.test.ts (Category A)
**Failures**: 2 tests
**Issue**: Same Docker compose file not found
**Root Cause**: Missing bitbrat-base Docker image, infrastructure dependency

## Comparison to Sprint 32 Final

| Metric | Sprint 32 Final | Sprint 33 Baseline (Run 1) | Change |
|--------|-----------------|---------------------------|--------|
| Failing Suites | 5 | 4 | -1 (-20%) ✅ |
| Failing Tests | 9 | 8 | -1 (-11%) ✅ |
| Passing Tests | 4247 | 4248 | +1 (+0.02%) |
| Runtime | 34.9s | 77.0s | +42.1s (+121%) ⚠️ |

**Notes**:
- Fewer failures than Sprint 32 final (unexpected but positive)
- Runtime significantly longer (environmental variance or test suite changes)
- New failure: test-from-main-with-warning-service.test.ts (not in Sprint 32 reports)

## Category Breakdown

### Category A: Infrastructure (Docker Dependencies)
- agent-dev-e2e.test.ts (2 tests)
- jetstream-validation.test.ts (2 tests)
- **Total**: 4 tests, 2 suites
- **Action**: Defer (acceptable, documented in Sprint 32)

### Category D: Legitimate Bugs
- mcp-server.spec.ts (3 tests - auth 401 vs 404)
- **Total**: 3 tests, 1 suite
- **Action**: Fix in T4

### Category B/C: Environmental/Flaky (To Be Determined)
- test-from-main-with-warning-service.test.ts (1 test - NATS connection)
- **Total**: 1 test, 1 suite
- **Action**: Multi-run baseline (T2) to confirm flakiness

## Sprint 32 Remaining Failures

### Expected from Sprint 32
1. ✅ mcp-server (3 tests) - Present
2. ❓ proxy-invoker-timeout-coordination - Not appearing
3. ❓ preference.test.ts - Not appearing
4. ✅ agent-dev-e2e (2 tests) - Present
5. ✅ jetstream-validation (2 tests) - Present

### New in Sprint 33
1. ❌ test-from-main-with-warning-service.test.ts (1 test) - NEW

## Multi-Run Baseline Plan (T2)

To identify flaky tests and confirm consistency:

1. **Run 2-6**: Execute 5 additional test runs
2. **Track**: Which tests fail in each run
3. **Categorize**:
   - **Consistent**: Fails in ≥4 of 5 runs → Category D (fix in sprint)
   - **Intermittent**: Fails in 1-3 of 5 runs → Category C (flaky, monitor)
   - **Resolved**: Doesn't fail in runs 2-6 → Environmental anomaly

4. **Expected Outcomes**:
   - mcp-server (3 tests): Consistent → Fix in T4
   - agent-dev-e2e, jetstream-validation: Consistent → Defer (Category A)
   - test-from-main-with-warning: To be determined
   - proxy-invoker-timeout-coordination, preference.test.ts: May reappear

## Validation Checklist

- [x] Baseline run 1 complete
- [x] Metrics documented
- [x] Failing tests categorized (preliminary)
- [ ] Multi-run baseline (runs 2-6)
- [ ] Flaky test identification
- [ ] Final category assignments
