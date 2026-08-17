# Deliverable Verification – sprint-322-ca67dd

**Goal:** Improve the formatting and data in the canonical `architecture.yaml` so it carries the
contracts, flow, and rationale previously scattered across `documentation/`.

**Approval:** Plan approved by the user (REQ-002) with answers to all 6 open questions:
(1) free-form-but-consumed; (2) remove the stale command-processor route; (3) document the
internal-LB resolution; (4) absent `active:` = **disabled**; (5) all 9 areas; (6) promote
sprint-tagged comments to structured fields and remove the transient comment noise.

## Completed

- [x] **BL-001 (Discovery, §all):** validation method chosen (YAML parse + topic-catalog/LB/reference
      checks; no JSON-Schema validator exists in repo); all cited docs confirmed; baseline parse recorded.
- [x] **BL-002 (§1):** top-level `messaging:` block — transport (NATS local / Pub/Sub prod via
      `MESSAGE_BUS_DRIVER`), conventions (naming, versioning, per-instance), envelope contract
      (`required: [v, source, correlationId]`, optional fields, schema), DLQ topics, and a **17-entry
      topic catalog** (purpose / producers / consumers / schema) covering every `publishes`/`consumes` topic.
- [x] **BL-003 (§2):** top-level `dataflow:` block — narrative + `stages[]` (ingest/route/analyze/
      react/egress/persist), referencing `documentation/concepts/platform-flow.md`. Per-service `stage:`
      tags added (in BL-009).
- [x] **BL-004 (§3):** stale `command-processor` internal-LB route **removed**; replaced with a note
      pointing to `documentation/firestore/indexes.md` (the `commands` collection).
- [x] **BL-005 (§3):** `internal-load-balancer` description expanded to document **host-based**
      per-service resolution; the 9 `path_prefix: /` rules retained intentionally with an inline comment.
- [x] **BL-006 (§3):** `defaults.services.active: false` documents that **absent = disabled**;
      `query-analyzer` and `api-gateway` now set `active: true` explicitly; truncated `ingress-egress`
      description completed into a full sentence.
- [x] **BL-007 (§4):** top-level `conventions:` block — `env` sources + `K_REVISION` auto-injection note,
      and a `secrets` catalog (14 names → description / source / used_by). No secret values added.
- [x] **BL-008 (§5):** `infrastructure.resources.firestore` declared (cloud-firestore) with rules/indexes
      links, `documentation/firestore/` docs link, and a `collections` map (events, stream_observers,
      state, mutation_log, commands).
- [x] **BL-009 (§7):** every service tagged `kind:` (gateway | pipeline-service | mcp-server);
      pipeline services tagged `stage:`; `external:` deps, `stateful:`/`owned_state:`, and
      `scaling_rationale:` added where useful.
- [x] **BL-010 (§8):** top-level `references:` block linking the documentation tree; all 9 paths resolve.
- [x] **BL-011 (§6, §9):** `llm_guidance` gained `glossary`, `invariants`, `doc_pointers`,
      `build_contract`; Sprint-113 networking comment promoted to a `networking:` block; sprint-318
      build comment promoted to structured `defaults.services.build`; transient comment noise removed.
- [x] **BL-012 (DoD):** `planning/sprint-322-ca67dd/validate_deliverable.sh` added and **passes**
      (parse + topic-catalog + LB-target + references checks); reciprocal `platform-flow.md` link fixed.

## Validation evidence

```
$ bash planning/sprint-322-ca67dd/validate_deliverable.sh
[OK] architecture.yaml parses as valid YAML
[OK] all 18 referenced topics exist in messaging.topics catalog
[OK] no internal-load-balancer route targets an undefined service
[OK] all 9 references: paths resolve to real files
[OK] architecture.yaml structural validation complete
```

`architecture.yaml` grew from 450 to ~791 lines; top-level keys: `name, description, project,
llm_guidance, messaging, dataflow, conventions, references, defaults, services, infrastructure,
deploymentDefaults, deploymentTargets, networking`.

## Alignment notes / deviations

- The §9 `build:` decision was promoted into the **existing** `defaults.services.build` (where build
  config logically lives) rather than a new top-level `build:` block, to avoid duplicating build config.
- No existing structural fields were renamed or removed; the only data change is the approved removal of
  the stale `command-processor` route (OQ2). All other edits are additive/descriptive.
- Fixed one reciprocal documentation link (`documentation/concepts/platform-flow.md`) so docs ↔ YAML agree.

## Partial / Deferred

- None. All 9 analysis areas delivered (per OQ5).

## Publication

- PR creation attempted at close-out; result recorded in `publication.yaml` (Rules S12/S13).
