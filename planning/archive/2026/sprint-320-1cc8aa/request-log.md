# Request Log – sprint-320-1cc8aa

Sprint: image-gen-mcp Prompt Logging
Role: Architect

---

## REQ-001 — Sprint kickoff & Technical Architecture document
- **Timestamp:** 2026-06-23T16:23:00Z
- **Prompt summary:** Start a new sprint (Architect role). Add prompt logging to the
  `image-gen-mcp` service. The prompt logging should follow the same structure and patterns
  currently in place for `llm-bot` and `query-analyzer`. First task: create a Technical
  Architecture document laying out how to accomplish this.
- **Interpretation:** Initialize the sprint per AGENTS.md Sprint Protocol (the user is starting a
  new sprint), then (Task 1 only) author a Technical Architecture document that defines how to add
  feature-flag-gated, fire-and-forget prompt logging to `image-gen-mcp`, reusing the exact
  conventions established by `llm-bot` and `query-analyzer`. Do NOT implement the logging yet —
  implementation, tests, and doc updates are follow-up tasks to be appended to the plan per
  section 2.4.1 once the TA document is approved.
- **Shell/git commands executed:**
  - Verified no active (non-`complete`) sprint manifest exists (Rule S3): sprint-319 is
    `status: complete`; sprint-320 was pre-scaffolded (empty `planning/sprint-320-1cc8aa/`).
  - Reused the pre-created feature branch `feature/sprint-320-1cc8aa-image-gen-prompt-logging`
    (already checked out) for all sprint changes (Rule S11).
  - Surveyed the existing prompt-logging implementation: `src/services/llm-bot/processor.ts`
    (step "6. Prompt Logging"), `src/services/query-analyzer/llm-provider.ts`
    ("Prompt Logging (Fire and forget)"), the flag in `src/common/feature-flags.manifest.json`
    (`llm.promptLogging.enabled` / `FF_LLM_PROMPT_LOGGING`), `src/common/firebase.ts`
    (`getFirestore()`), and `src/common/prompt-assembly/redaction.ts` (`redactText`).
  - Inspected the target service `src/services/image-gen-mcp/index.ts` (`generate_image` tool:
    moderation -> generation -> GCS persist) and `src/common/mcp-server.ts`
    (`McpServer extends BaseServer`; `extra._meta` carries `userId`/`userRoles`).
  - Reviewed service docs (`documentation/services/llm-bot.md`, `query-analyzer.md`) and
    `documentation/technical-architecture/` conventions; used sprint-319 as the structural template.
- **Files created/modified:**
  - `planning/sprint-320-1cc8aa/sprint-manifest.yaml`
  - `planning/sprint-320-1cc8aa/request-log.md` (this file)
  - `planning/sprint-320-1cc8aa/implementation-plan.md`
  - `documentation/technical-architecture/image-gen-mcp-prompt-logging.md` (Technical Architecture
    document — Task 1 deliverable)
- **Notes / findings:**
  - The pattern to mirror exactly: feature-flag gate (`llm.promptLogging.enabled`), fire-and-forget
    write to `services/image-gen-mcp/prompt_logs/{logId}` via `getFirestore()`, `redactText` on
    free-text fields, shared base fields + service-specific fields, fail-soft `.catch()` logging.
  - image-gen-mcp differs from the two LLM services: it is an MCP tool (request/response, not an
    event-bus consumer) and produces an image (URL/GCS object), not LLM text. The TA defines the
    image-domain field mapping (aspectRatio, size, imageUrl, moderation outcome) and a
    `correlationId` strategy (derive from MCP `_meta`, else generate a UUID).
  - The output is an image rather than text, so `response` stores the resulting GCS public URL plus
    a structured `image` object instead of model prose; the `prompt` is the (redacted) user prompt.

---

## REQ-002 — Execution Plan & Trackable Prioritized YAML Backlog
- **Timestamp:** 2026-06-23T16:56:00Z
- **Role:** Lead Implementor
- **Prompt summary:** Assume the role of Lead Implementor. Analyze the attached TA doc
  (`documentation/technical-architecture/image-gen-mcp-prompt-logging.md`) and create an Execution
  Plan and a Trackable Prioritized YAML Backlog breaking the project into accomplishable tasks.
- **Interpretation:** Decompose the (Proposed) TA into a phased, gated execution plan plus a
  companion trackable backlog, using the sprint-319 `execution-plan.md`/`backlog.yaml` as the
  structural template and the attached `planning/backlog-example.yaml` for the backlog schema.
  Implementation remains deferred (AGENTS.md §2.4) — these are planning artifacts pending approval.
- **Files created/modified:**
  - `planning/sprint-320-1cc8aa/execution-plan.md` (Phases 0–4 / Gates G0–G4).
  - `planning/sprint-320-1cc8aa/backlog.yaml` (BL-001 … BL-008, WIP limit 3).
  - `planning/sprint-320-1cc8aa/implementation-plan.md` (task breakdown updated to reference both).
