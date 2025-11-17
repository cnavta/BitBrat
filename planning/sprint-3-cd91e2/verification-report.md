# Deliverable Verification Report — Sprint 3 (sprint-3-cd91e2)

Date: 2025-11-11
Owner: Cloud Architect
Sources: planning/sprint-3-cd91e2/implementation-plan.md, planning/sprint-3-cd91e2/request-log.md, architecture.yaml

## Completed as Implemented
- [x] Deploy process parameterized from architecture.yaml for all key runtime values (region, port, min/max instances, CPU, memory, allowUnauth)
- [x] Secrets sourced from architecture.yaml with numeric Secret Manager version pinning for Cloud Build multi-service deploys (read-only policy)
- [x] Environment variable injection from env/<env>/*.yaml merged with defaults and applied during deploy (with safe quoting)
- [x] Multi-service cloud deploy path (Cloud Build → Cloud Run) when no service is specified; single-service path remains Terraform-driven
- [x] Parallel multi-service deployments with configurable max concurrency (default from architecture.yaml; CLI override supported)
- [x] Robust logging and traceability for secrets and env processing (no secret values logged)
- [x] Image build/push integration via Cloud Build with deterministic tag; GAR propagation wait removed by digest-based approach and/or waits where applicable
- [x] Bootstrap generator for new services reading architecture.yaml (explicit stub routes, BaseServer usage, tests, per-service Dockerfile, local compose include)
- [x] BaseServer introduced with health endpoints and centralized helpers (loadArchitectureYaml, computeRequiredKeysFromArchitecture, ensureRequiredEnv)
- [x] Local deploy orchestrator supports single- and all-services flows with macOS-compatible logic and automatic port assignment
- [x] Manual Secret Manager governance enforced (no create/update/import/destroy in repo code)

## Partial or Deferred
- [ ] Networking (VPC, SVPC connector, NAT, firewall) — deferred to Sprint 4
- [ ] External/Internal HTTPS Load Balancers with Serverless NEGs, DNS, TLS, WAF — deferred to Sprint 4
- [ ] Observability artifacts (dashboards, alerting, uptime checks) — partially planned, not implemented in this sprint
- [ ] CI/CD triggers by digest to prod — groundwork laid; full trigger automation deferred

## Additional Observations
- Cloud Build substitution handling and shell quoting are frequent failure points; using a bash array for gcloud args eliminated env parsing issues (e.g., values starting with '#').
- Env vs secret key collisions are now filtered to avoid overriding secret-backed envs with plain envs.
- Cross-platform script compatibility (macOS bash 3.2) required avoiding associative arrays and using portable constructs.
- Architecture-first pipeline significantly reduced drift: updating architecture.yaml and re-deploying applies config consistently across services.

## Validation Summary
- Local: npm install, build, and tests pass; local deploy supports single/all services with health checks. (See validate_deliverable.sh)
- Cloud (dry-run): npm run deploy:cloud -- --dry-run prints intended actions for single and multi-service paths without side effects.
- Cloud (apply): Multi-service builds and deploys succeed with secrets and env applied; single-service Terraform flow remains functional.

## Carry-Forward to Sprint 4
- Implement networking and load balancers per plan, using Serverless NEGs and managed certs.
- Add observability artifacts and budget policies.
- Migrate legacy services to BaseServer helpers where beneficial.
