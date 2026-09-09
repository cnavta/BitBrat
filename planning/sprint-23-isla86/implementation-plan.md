# Sprint 23: Implementation Plan Summary

**Sprint ID**: sprint-23-isla86
**Title**: Fix brat bit create command
**Goal**: Make `brat bit create` worktree-aware and Sprint Protocol compliant
**Owner**: navta
**Status**: planning
**Created**: 2026-08-22

---

## Executive Summary

After thorough analysis of the `brat bit create` command, I've identified **7 critical issues** that need remediation. The command currently:

1. ❌ Has documentation/implementation mismatch (`--category` vs `--kind`)
2. ❌ Uses `process.cwd()` instead of git-aware root detection
3. ❌ Creates files in wrong location when run from outside active sprint worktree
4. ⚠️ Has no cleanup mechanism for test Bits
5. ⚠️ Lacks dry-run mode for preview
6. ⚠️ Has limited error messaging
7. ⚠️ Missing test coverage for worktree scenarios

**Key Finding**: The command creates files relative to current working directory rather than detecting the git repository root and respecting sprint context. This violates the unified worktree model from the Sprint Protocol.

---

## What I Did

### 1. Tested the Command

I created several test Bits to observe behavior:
- ✅ Basic creation works
- ✅ Templates are well-structured
- ✅ `--register` flag works
- ❌ Creates files in wrong location when run from main repo during active sprint
- ❌ `--category` flag from docs doesn't exist (actual flag is `--kind`)

### 2. Analyzed Implementation

I reviewed:
- `tools/brat/src/oclif-commands/bit/create.ts` - oclif wrapper
- `tools/brat/src/cli/bit/create.ts` - Core implementation (281 lines)
- `CLAUDE.md` - Documentation
- Generated test files

**Root Cause**: Line 102 of `create.ts`:
```typescript
const root = process.cwd(); // ❌ Always uses current directory
```

Should be:
```typescript
const root = getGitRoot(); // ✅ Git-aware repository detection
```

### 3. Created Documentation

I've produced three comprehensive documents:

#### `findings.md` (Detailed Analysis)
- 7 identified issues with evidence
- Test scenarios and impact assessment
- Risk analysis
- Test matrix

#### `execution-plan.md` (Implementation Strategy)
- 3 phases: Critical Fixes → UX Enhancements → Testing
- 14 tasks with acceptance criteria
- Code samples for implementation
- Validation plan
- Success criteria

#### `backlog.yaml` (Trackable Tasks)
- YAML format for easy tracking
- Priorities (P0, P1, P2)
- Dependencies graph
- Estimated hours (~9 hours total)
- Risk assessment
- Validation checklist

---

## Proposed Solution

### Phase 1: Critical Fixes (P0, ~5 hours)

**Task 1.1**: Create `git-utils.ts`
- Detect git repository
- Distinguish worktree vs main repo
- Return repository root path

**Task 1.2**: Create `sprint-utils.ts`
- Read `sprint-index.yaml`
- Detect active sprint
- Validate if in correct worktree
- Generate warning messages

**Task 1.3**: Update `create.ts`
- Replace `process.cwd()` with git root detection
- Add git environment validation
- Add sprint context warnings
- Support `--force` to bypass warnings

**Task 1.4**: Update `CLAUDE.md`
- Fix `--category` → `--kind`
- Document worktree behavior
- Update all examples

### Phase 2: UX Enhancements (P1, ~2 hours)

**Task 2.1**: Add `--dry-run` mode
- Preview what would be created
- Perform validation without creating files

**Task 2.2**: Enhance error messages
- Add context and suggestions
- Show examples

**Task 2.3**: Create `brat bit cleanup` command
- Remove test Bits and files
- Optionally remove from architecture.yaml

### Phase 3: Testing (P2, ~2 hours)

**Task 3.1-3.3**: Comprehensive test coverage
- Unit tests for git-utils and sprint-utils
- Integration tests for all scenarios
- >90% code coverage target

**Task 3.4**: Update help text
- Document worktree behavior
- Add examples

---

## Example: Expected Behavior After Fix

### Scenario: Creating Bit from Main Repo (Active Sprint Exists)

