# Request Log – sprint-322-ca67dd

Traceability per AGENTS.md §3. Each entry records a user prompt, its interpretation, and the
shell/git operations and files touched.

---

## REQ-001 — Plan the sprint (planning deliverables)

- **At:** 2026-06-25T11:42:00Z
- **Prompt summary:** "Start sprint. Assume role of Lead Implementor. Improve the formatting and
  data in `architecture.yaml`. Produce an Execution Plan and a Trackable Prioritized YAML Backlog."
- **Interpretation:** Planning-phase deliverables only; no implementation until approval (AGENTS.md §2.4).
- **Commands:** `git checkout -b feature/sprint-322-ca67dd-architecture-yaml-docs`; YAML parse checks.
- **Files created:** `sprint-manifest.yaml`, `execution-plan.md`, `backlog.yaml`, `request-log.md`.
- **Outcome:** Plan parked at approval gate with 6 open questions.

---

## REQ-002 — Approval + open-question answers; begin implementation

- **At:** 2026-06-25T11:57:00Z
- **Prompt summary:** "Documentation approved. Open-question responses: (1) free-form-but-consumed;
  (2) remove the stale route; (3) document the intended resolution; (4) disabled; (5) all 9;
  (6) promote to structured fields and remove the transient comment noise, keeping the durable
  decision text. Begin implementation; keep backlog item statuses up to date."
- **Interpretation / resolved decisions:**
  - **OQ1:** `architecture.yaml` is treated as **free-form-but-consumed** — additive top-level
    blocks (`messaging:`, `dataflow:`, `references:`, `networking:`, `build:`) are safe; validation
    is a YAML parse plus a topic-catalog completeness check (no JSON-Schema validator exists in repo).
  - **OQ2:** `command-processor` → **remove the stale `internal-load-balancer` route** (line ~414).
    It is not defined under `services:`; its historical concept survives only in
    `documentation/firestore/indexes.md` (sprint-108). Route removed with a clarifying note.
  - **OQ3:** `internal-load-balancer` 9 `path_prefix: /` rules → **document the intended resolution**
    (host/SNI per-service internal routing; each service answers on its own internal hostname). No
    data change to prefixes.
  - **OQ4:** absent `active:` → **disabled**. Document the default in `defaults.services.active` and
    normalize usage so every service that should run sets `active: true` explicitly.
  - **OQ5:** deliver **all 9** analysis areas (BL-002 … BL-011).
  - **OQ6:** promote durable sprint-tagged comments into structured `networking:`/`build:` blocks and
    **remove the transient comment noise**, keeping the durable decision text.
- **Discovery (BL-001) findings:**
  - Validation method: YAML parse (`ruby -ryaml`) + a `publishes`/`consumes` ⊆ `messaging.topics`
    catalog check in `validate_deliverable.sh`. Baseline: `architecture.yaml` (450 lines) parses OK.
  - Cited docs all exist: `documentation/concepts/platform-flow.md`,
    `documentation/reference/messaging-system.md`, `documentation/schemas/envelope.v1.json`,
    `documentation/schemas/routing-slip.v1.json`, `firestore.rules`, `firestore.indexes.json`,
    `documentation/firestore/`.
  - Firestore collections (from rules/indexes): `events`, `stream_observers`, `state`,
    `mutation_log`, `commands`.
  - Envelope required fields (schema): `v`, `source`, `correlationId`; optional `traceId`,
    `replyTo`, `timeoutAt`, `routingSlip`.
- **Files touched:** `request-log.md` (this entry), `sprint-manifest.yaml` (status → in-progress),
  `backlog.yaml` (BL-001 → done), then `architecture.yaml` (Phases 1–4) and close-out artifacts.
