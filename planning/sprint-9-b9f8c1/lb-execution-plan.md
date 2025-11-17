# Sprint 9 Execution Plan — Load Balancer Stack (Dev Apply, no URL Map Import)

Sprint ID: sprint-9-b9f8c1
Role: Lead Implementor
Date: 2025-11-14
Source of Truth: architecture.yaml
Upstream References:
- planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md (LB §5–§7)
- planning/sprint-6-d7e4b0/network-lb-implementation-plan.md (Sprint 9 scope/AC lines 70–90)
- planning/sprint-9-b9f8c1/network-lb-progress-summary.md

## 1. Objective
Implement the HTTPS Load Balancer scaffolding in the dev environment using CDK for Terraform (CDKTF): global IP and TLS certificate (create-or-use-existing modes), serverless NEGs for Cloud Run services, backend services with logging, Target HTTPS Proxy, and Global Forwarding Rule. Defer Advanced URL Map YAML generation/import to a later sprint; use a stub URL map for dependency wiring only. Enable `brat infra plan|apply lb --env=dev` locally (apply remains blocked in CI).

## 2. Scope
- LB stack implementation delivered via brat HCL synth (authoritative for this sprint)
  - Frontend:
    - Global external static IP with ipMode: "create" (default non-prod) or "use-existing" (for prod plan-only)
    - TLS certificate with certMode: "create" (Google-managed, SANs from architecture.yaml) or "use-existing"
    - Target HTTPS Proxy referencing managed cert and URL map (URL map is a stub this sprint)
    - Global Forwarding Rule on TCP/443 to the proxy
  - Backends:
    - Serverless NEGs for identified public Cloud Run services and regions from architecture.yaml
    - Backend Services referencing NEGs; logging enabled
- Preflight checks (describe-only): when ipMode/certMode = "use-existing", brat verifies referenced IP/cert exist
- Outputs: globalIpAddress, urlMapName (stub), backendServiceNames

Non-goals:
- Advanced URL Map YAML generation and import (deferred to Sprint 11)
- Cloud Armor, CDN, or HTTP-to-HTTPS redirect (future)
- Production applies

## 3. Deliverables
- CDKTF code: infrastructure/cdktf/lb/{main.ts, config.ts, outputs.ts}
- Config schema with zod for lb inputs (config.ts)
- Serverless NEG and Backend Service composition per architecture.yaml services
- Target HTTPS Proxy and Forwarding Rule wiring
- brat CLI integration to synth, plan, and apply (local only) for lb stack
- Unit tests: mode selection (create vs use-existing) and data-source vs resource behavior; naming conventions
- Outputs surfaced via tools/brat terraform provider to infrastructure/cdktf/out/lb/outputs.json

## 4. Work Breakdown Structure (WBS)
1) Inputs & Schema (config.ts)
- Define LoadBalancerConfig with zod schema:
  - projectId: string
  - environment: enum("dev","staging","prod")
  - services: { name: string; region: string; public: boolean }[] (derived from architecture.yaml; filter public services)
  - domains: Record<string, string[]> (service -> [domains])
  - ipMode: enum("create","use-existing") (default: create for non-prod, use-existing for prod)
  - ipName?: string (required when ipMode=use-existing)
  - certMode: enum("create","use-existing") (default: create for non-prod, use-existing for prod)
  - certRef?: { computeManagedCertName?: string; certificateManagerCertName?: string; certificateMapName?: string } (required when certMode=use-existing)
  - urlMapName: string (stub name; default "bitbrat-global-url-map")

2) Resource Composition (main.ts)
- Global IP:
  - create mode: google_compute_global_address "bitbrat-global-ip"
  - use-existing: data.google_compute_global_address by name
- Certificate:
  - create mode: google_compute_managed_ssl_certificate with SANs from domains
  - use-existing: data reference to existing cert resource(s)
- Serverless NEGs (per public service & region):
  - name: `neg-<service>-<region>`; type Cloud Run; attach service URL
- Backend Services:
  - name: `be-<service>`; attach NEGs; enable logging
