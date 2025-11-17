# Sprint 10 Execution Plan — Serverless VPC Connectors + brat Preflight Enforcement

Sprint: sprint-10-ae91d4
Date: 2025-11-14
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Plans:
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (authoritative multi-sprint plan)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md

## 1. Objective & Scope
Deliver Serverless VPC Access connectors per environment/region and enforce their presence (with VPC, subnets, Cloud Router/NAT) via brat CLI preflight checks during service deploy. Focus is dev environment apply; CI remains dry-run only.

In scope:
- CDKTF module to provision Serverless VPC Access connectors attached to Sprint 8 network subnets
- brat CLI preflight enforcement: require VPC + subnet + router/NAT + connector; `--allow-no-vpc` dev-only override blocked in CI
- Documentation for connector CIDR sizing and API enablement (vpcaccess.googleapis.com)

Out of scope:
- URL Map generation/import (Sprint 11)
- Production rollout (Sprint 12)

## 2. Deliverables
1) Infrastructure code (scaffold):
- infrastructure/cdktf/connectors/{main.ts, config.ts, outputs.ts} — CDKTF app/module
- env overlays: use existing patterns (no duplication of architecture.yaml)

2) brat CLI changes:
- tools/brat/src/cli: add preflight checks invoked by `brat deploy services`
- tools/brat/src/providers/gcp: helpers to assert presence of VPC, subnet, Cloud Router/NAT, Serverless VPC connector
- Flag handling: `--allow-no-vpc` (dev-only), blocked in CI

3) Documentation:
- planning notes embedded here and comments in config templates describing CIDR sizing (/28 minimum) and region mapping

## 3. Acceptance Criteria
- Connectors defined and applied in dev: `brat infra apply connectors --env=dev` (guarded; local only)
- Outputs: connector names exported per region
- brat deploy services fails if connectors missing unless `--allow-no-vpc` is set; CI blocks the override
- Unit tests for preflight logic (matrix of env/region and presence/absence cases)

## 4. Testing Strategy
- Jest unit tests for preflight logic (mock GCP describe calls)
- Snapshot tests for CDKTF connector synthesis (Terraform JSON) to assert naming and inputs
- CI job (plan only) executes: `npm ci && npm run build && brat infra plan connectors --env=dev`

## 5. Deployment Approach
- CDKTF with GCS remote state (reuse backend conventions from network stack)
- Apply only in dev via manual approval; CI runs plan only
- Ensure Serverless VPC Access API enabled prior to apply

## 6. Dependencies
- Sprint 8 network stack applied in target region/env (VPC, subnets, router/NAT)
- GCP project and permissions for Terraform service account

## 7. Definition of Done
- All acceptance criteria above satisfied
- Planning artifacts committed and `planning/sprint-10-ae91d4/validate_deliverable.sh` passes
- Root validate_deliverable.sh passes unaffected

## 8. Risks & Mitigations
- API not enabled: Add preflight to enable/check vpcaccess.googleapis.com; document requirement
- CIDR exhaustion or conflicts: document sizing; default /28 per connector; validate unique per region
- Region mismatch: enforce region alignment between connector and subnet

## 9. Work Breakdown & Timeline
- Day 1–2: CDKTF connectors module scaffolding and synth tests
- Day 3: brat preflight enforcement + unit tests
- Day 4: Dev apply (local) and evidence capture; docs update
- Day 5: Verification report and PR publication metadata

## 10. Traceability
This plan implements Sprint 10 from the multi-sprint plan; see planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 10 section).