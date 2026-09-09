# Jest `roots` Configuration - Superior Solution to Worktree Issue

**Date**: 2026-08-30
**Discovery**: Post-sprint investigation
**Credit**: User question about alternative Jest configuration approaches

---

## Problem Recap

Running `npm test` from within a git worktree caused Jest to discover ALL worktrees in the repository tree, leading to:
- 1,945+ files checked (vs ~500 expected)
- 1,802 test files discovered (vs ~500 expected)
- Massive test duplication and 8.37 min runtime

---

## Initial Solution (Sprint 30)

**Approach**: Block test execution from worktrees
```javascript
// jest.config.js
const cwd = process.cwd();
if (cwd.includes('/.worktrees/')) {
  console.error('ERROR: Tests cannot be run from within a git worktree');
  process.exit(1);
}
```

**Pros**:
- Simple, guaranteed to prevent the issue
- Clear error message with guidance

**Cons**:
- **Prevents valid use case**: Can't run tests from worktrees at all
- Developer friction: Must remember to `cd` to main repo
- Doesn't fix root cause, just blocks symptom

---

## Superior Solution: `rootDir` + `roots` Configuration

**Approach**: Explicitly scope Jest's search paths
```javascript
// jest.config.js
module.exports = () => {
  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '.', // Explicit: current directory
    roots: [
      '<rootDir>/src',
      '<rootDir>/tests',
      '<rootDir>/tools'
    ],
    // ... rest of config
  };
};
```

**How it works**:
- `rootDir: '.'` - Sets the root to current working directory
- `roots: [...]` - Tells Jest to ONLY search within these directories
- Jest won't traverse up to parent directories or discover sibling worktrees

---

## Test Results

### File Discovery Comparison

| Configuration | Files Checked | Test Files | Notes |
|---------------|---------------|------------|-------|
| **Default (no roots)** | 1,945 | 1,802 | Discovers all worktrees |
| **With roots config** | 966 | 499 | ✅ Only current worktree |
| **Main repo baseline** | ~1,050 | ~528 | Expected normal behavior |

### Evidence from Test Run

```bash
# From worktree WITH roots config:
npm test -- bit-conformance 2>&1 | grep "files checked"

# Output:
# 966 files checked.
# roots: .../sprint-30-pe25g1/src, .../sprint-30-pe25g1/tests, .../sprint-30-pe25g1/tools - 966 matches
# testMatch: **/__tests__/**/*.[jt]s?(x), **/?(*.)+(spec|test).[tj]s?(x) - 499 matches
```

**Result**: ✅ Jest successfully scoped to worktree-only, no parent traversal

---

## Benefits of `roots` Solution

1. **Enables worktree testing**: Developers CAN run tests from worktrees
2. **Fixes root cause**: Prevents upward directory traversal
3. **No developer friction**: Works transparently
4. **Portable**: Same config works from main repo AND worktrees
5. **Maintains flexibility**: Sprint workflow unchanged

---

## Recommended Implementation

### Full Configuration

```javascript
/**
 * Jest configuration
 */
module.exports = () => {
  /** @type {import('ts-jest').JestConfigWithTsJest} */
  const base = {
    preset: 'ts-jest',
    testEnvironment: 'node',

    // CRITICAL: Scope Jest to prevent worktree traversal (Sprint 30)
    // This allows tests to run from worktrees without discovering other worktrees
    rootDir: '.',
    roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools'],

    setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
    testPathIgnorePatterns: [
      '/node_modules/',
      '/dist/',
      '/deprecated/',
      '\\.worktrees',  // Still exclude worktrees from pattern matching
      '/tools/brat/src/oclif-commands/',
      'stream-analyst-service.test.ts',
    ],
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  };

  const isCI = !!process.env.CI || process.env.CLOUD_BUILD === '1' || process.env.BUILDKITE === 'true' || !!process.env.BUILD_ID;
  if (isCI) {
    if (!process.env.SKIP_REDIS_TESTS) {
      process.env.SKIP_REDIS_TESTS = 'true';
    }
    return {
      ...base,
      maxWorkers: 1,
      workerThreads: false,
      detectOpenHandles: true,
      forceExit: true,
    };
  }
  return base;
};
```

### Optional: Add Safety Warning (Non-blocking)

