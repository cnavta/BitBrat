# Implementation Plan: Automated GitHub Releases via CI/CD

**Sprint ID**: sprint-337-abb8c02
**Lead Implementor**: Claude Code
**Date**: 2026-07-11

## Problem Statement

The current `brat release` command was designed with a `--github-release` flag approach that has a fundamental flaw: GitHub Releases require the tag and code to already be pushed and merged to the repository before the release can be created. The local release workflow creates tags locally but doesn't push them, making it impossible to create a GitHub Release during the release command execution.

## Proposed Solution

Implement an automated GitHub Actions workflow that:
1. Triggers on PR merge to `main` branch
2. Detects if the version number has been bumped (by comparing `architecture.yaml` `project.version`)
3. Automatically creates a GitHub Release with:
   - Tag based on the new version (e.g., `v0.11.0`)
   - Release notes extracted from `CHANGELOG.md` for that version
   - Proper semantic versioning metadata

This approach aligns with industry-standard release automation patterns and ensures releases happen AFTER code is safely merged.

## Architecture

### Components

1. **GitHub Actions Workflow** (`.github/workflows/auto-release.yml`)
   - Trigger: `push` event on `main` branch
   - Condition: Version in `architecture.yaml` has changed
   - Actions: Create git tag, generate release notes, create GitHub Release
   - Secrets: `OPENAI_API_KEY` for LLM-enhanced release notes

2. **Version Detection Script** (`scripts/detect-version-change.sh`)
   - Compare current `architecture.yaml` version with previous commit
   - Exit with appropriate code to signal version change

3. **Release Notes Generator** (`scripts/generate-release-notes.sh`)
   - **Primary**: Parse `CHANGELOG.md` to extract section for specific version
   - **Fallback**: If CHANGELOG missing/sparse, use LLM to generate notes from git log
   - **Enhancement**: Use LLM (GPT-4o-mini) to create polished "Highlights" section
   - Intelligent summarization and categorization (features, fixes, breaking changes)

4. **LLM Integration** (Node.js script: `scripts/llm-release-notes.js`)
   - Call OpenAI API (GPT-4o-mini for speed/cost efficiency)
   - Parse git commits since last version tag
   - Generate structured release notes with categorization
   - Format output in GitHub-flavored markdown
   - Fallback to basic extraction if API fails

5. **Documentation Updates**
   - Remove `--github-release` references from CLAUDE.md
   - Update README.md to reflect CI/CD-based release process
   - Add new workflow documentation with LLM features

### Workflow Diagram

```
PR Merged → main
    ↓
GitHub Actions Triggered
    ↓
Check: Version Changed?
    ↓ (yes)
Extract Version from architecture.yaml
    ↓
Get git log since last version
    ↓
Generate Release Notes:
  ├─ Extract from CHANGELOG.md (if present)
  ├─ Parse git commits
  ├─ LLM Enhancement (GPT-4o-mini):
  │   ├─ Summarize changes
  │   ├─ Categorize (features/fixes/breaking)
  │   ├─ Generate highlights
  │   └─ Fallback if CHANGELOG missing
  └─ Format as GitHub markdown
    ↓
Create Git Tag (v${VERSION})
    ↓
Create GitHub Release with LLM-enhanced notes
    ↓
Done ✓
```

## Implementation Phases

### Phase 1: Core Workflow (Priority: Critical)
- Create GitHub Actions workflow file
- Implement version detection logic
- Implement basic changelog extraction logic
- Basic smoke test

### Phase 2: LLM Integration (Priority: Critical)
- Create Node.js script for LLM-enhanced release notes
- Implement OpenAI API integration (GPT-4o-mini)
- Parse git log and commit messages
- Generate categorized release notes (features/fixes/breaking)
- Implement fallback for CHANGELOG missing scenarios
- Configure OPENAI_API_KEY secret in workflow

### Phase 3: Release Creation (Priority: Critical)
- Integrate LLM release notes generator with workflow
- Configure GitHub Release creation
- Handle edge cases (no CHANGELOG entry, duplicate versions)
- Implement graceful degradation if LLM fails

### Phase 4: Documentation & Cleanup (Priority: High)
- Update CLAUDE.md
- Update README.md
- Remove any `--github-release` flag code or documentation
- Add workflow usage guide with LLM features
- Document OPENAI_API_KEY secret setup

