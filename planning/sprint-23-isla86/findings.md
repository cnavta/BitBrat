# Sprint 23: `brat bit create` Analysis Findings

**Sprint ID**: sprint-23-isla86
**Goal**: Fix and validate the `brat bit create` npm script command
**Date**: 2026-08-22
**Lead Implementor**: Claude Code

---

## Executive Summary

The `brat bit create` command has **7 critical issues** that need remediation:

1. ❌ **Flag naming inconsistency**: CLAUDE.md documents `--category` flag, but actual implementation uses `--kind`
2. ❌ **Worktree awareness**: Command uses `process.cwd()` instead of git-aware repository root detection
3. ❌ **No validation**: Command creates files in wrong location when run from main repo while in worktree environment
4. ⚠️ **Missing cleanup**: No mechanism to remove test bits from architecture.yaml after creation
5. ⚠️ **Path resolution**: Uses relative paths without checking if in worktree
6. ⚠️ **No dry-run mode**: Cannot preview what will be created without actually creating files
7. ⚠️ **Limited testing**: No automated tests for worktree scenarios

---

## Detailed Findings

### 1. Flag Naming Inconsistency (Critical)

**Issue**: Documentation mismatch between CLAUDE.md and actual implementation.

**Evidence**:
- CLAUDE.md line 344: `--category <platform|domain>`
- Actual implementation (`tools/brat/src/oclif-commands/bit/create.ts` line 33): `--kind`

**Test**:
```bash
$ npm run brat -- bit create test-bit --profile core --category platform --exposure platform-only
Fatal error: NonExistentFlagsError: Nonexistent flag: --category
```

**Impact**:
- Users following documentation will get errors
- Confusion about correct flag to use
- Inconsistent API surface

**Root Cause**: Documentation not updated when flag was renamed from `--category` to `--kind`.

---

### 2. Worktree Awareness (Critical)

**Issue**: Command creates files relative to current working directory instead of repository root, causing files to be created in wrong location when run from worktree.

**Evidence**:
- `tools/brat/src/cli/bit/create.ts` line 102:
  ```typescript
  const root = process.cwd();
  ```

**Test Scenario**:
```bash
# From main repo
$ cd /Users/christophernavta/IdeaProjects/BitBratPlatform
$ npm run brat -- bit create test-from-main --profile core

# Result: Files created in main repo
$ ls /Users/christophernavta/IdeaProjects/BitBratPlatform/src/apps/test-from-main-service.ts
✅ EXISTS

# Expected: Should detect we're NOT in active worktree and either:
# 1. Warn user they're in main repo (not recommended)
# 2. Detect active sprint worktree and create there
# 3. Refuse to create unless in worktree during active sprint
```

**Impact**:
- Files created in main repo pollute the main branch
- Sprint work gets mixed with non-sprint work
- Violates unified worktree model (Sprint Protocol)
- Risk of accidentally committing test code to main

**Root Cause**: No git worktree detection logic in command implementation.

---

### 3. Repository Root Detection (Critical)

**Issue**: Command doesn't use git to detect repository root; relies only on `process.cwd()`.

**Expected Behavior**:
1. Detect if in git repository
2. Detect if in worktree
3. If in worktree, use worktree root
4. If in main repo, use main repo root
5. Validate location is appropriate for operation

**Current Behavior**:
```typescript
const root = process.cwd(); // Always uses current directory
```

**Recommended Approach**:
```typescript
import { execSync } from 'child_process';

function getGitRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository');
  }
}

function isWorktree(): boolean {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    return gitDir.includes('.git/worktrees/');
  } catch {
    return false;
  }
}
```

---

### 4. Sprint Protocol Integration (Critical)

**Issue**: Command doesn't integrate with sprint protocol or check for active sprint.

**Expected Behavior**:
- When active sprint exists, guide user to work in sprint worktree
- When no active sprint, allow creation in main repo (with warning)
- Validate files are created in correct location based on sprint state

**Current Behavior**:
- No sprint awareness
- No worktree guidance
- No validation of location correctness

**Integration Points**:
```typescript
// Should check sprint status via MCP
const sprintStatus = await checkSprintStatus();

if (sprintStatus.activeSprint) {
  const worktreePath = sprintStatus.activeSprint.worktreePath;
  if (process.cwd() !== worktreePath) {
    console.warn(`⚠️  Active sprint detected: ${sprintStatus.activeSprint.id}`);
    console.warn(`   Worktree: ${worktreePath}`);
    console.warn(`   Current:  ${process.cwd()}`);
    console.warn('');
    console.warn('   Recommendation: cd to sprint worktree before creating Bits');
    // Optional: Ask if they want to proceed anyway
  }
}
```

---

### 5. File Path Resolution (Medium)

**Issue**: All file paths are resolved relative to detected root, but no validation that root is correct.

**Evidence**:
```typescript
const appPath = path.join(root, entry);
const testPath = appPath.replace(/\.ts$/, '.test.ts');
const dockerfilePath = path.join(root, `Dockerfile.${name}`);
const composePath = path.join(root, 'infrastructure', 'docker-compose', 'services', `${name}.compose.yaml`);
```

