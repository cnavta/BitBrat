# Sprint 23: Execution Plan - Fix `brat bit create` Command

**Sprint ID**: sprint-23-isla86
**Goal**: Fix and validate the `brat bit create` npm script command
**Date**: 2026-08-22
**Lead Implementor**: Claude Code

---

## Overview

This execution plan addresses 7 identified issues in the `brat bit create` command, organized into 3 phases based on priority and dependencies.

**Total Estimated Effort**: ~8-12 hours of development + testing

---

## Phase 1: Critical Fixes (P0)

**Goal**: Fix command to be worktree-aware and align with Sprint Protocol

**Duration**: ~4-6 hours

### Task 1.1: Implement Git Repository Detection

**File**: `tools/brat/src/cli/bit/git-utils.ts` (new)

**Implementation**:
```typescript
import { execSync } from 'child_process';
import path from 'path';

export interface GitInfo {
  isGitRepo: boolean;
  repoRoot: string | null;
  isWorktree: boolean;
  worktreePath: string | null;
  currentBranch: string | null;
}

export function getGitInfo(): GitInfo {
  try {
    // Get repository root
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Check if in worktree
    const gitDir = execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const isWorktree = gitDir.includes('.git/worktrees/');

    // Get current branch
    const currentBranch = execSync('git branch --show-current', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    return {
      isGitRepo: true,
      repoRoot,
      isWorktree,
      worktreePath: isWorktree ? repoRoot : null,
      currentBranch: currentBranch || null,
    };
  } catch (error) {
    return {
      isGitRepo: false,
      repoRoot: null,
      isWorktree: false,
      worktreePath: null,
      currentBranch: null,
    };
  }
}

export function validateGitEnvironment(): { valid: boolean; errors: string[] } {
  const gitInfo = getGitInfo();
  const errors: string[] = [];

  if (!gitInfo.isGitRepo) {
    errors.push('Not in a git repository');
    errors.push('brat commands must be run from within the BitBrat repository');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

**Tests**:
- Test in git repo
- Test in non-git directory
- Test in worktree
- Test in main repo
- Test error handling

**Acceptance Criteria**:
- ✅ Correctly detects git repository
- ✅ Distinguishes between worktree and main repo
- ✅ Returns null for non-git environments
- ✅ Handles git command errors gracefully

---

### Task 1.2: Integrate Sprint Status Awareness

**File**: `tools/brat/src/cli/bit/sprint-utils.ts` (new)

**Implementation**:
```typescript
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface SprintInfo {
  hasActiveSprint: boolean;
  sprintId: string | null;
  worktreePath: string | null;
  branch: string | null;
}

export function getSprintInfo(repoRoot: string): SprintInfo {
  try {
    const sprintIndexPath = path.join(repoRoot, 'planning', 'sprint-index.yaml');

    if (!fs.existsSync(sprintIndexPath)) {
      return {
        hasActiveSprint: false,
        sprintId: null,
        worktreePath: null,
        branch: null,
      };
    }

    const sprintIndex = yaml.load(fs.readFileSync(sprintIndexPath, 'utf8')) as any;

    // Find active sprint
    const activeSprint = Object.values(sprintIndex.sprints || {}).find(
      (s: any) => s.status === 'planning' || s.status === 'in-progress'
    ) as any;

    if (!activeSprint) {
      return {
        hasActiveSprint: false,
        sprintId: null,
        worktreePath: null,
        branch: null,
      };
    }

    // Calculate worktree path
    const worktreePath = path.join(repoRoot, '.worktrees', activeSprint.id);

    return {
      hasActiveSprint: true,
      sprintId: activeSprint.id,
      worktreePath,
      branch: activeSprint.branch || null,
    };
  } catch (error) {
    return {
      hasActiveSprint: false,
      sprintId: null,
      worktreePath: null,
      branch: null,
    };
  }
}

export function validateSprintContext(
  gitInfo: { isWorktree: boolean; repoRoot: string | null },
  sprintInfo: SprintInfo
): { shouldWarn: boolean; message: string | null } {
  // If no active sprint, no warning needed
  if (!sprintInfo.hasActiveSprint) {
    return { shouldWarn: false, message: null };
  }

  // If in worktree, check if it matches active sprint
  if (gitInfo.isWorktree && gitInfo.repoRoot === sprintInfo.worktreePath) {
    return { shouldWarn: false, message: null };
  }

  // Warn if not in active sprint worktree
  return {
    shouldWarn: true,
    message: `
⚠️  Active sprint detected: ${sprintInfo.sprintId}
   Sprint worktree: ${sprintInfo.worktreePath}
   Current location: ${gitInfo.repoRoot}

   Best practice: Create Bits in the sprint worktree during active sprints.

   To switch to sprint worktree:
     cd ${sprintInfo.worktreePath}
`,
  };
}
```

**Tests**:
- Test with no active sprint
- Test with active sprint, in correct worktree
- Test with active sprint, in main repo
- Test with active sprint, in different worktree
- Test with missing sprint-index.yaml

**Acceptance Criteria**:
- ✅ Correctly identifies active sprint
- ✅ Calculates worktree path
- ✅ Warns when creating outside sprint worktree
- ✅ No false warnings when no active sprint

---

### Task 1.3: Update `cmdBitCreate` to Use Git/Sprint Utils

**File**: `tools/brat/src/cli/bit/create.ts`

**Changes**:
```typescript
// Add imports
import { getGitInfo, validateGitEnvironment } from './git-utils';
import { getSprintInfo, validateSprintContext } from './sprint-utils';

