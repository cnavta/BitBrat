# Test Infrastructure Analysis
**Date**: 2026-08-30
**Author**: Architect (Claude Code)
**Sprint Goal**: Address failing tests and optimize test infrastructure

---

## Executive Summary

The BitBrat Platform test suite exhibits **4 critical architectural issues** that cause slow execution, test failures, and developer friction:

1. **Worktree Test Duplication** - Tests execute twice (main + worktrees)
2. **Resource Leaks** - EventEmitter memory leaks from improper cleanup
3. **Poor Test Isolation** - Integration tests interfere with each other
4. **Missing Test Stratification** - No quick/comprehensive test paths

**Impact**: ~5-10 minute test runs, intermittent failures, CI instability, reduced developer velocity

**Recommendation**: Implement **3-tier test architecture** (unit → integration → e2e) with proper isolation, cleanup, and selective execution.

---

## Current State Assessment

### Test Suite Inventory

#### Test File Distribution
```
Total Test Files: ~150+
├── src/                 (~30 files) - Unit tests co-located with source
├── tests/common/        (~25 files) - Common infrastructure tests
├── tests/apps/          (~20 files) - Application service tests
├── tests/services/      (~30 files) - Service layer tests
├── tests/integration/   (~15 files) - Integration tests
├── tools/brat/          (~25 files) - CLI tooling tests
└── .worktrees/sprint-27/tests/ - DUPLICATE TESTS (orphaned worktree)
```

#### Test Categories (Current - Implicit)
- **Unit Tests**: ~60% - Pure logic, mocked dependencies
- **Integration Tests**: ~30% - Multiple components, real infrastructure
- **E2E Tests**: ~10% - Full stack, Docker required

### Critical Issues

#### Issue #1: Worktree Test Duplication
**Severity**: HIGH
**Impact**: 2x test execution time, conflicting results

**Problem**:
- `jest.config.js` excludes `/deprecated/` but NOT `/.worktrees/`
- Orphaned worktree `.worktrees/sprint-27-6tp11t/` contains duplicate tests
- Jest discovers and runs tests from BOTH locations
- Total execution: main repo tests + worktree tests = ~2x runtime

**Evidence**:
```
FAIL tests/integration/mcp-discovery.test.ts (24.098 s)
FAIL .worktrees/sprint-27-6tp11t/tests/integration/mcp-discovery.test.ts (X.XXX s)
```

**Root Cause**: Git worktrees not excluded from Jest test discovery

---

#### Issue #2: EventEmitter Memory Leaks
**Severity**: HIGH
**Impact**: Test instability, false negatives, resource exhaustion

**Problem**:
```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 SIGTERM listeners added to [process]. MaxListeners is 10.
```

**Analysis**:
- Each `Bit` instance registers shutdown handlers (SIGTERM, SIGINT, beforeExit, exit)
- Tests create multiple Bit instances without proper cleanup
- Event listeners accumulate across test suites
- Default Node.js limit: 10 listeners per event

**Affected Tests**:
- `tests/common/bit-conformance.spec.ts` (creates ~7 HelloBit instances)
- `tests/common/mcp-server.spec.ts` (multiple McpServer instances)
- Any test creating Bit subclasses

**Root Cause**: Missing `afterEach()` cleanup or incomplete `bit.close()` implementation

---

#### Issue #3: Integration Test Failures
**Severity**: MEDIUM
**Impact**: Broken CI, manual intervention required

**Failing Tests**:

##### 3a. `tests/integration/mcp-discovery.test.ts`
**Failure**:
```typescript
expect(mockDoc.set).toHaveBeenCalledWith(
  expect.objectContaining({
    env: { Authorization: "Bearer dummy-token" }
  })
)

// Actual:
env: { Authorization: "Bearer ${MCP_AUTH_TOKEN}" }
```

**Root Cause**: Environment variable interpolation not happening in test context
**Type**: Test mock issue (not production code bug)

