# Sprint 30 Key Learnings

**Sprint ID**: sprint-30-pe25g1
**Date**: 2026-08-30
**Theme**: Test Infrastructure & Configuration-Based Solutions

---

## Critical Technical Learnings

### 1. Jest `roots` Configuration Scopes Test Discovery

**Context**: Running tests from git worktrees caused Jest to discover ALL worktrees in the repository (1,802+ test files vs 499 expected).

**Discovery**: Jest's `roots` configuration explicitly defines WHERE to search for tests, preventing upward directory traversal.

**Solution**:
```javascript
// jest.config.js
module.exports = () => ({
  rootDir: '.',  // Explicit: current directory
  roots: [
    '<rootDir>/src',
    '<rootDir>/tests',
    '<rootDir>/tools'
  ],
  // ... rest of config
});
```

**Impact**:
- Tests work from BOTH main repo AND worktrees
- No cross-worktree test discovery
- 50% reduction in files checked (1,945 → 966)
- 72% reduction in test files (1,802 → 499)

**Key Insight**: `testPathIgnorePatterns` filters AFTER discovery; `roots` controls WHERE discovery starts. Use `roots` to scope, not patterns to exclude.

**Applicability**: Any monorepo or multi-worktree project using Jest.

**Documentation**: `planning/sprint-30-pe25g1/jest-roots-solution.md`

---

### 2. Test Failures in Full Suite ≠ Code Bugs

**Context**: 5 test suites failing with `getaddrinfo ENOTFOUND nats` in full suite.

**Discovery**: Same tests PASS when run in isolation (`npm test -- test-final-check-service.test.ts`).

**Root Cause**:
- Test concurrency causing resource contention
- Multiple NATS connections attempting simultaneously
- Port exhaustion or incomplete connection cleanup
- Race conditions in test setup/teardown

**Key Insight**: When tests fail in full suite but pass individually, suspect environmental/concurrency issues before investigating code.

**Diagnostic Approach**:
```bash
# Step 1: Run full suite, note failures
npm test 2>&1 | grep "FAIL"

# Step 2: Run failing test in isolation
npm test -- <failing-test>.test.ts

# Step 3: If passes in isolation → environmental
# If fails in isolation → code bug
```

**Mitigation**:
- Quick wins: Provide defaults (NATS_URL), conditional skips (Docker)
- Long-term: Test isolation, mocking, or sequential execution

**Applicability**: Any test suite with external dependencies (databases, message buses, Docker).

**Documentation**: `planning/sprint-30-pe25g1/nats-investigation.md`

---

### 3. Configuration > Constraints for Developer Experience

**Context**: Initial solution blocked test execution from worktrees entirely.

**User Feedback**: "Have we looked into `rootDir` and `roots` configuration?"

**Discovery**: Configuration-based solution enables desired workflow instead of blocking it.

**Key Insight**: Before imposing architectural constraints (e.g., "must run from main repo"), exhaust configuration options that enable the workflow.

**Decision Matrix**:
| Approach | Developer Experience | Implementation | Maintainability |
|----------|---------------------|----------------|-----------------|
| **Block worktree execution** | ❌ Restrictive | ✅ Simple | ⚠️ Requires discipline |
| **roots configuration** | ✅ Enables workflow | ✅ Simple | ✅ Self-enforcing |

**Applicability**: Any tool configuration challenge - explore config options before process constraints.

---

### 4. Git Worktrees + Jest = Directory Traversal Trap

**Context**: Git worktrees store all branches in `.worktrees/<branch>/` subdirectories under main repo.

**Trap**: Jest traverses UP from current directory if `roots` not specified, discovering parent `.worktrees/` with ALL branches.

**Directory Structure**:
```
/repo/
  .worktrees/
    sprint-27/  ← Tests here
    sprint-28/  ← And here
    sprint-29/  ← And here
    sprint-30/  ← Current worktree (running from here)
```

