# Sprint 347: Root Directory Cleanup - Implementation Plan

**Sprint ID:** sprint-347-root-directory-cleanup
**Status:** Planning
**Estimated Duration:** 1.8 hours
**Priority:** High (Developer Experience + Professional Appearance)

---

## Executive Summary

The project root directory currently contains **127 items**, including many files that belong elsewhere. This sprint will reorganize the root to contain only ~45-50 essential files, dramatically improving the professional appearance on GitHub and developer experience.

**Impact:**
- ✅ Professional GitHub first impression
- ✅ Easier navigation for new contributors
- ✅ Clear separation of concerns (config vs. scripts vs. docs vs. migrations)
- ✅ Reduced clutter and confusion

---

## Current State Analysis

### Files to Keep in Root (~40-50 items)

**Configuration Files (15):**
- package.json, package-lock.json
- tsconfig.json, jest.config.js, eslint.config.mjs, .prettierrc.js
- .nvmrc, .dockerignore, .gitignore
- firebase.json, firestore.rules, firestore.indexes.json
- .env.example

**Documentation (8):**
- README.md, CLAUDE.md, AGENTS.md, CHANGELOG.md
- LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md

**Build/Deploy (9):**
- Dockerfile.service, Dockerfile.brat, Dockerfile.obs-mcp, Dockerfile.reflex, Dockerfile.context-pack
- cloudbuild.*.yaml (4 files)

**Standard Directories (11):**
- src/, tests/, tools/, scripts/, documentation/, planning/, infrastructure/, env/, assets/, deprecated/, node_modules/

**Hidden Directories (3):**
- .git/, .github/, .husky/

### Files to Relocate/Remove (~55 items)

**Category 1: Migration Documentation (24 files)**
- Destination: `documentation/migrations/`
- All PostgreSQL migration and fix documentation from Sprint 343

**Category 2: PostgreSQL Scripts (5 files)**
- Destination: `scripts/postgres/`
- Table creation scripts and migration tooling

**Category 3: PostgreSQL Tests (13 files)**
- Destination: `tests/integration/postgres/`
- Integration test files for PostgreSQL stores

**Category 4: Ad-hoc Shell Scripts (5 files)**
- Destination: `scripts/` or remove if obsolete
- Evaluate purpose and relocate/remove

**Category 5: Validation Logs (14 files)**
- Action: Untrack from git (already gitignored)
- Use `git rm --cached` to preserve local files

**Category 6: Scratch Files (2 files)**
- Action: Remove from git
- repro_limit.ts, BitBratPlatform.iml

**Category 7: Temp Terraform Dirs (4 directories)**
- Action: Untrack from git (already gitignored)

---

## Implementation Phases

### Phase 1: Create New Directory Structure (HIGH PRIORITY)

**Tasks:**
1. ✅ ROOT-01: Create `documentation/migrations/` with README
2. ✅ ROOT-03: Create `scripts/postgres/` with README

**Estimate:** 0.2h
**Acceptance Criteria:**
- Directories created with clear README files
- Index/table of contents prepared for incoming files

---

### Phase 2: Relocate Migration Documentation (HIGH PRIORITY)

**Tasks:**
1. ✅ ROOT-02: Move 24 migration/fix .md files to `documentation/migrations/`

**Commands:**
```bash
# Use git mv to preserve history
git mv AUTH_SERVICE_FIREBASE_FIX.md documentation/migrations/
git mv COMPLETE_FIRESTORE_MIGRATION.md documentation/migrations/
# ... (repeat for all 24 files)
```

**Estimate:** 0.3h
**Acceptance Criteria:**
- All files moved with `git mv` (preserves git history)
- documentation/migrations/README.md updated with index
- Single commit: "refactor: Move PostgreSQL migration docs to documentation/migrations/"

---

### Phase 3: Relocate PostgreSQL Scripts and Tests (HIGH PRIORITY)

**Tasks:**
1. ✅ ROOT-04: Move 5 setup scripts to `scripts/postgres/`
2. ✅ ROOT-05: Move 13 test files to `tests/integration/postgres/`

**Commands:**
```bash
# Setup scripts
git mv create-api-tokens-table.mjs scripts/postgres/
git mv create-prompt-logs-table.mjs scripts/postgres/
git mv create-reflexes-table.ts scripts/postgres/
git mv create-tool-usage-table.mjs scripts/postgres/
git mv run-staging-migration.sh scripts/postgres/

# Test files
mkdir -p tests/integration/postgres
git mv test-*-postgres.* tests/integration/postgres/
```

**Estimate:** 0.4h
**Acceptance Criteria:**
- All files moved with `git mv`
- scripts/postgres/README.md explains each script
- Two commits:
  - "refactor: Move PostgreSQL setup scripts to scripts/postgres/"
  - "refactor: Move PostgreSQL integration tests to tests/integration/postgres/"

---

### Phase 4: Evaluate and Relocate Shell Scripts (MEDIUM PRIORITY)

**Tasks:**
1. ✅ ROOT-06: Evaluate 5 shell scripts (check.sh, deploy-staging.sh, go.sh, lgo.sh, rgo.sh)