- URL Map (stub):
  - Terraform-managed minimal URL map with defaultService pointing to `be-default` or a placeholder; lifecycle ignore_changes prepared for future YAML import
- Target HTTPS Proxy and Forwarding Rule:
  - proxy references cert(s) and urlMap
  - forwarding rule global on port 443 points to proxy

3) Preflight Checks in brat (describe-only)
- When ipMode/certMode = use-existing, before plan/apply:
  - Verify IP name resolves via gcloud/terraform data source
  - Verify certificate exists and, if possible, ACTIVE status (warning if status cannot be checked without permissions)
- Emit structured diagnostics if missing; block apply with clear hint

4) Outputs (outputs.ts)
- globalIpAddress
- urlMapName
- backendServiceNames: string[]
- certificateResourceNames: string[]

5) brat CLI Wiring
- tools/brat infra provider: add `lb` target to synth CDKTF → Terraform under infrastructure/cdktf/out/lb
- Plan/apply behavior mirrors network stack: stream TF logs; block applies in CI or when --dry-run
- Always write outputs.json with real outputs or structured diagnostics

6) Tests (Jest)
- Schema tests for LoadBalancerConfig defaults and validations
- Unit tests for mode selection:
  - create mode creates resources and not data sources
  - use-existing uses data sources and not resources
- Name generation tests for NEGs and backend services
- Snapshot or string assertions for HCL synth fragments (no sensitive data)

7) Verification Steps (manual)
- After local apply in dev:
  - gcloud compute addresses describe bitbrat-global-ip --global
  - gcloud compute url-maps describe bitbrat-global-url-map
  - gcloud compute backend-services list | grep "be-"
  - gcloud compute network-endpoint-groups list | grep "neg-"
  - gcloud compute target-https-proxies describe <proxy-name>
  - gcloud compute forwarding-rules describe <rule-name> --global

## 5. Acceptance Criteria
- `brat infra plan lb --env=dev` succeeds in CI (plan-only)
- Local `brat infra apply lb --env=dev` creates global IP (create mode), managed cert, NEGs, backend services with logging, target HTTPS proxy, and forwarding rule
- For prod overlay (plan-only), data sources resolve existing IP/cert without creating new ones
- Outputs include: globalIpAddress, urlMapName (stub), backendServiceNames
- Unit tests pass in CI; synth assertions stable

## 6. Testing Strategy
- Jest unit tests under infrastructure/cdktf/lb/*.test.ts and tools/brat/src/providers/cdktf-synth.lb.spec.ts
- Mocks for filesystem and terraform CLI
- CI matrix: dev (create mode) plan; prod (use-existing mode) plan with data-source resolution

## 7. Deployment Approach
- CI: `npm ci && npm run build && brat infra plan lb --env=dev --dry-run`
- Local (authorized engineer): `brat infra apply lb --env=dev` with explicit approval flag; applies blocked in CI

## 8. Dependencies
- Sprint 8 network outputs not strictly required for Cloud Run NEGs but documented for future connectors
- GCP project and credentials; APIs enabled: compute.googleapis.com
- Architecture.yaml services and domains present

## 9. Risks & Mitigations
- Certificate provisioning delay → start early; readiness checks before cutover
- Provider gaps for URL map → keep stub minimal; full YAML import deferred to Sprint 11
- Accidental apply in CI → guarded by brat; honor CI=true
- Misconfigured service regions → validate against architecture.yaml; fail fast

## 10. Timeline
- Day 1: Config schema + resource composition draft, unit tests for modes
- Day 2–3: brat wiring + synth/plan stable in CI; outputs surfaced
- Day 4–5: Local apply to dev, verification, refine tests and docs

## 11. Definition of Done (DoD)
- All AC satisfied and verified
- Unit tests pass in CI; planning/sprint-9-b9f8c1/validate_deliverable.sh passes
- Documentation updated: planning/index.md and this lb-execution-plan.md; request-log entry added

## 12. Traceability
- Mirrors Sprint 6 plan (Sprint 9 scope lines 70–90) and technical architecture; uses architecture.yaml for domains and services; defers URL map import to Sprint 11.