### Phase 5: Testing & Validation (Priority: Critical)
- Test workflow with dummy version bump
- Validate CHANGELOG parsing
- Test LLM integration with mock commits
- Verify release notes formatting and categorization
- Test fallback scenarios (LLM failure, missing CHANGELOG)
- Dry-run validation script

## Alternative Approaches Considered

1. **Manual GitHub CLI in `brat release`**
   - Rejected: Still requires push before release creation
   - Adds complexity to local workflow
   - Breaks if user doesn't have gh CLI configured

2. **Post-merge hook via git hooks**
   - Rejected: Not portable across team members
   - Harder to maintain and debug
   - Less visible than CI/CD

3. **Separate manual release command**
   - Rejected: Adds manual step prone to forgetting
   - GitHub Actions automation is more reliable

## Success Criteria

1. When a PR is merged to `main` with a version bump:
   - GitHub Release is automatically created
   - Release has correct version tag (e.g., `v0.11.0`)
   - Release notes are LLM-enhanced with:
     - "Highlights" section (AI-generated summary)
     - Categorized changes (Features, Fixes, Breaking Changes)
     - Clean markdown formatting
   - Falls back to CHANGELOG extraction if LLM fails
   - No manual intervention required

2. When a PR is merged without version bump:
   - No release is created
   - Workflow completes successfully (no false failures)

3. LLM Integration:
   - Uses GPT-4o-mini for fast, cost-effective generation
   - Handles API failures gracefully (degrades to basic extraction)
   - Parses git commits intelligently
   - Produces consistent, professional release notes
   - OPENAI_API_KEY secret configured in GitHub

4. Documentation is clear and accurate:
   - No references to `--github-release` flag
   - Clear explanation of automated release process
   - Documents LLM enhancement feature
   - Explains secret configuration
   - Developer workflow is intuitive

5. Validation:
   - `validate_deliverable.sh` includes workflow validation
   - Workflow syntax is valid
   - Scripts are tested and working
   - LLM integration tested with mocked responses

## Dependencies

- GitHub Actions runner (ubuntu-latest)
- Node.js 24+ (for LLM script execution)
- GitHub CLI (`gh`) for release creation
- OpenAI API access (GPT-4o-mini model)
- `OPENAI_API_KEY` GitHub secret
- Bash for helper scripts
- git for version comparison and log parsing

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Workflow fails silently | High | Add explicit error handling and notifications |
| CHANGELOG format changes | Medium | Robust parsing with fallback to generic message |
| Duplicate releases | Low | Check if tag exists before creating |
| Permissions issues | Medium | Use `GITHUB_TOKEN` with appropriate permissions |

## Timeline Estimate

- Phase 1: Core Workflow - 45 minutes
- Phase 2: LLM Integration - 60 minutes
- Phase 3: Release Creation - 45 minutes
- Phase 4: Documentation - 30 minutes
- Phase 5: Testing & Validation - 60 minutes
- **Total**: ~4 hours

## Open Questions

1. Should the workflow create a draft release for manual review, or publish immediately?
   - **Recommendation**: Publish immediately (trust the merge to main)

2. Should we support creating releases for hotfix branches?
   - **Recommendation**: No, only `main` for now (can extend later)

3. Should the git tag be annotated or lightweight?
   - **Recommendation**: Annotated tags with LLM-generated release notes

4. What happens if CHANGELOG.md has no entry for the version?
   - **Recommendation**: Use LLM to generate release notes from git commits (intelligent fallback)

5. Which LLM model should we use?
   - **Recommendation**: GPT-4o-mini (fast, cost-effective, good quality for summaries)
   - Fallback: Could use gpt-3.5-turbo if 4o-mini unavailable

6. What structure should LLM-generated notes follow?
   - **Recommendation**:
     ```markdown
     ## Highlights
     [AI-generated 2-3 sentence summary]

     ## What's New
     ### Features
     - [Feature 1]
     - [Feature 2]

     ### Fixes
     - [Fix 1]
     - [Fix 2]

     ### Breaking Changes
     - [Breaking change if any]
     ```

7. Should we always use LLM, or only as fallback?
   - **Recommendation**: Always enhance with LLM "Highlights" section, even if CHANGELOG exists
   - Full LLM generation only if CHANGELOG missing

## Approval

- [ ] User approves implementation approach
- [ ] User approves GitHub Actions strategy
- [ ] User approves documentation updates
- [ ] Ready to proceed with implementation
