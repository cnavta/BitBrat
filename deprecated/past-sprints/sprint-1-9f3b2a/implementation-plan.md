# Sprint 1 — Local Deployment Bootstrap (sprint-1-9f3b2a)

Date: 2025-11-05 11:15 local
Role: Cloud Architect

## Context and Architectural Grounding
- Canonical source: `architecture.yaml` (v0.1.0)
- Target runtimes and defaults:
  - Services run on Node 24.x, default port `3000`, default health path `/healthz` (to be expanded in this sprint), unauthenticated allowed, region `us-central1`.
  - Messaging uses NATS locally; Firestore via Firebase Emulator locally.
- Service in scope: `oauth-flow`
  - Description: OAuth2 auth service for streaming platforms (Twitch, etc.)
  - Entry: `src/apps/oauth-service.ts`
  - Paths: `/oauth/*` plus standard health endpoints.

## Sprint Objective (What “done” looks like)
Enable `npm run local` to:
1) Start local infrastructure using Docker Compose (NATS + Firestore Emulator) with healthy containers.
2) Build and run an empty containerized `oauth-flow` service exposing a minimal Express app with functioning health checks at `GET /healthz`, `GET /readyz`, and `GET /livez` on port 3000.

Non-goals in this sprint:
- Actual OAuth flows, secret handling, or inter-service messaging.
- Cloud deployment implementation (we will document the path forward).

## Deliverables
- Planning artifacts under `./planning/sprint-1-9f3b2a/`:
  - `implementation-plan.md` (this document)
  - `sprint-manifest.yaml` (metadata)
  - `request-log.md` (prompt traceability)
  - `validate_deliverable.sh` (validation scaffold; dry-run steps outlined)
- Local infra composition confirmed: Docker Compose base file for NATS + Firestore Emulator (present at `infrastructure/docker-compose/docker-compose.local.yaml`) plus service include files.
- A plan to add a minimal `oauth-flow` service container and wire it into the local run command via Compose includes.

## Acceptance Criteria
- Running `npm run local` performs the following end-to-end:
  - Starts NATS and the Firestore Emulator via Docker Compose (multi-file includes) without error and with passing container healthchecks.
  - Builds a container image for `oauth-flow` and starts it via a Compose include file.
  - `curl http://localhost:3000/healthz` returns `200 OK` with a simple JSON payload `{ "status": "ok", "service": "oauth-flow" }` (format may include build/version info).
  - `curl http://localhost:3000/readyz` returns HTTP 200 once the app is ready, and `/livez` returns HTTP 200 when the process is alive.
  - `architecture.yaml` defaults include the health endpoints: `/healthz`, `/readyz`, `/livez`.
  - Console output clearly indicates how to override local env vars (e.g., `LOG_LEVEL`, `NATS_URL`, `MESSAGE_BUS_DRIVER`, `BUS_PREFIX`, `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`).

## Testing Strategy
- Basic Jest unit tests for the Express health handlers (`/healthz`, `/readyz`, `/livez`) to satisfy project DoD (tests alongside code, externals mocked).
- No integration tests in this sprint.

## Deployment Approach (Local, Compose-first)
- Use Docker Compose include files to compose infra + services with a single command.
  - Base infra file: `infrastructure/docker-compose/docker-compose.local.yaml` (NATS, Firebase Emulator)
  - Service include file(s): e.g., `infrastructure/docker-compose/services/oauth-flow.compose.yaml`
- `npm run local` invokes a single script (`infrastructure/deploy-local.sh`) that:
  1. Ensures required environment variables or sane defaults are set:
     - `LOG_LEVEL=debug`
     - `MESSAGE_BUS_DRIVER=nats`
     - `NATS_URL=nats://localhost:4222`
     - `BUS_PREFIX=local`
     - `FIREBASE_PROJECT_ID=bitbrat-local` (default)
     - `GOOGLE_APPLICATION_CREDENTIALS` must point to a local service account JSON file for ADC (kept by design)
  2. Runs Compose with includes (idempotent):
     ```bash
     docker compose \
       -f infrastructure/docker-compose/docker-compose.local.yaml \
       -f infrastructure/docker-compose/services/oauth-flow.compose.yaml \
       up -d --build
     ```
  3. Performs health probes against `http://localhost:3000/healthz` (and optionally `/readyz`, `/livez`) and reports status.
  4. Provides `down`/`cleanup` guidance (e.g., `docker compose -f <files> down`).

