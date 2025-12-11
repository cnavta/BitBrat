- Prompt: "Update documentation to specify that a Firestore onSnapshot listener must reload the regex cache on any change."
- Interpretation: Amend Technical Architecture, Implementation Plan acceptance/testing, and Backlog to explicitly require an onSnapshot listener on the regex commands query; document initial load, error handling/backoff, and observability; add P0 backlog item.
- Shell/Git:
  - git add planning/sprint-126-d5a6ce/technical-architecture.md \
            planning/sprint-126-d5a6ce/implementation-plan-impl.md \
            planning/sprint-126-d5a6ce/backlog.yaml \
            planning/sprint-126-d5a6ce/request-log.md
  - git commit -m "sprint-126: docs—mandate Firestore onSnapshot for regex cache; update plan acceptance/testing and backlog"
- Files touched:
  - planning/sprint-126-d5a6ce/technical-architecture.md
  - planning/sprint-126-d5a6ce/implementation-plan-impl.md
  - planning/sprint-126-d5a6ce/backlog.yaml
  - planning/sprint-126-d5a6ce/request-log.md


## 2025-12-11T21:20:00Z – Begin implementation (repo + processor + regex cache)
- Prompt: "Plan approved, begin implementation please!"
- Interpretation: Implement simplified matching per TA: command-path by matchType (values, priority) using ALLOWED_SIGILS, with regex fallback via live Firestore onSnapshot cache.
- Shell/Git:
  - npm run build
  - npm test (observed failing legacy tests relying on sigilOptional/termLocation/alias)
- Files touched:
  - src/services/command-processor/command-repo.ts — add findFirstByCommandTerm(), normalize vNext; remove legacy fields in normalization
  - src/services/command-processor/processor.ts — two-stage matching (command→regex), parse with ALLOWED_SIGILS, standardized annotation/candidate payload
  - src/services/command-processor/regex-cache.ts — new live cache with Firestore onSnapshot for matchType.kind=='regex'
  - src/apps/command-processor-service.ts — start regex cache at startup; wire repoFindFirstByCommandTerm
- Notes:
  - Build succeeded. Several tests fail due to intentional removal of sigilOptional/termLocation behaviors; will align tests in follow-up.

## 2025-12-11T01:32:00Z – Backlog and sprint status update
- Prompt: "Continue, and please make sure the backlog is up to date"
- Interpretation: Reflect current implementation state in backlog; move sprint from planning to in-progress; add explicit task for migrating legacy tests to vNext semantics.
- Shell/Git:
  - git add planning/sprint-126-d5a6ce/backlog.yaml \
            planning/sprint-126-d5a6ce/sprint-manifest.yaml \
            planning/sprint-126-d5a6ce/request-log.md
  - git commit -m "sprint-126: update backlog statuses to reflect implementation; set sprint in-progress; add test-migration item"
- Files touched:
  - planning/sprint-126-d5a6ce/backlog.yaml — marked CPvNext-001/002/004/005/006/013/015 as done; CPvNext-003/008 as in-progress; added CPvNext-016 for legacy test migration; refreshed generatedAt
  - planning/sprint-126-d5a6ce/sprint-manifest.yaml — status: in-progress
  - planning/sprint-126-d5a6ce/request-log.md — this entry
