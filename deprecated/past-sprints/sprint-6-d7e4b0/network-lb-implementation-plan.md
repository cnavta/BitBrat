# Network & Load Balancer — Multi‑Sprint Implementation Plan (Lead Implementor)

Sprint Context: sprint-6-d7e4b0 (planning baseline)
Source of Truth: architecture.yaml
Related Design: planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md
Related CLI Architecture: planning/sprint-4-b5a2d1/architecture-iac-cli.md

Purpose
- Translate the approved technical architecture into an executable, verifiable, and staged delivery plan.
- Define clear deliverables per sprint, with acceptance criteria, tests, and gating dependencies.
- Ensure parity with project guidelines (LLM Sprint Protocol v2.2) and DoD.

Scope
- CDKTF Network stack: VPC, subnets, Cloud Router, Cloud NAT, baseline firewall.
- CDKTF Load Balancer stack: Global External Managed HTTPS LB, managed certs, serverless NEGs, backend services, forwarding rule, target proxy, logging.
- Advanced URL Map: YAML-first strategy with import via gcloud; pre-import describe/diff; lifecycle ignore_changes.
- Serverless VPC Access connectors and brat preflight enforcement for service deployments.
- Dual-mode frontend resources: create vs use-existing for static IP and TLS certificate.

Guiding Constraints
- architecture.yaml is canonical; env overlays under env/<env>/*.
- Do not bundle brat into runtime images.
- All services must attach to Serverless VPC Access connectors for VPC egress; CI enforces strict mode (no `--allow-no-vpc`).

---

Sprint Breakdown and Deliverables

Sprint 7 — CDKTF Scaffolding and CI Wiring (Plan-only)
Objective
- Establish CDKTF project structure and provider plumbing for network and lb stacks without creating resources.
Deliverables
- Repo layout (no resources created):
  - infrastructure/cdktf/network/{main.ts,config.ts,outputs.ts} [scaffold]
  - infrastructure/cdktf/lb/{main.ts,config.ts,outputs.ts} [scaffold]
  - infrastructure/cdktf/lb/url-maps/{dev,staging,prod}/url-map.yaml [placeholders]
- brat infra commands (skeleton):
  - brat infra plan|apply network|lb (delegates to Terraform adapter, synth only for this sprint)
- CI additions:
  - Cloud Build job to run `npm ci && npm run build && brat infra plan network && brat infra plan lb` for PRs (dry-run)
Acceptance Criteria
- `brat infra plan network|lb` runs successfully in dry-run on CI; no resource apply.
- zod-validated inputs for network/lb configs compile with placeholders.
- Documentation: READMEs for each stack and update to planning index.
Testing
- Unit tests for config loader schema (zod) and synth hooks.
- Validate `validate_deliverable.sh` passes and CI path executes.
Dependencies
- None (uses placeholders); requires no GCP changes.

Sprint 8 — Network Stack MVP (Dev Apply)
Objective
- Implement VPC, regional subnets with Private Google Access, Cloud Router, Cloud NAT, baseline firewall; apply to dev environment only.
Deliverables
- CDKTF network stack implementation (resources created in dev):
  - VPC (custom mode), subnets per region from env overlay, flow logs optional
  - Cloud Router + Cloud NAT per region
  - Baseline firewall: allow-internal, allow-health-checks
- Remote Terraform state (GCS backend) configured per environment/workspace
- brat infra apply network (dev) wired and documented
Acceptance Criteria
- `brat infra plan/apply network --env=dev` succeeds; outputs exported (vpc selfLink, subnets, router/nat names).
- Firewalls and NAT verified via `gcloud` describes; Private Google Access enabled on subnets.
- Unit tests: synthesis assertions for naming conventions; snapshot of generated Terraform JSON for stability.
Testing
- Jest unit tests for naming/inputs; integration test that runs `plan` against a test project (dry-run in CI).
Dependencies
- GCP project + APIs enabled (Compute) and GCS bucket for state.

Sprint 9 — Load Balancer Stack (Plan/Dev Apply w/o URL Map Import)
Objective
- Implement LB scaffolding: global IP/cert (create-or-use-existing), target HTTPS proxy, forwarding rule, serverless NEGs, backend services; apply in dev. Defer advanced URL map import to later sprint.
Deliverables
- CDKTF lb stack implementation:
  - ipMode (create|use-existing) + ipName support
  - certMode (create|use-existing) + certRef support
  - Serverless NEGs for identified Cloud Run services (from architecture.yaml)
  - Backend services referencing NEGs; logging enabled
  - Target HTTPS proxy and forwarding rule (HTTPS only)
- brat preflights for IP/cert existence when use-existing selected (describe-only for now)
Acceptance Criteria
- `brat infra plan/apply lb --env=dev` succeeds with create mode defaults.
- For prod overlays (plan-only), data-source successfully resolves existing IP/cert.
- Outputs expose: globalIpAddress, urlMapName (stub), backendServiceNames.
Testing
- Unit tests for mode selection and data-source vs resource behavior.
- CI dry-run for prod overlay verifies data sources resolve (describe-only checks).
Dependencies
- Sprint 8 outputs (subnets, though LB does not require VPC for Cloud Run backends).

Sprint 10 — Serverless VPC Connectors + brat Preflight Enforcement
Objective
- Provision Serverless VPC Access connectors per region/env; enforce connector/VPC presence in brat deploy flows.
Deliverables
- CDKTF module for connectors attached to network subnets
- brat CLI: preflight checks in deploy services path to require VPC + subnet + router/NAT + connector; add `--allow-no-vpc` dev-only override
- Documentation: connector CIDR sizing per env and API enablement
Acceptance Criteria
- Connectors created/applied in dev; names exported as outputs
- brat deploy services fails without connectors unless override; CI blocks override
Testing
- Unit tests for preflight logic; simulated config matrices
Dependencies
- Sprint 8 network apply in target region/env

Sprint 11 — Advanced URL Map YAML Generation + Import Mechanics
Objective
- Implement YAML-first renderer from architecture.yaml and guarded import flow (describe/diff/import) for dev/staging; prepare prod plan-only.
Deliverables
- URL map YAML generator (library + command): resolves hostRules, pathMatchers, routeRules, weighted backends
- Guarded import step: describe current map, compute diff, import if drift
- Lifecycle ignore_changes on Terraform URL map stub
- brat command wiring to run import post-apply
Acceptance Criteria
- Dev/staging URL maps imported; `describe` matches desired YAML; diffs clean in CI
- Unit tests for renderer with fixtures; integration test exercising import in a non-prod project
Dependencies
- Sprint 9 lb stack in place with backend services

Sprint 12 — Production Cutover and Hardening
Objective
- Roll out to prod with use-existing IP/cert; finalize runbooks; add Cloud Armor (optional) and monitoring.
Deliverables
- Prod apply of lb (data-sourced IP/cert) and guarded URL map import
- DNS validation and readiness checks; rollback plan documented
- Observability: logging verification and optional alerts
- Publication: PR with links to sprint docs, verification report, and retro
Acceptance Criteria
- `validate_deliverable.sh` extended to run CI dry-run deploy for infra
- Verification report confirms parity with plan; PR created per Sprint Protocol
Dependencies
- Sprints 8–11 complete and validated

---

Cross-Cutting Acceptance Criteria (Epic)
- All infra code aligns with architecture.yaml; no duplicated configuration.
- Each sprint produces at least one tangible artifact (code, tests, or deployment scripts) and passes a root validation script.
- Dry-run (plan) is safe and default for PRs; applies guarded behind approvals.
- Production uses use-existing for IP and cert; brat preflight verifies ACTIVE cert before cutover.
- All Cloud Run services deploy with VPC egress via connectors (policy enforced by brat).

Testing Strategy (Summary)
- Jest unit tests for config schemas, name generation, and URL map renderer.
- Integration tests for terraform plan outputs and guarded import flow (dev/staging only).
- CI executes test matrix per environment overlay in plan mode; apply only in controlled environments.

Definition of Done (Epic)
- Passing tests and successful dry-run deployment.
- Documented runbooks and rollback steps for LB changes.
- Verification report with all deliverables marked completed or explicitly deferred.
- Publication via Pull Request, linking all sprint planning artifacts.

Traceability
- This plan derives from planning/sprint-6-d7e4b0/network-and-lb-technical-architecture.md and aligns with Sprint Protocol v2.2.
