# Planning Index

This index tracks sprint deliverables and links.

## Sprint 1 — Local Deployment Bootstrap (sprint-1-9f3b2a)
- Objective: Enable `npm run local` to start NATS + Firestore Emulator via Docker Compose and run the minimal `oauth-flow` service with health checks.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-1-9f3b2a/implementation-plan.md)
    - [verification-report.md](sprint-1-9f3b2a/verification-report.md)
    - [retro.md](sprint-1-9f3b2a/retro.md)
    - [sprint-manifest.yaml](sprint-1-9f3b2a/sprint-manifest.yaml)
    - [publication.yaml](sprint-1-9f3b2a/publication.yaml)
  - Key Learnings:
    - [key-learnings.md](key-learnings.md)
- Publication:
  - Branch: `feature/sprint-1-9f3b2a`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-1-9f3b2a?expand=1



## Sprint 2 — oauth-flow CI/CD + Cloud Run (sprint-2-b7c4a1)
- Objective: Deliver Cloud Build → Artifact Registry → Cloud Run (dry-run capable) and IaC for oauth-flow; allow unauthenticated this sprint only.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-2-b7c4a1/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-2-b7c4a1/sprint-manifest.yaml)
    - [request-log.md](sprint-2-b7c4a1/request-log.md)
    - [validate_deliverable.sh](sprint-2-b7c4a1/validate_deliverable.sh)
    - [verification-report.md](sprint-2-b7c4a1/verification-report.md)
    - [retro.md](sprint-2-b7c4a1/retro.md)
    - [publication.yaml](sprint-2-b7c4a1/publication.yaml)
  - Notes:
    - [Dev overlay scope (draft)](sprint-2-b7c4a1/dev-overlay-scope.md)
- Publication:
  - Branch: `feature/sprint-2-b7c4a1`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-2-b7c4a1?expand=1


## Sprint 3 — Networking, Security, and Release Readiness (sprint-3-cd91e2)
- Objective: Harden networking and ingress for oauth-flow behind HTTPS LBs; IAM tightening; DNS/TLS; CI/CD promotion/rollback; observability; integration and smoke tests; dev overlay.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-3-cd91e2/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-3-cd91e2/sprint-manifest.yaml)
    - [request-log.md](sprint-3-cd91e2/request-log.md)
    - [validate_deliverable.sh](sprint-3-cd91e2/validate_deliverable.sh)
    - [verification-report.md](sprint-3-cd91e2/verification-report.md)
    - [retro.md](sprint-3-cd91e2/retro.md)
    - [publication.yaml](sprint-3-cd91e2/publication.yaml)
- Publication:
  - Branch: `feature/sprint-3-cd91e2`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-3-cd91e2?expand=1


## Sprint 4 — IaC Orchestration CLI (sprint-4-b5a2d1)
- Objective: Establish architecture and implement Phase 1 of a unified TypeScript CLI (brat) to orchestrate build, test, and deploy across environments; maintain packaging boundary and side-by-side parity with deploy-cloud.sh.
- Artifacts:
  - Planning:
    - [architecture-iac-cli.md](sprint-4-b5a2d1/architecture-iac-cli.md)
    - [implementation-plan.md](sprint-4-b5a2d1/implementation-plan.md)
    - [phase-1-implementation-plan.md](sprint-4-b5a2d1/phase-1-implementation-plan.md)
    - [phase-2-implementation-plan.md](sprint-4-b5a2d1/phase-2-implementation-plan.md)
    - [request-log.md](sprint-4-b5a2d1/request-log.md)
    - [validate_deliverable.sh](sprint-4-b5a2d1/validate_deliverable.sh)
    - [verification-report.md](sprint-4-b5a2d1/verification-report.md)
    - [retro.md](sprint-4-b5a2d1/retro.md)
    - [sprint-manifest.yaml](sprint-4-b5a2d1/sprint-manifest.yaml)
    - [publication.yaml](sprint-4-b5a2d1/publication.yaml)
- Publication:
  - Branch: `feature/sprint-4-b5a2d1`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-4-b5a2d1?expand=1

## Sprint 5 — IaC Orchestration CLI (Phase 3) (sprint-5-f3c9a7)
- Objective: Introduce CDKTF scaffolding for network/LB and complete Phase 2 backlog (SDK adapters and trigger commands) while maintaining packaging boundaries.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-5-f3c9a7/implementation-plan.md)
    - [iteration-2-implementation-plan.md](sprint-5-f3c9a7/iteration-2-implementation-plan.md)
    - [phase-2-backlog-implementation-plan.md](sprint-5-f3c9a7/phase-2-backlog-implementation-plan.md)
    - [request-log.md](sprint-5-f3c9a7/request-log.md)
    - [validate_deliverable.sh](sprint-5-f3c9a7/validate_deliverable.sh)
    - [verification-report.md](sprint-5-f3c9a7/verification-report.md)
    - [retro.md](sprint-5-f3c9a7/retro.md)
    - [sprint-manifest.yaml](sprint-5-f3c9a7/sprint-manifest.yaml)
    - [publication.yaml](sprint-5-f3c9a7/publication.yaml)