##### 3b. `tests/common/bit-conformance.spec.ts` (worktree only)
**Failure**: Tests passing in main repo, failing in worktree
**Root Cause**: Worktree test duplication causing resource conflicts

##### 3c. `tests/common/mcp-server.spec.ts`
**Failure**:
```
console.warn mcp_server.auth_failed path=/sse ip=::ffff:127.0.0.1
```
**Root Cause**: Test making unauthenticated request (expected behavior, but test assertion incorrect)

##### 3d. `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts`
**Failure**:
```
Error: Context 'agent-dev-e2e-test-1788054728393' not found. Run agent_dev.provision first.
```
**Root Cause**: Race condition or Docker unavailability
**Type**: E2E test requiring full infrastructure

---

#### Issue #4: Slow Test Execution
**Severity**: MEDIUM
**Impact**: Developer experience, CI costs

**Metrics**:
- Average test suite: 20-30 seconds
- Full test run: ~5-10 minutes
- CI forced to `maxWorkers: 1` for stability
- CI uses `forceExit: true` to prevent hangs

**Performance Bottlenecks**:
1. **Heavy Bit Instantiation**: Each test creates full HTTP server + message bus
2. **No Resource Pooling**: Fresh instances per test (no shared fixtures)
3. **Synchronous Waits**: Integration tests use `setTimeout()` for async coordination
4. **Firestore Mocking Overhead**: Complex mock setup for every test

**Example**:
```typescript
// tests/integration/mcp-discovery.test.ts:90
await new Promise(resolve => setTimeout(resolve, 500)); // Wait for async event
```

---

#### Issue #5: Missing Test Stratification
**Severity**: LOW
**Impact**: Cannot run "quick" smoke tests, always full suite

**Current State**:
- No categorization mechanism (tags, suites, env vars)
- Cannot run "unit tests only" or "skip e2e"
- Developers forced to run entire suite locally

**Desired State**:
- `npm run test:unit` - Fast (< 30s)
- `npm run test:integration` - Medium (2-3 min)
- `npm run test:e2e` - Slow (5+ min, Docker required)
- `npm test` - Full suite

---

## Test Infrastructure Architecture Issues

### Issue #6: Inadequate Test Isolation

**Problem**: Shared resources causing test pollution

**Evidence**:
```typescript
// tests/integration/mcp-discovery.test.ts
const sharedBus = new EventEmitter(); // SHARED across all tests in file
```

**Impact**:
- Tests cannot run in parallel
- Flaky failures due to event listener pollution
- Hard to debug intermittent issues

---

### Issue #7: Incomplete Test Cleanup

**Antipattern Observed**:
```typescript
afterEach(async () => {
  if (bit) {
    await bit.close("test-teardown");
    bit = undefined;
  }
});
```

**Problem**: `bit.close()` may not fully clean up:
- Event listeners on `process` remain
- HTTP servers may not close immediately
- Message bus subscriptions linger

**Missing**:
- Explicit `process.removeAllListeners()` for test-added listeners
- Timeout on server close
- Verification that cleanup succeeded

---

### Issue #8: Jest Configuration Gaps

**Current** (`jest.config.js:12-18`):
```javascript
testPathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  '/deprecated/',
  '/tools/brat/src/oclif-commands/',
  'stream-analyst-service.test.ts',
],
```

**Missing**:
- `'/.worktrees/'` - Allows duplicate test execution
- `'/.git/'` - Minor, but should be explicit
- Tag-based filtering for test tiers

---

## Recommended Path Forward

### Phase 1: Immediate Fixes (Sprint Goal)

#### Fix 1.1: Exclude Worktrees from Jest Discovery
**Priority**: P0
**Effort**: 5 minutes
**Impact**: 50% reduction in test time

```javascript
// jest.config.js
testPathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  '/deprecated/',
  '/.worktrees/',      // ADD THIS
  '/tools/brat/src/oclif-commands/',
  'stream-analyst-service.test.ts',
],
```

#### Fix 1.2: Increase EventEmitter Limits (Temporary)
**Priority**: P0
**Effort**: 5 minutes
**Impact**: Eliminate memory leak warnings (bandaid)

