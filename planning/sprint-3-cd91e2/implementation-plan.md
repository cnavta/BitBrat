# Sprint 3 Implementation Plan — Networking, Security, and Release Readiness (oauth-flow)

Sprint ID: sprint-3-cd91e2
Date: 2025-11-07
Owner: Cloud Architect
Sources: architecture.yaml, planning/next-sprint-recommendations.md

## Sprint Inputs & Confirmed Constraints
- Domain/DNS: Use api.bitbrat.ai for oauth-flow externally (architecture.yaml default)
- Environments: Local Docker Compose and remote GCP Prod only (no remote dev environment this sprint)
- Release Strategy: No canary or blue/green required (no traffic yet)
- Load Balancers: All external and internal LBs MUST use Serverless NEGs to access services
- Budget: Configure a Monthly Budget alert of $200
- Scaling: Use the defaults for oauth-flow

## Objective
Elevate the oauth-flow service to a production-ready posture by introducing controlled networking (VPC, SVPC connector, NAT), secure ingress (internal-only Cloud Run behind HTTPS Load Balancers), IAM hardening, DNS/TLS, CI/CD to prod with digest deploys, observability, and smoke/integration tests. Align strictly to architectural intent encoded in architecture.yaml.

## Scope
In scope for this sprint (production-first):
- Provision VPC with regional subnets in us-central1
- Serverless VPC Access connector for Cloud Run egress to VPC
- Cloud NAT for internet egress from private ranges
- Firewall rules (least privilege)
- Convert oauth-flow Cloud Run to internal-only ingress (no unauthenticated)
- External HTTPS Load Balancer with Serverless NEG to oauth-flow
- Internal HTTPS Load Balancer with Serverless NEG for private VPC consumers (feature availability required)
- IAM tightening (no allUsers invoker; per-service SAs; least privilege; secret version pinning)
- DNS zone and managed certificates for the External LB (api.bitbrat.ai)
- CI/CD: prod deploy only, build-by-digest (no canary/blue-green), optional manual approval
- Observability: Monitoring dashboard JSON, alert policies, uptime checks
- Tests: integration and smoke tests hitting the External LB
- Cost guardrails: $200 budget alert

Out of scope this sprint:
- Service mesh/mTLS, PSC to downstreams, multi-service refactors beyond oauth-flow
- Remote dev environment/overlay
- Canary or blue/green rollout mechanics

## Deliverables
Infrastructure as Code (Terraform under infrastructure/gcp):
- modules/vpc/
- modules/svpc_connector/
- modules/nat/
- modules/lb-external/ (Serverless NEG, Cloud Armor WAF, Managed Cert)
- modules/lb-internal/ (Serverless NEG; contingent on regional feature availability)
- modules/dns/
- modules/certs/
- overlays/prod/main.tf using modules above

Cloud Run module updates:
- infrastructure/gcp/modules/cloud-run-service/
  - Enforce internal ingress
  - Remove unauthenticated invoker bindings
  - Pin Secret Manager versions (no :latest)

CI/CD and scripts:
- Cloud Build trigger(s) for main branch with prod deploy by digest
- Optional manual approval gate; no staging/canary/blue-green this sprint

Validation and testing:
- Update root validate_deliverable.sh to include networking Terraform plans
- Add smoke test invoking External LB /healthz
- Add integration tests for oauth endpoints via External LB

Monitoring:
- Dashboard JSON (latency, error rate, RPS, auth failures)
- Alert policies for 5xx, p95 latency, health check fails, build failures
- Uptime checks targeting External LB hostname

Documentation:
- This implementation plan (planning/sprint-3-cd91e2/implementation-plan.md)
- Verification report template
- Runbooks (networking, DNS/TLS, deploy, secret rotation, incident response)

## Architecture Alignment
- architecture.yaml declares a global external application LB with routing to oauth-flow paths and static assets. This sprint implements that intent using a Serverless NEG and Google Managed Certificates, with Cloud Armor WAF policies applied.
- Defaults specify network: bitbrat-prod-vpc and region us-central1; this plan creates that VPC and attaches serverless workloads via SVPC connector. Scaling and health endpoints remain consistent with defaults.

## Acceptance Criteria
Networking
- Terraform plan/apply creates VPC, subnets, SVPC connector, NAT, and least-privilege firewall rules without drift
- validate_deliverable.sh runs Terraform plan for networking modules (dry-run safe)

