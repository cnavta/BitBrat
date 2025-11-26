# Sprint 6 — Implementation Plan

Sprint ID: sprint-6-d7e4b0
Date: 2025-11-11
Author: Cloud Architect
Source of Truth: architecture.yaml

## Objective & Scope
Design the technical architecture and delivery approach for:
- CDKTF network stack: VPC, subnets, Cloud Router, Cloud NAT, baseline firewalls
- CDKTF load balancer: Global External Managed HTTP(S) LB with advanced URL Map, front-end, backend services/NEGs
- URL Map strategy: YAML-first advanced config with import workflow

This sprint focuses on architecture and planning artifacts; implementation will start next sprint.

## Deliverables
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md
- planning/sprint-6-d7e4b0/implementation-plan.md (this file)
- planning/sprint-6-d7e4b0/request-log.md
- planning/sprint-6-d7e4b0/validate_deliverable.sh

## Acceptance Criteria
- A comprehensive, actionable technical architecture document exists and aligns with architecture.yaml norms
- Clear mapping strategy from architecture.yaml services/ingress definitions to URL map backends and routes
- Documented CDKTF module boundaries, inputs/outputs, and orchestration flow through brat CLI
- Validation script exists and passes locally
- Policy defined: All Cloud Run services must attach to Serverless VPC Access connectors (one per region/env) for VPC egress
- Behavior defined and enforced: If no VPC/connector exists in target region, brat deploy fails preflight with a clear error unless `--allow-no-vpc` is explicitly set (CI disallows override)
- Dependencies and APIs for Serverless VPC Access are documented (vpcaccess.googleapis.com)
- Load Balancer frontend resource policy defined: support create-or-use-existing for Global Static IP and SSL certificate; production defaults to use-existing; brat preflights verify existence/ACTIVe status before cutover

## Dependencies & Assumptions
- architecture.yaml is canonical for services, domains, and deployment defaults
- GCP APIs enabled: Compute, Cloud Run, Cloud DNS/Certificate Manager (for certs), Artifact Registry
- CDKTF + google provider available in repo toolchain (to be added during implementation)
- Advanced URL map features may exceed Terraform coverage; we will use YAML import via gcloud guarded by CDKTF

## High-Level Design (Summary)
- Two CDKTF stacks: network and lb
  - network: VPC, subnets (per region), Cloud Router, Cloud NAT, baseline firewall, optional secondary ranges
  - lb: Global external managed HTTPS LB, managed certs, serverless NEGs for Cloud Run, backend services, URL map (YAML import), forwarding rules, target proxies, logging, optional Cloud Armor/CDN
- YAML-first URL Map: Generate from architecture.yaml; store per-env YAMLs; import idempotently via gcloud in a controlled Terraform/CDKTF step
- Orchestration: brat infra plan/apply delegates to CDKTF synth then terraform plan/apply

## Testing Strategy
- Documentation validation: lint/format; schema examples compile conceptually
- Dry-run validation: terraform/cdktf synth + plan (no resource creation) during implementation
- URL map import dry-run: use `gcloud compute url-maps describe` diff checks before apply (later)
- Unit tests (next sprint): helpers that render URL map YAML from inputs

## Deployment Approach
- Environments: dev, staging, prod using per-env variables derived from architecture.yaml and env/<env> overlays
- State: Terraform remote backend (GCS) per environment/workspace (to be set up during implementation)
- CI: Cloud Build invokes brat infra plan/apply with `--dry-run` for PRs and apply on main; artifacts in Artifact Registry

## Risks & Mitigations
- Advanced URL map features unsupported in provider: mitigate with YAML import via gcloud and ignore_changes on Terraform-managed stubs
- Drift: Describe/diff before import; document reconciliation flow; treat YAML as source of truth for URL maps
- Permissions: Ensure service account roles for Compute Admin, Security Admin (for certs), DNS Admin if needed

## Definition of Done (DoD)
- Documentation complete, consistent, and traceable to this sprint ID
- Validation script runs and passes locally on a clean checkout
- All artifacts live under ./planning and comply with repository standards and Sprint Protocol

## Next Sprint (Implementation Preview)
- Scaffold CDKTF project structure under infrastructure/cdktf/{network,lb}
- Add zod-validated inputs from architecture.yaml in brat CLI
- Implement URL map YAML renderer and import mechanics
