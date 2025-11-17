# Sprint 9 — Load Balancer Implementation Plan (Dev Apply, no URL Map Import)

Sprint ID: sprint-9-b9f8c1
Role: Lead Implementor
Date: 2025-11-14
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (LB §5–§7)
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 9 scope/AC lines 70–90)
- planning/sprint-9-b9f8c1/lb-execution-plan.md

## Objective & Scope
Implement the HTTPS Load Balancer scaffolding in the dev environment using CDK for Terraform (CDKTF). This sprint delivers the frontend (global static IP, managed TLS certificate, target HTTPS proxy, global forwarding rule) and minimal backend wiring (stub URL map and placeholder backend service). Advanced URL Map generation/import and Cloud Armor are explicitly out of scope and deferred.

Important: Use the following explicit dev resource names provided by the user.
- Dev static IP name: birtrat-ip
- Dev TLS certificate name: bitbrat-dev-cert

## Deliverables
- CDKTF synth for LB in brat provider:
  - tools/brat/src/providers/cdktf-synth.ts: add explicit handler for module "load-balancer"
  - Generate Terraform that includes:
    - google_compute_global_address (name: birtrat-ip for env=dev)
    - google_compute_managed_ssl_certificate (name: bitbrat-dev-cert) with SAN(s) derived from architecture.yaml
    - Minimal google_compute_backend_service (be-default) with logging enabled
    - google_compute_url_map (bitbrat-global-url-map) pointing to be-default (stub)
    - google_compute_target_https_proxy referencing the managed cert and URL map
    - google_compute_global_forwarding_rule on TCP/443 referencing proxy and static IP
  - Outputs: globalIpAddress, urlMapName, certificateResourceNames, backendServiceNames
- CLI Wiring:
  - tools/brat/src/cli/index.ts: route `brat infra plan|apply lb` to synthModule('load-balancer') and terraform plan/apply flow
  - Ensure outputs.json is produced after plan/apply (real outputs or structured diagnostics)
- Tests:
  - tools/brat/src/providers/cdktf-synth.lb.spec.ts: assertions for resource names (birtrat-ip, bitbrat-dev-cert), presence of proxy, forwarding rule, and multi-line variable blocks
- Documentation/runbooks:
  - Update planning index and request log (this plan)
  - Verification commands in planning/sprint-9-b9f8c1/network-verify-runbook.md (LB section)

## Acceptance Criteria
- `brat infra plan lb --env=dev` runs successfully in CI (plan-only) and locally (dry-run), synthesizing the LB Terraform files under infrastructure/cdktf/out/load-balancer
- Local `brat infra apply lb --env=dev` (outside CI, with approvals) provisions:
  - Global static IP with name birtrat-ip
  - Google-managed SSL certificate with name bitbrat-dev-cert
  - Target HTTPS proxy and global forwarding rule on 443
  - Stub URL map and placeholder backend service
- Outputs file exists at infrastructure/cdktf/out/load-balancer/outputs.json containing either real outputs or a structured diagnostic payload
- Jest tests for the LB synth pass

## Testing Strategy
- Unit tests:
  - Validate Terraform contains expected resources and names (birtrat-ip, bitbrat-dev-cert)
  - Regression: variable blocks are multi-line (no single-line multi-arg blocks)
- Manual verification after dev apply:
  - gcloud compute addresses describe birtrat-ip --global
  - gcloud compute ssl-certificates describe bitbrat-dev-cert --global
  - gcloud compute url-maps describe bitbrat-global-url-map
  - gcloud compute target-https-proxies list | grep bitbrat
  - gcloud compute forwarding-rules list --global | grep 443

## Deployment Approach
- CI: `npm ci && npm run build && brat infra plan lb --env=dev --dry-run`
- Local (authorized engineer): `brat infra apply lb --env=dev` guarded; applies blocked when CI=true or --dry-run provided
- Optional GCS backend for Terraform state, disabled in CI; enabled locally when BITBRAT_TF_BACKEND_BUCKET is set

## Dependencies
- GCP project and credentials
- Compute API enabled
- architecture.yaml values for default region and default domain
  - Primary SAN sourced from: infrastructure.main-load-balancer.routing.default_domain (fallback: api.bitbrat.ai)

## Definition of Done (DoD)
- All Acceptance Criteria above satisfied
- Unit tests pass in CI
- planning/index.md includes link to this plan
- planning/sprint-9-b9f8c1/request-log.md updated with this planning step

## Notes & Trade-offs
- Backend services and serverless NEGs for individual Cloud Run services are deferred to a follow-up iteration within Sprint 9 once frontend scaffolding is verified (or to Sprint 10 if timeboxed)
- Advanced URL Map generation/import is deferred to Sprint 11; the Terraform URL map is a minimal stub for dependency wiring
- Production will use use-existing modes for IP/cert with brat preflights (deferred)
