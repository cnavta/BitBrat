Implementation Plan – sprint-113-8c4d1a2

Objective
- Reduce Pub/Sub latency by removing unnecessary Cloud NAT from our VPC and ensuring Cloud Run egress uses the most performant path while preserving ingress via Global External Application Load Balancer and VPC connectivity.

Scope
- In scope:
  - Remove Cloud NAT from IaC (CDKTF synthesized Terraform under infrastructure/cdktf/out/network/main.tf)
  - Keep Cloud Router and Private Google Access on subnets
  - Document Cloud Run egress setting to “Private ranges only” with Serverless VPC Connector
  - Update architecture.yaml to reflect networking posture
  - Produce validation plan (dry-run) and PR
- Out of scope:
  - Applying infrastructure changes in production (plan only)
  - Private Service Connect for Google APIs (not required)
  - Any service code changes unrelated to networking

Deliverables
- IaC change: remove google_compute_router_nat resources and related outputs
- Updated architecture.yaml (infrastructure networking notes)
- Planning artifacts in planning/sprint-113-8c4d1a2/
- validate_deliverable.sh script in sprint folder (logically passable)
- Verification report and publication metadata

Acceptance Criteria
- Terraform network stack no longer defines Cloud NAT
- Dry-run planning succeeds for network and connectors modules
- Documentation clearly states Cloud Run egress posture and LB ingress model
- PR created successfully (or failure logged with reason)

Testing Strategy
- Build and unit tests via npm test (no code changes expected to affect tests)
- Infra dry-run using existing brat infra plan commands for network and connectors

Deployment Approach
- External ingress continues via Global External Application Load Balancer
- Outbound:
  - Cloud Run services with VPC connector configured to egress: Private ranges only
  - Public traffic (Pub/Sub and other Google APIs) bypasses connector to use Google-managed egress, minimizing latency

Dependencies
- None new; uses existing CDKTF synth outputs in infrastructure/cdktf/out/
- gh CLI auth for PR creation (if fails, we will log and ask for credentials per AGENTS.md)

Definition of Done
- Changes comply with architecture.yaml
- No TODOs in production paths
- Jest tests pass locally
- validate_deliverable.sh is logically passable
- PR created or failure captured per Publication rules