Ingress & Load Balancers
- oauth-flow Cloud Run set to internal-only ingress; unauthenticated access removed
- External HTTPS LB terminates TLS with Google Managed Certificate; DNS A/AAAA records for api.bitbrat.ai point to LB IP
- Serverless NEG backend targets oauth-flow for both External and Internal LBs; Cloud Armor WAF baseline policy enabled externally
- /healthz reachable via External LB; direct unauthenticated Cloud Run access blocked
- Internal HTTPS LB available for private VPC callers (if feature support confirmed); otherwise, documented alternative path

IAM & Secrets
- No allUsers invoker in prod; invocations authenticated via LB/IAP or signed identity tokens
- Separate runtime service accounts per service with least-privilege on secrets and GAR
- Secret Manager versions explicitly pinned; rotation plan documented

DNS & TLS
- Managed certs ACTIVE for api.bitbrat.ai
- DNS zone configured and records resolve successfully

CI/CD
- Cloud Build trigger(s) on main produce image digests; deploy to prod by digest
- No canary/blue-green or staged promotion required this sprint
- validate_deliverable.sh supports dry-run of deploy steps

Observability
- Monitoring dashboard JSON committed
- Alert policies created; synthetic scenario validates alerts fire
- Uptime check configured for External LB hostname

Testing
- Integration tests hit External LB endpoint(s) and validate oauth callback flow with mocks
- Post-deploy smoke test: curl /healthz via External LB returns 200

Cost & Safety
- Budget alert configured at $200/month
- Cloud Run scaling uses oauth-flow defaults
- No unintended public IP resources

Documentation
- Runbooks updated under planning/
- Implementation plan and verification report included and referenced by manifest

## Testing Strategy
- Unit tests for any repository scripts/helpers introduced
- Integration tests (Jest) that:
  - Resolve LB hostname (from environment) and request /healthz expecting 200
  - Exercise oauth initiation and callback paths with mocked external dependencies
- CI runs tests on every PR and before deploy
- Smoke test executed from validate_deliverable.sh after deploy (or dry-run placeholders until infra exists)

## Deployment Approach
- Canonical execution command for this sprint: `npm run deploy:cloud`
  - Examples:
    - Dry-run (no side effects): `npm run deploy:cloud -- --dry-run`
    - Plan only (default): `npm run deploy:cloud`
    - Apply (prod): `npm run deploy:cloud -- --apply`
- Cloud Build pipeline stages:
  1) Build & push container; capture image digest
  2) Deploy to prod by digest; run tests (integration) and smoke test
- All deploys reference architecture.yaml for service configuration; parameters passed via substitutions

## Dependencies
- DNS zone ownership or delegation in GCP
- Confirmation of Internal HTTPS LB Serverless NEG support in us-central1 (feature availability)

## Risks & Mitigations
- Managed cert activation delays — begin early; use placeholder DNS then update
- Egress via VPC connector may break external API calls — ensure NAT configured; validate Twitch API outbound
- ILB feature gaps — document alternate approach (e.g., Envoy proxy) if needed
- Budget overruns — configure budgets and limits; tear-down plan for non-prod

## Work Breakdown & Milestones
1. Networking modules (VPC, SVPC, NAT, firewall) + root validate script updates
2. External LB + DNS + certs + Cloud Armor WAF (Serverless NEG)
3. Internal LB (Serverless NEG) or document alternative if unsupported
4. Cloud Run module updates: internal ingress, invoker removal, secret pinning
5. CI/CD: trigger(s), prod digest-based deploy
6. Observability: dashboards, alerts, uptime
7. Tests: integration + smoke
8. Documentation and runbooks

## Definition of Done
- Code quality aligns with project standards and architecture.yaml
- Basic unit tests included for new scripts and helpers
- Deployment artifacts present: Dockerfile (existing), cloudbuild YAML (existing/updated), Terraform modules and overlays (new)
- Root validate_deliverable.sh passes (compiles, tests, dry-run deploy; Terraform plan steps added when modules exist)
- Traceability: All artifacts linked from sprint-manifest.yaml and planning/index.md; request-log updated

## Approval Gate
Per Sprint Protocol v2.2, coding/infra changes MUST NOT begin until this plan is approved.