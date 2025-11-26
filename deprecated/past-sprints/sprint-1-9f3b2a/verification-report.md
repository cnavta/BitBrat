# Deliverable Verification Report — Sprint 1 (sprint-1-9f3b2a)

Date: 2025-11-05 18:08 local

## Scope under verification
- Local deployment bootstrap via Docker Compose
- Minimal `oauth-flow` service container with health endpoints
- Configuration-first env merge and root-run enforcement

## Completed as Implemented
- [x] Configuration merge: `env/local/*.yaml` + `.secure.local` → `.env.local` via `infrastructure/scripts/merge-env.js`
- [x] Docker Compose infra: NATS + Firebase Emulator defined and healthy
- [x] Service include: `oauth-flow` built from repo root with `Dockerfile.oauth-flow`
- [x] Health endpoints: `/healthz`, `/readyz`, `/livez` return 200
- [x] Dynamic host port for service: `OAUTH_FLOW_HOST_PORT` (default 3001)
- [x] Root-run guards and Compose preflight (`docker compose … config`)
- [x] Jest unit tests for health handlers

## Partial or Mock Implementations
- [ ] `deploy-cloud.sh` is a stub (supports `--dry-run`) — full Cloud Build/Run workflow deferred to next sprint
- [ ] Publication PR created — action pending GitHub push/PR creation (see Publication section)

## Evidence (commands and outcomes)
- Build & test (from repo root):
  - `npm ci` → OK
  - `npm run build` → OK
  - `npm test` → OK (health endpoint tests pass)
- Local run:
  - `npm run local` → OK
  - Probes: `curl -sf http://localhost:${OAUTH_FLOW_HOST_PORT:-3001}/healthz|readyz|livez` → 200
- Config preflight:
  - `docker compose -f infrastructure/docker-compose/docker-compose.local.yaml -f infrastructure/docker-compose/services/oauth-flow.compose.yaml --env-file .env.local config` → OK

## Additional Observations
- ADC path normalization handles common pitfalls (quotes/export/tilde)
- Compose env_file must be project-directory relative (`.env.local`) — documented and enforced
- Host port conflicts mitigated via parameterized port with preflight check

## Acceptance Criteria Mapping
- `npm run local` starts infra + service with healthy checks → Met
- Health endpoints 200 on exposed port → Met
- Architecture defaults include `/readyz` and `/livez` → Met
- Basic Jest tests exist and pass → Met

## Next-sprint recommendations
- Implement Cloud Build pipelines and Cloud Run deployment (dry-run safe)
- IaC for Artifact Registry, Cloud Run, and Secret Manager bindings
- Optional: automatic free-port selection for local dev ergonomics
