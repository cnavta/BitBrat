# Network & Load Balancer Epic — Progress Summary and Forward Plan

Sprint ID: sprint-9-b9f8c1
Date: 2025-11-13
Role: Lead Implementor
Source of Truth: architecture.yaml
Upstream Plans:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md

## 1) Summary of Work Completed Against the Plan

Evidence-based assessment using repo state and prior sprint docs:

- CDKTF Scaffolding and CLI Wiring
  - Placeholders for CDKTF modules exist:
    - infrastructure/cdktf/network/main.ts (placeholder)
    - infrastructure/cdktf/lb/main.ts (placeholder)
    - infrastructure/cdktf/lb/url-maps/dev/url-map.yaml (placeholder path present)
  - Brat CLI supports `infra plan|apply` for modules (tools/brat changes present). Apply is guarded and disabled in CI/dry-run.
  - CI/Cloud Build dry-run configured (cloudbuild.brat.yaml, cloudbuild.infra-plan.yaml updated).
  - Synth outputs are generated under infrastructure/cdktf/out/{network,load-balancer} (Terraform JSON and tfplan present), confirming end-to-end plan flow.
  - Sprint-8 verification report indicates unit tests passed (14 suites, 43 tests) and validate_deliverable.sh succeeded.

- Planning Artifacts
  - Sprint-6 technical architecture and multi-sprint implementation plan approved and in repo.
  - Sprint-7 (plan-only) and Sprint-8 (implementation of scaffolding + CI) documents are present with verification.

Notes on variance vs Sprint-6 baseline plan:
- The baseline planned Sprint 8 = Network MVP (apply to dev). Actual Sprint 8 delivered scaffolding+CI instead. Net effect: execution is one sprint behind the original sequence for infra provisioning, but risk reduced via CI parity established early.

## 2) Summary of Work Remaining

Remaining scope to complete the epic per Sprint-6 plan, adjusted for current state:

- Network Stack (CDKTF) — MVP apply to dev
  - Implement VPC (custom), subnets (Private Google Access), Cloud Router, Cloud NAT, baseline firewalls.
  - Configure remote Terraform state (GCS) with per-env workspaces.
  - Export outputs (VPC selfLink, subnet selfLinks, router/NAT names).

- Load Balancer Stack (CDKTF)
  - Global external IP (create or use-existing), managed SSL certificates (create or use-existing).
  - Serverless NEGs for Cloud Run services (from architecture.yaml) and backend services with logging.
  - Target HTTPS proxy and global forwarding rule (HTTPS-only). URL map initially as Terraform stub.

- Serverless VPC Access
  - Provision connectors per region/environment and attach to network subnets.
  - Enforce presence via brat CLI preflight for all service deployments; add `--allow-no-vpc` dev-only override. Ensure vpcaccess.googleapis.com enabled.

- Advanced URL Map — YAML-first
  - Implement YAML generator from architecture.yaml.
  - Guarded import flow: describe → diff → import; lifecycle ignore_changes on URL map in Terraform.

- Production Cutover & Hardening
  - Use-existing IP/cert in prod; DNS readiness checks; optional Cloud Armor; monitoring/alerts.
  - Update validate_deliverable.sh and CI to include infra dry-run.

- Testing and CI enhancements
  - Jest unit tests: config schemas (zod), naming conventions, URL map rendering.
  - Integration tests: terraform plan snapshots; import flow in non-prod project.
  - Ensure CI image has Terraform (or switch to cloudbuild.infra-plan.yaml consistently).

## 3) Challenges and Risks

- URL Map provider coverage gaps: must rely on YAML import; ensure robust diffing to avoid churn.
- Certificate readiness: Google-managed certs may take time; need ACTIVE status before prod cutover.
- Existing resource wiring (prod): Correctly data-source pre-provisioned IP/certs; avoid taking ownership inadvertently.
- Architecture.yaml fidelity: All inputs must be derived from architecture.yaml/env overlays to prevent drift/duplication.
- CI environment parity: Ensure Terraform version is pinned and available; otherwise use a custom Cloud Build image or dedicated infra plan pipeline.
- Access and quotas: Enable required APIs (Compute, VPC Access); validate IAM permissions; watch for regional quota limits.
- Safety and guardrails: Prevent accidental apply in CI or wrong project/region; enforce `--dry-run` and explicit approvals.

## 4) Sprint-by-Sprint Plan to Complete Remaining Work

The plan realigns the original Sprint-6 sequence with current progress. Target four sprints (9–12):

- Sprint 9 — Network Stack MVP (Dev Apply)
  - Deliverables:
    - CDKTF network implementation: VPC, subnets (PGA), Cloud Router/NAT, baseline firewalls.
    - Remote state (GCS) configured per env/workspace.
    - brat: `infra plan/apply network --env=dev` (apply allowed locally, blocked in CI).
    - Unit tests: naming conventions; TF JSON snapshot of synthesized plan.
  - Acceptance:
    - `brat infra plan/apply network --env=dev` succeeds; outputs exported and validated via gcloud describes.

- Sprint 10 — Load Balancer Stack (Dev Apply without URL Map Import)
  - Deliverables:
    - ipMode (create|use-existing) + ipName; certMode (create|use-existing) + certRef.
    - Serverless NEGs for Cloud Run services; backend services with logging.
    - Target HTTPS proxy + global forwarding rule; URL map stub under Terraform with ignore_changes prepared.
    - Preflight checks for use-existing IP/cert (describe-only).
  - Acceptance:
    - `brat infra plan/apply lb --env=dev` succeeds; outputs: globalIpAddress, urlMapName (stub), backendServiceNames.

- Sprint 11 — Serverless VPC Connectors + brat Preflight Enforcement
  - Deliverables:
    - Provision connectors per region/env attached to subnets; outputs exported.
    - brat deploy preflights: require VPC, subnets, router/NAT, connector; add `--allow-no-vpc` (dev-only) and block in CI.
    - Documentation of connector sizing and API enablement.
  - Acceptance:
    - Connectors applied in dev; brat deploy fails without connectors unless override provided.

- Sprint 12 — Advanced URL Map + Production Cutover and Hardening
  - Deliverables:
    - YAML generator from architecture.yaml; guarded import (describe/diff/import) for dev/staging; prod plan-only dry run first.
    - Production apply using use-existing IP/cert; DNS validation; optional Cloud Armor; monitoring/alerts.
    - CI/root validate_deliverable.sh updated to run infra dry-run; verification report and PR publication per protocol.
  - Acceptance:
    - Dev/staging URL maps match desired YAML; prod cutover validated; verification and PR published with DoD satisfied.

## 5) Definition of Done for the Epic
- All infra code aligns with architecture.yaml; no duplicated config.
- Dry-run is safe and the default for PRs; applies are guarded.
- All Cloud Run services with VPC egress via connectors; preflights enforced.
- Production uses use-existing IP/cert with ACTIVE status verification.
- Passing tests and successful dry-run; verification report and PR per Sprint Protocol.

## 6) Traceability
- Derived from: sprint-6 planning docs; reconciled with sprint-7/8 artifacts and verification.
- This summary is the authoritative status input for subsequent implementation sprints.