**Evaluation Criteria:**
- Is script still used?
- Is functionality covered by `brat` CLI?
- Should it be in `scripts/` with better name?

**Estimate:** 0.3h
**Acceptance Criteria:**
- Each script evaluated with decision documented
- Useful scripts moved to `scripts/` with descriptive names
- Obsolete scripts removed
- Commit: "refactor: Relocate/remove ad-hoc shell scripts"

---

### Phase 5: Clean Up Tracked Artifacts (MEDIUM PRIORITY)

**Tasks:**
1. ✅ ROOT-07: Update .gitignore for validation/log patterns
2. ✅ ROOT-08: Untrack 14 validation/log files
3. ✅ ROOT-09: Remove scratch files (repro_limit.ts, BitBratPlatform.iml)
4. ✅ ROOT-10: Untrack temporary Terraform directories

**Commands:**
```bash
# Update .gitignore if needed
# Untrack log files (preserve local copies)
git rm --cached .validation*.log
git rm --cached validation*.log
git rm --cached final_*.log
git rm --cached *_validation*.log
git rm --cached egress_fail.log
git rm --cached full_test_results.log
git rm --cached test_results.log

# Remove scratch files
git rm repro_limit.ts
git rm BitBratPlatform.iml

# Untrack Terraform temp dirs
git rm -r --cached .tfvars.*/
```

**Estimate:** 0.3h
**Acceptance Criteria:**
- .gitignore updated with comprehensive patterns
- Files untracked but preserved locally
- Two commits:
  - "chore: Untrack validation/log files and temp artifacts"
  - "chore: Remove scratch files from git"

---

### Phase 6: Documentation and Verification (LOW PRIORITY)

**Tasks:**
1. ✅ ROOT-11: Verify validate_deliverable.sh location
2. ✅ ROOT-12: Create root directory documentation
3. ✅ ROOT-13: Final verification

**Estimate:** 0.4h
**Acceptance Criteria:**
- validate_deliverable.sh kept in root or moved with documentation updated
- README.md includes "Repository Structure" section
- Root contains ~45-50 items
- All files have clear purpose
- Commit: "docs: Document root directory structure and finalize cleanup"

---

## Execution Order

1. **Phase 1** → Create directories (0.2h)
2. **Phase 2** → Move migration docs (0.3h)
3. **Phase 3** → Move PostgreSQL scripts/tests (0.4h)
4. **Phase 4** → Evaluate shell scripts (0.3h)
5. **Phase 5** → Clean up artifacts (0.3h)
6. **Phase 6** → Documentation and verification (0.4h)

**Total Estimate:** 1.9h

---

## Acceptance Criteria (Sprint-Level)

### Must Have
- ✅ Root directory reduced from 127 to ~45-50 items
- ✅ All migration docs in `documentation/migrations/`
- ✅ All PostgreSQL scripts in `scripts/postgres/`
- ✅ All PostgreSQL tests in `tests/integration/postgres/`
- ✅ Git history preserved for all moves (use `git mv`)
- ✅ Validation/log files untracked but preserved locally
- ✅ Professional appearance for GitHub visitors

### Should Have
- ✅ Clear README in each new directory
- ✅ Root directory structure documented
- ✅ All shell scripts evaluated and relocated/removed
- ✅ .gitignore patterns comprehensive

### Nice to Have
- ✅ Repository structure diagram in README.md
- ✅ Migration documentation timeline/index

---

## Risk Mitigation

### Risk 1: Breaking CI/CD Workflows
**Mitigation:**
- Search for references to moved files in .github/workflows/
- Update paths in any CI scripts
- Test validate_deliverable.sh after any moves

### Risk 2: Breaking Developer Workflows
**Mitigation:**
- Document all moves in commit messages
- Update any internal documentation referencing file paths
- Test that PostgreSQL scripts still work from new location

### Risk 3: Losing Git History
**Mitigation:**
- Always use `git mv` for moves (never copy/delete)
- Use `git rm --cached` for untracking (preserves local files)
- Verify git log --follow works after moves

---

## Success Metrics

**Before:**
- 127 items in root directory
- Confusing mix of configs, scripts, docs, logs, temp files
- Unprofessional GitHub appearance

**After:**
- ~45-50 items in root directory
- Clear separation: configs, docs, builds in root; everything else organized
- Professional, scannable GitHub appearance
- Easy for new contributors to navigate

**Improvement:** ~60% reduction in root directory clutter

---

## Notes

- This is a **hygiene sprint** - no functional changes
- All moves preserve git history
- Each phase should be a separate commit for easy rollback
- Focus on making the project look professional for GitHub visitors
- This improves developer experience for both humans and AI agents

---

## Related Work

- Sprint 323: Repository hygiene improvements (removed dummy-creds.json, etc.)
- Sprint 346: Documentation cleanup (low-priority reference updates)

---

**Status:** Ready for Implementation
**Approved By:** User (Platform Owner)
**Next Step:** Begin Phase 1 (Create directory structure)
