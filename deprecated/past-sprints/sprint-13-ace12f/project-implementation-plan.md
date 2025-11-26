# Project Implementation Plan — Execute “Technical Architecture — Close‑out of Infra Gaps (S7–S12)

Sprint Workspace: sprint-13-ace12f
Role: Lead Implementor
Source of Truth: architecture.yaml
Related Design: planning/sprint-13-ace12f/technical-architecture.md

Purpose
- Translate the approved Technical Architecture into a sequenced set of executable sprints with explicit deliverables, tests, acceptance criteria, and publication steps.
- Maintain strict adherence to architecture.yaml overlays and the LLM Sprint Protocol v2.2.

Guiding Constraints
- No new sprints are started by this document; it is a planning artifact to be approved before execution.
- All code, tests, and scripts must live in-repo and be validated via root validate_deliverable.sh and Cloud Build.
- Never pull config values from anywhere except architecture.yaml (+ env overlays) and existing environment variables specifically designated by the repo.

---

Sprint Breakdown (Proposed)

Sprint 14 — CI Infra Plan Job + Root Validation Wiring
- Objective
  - Finalize and verify CI plan job that runs infra plan for network, connectors, and lb; add URL map dry-run import to CI. Extend root validate_deliverable.sh to run these checks locally/dry-run.
- Deliverables
  - Verify and, if needed, adjust cloudbuild.infra-plan.yaml to run:
    - npm ci && npm run build
    - npm run brat -- apis enable --env $ENV --project-id $PROJECT_ID --dry-run
    - npm run brat -- infra plan network --env $ENV --project-id $PROJECT_ID --dry-run
    - npm run brat -- infra plan connectors --env $ENV --project-id $PROJECT_ID --dry-run
    - npm run brat -- infra plan lb --env $ENV --project-id $PROJECT_ID --dry-run
    - npm run brat -- lb urlmap import --env $ENV --project-id $PROJECT_ID --dry-run
  - Update/confirm Cloud Build trigger documentation; ensure PRs use this config.
  - Extend root validate_deliverable.sh to accept env/project parameters and execute the same plan steps in dry-run.
- Tests
  - Jest: none needed; rely on CI execution + script exit codes.
- Acceptance Criteria
  - PRs show successful execution of cloudbuild.infra-plan.yaml with artifacts (logs, diffs) for target env.
  - Local validate_deliverable.sh completes without applying resources.
- Dependencies
  - Existing brat commands functional.
- DoD
  - CI path is green in a sample PR, and the root validator includes infra checks.

Sprint 15 — Network Overlay Parity: Regions, Subnets, Flow Logs, Remote State
- Objective
  - Implement overlay-driven regions and subnets, optional flow logs, and overlay-driven remote state in synthNetworkTf.
- Deliverables
  - tools/brat/src/config/schema.ts: extend zod schema for network.overlays: regions[], subnets map, enableFlowLogs, remoteState{bucket,prefix}.
  - tools/brat/src/providers/cdktf-synth.ts: synthNetworkTf to:
    - iterate regions and create per-region subnets with Private Google Access
    - apply flow logs when enableFlowLogs=true using GCP defaults
    - configure remote backend from overlays when provided (off by default)
  - Unit tests covering schema and snapshot of synthesized Terraform JSON for multiple regions.
- Tests
  - Jest unit tests for schema and synth.
  - CI terraform plan (dry-run) against a sandbox project using overlays.
- Acceptance Criteria
  - No hardcoded CIDRs or regions remain; all taken from architecture.yaml overlays.
  - terraform plan completes; subnets and routers/NATs synthesized per overlays.
- Dependencies
  - Sprint 14 CI path in place.
- DoD
  - Green tests; CI dry-run plan demonstrates overlay-driven outputs.

Sprint 16 — LB Backends: NEGs + Backend Services; ipMode/certMode Inputs
- Objective
  - Implement per-service Serverless NEGs and Backend Services derived from architecture.yaml; surface ipMode/certMode as first-class inputs.
- Deliverables
  - tools/brat/src/config/schema.ts: add lb.ipMode, lb.ipName, lb.certMode, lb.certRef, lb.services[].
  - tools/brat/src/providers/cdktf-synth.ts: synthLoadBalancerTf to:
    - create serverless NEGs per service per region (Cloud Run targets)
    - create Backend Services per service; attach NEGs; enable logging
    - wire ipMode/certMode: create resources in non-prod; data-source resolve in use-existing mode
    - keep url map as stub with ignore_changes
  - Unit tests for mode selection and resource/data wiring; synth snapshots of NEGs/backends.
- Tests
  - Jest unit tests + CI dry-run plan for dev and prod overlays.
- Acceptance Criteria
  - Dev plan/apply ready (apply executed only in controlled env); prod plan resolves data sources.
  - backendServiceNames and negNames are exposed in outputs.
- Dependencies
  - Sprint 15 overlays for services/regions.