**Risk**:
- If `root` is wrong, ALL files go to wrong location
- No validation that paths are within expected repository structure
- Could create files outside repository if `root` is manipulated

---

### 6. No Dry-Run Mode (Low)

**Issue**: Cannot preview what will be created without actually creating files.

**Use Case**:
- User wants to see what files/directories would be created
- User wants to validate paths before committing to creation
- CI/CD wants to validate command behavior

**Recommendation**:
Add `--dry-run` flag that:
1. Performs all validation
2. Shows what would be created
3. Shows file paths
4. Shows template previews (optional)
5. Does NOT create any files

```bash
$ npm run brat -- bit create my-service --profile core --dry-run

Dry-run mode: No files will be created

✅ Validation passed
  Name: my-service (valid kebab-case)
  Profile: core
  Exposure: platform-only (valid for core profile)

Would create:
  [CREATE] src/apps/my-service-service.ts (682 bytes)
  [CREATE] src/apps/my-service-service.test.ts (585 bytes)
  [CREATE] Dockerfile.my-service (359 bytes)
  [CREATE] infrastructure/docker-compose/services/my-service.compose.yaml (634 bytes)

Location: /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-23-isla86
```

---

### 7. Missing Test Coverage (Medium)

**Issue**: No automated tests for:
- Worktree scenarios
- Sprint integration
- Path resolution edge cases
- Error handling

**Test Scenarios Needed**:
1. Create bit in main repo (no active sprint)
2. Create bit in worktree (active sprint)
3. Create bit from wrong directory (should warn/error)
4. Create bit with invalid name
5. Create bit with invalid profile/exposure combo
6. Create bit that already exists (with/without --force)
7. Create bit with --register (success/failure cases)
8. Create bit in nested subdirectory
9. Create bit when not in git repo
10. Create bit with custom entry point

---

## Additional Observations

### ✅ What Works Well

1. **Template Generation**: Templates for app source, tests, Dockerfile, and docker-compose are well-structured
2. **Validation**: Profile/exposure validation is comprehensive and follows documented constraints
3. **Registration**: `--register` flag properly updates architecture.yaml
4. **Name Validation**: Kebab-case enforcement works correctly
5. **Force Overwrite**: `--force` flag properly handles existing files
6. **User Feedback**: Command provides clear success messages and next steps

### 📊 Command Usage Patterns

Analyzed CLAUDE.md examples:
```bash
# Basic usage (works ✅)
npm run brat -- bit create my-service

# With profile (works ✅)
npm run brat -- bit create api-gateway --profile gateway --exposure platform+domain

# With registration (works ✅)
npm run brat -- bit create my-service --register --active

# MCP server (works ✅)
npm run brat -- bit create custom-tools --profile mcp-server
```

All documented examples work when run from correct location.

---

## Impact Assessment

### High Impact Issues (Must Fix)

1. **Worktree awareness** - Violates Sprint Protocol, pollutes main repo
2. **Flag naming inconsistency** - Breaks user workflows, documentation mismatch
3. **Repository root detection** - Creates files in wrong location

### Medium Impact Issues (Should Fix)

4. **Sprint protocol integration** - No guidance for users
5. **File path resolution** - Security/correctness concern
6. **Missing test coverage** - Risk of regressions

### Low Impact Issues (Nice to Have)

7. **No dry-run mode** - Quality of life improvement

---

## Recommendations

### Priority 1: Critical Fixes
1. Implement git-aware repository root detection
2. Add worktree detection and validation
3. Update CLAUDE.md to use `--kind` instead of `--category`
4. Add sprint status integration

### Priority 2: Safety & UX
5. Add warning when creating outside active sprint worktree
6. Implement dry-run mode
7. Add comprehensive error messages

### Priority 3: Quality
8. Add automated tests for all scenarios
9. Document worktree behavior in command help
10. Add cleanup utility for test bits

---

## Test Matrix

| Scenario | Current Result | Expected Result | Priority |
|----------|---------------|-----------------|----------|
| Create in main repo (no sprint) | ✅ Works | ⚠️ Warn user | P1 |
| Create in worktree (active sprint) | ✅ Works | ✅ Works | - |
| Create from main while sprint active | ❌ Creates in main | ❌ Error or warn | P1 |
| Create with --category flag | ❌ Error | ✅ Works OR update docs | P1 |
| Create duplicate (no --force) | ✅ Skips | ✅ Skips | - |
| Create with --register in worktree | ✅ Works | ✅ Works | - |
| Create in non-git directory | ❓ Unknown | ❌ Error with message | P2 |
| Create with --dry-run | ❌ Not implemented | ℹ️ Show preview | P3 |

---

## Files Analyzed

1. `tools/brat/src/oclif-commands/bit/create.ts` - oclif command wrapper
2. `tools/brat/src/cli/bit/create.ts` - Core implementation (281 lines)
3. `CLAUDE.md` - User documentation
4. Generated files from test runs

---

## Next Steps

See `execution-plan.md` and `backlog.yaml` for detailed implementation plan.
