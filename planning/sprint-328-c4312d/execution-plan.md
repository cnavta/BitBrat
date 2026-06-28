# Execution Plan – sprint-328-c4312d (Just-in-Time Context Provisioning for MCP Tools & Tasks)

- **Sprint:** sprint-328-c4312d
- **Title:** Just-in-Time Context Provisioning for MCP Tools & Tasks (Context Packs)
- **Owner / Role:** Lead Implementor (AGENTS.md §10)
- **Date:** 2026-06-28
- **Branch:** `feature/sprint-328-c4312d-tool-context-provisioning`
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 precedence) + `AGENTS.md`
- **Source design:** `documentation/architecture/tool-context-provisioning.md` (ADR / Proposal; §6 phases P0–P4)
- **Companion backlog:** `planning/sprint-328-c4312d/backlog.yaml` (BL-328-001 … BL-328-500)
- **Status:** PLANNING — **awaiting owner approval**. Per **AGENTS.md Rule S1 / §2.4** no implementation
  begins until the owner approves this plan + the backlog and says **"Start sprint."** (The sprint
  directory and feature branch have been scaffolded as part of sprint start; no production code is changed yet.)

---

## 1. Objective

Give every BitBrat service a consistent, low-drift way to say *"here is what you need to know to use me
correctly"* — and have the agent pay for that context **only when** the service's tool or task is actually
in play. Concretely: introduce a **Context Pack / Context Provider / binding** convention under
`src/common/context/`, surface packs to tool-using agents as **MCP Resources**, inject them
**just-in-time** through the existing **prompt-assembly** layer (priority-ordered, de-duplicated), and
**generate** the shared `InternalEventV2` and JsonLogic packs from the source of truth with drift-guard tests.

End state (observable):
- A `create_schedule` agent turn receives the `schema.internal-event-v2` pack and can correctly express
  "schedule a prompt in 5 minutes" as an `InternalEventV2` (`type: llm.request.v1` + an `AnnotationV1` of
  `kind: prompt`) — not by guessing.
- A `create_rule` agent turn receives the `router.jsonlogic-guide` pack (EvalContext paths + custom ops).
- Shared packs are included **once** per turn (de-duped) and rendered uniformly via `NamedContext`.
- Schema/JsonLogic packs are generated from `src/types/events.ts` / `jsonlogic-evaluator.ts`; a drift test
  fails if a documented field/operator no longer exists.

---

## 2. Problem Statement / Why

An MCP tool contract (`name` + one-line `description` + Zod/JSON schema) is *structurally* complete but
*semantically* starved: it says **what fields exist**, not **what the platform means by them**
(ADR §1). The same hidden `InternalEventV2` contract underpins three surfaces:

- **Scheduler** (`src/apps/scheduler-service.ts`, `create_schedule` / `EventDefinitionSchema`): the agent
  isn't told a "prompt" is an `AnnotationV1` of `kind: 'prompt'`, that the driving event is typically
  `type: 'llm.request.v1'`, or that `annotations` is a typed array — so "schedule a prompt" is unanswerable
  without guessing.
- **Event Router** (`src/apps/event-router-service.ts`, `create_rule`, `logic` is a JsonLogic string): the
  agent is told nothing about the evaluation context (`buildContext` in
  `src/services/router/jsonlogic-evaluator.ts`) or the custom ops (`ci_eq`, `re_test`, `slip_complete`,
  `has_role`, `has_annotation`, `has_candidate`, `text_contains`).
- **Enrichment** (`src/services/auth/enrichment.ts`): mutating `identity.*` / annotations needs the
  `Identity` / `AnnotationV1` contracts in front of the agent.

**Why now:** the gap is a missing **convention**, not missing infra — BitBrat already has MCP
resource/prompt primitives, a priority-ordered prompt-assembly layer, and a planned RAG substrate. This
sprint wires them together (ADR §4–§5).

> **Note on ADR file citations:** the ADR references `src/common/mcp-server.ts` for
> `registerResource`/`registerPrompt`. Post-sprint-324 (the Bit model) these primitives live on the **Bit**
> base abstraction in `src/common/base-server.ts` (registry contract in `src/types/tools.ts`); `mcp-server.ts`
> is a thin compat shim. The plan targets the real, current locations.

---

## 3. Guiding Constraints & Design Goals (ADR §2)

