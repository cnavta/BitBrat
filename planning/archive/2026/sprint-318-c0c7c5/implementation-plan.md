# Implementation Plan – sprint-318-c0c7c5

## Objective
Replace the dockerfile-per-service strategy (currently ~19 near-identical root `Dockerfile.<service>`
files) with a single reusable, parametrized **standard service Dockerfile** plus a documented
**template**, used by all Node/TypeScript services wherever possible — eliminating duplication while
preserving current Cloud Build / Cloud Run / local build behavior.

## Scope

### In scope
- **Task 1 (current):** Author a Technical Architecture document that defines the reusable
  Dockerfile approach (problem, design, parametrization model, migration strategy, risks, rollback).
- Future tasks (to be appended per section 2.4.1 once provided by the user): implementation of the
  reusable Dockerfile, build-tooling wiring, per-service migration, and validation.

### Out of scope (for Task 1)
- Actually creating/modifying the reusable Dockerfile or deleting per-service Dockerfiles.
- Changes to `architecture.yaml`, `cloudbuild.*.yaml`, or `infrastructure/deploy-cloud.sh`.
- Runtime/application code changes.

## Deliverables
- **Task 1:** `documentation/technical-architecture/reusable-service-dockerfile.md`.
- Sprint protocol artifacts: `sprint-manifest.yaml`, `request-log.md`, `implementation-plan.md`,
  and (at completion) `verification-report.md`, `validate_deliverable.sh`, `publication.yaml`,
  `retro.md`, `key-learnings.md`.

## Acceptance Criteria
- **Task 1:** A reviewed Technical Architecture document exists that:
  - Accurately describes the current state (standard vs. legacy Dockerfile families).
  - Defines a concrete, parametrized reusable Dockerfile design driven by existing inputs
    (`architecture.yaml` `entry:`/ports, `_DOCKERFILE`/`_SERVICE_NAME`/`_PORT` substitutions).
  - Specifies a low-risk, reversible migration and rollback strategy.
  - Aligns with `architecture.yaml` (precedence) and AGENTS.md.

## Testing Strategy
- Task 1 is a documentation deliverable; validation is structural: Markdown link/structure check
  and verification that all referenced files/fields exist in the repo. No code build required for
  Task 1 (per AGENTS.md §6 documentation note + DoD "non-code tasks").
- Implementation tasks (future) will add real build/test validation via `validate_deliverable.sh`
  (docker build of the reusable Dockerfile for representative services + existing Jest suite).

## Deployment Approach
- No deployment for Task 1. Future implementation will continue to use Cloud Build
  (`cloudbuild.*.yaml`) → Artifact Registry → Cloud Run, with the `_DOCKERFILE` substitution
  pointing at the shared reusable Dockerfile, per `architecture.yaml` `deploymentDefaults`.

## Dependencies
- `architecture.yaml` (service `entry:`, `deploymentDefaults.cloud-run`).
- `infrastructure/deploy-cloud.sh` Dockerfile-resolution logic.
- `cloudbuild.oauth-flow.yaml` (reference parametrized build via `_DOCKERFILE`/`_SERVICE_NAME`/`_PORT`).

## Definition of Done
- Project-wide DoD applies. For Task 1 (documentation-only): document is complete, accurate,
  traceable to REQ-001 in `request-log.md`, and consistent with `architecture.yaml`.

## Task Tracker
- [x] **Task 1 — Technical Architecture document** (`documentation/technical-architecture/reusable-service-dockerfile.md`).
- [x] **Task 2 — Execution Plan & Trackable Prioritized YAML Backlog** (Lead Implementor):
  `planning/sprint-318-c0c7c5/execution-plan.md` + `planning/sprint-318-c0c7c5/backlog.yaml`
  (phases 0–7, gates G0–G6, items BL-001…BL-013). Planning-only; **awaiting user approval before
  implementation** (§2.4 approval gate).
- [x] **Task 3 — Implementation** (APPROVED 2026-06-22, REQ-003): executed the full backlog
  (BL-001 … BL-013). Created `Dockerfile.service` + usage doc; wired `extract-config.js`/`deploy-cloud.sh`/
  Cloud Build/Compose/`bootstrap-service.js` to the shared file; removed 16 per-service Dockerfiles
  (brat + obs-mcp retained as escape hatches); added `architecture.yaml` `build:` block + explicit
  `port: 3010`; extended `validate_deliverable.sh`; updated README; produced verification-report,
  retro, key-learnings, publication. Verified via extract-config, real `deploy-cloud.sh --dry-run`,
  YAML parse (23 files), jest (8/8), `bash -n`. (No docker locally → image build/boot validated
  logically per AGENTS.md §2.6.)
