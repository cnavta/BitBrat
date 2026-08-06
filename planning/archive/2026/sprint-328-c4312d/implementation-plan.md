# Implementation Plan – sprint-328-c4312d (Just-in-Time Context Provisioning for MCP Tools & Tasks)

> This plan is the sprint-local pointer to the owner-facing planning artifacts:
> - **Execution plan:** `planning/sprint-328-c4312d/execution-plan.md` (the authoritative, detailed plan)
> - **Backlog:** `planning/sprint-328-c4312d/backlog.yaml` (BL-328-001 … BL-328-502; trackable, prioritized)
> - **Source design:** `documentation/architecture/tool-context-provisioning.md` (ADR / Proposal)
>
> Status: **PLANNING — awaiting owner approval.** No implementation begins until the owner approves and
> says "Start sprint" (AGENTS.md Rule S1 / §2.4).

## Objective
Introduce a Context Pack / Context Provider / binding convention (`src/common/context/`) that injects
relevant, versioned schema/usage context for LLM agents **only when** the related MCP tool, task, or event
type is in play; render it just-in-time via the existing prompt-assembly layer (`NamedContext`,
priority-ordered, de-duped); expose packs as MCP Resources; and **generate** the shared `InternalEventV2`
and JsonLogic packs from the source of truth with drift-guard tests. Additive, behavior-preserving, reversible.

## Scope
- **In:** `src/common/context/**` (types + resolver + de-dup), `registerToolWithContext` on the Bit
  (`src/common/base-server.ts`), generated `schema.internal-event-v2` + `router.jsonlogic-guide` packs +
  drift tests, scheduler/event-router/enrichment wiring, MCP Resource exposure, additive
  `INTERNAL_MCP_REGISTRATION_V1` advertisement, JIT resolution in `tool-gateway`/`McpBridge`, tests,
  `validate_deliverable.sh`.
- **Out:** P4 RAG scale-out (Firestore persistence + embedding retrieval) — **deferred/design-only** by
  default; domain logic beyond binding packs; any schema/topic version rename or removal.

## Phases → backlog (see execution-plan §5 + backlog.yaml)
- **P0 Quick win:** BL-328-001, -002, -003
- **P1 Convention:** BL-328-100, -101, -102
- **P2 JIT assembly:** BL-328-200, -201, -202
- **P3 Generated + drift-guarded:** BL-328-300, -301, -302
- **P4 RAG (deferred/design-only):** BL-328-400
- **Validation / close-out:** BL-328-500, -501, -502

## Acceptance Criteria / Testing / Validation / Deployment / DoD
See `execution-plan.md` §6–§12 (authoritative). Jest unit + drift-guard + integration tests; full suite
must pass; `validate_deliverable.sh` builds, tests, and asserts version parity via `npm run release:dry`.

## Definition of Done
Per AGENTS.md §3 (project-wide DoD) — see `execution-plan.md` §12. Every change traces to a BL-328-NNN item
and a `request-log.md` entry.
