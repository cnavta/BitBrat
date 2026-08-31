# Sprint 33 - Execution Plan
## Test Infrastructure Phase 4 - Remaining Failures Remediation

### Sprint Metadata
- **Sprint Goal**: Reduce failing test suites from 5 to ≤3 through strategic fixes and test stability analysis
- **Primary Focus**: Fix mcp-server auth tests (Category D) and establish flaky test baseline (Category C)
- **Secondary Focus**: Monitor infrastructure tests (Category A), defer if not blocking
- **Success Criteria**:
  - Must-Have: Multi-run baseline complete, mcp-server 10/10 passing
  - Nice-to-Have: Flaky tests resolved, ≤2 failing suites
  - Stretch Goal: 0 failing suites (100% pass rate)

### Sprint 32 Context
**Achieved**: 7 → 5 failing suites (-28.6% improvement)
**Remaining**: 5 failing suites (9 tests)
- Category A (Infrastructure): 2 suites - agent-dev-e2e, jetstream-validation
- Category D (Legitimate Bug): 1 suite - mcp-server (3/10 tests failing)
- Category C (Flaky): 2 suites - proxy-invoker-timeout-coordination, preference.test.ts

### Key Learnings Applied from Sprint 32
1. **Hypothesis-Driven Planning**: MCP v2 + Sprint 324 prediction was accurate
2. **Pattern Recognition**: Same fix pattern applied across multiple suites
3. **Multi-Run Baselines**: Sprint 32 identified need for this (2 new failures appeared)
4. **Realistic Goal Setting**: <5 suites achieved, 0 suites would have failed

## Phase 0: Setup & Baseline (20 minutes)

### T0: Environment Setup
**Duration**: 5 minutes
**Priority**: P0

```bash
# Start sprint, install deps, build
brat sprint start "Test Infrastructure Phase 4 - Remaining Failures"
cd .worktrees/sprint-33-[id]
npm ci
npm run build
```

**Deliverable**: Sprint 33 ready for execution

### T1: Capture Sprint 32 Baseline
**Duration**: 10 minutes
**Priority**: P0
**Dependencies**: [T0]

```bash
# Capture current state
npm test 2>&1 | tee planning/sprint-33-[id]/baseline-from-sprint-32.txt

# Extract metrics
grep -E "Test Suites:|Tests:" baseline-from-sprint-32.txt > baseline-metrics.txt
```

**Expected Baseline**:
- Failing suites: 5
- Failing tests: 9
- Pass rate: 97.1%
- Runtime: ~35s

**Deliverable**: `baseline-metrics.md`

### T2: Multi-Run Baseline (5 Iterations)
**Duration**: 5 minutes
**Priority**: P0
**Dependencies**: [T1]

**Purpose**: Distinguish flaky tests from consistent failures

```bash
# Run test suite 5 times, capture results
for i in {1..5}; do
  echo "=== RUN $i/5 ===" | tee -a planning/sprint-33-[id]/stability-analysis.txt
  npm test 2>&1 | grep -E "(FAIL|Test Suites:|Tests:)" | tee -a planning/sprint-33-[id]/stability-analysis.txt
  echo "" | tee -a planning/sprint-33-[id]/stability-analysis.txt
done

# Analyze failure patterns
grep "FAIL" planning/sprint-33-[id]/stability-analysis.txt | sort | uniq -c | tee planning/sprint-33-[id]/failure-frequency.txt
```

**Categorization**:
- 5/5 failures → Category D (legitimate bug, fix immediately)
- 2-4/5 failures → Category C (flaky, needs isolation/retry)
- 0-1/5 failures → Environmental noise (monitor only)

**Deliverable**: `stability-analysis.txt`, `failure-frequency.txt`, `multi-run-categorization.md`

**Expected Outcome**:
- agent-dev-e2e: 5/5 failures (Category A confirmed)
- jetstream-validation: 5/5 failures (Category A confirmed)
- mcp-server: 5/5 failures (Category D confirmed)
- proxy-invoker-timeout-coordination: X/5 failures (TBD)
- preference.test.ts: X/5 failures (TBD)

## Phase 1: Category D - mcp-server Auth Tests (60 minutes)

### T3: Investigate mcp-server Auth Test Failures
**Duration**: 30 minutes
**Priority**: P1
**Dependencies**: [T2]

**Current Status**: 7/10 passing, 3 auth tests failing (401 vs 404)

**Investigation Steps**:

