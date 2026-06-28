# Request Log – sprint-328-c4312d (Just-in-Time Context Provisioning / Context Packs)

Per AGENTS.md §2.5, every meaningful prompt, interpretation, and the shell/git/file
operations it triggered are logged here. Code changes trace back to a BL-328-NNN item.

---

## REQ-001 — 2026-06-28 — Sprint start (planning deliverables)
- **Prompt:** "We are starting a new sprint … create an Execution Plan and Trackable Prioritized YAML Backlog."
- **Interpretation:** Open sprint-328 as Lead Implementor; produce execution-plan.md + backlog.yaml; pause at planning gate (Rule S1).
- **Actions:**
  - Closed the still-active sprint-327 (status → complete) to satisfy Rule S3.
  - `git checkout -b feature/sprint-328-c4312d-tool-context-provisioning`.
  - Created `planning/sprint-328-c4312d/{sprint-manifest.yaml,execution-plan.md,implementation-plan.md,backlog.yaml,request-log.md}`.
- **Result:** Planning deliverables authored; no production code changed.

## REQ-002 — 2026-06-28 — "Documentation approved. Start sprint."
- **Prompt:** "Documentation approved. Start sprint. Be sure to keep backlog item statuses up to date as they change."
- **Interpretation:** Owner approved execution-plan.md + backlog.yaml and authorized implementation (Rule S1).
  Begin implementing the ADR phases P0–P3 (P4 deferred/design-only); update backlog item `status` as work progresses.
- **Actions (this entry, ongoing):**
  - Flipped `sprint-manifest.yaml` status `planning` → `in-progress` and `backlog.yaml` meta status `planning` → `in_progress`.
  - Verified the real source-of-truth seams in-repo before coding:
    - `src/types/events.ts` — `InternalEventV2`, `AnnotationV1`, `AnnotationKindV1` (incl. `prompt`), `INTERNAL_MCP_REGISTRATION_V1`.
    - `src/common/base-server.ts` — `registerTool(name,desc,schema,handler,{scopes})`, `registerResource(uri,name,desc,handler)`, `publishRegistration()` payload, discovery handlers.
    - `src/common/prompt-assembly/types.ts` — `Priority (1..5)`, `NamedContext`.
    - `src/services/router/jsonlogic-evaluator.ts` — `buildContext`/`EvalContext` + 7 custom ops.
    - `src/apps/scheduler-service.ts` (`create_schedule`) and `src/apps/event-router-service.ts` (`create_rule`).
- **Result:** Sprint active; implementation in progress (see per-item log entries below as they are completed).

## REQ-003 — 2026-06-28 — Implementation + validation + close-out
- **Interpretation:** Deliver ADR phases P0–P3 (P4 design-only); keep backlog statuses current.
- **Files created:** `src/common/context/{types,resolver,named-context,provider,packs,index}.ts`;
  `tests/common/context/{context-resolver,context-packs-drift}.spec.ts`; `tests/apps/context-provisioning.spec.ts`;
  `planning/sprint-328-c4312d/{validate_deliverable.sh,verification-report.md,retro.md,key-learnings.md,publication.yaml}`.
- **Files modified:** `src/common/base-server.ts` (context registration + introspection APIs + additive
  `payload.context` advertisement); `src/types/events.ts` (`ANNOTATION_KINDS_V1`); `src/services/router/jsonlogic-evaluator.ts`
  (`CUSTOM_OPERATORS` + `EVAL_CONTEXT_PATHS`; `registerOperatorsOnce` iterates the registry); `src/apps/{scheduler-service,
  event-router-service,auth-service,tool-gateway}.ts`; `documentation/architecture/tool-context-provisioning.md` (§6.1);
  `CHANGELOG.md`; backlog + manifest statuses.
- **Commands:** `npm run build` ✅; `npm test` ✅ (1082 passed, 2 skipped, 0 failed); `npm run release:dry -- patch` ✅
  (version parity, no mutation); `git commit` + `git push -u origin feature/sprint-328-c4312d-tool-context-provisioning` ✅.
- **Result:** All P0–P3 items `done`; P4 `done` (design-only). BL-328-502 `blocked` — PR auto-creation unavailable
  (no `gh` CLI / token). Awaiting owner credentials or manual PR + "Sprint complete." (Rules S13/S2). No release cut.

## REQ-004 — 2026-06-28 — Observability: list ContextPacks in llm-bot prompt logging (BL-328-203)
- **Interpretation:** Surface which ContextPacks were included in llm-bot prompt generation, for debugging + analysis.
- **Files modified:** `src/common/context/named-context.ts` (added `ContextPackRef`, `formatPackSubheader`,
  `parsePackSubheader`, `extractContextPacksFromNamedContexts`; `packToNamedContext` now uses the shared formatter);
  `src/services/llm-bot/processor.ts` (compute included packs from `spec.contexts`; `llm_bot.prompt.context_packs`
  log line; `contextPacks[]` field on the `prompt_logs` Firestore doc); `CHANGELOG.md`; `backlog.yaml` (BL-328-203).
- **Files modified (tests):** `tests/common/context/context-resolver.spec.ts` (round-trip + extractor cases);
  `tests/services/llm-bot/prompt-logging.test.ts` (asserts `contextPacks` field).
- **Commands:** `npm run build` ✅; `npx jest tests/common/context src/services/llm-bot` ✅ (94 passed);
  targeted `context-resolver` + `prompt-logging` ✅ (24 passed).
- **Result:** BL-328-203 `done`. Detection is keyed to the pack subheader convention (single source of truth), so
  non-pack contexts (e.g. adventure contexts) are excluded and the list is empty/back-compat when no packs are bound.

## REQ-005 — 2026-06-28 — state-engine propose_mutation false-positive success (BL-328-204)
- **Report:** "Store the fact that I LOVE the band Yes in state." — LLM called the set/mutation tool and the
  prompt log showed no ContextPacks, yet nothing was written to the state engine.
- **Root cause:** `propose_mutation` (src/apps/state-engine.ts) is fire-and-forget: it publishes to
  `internal.state.mutation.v1` and immediately returns "Mutation … proposed". The async consumer
  (`handleMutation`) rejects any key not in `stateConfig.allowedKeys` (`Key not allowed`) and persists
  nothing — so a free-form fact key (outside the allow-list) was silently dropped while the tool reported
  success. ("No ContextPacks" is expected: llm-bot does not yet inject packs into its own prompt path.)
- **Remediation:** pre-validate the key against the same allow-list in the tool handler (before publishing)
  and return an `isError` result listing the allowed namespaces; advertise the namespaces in the tool
  description; add a `user.fact.*` namespace to the default allow-list so personal facts can be stored under
  `user.fact.<userId>.<topic>`.
- **Files modified:** `src/apps/state-engine.ts`; `src/apps/state-engine.test.ts` (3 tests); `CHANGELOG.md`;
  `backlog.yaml` (BL-328-204).
- **Commands:** `npm run build` ✅; `npx jest src/apps/state-engine.test.ts` ✅ (7 passed).
- **Result:** BL-328-204 `done`.
