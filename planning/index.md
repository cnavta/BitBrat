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