**Before (Current)**:
```bash
$ cd /Users/christophernavta/IdeaProjects/BitBratPlatform
$ npm run brat -- bit create test-bit --profile core

✅ Bit creation complete
  [CREATED] App source: src/apps/test-bit-service.ts
  # ❌ File created in MAIN REPO (wrong!)
```

**After (Fixed)**:
```bash
$ cd /Users/christophernavta/IdeaProjects/BitBratPlatform
$ npm run brat -- bit create test-bit --profile core

⚠️  Active sprint detected: sprint-23-isla86
   Sprint worktree: /path/to/.worktrees/sprint-23-isla86
   Current location: /path/to/BitBratPlatform

   Best practice: Create Bits in the sprint worktree during active sprints.

   To switch to sprint worktree:
     cd .worktrees/sprint-23-isla86

Proceed anyway? Use --force to skip this warning.

# ❌ Exits without creating files (unless --force)
```

### Scenario: Creating Bit in Sprint Worktree

**After (Fixed)**:
```bash
$ cd /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-23-isla86
$ npm run brat -- bit create test-bit --profile core

✅ Bit creation complete
  [CREATED] App source: src/apps/test-bit-service.ts
  # ✅ File created in WORKTREE (correct!)
  # ✅ No warnings
```

### Scenario: Dry-Run Mode

**After (Fixed)**:
```bash
$ npm run brat -- bit create my-service --profile core --dry-run

🔍 Dry-run mode: No files will be created

✅ Validation passed
  Name: my-service (valid kebab-case)
  Profile: core
  Exposure: platform-only (valid for core profile)
  Sprint: sprint-23-isla86 (active)

Would create:
  [CREATE] src/apps/my-service-service.ts (~682 bytes)
  [CREATE] src/apps/my-service-service.test.ts (~585 bytes)
  [CREATE] Dockerfile.my-service (~359 bytes)
  [CREATE] infrastructure/docker-compose/services/my-service.compose.yaml (~634 bytes)

Location: /path/to/.worktrees/sprint-23-isla86

# ✅ No files created
```

---

## Dependencies & Risks

### Dependencies
- All changes confined to `tools/brat/src/cli/bit/` directory
- No external API changes
- Backward compatible (existing workflows still work)

### Risks

**R1: Git command compatibility**
- **Mitigation**: Use only portable git commands, test on multiple platforms
- **Impact**: Medium

**R2: Sprint-index.yaml format changes**
- **Mitigation**: Add schema validation, handle gracefully
- **Impact**: High (but low probability)

**R3: Complex worktree setups**
- **Mitigation**: Test with multiple worktrees
- **Impact**: Medium

---

## Success Criteria

Sprint 23 is successful when:

1. ✅ All 7 identified issues are resolved
2. ✅ Command uses git root detection instead of `process.cwd()`
3. ✅ Command warns when creating outside active sprint worktree
4. ✅ CLAUDE.md is accurate (`--kind` not `--category`)
5. ✅ Dry-run mode works
6. ✅ Test coverage >90% for new code
7. ✅ No regressions in existing functionality
8. ✅ Validation passes for all scenarios in findings.md

---

## Next Steps

**Awaiting user approval to proceed with implementation.**

Once approved, I will:
1. Start with Phase 1 (Critical Fixes)
2. Implement git-utils and sprint-utils
3. Update create command
4. Fix CLAUDE.md
5. Add tests
6. Validate in real worktree environment
7. Complete sprint artifacts

**Questions for User**:
1. Should warnings be blocking (exit) or informational (proceed with warning)?
   - **Recommendation**: Informational by default, blocking unless `--force`
2. Should dry-run be the default behavior?
   - **Recommendation**: No, but available via `--dry-run` flag
3. Any additional scenarios to test?

---

## Estimated Timeline

- **Phase 1 (Critical)**: 5 hours
- **Phase 2 (UX)**: 2 hours
- **Phase 3 (Testing)**: 2 hours
- **Total**: ~9 hours

---

## Files to Review

1. `planning/sprint-23-isla86/findings.md` - Detailed analysis (7 issues)
2. `planning/sprint-23-isla86/execution-plan.md` - Implementation strategy (3 phases, 14 tasks)
3. `planning/sprint-23-isla86/backlog.yaml` - Trackable YAML backlog

All documents are in the sprint worktree at:
`/Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-23-isla86/planning/sprint-23-isla86/`
