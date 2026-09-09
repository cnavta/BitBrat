# T2 Critical Finding - Worktree Test Execution Location

**Date**: 2026-08-30 02:15 UTC
**Task**: T2.1 - Fix Worktree Duplication
**Status**: BLOCKED - Architectural issue discovered

---

## Problem

Jest configuration changes to exclude `.worktrees` are ineffective when running tests FROM WITHIN a worktree.

### Evidence

**Running from worktree** (`.worktrees/sprint-30-pe25g1/`):
```bash
npm test -- --listTests | wc -l
# Result: 2257 tests discovered

npm test -- --listTests | grep '.worktrees' | wc -l
# Result: 1802 tests from worktrees (including THIS worktree)
```

**Problem**: When running from a worktree, Jest resolves paths relative to the worktree location, which means:
1. It discovers tests in the CURRENT worktree
2. It ALSO discovers tests in OTHER worktrees (sprint-27, sprint-28, sprint-29)
3. Excluding `\.worktrees` would exclude OUR OWN tests

---

## Root Cause

**Sprint worktrees are git worktrees**, which means they share the `.git` directory with the main repo. When Jest runs from a worktree:
- Current working directory: `/path/.worktrees/sprint-30-pe25g1/`
- Jest scans upward and finds the main repo
- Discovers ALL test files in entire repository tree
- Including all other worktrees

---

## Solution Options

### Option A: Run Tests from Main Repo (RECOMMENDED)
**Pros**:
- Simple Jest configuration (just exclude `\.worktrees`)
- Clean separation
- No special cases

**Cons**:
- Must remember to `cd` to main repo before running tests
- Sprint workflow friction

**Implementation**:
```bash
# From anywhere in the repository
cd /Users/christophernavta/IdeaProjects/BitBratPlatform  # Main repo
npm test
```

**Jest config**:
```javascript
testPathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  '/deprecated/',
  '\\.worktrees',  // Excludes ALL worktrees when running from main
  '/tools/brat/src/oclif-commands/',
  'stream-analyst-service.test.ts',
],
```

### Option B: Exclude Specific Old Worktrees
**Pros**:
- Can run tests from within sprint worktree
- Preserves current workflow

**Cons**:
- Must maintain list of old sprints
- Brittle (breaks if sprint naming changes)
- Still slower (includes current worktree's duplicate tests)

**Implementation**:
```javascript
testPathIgnorePatterns: [
  // ... existing patterns ...
  '\\.worktrees/sprint-[0-2]',  // Excludes sprint-0 through sprint-29
  '\\.worktrees/sprint-27',
  '\\.worktrees/sprint-28',
  '\\.worktrees/sprint-29',
],
```

### Option C: Use .gitignore-style Exclusion in Jest
**Pros**:
- More intuitive
- Follows git conventions

**Cons**:
- Not how Jest works (uses regex, not gitignore patterns)
- Would require custom Jest resolver

---

## Recommended Path Forward

**SHORT TERM** (This Sprint):
1. Use **Option A** - Run tests from main repo
2. Update jest.config.js with `\.worktrees` exclusion
3. Document in README.md: "Run `npm test` from main repo, not worktrees"
4. Update sprint protocol to recommend test runs from main repo

**LONG TERM** (Future Sprint):
1. Create npm script that automatically `cd`s to main repo:
   ```json
   {
     "scripts": {
       "test": "cd $(git rev-parse --show-toplevel) && jest",
       "test:local": "jest"  // For running from current location
     }
   }
   ```
2. Add pre-test hook to warn if running from worktree
3. Consider moving to monorepo structure with workspace-aware testing

---

## Impact on Sprint Goals

### Modified Approach:
- T2.1: ✅ Jest config updated (correct pattern: `\.worktrees`)
- T2.2: ⚠️  MODIFIED - Verify from MAIN repo, not worktree
- T2.3: ⚠️  MODIFIED - Run tests from MAIN repo

### Updated Acceptance Criteria:
- ✅ Jest excludes `.worktrees` when run from main repo
- ✅ Documentation updated to clarify test execution location
- ⬜ Tests pass from main repo with reduced runtime

---

## Next Steps

1. Commit current jest.config.js change
2. Move to main repo: `cd /Users/christophernavta/IdeaProjects/BitBratPlatform`
3. Verify exclusion works from main repo
4. Run full test suite from main repo
5. Measure improvement
6. Update documentation

---

**Key Learning**: Sprint worktrees create architectural constraints for tooling that assumes a single working directory. Test infrastructure must account for multi-worktree scenarios.