export async function cmdBitCreate(
  cmd: string[],
  rest: string[],
  flags: Record<string, any>,
  logger: Logger
): Promise<void> {
  // ... existing flag parsing ...

  // REPLACE: const root = process.cwd();
  // WITH:

  // 1. Validate git environment
  const gitValidation = validateGitEnvironment();
  if (!gitValidation.valid) {
    console.error('\n❌ Environment Error:\n');
    gitValidation.errors.forEach(err => console.error(`  ${err}`));
    console.error('');
    process.exit(2);
  }

  // 2. Get git info
  const gitInfo = getGitInfo();
  const root = gitInfo.repoRoot!; // Safe because validated above

  // 3. Get sprint info and validate context
  const sprintInfo = getSprintInfo(root);
  const contextValidation = validateSprintContext(gitInfo, sprintInfo);

  if (contextValidation.shouldWarn) {
    console.warn(contextValidation.message);

    // Optional: Ask for confirmation
    if (!flags.force) {
      console.log('Proceed anyway? Use --force to skip this warning.');
      console.log('');
      process.exit(0);
    }
  }

  // ... rest of existing logic ...
}
```

**Tests**:
- Test creating in main repo (no sprint)
- Test creating in worktree (active sprint)
- Test creating from main while sprint active
- Test with --force to bypass warning

**Acceptance Criteria**:
- ✅ Uses git root instead of process.cwd()
- ✅ Warns when appropriate
- ✅ --force bypasses warning
- ✅ Fails gracefully in non-git environment

---

### Task 1.4: Update CLAUDE.md Documentation

**File**: `CLAUDE.md`

**Changes**:
1. Line 344: Change `--category <platform|domain>` to `--kind <pipeline-service|gateway|mcp-server>`
2. Add worktree awareness documentation
3. Update examples to show sprint context awareness

**Before**:
```markdown
npm run brat -- bit create <name> \
  --profile <core|gateway|llm|mcp-server> \
  --category <platform|domain> \
  --exposure <platform-only|platform+domain|none> \
  --register --active
```

**After**:
```markdown
npm run brat -- bit create <name> \
  --profile <core|gateway|llm|mcp-server> \
  --kind <pipeline-service|gateway|mcp-server> \
  --exposure <platform-only|platform+domain|none> \
  --register --active

**Worktree Awareness**:
- During active sprint: Creates Bits in sprint worktree (warns if run from elsewhere)
- No active sprint: Creates Bits in main repository
- Use --force to bypass sprint context warnings
```

**Acceptance Criteria**:
- ✅ All flag names match implementation
- ✅ Worktree behavior documented
- ✅ Examples are accurate

---

## Phase 2: Safety & UX Enhancements (P1)

**Goal**: Improve user experience and safety

**Duration**: ~2-3 hours

### Task 2.1: Implement Dry-Run Mode

**File**: `tools/brat/src/cli/bit/create.ts`

**Changes**:
```typescript
// Add flag
const dryRun = parsedFlags['dry-run'] === true || parsedFlags['dry-run'] === 'true';

// After validation, before file generation
if (dryRun) {
  console.log('\n🔍 Dry-run mode: No files will be created\n');

  console.log('✅ Validation passed');
  console.log(`  Name: ${name} (valid kebab-case)`);
  console.log(`  Profile: ${profile}`);
  console.log(`  Exposure: ${exposure} (valid for ${profile} profile)`);
  if (gitInfo.isWorktree) {
    console.log(`  Sprint: ${sprintInfo.sprintId} (active)`);
  }
  console.log('');

  console.log('Would create:');
  console.log(`  [CREATE] ${entry} (~682 bytes)`);
  console.log(`  [CREATE] ${entry.replace(/\.ts$/, '.test.ts')} (~585 bytes)`);
  console.log(`  [CREATE] Dockerfile.${name} (~359 bytes)`);
  console.log(`  [CREATE] infrastructure/docker-compose/services/${name}.compose.yaml (~634 bytes)`);

  if (register) {
    console.log(`  [REGISTER] architecture.yaml`);
  }

  console.log('');
  console.log(`Location: ${root}`);
  console.log('');

  return; // Exit without creating files
}

