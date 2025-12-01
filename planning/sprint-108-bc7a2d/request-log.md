# Request Log — sprint-108-bc7a2d

## 2025-11-30T21:56:30Z
- User said: Start sprint
- Confirmations captured:
  - Sigil: "!" (default)
  - Bot name source: BOT_USERNAME
  - Firestore: collection=commands (root), docId auto; field `name` holds canonical command name
  - Rate limiting: parameterized; defaults overridden via config
  - Routing: advance routing slip; if no next, publish to `egressDestination`
  - Time source: UTC

## 2025-11-30T21:57:00Z
- Git: created feature branch
  - Command: git checkout -b feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-11-30T21:57:10Z
- Created sprint directory and manifest
  - Files: planning/sprint-108-bc7a2d/sprint-manifest.yaml

## 2025-11-30T21:59:00Z
- Authored Technical Architecture for command-processor
  - File: planning/sprint-108-bc7a2d/technical-architecture-command-processor.md

## 2025-11-30T21:59:15Z
- Added validation/verification scaffolding for sprint
  - Files:
    - planning/sprint-108-bc7a2d/validate_deliverable.sh (delegates to repo root)
    - planning/sprint-108-bc7a2d/publication.yaml (stub)

## 2025-11-30T22:01:00Z
- Authored Trackable Backlog for command-processor
  - File: planning/sprint-108-bc7a2d/trackable-backlog.yaml

## 2025-11-30T22:02:00Z
- Added remaining planning stubs
  - Files:
    - planning/sprint-108-bc7a2d/verification-report.md (stub)
    - planning/sprint-108-bc7a2d/retro.md (stub)
    - planning/sprint-108-bc7a2d/key-learnings.md (stub)

## 2025-11-30T22:00:00Z
- Planned git operations (to be executed next):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: Technical Architecture – command-processor service"

## 2025-11-30T22:04:00Z
- Git operations (planning artifacts):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: Trackable Backlog + planning scaffolding for command-processor"

## 2025-11-30T22:15:00Z
- Implemented BB-108-01 (Config/env) and BB-108-02 (Parsing)
  - Files changed:
    - src/types/index.ts (added command-processor config fields)
    - src/common/config.ts (parse COMMAND_SIGIL, BOT_USERNAME, COMMANDS_COLLECTION, defaults)
    - src/services/command-processor/processor.ts (new: V1→V2 normalize, sigil parse, step SKIP)
    - src/apps/command-processor-service.ts (wire processor; advance routing slip)
  - Behavior:
    - Non-command messages marked SKIP; event advanced to next routing step or egressDestination
    - Logs: received, parse.skip/parsed, advance.next/egress/complete

## 2025-11-30T22:18:00Z
- Planning updates:
  - Marked BB-108-01 and BB-108-02 as complete in trackable-backlog.yaml
  - Verification report to be updated after build/tests

## 2025-12-01T04:05:00Z
- Implemented BB-108-03 (Firestore command repository)
  - Files added:
    - src/services/command-processor/command-repo.ts (lookup by name/alias; helpers)
    - tests/services/command-processor/command-repo.spec.ts (unit tests with mocked Firestore API)
  - Behavior:
    - First query by name (==), fallback to aliases (array-contains), both limit(1)
    - Normalizes templates, cooldowns, rateLimit, runtime fields
  - Build & tests:
    - npm run build → OK
    - npm test → 76 passed, 1 skipped (203 tests)

## 2025-12-01T04:07:30Z
- Documentation for indexes
  - Added documentation/firestore/indexes.md outlining required single-field and array-contains indexes

## 2025-12-01T04:08:00Z
- Git operations:
  - git add -A
  - git commit -m "sprint-108-bc7a2d: add Firestore command repository and unit tests; docs for indexes"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T04:22:30Z
- Implemented BB-108-04 (Global cooldown enforcement)
  - Files added/changed:
    - src/services/command-processor/policy.ts (global cooldown transactional check/update)
    - tests/services/command-processor/policy-global-cooldown.spec.ts (unit tests)
  - Behavior:
    - If within cooldown window → blocked (no write)
    - If allowed → updates runtime.lastExecutionAt atomically in Firestore transaction
  - Build & tests:
    - npm run build → OK
    - npm test → 77 passed, 1 skipped (207 tests)

