# Recommended Scope for Next Sprint (Networking, Security, and Release Readiness)

Date: 2025-11-07
Sprint Reference: Next after Sprint 2 (oauth-flow CI/CD + Cloud Run baseline)
Source of Truth: architecture.yaml (values and intent)

Summary
- Focus the next sprint on networking hardening and controlled ingress/egress for oauth-flow, aligning with the stated direction: add a VPC and External/Internal Load Balancers; services should be Internal + ELB ingress only.
- Remove temporary allowances from Sprint 2 (unauthenticated access, public ingress) and introduce security, observability, and promotion practices required for a production posture.

Top Recommended Items (ordered)
1) VPC and Serverless Networking
- Create a dedicated VPC (prod) with regional subnets in us-central1.
- Add Serverless VPC Access connector for Cloud Run egress to VPC (reserve IP range, size per expected throughput).
- Add Cloud NAT for egress to the internet from private ranges when needed (e.g., calling Twitch APIs if routed via VPC connector). 
- Firewall rules: least privilege (egress as needed, controlled ingress for proxy components only).
- Acceptance criteria:
  - Terraform plan/apply creates VPC, subnets, SVPC connector, NAT, and minimal firewall rules without drift.
  - validate_deliverable.sh includes terraform plan for networking modules.

2) Ingress posture: Internal-only Cloud Run + HTTPS Load Balancers
- Switch oauth-flow Cloud Run to internal-only ingress; remove allow-unauthenticated.
- External HTTPS LB (Global): Use SSL certs and a Serverless NEG backend pointing to Cloud Run. Apply Cloud Armor WAF (basic ruleset) and limit exposure to required paths only (e.g., /oauth/*, /healthz still via authenticated/internal if desired). Use URL map and backend policy.
- Internal HTTPS LB (Regional): Provide internal access for private callers within the VPC (future internal services). Use an internal managed cert and Internal Managed LB with a Serverless NEG where supported; otherwise, proxy via Envoy/Proxyless with NEG.
- Acceptance criteria:
  - External LB terminates TLS with managed cert; DNS A/AAAA records point to LB IP.
  - Cloud Run remains internal-only; invoker IAM is restricted to the LB’s identity or appropriate SA.
  - Health checks pass through LB; /healthz reachable via LB; direct Cloud Run unauth access blocked.

3) Identity/IAM tightening and Secrets hygiene
- Remove unauthenticated invoker; require authenticated invocations via LB/IAP or signed identity tokens.
- Pin Secret Manager versions in Terraform (no :latest in prod), with rotation plan and labels.
- Separate runtime SAs per service; least privilege on secrets and GAR.
- Acceptance criteria:
  - No allUsers invoker bindings in prod.
  - Secrets mapped using specific versions; rotation runbook documented.

4) DNS and TLS
- Reserve and configure DNS zone/records for oauth-flow domain(s).
- Use Google Managed Certificates for External LB; internal cert for ILB if applicable.
- Acceptance criteria:
  - Managed certs become ACTIVE; DNS resolves; HTTPS works end-to-end.

5) CI/CD promotion and rollback
- Add Cloud Build Trigger(s) for main with staged deploy: build/push → stage/test → promote.
- Add canary/traffic-split support or blue/green where feasible for Cloud Run.
- Store image digests from build; deploy by digest for immutability.
- Acceptance criteria:
  - Trigger builds on main; deploys to prod only after tests pass (or manual approval gate).
  - validate_deliverable.sh supports dry-run and promotion steps.

6) Observability and SLOs
- Cloud Monitoring dashboards: latency, error rate, RPS; log-based metrics for auth failures.
- Alerts: 5xx error rate, latency p95, health check fail, build failure.
- Uptime check against External LB hostname.
- Acceptance criteria:
  - Dashboard JSON committed; alerts created and firing on synthetic scenarios.

7) Integration and smoke testing
- Add integration tests that hit the LB endpoint (unauth path as needed) and verify oauth callback flow shim with mocks where appropriate.
- Extend validate_deliverable.sh to run a post-deploy smoke test (curl /healthz via LB, status=200).
- Acceptance criteria:
  - Tests green in CI; smoke test green post-deploy.

8) Dev overlay (scoped)
- Add infrastructure/gcp/dev overlay reusing modules with minimal differences; still unauth optional for developer speed, or mirror prod posture if feasible.
- Acceptance criteria:
  - terraform plan succeeds for dev; images deploy to dev project path; dev smoke test available.

9) Cost and safety guardrails
- Budget + alert for project spend; max instance limits; audit for public IP resources.
- Acceptance criteria:
  - Budget alert configured; maxInstances set; no unintended public resources.

10) Documentation and runbooks
- Update implementation-plan and operational runbooks: networking, DNS/TLS, deploy/promotion, rotation procedure, incident response.
- Acceptance criteria:
  - Docs stored under planning/ with links from the sprint manifest; reviewed and up-to-date.

Deliverables Inventory (to be created next sprint)
- Terraform modules/overlays: vpc/, svpc_connector/, nat/, lb-external/, lb-internal/, dns/, certs/
- Updates to cloud-run-service module: ingress internal, invoker IAM removal, secret version pinning
- Cloud Build trigger(s) configuration and scripts for promotion/canary
- validate_deliverable.sh: networking plan/apply hooks, LB smoke tests
- Monitoring: dashboard JSON, alert policies (gcloud or Terraform)
- Documentation: implementation plan, verification report, runbooks

Risks & Dependencies
- DNS ownership/authorization for managed certs
- Twitch API egress pathing when Cloud Run uses VPC connector (ensure outbound works: NAT)
- ILB with Serverless NEG feature availability/limits per region
- Time to propagate certs and DNS

Out of Scope (future)
- Full service mesh or mTLS between services
- Private Service Connect to downstream backends not yet defined
- Broader multi-service refactors outside oauth-flow

Inputs Needed
- Domain name(s) for oauth-flow endpoints
- Confirmation on whether dev should mirror prod ingress posture
- Preferred canary vs blue/green strategy

Notes
- All recommendations align with architecture.yaml intent and keep the next sprint focused on VPC + LBs with security-first posture.
