# Sprint 11 Execution Plan — Advanced URL Map YAML Generation + Import Mechanics

Sprint: sprint-11-c7a9d3
Date: 2025-11-14
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plans:
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (authoritative multi-sprint plan, Sprint 11 lines 106–119)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (URL Map strategy lines 96–105; orchestration lines 193–201; inputs/outputs lines 173–192)

## 1. Objective & Scope
Deliver the YAML-first URL Map workflow for the External Managed HTTPS Load Balancer:
- Generate desired-state URL Map YAML from architecture.yaml
- Guarded import: describe current → diff → conditional gcloud import
- Make Terraform/CDKTF own only a stub URL map and ignore drift (lifecycle ignore_changes)
- Wire into brat CLI so the import runs post-apply for lb in non-prod (dev/staging); prod is plan-only

Out of scope:
- Creating or modifying backends/NEGs (Sprint 9 responsibility)
- Production cutover (Sprint 12)

## 2. Deliverables
1) URL Map YAML Generator (library + CLI)
- Location: tools/brat/src/lb/urlmap/
  - renderer.ts — Converts architecture.yaml to URL Map YAML object
  - schema.ts — zod schemas for generator inputs and YAML shape
  - fixtures/ — test fixtures for inputs and expected YAML
  - index.ts — export API
- Command: brat lb urlmap render --env <env> --out infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml

2) Guarded Import Flow
- Location: tools/brat/src/lb/importer/
  - importer.ts — describe/diff/import logic using gcloud
  - diff.ts — structural diff that ignores ordering and non-material metadata
  - index.ts — export API
- Command integration:
  - brat infra apply lb --env <env> will:
    1) run CDKTF/Terraform apply as today
    2) then call importer to reconcile the URL map using the rendered YAML when not --dry-run and env != prod
  - brat lb urlmap import --env <env> --dry-run supported for CI

3) Terraform/CDKTF Adjustments (stub + ignore_changes)
- Update infrastructure/cdktf/lb/main.ts to:
  - ensure a minimal google_compute_url_map resource exists with name only
  - add lifecycle ignore_changes on fields owned by YAML import
  - output urlMapName so the importer knows which map to target

4) CI & Docs
- Cloud Build: add a step that runs `brat lb urlmap render --env=dev` and `brat lb urlmap import --env=dev --dry-run`
- Docs: README notes under infrastructure/cdktf/lb/ explaining YAML-first approach

## 3. Detailed Design

3.1 Generator Inputs (from architecture.yaml)
- Environments: dev, staging, prod
- Domains per public surface; service → domain mapping
- Routes: hostRules, path-based matchers, optional header matches, rewrites, and canary weights
- Backend services: names produced by Sprint 9 CDKTF lb stack (be-<service>)

3.2 Rendering Rules
- URL Map name: bitbrat-global-url-map
- defaultService: be-default if specified; otherwise primary app or api backend
- For each domain group:
  - hostRules: hosts list → pathMatcher name derived as <group>-matcher
  - pathMatchers:
    - defaultService: backend for that host group
    - routeRules:
      - Convert path prefix patterns to matchRules.prefixMatch
      - Optional header conditions via headerMatches
      - routeAction.urlRewrite.pathPrefixRewrite when configured
      - routeAction.weightedBackendServices for canaries (weights must sum to 100; validate)
- Project substitution: replace ${PROJECT} tokens with selected project ID at render time
- Output YAML stored at infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml

3.3 Guarded Import Algorithm
- Inputs: projectId, env, urlMapName, sourceYamlPath
- Steps:
  1) Describe current state: `gcloud compute url-maps describe <urlMapName> --global --project <project>`
  2) Normalize describe output to comparable YAML (strip timestamps, fingerprints)
  3) Compute diff against desired YAML
  4) If no diff: exit 0 with message "No drift detected"
  5) If diff and not --dry-run and env in {dev, staging}: run
     `gcloud compute url-maps import <urlMapName> --global --source=<file> --project <project> --quiet`
  6) Re-describe and assert parity; log summary; return non-zero on mismatch
  7) If env==prod: never import automatically; print diff and guidance only

3.4 CDKTF Lifecycle Settings
- google_compute_url_map.resource with lifecycle ignore_changes on: default_service, host_rule, path_matcher, test
- Maintain only the resource name in Terraform state to avoid churn

## 4. Acceptance Criteria
- Dev/staging URL maps imported and `describe` matches desired YAML; CI diff is clean
- Guarded import is idempotent; re-running with no changes results in no-op
- Terraform URL map resource uses lifecycle ignore_changes and remains stable across imports
- Unit tests pass for renderer; integration dry-run passes for importer in CI

## 5. Testing Strategy
- Unit (Jest):
  - schema validation for inputs and rendered YAML shape (zod)
  - renderer outputs match fixture snapshots for multiple scenarios (simple host, path rules, header match, canary weights)
  - weight validation errors when sum != 100
- Integration (non-prod only):
  - mock gcloud in CI to simulate describe/import
  - provide a local e2e in a test project when available; CI runs with --dry-run

## 6. Deployment & CI
- Cloud Build additions (cloudbuild.brat.yaml):
  - Step A: npm ci && npm run build
  - Step B: brat lb urlmap render --env=dev
  - Step C: brat lb urlmap import --env=dev --dry-run
- `validate_deliverable.sh` continues to run npm ci, build, and tests; importer invoked only with --dry-run

## 7. Risks & Mitigations
- Provider gaps: address via YAML-first and ignore_changes lifecycle
- Cert provisioning delays: not in scope for Sprint 11; mention in preflight docs
- State drift: importer diff step ensures changes are intentional; CI detects drift

## 8. Work Breakdown & Timeline
- Day 1: Define schemas and fixtures; scaffold renderer and importer packages
- Day 2: Implement renderer rules and snapshot tests
- Day 3: Implement importer describe/diff and dry-run
- Day 4: Wire into brat CLI and CDKTF URL map stub updates
- Day 5: CI plumbing, verification, and documentation

## 9. Definition of Done
- All acceptance criteria met; tests green; dry-run import in CI is clean
- Planning artifacts validated via planning/sprint-11-c7a9d3/validate_deliverable.sh

## 10. Traceability
- Sprint 6 Technical Architecture: URL Map strategy (lines 96–105), orchestration (lines 193–201)
- Multi-sprint Implementation Plan: Sprint 11 scope (lines 106–119)