| # | Goal | How this plan honors it |
|---|------|--------------------------|
| G1 | Relevance-gated | Bindings keyed by tool / task-stage / eventType; packs pulled only for the active set (P2). |
| G2 | Single source of truth | Schema & JsonLogic packs **generated** from `events.ts` / `jsonlogic-evaluator.ts` (P3); no hand-copied schema in prod paths (Law #2). |
| G3 | Token-aware | De-dupe shared packs; render through prompt-assembly priority truncation; bind narrowly. |
| G4 | Service-owned, platform-consistent | Each service authors a `ContextProvider`; the platform renders uniformly via `NamedContext`. |
| G5 | Composable | One mechanism for MCP tools **and** internal task pipelines (routing/enrichment). |
| G6 | Versioned & traceable | Each pack carries `version` + `source` provenance. |

Hard constraints:
- **Law #2 / canonical:** `architecture.yaml` is authoritative. Pack advertisement over
  `INTERNAL_MCP_REGISTRATION_V1` (P2) must be **additive** and respect envelope/topic versioning rules.
- **No `./deprecated` dependence** (Immutable Law #4).
- **Behavior-preserving by default:** when no packs are bound, prompt assembly and tool turns behave
  exactly as today. Full suite stays green at every phase boundary.
- **WIP limit = 3** (backlog).

---

## 4. Scope

**In scope**
- `src/common/context/` — `ContextPack`, `ContextBinding`, `ContextProvider` types + a binding index/resolver + de-dup.
- `registerToolWithContext(tool, packIds[])` helper alongside the existing tool registration on the Bit.
- Two generated packs: `schema.internal-event-v2` (from `events.ts`) and `router.jsonlogic-guide` (from `jsonlogic-evaluator.ts`) + drift-guard tests.
- Service wiring: scheduler (`create_schedule`), event-router (`create_rule`), and the enrichment task binding.
- MCP **Resource** exposure of packs (stable `context://…` URIs) and additive advertisement of packs/bindings on `INTERNAL_MCP_REGISTRATION_V1`.
- JIT resolution + de-dup + `NamedContext` rendering at the tool-gateway / `McpBridge` turn-build and the bot's task prompt build.
- Tests (unit + integration) and `validate_deliverable.sh`.

**Out of scope (this sprint)**
- **P4 RAG scale-out** (Firestore persistence + embedding retrieval of packs): **design-only / deferred**
  by default — reuses `mcp-evolution-roadmap.md` Phase 2 substrate, pulled in only if the owner asks.
- Domain/business logic changes beyond binding packs to existing tools/tasks.
- New agent-facing tools beyond optional pack exposure.
- Any rename/removal of existing schema or topic versions.

---

## 5. Deliverables (mapped to ADR phases §6)

- **P0 – Quick win:** Enrich `create_schedule` / `create_rule` descriptions; register MCP **Resources**
  `context://schema/internal-event-v2` and `context://router/jsonlogic-guide` on scheduler & event-router.
  *(BL-328-001, -002, -003)*
- **P1 – Convention:** `src/common/context/` (`ContextPack`/`ContextBinding`/`ContextProvider` + index) and
  `registerToolWithContext`; bind packs to the two tools. *(BL-328-100, -101, -102)*
- **P2 – JIT assembly:** Resolve + de-dupe bound packs in `tool-gateway` / `McpBridge`; render via
  prompt-assembly `NamedContext`; bind enrichment/routing **task** packs; extend
  `INTERNAL_MCP_REGISTRATION_V1` (additively) to advertise packs/bindings. *(BL-328-200, -201, -202)*
- **P3 – Generated + drift-guarded:** Generate `schema.internal-event-v2` from `events.ts` and
  `router.jsonlogic-guide` from `jsonlogic-evaluator.ts`; add drift tests asserting referenced
  paths/operators still exist. *(BL-328-300, -301, -302)*
- **P4 – RAG scale-out (deferred/design-only):** ADR note + interface seam so packs can later be persisted
  and embedded in Firestore and retrieved top-N. *(BL-328-400)*
- **Validation / close-out:** `validate_deliverable.sh`, accuracy/drift parity check, verification &
  publication. *(BL-328-500, -501, -502)*

---

## 6. Acceptance Criteria (sprint-level)

- A `create_schedule` turn resolves "schedule a prompt 5 minutes from now" to a correct schedule time plus a
  well-formed `event.annotations[]` (`kind: prompt`) without the agent guessing the `InternalEventV2` shape
  (demonstrated by a test that asserts the pack is injected for that turn).
- A `create_rule` turn receives the JsonLogic guide pack listing the real EvalContext paths and the 7 custom
  ops (verified against `jsonlogic-evaluator.ts`).
- Shared `schema.internal-event-v2` is injected **once** when multiple bound tools/tasks are active (de-dup test).
- Generated packs derive from source; a deliberately mutated field path/operator makes the drift test fail.
- No regression: full suite green; with no bindings, prompt assembly + tool turns are byte-for-byte unchanged.
- All packs carry `id`, `version`, `source`, `priority`, `format`.

---

## 7. Testing Strategy (AGENTS.md §5, Jest)

- **Unit:** context types + binding resolver (match by tool/task/eventType), de-dup, pack→`NamedContext`
  mapping, `registerToolWithContext` recording bindings, generators emit expected fields/ops.
- **Drift guards:** tests asserting every field path the schema pack references exists in `InternalEventV2`
  and every operator the router pack lists is registered in `jsonlogic-evaluator.ts` (fail on drift).
- **Integration:** tool-gateway / `McpBridge` turn-build resolves + de-dupes bound packs and emits
  `NamedContext`s; scheduler/event-router register the expected Resources; registration-event advertises
  packs/bindings (additive, back-compat parse).
- **Negative/edge:** unknown pack id in a binding, no bindings (no-op), oversized packs truncated by the
  assembler's priority logic, duplicate ids collapsed.
- External deps mocked; no live Firestore (P4 deferred).

---

## 8. Validation (AGENTS.md §2.6 — `validate_deliverable.sh`)

`planning/sprint-328-c4312d/validate_deliverable.sh` (real, idempotent, logically passable):
1. `npm ci` (or `npm install` fallback, logged).
2. `npm run build` — production + test code compiles.
3. `npm test` — full suite incl. new context + drift tests.
4. `npm run release:dry -- patch` — assert `architecture.yaml` / `package.json` / `package-lock.json`
   version agreement (AGENTS.md §2.6); no mutation.
5. Log any missing-tool fallbacks; exit non-zero on build/test failure.

---

## 9. Deployment Approach

No new runtime services. Changes are library/convention-level (`src/common/context/`), service-wiring, and
an **additive** registration-event field. Existing build (`Dockerfile.service` + `architecture.yaml`-derived
build args) and deployment targets (GCP Cloud Run, local Docker, remote Docker) are unaffected. Any
`architecture.yaml` touch (topic/registration note) is additive and re-validated via `brat config validate`.

---

## 10. Dependencies

- Internal: `src/types/events.ts`, `src/common/prompt-assembly/*`, `src/common/base-server.ts` +
  `src/types/tools.ts`, `src/common/mcp/*`, `src/apps/tool-gateway.ts`, `src/apps/scheduler-service.ts`,
  `src/apps/event-router-service.ts`, `src/services/router/jsonlogic-evaluator.ts`,
  `src/services/auth/enrichment.ts`.
- Tooling (P3): a Zod/TS→JSON-Schema path (`zod-to-json-schema` or `ts-json-schema-generator`) **or** a
  curated-Markdown generator — choose the lightest option that avoids a heavy new dependency (decision in BL-328-300).
- External (P4 only, deferred): Firestore + vector search (`mcp-evolution-roadmap.md` Phase 2).

---

## 11. Risks & Mitigations (ADR §7)

- **Drift (primary):** hand-written packs rot → P3 generation + drift tests are **non-optional** for the schema pack.
- **Over-injection:** binding too broadly recreates "everything in the prompt" → bind narrowly per
  tool/task/eventType; measure; widen only with evidence.
- **Token budget:** mitigated by relevance-gating + de-dup + assembler priority truncation; keep packs short
  (curated Markdown over raw JSON Schema dumps).
- **Registration-event compatibility:** packs/bindings advertised **additively**; older consumers ignore
  unknown fields (envelope/topic versioning rules).
- **Latency (P4):** deferred; gate any future RAG behind a binding-set size threshold + embedding cache.

---

## 12. Definition of Done (AGENTS.md §3)

- Project-wide DoD met: code adheres to `architecture.yaml`; no TODOs/placeholders in prod paths; tests for
  all new behavior; `npm run build` + `npm test` pass; docs/rationale updated; every change traces to a
  BL-328-NNN item + a `request-log.md` entry.
- `validate_deliverable.sh` present and logically passable.
- Verification, retro, key-learnings authored; branch pushed; PR attempted and recorded (Rules S12/S13).
- Owner says **"Sprint complete."** (or **"Force complete sprint."**) (Rule S2).

---

## 13. Planning Gate

This plan + `backlog.yaml` are the **input** to the sprint. **No implementation code is written until the
owner approves and says "Start sprint"** (Rule S1, AGENTS.md §2.4). Open question for the owner:
**Is P4 (Firestore/RAG scale-out) in scope this sprint, or deferred/design-only?** Plan of Record:
**deferred / design-only** unless the owner pulls it in.
