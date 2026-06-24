# Deliverable Verification – sprint-320-1cc8aa (image-gen-mcp Prompt Logging)

- **Role:** Lead Implementor
- **Date:** 2026-06-23
- **Source of truth:** `documentation/technical-architecture/image-gen-mcp-prompt-logging.md`
- **Backlog:** `planning/sprint-320-1cc8aa/backlog.yaml`

## Completed

- [x] **BL-001** — Private `logPrompt(...)` helper added to `ImageGenMcpServer`
  (`src/services/image-gen-mcp/index.ts`): flag-gated on `llm.promptLogging.enabled`, fire-and-forget
  `getFirestore().collection('services').doc('image-gen-mcp').collection('prompt_logs').add(...)`,
  `redactText` on `prompt`/`response`/`error`, `platform: 'openai'`, `createdAt: new Date()`, guarded
  by `try/catch` + `.catch()` warning `image_gen_mcp.prompt_logging_failed`. Imports added.
- [x] **BL-002** — `correlationId` resolved from `extra._meta?.correlationId` else `uuidv4()`; `userId`
  from `extra._meta`/`extra.userId` (`anonymous` fallback); single `start = Date.now()` for
  `processingTimeMs`. No MCP tool-contract change.
- [x] **BL-003** — Success call site (`status: 'success'`, `response = publicUrl`, populated
  `image`/`moderation`, `aspectRatio`/`size`/`processingTimeMs`); success payload unchanged.
- [x] **BL-004** — Moderation-rejection call site (`status: 'rejected'`,
  `moderation = { flagged: true, categories }`, `response = 'moderation_rejected'`, no `image`);
  rejection payload unchanged.
- [x] **BL-005** — Error call site in the handler `catch` (`status: 'error'`, redacted `error`,
  `response = 'error'`); error payload unchanged.
- [x] **BL-006** — `tests/services/image-gen-mcp/prompt-logging.test.ts` (5 cases: flag off, success,
  moderation rejection, error, fail-soft). All external deps mocked; **5/5 pass**.
- [x] **BL-007** — `documentation/services/image-gen-mcp.md` with an Observability / Prompt Logging
  section (storage path, field schema, `FF_LLM_PROMPT_LOGGING`, three outcomes), cross-linking the TA.

## Validation Evidence

- `npm run build` (tsc) — **clean**.
- `tests/services/image-gen-mcp/prompt-logging.test.ts` — **5/5 pass**.
- Regression: `tests/services/llm-bot/prompt-logging.test.ts` + `tests/services/query-analyzer/llm-provider.test.ts`
  — **11/11 pass**.
- `planning/sprint-320-1cc8aa/validate_deliverable.sh` — **exit 0** (Gate G4 logically passable per AGENTS.md §2.6).
- Backup exclusion (TA §6): `prompt_logs` is excluded by collection name from the `brat backup`
  registry — the new `services/image-gen-mcp/prompt_logs` sub-collection needs **no change**.

## Completed (close-out)

- [x] **BL-008** — Validation harness delivered and passing; on "Sprint complete" the close-out
  artifacts (`retro.md`, `key-learnings.md`, `publication.yaml`) were produced, the feature branch was
  committed and pushed, and a GitHub PR was opened (URL recorded in `publication.yaml` and the manifest).
  Sprint status set to `complete`.

## Additional work on this branch (outside the original sprint scope)

- [x] **tool-gateway SSE reconnect storm** — standalone remediation completed on this feature branch:
  `McpClientManager.connectServer` made idempotent via a `connectionSignature(...)` guard so volatile
  Firestore registry rewrites no longer churn healthy SSE connections. Covered by two new cases in
  `tests/common/mcp/reconnect.spec.ts`; `tests/common/mcp` 44/44 green. Included in this PR for delivery.

## Deferred

- End-to-end propagation of a real `correlationId` through the MCP `_meta` (noted as a follow-up in
  TA §5.4) — out of scope for this sprint.

## Alignment Notes

- No new feature flag, collection family, `architecture.yaml`, or `firestore.rules` change — the
  existing `llm.promptLogging.enabled` flag and `prompt_logs` exclusion are reused, exactly as the TA
  specified.
- `userId` resolution was widened to also read `extra._meta?.userId` (TA §5.2) while preserving the
  existing `extra.userId` fallback; behavior for existing callers is unchanged.
