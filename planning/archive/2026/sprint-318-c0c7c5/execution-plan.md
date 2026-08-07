# Execution Plan – Reusable Standard Service Dockerfile

- **Sprint:** sprint-318-c0c7c5
- **Role:** Lead Implementor
- **Date:** 2026-06-22
- **Source of truth:** `documentation/technical-architecture/reusable-service-dockerfile.md` (Status: Proposed)
- **Status:** Awaiting user approval — **no implementation begins until approved.**

## 1. Purpose

Decompose the approved-in-principle Technical Architecture into a sequenced, gated set of
accomplishable tasks, with a companion Trackable Prioritized YAML Backlog (`backlog.yaml`).
This plan operationalizes the migration strategy (architecture doc §6) plus the build-tooling,
`architecture.yaml`, validation, and documentation work implied by §3.3, §5, and §7.

## 2. Guiding Constraints

- **Behavior-preserving:** the standard image must reproduce current build/boot/health-check
  behavior; hardening is explicitly out of scope (doc §8).
- **Incremental & reversible:** roll out per service; each per-service `Dockerfile.<service>` is
  deleted only after its build is green on the shared file; rollback = restore that file from git.
- **`architecture.yaml` is canonical** (AGENTS.md precedence): `SERVICE_ENTRY`/port are derived
  from it, not from a new config source.
- **Escape hatch retained** (doc §3.4): a present `Dockerfile.<service>` overrides the shared file.
- **WIP limit = 3** in-progress items at a time (mirrors `deploymentDefaults.maxConcurrentDeployments`).

## 3. Phases & Gates

### Phase 0 — Foundation (no deletions)
- Create the canonical `Dockerfile.service` with the closed `ARG` set (`NODE_IMAGE`,
  `SERVICE_NAME`, `SERVICE_ENTRY`, `SERVICE_PORT`).
- Confirm `.dockerignore`/build context is compatible (whole-repo `COPY src`, `tsconfig.json`,
  `package*.json`, `architecture.yaml`).
- Add a short template/usage doc.
- **Gate G0:** `Dockerfile.service` builds locally for one service via explicit `--build-arg`s and
  the container boots + answers its health check. Nothing deleted yet.

### Phase 1 — Tooling enablement
- Wire `SERVICE_ENTRY` derivation (`src/apps/<x>.ts` → `dist/apps/<x>.js`) and port lookup from
  `architecture.yaml` into `infrastructure/deploy-cloud.sh`.
- Add the `_SERVICE_ENTRY` substitution + `--build-arg` to the Cloud Build path; keep
  `_DOCKERFILE`/`_SERVICE_NAME`/`_PORT` mapping.
- Implement resolution order: present `Dockerfile.<service>` → override; else `Dockerfile.service`.
- Add a fail-fast guard when `SERVICE_ENTRY` resolves empty (doc §7).
- **Gate G1:** `deploy-cloud.sh --dry-run` (or equivalent) resolves the shared file + correct args
  for a sample service without requiring a per-service Dockerfile.

### Phase 2 — Pilot
- Migrate **`llm-bot`** (its `cloudbuild.llm-bot.yaml` + deploy path) onto `Dockerfile.service`.
- Verify byte-for-byte-equivalent runtime behavior (build, boot, health check, port).
- **Gate G2 (pilot sign-off):** pilot image green end-to-end before any bulk rollout.

### Phase 3 — Validation harness
- Extend `validate_deliverable.sh` to: build a representative service via `Dockerfile.service`,
  boot it, health-check it, then tear down; keep existing `npm` build/test steps.
- **Gate G3:** validation script is logically passable (all referenced commands exist) per AGENTS.md §2.6.

### Phase 4 — Standard-family rollout
- Roll out the remaining 14 standard services in batches (respect WIP=3).
- Delete each `Dockerfile.<service>` only after its build is green on the shared file.
- **Gate G4:** all standard-family services build green on `Dockerfile.service`; their per-service
  Dockerfiles removed.

### Phase 5 — Legacy normalization & reconciliation
- Normalize `disposition-service`, `story-engine-mcp`, `stream-analyst-service` onto the shared
  file, fixing the `dist/src/...` → `dist/apps/...` entry-path discrepancy.
- Reconcile duplicate `stream-analyst` / `stream-analyst-service` Dockerfiles against the single
  `stream-analyst` service in `architecture.yaml`.
- **Gate G5:** legacy services boot correctly from the shared file; duplicates resolved.

### Phase 6 — `architecture.yaml` clarifications & defaults
- Add non-breaking documentation that `Dockerfile.service` is the canonical build artifact and that
  `services.<name>.entry` → compiled `SERVICE_ENTRY`.
- Add explicit `port` for non-3000 deviators (e.g. `stream-analyst` = `3010`).
- Flip tooling defaults so a brand-new service needs **no** Dockerfile.
- **Gate G6:** a hypothetical new service builds with zero per-service Dockerfile.

### Phase 7 — Close-out
- Update `README`/docs to describe the standard build path + escape hatch.
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`, open PR (`publication.yaml`).

## 4. Sequencing & Dependencies (summary)

```
Phase0(G0) → Phase1(G1) → Phase2 pilot(G2) → Phase3(G3) → Phase4 rollout(G4)
                                                              → Phase5 legacy(G5)
                                                              → Phase6 defaults(G6) → Phase7 close
```

The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance criteria) lives in
`backlog.yaml` (BL-001 … BL-012).

## 5. Definition of Done (this artifact)
- [x] Architecture doc decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Constraints, sequencing, and gates explicit and reversible.
- [ ] **User approval to begin implementation (pending).**
