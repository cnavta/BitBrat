# Execution Plan – image-gen-mcp Prompt Logging

- **Sprint:** sprint-320-1cc8aa
- **Role:** Lead Implementor
- **Date:** 2026-06-23
- **Source of truth:** `documentation/technical-architecture/image-gen-mcp-prompt-logging.md` (Status: Proposed)
- **Status:** Awaiting user approval — **no implementation begins until approved.**

## 1. Purpose

Decompose the Technical Architecture (TA) for adding **prompt logging to `image-gen-mcp`** into a
sequenced, gated set of accomplishable tasks, with a companion Trackable Prioritized YAML Backlog
(`backlog.yaml`). The feature persists a structured, feature-flag-gated, fire-and-forget record of
each `generate_image` invocation to `services/image-gen-mcp/prompt_logs/{logId}`, mirroring the
existing `llm-bot` and `query-analyzer` implementations exactly.

This plan operationalizes TA §3 (the pattern being mirrored), §5.1 (storage path), §5.2 (document
schema / text→image field mapping), §5.3 (what to log on success / moderation-rejection / error),
§5.4 (`correlationId` strategy), §5.5 (the `logPrompt(...)` integration point), §6 (security /
redaction), §7 (performance / fail-soft), §8 (testing strategy), and §9 (rollout).

## 2. Guiding Constraints

- **Reuse, don't add (TA §2/§3.1/§10):** the existing canonical flag `llm.promptLogging.enabled`
  (env `FF_LLM_PROMPT_LOGGING`, default `false`) gates the feature. **No new feature flag**, no new
  collection family, no `architecture.yaml` change.
- **Same path & semantics (TA §5.1):** writes go to `services/image-gen-mcp/prompt_logs/{auto-id}`
  via `getFirestore()` using `.add(...)`, **fire-and-forget** (un-awaited `.add().catch(...)`).
- **Fail-soft (TA §7):** logging must never alter, delay materially, or fail the tool result; a
  `try/catch` guards even the synchronous build path and a `.catch()` logs a warning.
- **Redaction (TA §6):** `redactText` is applied to `prompt`, `response`, and `error`; no secrets
  (the OpenAI key) ever enters a log document.
- **Log all three terminal outcomes (TA §5.3):** success, moderation rejection, and error — each
  with the matching `status`.
- **No behavior change (TA §2):** the MCP tool contract, image generation, moderation, and GCS
  persistence are unchanged; logging is purely additive and short-circuits when the flag is off.
- **WIP limit = 3** in-progress items at a time.

## 3. Phases & Gates

### Phase 0 — `logPrompt(...)` helper (flag gate + fail-soft write)
- Add a private `logPrompt(entry)` helper to `ImageGenMcpServer` in
  `src/services/image-gen-mcp/index.ts` (TA §5.5): early-return when
  `isFeatureEnabled('llm.promptLogging.enabled')` is false; otherwise `getFirestore()` →
  `collection('services').doc('image-gen-mcp').collection('prompt_logs').add({...})`.
- Apply `redactText` to `prompt`/`response`/`error`; stamp `platform: 'openai'` and
  `createdAt: new Date()`; wrap in `try/catch` and `.catch(...)` warning
  (`image_gen_mcp.prompt_logging_failed`).
- Add the imports: `getFirestore`, `isFeatureEnabled`, `redactText`.
- **Gate G0:** project builds (`tsc`/`npm run build`); the helper is flag-gated and never throws.

### Phase 1 — correlationId + userId resolution (MCP-specific)
- Resolve `correlationId` per TA §5.4: prefer `extra._meta?.correlationId`, else `uuidv4()`
  (already imported). Resolve `userId` from `extra._meta`/`extra.userId` (`'anonymous'` if absent,
  matching the existing rate-limit logic).
- Establish a single `start = Date.now()` so `processingTimeMs` can be computed for the success
  path.
- **Gate G1:** correlationId/userId are available at every terminal branch with no contract change.

### Phase 2 — Wire the three terminal call sites (success / rejected / error)
- **Success** (TA §5.3.1): after GCS persist, call `logPrompt` with `status: 'success'`,
  `response = publicUrl`, `image = { url, bucket, fileName, contentType: 'image/png' }`,
  `moderation = { flagged: false, categories: [] }`, `aspectRatio`, `size`, `processingTimeMs`.
- **Moderation rejection** (TA §5.3.2): at the flagged branch, `status: 'rejected'`,
  `moderation = { flagged: true, categories }`, `response = 'moderation_rejected'`, no `image`.
- **Error** (TA §5.3.3): in the `catch`, `status: 'error'`, redacted `error`, `response = 'error'`.
- Each call sits **just before** the corresponding `return`/`CallToolResult` (off the critical
  path).
- **Gate G2:** all three branches log the correct `status` + fields when the flag is on; the tool's
  returned `CallToolResult` payloads are byte-for-byte unchanged.

### Phase 3 — Unit tests (modeled on `tests/services/llm-bot/prompt-logging.test.ts`)
- Add `tests/services/image-gen-mcp/prompt-logging.test.ts`, mocking Firestore
  (`getFirestore`), the OpenAI moderation `fetch`, `generateImage`, and GCS (`StorageManager`/
  `file.save`) — no live calls (DoD §5 / TA §8).
- Cases: (a) **flag off** → no Firestore write; (b) **flag on, success** → exactly one write with
  `status: 'success'`, redacted `prompt`, `image.url` set; (c) **flag on, moderation rejection** →
  one write `status: 'rejected'`, `moderation.flagged`; (d) **flag on, error** → one write
  `status: 'error'`, redacted `error`; (e) **fail-soft** → `.add()` rejects yet the tool returns its
  normal result and a warning is logged.
- **Gate G3:** the new suite passes and the existing `image-gen-mcp`/regression suites stay green.

### Phase 4 — Documentation, validation harness & close-out
- Add a service doc `documentation/services/image-gen-mcp.md` (or extend the existing service docs)
  with an **Observability / Prompt Logging** section: storage path, field schema, the
  `FF_LLM_PROMPT_LOGGING` flag, and the three logged outcomes — consistent with
  `documentation/services/query-analyzer.md`.
- Provide/extend `validate_deliverable.sh`: `npm run build` + the relevant Jest suites
  (`prompt-logging` for image-gen-mcp + a llm-bot/query-analyzer regression check); logically
  passable per AGENTS.md §2.6.
- Confirm the backup-exclusion note holds (TA §6): `prompt_logs` is already an excluded prefix in
  the `brat backup` registry, so the new sub-collection needs no change.
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; open PR (`publication.yaml`).
- **Gate G4:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 4. Sequencing & Dependencies (summary)

```
Phase0(G0 logPrompt helper) → Phase1(G1 correlationId/userId)
   → Phase2(G2 success/rejected/error call sites)
   → Phase3(G3 unit tests) → Phase4(G4 docs + validate + close)
```

The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance criteria) lives in
`backlog.yaml` (BL-001 … BL-008).

## 5. Definition of Done (this artifact)
- [x] Architecture doc decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Constraints (flag reuse, fire-and-forget, redaction, fail-soft, three outcomes) explicit.
- [x] Sequencing and gates explicit and reversible.
- [ ] **User approval to begin implementation (pending).**