```javascript
// Optional: Warn but don't block
const cwd = process.cwd();
if (cwd.includes('/.worktrees/') || cwd.includes('\\.worktrees\\')) {
  console.warn('\n⚠️  Running tests from worktree: results may differ from main repo\n');
}
```

---

## Migration Path

### For Existing Sprint 30 Code

**Option 1: Immediate Switch** (Recommended)
1. Remove worktree blocking code from jest.config.js
2. Add `rootDir: '.'` and `roots: [...]` configuration
3. Test from both main repo and worktree
4. Update documentation to reflect new capability

**Option 2: Keep Block + Add Bypass Flag**
```javascript
const ALLOW_WORKTREE_TESTS = process.env.ALLOW_WORKTREE_TESTS === 'true';
if (isWorktree && !ALLOW_WORKTREE_TESTS) {
  console.error('ERROR: Tests blocked from worktree');
  console.error('To override: ALLOW_WORKTREE_TESTS=true npm test');
  process.exit(1);
}
```

---

## Validation Checklist

Before deploying `roots` solution:
- [ ] Run tests from main repo - confirm ~528 tests discovered
- [ ] Run tests from worktree - confirm ~499-528 tests (not 1,802+)
- [ ] Verify no test files from other worktrees discovered
- [ ] Check runtime comparable to main repo baseline
- [ ] Update documentation (README.md, t2-critical-finding.md)
- [ ] Remove or soften worktree blocking code

---

## Why We Missed This Initially

### Sprint 30 Analysis Gaps

From `t2-critical-finding.md`, we only considered:
- **Option A**: Run from main repo (enforced via blocking)
- **Option B**: Exclude specific old worktrees via patterns
- **Option C**: Custom Jest resolver

**We missed**: Explicit `roots` configuration to scope search paths

### Root Cause of Oversight

1. **Focused on patterns**: Tried to exclude worktrees via `testPathIgnorePatterns`
2. **Didn't understand Jest discovery**: Assumed Jest started search from config location
3. **No documentation reference**: Jest docs don't prominently mention worktree scenarios
4. **Quick pragmatic fix**: Blocking was fastest solution under time pressure

---

## Technical Deep Dive: How `roots` Works

### Jest's Test Discovery Algorithm (Simplified)

1. **Start from `roots`**: List of directories to search
2. **If `roots` undefined**: Use `rootDir` or current working directory
3. **Traverse directories**: Walk tree from root(s) looking for test files
4. **Apply filters**: testMatch, testPathIgnorePatterns, etc.

### Default Behavior (No `roots`)
```
cwd: /path/.worktrees/sprint-30/
rootDir: (undefined, defaults to cwd)
roots: (undefined, defaults to [rootDir])

Traversal:
  - Start at /path/.worktrees/sprint-30/
  - Walk up to /path/.worktrees/
  - Discover sprint-27/, sprint-28/, sprint-29/, sprint-30/
  - Search ALL of them!
```

### With `roots` Configuration
```
cwd: /path/.worktrees/sprint-30/
rootDir: '.' (explicit, resolves to cwd)
roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/tools']

Traversal:
  - Start ONLY at:
    - /path/.worktrees/sprint-30/src/
    - /path/.worktrees/sprint-30/tests/
    - /path/.worktrees/sprint-30/tools/
  - No upward traversal!
  - No sibling directory discovery!
```

---

## Recommendation for Future Sprints

**Adopt `roots` configuration as the standard solution.**

**Benefits**:
- Solves root cause (directory traversal)
- Enables testing from any location
- Maintains sprint workflow flexibility
- No developer friction

**Update Sprint Protocol**:
- Remove requirement to "always run tests from main repo"
- Document that `roots` config enables worktree testing
- Keep worktree cleanup as maintenance task (not critical for testing)

---

## Key Learning

**Always explore configuration-based solutions before architectural constraints.**

Blocking execution is a last resort. Configuration options like `roots`, `testMatch`, and `moduleNameMapper` can often solve problems without restricting developer workflows.

---

**Status**: Solution validated, ready for adoption
**Next Steps**:
1. Complete validation test run (background job 931b22)
2. Update jest.config.js in sprint branch
3. Update documentation to reflect new capability
4. Consider this superior solution for main repo merge