// ... continue with file creation ...
```

**Update help**:
```typescript
  --dry-run             Preview what would be created without creating files
```

**Acceptance Criteria**:
- ✅ Shows validation results
- ✅ Shows files that would be created
- ✅ Shows target location
- ✅ Does NOT create any files
- ✅ Exit code 0 on success

---

### Task 2.2: Enhance Error Messages

**File**: `tools/brat/src/cli/bit/create.ts`

**Changes**:
1. Add context to error messages
2. Suggest corrections for common mistakes
3. Show location information in errors

**Example**:
```typescript
if (!nameResult.valid) {
  console.error('\n❌ Validation Error: Invalid Bit Name\n');
  nameResult.errors.forEach(err => console.error(`  ${err}`));
  console.error('\nValid Bit names must:');
  console.error('  - Use kebab-case (lowercase, hyphens only)');
  console.error('  - Start with a letter');
  console.error('  - Be 3-63 characters long');
  console.error('\nExamples:');
  console.error('  ✅ my-service');
  console.error('  ✅ api-gateway-v2');
  console.error('  ❌ MyService (use my-service)');
  console.error('  ❌ my_service (use my-service)');
  console.error('');
  process.exit(2);
}
```

**Acceptance Criteria**:
- ✅ Errors include context
- ✅ Errors suggest fixes
- ✅ Errors show examples

---

### Task 2.3: Add Cleanup Utility

**File**: `tools/brat/src/cli/bit/cleanup.ts` (new)

**Purpose**: Remove test bits created during development

**Implementation**:
```typescript
/**
 * Remove a Bit and all its generated files
 */
export async function cmdBitCleanup(
  name: string,
  flags: { force?: boolean; 'remove-from-arch'?: boolean },
  logger: Logger
): Promise<void> {
  const gitInfo = getGitInfo();
  const root = gitInfo.repoRoot!;

  const files = [
    path.join(root, `src/apps/${name}-service.ts`),
    path.join(root, `src/apps/${name}-service.test.ts`),
    path.join(root, `Dockerfile.${name}`),
    path.join(root, `infrastructure/docker-compose/services/${name}.compose.yaml`),
  ];

  console.log(`\nRemoving Bit: ${name}\n`);

  let removed = 0;
  for (const file of files) {
    if (fs.existsSync(file)) {
      if (!flags.force) {
        console.log(`  Would remove: ${file}`);
      } else {
        fs.unlinkSync(file);
        console.log(`  Removed: ${file}`);
        removed++;
      }
    }
  }

  if (flags['remove-from-arch']) {
    // Also remove from architecture.yaml
    await removeFromArchitecture(name, root, logger);
  }

  if (!flags.force) {
    console.log('\nDry-run mode. Use --force to actually remove files.');
  } else {
    console.log(`\n✅ Removed ${removed} files`);
  }
}
```

**Register command**:
```typescript
// tools/brat/src/oclif-commands/bit/cleanup.ts
export default class BitCleanup extends BratCommand {
  static override description = 'Remove a Bit and its generated files';

