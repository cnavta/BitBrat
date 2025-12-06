# Implementation Plan – sprint-111-888a6b3
## Objective
- Create a trackable backlog to enable deploying a single service via `npm run brat <service>` using the existing BitBrat CLI and architecture.yaml as the source of truth.
## Scope
- In scope: Planning, backlog creation, validation script, PR publication.
- Out of scope: Actual deploy execution logic and infrastructure changes beyond planning.
## Deliverables
- Backlog of actionable tasks to implement single-service deploy
- Validation script for this sprint
- Documentation and planning artifacts
- PR with planning artifacts
## Acceptance Criteria
- Backlog items are clear, ordered, and traceable to architecture.yaml
- Validation script runs: build + tests pass, local/deploy dry-run steps are safely no-op or guarded
- Sprint artifacts exist under planning/sprint-111-888a6b3/
## Testing Strategy
- Unit tests (future sprint) for:
  - CLI flag parsing: `npm run brat deploy <service> [--env dev|prod] [--project <id>] [--region <r>]`
  - Architecture service discovery and validation
  - Env + secrets mapping resolution
- Integration tests (future sprint) with mocked gcloud/Cloud Build
## Deployment Approach
- Default runtime: Cloud Run (per architecture.yaml)
- Build per service using appropriate Dockerfile (e.g., Dockerfile.event-router, etc.)
- Push to Artifact Registry repo (configurable)
- Deploy to Cloud Run with min auth (allowUnauthenticated default true unless overridden)
- Read defaults from architecture.yaml and env vars
## Dependencies
- Google Cloud SDK (gcloud, auth configured)
- Artifact Registry repository and permissions
- Cloud Build if used for remote builds
## Definition of Done
- DoD aligned with project-wide standards (tests passing, docs, traceability). For this sprint: planning artifacts + validation + PR.
---
## Backlog (to implement single-service deploy)
1. CLI: Add `deploy` subcommand to brat — Completed (this sprint)
   - Accept: `<service>` or `--service <name>` — Implemented via `brat deploy service <name>` and alias `brat deploy <name>`
   - Flags: `--env`, `--project`, `--region`, `--image-tag`, `--repo`, `--dry-run` — Implemented (`--image-tag` and `--repo` now supported; defaults: tag=git short sha, repo=bitbrat-services)
   - Validate service against architecture.yaml — Implemented
2. Service discovery from architecture.yaml
   - Parse `services` map and default settings under `defaults.services`
   - Resolve entry path → Dockerfile mapping
   - Read security.allowUnauthenticated, port, region, scaling, env, secrets
3. Docker build selection
   - Map service → Dockerfile.* name and build context
   - Support optional `--image-tag` (default: git sha short)
4. Image build and push
   - Build locally with Docker or Cloud Build (toggle)
   - Tag and push to Artifact Registry `<region>-docker.pkg.dev/<project>/<repo>/<image>:<tag>`
5. Cloud Run deploy
   - Deploy service with name `bitbrat-<service>`
   - Apply env vars and secret mounts
   - Apply scaling (min/max), CPU, memory defaults from deploymentDefaults/architecture.yaml
   - Set allow-unauthenticated based on service config
6. Env + secrets resolution
   - From `defaults.services.env` plus service-specific `env`
   - Secrets from `secrets` list
   - Validate presence (warn/error as appropriate)
7. Observability defaults
   - Wire labels/annotations if needed (future)
8. Logging and dry-run
   - Print planned actions when `--dry-run` is set (no side effects)
9. Tests
   - Unit tests for CLI and parsing — Deferred to next sprint
   - Integration tests with mocked gcloud — Deferred
10. Documentation
   - README section: `npm run brat deploy <service>` usage
   - Examples for oauth-flow, ingress-egress
11. Safety & rollback
   - Record previous revision URL
   - Provide flag to rollback to last successful revision
12. CI integration
   - Optional GitHub Action to run dry-run validate on PRs
---
## Milestones
- M1: CLI skeleton + service validation (unit-tested) — Partially met (code complete; tests deferred)
- M2: Build + push (dry-run supported)
- M3: Cloud Run deploy (dry-run + real)
- M4: Docs + examples