```bash
# 1. Isolate failing tests
npm test -- tests/common/mcp-server.spec.ts 2>&1 | tee planning/sprint-33-[id]/mcp-server-isolation.txt

# 2. Extract exact error messages
grep -A 10 "✕" planning/sprint-33-[id]/mcp-server-isolation.txt > mcp-server-failures.txt

# 3. Review Sprint 324 changes
git log --oneline --grep="Sprint 324" -10
git log --oneline --all -- src/common/mcp-server.ts src/common/base-server.ts | head -20

# 4. Compare endpoint registration
git show <sprint-324-commit>:src/common/mcp-server.ts > /tmp/mcp-server-before.ts
diff /tmp/mcp-server-before.ts src/common/mcp-server.ts
```

**Root Cause Hypotheses**:

1. **Endpoint Not Registered**: `/sse` endpoint removed or renamed in Sprint 324
   ```typescript
   // Test expects: GET /sse → 401 (protected)
   // Reality: GET /sse → 404 (doesn't exist)
   ```

2. **Auth Middleware Not Attached**: Refactoring changed middleware attachment order
   ```typescript
   // Before Sprint 324: app.use(authMiddleware) before routes
   // After Sprint 324: authMiddleware not attached or attached after routes
   ```

3. **MCP v2 Endpoint Structure**: MCP SDK 2.0 changed endpoint paths
   ```typescript
   // MCP v1: /sse
   // MCP v2: /mcp/v2/sse or /message
   ```

**Investigation Deliverable**: `mcp-server-investigation.md` with:
- Root cause identified
- Sprint 324 changes documented
- Fix approach outlined

### T4: Fix mcp-server Auth Tests
**Duration**: 30 minutes
**Priority**: P1
**Dependencies**: [T3]

**Fix Patterns** (based on T3 findings):

**Pattern 1: Endpoint Registration**
```typescript
// src/common/mcp-server.ts or base-server.ts
// Verify /sse endpoint exists and is registered

// Before (if missing):
// (nothing)

// After (if needed):
this.app.get('/sse', authMiddleware, (req, res) => {
  // SSE endpoint handler
});
```

**Pattern 2: Auth Middleware Attachment**
```typescript
// Ensure auth middleware attached BEFORE routes
if (process.env.MCP_AUTH_TOKEN) {
  this.app.use(authMiddleware); // BEFORE route definitions
}

this.app.get('/sse', sseHandler);
this.app.post('/message', messageHandler);
```

**Pattern 3: Test Expectations Update**
```typescript
// If Sprint 324 intentionally changed behavior
// tests/common/mcp-server.spec.ts

// Before:
expect(response.status).toBe(401); // Expected auth failure

// After (if endpoint truly removed):
expect(response.status).toBe(404); // Endpoint doesn't exist in v2
// OR update to new MCP v2 endpoint path
```

**Validation**:
```bash
# Test in isolation
npm test -- tests/common/mcp-server.spec.ts

# Verify all 10 tests pass
# Expected: 10/10 passing (was 7/10)
```

**Deliverable**:
- Code fixes in `src/common/mcp-server.ts` or `src/common/base-server.ts`
- Or test updates in `tests/common/mcp-server.spec.ts`
- Validation output showing 10/10 passing

**Expected Outcome**: mcp-server suite 100% passing

## Phase 2: Category C - Flaky Test Analysis (45 minutes)

### T5: Analyze proxy-invoker-timeout-coordination Flakiness
**Duration**: 20 minutes
**Priority**: P2
**Dependencies**: [T2]

**Multi-Run Result Analysis**:
```bash
# From T2 output, determine failure rate
grep "proxy-invoker-timeout-coordination" planning/sprint-33-[id]/failure-frequency.txt

# If 5/5 failures: Reclassify as Category D, proceed to fix
# If 2-4/5 failures: Confirm flaky, analyze root cause
# If 0-1/5 failures: Environmental noise, defer
```

**If Flaky (2-4/5 failures) - Investigation**:
```bash
# Run in isolation 10 times
for i in {1..10}; do
  echo "Run $i/10"
  npm test -- tests/common/mcp/proxy-invoker-timeout-coordination.spec.ts 2>&1 | grep -E "PASS|FAIL"
done | tee proxy-invoker-flakiness.txt

# Count pass/fail
grep "PASS" proxy-invoker-flakiness.txt | wc -l
grep "FAIL" proxy-invoker-flakiness.txt | wc -l
```

**Root Cause Analysis**:
- NATS connection timing (likely)
- Test ordering dependency (check beforeAll/afterAll)
- Shared state pollution
- Resource cleanup issues

**Deliverable**: `proxy-invoker-analysis.md`

### T6: Fix or Isolate proxy-invoker-timeout-coordination
**Duration**: 25 minutes
**Priority**: P2
**Dependencies**: [T5]

