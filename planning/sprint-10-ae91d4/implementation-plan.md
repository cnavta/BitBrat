# Sprint 10 Implementation Plan — Serverless VPC Connectors + brat Preflight Enforcement

Sprint: sprint-10-ae91d4
Date: 2025-11-14
Role: Lead Implementor
Source of Truth: architecture.yaml
Related: 
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 10 scope)
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md

## Objective
Provision Serverless VPC Access connectors per environment/region and enforce VPC/connector requirements in brat deploy flows. Deliver dev environment apply; CI remains plan-only.

## Deliverables
- CDKTF connectors module: infrastructure/cdktf/connectors/{main.ts,config.ts,outputs.ts}
- brat CLI preflight checks for VPC + subnet + router/NAT + connector; add `--allow-no-vpc` (dev-only) and block in CI
- Documentation for connector CIDR sizing (/28 minimum) and enabling vpcaccess.googleapis.com

## Acceptance Criteria
- Connectors created/applied in dev; outputs export connector names per region
- `brat deploy services` fails without connectors unless `--allow-no-vpc` set; CI blocks override
- Unit tests for preflight logic using simulated config matrices

## Testing Strategy
- Jest unit tests for preflight logic (mock GCP calls)
- Snapshot tests for CDKTF connector synth
- CI dry-run executes: `npm ci && npm run build && brat infra plan connectors --env=dev`

## Deployment Approach
- Use CDKTF with GCS remote state; plan in CI, apply locally with approvals
- Ensure Serverless VPC Access API enabled before apply

## Dependencies
- Sprint 8 network stack applied (VPC, subnets with PGA, router/NAT)

## Definition of Done
- All acceptance criteria are satisfied
- Planning artifacts validated via planning/sprint-10-ae91d4/validate_deliverable.sh
- Linked from planning/index.md

## Risks & Mitigations
- API enablement: preflight check and docs
- CIDR sizing conflicts: recommend /28 per connector, document
- Region mismatches: enforce alignment in config and preflight

## Timeline
- Days 1–2: CDKTF module scaffolding & tests
- Day 3: brat preflight enforcement & tests
- Day 4: Dev apply and evidence capture
- Day 5: Verification and PR metadata

## Traceability
Implements Sprint 10 from multi-sprint plan. Aligns with Sprint Protocol v2.2 and project DoD.