- Publication:
  - Branch: `feature/sprint-5-f3c9a7`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-5-f3c9a7?expand=1

## Sprint 6 — CDKTF Network & LB Architecture (sprint-6-d7e4b0)
- Objective: Produce technical architecture and a multi-sprint plan for CDKTF network and HTTPS load balancer with advanced URL map (YAML-first import).
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-6-d7e4b0/implementation-plan.md)
    - [network-and-lb-technical-architecture.md](sprint-6-d7e4b0/network-and-lb-technical-architecture.md)
    - [network-lb-implementation-plan.md](sprint-6-d7e4b0/network-lb-implementation-plan.md)
    - [request-log.md](sprint-6-d7e4b0/request-log.md)
    - [validate_deliverable.sh](sprint-6-d7e4b0/validate_deliverable.sh)
    - [verification-report.md](sprint-6-d7e4b0/verification-report.md)
    - [retro.md](sprint-6-d7e4b0/retro.md)
    - [sprint-manifest.yaml](sprint-6-d7e4b0/sprint-manifest.yaml)
    - [publication.yaml](sprint-6-d7e4b0/publication.yaml)
- Publication:
  - Branch: `feature/sprint-6-d7e4b0`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-6-d7e4b0?expand=1


## Sprint 7 — CDKTF Scaffolding and CI Wiring (sprint-7-a13b2f)
- Objective: Plan-only — create an implementation plan for CDKTF scaffolding and CI dry-run wiring for network and load balancer stacks; no resources created.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-7-a13b2f/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-7-a13b2f/sprint-manifest.yaml)
    - [request-log.md](sprint-7-a13b2f/request-log.md)
    - [validate_deliverable.sh](sprint-7-a13b2f/validate_deliverable.sh)
    - [verification-report.md](sprint-7-a13b2f/verification-report.md)
    - [retro.md](sprint-7-a13b2f/retro.md)
    - [publication.yaml](sprint-7-a13b2f/publication.yaml)
- Publication:
  - Branch: `feature/sprint-7-a13b2f`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-7-a13b2f?expand=1



## Sprint 8 — Implement CDKTF Scaffolding + CI Dry-Run (sprint-8-ef72c3)
- Objective: Implement CDKTF scaffolding and CI dry-run wiring; apply guarded and disabled in CI.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-8-ef72c3/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-8-ef72c3/sprint-manifest.yaml)
    - [request-log.md](sprint-8-ef72c3/request-log.md)
    - [validate_deliverable.sh](sprint-8-ef72c3/validate_deliverable.sh)
    - [verification-report.md](sprint-8-ef72c3/verification-report.md)
    - [retro.md](sprint-8-ef72c3/retro.md)
    - [publication.yaml](sprint-8-ef72c3/publication.yaml)
- Publication:
  - Branch: `feature/sprint-8-ef72c3`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-8-ef72c3?expand=1


## Sprint 9 — Network & LB Epic Progress and Forward Plan (sprint-9-b9f8c1)
- Objective: Produce a progress summary and forward plan for the Network & Load Balancer epic; no infrastructure changes in this sprint.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-9-b9f8c1/implementation-plan.md)
    - [execution-plan.md](sprint-9-b9f8c1/execution-plan.md)
    - [lb-execution-plan.md](sprint-9-b9f8c1/lb-execution-plan.md)
    - [lb-implementation-plan.md](sprint-9-b9f8c1/lb-implementation-plan.md)
    - [network-lb-progress-summary.md](sprint-9-b9f8c1/network-lb-progress-summary.md)
    - [open-items.md](sprint-9-b9f8c1/open-items.md)
    - [network-verify-runbook.md](sprint-9-b9f8c1/network-verify-runbook.md)
    - [local-apply-evidence.md](sprint-9-b9f8c1/local-apply-evidence.md)
    - [verification-report.md](sprint-9-b9f8c1/verification-report.md)
    - [retro.md](sprint-9-b9f8c1/retro.md)
    - [publication.yaml](sprint-9-b9f8c1/publication.yaml)
    - [sprint-manifest.yaml](sprint-9-b9f8c1/sprint-manifest.yaml)
    - [request-log.md](sprint-9-b9f8c1/request-log.md)
    - [validate_deliverable.sh](sprint-9-b9f8c1/validate_deliverable.sh)
- Publication:
  - Branch: `feature/sprint-9-b9f8c1`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-9-b9f8c1?expand=1


## Sprint 10 — Serverless VPC Connectors + Preflight Enforcement (sprint-10-ae91d4)
- Objective: Provision Serverless VPC Access connectors per region/env and enforce VPC/connector preflights in brat deploy flows.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-10-ae91d4/implementation-plan.md)
    - [execution-plan.md](sprint-10-ae91d4/execution-plan.md)
    - [sprint-manifest.yaml](sprint-10-ae91d4/sprint-manifest.yaml)
    - [request-log.md](sprint-10-ae91d4/request-log.md)
    - [validate_deliverable.sh](sprint-10-ae91d4/validate_deliverable.sh)
    - [verification-report.md](sprint-10-ae91d4/verification-report.md)
    - [retro.md](sprint-10-ae91d4/retro.md)
    - [publication.yaml](sprint-10-ae91d4/publication.yaml)