**What Happens**:
```bash
# Running from sprint-30 worktree WITHOUT roots config
cd /repo/.worktrees/sprint-30
npm test

# Jest behavior:
# 1. Start from current dir: /repo/.worktrees/sprint-30
# 2. No roots specified → traverse up
# 3. Discover parent: /repo/.worktrees/
# 4. Discover siblings: sprint-27, sprint-28, sprint-29, sprint-30
# 5. Search ALL of them for tests → 1,802 files!
```

**Fix**:
```javascript
// jest.config.js
roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools']
// Now Jest ONLY searches these dirs, no upward traversal
```

**Key Insight**: Git worktrees create sibling directory structure that Jest treats as search space without explicit `roots` scoping.

**Applicability**: Any project using git worktrees + Jest (or similar test runners).

---

### 5. EventEmitter Listener Cleanup is Critical

**Context**: Bit instances register process listeners (SIGTERM, SIGINT, beforeExit, exit) but incomplete cleanup in `Bit.close()`.

**Symptom**: MaxListenersExceededWarning during test runs (default limit: 10).

**Temporary Fix**: Increased `EventEmitter.defaultMaxListeners = 20` in test setup.

**Root Cause**: Process listeners accumulate across test runs because `Bit.close()` doesn't track/remove all listeners it creates.

**Proper Fix** (deferred to Sprint 33+):
```typescript
// In Bit class
private processListeners: Map<string, Function> = new Map();

private registerProcessListener(event: string, handler: Function) {
  process.on(event, handler);
  this.processListeners.set(event, handler);
}

public async close(reason: string): Promise<void> {
  // Remove tracked listeners
  for (const [event, handler] of this.processListeners) {
    process.off(event, handler);
  }
  this.processListeners.clear();
  // ... rest of cleanup
}
```

**Key Insight**: When registering global listeners (process, window, document), track references for cleanup. Memory leaks accumulate silently in tests.

**Applicability**: Any long-lived service that registers process/global event listeners.

**Documentation**: Tracked in `backlog.yaml` Phase 5, Sprint 33+

---

## Process & Methodology Learnings

### 6. Baseline Metrics Enable Confident Changes

**Approach**:
1. Capture comprehensive baseline BEFORE any changes
2. Make incremental changes
3. Re-measure after each change
4. Compare to baseline

**Applied in Sprint 30**:
```yaml
Baseline:
  runtime: 501s
  files_checked: 1945
  test_files: 1802
  failing_suites: 48

Post-Sprint:
  runtime: 116s (-77%)
  files_checked: 966 (-50%)
  test_files: 499 (-72%)
  failing_suites: 19 (-60%)
```

**Key Insight**: Without baseline, "it feels faster" vs "77% faster" - metrics enable confidence and communication.

**Applicability**: Any performance optimization or large refactoring.

---

### 7. Root Cause Analysis > Symptom Fixing

**Example**: NATS test failures

**Symptom Fixing Approach**:
```bash
# See "ENOTFOUND nats" error
# Add try/catch to suppress error
# Mark test as passing
```

**Root Cause Approach**:
```bash
# See "ENOTFOUND nats" error
# Run test in isolation → PASSES
# Conclusion: Not a bug, environmental
# Investigate concurrency, not code
```

**Key Insight**: Spend 20% of time understanding WHY before 80% fixing WHAT. Fixes may be unnecessary if root cause is different than symptom.

**Applicability**: Any debugging or failure investigation.

---

### 8. Categorize Before Fixing

**Applied in Sprint 30**: Categorized 19 failing test suites into:
- Category A: Docker/Infrastructure (environmental)
- Category B: NATS Connectivity (concurrency)
- Category C: Main Repo Artifacts (auto-fix on merge)
- Category D: Legitimate Bugs (requires investigation)

**Impact**:
- Different categories require different solutions
- Avoid "one size fits all" approach
- Prioritize by category (P0, P1, P2, P3)