**Fix Pattern 1: Test Isolation**
```typescript
// tests/common/mcp/proxy-invoker-timeout-coordination.spec.ts

describe('ProxyInvoker Timeout Coordination', () => {
  let messageBus: MessageBus;

  beforeEach(async () => {
    // Ensure clean NATS connection for each test
    messageBus = new MessageBus();
    await messageBus.connect();

    // Wait for stable connection
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    // Clean disconnect
    await messageBus.disconnect();
  });
});
```

**Fix Pattern 2: Retry Logic**
```typescript
// Add to jest.config.js for this specific suite
module.exports = {
  // ... existing config
  testMatch: [
    '**/proxy-invoker-timeout-coordination.spec.ts'
  ],
  retryTimes: 2, // Retry flaky tests up to 2 times
};
```

**Fix Pattern 3: Skip When NATS Unavailable**
```typescript
beforeAll(async () => {
  try {
    await messageBus.connect();
  } catch (error) {
    console.log('⏭️  Skipping proxy-invoker tests (NATS not available)');
    return;
  }
});
```

**Validation**:
```bash
# Run 10 times to verify stability
for i in {1..10}; do npm test -- proxy-invoker-timeout-coordination.spec.ts; done
# Target: 10/10 passes
```

**Deliverable**: Test fixes with 100% pass rate in 10-run validation

### T7: Analyze & Fix preference.test.ts Flakiness
**Duration**: (Follow same pattern as T5-T6)
**Priority**: P2
**Dependencies**: [T2]

**Similar approach**:
1. Determine failure rate from T2
2. If flaky, investigate root cause (filesystem timing, file locking, path issues)
3. Apply appropriate fix (isolation, retry, skip-when-unavailable)
4. Validate with 10-run test

**Likely Root Causes**:
- File loading race condition
- Filesystem cache issues
- Path resolution in different environments
- Missing file cleanup in other tests

**Fix Pattern (example)**:
```typescript
beforeEach(async () => {
  // Clear filesystem cache
  jest.clearAllMocks();

  // Ensure preference file exists
  const prefPath = path.join(__dirname, '.bratrc');
  if (!fs.existsSync(prefPath)) {
    await fs.promises.writeFile(prefPath, '{}');
  }
});

afterEach(async () => {
  // Clean up test artifacts
  const prefPath = path.join(__dirname, '.bratrc');
  if (fs.existsSync(prefPath)) {
    await fs.promises.unlink(prefPath);
  }
});
```

## Phase 3: Category A - Infrastructure Assessment (15 minutes)

### T8: Document Category A Deferral Decision
**Duration**: 15 minutes
**Priority**: P3
**Dependencies**: [T4, T6, T7]

**Purpose**: Formally document why infrastructure tests are acceptable to defer

**Analysis**:
```markdown
## Category A Infrastructure Tests - Deferral Justification

### Tests:
- agent-dev-e2e.test.ts
- jetstream-validation.test.ts

### Root Cause:
Missing bitbrat-base Docker image in local environment

### Impact Assessment:
- **Core Platform Functionality**: Not affected (these are infrastructure validation tests)
- **Developer Experience**: Not blocking (tests verify deployment infrastructure, not runtime behavior)
- **Production Risk**: Low (infrastructure validated in CI/CD, not local dev)

### Cost-Benefit Analysis:
**Cost to Fix**:
- Build bitbrat-base image: 2-3 hours
- Maintain image across environments: Ongoing
- Image size/storage overhead: Non-trivial

**Benefit**:
- 2 additional tests pass locally
- Validates agent-dev provisioning works

**Verdict**: Cost exceeds benefit for local development

### Decision:
DEFER to future sprint when Docker infrastructure investment is justified by other needs

### Mitigation:
- Create GitHub issue to track
- Document in test infrastructure guide
- Mark tests as expected failures in README
```

**Deliverable**: `category-a-deferral.md`

**Alternative (if time permits)**: Create minimal bitbrat-base image
```dockerfile
# Dockerfile.bitbrat-base (minimal version)
FROM node:20-alpine
RUN npm install -g npm@latest
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
```

## Phase 4: Validation & Documentation (30 minutes)

### T9: Final Validation - Measure Sprint Impact
**Duration**: 15 minutes
**Priority**: P0
**Dependencies**: [T4, T6, T7]

**Validation**:
```bash
# Run full test suite
npm test 2>&1 | tee planning/sprint-33-[id]/final-validation.txt

# Extract metrics
grep -E "Test Suites:|Tests:" final-validation.txt
```