  static override args = {
    name: Args.string({ description: 'Bit name', required: true }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    force: Flags.boolean({ description: 'Actually remove files', default: false }),
    'remove-from-arch': Flags.boolean({
      description: 'Also remove from architecture.yaml',
      default: false
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(BitCleanup);
    await cmdBitCleanup(args.name, flags, this.logger);
  }
}
```

**Acceptance Criteria**:
- ✅ Lists files to be removed
- ✅ Dry-run by default
- ✅ --force actually removes files
- ✅ Can optionally remove from architecture.yaml

---

## Phase 3: Quality & Testing (P2)

**Goal**: Ensure reliability through comprehensive testing

**Duration**: ~2-3 hours

### Task 3.1: Unit Tests for Git Utils

**File**: `tools/brat/src/cli/bit/git-utils.test.ts` (new)

**Test Cases**:
```typescript
describe('getGitInfo', () => {
  it('should detect git repository', () => {});
  it('should detect worktree', () => {});
  it('should detect main repo', () => {});
  it('should handle non-git directory', () => {});
  it('should get current branch', () => {});
});

describe('validateGitEnvironment', () => {
  it('should pass in git repo', () => {});
  it('should fail in non-git directory', () => {});
  it('should provide helpful error messages', () => {});
});
```

**Acceptance Criteria**:
- ✅ All tests pass
- ✅ 100% code coverage for git-utils.ts

---

### Task 3.2: Unit Tests for Sprint Utils

**File**: `tools/brat/src/cli/bit/sprint-utils.test.ts` (new)

**Test Cases**:
```typescript
describe('getSprintInfo', () => {
  it('should detect active sprint', () => {});
  it('should handle no active sprint', () => {});
  it('should handle missing sprint-index.yaml', () => {});
  it('should calculate worktree path', () => {});
});

describe('validateSprintContext', () => {
  it('should not warn when in sprint worktree', () => {});
  it('should warn when in main repo with active sprint', () => {});
  it('should not warn when no active sprint', () => {});
});
```

**Acceptance Criteria**:
- ✅ All tests pass
- ✅ 100% code coverage for sprint-utils.ts

---

### Task 3.3: Integration Tests for `bit create`

**File**: `tools/brat/src/cli/bit/create.integration.test.ts` (new)

**Test Cases**:
```typescript
describe('brat bit create (integration)', () => {
  describe('in main repo', () => {
    it('should create files in main repo when no active sprint', () => {});
    it('should warn when active sprint exists', () => {});
    it('should bypass warning with --force', () => {});
  });

  describe('in worktree', () => {
    it('should create files in worktree', () => {});
    it('should not warn when in active sprint worktree', () => {});
  });

  describe('validation', () => {
    it('should reject invalid names', () => {});
    it('should reject invalid profile/exposure combos', () => {});
    it('should reject duplicate names (when registering)', () => {});
  });

  describe('dry-run mode', () => {
    it('should show preview without creating files', () => {});
    it('should perform all validation', () => {});
  });

  describe('non-git environment', () => {
    it('should fail with helpful error', () => {});
  });
});
```

**Acceptance Criteria**:
- ✅ All tests pass
- ✅ Integration tests cover all scenarios from findings.md
- ✅ Tests use temporary directories (no pollution)

---

### Task 3.4: Update Command Help

**File**: `tools/brat/src/cli/bit/create.ts` (printHelp function)

**Updates**:
```text
Environment:
  This command is git-aware and respects active sprint context.

  - During active sprint: Creates Bits in sprint worktree (warns if elsewhere)
  - No active sprint: Creates Bits in repository root
  - Use --force to bypass sprint context warnings
  - Use --dry-run to preview without creating files

Examples:
  # Preview what would be created
  brat bit create my-service --dry-run

  # Create in active sprint worktree
  cd .worktrees/sprint-XX-XXXXXX
  brat bit create my-service --register --active

  # Create in main repo (bypass warning if active sprint)
  brat bit create my-service --force

  # Remove test Bit
  brat bit cleanup test-service --force
```

**Acceptance Criteria**:
- ✅ Help text includes worktree info
- ✅ Examples show dry-run usage
- ✅ Examples show sprint context

---

## Validation Plan

After implementation, validate with the following scenarios:

### Scenario 1: Main Repo, No Active Sprint
```bash
cd /Users/christophernavta/IdeaProjects/BitBratPlatform
npm run brat -- bit create validation-test-1 --profile core
# Expected: Creates files in main repo, no warnings
```

### Scenario 2: Main Repo, Active Sprint
```bash
# (Assume Sprint 24 is active)
cd /Users/christophernavta/IdeaProjects/BitBratPlatform
npm run brat -- bit create validation-test-2 --profile core
# Expected: WARNS about active sprint, suggests worktree
```

### Scenario 3: Worktree, Active Sprint
```bash
cd /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-24-XXXXXX
npm run brat -- bit create validation-test-3 --profile core
# Expected: Creates files in worktree, NO warnings
```

### Scenario 4: Dry-Run Mode
```bash
npm run brat -- bit create dry-run-test --profile core --dry-run
# Expected: Shows preview, creates NO files
```

### Scenario 5: Cleanup
```bash
npm run brat -- bit cleanup validation-test-1 --force
# Expected: Removes all generated files
```

---

## Rollback Plan

If critical issues are discovered after implementation:

1. **Revert commits**: All changes are in feature branch, can be reverted
2. **Fallback to process.cwd()**: Temporarily disable git detection
3. **Disable warnings**: Make sprint warnings opt-in via flag

**Monitoring**:
- Watch for user reports of incorrect file locations
- Monitor for git command failures
- Track performance impact of git operations

---

## Success Criteria

Sprint 23 is successful when:

1. ✅ All 7 identified issues are resolved
2. ✅ Command is worktree-aware and respects Sprint Protocol
3. ✅ CLAUDE.md documentation is accurate and up-to-date
4. ✅ Comprehensive test coverage (>90% for new code)
5. ✅ No regressions in existing functionality
6. ✅ User can create Bits in correct location regardless of context
7. ✅ Clear, actionable warnings when creating outside active sprint

---

## Timeline

- **Day 1 (4 hours)**: Phase 1 - Critical Fixes
- **Day 1-2 (2 hours)**: Phase 2 - UX Enhancements
- **Day 2 (3 hours)**: Phase 3 - Testing & Validation
- **Total**: ~9 hours

---

## Next: Backlog

See `backlog.yaml` for detailed task breakdown and tracking.
