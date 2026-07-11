# Sprint 337: GitHub Release Integration

**Sprint ID:** sprint-337-abb8c02
**Status:** Planned (Awaiting Approval)
**Created:** 2026-07-11
**Lead Implementor:** Claude Code

---

## Objective

Add an optional `--github-release` flag to the `brat release` command that automatically creates a GitHub Release after version bumping, using release notes extracted from CHANGELOG.md.

---

## Quick Summary

### What We're Building

A new CLI flag for the existing `brat release` command:

```bash
# Current functionality (unchanged):
npm run brat -- release patch --tag

# New functionality (this sprint):
npm run brat -- release patch --tag --github-release
```

This will:
1. Bump version in architecture.yaml, package.json, package-lock.json ✓ (existing)
2. Rollover CHANGELOG.md ✓ (existing)
3. Create local git tag `v<version>` ✓ (existing)
4. **Extract release notes from CHANGELOG.md** (new)
5. **Create GitHub Release via `gh` CLI** (new)

### Key Features

- Non-breaking: All existing functionality preserved
- Optional: Feature behind `--github-release` flag
- Non-fatal: GitHub release failure doesn't abort version bump
- Dry-run support: `--dry-run` shows what would happen
- Smart extraction: Release notes auto-extracted from CHANGELOG.md

---

## Sprint Artifacts

| File | Description |
|------|-------------|
| `implementation-plan.md` | Detailed technical design, architecture, and execution strategy |
| `backlog.yaml` | Trackable task breakdown with priorities, dependencies, and estimates |
| `README.md` | This file - sprint overview and quick reference |

---

## Task Breakdown

**Total Tasks:** 18
**Estimated Hours:** 13.5 hours
**Critical Path:** 8.5 hours (P0 tasks only)

### By Phase

| Phase | Tasks | Hours | Description |
|-------|-------|-------|-------------|
| Phase 1 | 3 | 3.0 | Release Notes Extraction (foundational) |
| Phase 2 | 4 | 3.5 | GitHub CLI Integration |
| Phase 3 | 4 | 2.5 | CLI Integration & Orchestration |
| Phase 4 | 5 | 4.0 | Testing (unit, integration, manual) |
| Phase 5 | 3 | 1.5 | Documentation |

### By Priority

- **P0 (Critical):** 11 tasks - Core functionality
- **P1 (Important):** 6 tasks - Error handling, logging, validation
- **P2 (Nice-to-have):** 1 task - Documentation polish

---

## Success Criteria

### Functional Requirements
- ✅ `--github-release` flag available in CLI
- ✅ Flag requires `--tag` to be set (validation)
- ✅ Release notes extracted from CHANGELOG.md
- ✅ GitHub release created via `gh` CLI
- ✅ Dry-run support works correctly
- ✅ Clear error messages for common failures

### Non-Functional Requirements
- ✅ No breaking changes to existing command
- ✅ Follows existing code patterns
- ✅ Test coverage ≥ 80% for new code
- ✅ Documentation updated (CLAUDE.md, README.md)
- ✅ Idempotent and safe to re-run

---

## Dependencies

### External
- **GitHub CLI (`gh`)** - Required for release creation
  - Install: https://cli.github.com
  - Auth: `gh auth login` (one-time)

### Internal
- No new npm packages
- Uses Node.js built-ins: `child_process`, `fs/promises`
- Builds on existing `tools/brat/src/release/` module

---

## Files Modified

### New Files
- `tools/brat/src/release/__tests__/changelog-extraction.spec.ts`

### Modified Files
- `tools/brat/src/release/changelog.ts` - Add `extractReleaseNotes()`
- `tools/brat/src/release/release.ts` - Add `createGitHubRelease()`, update orchestration
- `tools/brat/src/cli/release.ts` - Parse `--github-release` flag
- `tools/brat/src/release/__tests__/release.spec.ts` - Add test cases
- `CLAUDE.md` - Document new flag
- `README.md` - Update release documentation (if applicable)

---

## Risk Assessment

### Low Risk
- ✅ Feature is optional (behind flag)
- ✅ No changes to existing core logic
- ✅ Follows established patterns

### Medium Risk
- ⚠️ Dependency on external `gh` CLI
  - **Mitigation:** Clear errors, graceful degradation
- ⚠️ Network dependency for GitHub API
  - **Mitigation:** Non-fatal failure mode

---

## Timeline

**Estimated Duration:** 1-2 days (with normal interruptions)

**Critical Path:**
1. Phase 1: Release notes extraction (3 hours)
2. Phase 2: GitHub CLI integration (3.5 hours)
3. Phase 3: CLI wiring (2.5 hours)
4. Phase 4: Testing (4 hours)
5. Phase 5: Documentation (1.5 hours)

**Buffer:** +20% for unexpected issues

---

## Acceptance Test

```bash
# Test 1: Full flow with GitHub release
npm run brat -- release patch --tag --github-release

# Expected:
# ✓ Version bumped in architecture.yaml, package.json, package-lock.json
# ✓ CHANGELOG.md rolled over
# ✓ Git tag v<version> created
# ✓ GitHub release created
# ✓ Release notes match CHANGELOG section

# Test 2: Dry-run (no mutations)
npm run brat -- release minor --tag --github-release --dry-run

# Expected:
# ✓ No files changed
# ✓ Console shows what would happen
# ✓ No git tag created
# ✓ No GitHub release created

# Test 3: Validation error
npm run brat -- release major --github-release

# Expected:
# ✗ Error: GitHub releases require git tags. Use --tag with --github-release
```

---

## Next Steps

1. **Review:** User reviews `implementation-plan.md` and `backlog.yaml`
2. **Approval:** User approves plan to start execution
3. **Execute:** Follow AGENTS.md sprint protocol
4. **Test:** Run validation script
5. **Ship:** Create PR and merge to main

---

## Notes

- This sprint follows the **AGENTS.md protocol** for BitBrat development
- All existing `brat release` behavior is preserved (zero breaking changes)
- GitHub release creation is **non-fatal** (version bump succeeds even if release fails)
- The implementation is **idempotent** and safe to re-run

---

**Status:** Awaiting user approval to begin execution

**Ready to start?** Say "Start sprint" when ready to execute.