**Expected Results**:

**Conservative Goal** (Recommended):
- Failing suites: 2 (down from 5) - agent-dev-e2e, jetstream-validation
- Failing tests: 2 (down from 9)
- Pass rate: >99%
- mcp-server: 10/10 passing ✅
- Flaky tests: Resolved or documented ✅

**Stretch Goal**:
- Failing suites: 0 (100% pass rate)
- All categories resolved

**Deliverable**: `final-metrics.md`

### T10: Complete Sprint Artifacts
**Duration**: 15 minutes
**Priority**: P0
**Dependencies**: [T9]

**Artifacts**:
1. `verification-report.md` - Deliverable verification
2. `retro.md` - Sprint retrospective
3. `key-learnings.md` - Patterns and insights
4. `sprint-summary.md` - Final results

**Key Themes to Document**:
- Multi-run baseline methodology validated
- mcp-server auth test fix pattern (Sprint 324 refactoring)
- Flaky test remediation patterns (isolation, retry, skip)
- Category A deferral justification
- Sprint 30 → 31 → 32 → 33 journey: 48 failures → X failures

## Risk Management

### Risk 1: mcp-server Root Cause Unclear
**Likelihood**: Medium
**Impact**: High (blocks P1 goal)
**Mitigation**: Timebox investigation to 30 minutes, escalate to maintainer if blocked
**Contingency**: Document as known issue, create dedicated bug-fix sprint

### Risk 2: Flaky Tests Prove Difficult to Stabilize
**Likelihood**: Medium
**Impact**: Medium (nice-to-have, not blocking)
**Mitigation**: Use retry logic as fallback, document flakiness
**Contingency**: Accept flaky tests, mark as "known flaky" in test output

### Risk 3: Multi-Run Baseline Inconclusive
**Likelihood**: Low
**Impact**: Low (affects categorization accuracy)
**Mitigation**: Run 10 iterations instead of 5
**Contingency**: Use best judgment based on Sprint 32 observations

## Success Metrics

### Must-Have (100% Critical)
- ✅ Multi-run baseline complete (5 iterations)
- ✅ mcp-server 10/10 passing
- ✅ Failing suites ≤3 (down from 5)

### Nice-to-Have (70% Target)
- ✅ Flaky tests resolved or documented
- ✅ Failing suites ≤2
- ✅ Comprehensive documentation

### Stretch Goal (30% Aspirational)
- ✅ 100% pass rate (0 failing suites)
- ✅ All categories fully resolved
- ✅ Multi-run validation shows 5/5 passes for all tests

## Timeline

**Total Estimated Duration**: 2-3 hours

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Setup & Baseline | 20 min | 20 min |
| Phase 1: mcp-server Fix | 60 min | 1h 20min |
| Phase 2: Flaky Tests | 45 min | 2h 5min |
| Phase 3: Category A Doc | 15 min | 2h 20min |
| Phase 4: Validation | 30 min | 2h 50min |

**Buffer**: 10 minutes (contingency)

## Dependencies & Execution Order

```
T0 (Setup)
  ↓
T1 (Baseline) → T2 (Multi-Run Baseline)
                  ↓
                  ├─→ T3 (Investigate mcp-server) → T4 (Fix mcp-server)
                  ├─→ T5 (Analyze proxy-invoker) → T6 (Fix proxy-invoker)
                  └─→ T7 (Analyze & Fix preference)
                        ↓
                      T8 (Document Category A)
                        ↓
                      T9 (Final Validation) → T10 (Artifacts)
```

**Parallelization Opportunities**:
- T3, T5, T7 can run in parallel after T2
- T4, T6, T7 sequential (depend on investigations)

## Future Work (Post-Sprint 33)

### Sprint 34: Test Infrastructure Optimization
**If 100% pass rate achieved in Sprint 33**:
- Test stratification (unit/integration/e2e)
- Parallel test execution
- Test coverage reporting
- Bit.close() cleanup refactoring

**If failures remain after Sprint 33**:
- Dedicated bug-fix sprint for remaining failures
- Deep dive on infrastructure tests (build bitbrat-base)
- CI/CD integration to catch flaky tests earlier

## Conclusion

Sprint 33 takes a **strategic, data-driven approach** to the remaining 5 test failures:

1. **Multi-run baseline** distinguishes flaky from consistent failures
2. **mcp-server fix** addresses high-impact Category D bug (3 tests)
3. **Flaky test remediation** uses isolation/retry patterns
4. **Category A deferral** documented as acceptable trade-off

**Expected Outcome**: 5 → 2 failing suites (60% improvement), with clear path to 100% pass rate.