## Emulator Bootstrap Review and Adjustments
- The repo now includes: `infrastructure/docker-compose/firebase-emulator-bootstrap.sh`.
- Current Compose references `/workspace/scripts/firebase-emulator-bootstrap.sh`, but the actual path in the container (with `.:/workspace`) would be `/workspace/infrastructure/docker-compose/firebase-emulator-bootstrap.sh`.
- Planned adjustment: update the Compose command to call the correct path to avoid a file-not-found error; or mount an additional bind for `/workspace/scripts` to map to the same file. We will prefer updating the command for clarity.
- The bootstrap script itself is idempotent, sets `HOME=/data`, seeds `/data` with `firebase.json` and rules, and attempts ADC-based auth using `GOOGLE_APPLICATION_CREDENTIALS`. This aligns with the decision to keep ADC via `GOOGLE_APPLICATION_CREDENTIALS` and is acceptable.

## Required Work (post-approval implementation)
1. Minimal Express app per `architecture.yaml`:
   - File: `src/apps/oauth-service.ts` with `/healthz`, `/readyz`, `/livez` responding 200 and basic metadata.
2. Add a per-service Dockerfile:
   - `Dockerfile.oauth-flow` using Node 24 base; install prod deps; copy compiled `dist`; expose 3000; `CMD ["node", "dist/apps/oauth-service.js"]`.
3. Compose include for service:
   - Create `infrastructure/docker-compose/services/oauth-flow.compose.yaml` defining the `oauth-flow` service with `build:` pointing to repo root (context) and Dockerfile override.
   - Add a container healthcheck hitting `/healthz`.
4. Local orchestration script:
   - Create/complete `infrastructure/deploy-local.sh` to execute multi-file Compose up/down and perform health probes.
5. Package.json fix and scripts:
   - Remove trailing comma; ensure `local` script calls `infrastructure/deploy-local.sh` with include files.
6. Jest tests:
   - Add `src/apps/oauth-service.test.ts` covering `/healthz`, `/readyz`, `/livez` handlers (mock Express as needed).
7. Architecture defaults update:
   - Update `architecture.yaml` defaults to add `/readyz` and `/livez` to the health endpoints list.
8. Compose emulator command path fix:
   - Update the bootstrap call path to `bash /workspace/infrastructure/docker-compose/firebase-emulator-bootstrap.sh`.

## Decisions Incorporated (from stakeholder responses)
- Use Docker Compose include files to manage services together; single `up` command for infra + `oauth-flow`.
- Keep `GOOGLE_APPLICATION_CREDENTIALS`; app will use GCP ADC.
- Bootstrap script has been added; we will correct its invocation path in Compose.
- Naming is now consistent (`oauth-flow`); future IaC and routing will use this consistently.
- One Dockerfile per service.
- Add `/readyz` and `/livez` as standard health endpoints and append to `architecture.yaml` defaults.

## Risks and Mitigations
- Compose script path mismatch → Fix invocation path as noted.
- ADC file handling → Document how to provide a local service account JSON; fail early with a clear message if missing.
- JSON invalid in `package.json` → Fix immediately to unblock tooling.

## Definition of Done (Sprint 1)
- `npm run local` reliably starts NATS + Firestore Emulator and the `oauth-flow` container via Compose includes.
- `GET /healthz`, `GET /readyz`, and `GET /livez` return 200 from `oauth-flow` locally.
- A basic Jest test exists and passes for the health handlers.
- Planning artifacts created and maintained under `./planning/sprint-1-9f3b2a/`.
- Validation script scaffold present and documents steps; will be made fully functional as code lands.

## Next Steps (after approval)
- Implement the minimal service, Dockerfile, Compose include, `deploy-local.sh`, package.json fix, tests, and architecture defaults update.
- Run validation steps locally and iterate on gaps.


---

## Plan Update v2 — Configuration‑First Implementation (2025-11-05 12:40 local)

Approved changes now implemented:
- Added configuration merge flow (env/<env>/*.yaml + .secure.local → .env.local) via `infrastructure/scripts/merge-env.js` (Node + js-yaml)
- Orchestration entrypoint `infrastructure/deploy-local.sh` to generate `.env.local`, run Compose includes, and probe health
- Fixed Firebase emulator bootstrap path in Compose
- Implemented minimal `oauth-flow` Express app with `/healthz`, `/readyz`, `/livez`
- Added Jest tests for health endpoints
- Added `Dockerfile.oauth-flow` and Compose include `infrastructure/docker-compose/services/oauth-flow.compose.yaml`
- Populated `env/local/infra.yaml` and `env/local/oauth-flow.yaml`; kept `env/local/global.yaml`
- Updated `architecture.yaml` defaults to include `/readyz` and `/livez`
- Adjusted root `validate_deliverable.sh` to use `infrastructure/*` scripts

Runbook (local):
1) Create `.secure.local` with at least:
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/local-sa.json`
2) `npm ci`
3) `npm run build`
4) `npm test`
5) `npm run local` (or `npm run local -- --dry-run` first)
6) Verify `http://localhost:3000/healthz|readyz|livez`
7) `npm run local:down` to stop