- Publication:
  - Branch: `feature/sprint-10-ae91d4`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-10-ae91d4?expand=1



## Sprint 11 — Advanced URL Map YAML Generation + Import Mechanics (sprint-11-c7a9d3)
- Objective: Implement YAML-first URL Map generator and guarded import flow for dev/staging; prod plan-only.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-11-c7a9d3/implementation-plan.md)
    - [execution-plan.md](sprint-11-c7a9d3/execution-plan.md)
    - [sprint-manifest.yaml](sprint-11-c7a9d3/sprint-manifest.yaml)
    - [request-log.md](sprint-11-c7a9d3/request-log.md)
    - [validate_deliverable.sh](sprint-11-c7a9d3/validate_deliverable.sh)
    - [verification-report.md](sprint-11-c7a9d3/verification-report.md)
    - [retro.md](sprint-11-c7a9d3/retro.md)
    - [publication.yaml](sprint-11-c7a9d3/publication.yaml)
- Publication:
  - Branch: `feature/sprint-11-c7a9d3`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-11-c7a9d3?expand=1



## Sprint 12 — Production Cutover and Hardening (sprint-12-f2b7a8)
- Objective: Production cutover of the HTTPS Load Balancer using use-existing IP/cert with guarded URL Map import; DNS readiness; observability; optional Cloud Armor; PR publication per Sprint Protocol.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-12-f2b7a8/implementation-plan.md)
    - [execution-plan.md](sprint-12-f2b7a8/execution-plan.md)
    - [sprint-manifest.yaml](sprint-12-f2b7a8/sprint-manifest.yaml)
    - [request-log.md](sprint-12-f2b7a8/request-log.md)
    - [validate_deliverable.sh](sprint-12-f2b7a8/validate_deliverable.sh)
    - [verification-report.md](sprint-12-f2b7a8/verification-report.md)
    - [retro.md](sprint-12-f2b7a8/retro.md)
    - [publication.yaml](sprint-12-f2b7a8/publication.yaml)
- Publication:
  - Branch: `feature/sprint-12-f2b7a8`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-12-f2b7a8?expand=1


## Sprint 13 — Close-out of Infra Gaps (sprint-13-ace12f)
- Objective: Close out infra gaps from S7–S12 via Technical Architecture aligned to architecture.yaml; planning-only sprint.
- Artifacts:
  - Planning:
    - [technical-architecture.md](sprint-13-ace12f/technical-architecture.md)
    - [implementation-plan.md](sprint-13-ace12f/implementation-plan.md)
    - [project-implementation-plan.md](sprint-13-ace12f/project-implementation-plan.md)
    - [sprint-manifest.yaml](sprint-13-ace12f/sprint-manifest.yaml)
    - [request-log.md](sprint-13-ace12f/request-log.md)
    - [validate_deliverable.sh](sprint-13-ace12f/validate_deliverable.sh)
    - [verification-report.md](sprint-13-ace12f/verification-report.md)
    - [retro.md](sprint-13-ace12f/retro.md)
    - [publication.yaml](sprint-13-ace12f/publication.yaml)
- Publication:
  - Branch: `feature/sprint-13-ace12f`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-13-ace12f?expand=1


## Sprint 14 — CI Infra Plan Job + Root Validation Wiring (sprint-14-c1d2e3)
- Objective: Finalize CI infra plan job and extend root validation to run infra dry-run steps.
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-14-c1d2e3/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-14-c1d2e3/sprint-manifest.yaml)
    - [request-log.md](sprint-14-c1d2e3/request-log.md)
    - [validate_deliverable.sh](sprint-14-c1d2e3/validate_deliverable.sh)
    - [ci-trigger-usage.md](sprint-14-c1d2e3/ci-trigger-usage.md)
    - [verification-report.md](sprint-14-c1d2e3/verification-report.md)
    - [retro.md](sprint-14-c1d2e3/retro.md)
    - [publication.yaml](sprint-14-c1d2e3/publication.yaml)
- Publication:
  - Branch: `feature/sprint-14-c1d2e3`
  - PR: open (compare view)
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-14-c1d2e3?expand=1


## Sprint 15 — Network Overlay Parity (sprint-15-b4d9e6)
- Objective: Implement overlay-driven regions/subnets, optional flow logs, and overlay-driven remote state in synthNetworkTf (no hardcoded values).
- Artifacts:
  - Planning:
    - [implementation-plan.md](sprint-15-b4d9e6/implementation-plan.md)
    - [sprint-manifest.yaml](sprint-15-b4d9e6/sprint-manifest.yaml)
    - [request-log.md](sprint-15-b4d9e6/request-log.md)
    - [validate_deliverable.sh](sprint-15-b4d9e6/validate_deliverable.sh)
- Publication:
  - Branch: `feature/sprint-15-b4d9e6`
  - PR: pending
  - Open PR here (compare view): https://github.com/cnavta/BitBrat/compare/main...feature/sprint-15-b4d9e6?expand=1