## 2025-12-01T04:23:00Z
- Git operations (BB-108-04):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: implement global cooldown policy with tests (BB-108-04)"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T04:27:30Z
- Implemented BB-108-05 (Per-user cooldown enforcement)
  - Files changed:
    - src/services/command-processor/policy.ts (added per-user cooldown transaction)
    - tests/services/command-processor/policy-user-cooldown.spec.ts (new unit tests)
  - Behavior:
    - Blocks within user window; sets/updates lastExecutionAt when allowed
  - Build & tests:
    - npm run build → OK
    - npm test → 78 passed, 1 skipped (211 tests)

## 2025-12-01T04:28:00Z
- Git operations (BB-108-05):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: add per-user cooldown policy with tests (BB-108-05)"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T04:40:00Z
- Implemented BB-108-06 (Fixed-window rate limiting)
  - Files changed:
    - src/services/command-processor/policy.ts (rate limit helpers and transactional check/update)
    - tests/services/command-processor/policy-rate-limit.spec.ts (unit tests)
  - Behavior:
    - Within a window: allow and increment until count < max; deny when count >= max
    - Rollover: new windowKey starts at window boundary and resets count
  - Build & tests:
    - npm run build → OK
    - npm test → All suites pass; new tests added (policy-rate-limit)

## 2025-12-01T04:41:00Z
- Git operations (BB-108-06):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: implement fixed-window rate limiting with tests (BB-108-06)"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T04:46:00Z
- Implemented BB-108-08 (Minimal template rendering engine) and advanced BB-108-07 (Template selection)
  - Files changed/added:
    - src/services/command-processor/templates.ts (chooseTemplate, buildRenderContext, renderTemplate)
    - tests/services/command-processor/template-selection.spec.ts (unit tests for anti-repeat selection)
    - tests/services/command-processor/template-render.spec.ts (unit tests for variable substitution)
  - Behavior:
    - Rendering supports {{botName}}, {{username}}, {{utcNow}}; unknown placeholders left intact
    - Selection avoids lastUsedTemplateId when possible; falls back safely when only one template exists
  - Build & tests:
    - npm run build → OK
    - npm test → All suites pass; new tests added (template-*)

## 2025-12-01T04:47:00Z
- Git operations (BB-108-08/07):
  - git add -A
  - git commit -m "sprint-108-bc7a2d: add template selection and rendering with unit tests (BB-108-07/08)"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T05:12:00Z
- Implemented full processor pipeline and subscriber updates
  - Files changed/added:
    - src/services/command-processor/processor.ts (processEvent: parse → lookup → policies → choose/render → candidate)
    - src/apps/command-processor-service.ts (log receipt pre-processing; advance routing using processor stepStatus)
    - tests/services/command-processor/processor.spec.ts (happy path, not-found, rate-limit cases)
  - Behavior:
    - Persists lastUsedTemplateId within global cooldown transaction
    - Appends text candidate with default priority 100 and metadata
    - Logs: candidate.added; receipt logged prior to processing
  - Build & tests:
    - npm run build → OK
    - npm test → All suites pass; subscriber test adjusted by pre-processing receipt log

## 2025-12-01T05:14:00Z
- Planning updates:
  - trackable-backlog.yaml: BB-108-07 → complete; BB-108-10/12/13 → in-progress
  - verification-report.md: updated Completed and Partial sections

## 2025-12-01T05:15:00Z
- Git operations:
  - git add -A
  - git commit -m "sprint-108-bc7a2d: wire full command-processor pipeline; add processor tests; fix receipt logging; update planning"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture

## 2025-12-01T06:13:00Z
- Added routing advancement unit tests (BB-108-10)
  - File: tests/services/command-processor/routing-advance.spec.ts
  - Cases: next pending step publishes to nextTopic; egress fallback; no next + no egress logs completion
  - Adjusted test env guards to enable subscription in Jest
  - Result: tests passing

## 2025-12-01T06:15:00Z
- Added error handling ack/nack unit tests (BB-108-11)
  - File: tests/apps/command-processor-error-policy.spec.ts
  - Cases: JSON parse error → ack; publish failure → nack(true)
  - Result: tests passing

## 2025-12-01T06:16:00Z
- Planning updates:
  - trackable-backlog.yaml: BB-108-10 → complete; BB-108-11 → complete
  - verification-report.md: moved BB-108-10/11 to Completed; updated Partial for BB-108-12/13

## 2025-12-01T06:16:30Z
- Git operations:
  - git add -A
  - git commit -m "sprint-108-bc7a2d: add routing advancement and error policy tests; update planning artifacts"
  - git push -u origin feature/sprint-108-bc7a2d-command-processor-architecture
