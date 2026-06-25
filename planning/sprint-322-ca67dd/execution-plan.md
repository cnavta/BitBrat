# Execution Plan – improve descriptive formatting & data in `architecture.yaml`

- **Sprint:** sprint-322-ca67dd
- **Role:** Lead Implementor
- **Date:** 2026-06-25
- **Source of truth:** `architecture.yaml` (the artifact under change) + this sprint's `sprint-manifest.yaml`
- **Source issue:** attached analysis *"Improving Descriptive Text in `architecture.yaml`"* (9 areas)
- **Status:** Awaiting user approval — **no implementation begins until approved (AGENTS.md §2.4).**

## 1. Purpose

Decompose, into a sequenced and gated set of accomplishable tasks (with the companion Trackable
Prioritized YAML Backlog `backlog.yaml`), the work of **improving the formatting and data in
`architecture.yaml`** so the canonical file carries the *contracts, flow, and rationale* that today
require reading the entire `documentation/` tree to reconstruct.

`architecture.yaml` is precedence rule #1 (AGENTS.md) and the README's declared canonical system
definition, yet it is currently a thin structural manifest: services, topics, env, and routing are
listed with sparse descriptions, while the conceptual/operational knowledge lives only in scattered
docs and is never surfaced inline. This sprint enriches the descriptive text **and fixes concrete
inconsistencies** while keeping the file concise, valid, and structurally backward-compatible.

## 2. Guiding Constraints

- **Canonical-file discipline:** the file remains the structural source of truth. Edits MUST keep it
  valid YAML and MUST NOT rename/remove fields that tooling consumes (deployment/infra config), except
  for explicitly approved consistency fixes (see Phase 2).
- **Additive-first:** prefer *adding* descriptive fields/blocks (`messaging:`, `dataflow:`,
  `references:`, structured decision blocks, per-key descriptions) over restructuring existing data.
- **Single source of truth for facts:** descriptions must reflect what the code/docs actually do; every
  added claim is grounded in `documentation/` (e.g. `platform-flow.md`, `messaging-system.md`,
  `documentation/schemas/envelope.v1.json`, `routing-slip.v1.json`, `firestore.rules`,
  `firestore.indexes.json`) — no invented behavior. Where the doc and the YAML disagree, surface it.
- **No code behavior change:** this sprint edits a descriptive/config manifest and documentation only;
  it does not change service runtime behavior. (If discovery shows a consumer parses a field we must
  change, surface to the user before changing it.)
- **Validation is mandatory:** the file must pass YAML parse + (if one exists) any repo schema/lint for
  `architecture.yaml`; `validate_deliverable.sh` must exercise this.
- **Reversible & traceable:** all work on the feature branch; each task maps to a backlog ID and a
  request-log entry (AGENTS.md §3 traceability).
- **WIP limit = 3** in-progress items at a time.

## 3. Open Questions (to confirm at approval)

1. **Schema/validation target:** Is there an existing validator/JSON-Schema for `architecture.yaml`
   (or a consumer that parses it) we must stay compatible with, or is it currently free-form? This
   determines whether new top-level blocks (`messaging:`, `dataflow:`, `references:`, `networking:`,
   `build:`) are safe to add. **Plan of record:** treat it as free-form-but-consumed, add only additive
   blocks, and validate with a YAML parse + (if found) the existing schema. **Confirm.**
2. **`command-processor` defect (analysis §3):** the route at line ~414 targets a service not defined
   under `services:`. Should we (a) **remove the stale route**, or (b) **add a `command-processor`
   service definition**? This is a data/correctness change, not just formatting. **Plan of record:**
   add a description flagging it and treat as stale → remove route, *pending your call*. **Confirm.**
3. **`internal-load-balancer` routing (analysis §3):** 9 rules all `path_prefix: /` (lines ~401-417).
   Is this intentional host-based/per-service resolution that we should merely **document**, or
   genuinely **incorrect prefixes to correct**? **Plan of record:** document the intended resolution
   (no data change) unless you confirm the prefixes are wrong. **Confirm.**
4. **`active:` default (analysis §3):** is an absent `active` treated as **enabled** or **disabled**?
   We will document the default in `defaults.services` and normalize usage to match. **Confirm the
   intended default.**
5. **Scope / depth this sprint:** the analysis lists 9 areas. Do you want **all 9** delivered in this
   sprint, or a prioritized subset (e.g. P0 = messaging + dataflow + consistency fixes, defer the
   rest)? **Plan of record:** all 9, phased P0→P2 as in the backlog; deferrable on your word.
6. **Sprint-tagged comments (analysis §9):** when promoting buried comments (e.g. "Sprint 113",
   "sprint-318") into structured `networking:` / `build:` blocks, should the original comments be
   **removed** or **retained as provenance**? **Plan of record:** promote to structured fields and
   remove the transient comment noise, keeping the durable decision text. **Confirm.**

## 4. Phases & Gates

### Phase 0 — Discovery & validation baseline (foundation)
- Confirm whether a schema/validator/consumer exists for `architecture.yaml` (Open Question 1); locate
  the authoritative docs each addition will cite (`platform-flow.md`, `messaging-system.md`,
  `envelope.v1.json`, `routing-slip.v1.json`, `firestore.*`).
- Capture a YAML-parse baseline of the current file so every later phase can prove "still valid YAML".
- Inventory every defect/claim from the analysis against real line numbers (most already verified:
  command-processor line ~414; LB rules ~401-417; sprint comments ~33-44 & ~445-449).