**Key Insight**: Batch similar problems for efficient solutions. Don't fix serially without grouping.

**Applicability**: Any large set of issues or failures.

---

### 9. User Questions Challenge Assumptions

**Example**: After implementing worktree blocking, user asked: "Have we looked into `rootDir` configuration?"

**Agent Response**: Re-examined solution with fresh perspective, discovered superior approach.

**Key Insight**: "Completed" work may not be optimal. User questions can reveal unconsidered alternatives.

**Process Improvement**:
- When user questions completed work, treat it as opportunity, not criticism
- Re-examine with "beginner's mind"
- Ask "why not?" before defending "why yes"

**Applicability**: All collaborative work (human-AI or human-human).

---

### 10. Documentation is a Deliverable, Not an Afterthought

**Applied in Sprint 30**: Created 15+ artifacts:
- Analysis documents (t2-critical-finding.md, t4-analysis.md, t5-analysis.md)
- Solution explanations (jest-roots-solution.md)
- Investigation reports (nats-investigation.md)
- Execution summaries (backlog-execution-summary.md)
- Sprint closeout (verification-report.md, retro.md, key-learnings.md)

**Impact**:
- Future sprints have complete context
- Decisions explained (why roots > blocking)
- Knowledge preserved beyond sprint

**Key Insight**: Write WHILE solving, not AFTER completing. Documentation clarifies thinking and preserves rationale.

**Applicability**: Any complex work requiring future reference or handoff.

---

## Anti-Patterns Identified

### Anti-Pattern 1: Trial-and-Error Configuration Without Understanding

**What Happened**: Tried 3+ `testPathIgnorePatterns` variations without understanding Jest's discovery algorithm.

**Why It's an Anti-Pattern**:
- Wastes time on approaches that can't work
- Creates confusion ("why didn't this pattern work?")
- Delays discovering actual solution

**Better Approach**:
1. Read tool documentation on discovery/search behavior
2. Understand WHEN patterns apply vs when scoping needed
3. Test hypothesis with minimal example
4. Apply to production

**Applicability**: Any tool configuration (Jest, ESLint, TypeScript, etc.)

---

### Anti-Pattern 2: Creating Backlog Tasks for Non-Existent Files

**What Happened**: Listed `stream-processing.test.ts`, `routing-slip.test.ts`, `webhook-validation.test.ts` as Category D bugs - none exist.

**Why It's an Anti-Pattern**:
- Wastes investigation time on placeholders
- Creates false sense of progress (3 tasks created!)
- Requires re-work to identify actual failures

**Better Approach**:
1. Parse test output for ACTUAL failing file names
2. Use grep/awk to extract from logs
3. Create tasks for real files only
4. Mark conceptual categories as "[TBD - requires identification]"

**Applicability**: Any backlog or task creation from logs/errors.

---

### Anti-Pattern 3: Quick Fix Without Long-Term Plan

**What Happened**: Increased `defaultMaxListeners` to suppress EventEmitter warnings.

**Why It's Problematic**:
- Masks problem instead of solving it
- Creates technical debt
- May cause issues at scale

**When Quick Fixes are Acceptable**:
- ✅ Clearly documented as TEMPORARY in code
- ✅ TODO created with root cause explanation
- ✅ Follow-up sprint/task scheduled
- ✅ Risk assessment completed

**Applied in Sprint 30**:
```javascript
// TEMPORARY FIX: Increase EventEmitter limit to suppress warnings
// Root cause: Bit instances register multiple process listeners (SIGTERM, SIGINT, etc)
//             but cleanup is incomplete in tests.
// TODO (Sprint 31+): Refactor Bit.close() to properly track and remove all listeners
// Tracked in: planning/sprint-30-pe25g1/backlog.yaml (Phase 5)
require('events').EventEmitter.defaultMaxListeners = 20;
```

**Applicability**: Any time-constrained fix that doesn't address root cause.

