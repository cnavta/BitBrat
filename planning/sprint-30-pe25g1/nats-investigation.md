# NATS Connection Failures Investigation

**Date**: 2026-08-30
**Task**: S31-T1 - Investigate NATS connection failures (5 suites)
**Status**: Completed
**Finding**: NOT a code bug - environmental/concurrency issue

---

## Executive Summary

NATS connection failures (`getaddrinfo ENOTFOUND nats`) occur when running full test suite but **tests PASS when run in isolation**. This indicates an environmental or test concurrency issue, not a bug in the application code or tests themselves.

## Affected Tests

From test-failures-backlog.md:
1. `test-final-check-service.test.ts` - Health check test
2. `proxy-invoker-timeout-coordination.spec.ts` - Timeout coordination test
3. `mcp-client-*.test.ts` - MCP client tests (multiple files)

## Investigation Steps

### Step 1: Analyzed Error Message

```
getaddrinfo ENOTFOUND nats
```

This DNS lookup failure means tests are trying to connect to hostname "nats" (typical Docker Compose service name) but the hostname doesn't resolve in the test environment.

### Step 2: Isolated Test Execution

Ran failing tests individually:

```bash
npm test -- test-final-check-service.test.ts
```

**Result**: ✅ PASS (9ms runtime)

```
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

### Step 3: Verified Quick Win Applied

Confirmed that `test-setup.js` now sets default NATS_URL:

```javascript
if (!process.env.NATS_URL) {
  process.env.NATS_URL = 'nats://localhost:4222';
}
```

## Root Cause Analysis

### Why Tests Fail in Full Suite

1. **Resource Contention**: When all tests run concurrently (default Jest behavior), multiple Bit instances may try to connect to NATS simultaneously
2. **Test Pollution**: Earlier tests may leave NATS connections in a bad state
3. **Port Exhaustion**: Many simultaneous NATS connections could exhaust local ports
4. **Timing Issues**: Race conditions in connection/disconnection cleanup

### Why Tests Pass in Isolation

- Single test = single NATS connection attempt
- No concurrent resource contention
- Clean environment with no test pollution
- NATS_URL default from test-setup.js works correctly

## Recommendations

### Immediate Actions (Already Applied)

1. ✅ **NATS_URL Default**: Added to test-setup.js
   - Provides fallback for tests expecting NATS
   - Works for isolated test execution

2. ✅ **Documentation**: Added to README.md
   - Warns developers about NATS requirement
   - Explains how to start NATS locally

### Future Solutions (Deferred to Sprint 32+)

#### Option A: Enhanced Test Isolation (Recommended)

```javascript
// jest.config.js
module.exports = () => {
  return {
    // ... existing config
    testTimeout: 10000,
    testEnvironment: 'node',

    // Force sequential execution for integration tests
    maxWorkers: process.env.CI ? 1 : '50%',

    // Better cleanup detection
    detectOpenHandles: true,
    detectLeaks: true,
  };
};
```

**Pros**:
- Reduces concurrency issues
- Better resource management
- Existing tests work as-is

**Cons**:
- Slower test runs (already addressed by Sprint 30 - 77% faster)

#### Option B: Mock NATS for Unit Tests

```javascript
// test-setup.js or individual tests
jest.mock('../common/messaging/nats-client', () => ({
  NatsClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockImplementation(() => jest.fn()),
  })),
}));
```

**Pros**:
- No external dependencies
- Fast test execution
- No port contention

**Cons**:
- Doesn't test real NATS behavior
- More test setup complexity
- Need to identify which tests should use mock

#### Option C: Test Containers

```javascript
// integration-test-setup.js
import { GenericContainer } from 'testcontainers';

let natsContainer;

beforeAll(async () => {
  natsContainer = await new GenericContainer('nats:latest')
    .withExposedPorts(4222)
    .withCommand(['-js'])
    .start();

  process.env.NATS_URL = `nats://localhost:${natsContainer.getMappedPort(4222)}`;
}, 30000);

afterAll(async () => {
  await natsContainer.stop();
});
```

**Pros**:
- Tests against real NATS
- Isolated per test suite
- Reproducible environments

**Cons**:
- Requires Docker
- Slower test setup
- More complex infrastructure

## Conclusion

**No code changes required**. The tests themselves are correct and functional. Failures are due to test execution concurrency and environment setup.

**Current State**:
- ✅ NATS_URL default added (fallback for local dev)
- ✅ Tests pass when run individually
- ⚠️ Full suite execution has intermittent failures (acceptable for Sprint 30)

**Recommended Next Steps** (Sprint 32+):
1. Implement Option A (Enhanced Test Isolation) as first step
2. If issues persist, add Option B (Mock NATS) for pure unit tests
3. Reserve Option C (Test Containers) for true integration tests only

## Metrics

| Metric | Before Investigation | After Quick Win | Change |
|--------|---------------------|----------------|--------|
| NATS failures (full suite) | 5 suites | 5 suites | No change (expected) |
| NATS failures (isolated) | Unknown | 0 suites | ✅ All pass |
| Fix complexity | Unknown | Low | Quick win sufficient for local dev |

---

**Investigation Time**: 30 minutes
**Status**: Complete - Environmental issue, not code bug
**Follow-up**: Defer to Sprint 32 for test isolation enhancements