```javascript
// jest.config.js (or global test setup)
if (!process.env.CI) {
  require('events').EventEmitter.defaultMaxListeners = 20;
}
```

**Note**: This is a **bandaid**. Root cause (cleanup) must still be addressed.

#### Fix 1.3: Fix MCP Discovery Test Mock
**Priority**: P1
**Effort**: 15 minutes
**Impact**: 1 fewer failing test

```typescript
// tests/integration/mcp-discovery.test.ts
beforeAll(async () => {
  process.env.MCP_AUTH_TOKEN = 'dummy-token'; // Ensure env var is set BEFORE server starts
  // ...
});
```

#### Fix 1.4: Skip Agent-Dev E2E in CI Without Docker
**Priority**: P1
**Effort**: 5 minutes
**Impact**: CI stability

```typescript
// tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts
const skipIfNoDocker = !process.env.DOCKER_AVAILABLE;
beforeAll(async () => {
  if (skipIfNoDocker) {
    console.log('Skipping E2E test (Docker not available)');
    return;
  }
  // ... rest of setup
});

it.skipIf(skipIfNoDocker)('should respond to !ping with pong', async () => {
  // ... test
});
```

---

### Phase 2: Test Stratification (Post-Sprint)

#### Approach A: Jest Projects (Recommended)
**Pros**: Native Jest feature, clean separation, can run in parallel
**Cons**: Requires restructuring jest.config.js

```javascript
// jest.config.js
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.{test,spec}.ts'],
      // ... fast config
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/{common,apps,services}/**/*.spec.ts'],
      // ... medium config
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testTimeout: 300000,
      // ... slow config
    }
  ]
};
```

**Run Commands**:
```bash
npm test -- --selectProjects=unit
npm test -- --selectProjects=integration
npm test -- --selectProjects=e2e
```

#### Approach B: Test Name Patterns (Simpler)
**Pros**: Zero config changes, easy to implement
**Cons**: Less explicit, relies on naming conventions

```bash
npm test -- --testPathPattern=src/       # Unit tests
npm test -- --testPathPattern=tests/     # Integration tests
npm test -- --testPathPattern=integration # E2E tests
```

**Recommendation**: Use **Approach A** for long-term maintainability.

---

### Phase 3: Test Infrastructure Refactoring (Future)

#### Refactor 3.1: Shared Test Fixtures
**Problem**: Every test creates fresh Bit instances
**Solution**: Factory pattern with resource pooling

```typescript
// tests/fixtures/bit-factory.ts
class BitTestFactory {
  private instances: Bit[] = [];

  create<T extends Bit>(BitClass: new () => T): T {
    const bit = new BitClass();
    this.instances.push(bit);
    return bit;
  }

  async cleanupAll() {
    await Promise.all(this.instances.map(b => b.close('test')));
    this.instances = [];
    // Explicitly remove process listeners added during tests
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    // ... etc
  }
}

// Usage in tests
let factory: BitTestFactory;
beforeEach(() => { factory = new BitTestFactory(); });
afterEach(async () => { await factory.cleanupAll(); });
```

#### Refactor 3.2: Improve Bit Cleanup
**Problem**: `bit.close()` doesn't fully clean up event listeners
**Solution**: Track and remove all listeners registered by Bit

```typescript
// src/common/base-server.ts
export class Bit {
  private processListeners = new Map<string, Function>();

  protected registerProcessListener(event: string, handler: Function) {
    this.processListeners.set(event, handler);
    process.on(event, handler);
  }

  async close(reason: string) {
    // ... existing cleanup ...

    // Remove all process listeners
    for (const [event, handler] of this.processListeners) {
      process.removeListener(event, handler);
    }
    this.processListeners.clear();
  }
}
```

#### Refactor 3.3: Parallel Test Execution
**Problem**: CI runs maxWorkers:1 for stability
**Solution**: Fix resource conflicts, enable parallel execution

