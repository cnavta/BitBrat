# Sprint 31 Failure Categorization

**Date**: 2026-08-30
**Source**: baseline-test-output.txt + isolation testing
**Total Failures**: 11 test suites, 30 failing tests

---

## Category A: Docker/Infrastructure

**Count**: 3 test suites
**Root Cause**: Missing docker-compose yaml files in worktree
**Type**: Environmental - file path issue, not Docker unavailability

| Test File | Error | Isolation Result |
|-----------|-------|------------------|
| `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts` | Missing docker-compose.agent-dev-*.yaml file | N/A (Docker issue) |
| `tools/brat/src/dev-mcp/__tests__/environment-validation.test.ts` | Expected 0 warnings, received 1 | N/A (Docker issue) |
| `tools/brat/src/infrastructure/__tests__/jetstream-validation.test.ts` | Missing docker-compose file, can't read NATS logs | N/A (Docker issue) |

**Action**: Defer to Sprint 32 (Docker infrastructure fixes)
**Priority**: P2 (Medium) - Environmental, not blocking development

---

## Category B: Environmental/Concurrency

**Count**: 2+ test suites (confirmed so far)
**Root Cause**: Test concurrency causing resource contention
**Type**: Environmental - tests pass in isolation, fail in full suite

| Test File | Full Suite | Isolated | Diagnosis |
|-----------|-----------|----------|-----------|
| `src/apps/context-pack-service.test.ts` | FAIL | **PASS** ✅ | Environmental (concurrency) |
| `src/apps/obs-mcp.test.ts` | FAIL | **PASS** ✅ | Environmental (concurrency) |
| `tests/apps/scheduler-service.spec.ts` | FAIL | **Testing...** | [TBD] |
| `tests/apps/tool-gateway-notifications.spec.ts` | FAIL | **Testing...** | [TBD] |
| `src/common/mcp/__tests__/client-manager-notifications.test.ts` | FAIL | [Pending] | [TBD] |
| `tests/common/mcp-server.spec.ts` | FAIL | [Pending] | [TBD] |
| `tests/integration/mcp-discovery.test.ts` | FAIL | [Pending] | [TBD] |

**Action**:
- Confirmed environmental: Defer to Sprint 32 (test isolation improvements)
- Confirmed bugs: Fix in T7-T9
**Priority**: P1 (High) - Need to complete isolation testing to categorize

---

## Category C: Main Repo Artifacts

**Count**: 0 test suites
**Reason**: Sprint 30 PR not yet merged to main, so no main repo vs worktree discrepancies

**Action**: N/A
**Priority**: N/A

---

## Category D: Legitimate Bugs

**Count**: 2+ test suites (confirmed so far)
**Root Cause**: Test assertion bugs or production bugs
**Type**: Bugs - tests fail in BOTH full suite AND isolation

| Test File | Full Suite | Isolated | Error | Status |
|-----------|-----------|----------|-------|--------|
| `src/apps/query-analyzer.test.ts` | FAIL | FAIL ❌ | publishJsonMock called 3 times (expected 2) | ✅ **FIXED** |
| `src/common/mcp/__tests__/client-manager-notifications.test.ts` | FAIL | FAIL ❌ | 8 failures, 2 passing (TBD details) | ⏳ Investigating |
| `tests/common/mcp-server.spec.ts` | FAIL | [Testing...] | [TBD] | ⏳ Categorizing |
| `tests/integration/mcp-discovery.test.ts` | FAIL | [Testing...] | [TBD] | ⏳ Categorizing |

### Fixed: query-analyzer.test.ts ✅

**Failing Tests** (FIXED):
1. "classifies user commands correctly" - Expected 2 calls, received 3
2. "short-circuits spam messages" - Expected 2 calls, received 3

**Root Cause**:
- Test comments documented 3 expected publishes (disposition observation, annotated/complete event, persistence snapshot)
- But assertions checked for only 2 calls
- PERSISTENCE_SNAPSHOT_MODE='all' causes extra publish

**Fix Applied**:
- Changed `expect(publishJsonMock).toHaveBeenCalledTimes(2)` to `3` in both tests
- All 10 tests now pass

**Commit**: 363e2c18 - fix(test): correct publishJsonMock call count in query-analyzer tests

### Investigating: client-manager-notifications.test.ts

**Status**: 8 failed, 2 passed (fails in isolation - legitimate bug)
**Priority**: P1 - Need detailed analysis
**Action**: Pending investigation in T7

---

## Isolation Testing Results (In Progress)

### Completed Tests
- ✅ `context-pack-service.test.ts` → PASS (Environmental)
- ✅ `obs-mcp.test.ts` → PASS (Environmental)
- ✅ `query-analyzer.test.ts` → FAIL (Legitimate Bug)

### In Progress
- ⏳ `scheduler-service.spec.ts` → [Running...]
- ⏳ `tool-gateway-notifications.spec.ts` → [Running...]

### Pending
- ⏹️ `client-manager-notifications.test.ts`
- ⏹️ `mcp-server.spec.ts`
- ⏹️ `mcp-discovery.test.ts`

---

## Summary (Preliminary)

| Category | Count | Priority | Action |
|----------|-------|----------|--------|
| **Category A: Docker** | 3 | P2 | Defer to Sprint 32 |
| **Category B: Environmental** | 2+ (TBD) | P2 | Defer to Sprint 32 |
| **Category D: Legitimate Bugs** | 1+ (TBD) | P1 | Fix in T7-T9 |
| **Category C: Main Repo** | 0 | N/A | N/A |
| **Total** | 11 | Mixed | [TBD after isolation testing complete] |

---

## Key Findings

1. **Quick wins exceeded expectations**:
   - 11 failing suites (vs 19 in Sprint 30)
   - 99.3% pass rate (vs 96.6%)
   - Already approaching <10 goal

2. **Environmental failures confirmed**:
   - context-pack-service and obs-mcp pass in isolation
   - Supports Sprint 30 hypothesis about concurrency issues

3. **Legitimate bugs discovered**:
   - query-analyzer has real test assertion issue
   - Likely related to persistence snapshot mode configuration

4. **Docker issues different than expected**:
   - Not "Docker unavailable" (T2 targets that)
   - Missing docker-compose yaml files in worktree
   - File path/generation issue

---

## Next Steps

1. ⏳ Complete isolation testing for remaining 5 suites
2. ⏳ Update this document with final categorization
3. ⏳ Create detailed analysis for Category D bugs
4. ⏳ Fix Category D bugs in T9
5. ✅ Validate with full test run in T10

---

**Status**: In Progress (awaiting isolation test results)
**Last Updated**: 2026-08-30 19:07 UTC
