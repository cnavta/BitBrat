# Execution Plan – sprint-330-91f8ad

- **Sprint:** sprint-330-91f8ad
- **Title:** Deploy honors `active:false`, fix slow-Bit duplicate responses, add `brat fleet restart`
- **Owner / Role:** Lead Implementor
- **Date:** 2026-06-29
- **Branch:** `feature/sprint-330-91f8ad-active-deploy-dup-fleet-restart`
- **Source of truth:** `architecture.yaml` + `AGENTS.md`
- **Source design / issue / prompt:** Owner sprint prompt (three items; more may be added later, Rule S4 / §2.4.1)
- **Status:** PLANNING — awaiting owner approval. No implementation begins until approved and the owner says **"Start sprint"**.

---

## 1. Objective

Ship three reversible, independently shippable changes:

1. **Deploy respects `active`:** `brat deploy services` (and `--all`) MUST skip any service whose
   `active` is not `true`, matching the IaC synth path and `defaults.services.active: false`.
2. **No duplicate responses on slow Bits:** A single inbound event that takes a long time to process
   (e.g. `image-gen-mcp`, `llm-bot`) MUST yield exactly one egress response — the message-bus
   redelivery/timeout behavior that currently produces ≥1 duplicate is corrected.
3. **`brat fleet restart <bit-name>`:** A new fleet subcommand restarts a Bit through the universal
   `bit.*` control plane, consistent with existing `drain`/`shutdown` ergonomics and RBAC.

---

## 2. Problem Statement / Why

- **Item 1 — inactive services still deploy.**
  - **Current behavior:** `tools/brat/src/cli/index.ts → cmdDeployServices()` builds its task list from
    `Object.values(cfg.services)` with **no `active` filter**. By contrast,
    `tools/brat/src/providers/cdktf-synth.ts` (~line 368) filters services to `active === true`.
  - **Impact / risk:** Bits intended to be disabled (e.g. `obs-mcp`, currently `active: false`) get
    built and deployed to Cloud Run, wasting cost/quota and violating the canonical contract that an
    absent/`false` `active` means DISABLED (`defaults.services.active`).
  - **Why now:** Cheap, high-value parity fix; unblocks confident use of `active:false` as the off switch.

- **Item 2 — duplicate responses for slow Bits.**
  - **Current behavior:** Delivery is **at-least-once** (`messaging.transport.delivery`); consumers are
    required to be idempotent. The Pub/Sub driver creates subscriptions with an ack deadline
    (`PUBSUB_ACK_DEADLINE_SECONDS`, default 60s; `subscriber-options.ts` default 30s, clamped 10..600).
    When a Bit's processing exceeds the deadline **without ack-deadline extension (lease renewal)**,
    Pub/Sub redelivers the message, the Bit processes it again, and a duplicate egress is produced. The
    NATS driver has the analogous `ackWait` behavior.
  - **Impact / risk:** Visible duplicate chat/image responses; degrades UX and can double external API spend.
  - **Why now:** Persistent, reported defect on the two slowest Bits.

- **Item 3 — no restart affordance.**
  - **Current behavior:** Fleet CLI exposes `drain`/`shutdown` (→ `bit.drain`/`bit.shutdown`) but no
    `restart`. Operators must manually shutdown + rely on Cloud Run min-instances to respawn.
  - **Impact / risk:** No first-class, RBAC-gated, auditable restart; inconsistent operator workflow.
  - **Why now:** Rounds out the fleet lifecycle verbs delivered in sprints 324/325.

---

## 3. Grounding / Verified Baseline Facts

- `tools/brat/src/cli/index.ts:310` `cmdDeployServices()` — `let services = Object.values(cfg.services)`;
  optional single-service filter only; **no `active` filter** before build/deploy.
- `tools/brat/src/providers/cdktf-synth.ts:348,368` — synth filters to `active === true` (the desired
  semantics already exist there and in `config/schema.ts:275` which warns on inactive-but-referenced).
