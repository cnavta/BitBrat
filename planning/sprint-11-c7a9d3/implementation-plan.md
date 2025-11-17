# Sprint 11 Implementation Plan — Advanced URL Map YAML Generation + Import Mechanics

Sprint: sprint-11-c7a9d3
Date: 2025-11-14
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plans:
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 11 scope lines 106–119)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (URL Map YAML strategy lines 96–105; orchestration lines 193–201; inputs/outputs lines 173–192; naming lines 209–218)

## Objective & Scope
Implement the YAML-first URL Map workflow for the Global External Managed HTTPS Load Balancer. The generator will render desired state from architecture.yaml and env overlays, and a guarded importer will describe/diff/import changes for non-prod environments. Terraform/CDKTF will maintain a minimal URL map stub with lifecycle ignore_changes.

## Deliverables
1) URL Map YAML Generator
- Library: tools/brat/src/lb/urlmap/{renderer.ts,schema.ts,index.ts}
- CLI: `brat lb urlmap render --env <env> --out infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml`
- Output: Deterministic YAML including hostRules, pathMatchers, routeRules, weighted backends; `${PROJECT}` substituted at render time.

2) Guarded Import Flow
- Library: tools/brat/src/lb/importer/{importer.ts,diff.ts,index.ts}
- Behavior: describe current map → normalize → structural diff → conditional gcloud import (non-prod only) → verify parity
- CLI: `brat lb urlmap import --env <env> [--dry-run]`
- Integration Hook: Post `brat infra apply lb`, call importer automatically for dev/staging when not `--dry-run`.

3) CDKTF/Terraform Adjustments
- infrastructure/cdktf/lb/main.ts: create minimal google_compute_url_map resource (name only) with lifecycle ignore_changes on provider-managed fields; output urlMapName.

4) CI & Docs
- Cloud Build (cloudbuild.brat.yaml): add render + import --dry-run steps for dev
- README under infrastructure/cdktf/lb/: document YAML-first approach and guardrails

## Acceptance Criteria
- Dev/staging URL maps imported; `gcloud compute url-maps describe` matches desired YAML
- Import flow is idempotent (no changes when re-run without edits)
- Terraform URL map stub remains stable with lifecycle ignore_changes
- Unit tests: renderer schemas and fixtures pass; importer diff logic covered
- Integration: CI dry-run passes for dev import; prod remains plan-only

## Testing Strategy
- Jest unit tests located alongside code (tools/brat/src/lb/**/__tests__):
  - Schema validation (zod) for inputs and rendered YAML shape
  - Renderer snapshot tests across scenarios (simple default, header match, canary weights)
  - Weight sum validation errors when not equal to 100
- Importer tests:
  - Diff normalization ignores ordering and metadata (fingerprints, timestamps)
  - Dry-run importer logs detected drift without executing import
- Integration in CI:
  - Run render and import --dry-run for env=dev

## Deployment Approach
- Non-prod (dev/staging): Import executed post-apply via brat hook when not `--dry-run`
- Prod: Import never auto-runs; print diff and guidance only
- Commands are safe for CI; use `--dry-run` by default in PRs

## Dependencies
- Sprint 9 LB stack applied in dev/staging (backend services and NEGs available)
- gcloud available in CI runner; Google Cloud APIs enabled (Compute)

## Risks & Mitigations
- Provider coverage gaps for advanced URL map: use YAML import and lifecycle ignore_changes
- State drift or unintended changes: mandatory describe/diff gate; CI requires clean diffs
- Backend naming mismatches: schemas validate service-to-backend mapping from architecture.yaml

## Definition of Done
- All acceptance criteria met
- All tests pass locally and in CI
- Planning docs validated via planning/sprint-11-c7a9d3/validate_deliverable.sh
- Links added to planning/index.md and publication metadata prepared

## Traceability
- Maps to Sprint 11 in planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (lines 106–119)
- Aligns with URL map strategy in planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (lines 96–105, 173–201, 209–218)
