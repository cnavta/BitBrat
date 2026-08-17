# Implementation Plan – sprint-320-1cc8aa

## Objective
Add **prompt logging to the `image-gen-mcp` service** that follows the same structure and patterns
already in place for `llm-bot` and `query-analyzer`: feature-flag-gated, fire-and-forget writes to
a service-specific Firestore sub-collection (`services/image-gen-mcp/prompt_logs/{logId}`), with
redaction applied and a shared base field set plus image-domain-specific fields.

## Scope

### In scope
- **Task 1 (current):** Author a Technical Architecture document that defines the approach:
  problem statement, the existing llm-bot/query-analyzer pattern being mirrored, the feature flag,
  the Firestore schema/field mapping (text -> image domain), the integration point inside the
  `generate_image` tool handler, the `correlationId` strategy, what to log on success vs.
  moderation-rejection vs. failure, redaction/privacy, access control, performance, testing
  strategy, alternatives, and a phased rollout.
- Future tasks (to be appended per section 2.4.1 once Task 1 is approved): implement the logging in
  `src/services/image-gen-mcp/index.ts`, add unit tests mirroring
  `tests/services/llm-bot/prompt-logging.test.ts`, and update
  `documentation/services/` (add an image-gen-mcp service doc / Observability section).

### Out of scope (for Task 1)
- Writing or modifying any `image-gen-mcp` service code or tests.
- Changes to `architecture.yaml`, `firestore.rules`, `firestore.indexes.json`, or the feature-flags
  manifest (the existing `llm.promptLogging.enabled` flag is reused as-is).
- Performing any real image generation or Firestore writes against a live project.

## Deliverables
- **Task 1:** `documentation/technical-architecture/image-gen-mcp-prompt-logging.md`.
- Sprint protocol artifacts: `sprint-manifest.yaml`, `request-log.md`, `implementation-plan.md`,
  and (at completion) `verification-report.md`, `validate_deliverable.sh`, `publication.yaml`,
  `retro.md`, `key-learnings.md`.

## Acceptance Criteria
- **Task 1:** A reviewed Technical Architecture document exists that:
  - Accurately describes the current llm-bot/query-analyzer prompt-logging pattern (feature flag,
    `services/{service}/prompt_logs` sub-collection, fire-and-forget `.add().catch()`, `redactText`,
    shared base fields).
  - Defines the `image-gen-mcp` Firestore schema, including the mapping of the text-oriented
    `prompt`/`response` fields onto the image domain (prompt text, aspect ratio, size, model,
    resulting GCS URL/object, moderation outcome) plus shared base fields.
  - Specifies the exact integration point in the `generate_image` tool handler and what is logged
    on success, on moderation rejection, and on failure.
  - Defines a `correlationId` strategy for an MCP request/response service (no event-bus envelope).
  - Reuses the existing `llm.promptLogging.enabled` feature flag (no new flag) and is fail-soft
    (logging never affects the tool result).
  - Aligns with `architecture.yaml` (precedence) and AGENTS.md.

## Testing Strategy
- Task 1 is a **documentation deliverable**; validation is structural (Markdown structure/link
  sanity + verification that every referenced collection/file/symbol exists in the repo). No code
  build is required for Task 1 (AGENTS.md §6 documentation note + DoD "non-code tasks").
- Implementation tasks (future) will add real validation: unit tests modeled on
  `tests/services/llm-bot/prompt-logging.test.ts` asserting (a) no write when the flag is off,
  (b) a write to `services/image-gen-mcp/prompt_logs` with redacted fields when on, and
  (c) fail-soft behavior when the Firestore write rejects.

## Deployment Approach
- No deployment for Task 1. `image-gen-mcp` ships via `Dockerfile.service` and runs on Cloud Run;
  the future logging code uses `getFirestore()` (firebase-admin + ADC) consistent with the other
  services, so no new infrastructure is required.

## Dependencies
- `src/common/feature-flags.ts` + `feature-flags.manifest.json` (`llm.promptLogging.enabled`).
- `src/common/firebase.ts` (`getFirestore()`).
- `src/common/prompt-assembly/redaction.ts` (`redactText`).
- Existing reference implementations: `src/services/llm-bot/processor.ts`,
  `src/services/query-analyzer/llm-provider.ts`.

## Definition of Done
- References the project-wide DoD in AGENTS.md §3. For Task 1 (docs-only), "Done" = the TA
  document is authored, internally consistent, accurate to the codebase, and traceable to REQ-001
  in `request-log.md`. Test/build gates apply to the future implementation tasks, not Task 1.

---

## Task Breakdown & Status

1. Sprint scaffolding (reuse branch, manifest, request log, this plan). — DONE
2. **Task 1 (Architect):** Technical Architecture document
   (`documentation/technical-architecture/image-gen-mcp-prompt-logging.md`). — DONE (approved)
3. **Task 2 (Lead Implementor):** Execution Plan (`execution-plan.md`, Phases 0–4 / Gates G0–G4) +
   Trackable Prioritized YAML Backlog (`backlog.yaml`, BL-001 … BL-008). — DONE (approved)
4. **Task 3 (REQ-003):** Implement the `logPrompt(...)` helper + flag gate and the
   success/rejected/error call sites in `src/services/image-gen-mcp/index.ts` (BL-001 … BL-005). — DONE
5. Unit tests modeled on `tests/services/llm-bot/prompt-logging.test.ts` (BL-006). — DONE (5/5 pass)
6. Documentation: image-gen-mcp service doc with an Observability / Prompt Logging
   section (BL-007); `validate_deliverable.sh` wired (BL-008). — DONE
7. Close-out: `verification-report.md` produced; `retro.md`/`key-learnings.md` + PR (BL-008)
   deferred until an explicit "Sprint complete" (Rules S2/S13). — PENDING

> The authoritative, trackable task breakdown lives in `execution-plan.md` and `backlog.yaml`.