- **Gate G0:** validation method chosen; all citations confirmed to exist; baseline parse recorded;
  open questions answered (or defaults accepted).

### Phase 1 — Messaging/topic catalog + event lifecycle (highest-value, additive) — analysis §1, §2
- Add a top-level `messaging:` block: topic naming convention (`internal.<domain>.<verb>.v<N>`), the
  `.v1` version + `.{instanceId}` per-instance semantics, transport selection
  (`MESSAGE_BUS_DRIVER`/`NATS_URL`/`BUS_PREFIX`: NATS locally, Pub/Sub in prod), the envelope contract
  (required fields `v, source, correlationId, traceId, replyTo, routingSlip`), DLQ semantics
  (`internal.deadletter.v1`, `internal.router.dlq.v1`), and a **topic catalog** (purpose / producers /
  consumers / schema link) for the topics referenced in `publishes`/`consumes`.
- Add a top-level `dataflow:` block: ingress→analysis→reaction→egress narrative + reference to
  `documentation/concepts/platform-flow.md` (optionally a per-service `stage:` field).
- **Gate G1:** every topic appearing in any service's `publishes`/`consumes` is defined in the catalog;
  envelope/DLQ contracts present; dataflow narrative references the canonical doc; file still parses.

### Phase 2 — Consistency / correctness fixes (data, gated by Open Questions 2-4) — analysis §3
- Resolve `command-processor` (remove stale route OR add service def, per Open Question 2) with a note.
- Clarify/correct `internal-load-balancer` routing (per Open Question 3).
- Normalize `active:` and document its default in `defaults.services` (per Open Question 4).
- Finish truncated/fragment descriptions (e.g. `ingress-egress` "...to internal topics;") into full
  sentences.
- **Gate G2:** no route points to an undefined service (or it is intentionally documented); LB routing
  is unambiguous; `active` usage + documented default are consistent; no dangling/fragment descriptions;
  file still parses.

### Phase 3 — Secrets/env, Firestore, per-service detail, cross-references — analysis §4, §5, §7, §8
- **Secrets/env (§4):** add inline `description` + `source` (gcp-secret-manager / .env / cloud-run) per
  secret/env key (start with high-reuse keys like `MCP_AUTH_TOKEN`); add a `conventions.env` note for
  auto-injected vars (e.g. `K_REVISION`).
- **Firestore (§5):** add Firestore to `infrastructure.resources` with collections/usage description and
  a link to `documentation/firestore/` (grounded in `firestore.rules`/`firestore.indexes.json`).
- **Per-service detail (§7):** add, where useful, stateful/stateless + owned state, scaling rationale
  (`min: 0/1`, per-instance egress topics), external deps (Twitch/Discord/Twilio/OpenAI/OBS), and a
  `kind:` tag (`mcp-server | pipeline-service | gateway`) to make the two planes legible.
- **Cross-references (§8):** add a top-level `references:`/`docs:` field linking the `documentation/`
  tree (and optionally per service/topic).
- **Gate G3:** documented keys carry purpose+source; Firestore present in infrastructure; services
  carry `kind` + boundary notes where useful; references resolve to real paths; file still parses.

### Phase 4 — Richer `llm_guidance` + structured decision blocks — analysis §6, §9
- **`llm_guidance` (§6):** add a glossary (routing slip, disposition, MCP, egress, enrichment, "brat"
  CLI), hard invariants (never import `./deprecated`; all messages carry `correlationId`; bump topic
  version on breaking changes), doc pointers, and the build-contract reminder
  (`Dockerfile.service` derivation rule).
- **Structured decision blocks (§9):** promote durable sprint-tagged comments into machine-readable
  `networking:` and `build:` blocks (per Open Question 6).
- **Gate G4:** `llm_guidance` contains glossary + invariants + pointers; decisions live in structured
  fields; transient comment noise resolved; file still parses.

### Phase 5 — Validation harness, docs & close-out
- Provide/extend `validate_deliverable.sh`: YAML parse of `architecture.yaml` + (if present) repo
  schema/lint + a check that every `publishes`/`consumes` topic exists in the new catalog; logically
  passable per AGENTS.md §2.6.
- Update any affected `documentation/` index/cross-links so docs and YAML agree.
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; open PR and record in
  `publication.yaml` (Rules S12/S13).
- **Gate G5:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 5. Sequencing & Dependencies (summary)

```
Phase0(G0 discovery + validation baseline + answers)
  -> Phase1(G1 messaging catalog + dataflow)        [P0]
  -> Phase2(G2 consistency/correctness fixes)        [P0, gated by Q2-Q4]
  -> Phase3(G3 secrets/env + firestore + per-svc + refs) [P1]
  -> Phase4(G4 llm_guidance + structured decisions)  [P2]
  -> Phase5(G5 validate + docs + close)
```

Phases 1 and 2 are the highest-value (contract + de-misleading the "truth"); 3-4 are additive depth.
The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance criteria) lives in
`backlog.yaml` (BL-001 … BL-012).

## 6. Definition of Done (this artifact)
- [x] Work decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Constraints (canonical-file discipline, additive-first, grounded facts, mandatory validation) explicit.
- [x] Open questions surfaced for approval (schema target, command-processor, LB routing, `active` default, scope, comment handling).
- [ ] **User approval to begin implementation (pending).**