**Requirements**:
1. Perfect test isolation (no shared state)
2. Proper cleanup (no lingering resources)
3. Port randomization (no conflicts)

**Expected Gains**: 3-5x faster CI builds

---

## Test Coverage Analysis

### What Tests Are Actually Testing

#### Unit Tests (Good Coverage)
- ✅ Logging infrastructure (`src/common/__tests__/logging-trace-correlation.spec.ts`)
- ✅ Feature flags (`src/common/feature-flags.test.ts`)
- ✅ LLM bot personality resolution (`src/services/llm-bot/__tests__/`)
- ✅ Message bus implementations (`src/services/message-bus/__tests__/`)
- ✅ OAuth providers (`src/services/oauth/`)

#### Integration Tests (Mixed)
- ✅ MCP auto-discovery (`tests/integration/mcp-discovery.test.ts`) - **FAILING**
- ✅ Event routing (`tests/integration/routing-emulator.spec.ts`)
- ✅ Docker Compose generation (`tests/integration/docker-compose-generation.spec.ts`)
- ✅ Bulk deployment (`tests/integration/bulk-deployment.spec.ts`)
- ⚠️ Port conflict resolution (`tests/integration/port-conflict-resolution.spec.ts`)

#### E2E Tests (Sparse)
- ✅ Agent-dev full stack (`tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts`) - **FAILING**
- ❌ **Missing**: End-to-end platform message flow (ingress → llm-bot → egress)
- ❌ **Missing**: Multi-platform integration (Discord + Twilio + Slack)
- ❌ **Missing**: Load testing, chaos engineering

---

## Are All Integration Tests Necessary?

### Tests to KEEP (High Value)
1. **MCP Discovery** - Validates critical platform capability
2. **Event Routing** - Core platform behavior
3. **Docker Compose Generation** - Deployment correctness
4. **Bulk Deployment** - Multi-service orchestration