- `architecture.yaml` `defaults.services.active: false` (line 337) — absent `active` ⇒ disabled.
  `obs-mcp` is `active: false` (line 591) and is a concrete service that should be skipped.
- `src/services/message-bus/subscriber-options.ts` — `DEFAULTS.ackDeadlineSeconds = 30` (clamped 10..600);
  `pubsub-driver.ts:294` reads `PUBSUB_ACK_DEADLINE_SECONDS ?? 60` and `ensureSubscription` applies it.
- `messaging.transport.delivery: at-least-once` + invariant "Consumers must be idempotent
  (dedupe on correlationId + step + attempt)" (architecture.yaml lines 40, 64).
- Fleet CLI: `tools/brat/src/cli/fleet.ts` `dispatch()` (line 317) maps subcommands → `bit.*`;
  `mutate()` (line 418) is the elevated, `--confirm`-gated path used by `drain`/`shutdown`.
- Control-plane tools registered in `src/common/base-server.ts:1212-1222` (`bit.drain`, `bit.shutdown`
  via `setTimeout(() => this.close(reason))`, scope `bit:operate`).
- Bit conformance test enumerates the mandatory `bit.*` tool set
  (`tests/common/bit-conformance.spec.ts`) — must be updated if a new universal tool is added.

### Conflicts or inconsistencies discovered

| Item | Source A | Source B | Resolution / Plan of Record |
|---|---|---|---|
| active filtering | `cmdDeployServices` (no filter) | `cdktf-synth` (filters active) | Align deploy to synth; treat synth's `active === true` as canonical semantics. |
| restart semantics | Cloud Run (new revision / min-instances respawn) | Local docker (container restart) | OPEN QUESTION — see §10. Plan of Record: `bit.restart` = graceful in-process restart signal (close+re-exec / exit for orchestrator respawn); CLI maps `fleet restart` → `bit.restart`. Confirm at approval. |

---

## 4. Scope

### In scope
- Add an `active` filter to the `brat deploy services` path (single-service and `--all`), with a clear
  skip log line and a guard when an explicitly named target is inactive.
- Diagnose and fix the slow-Bit duplicate-response root cause in the message-bus consumer layer
  (ack-deadline lease extension while handler runs, and/or sensible defaults for slow Bits), plus
  verify/strengthen consumer idempotency so a redelivery never yields a second egress.
- Add `brat fleet restart <bit-name>` → new `bit.restart` control-plane tool (RBAC `bit:operate`),
  wired through `dispatch`/`mutate`, with `--all`+`--confirm` parity.
- Tests for all three (unit; integration where feasible) and documentation updates.

### Out of scope
- Re-architecting the routing slip / egress dedupe store beyond what is needed to stop duplicates.
- Changing the deployment provider (Cloud Build/Cloud Run) topology.
- New RBAC scopes beyond reusing `bit:operate`.

### Non-goals / explicit deferrals
- Global, persistent cross-instance dedupe cache (e.g. Firestore-backed) — defer unless investigation
  proves in-handler lease extension is insufficient. Track as BL-330-204 if needed.

---

## 5. Guiding Constraints
- **Canonical-file discipline:** `architecture.yaml` wins; reflect any contract/env additions there
  (e.g. new `bit.restart` tool, any new ack/timeout env keys) before/with code.
- **Planning approval gate:** No code/branch edits until this plan is approved and owner says "Start sprint".
- **Repository locality:** No dependence on `./deprecated`.
- **Traceability:** Every task maps to a backlog ID and a `request-log.md` entry.
- **Reversibility / behavior preservation:** Targeted changes; existing behavior unchanged except the
  three intended fixes, each with explicit acceptance criteria.
- **At-least-once invariant:** The duplicate fix must NOT break idempotency or change topic versions.
- **WIP limit:** 3 active items at a time.

---

## 6. Implementation Approach (per item)