- DoD
  - Tests green; plan shows correct resources; no URL map import yet.

Sprint 17 — Connectors Configurability + Preflight Reinforcement
- Objective
  - Make connector ip_cidr_range and sizing overlay-driven; ensure preflight enforces presence during deploy.
- Deliverables
  - tools/brat/src/config/schema.ts: connectors.perRegion[region] { cidr, minInstances, maxInstances } with validation (/28–/23 bounds).
  - tools/brat/src/providers/cdktf-synth.ts: synthConnectorsTf to use perRegion map and expose outputs.
  - Strengthen assertVpcPreconditions to check connectors for all targeted regions; document --allow-no-vpc dev-only override behavior.
  - Documentation updates with overlay examples in planning/ and comments in architecture.yaml where appropriate.
- Tests
  - Jest unit tests for schema validation (invalid CIDR, bounds).
  - CI dry-run terraform plan for connectors across two regions.
- Acceptance Criteria
  - No hardcoded connector ranges remain; CI plans succeed with overlay-driven inputs.
- Dependencies
  - Sprint 15 completed.
- DoD
  - Tests and CI green; deploy preflight fails gracefully if connectors missing (manual check in a sandbox deployment run).

Sprint 18 — URL Map YAML Parity + Guarded Import
- Objective
  - Ensure renderer parity with architecture.yaml and guarded import behavior across envs.
- Deliverables
  - tools/brat/src/lb/urlmap/renderer.ts: verify generation of backend selfLinks using be-<service> names; fill hostRules/pathMatchers/routeRules as per architecture.yaml.
  - tools/brat/src/lb/importer/importer.ts: confirm non-prod auto-import post-apply; prod diff-only by default with clear messaging.
  - Write generated YAMLs to infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml; commit.
  - Tests with fixtures and diff outputs.
- Tests
  - Jest: renderer unit tests with multiple route patterns; importer diff tests.
  - CI: dry-run import step executed; no destructive changes.
- Acceptance Criteria
  - Dev/staging imports succeed and describe matches YAML; prod path shows diff-only and manual step guidance.
- Dependencies
  - Sprint 16 backend services implemented (names available for selfLinks).
- DoD
  - Tests green; YAMLs committed; CI diff logs generated.

Sprint 19 — DNS/TLS Readiness + Optional Cloud Armor + Validation Enhancements
- Objective
  - Add DNS/TLS readiness checks, optional Cloud Armor attachment, and integrate checks into root validation.
- Deliverables
  - scripts/check_dns_tls.sh: resolve FQDN -> Global IP and verify TLS SANs; non-zero exit on failures.
  - tools/brat/src/providers/cdktf-synth.ts: attach optional Cloud Armor policy when overlays enable it.
  - validate_deliverable.sh: run DNS/TLS checks for declared domains from architecture.yaml.
  - Documentation/runbook for prod cutover and manual URL map import (if required).
- Tests
  - Bash script tested against known domains (mocked in CI where necessary).
  - Unit tests: minimal wrapper to parse architecture.yaml and feed domains to the script in dry-run.
- Acceptance Criteria
  - Root validator executes DNS/TLS checks in dry-run; Cloud Armor off by default except when explicitly enabled in prod overlay.
- Dependencies
  - Sprint 18 URL map parity (domains are resolvable to the intended IP).
- DoD
  - CI and local validation pass; Cloud Armor wiring togglable via overlay.

---

Cross-Cutting Items
- Documentation & Traceability
  - Update planning/index.md and each sprint folder with implementation-plan.md, request-log.md, validate_deliverable.sh, verification-report.md, retro.md, and publication.yaml per Sprint Protocol.
  - Each deliverable must include llm_prompt annotations where helpful and reference the related prompt ID from request-log.md.
- Testing
  - Maintain Jest as standard; place tests alongside code under tools/brat/src/** with *.test.ts files.
- Deployment Approach
  - All deploys via Cloud Build; cloudbuild.brat.yaml and cloudbuild.infra-plan.yaml drive CI; deploy-cloud.sh retained for parity but not authoritative.
- Dependencies/External Systems
  - GCP Project(s), Service APIs, Artifact Registry, Cloud Build permissions, Terraform state bucket (if remote state enabled by overlay).

Acceptance Criteria (Epic)
- All sprints maintain alignment with architecture.yaml.
- Every sprint produces tangible artifacts and a passing validate_deliverable.sh.
- CI runs infra plan and URL map dry-run import for target envs on PRs.
- prod uses use-existing IP/cert with ACTIVE status verified.

Definition of Done (Epic)
- Code, tests, and deployment scaffolding committed with passing CI.
- Verification report shows all deliverables completed or explicitly deferred with user approval.
- Publication via PR with links to sprint docs per S11–S13.

Traceability
- Implements planning/sprint-13-ace12f/technical-architecture.md and aligns with prior Sprint 6 & 12 plans.