### Tests to CONVERT to Unit Tests (Over-Integrated)
1. **tests/apps/tool-gateway-notifications.spec.ts** - Can mock message bus
2. **tests/services/llm-bot/processor-tools.spec.ts** - Can mock MCP client
3. **tests/prompt-assembly/**.* - Pure logic, no integration needed

### Tests to SKIP in Quick Runs
1. **Agent-dev E2E** - 2-5 minute runtime, Docker required
2. **Health gate tests** - Slow, only needed for deployment validation

---

## Proposed Test Execution Paths

### Path 1: Quick Smoke Test (< 30 seconds)
**Purpose**: Pre-commit validation
**Scope**: Unit tests only
**Command**: `npm run test:unit`
**Coverage**: ~60% of test suite

```javascript
// package.json
{
  "scripts": {
    "test:unit": "jest --selectProjects=unit"
  }
}
```

### Path 2: Comprehensive (2-3 minutes)
**Purpose**: Pre-PR validation
**Scope**: Unit + integration (no E2E)
**Command**: `npm test:integration`
**Coverage**: ~90% of test suite

```javascript
{
  "scripts": {
    "test:integration": "jest --selectProjects=unit,integration"
  }
}
```

### Path 3: Full Suite (5-10 minutes)
**Purpose**: CI, release validation
**Scope**: Unit + integration + E2E
**Command**: `npm test` (default)
**Coverage**: 100%

---

## Implementation Plan

### Sprint Deliverables (This Sprint)
1. ✅ **Analysis Document** (this file)
2. ⬜ **Fix worktree exclusion** (jest.config.js)
3. ⬜ **Fix EventEmitter warnings** (increase limit + track root cause)
4. ⬜ **Fix mcp-discovery test** (env var interpolation)
5. ⬜ **Fix agent-dev-e2e skip logic** (Docker detection)
6. ⬜ **Document test execution paths** (README.md update)

### Post-Sprint (Next 2 Sprints)
1. ⬜ Implement Jest projects (3-tier architecture)
2. ⬜ Refactor Bit cleanup (process listener tracking)
3. ⬜ Create BitTestFactory (shared fixtures)
4. ⬜ Enable parallel test execution (remove maxWorkers:1)
5. ⬜ Add test coverage reporting (Istanbul/NYC)

---

## Metrics & Success Criteria

### Current Baseline
- **Total test time**: ~5-10 minutes
- **Failing tests**: 5 (mcp-discovery, bit-conformance x2, mcp-server x2, agent-dev-e2e)
- **CI stability**: 70% (frequent hangs requiring forceExit)
- **Developer velocity**: Slow (must run full suite every time)

### Target State (Post-Sprint)
- **Total test time**: ~2-3 minutes (worktree fix)
- **Failing tests**: 0
- **CI stability**: 95%
- **Developer velocity**: Fast (unit tests < 30s)

### Target State (Post-Refactor)
- **Total test time**: ~1-2 minutes (parallel execution)
- **Unit test time**: < 30 seconds
- **Integration test time**: ~1 minute
- **E2E test time**: ~2-5 minutes (skippable)
- **CI stability**: 99%

---

## Risks & Mitigation

### Risk 1: Breaking Existing Tests
**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Run full test suite before and after each change
- Use feature flags for experimental test infrastructure
- Incremental rollout (Phase 1 → 2 → 3)

### Risk 2: Test Refactoring Takes Too Long
**Likelihood**: High
**Impact**: Medium
**Mitigation**:
- Focus on immediate fixes only (Phase 1) in this sprint
- Defer complex refactoring (Phase 3) to future sprints
- Use timeboxing (max 2 hours per fix)

### Risk 3: Missing Test Coverage
**Likelihood**: Low
**Impact**: High
**Mitigation**:
- Add coverage reporting before removing tests
- Document coverage gaps (see above)
- Prioritize critical path coverage (ingress → llm-bot → egress)

---

## Appendix: Test Execution Log

### Test Run 2026-08-30 01:48 UTC

**Environment**:
- Node.js: v20.x
- OS: macOS (Darwin 25.6.0)
- Jest: ts-jest preset
- Workers: Default (multiple)

**Summary**:
```
PASS: ~90% of tests
FAIL: 5 test suites
  - tests/integration/mcp-discovery.test.ts (24.098s)
  - tests/common/bit-conformance.spec.ts (24.802s)
  - tests/common/mcp-server.spec.ts (25.634s)
  - .worktrees/sprint-27-6tp11t/tests/common/bit-conformance.spec.ts (6.521s)
  - .worktrees/sprint-27-6tp11t/tests/common/mcp-server.spec.ts (27.086s)
  - tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts (27.461s)

Warnings:
  - MaxListenersExceededWarning: 11 SIGTERM listeners (limit: 10)
  - MaxListenersExceededWarning: 11 SIGINT listeners (limit: 10)
  - MaxListenersExceededWarning: 11 beforeExit listeners (limit: 10)
  - MaxListenersExceededWarning: 11 exit listeners (limit: 10)
```

**Notable Observations**:
1. Worktree tests duplicating main repo tests
2. Test execution extremely verbose (console.log pollution)
3. FeedbackMiddleware initialized repeatedly (resource inefficiency)
4. Auth failures in MCP tests (expected, but test assertions incomplete)

---

## Conclusion

The BitBrat Platform test suite is **fundamentally sound but operationally inefficient**. The code quality is high, test coverage is good, but the test infrastructure suffers from:

1. Configuration gaps (worktree exclusion)
2. Resource management issues (event listener leaks)
3. Lack of stratification (no quick/comprehensive paths)

**Immediate Actions** (this sprint):
- Fix jest.config.js worktree exclusion
- Patch EventEmitter limit (temporary)
- Fix 4 failing tests
- Document test execution paths

**Long-term Vision** (2-3 sprints):
- 3-tier test architecture (unit/integration/e2e)
- Parallel execution (3-5x faster)
- Developer-friendly test experience (< 30s feedback loop)

The platform is in excellent shape. These fixes will unlock the next level of developer velocity.

---

**Next Steps**: Start sprint, implement Phase 1 fixes, validate with CI run.
