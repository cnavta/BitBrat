# Sprint 9 Execution Plan — Network Stack MVP (Dev Apply)

Sprint ID: sprint-9-b9f8c1
Role: Lead Implementor
Date: 2025-11-13
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (Network §4)
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 8 scope/AC lines 51–69)
- planning/sprint-9-b9f8c1/network-lb-progress-summary.md

## 1. Objective
Implement the Network stack MVP in dev: provision a custom VPC, subnets with Private Google Access, Cloud Router, Cloud NAT, and baseline firewalls using CDKTF, with remote Terraform state in GCS. Enable `brat infra plan|apply network --env=dev` locally (apply remains blocked in CI).

## 2. Scope
- Network stack implementation delivered via brat HCL synth (authoritative this sprint)
  - Resources: VPC (custom), subnets (per region), Cloud Router, Cloud NAT, firewalls (allow-internal, allow-health-checks)
  - Enable Private Google Access on subnets
- Remote Terraform state: optional GCS backend with per-environment workspaces, guarded by env var BITBRAT_TF_BACKEND_BUCKET and disabled in CI
- CLI orchestration: brat infra plan/apply network --env=dev (apply disabled in CI)
- Outputs exported for downstream stacks: vpcSelfLink, subnet selfLinks, router/nat names

Non-goals:
- Load balancer resources (deferred to next sprints)
- Serverless VPC Access connectors (deferred to Sprint 11)
- Any production applies

## 3. Deliverables
- CDKTF code: infrastructure/cdktf/network/{main.ts, config.ts, outputs.ts}
- Schema validation for inputs using zod in config.ts
- GCS remote state wiring and workspace conventions documented
- brat CLI integration to synth, plan, and apply (local only) for network stack
- Unit tests: naming conventions and Terraform synth snapshot
- Runbook notes for verification with gcloud describes

## 4. Work Breakdown Structure (WBS)
1) Inputs & Schema
- Define NetworkConfig in config.ts with zod schema:
  - projectId: string
  - environment: enum("dev","staging","prod")
  - regions: string[] (e.g., ["us-central1"]) from architecture.yaml/env overlays
  - cidrBlocks: Record<string, string>
  - enableFlowLogs?: boolean (default false)
2) Resource Composition (main.ts)
- VPC: custom mode; name "brat-vpc"
- Subnets: name "brat-subnet-<region>-<env>", CIDR from cidrBlocks, enableFlowLogs optional, privateIpGoogleAccess=true
- Cloud Router: name "brat-router-<region>"
- Cloud NAT: name "brat-nat-<region>", auto-allocate external IPs
- Firewalls:
  - allow-internal: tcp/udp/icmp between 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (or tighter to created subnets per env)
  - allow-health-checks: sources 35.191.0.0/16, 130.211.0.0/22 to necessary ranges
3) State Backend & Workspaces
- Use GCS bucket (name convention: bitbrat-tfstate-<env>) with backend config
- Workspaces per environment (dev default)
- Document bootstrap requirement if bucket absent (plan-only in CI)
4) Outputs (outputs.ts)
- Export vpcSelfLink, subnet selfLinks (by region), routers/nats (by region)
5) brat CLI Wiring
- tools/brat infra provider: add network target to synth CDKTF → Terraform JSON under infrastructure/cdktf/out/network
- Plan: terraform init/plan with backend
- Apply: guarded; refuse in CI or when --dry-run set; allow local with explicit approval
6) Tests (Jest)
- Schema tests for config defaults/validation
- Snapshot of synthesized Terraform JSON for a sample dev overlay
- Name generation unit tests per conventions
7) Verification Steps (manual)
- After local apply in dev, verify:
  - gcloud compute networks describe brat-vpc
  - gcloud compute networks subnets describe brat-subnet-<region>-dev --region=<region>
  - gcloud compute routers describe brat-router-<region> --region=<region>
  - gcloud compute routers nats describe brat-nat-<region> --router=brat-router-<region> --region=<region>

## 5. Acceptance Criteria
- `brat infra plan network --env=dev` succeeds in CI (plan-only)
- Local `brat infra apply network --env=dev` creates VPC, subnets (with Private Google Access), router/NAT, and baseline firewalls without errors
- outputs.ts exposes vpcSelfLink, subnet selfLinks, router/nat names; brat displays or writes outputs
- Unit tests pass in CI; synth snapshot stable across runs

## 6. Testing Strategy
- Unit tests under infrastructure/cdktf/network/*.test.ts
- Mocks for filesystem and terraform CLI
- Optional integration: run terraform plan against a test project (dry-run) in CI using cloudbuild.infra-plan.yaml

## 7. Deployment Approach
- CI: `npm ci && npm run build && brat infra plan network --env=dev --dry-run`
- Local (authorized engineer only): `brat infra apply network --env=dev` with explicit approval flag
- Applies are blocked in CI and when --dry-run is present

## 8. Dependencies
- GCP project and credentials configured
- APIs enabled: compute.googleapis.com
- GCS bucket for state exists or documented bootstrap path

## 9. Risks & Mitigations
- Terraform version drift → pin versions; use consistent image in CI
- Accidental apply in CI → guard in brat; validate `CI=true` behavior
- CIDR conflicts → validate via schema and document per-env ranges

## 10. Timeline
- Day 1–2: Schema + resource composition draft, unit tests
- Day 3: brat wiring + synth/plan stable in CI
- Day 4–5: Local apply to dev, verification, refine tests and docs

## 11. Definition of Done (DoD)
- All AC satisfied and verified
- Unit tests pass in CI; validate_deliverable.sh for Sprint 9 passes
- Documentation updated: planning/index.md, this execution-plan.md; request-log entry added

## 12. Traceability
- Aligns with Sprint 6 plan (Sprint 8 scope shifted to Sprint 9) and technical architecture; references architecture.yaml-derived inputs throughout.
