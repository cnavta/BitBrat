# Deliverable Verification – sprint-328-c4312d (Just-in-Time Context Provisioning / Context Packs)

- **Date:** 2026-06-28
- **Branch:** `feature/sprint-328-c4312d-tool-context-provisioning`
- **Validation:** `planning/sprint-328-c4312d/validate_deliverable.sh` (build → full Jest → release:dry parity → targeted suites).
- **Result:** `npm run build` ✅ · `npm test` ✅ (Test Suites: 279 passed, 1 skipped / 280; Tests: 1082 passed, 2 skipped) · `npm run release:dry -- patch` ✅ (0.7.1 consistent across architecture.yaml / package.json / package-lock.json; would bump → 0.7.2, wrote nothing).

## Completed
- [x] **BL-328-001** — `create_schedule` description enriched (prompt = AnnotationV1 kind `prompt`, driving type `llm.request.v1`); scheduler registers MCP Resource `context://schema/internal-event-v2`.
- [x] **BL-328-002** — `create_rule` `logic` description lists EvalContext paths + 7 custom ops; event-router registers MCP Resource `context://router/jsonlogic-guide`.
- [x] **BL-328-003** — Integration tests assert both Resources are listed + resolve to non-empty bodies and descriptions mention the contract terms (`tests/apps/context-provisioning.spec.ts`).
- [x] **BL-328-100** — `src/common/context/types.ts`: `ContextPack` / `ContextBinding` / `ContextProvider` / `ContextActiveSet` (priority aligned to prompt-assembly `Priority` 1..5).
- [x] **BL-328-101** — `resolveContextPacks(active, providers)` + de-dup + unknown-id warn + empty no-op (`resolver.ts`); unit-tested for match-by-tool/task/eventType, de-dup, unknown-id, empty-set.
- [x] **BL-328-102** — `Bit.registerToolWithContext(name, desc, schema, handler, packIds[], opts?)` + `registerContextPack`/`registerContextBinding`/`getContextProvider`/`listContext*` on `base-server.ts`; scheduler binds `create_schedule → [schema.internal-event-v2]`, event-router binds `create_rule → [router.jsonlogic-guide, schema.internal-event-v2]`. No behavior change when `packIds` empty.
- [x] **BL-328-200** — `packToNamedContext` / `packsToNamedContexts` (`named-context.ts`): markdown body → string, json body → object, priority default 3, order preserved.
- [x] **BL-328-201** — `ToolGatewayServer.resolveContextForTools(toolNames[])`: aggregates per-Bit providers, strips `mcp:` prefix, de-dupes shared pack, returns `NamedContext[]`; `[]` when nothing bound (behavior-preserving). De-dup demonstrated by integration test.
- [x] **BL-328-202** — Task bindings: auth-service binds schema pack to task `enrichment`; event-router adds `routing.create_rule` task binding. `publishRegistration()` advertises `payload.context.{packs,bindings}` **additively** (field omitted entirely when empty); back-compat parse verified by a test feeding a context-less registration.
- [x] **BL-328-300 / -301** — Packs **generated** from source: `schema.internal-event-v2` from `ANNOTATION_KINDS_V1` + field-path specs (events.ts); `router.jsonlogic-guide` from `CUSTOM_OPERATORS` + `EVAL_CONTEXT_PATHS` (jsonlogic-evaluator.ts). Each carries `version` + `source`.
- [x] **BL-328-302** — Drift guards (`tests/common/context/context-packs-drift.spec.ts`): fail if a documented field path is absent from a sample `InternalEventV2`/`AnnotationV1`, or if an operator is documented-but-unregistered / registered-but-omitted; includes negative (fabricated op/path) demonstrations.
- [x] **BL-328-400** — *Design-only:* `resolveContextPacks(providers[])` is the RAG seam (a future Firestore/embedding source just implements `ContextProvider`); recorded in ADR §6.1. No Firestore/embedding code shipped.
- [x] **BL-328-500** — `validate_deliverable.sh` authored (nvm-aware, idempotent, logically passable).
- [x] **BL-328-501** — Parity: generated pack contents grep-verified against source symbols by the drift suite; full suite green; behavior unchanged when no packs bound.

## Generation-path decision (BL-328-300)
Selected the **lightest viable path: a curated-Markdown generator driven by exported source-of-truth
arrays** (`ANNOTATION_KINDS_V1`, `INTERNAL_EVENT_V2_FIELD_PATHS`, `ANNOTATION_V1_FIELD_PATHS`,
`CUSTOM_OPERATORS`, `EVAL_CONTEXT_PATHS`). Rationale: avoids a heavy new dependency, keeps packs short
(token-aware, G3), and still satisfies G2/G6 because the arrays are the single registration source
(`registerOperatorsOnce` now iterates `CUSTOM_OPERATORS`) and drift tests bind packs to them. A
`zod-to-json-schema` dump was rejected as too verbose for a prompt block.

## Alignment notes / additive surface
- New **additive** public Bit API: `registerContextPack`, `registerContextBinding`, `registerToolWithContext`, `listContextPacks`, `listContextBindings`, `getContextProvider`, plus introspection `listToolDescriptors` / `listResourceDescriptors` / `readRegisteredResource`.
- `INTERNAL_MCP_REGISTRATION_V1` gained an **optional** `payload.context` field — additive, omitted when empty; no topic/version mutated; `architecture.yaml` untouched (Law #2).
- `jsonlogic-evaluator.ts` operator registration refactored to iterate `CUSTOM_OPERATORS` — behavior-preserving (52 router/jsonlogic tests green).

## Partial / Deferred
- **P4 RAG scale-out (BL-328-400):** design-only by default; no Firestore/embedding code (owner did not pull P4 into scope). Seam is in place.

## Pre-existing test noise (not introduced by this sprint)
- Some suites emit open-handle warnings / expected error logs (e.g. `client-manager` reconnect timers, discord/twitch login errors in mocked tests). These are pre-existing and the overall run exits 0.
