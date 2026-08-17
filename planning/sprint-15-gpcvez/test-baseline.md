# Test Baseline (BL-003)

**Sprint**: sprint-15-gpcvez
**Task**: BL-003 - Run existing test suite to establish baseline
**Date**: 2026-08-16
**Command**: `npm test`

---

## Test Results Summary

```
Test Suites: 3 failed, 2 skipped, 410 passed, 413 of 415 total
Tests:       5 failed, 18 skipped, 42 todo, 3676 passed, 3741 total
Snapshots:   2 passed, 2 total
Time:        38.768 s
```

**Total Suites**: 415
- ✅ Passed: 410
- ❌ Failed: 3
- ⏭️  Skipped: 2

**Total Tests**: 3741
- ✅ Passed: 3676
- ❌ Failed: 5
- ⏭️  Skipped: 18
- 📝 Todo: 42

**Pass Rate**: 98.3% (410/413 active suites), 99.9% (3676/3681 active tests)

---

## Known Failures (Pre-existing)

### 1. query-analyzer.test.ts (2 failures)

**Test**: "completes the query with annotations when the query is answerable"
```
TypeError: Cannot read properties of undefined (reading 'stage')
Expected: published.routing.stage to be 'reaction'
Actual: published.routing is undefined
```

**Test**: "short-circuits spam messages"
```
Expected publishJsonMock to be called 2 times
Received: 3 calls
```

**Impact**: ❌ Pre-existing failures in query-analyzer service tests

---

### 2. ingress-egress-service.test.ts (1 failure)

**Test**: "POST /webhooks/:platform is registered for generic webhook routing"
```
getaddrinfo ENOTFOUND nats
```

**Impact**: ❌ Pre-existing network failure (NATS not running in test environment)

---

### 3. ingress-egress-webhook.integration.test.ts (2 failures)

**Test**: "should return 404 when platform not found"
```
getaddrinfo ENOTFOUND nats
```

**Impact**: ❌ Pre-existing network failure (integration test expects running NATS)

---

## Analysis

**Baseline Quality**: Good
- 99.9% test pass rate
- Failures are pre-existing (not caused by sprint work)
- All failures are in ingress-egress and query-analyzer services
- No build or compilation errors

**Pre-existing Issues**:
1. query-analyzer tests have routing slip assertion issues
2. Integration tests expect live NATS instance (not mocked)
3. Tests were not written with mocked message bus

**Sprint Impact**: None - these failures existed before sprint began

**Action**: None required. Document baseline and proceed with implementation.

---

## Acceptance

✅ **Baseline Established**: 410/413 test suites passing
✅ **No Regressions**: All failures are pre-existing
✅ **Build Status**: TypeScript compiles successfully
✅ **Ready for Implementation**: Baseline recorded, can proceed

---

**Status**: ✅ Complete (BL-003)
**Evidence**: Test results captured, pass rate documented
**Next**: Proceed with Phase 1 implementation (BL-100+)