---

## Tools & Techniques

### Technique 1: Isolated Test Execution for Debugging

```bash
# Full suite shows failure
npm test 2>&1 | grep "FAIL"
# FAIL src/apps/test-final-check-service.test.ts

# Run in isolation to determine if code bug or environmental
npm test -- test-final-check-service.test.ts
# PASS → Environmental issue
# FAIL → Code bug
```

---

### Technique 2: Git Worktree Cleanup

```bash
# List all worktrees
git worktree list

# Remove worktree (if clean)
git worktree remove .worktrees/sprint-27

# Force remove (if has changes)
git worktree remove --force .worktrees/sprint-27
```

---

### Technique 3: Jest Test Discovery Analysis

```bash
# See what tests Jest discovers
npm test -- --listTests | head -20

# Count discovered tests
npm test -- --listTests | wc -l

# Check for worktree pollution
npm test -- --listTests | grep '.worktrees' | wc -l
```

---

## Reusable Patterns

### Pattern 1: Default Environment Variables in Test Setup

```javascript
// test-setup.js
if (!process.env.NATS_URL) {
  process.env.NATS_URL = 'nats://localhost:4222';
}
```

**When to Use**: Tests require external services but default URLs are sensible.

---

### Pattern 2: Conditional Test Skipping Based on Environment

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

if (isCI && !hasDocker()) {
  config.testPathIgnorePatterns.push('*-e2e.test.ts');
}
```

**When to Use**: E2E tests require infrastructure not available in all environments.

---

### Pattern 3: Jest Roots Configuration for Monorepos/Worktrees

```javascript
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools'],
  // Prevents Jest from traversing up to parent directories
};
```

**When to Use**: Monorepos, git worktrees, or any project with sibling directories that shouldn't be searched.

---

## Metrics Summary

| Learning | Measurement | Impact |
|----------|-------------|--------|
| Jest `roots` config | 72% fewer test files discovered | ✅ Major |
| NATS isolation testing | 100% pass rate individually | ✅ Major |
| Baseline metrics | 77% runtime improvement | ✅ Major |
| Root cause analysis | 60% fewer failures categorized | ✅ Major |
| Configuration > constraints | Developer workflow enabled | ✅ Major |

---

## Application to Future Work

### Immediate Application (Sprint 31)
- ✅ Run failing tests in isolation FIRST before debugging
- ✅ Categorize failures before fixing
- ✅ Verify file existence before creating tasks

### Medium-Term Application (Sprint 32-33)
- ✅ Implement NATS test isolation using learnings
- ✅ Fix EventEmitter cleanup using tracked listener pattern
- ✅ Apply Jest `roots` pattern to any new test configurations

### Long-Term Application (Platform-Wide)
- ✅ Document "test in isolation" as standard debugging practice
- ✅ Add baseline metrics to sprint protocol
- ✅ Evangelize "configuration > constraints" principle

---

## Knowledge Artifacts Created

1. **jest-roots-solution.md** - Complete explanation of superior worktree solution
2. **nats-investigation.md** - Environmental vs code bug diagnostic approach
3. **test-failures-backlog.md** - Categorization framework for failures
4. **backlog-execution-summary.md** - Quick wins + investigation approach
5. **This document** - Consolidated learnings for future reference

---

## Conclusion

Sprint 30 generated **10 major technical learnings** and **3 anti-pattern identifications** with immediate applicability to future test infrastructure work.

**Most Valuable Learning**: Jest `roots` configuration + "test in isolation to distinguish bugs from environment" diagnostic approach.

**Most Surprising Learning**: User questions can reveal superior solutions even after work "completed."

**Most Actionable Learning**: Categorize by root cause before fixing - different categories need different solutions.

---

**Key Learnings Documented**: 2026-08-30
**Retention**: Permanent (sprint artifacts preserved)
**Next Application**: Sprint 31 (Category D bug investigation)