- **Notes / findings:**
  - Phasing: P0 helper + flag gate (BL-001) → correlationId/userId (BL-002) →
    success/rejected/error call sites (BL-003/004/005) → unit tests (BL-006) → docs +
    validate + close-out (BL-007/008).
  - Confirmed the reference test `tests/services/llm-bot/prompt-logging.test.ts` exists and that no
    `image-gen-mcp` test dir or `documentation/services/image-gen-mcp.md` exists yet, so the test
    suite and the service doc are net-new deliverables (BL-006 / BL-007).
  - No new feature flag, collection family, or `architecture.yaml`/`firestore.rules` change is
    required; the existing `llm.promptLogging.enabled` flag and `prompt_logs` backup-exclusion are
    reused as-is.

---

## REQ-003 — Begin implementation (approved)
- **Timestamp:** 2026-06-23T17:01:00Z
- **Role:** Lead Implementor
- **Prompt summary:** "Documentation approved. Please begin implementation, being sure to keep
  backlog item statuses up to date as they change."
- **Interpretation:** Implement BL-001 … BL-008 from `backlog.yaml`, mirroring the llm-bot /
  query-analyzer prompt-logging pattern, updating backlog statuses as work progresses.
- **Shell/git commands executed:**
  - `npm run build` (tsc) — clean.
  - `npx jest tests/services/image-gen-mcp/prompt-logging.test.ts` — 5/5 pass.
  - `npx jest tests/services/llm-bot/prompt-logging.test.ts tests/services/query-analyzer` — 11/11 pass (regression).
  - `bash planning/sprint-320-1cc8aa/validate_deliverable.sh` — exit 0 (build + suites green).
- **Files created/modified:**
  - `src/services/image-gen-mcp/index.ts` — added imports (`getFirestore`, `isFeatureEnabled`,
    `redactText`), `correlationId`/`userId`/`start` resolution, a private `logPrompt(...)` helper,
    and the success/rejected/error call sites (BL-001 … BL-005).
  - `tests/services/image-gen-mcp/prompt-logging.test.ts` — new suite (BL-006).
  - `documentation/services/image-gen-mcp.md` — new service doc with Observability / Prompt Logging (BL-007).
  - `planning/sprint-320-1cc8aa/validate_deliverable.sh` — new validation harness (BL-008).
  - `planning/sprint-320-1cc8aa/backlog.yaml` — BL-001…BL-007 `done`, BL-008 `in_progress`.
  - `planning/sprint-320-1cc8aa/sprint-manifest.yaml` — status `planning` → `in-progress`.
  - `planning/sprint-320-1cc8aa/verification-report.md` — new.
- **Notes / findings:**
  - `executeTool(name, args)` invokes the tool handler with no `extra`, so tests run as
    `userId: 'anonymous'` (rate limit bypassed); `correlationId` falls back to `uuidv4()`.
  - Fixed a test-isolation footgun: `jest.clearAllMocks()` preserves mock implementations, so the
    passthrough `redactText` impl is restored in `beforeEach`.
  - No `architecture.yaml` / `firestore.rules` / feature-flag / backup-registry change required.
  - PR creation and retro/key-learnings close-out are deferred until an explicit "Sprint complete"
    (Rules S2/S13); the sprint remains open and in-progress.

---

## REQ-004 — Sprint complete (close-out & publication)

- **Timestamp:** 2026-06-23T19:11 (local)
- **Prompt summary:** "Sprint complete."
- **Interpretation:** Close sprint-320 per AGENTS.md §2.9: confirm the deliverable is logically
  passable, produce the close-out artifacts, commit + push the feature branch, open a GitHub PR,
  record the PR in `publication.yaml` + the manifest, and set the sprint `complete`.
- **Shell/git commands executed:**
  - `bash planning/sprint-320-1cc8aa/validate_deliverable.sh` — exit 0 (build clean; image-gen 5/5;
    llm-bot/query-analyzer regression 11/11).
  - `git add -A && git commit` (sprint-320 deliverables + close-out) — see PR.
  - `git push -u origin feature/sprint-320-1cc8aa-image-gen-prompt-logging`.
  - `gh pr create ...` — PR opened; URL recorded in `publication.yaml`.
- **Files created/modified:**
  - `planning/sprint-320-1cc8aa/retro.md` — new.
  - `planning/sprint-320-1cc8aa/key-learnings.md` — new.
  - `planning/sprint-320-1cc8aa/publication.yaml` — new (PR URL).
  - `planning/sprint-320-1cc8aa/backlog.yaml` — BL-008 `done`.
  - `planning/sprint-320-1cc8aa/verification-report.md` — close-out + branch-extra note.
  - `planning/sprint-320-1cc8aa/sprint-manifest.yaml` — status `in-progress` → `complete`; `pr` link.
- **Notes / findings:**
  - The feature branch also carries a standalone tool-gateway SSE reconnect-storm remediation
    (`src/common/mcp/client-manager.ts`, `tests/common/mcp/reconnect.spec.ts`) and a local
    `env/local/global.yaml` change enabling `FF_LLM_PROMPT_LOGGING`/`ENABLE_EVENT_RESPONSES`; both are
    included in this PR and documented in `retro.md` / `verification-report.md`.

---
