# Implementation Plan: GitHub Release Integration for `brat release`

**Sprint ID:** sprint-337-abb8c02
**Objective:** Add optional GitHub Release creation to the `brat release` command
**Estimated Complexity:** Medium
**Target Completion:** Single sprint cycle

---

## Executive Summary

This sprint extends the existing `brat release` command to optionally create GitHub Releases after version bumping. The current command handles version bumping across `architecture.yaml`, `package.json`, `package-lock.json`, and CHANGELOG rollover, with optional local git tagging. We will add a `--github-release` flag that uses the GitHub CLI (`gh`) to create a release with auto-extracted notes from CHANGELOG.md.

---

## Background Context

### Current State Analysis

**Existing `brat release` Flow:**
1. Parse version bump argument (patch/minor/major or explicit x.y.z)
2. Update `architecture.yaml project.version` (single source of truth)
3. Sync `package.json` and `package-lock.json`
4. Rollover CHANGELOG.md: `## [Unreleased]` → `## [<version>] - <date>`
5. Optional: Create local git tag `v<version>` with `--tag` flag
6. **Never** pushes to remote (user's responsibility)

**Key Files:**
- `tools/brat/src/cli/release.ts` - CLI handler
- `tools/brat/src/release/release.ts` - Orchestration logic
- `tools/brat/src/release/changelog.ts` - CHANGELOG transformation
- `tools/brat/src/release/semver.ts` - Version parsing/bumping
- `tools/brat/src/release/version-files.ts` - File I/O operations

**Design Principles to Preserve:**
- ✅ Single source of truth: `architecture.yaml`
- ✅ Law #2 compliance: only touch `project.version` in architecture.yaml
- ✅ Idempotent operations
- ✅ Dry-run support
- ✅ Fail-closed error handling
- ✅ Local-first: don't push unless explicitly requested

### What We're Adding

A new optional flag `--github-release` that:
1. Requires `--tag` to be set (GitHub releases need tags)
2. Extracts release notes from CHANGELOG.md for the new version
3. Uses `gh release create` to publish the release
4. Respects `--dry-run` (shows what would be created but doesn't call GitHub)
5. Provides clear feedback on success/failure
6. Gracefully handles cases where `gh` CLI is not installed

---

## Technical Design

### 1. New CLI Flag

**Flag Specification:**
```
--github-release    Create a GitHub Release after version bump
                    Requires: --tag flag must also be set
                    Requires: gh CLI installed and authenticated
```

**Validation Rules:**
- If `--github-release` is set without `--tag`, error: "GitHub releases require git tags. Use --tag with --github-release"
- If `gh` CLI not found, error: "GitHub CLI (gh) not found. Install from https://cli.github.com"
- If not authenticated, `gh` will prompt for auth (standard behavior)

### 2. Release Notes Extraction

**Source:** CHANGELOG.md (Keep-a-Changelog format)

**Algorithm:**
1. Read CHANGELOG.md
2. Find section: `## [<version>] - <date>`
3. Extract all content until next `## [` header or EOF
4. Strip leading/trailing whitespace
5. If section empty, use default: "Release <version>"

**Edge Cases:**
- CHANGELOG.md missing → use default notes
- Version section not found → use default notes
- Empty version section → use default notes

**Implementation Location:**
- New function in `tools/brat/src/release/changelog.ts`:
  ```typescript
  export function extractReleaseNotes(
    content: string,
    version: string
  ): string
  ```

### 3. GitHub Release Creation

**GitHub CLI Command:**
```bash
gh release create v<version> \
  --title "v<version>" \
  --notes "<extracted-notes>" \
  [--draft]  # Optional: if --draft flag added
```

**Implementation Location:**
- New function in `tools/brat/src/release/release.ts`:
  ```typescript
  async function createGitHubRelease(
    version: string,
    notes: string,
    dryRun: boolean
  ): Promise<boolean>
  ```

**Process:**
1. Check if `gh` is available (using `which gh` or similar)
2. If dry-run: log what would be created, return true
3. Execute `gh release create v<version> --title "v<version>" --notes "<notes>"`
4. Capture stdout/stderr
5. Return true on success (exit code 0), false otherwise

### 4. Orchestration Flow Update

**Modified `runRelease()` in `release.ts`:**

```typescript
export async function runRelease(
  bumpArg: string,
  options: {
    dryRun?: boolean;
    tag?: boolean;
    githubRelease?: boolean;
    yes?: boolean;
  }
): Promise<void> {
  // [Existing validation]

  if (options.githubRelease && !options.tag) {
    throw new ConfigurationError(
      'GitHub releases require git tags. Use --tag with --github-release'
    );
  }

  // [Existing version bump logic]

  // [Existing CHANGELOG rollover]

  // [Existing git tag creation]

  // NEW: GitHub Release creation
  if (options.githubRelease) {
    const changelogContent = await fs.readFile('CHANGELOG.md', 'utf-8');
    const releaseNotes = extractReleaseNotes(changelogContent, newVersion);

    const success = await createGitHubRelease(
      newVersion,
      releaseNotes,
      options.dryRun
    );

    if (!success && !options.dryRun) {
      logger.error('Failed to create GitHub release');
      // Non-fatal: version bump already succeeded
    }
  }
}
```

### 5. CLI Wiring

**Update `tools/brat/src/cli/release.ts`:**

```typescript
const githubRelease = argv.includes('--github-release');

await runRelease(bumpArg, {
  dryRun,
  tag,
  githubRelease,
  yes
});
```

---

## Implementation Tasks

### Phase 1: Release Notes Extraction (Foundational)
1. Add `extractReleaseNotes()` function to `changelog.ts`
2. Write unit tests for various CHANGELOG formats
3. Handle edge cases (missing file, empty section, malformed headers)

### Phase 2: GitHub CLI Integration
4. Add `checkGhInstalled()` utility function
5. Add `createGitHubRelease()` function to `release.ts`
6. Implement dry-run support
7. Add error handling for `gh` failures

### Phase 3: CLI Integration
8. Add `--github-release` flag to CLI argument parser
9. Add validation logic (requires `--tag`)
10. Update orchestration flow in `runRelease()`
11. Add logging/user feedback

### Phase 4: Testing
12. Add unit tests for `extractReleaseNotes()`
13. Add integration test for full flow (mocked `gh` calls)
14. Add error case tests (no gh, not authenticated, etc.)
15. Manual smoke test with real GitHub repo

### Phase 5: Documentation
16. Update `CLAUDE.md` with new flag documentation
17. Update `README.md` release section
18. Add inline code comments for new functions

---

## Testing Strategy

### Unit Tests

**New test file:** `tools/brat/src/release/__tests__/changelog-extraction.spec.ts`

Test cases:
- ✅ Extract notes from well-formed CHANGELOG
- ✅ Handle missing CHANGELOG.md
- ✅ Handle missing version section
- ✅ Handle empty version section
- ✅ Handle multiple versions (extract correct one)
- ✅ Strip leading/trailing whitespace
- ✅ Preserve markdown formatting in notes

**Update:** `tools/brat/src/release/__tests__/release.spec.ts`

Test cases:
- ✅ `--github-release` without `--tag` throws error
- ✅ Dry-run logs GitHub release creation without calling `gh`
- ✅ Successful `gh` call returns true
- ✅ Failed `gh` call returns false and logs error
- ✅ Missing `gh` CLI throws error

### Integration Tests

**Approach:** Mock `child_process.exec` for `gh` commands

Test cases:
- ✅ Full flow: bump → tag → GitHub release
- ✅ Dry-run: no actual `gh` call made
- ✅ gh CLI not found: graceful error
- ✅ gh CLI fails: non-fatal error (version bump still succeeded)

### Manual Testing

**Checklist:**
- [ ] Run on test repo: `npm run brat -- release patch --tag --github-release`
- [ ] Verify GitHub Release created with correct title and notes
- [ ] Test dry-run: no release created
- [ ] Test without `gh` installed: clear error message
- [ ] Test with unauthenticated `gh`: proper auth flow

---

## Error Handling

### Failure Modes and Mitigations

| Failure Mode | Detection | Mitigation |
|--------------|-----------|------------|
| `gh` CLI not installed | `which gh` returns non-zero | Throw `ConfigurationError` with install instructions |
| `gh` not authenticated | `gh release create` fails | Let `gh` handle auth prompt (standard behavior) |
| `gh release create` fails | Exit code non-zero | Log error, return false (non-fatal) |
| CHANGELOG.md missing | File read fails | Use default notes: "Release \<version\>" |
| Version section not found | Regex match fails | Use default notes |
| Network failure during release | `gh` returns error | Log error with helpful message |

**Key Principle:** GitHub release creation is **non-fatal**. If version bump and CHANGELOG rollover succeed but GitHub release fails, the operation is still considered successful with a warning.

---

## Rollback Strategy

If issues arise during sprint:

1. **Code-level:** Feature is behind a flag (`--github-release`), can be disabled by not using flag
2. **Git-level:** Feature branch can be abandoned without affecting main
3. **Partial delivery:** If only extraction works, can merge that; GitHub creation can be follow-up sprint

**No breaking changes:** Existing `brat release` behavior is 100% preserved.

---

## Success Criteria

### Functional Requirements
- ✅ `--github-release` flag available in CLI
- ✅ Flag requires `--tag` to be set
- ✅ Release notes extracted from CHANGELOG.md
- ✅ `gh release create` called with correct arguments
- ✅ Dry-run support works correctly
- ✅ Clear error messages for common failures

### Non-Functional Requirements
- ✅ No breaking changes to existing command behavior
- ✅ Follows existing code patterns and architecture
- ✅ Test coverage ≥ 80% for new code
- ✅ Documentation updated in CLAUDE.md and README.md
- ✅ Idempotent: re-running same release is safe

### Acceptance Tests
1. Run: `npm run brat -- release patch --tag --github-release`
   - Version bumped in all 3 files ✓
   - CHANGELOG rolled over ✓
   - Git tag created ✓
   - GitHub release created ✓
   - Release notes match CHANGELOG section ✓

2. Run: `npm run brat -- release minor --tag --github-release --dry-run`
   - No files changed ✓
   - No git tag created ✓
   - No GitHub release created ✓
   - Console shows what would happen ✓

3. Run: `npm run brat -- release major --github-release` (no --tag)
   - Error thrown ✓
   - Message mentions `--tag` requirement ✓

---

## Dependencies and Prerequisites

### External Dependencies
- **GitHub CLI (`gh`)**: Required for GitHub release creation
  - Installation: https://cli.github.com
  - Version: Any recent version (≥2.0.0)
  - Authentication: `gh auth login` (one-time setup)

### Internal Dependencies
- No new npm packages required
- Uses existing:
  - `child_process` (Node.js built-in)
  - `fs/promises` (existing)
  - Existing `tools/brat` infrastructure

### Environment Requirements
- Git repository with remote configured
- GitHub repository accessible by authenticated `gh` CLI
- Write permissions to create releases

---

## Risk Assessment

### Low Risk
- ✅ Feature is optional (behind flag)
- ✅ No changes to existing core logic
- ✅ Follows established patterns in codebase

### Medium Risk
- ⚠️ Dependency on external `gh` CLI tool
  - Mitigation: Clear error messages, graceful degradation
- ⚠️ Network dependency for GitHub API
  - Mitigation: Non-fatal failure mode

### Mitigation Strategies
1. Make GitHub release creation **non-fatal** (log error, don't throw)
2. Comprehensive dry-run testing before live use
3. Validate `gh` installation before attempting release
4. Detailed error messages with actionable instructions

---

## Timeline Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1: Release Notes Extraction | Tasks 1-3 | 1-2 hours |
| Phase 2: GitHub CLI Integration | Tasks 4-7 | 2-3 hours |
| Phase 3: CLI Integration | Tasks 8-11 | 1-2 hours |
| Phase 4: Testing | Tasks 12-15 | 2-3 hours |
| Phase 5: Documentation | Tasks 16-18 | 1 hour |
| **Total** | **18 tasks** | **7-11 hours** |

**Buffer:** +20% for unexpected issues = **8.4-13.2 hours**

**Expected Completion:** Single sprint (1-2 days with interruptions)

---

## Open Questions

1. **Release draft option:** Should we add `--draft` flag for draft releases?
   - **Decision:** Defer to future sprint if needed

2. **Release assets:** Should we support attaching build artifacts?
   - **Decision:** No, out of scope for this sprint

3. **Pre-release flag:** Support for beta/rc versions?
   - **Decision:** No, current SemVer only supports stable versions

4. **Multiple CHANGELOG formats:** Support other formats beyond Keep-a-Changelog?
   - **Decision:** No, Keep-a-Changelog is project standard

---

## Appendix: Code Patterns Reference

### Existing Error Handling Pattern
```typescript
if (!isValidCondition) {
  throw new ConfigurationError('Clear message with actionable guidance');
}
```

### Existing Subprocess Pattern
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

try {
  const { stdout, stderr } = await execAsync('command');
  // Handle success
} catch (error) {
  // Handle failure
}
```

### Existing Dry-Run Pattern
```typescript
if (dryRun) {
  logger.info('[DRY RUN] Would execute: <action>');
  return true;
}
// Actually execute action
```

---

## Post-Sprint Deliverables

1. ✅ Working `--github-release` flag
2. ✅ Test suite with ≥80% coverage
3. ✅ Updated documentation (CLAUDE.md, README.md)
4. ✅ Validation script confirming functionality
5. ✅ Retro documenting learnings
6. ✅ GitHub PR for review

---

**Prepared by:** Lead Implementor (Claude Code)
**Date:** 2026-07-11
**Status:** Awaiting approval to begin execution