### Item 1 — Deploy honors `active`
- In `cmdDeployServices`, after building the `services` list, filter to active services using the same
  rule as `cdktf-synth` (`active === true`). For an explicitly named inactive target, fail fast with a
  clear `ConfigurationError` (do not silently deploy or silently skip a directly requested service).
- Emit a structured skip log (`action: deploy.service, status: skipped, reason: inactive`).

### Item 2 — Duplicate responses on slow Bits
- Reproduce: a handler whose duration exceeds the ack deadline triggers redelivery (unit/integration
  harness around the pubsub/nats driver, no live cloud).
- Root-cause fix (Plan of Record): keep the message lease alive while the handler runs (periodic
  ack-deadline extension / modAck for Pub/Sub; equivalent for NATS) so a slow-but-successful handler is
  not redelivered. Pair with confirmed consumer idempotency (dedupe on correlationId+step+attempt) as a
  safety net. Make timeouts configurable with safe defaults; document env keys in architecture.yaml.
- Validate against the two named slow Bits' processing profiles (`image-gen-mcp`, `llm-bot`).

### Item 3 — `brat fleet restart <bit-name>`
- Add `bit.restart` to the universal control plane in `base-server.ts` (scope `bit:operate`),
  semantics per §10 resolution (graceful close + orchestrator respawn / re-exec).
- Add `restart` to fleet `dispatch()` → `mutate(args, client, 'bit.restart', ...)`, including
  `--all`+`--confirm` and help text alongside `drain`/`shutdown`.
- Update `tests/common/bit-conformance.spec.ts` mandatory tool list and fleet specs.

---

## 7. Testing Strategy
- **Item 1:** Unit tests on `cmdDeployServices` filtering: inactive omitted from `--all`; explicit
  inactive target errors; active services still deploy (extend existing deploy/synth test patterns).
- **Item 2:** Driver-level test proving a handler exceeding the base deadline is NOT redelivered once
  lease extension is enabled; idempotency test proving a forced redelivery yields a single egress.
- **Item 3:** `base-server` conformance test includes `bit.restart` with `bit:operate`; fleet CLI spec
  for `restart <bit>`, `restart --all --confirm`, and RBAC-forbidden behavior.
- All new behavior covered with Jest; external deps mocked; `npm test` must pass.

## 8. Deployment Approach
- No new cloud resources. Item 1 changes deploy selection only. Item 2 may add documented env knobs
  consumed by Cloud Run. Item 3 adds a control-plane tool + CLI verb. `validate_deliverable.sh` runs
  install/build/test and `npm run release:dry -- patch` (single-source version check).

## 9. Dependencies
- Existing `brat` deploy pipeline, message-bus drivers (pubsub/nats), and the `bit.*` control plane.
- No new external services or credentials required for implementation/tests.

---

## 10. Open Questions (resolve at approval)
1. **Restart semantics:** Confirm `bit.restart` means "graceful close + rely on orchestrator
   (Cloud Run min-instances / local supervisor) to respawn" vs. an in-process re-exec. Plan of Record:
   graceful close-and-respawn, returning `{ restarting: true, reason }`.
2. **Duplicate-fix depth:** Is in-handler ack-deadline extension + existing idempotency acceptable, or
   is a persistent cross-instance dedupe store required? Plan of Record: lease extension + idempotency;
   persistent store deferred (BL-330-204) unless reproduction shows it is necessary.
3. **Env knobs:** Approve any new documented env keys for per-Bit slow-handler deadlines.

---

## 11. Definition of Done
- Project-wide DoD (AGENTS.md §3): code quality, tests for new behavior, `npm test` green, docs updated,
  full traceability to backlog IDs + `request-log.md`.
- Item 1: inactive services never deploy; explicit inactive target errors clearly; tests prove it.
- Item 2: a slow handler produces exactly one egress; redelivery does not duplicate; tests prove it.
- Item 3: `brat fleet restart <bit>` works with RBAC + `--all --confirm`; conformance/CLI tests pass.
- `validate_deliverable.sh` logically passable; PR created or PR-attempt logged + accepted (Rules S12/S13).
