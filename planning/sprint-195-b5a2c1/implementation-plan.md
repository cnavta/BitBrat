# Implementation Plan – sprint-195-b5a2c1

## Objective
Restore the local execution environment (`npm run local`) to a functional and user-friendly state, provide tools for viewing local logs, and resolve systemic issues with emulators and service synchronization.

## Scope
- Configuration files in `env/local/`.
- Environment variable templates (`.env.example`).
- Local deployment scripts (`deploy-local.sh`, `merge-env.js`).
- Local log viewing command (`npm run local:logs`).
- Docker Compose configuration for emulators and service dependencies.
- Emulator Docker image optimization.
- Documentation (`README.md`).

## Deliverables
- New YAML configuration files: `auth.yaml`, `event-router.yaml`, `persistence.yaml`, `scheduler.yaml` in `env/local/`.
- New `.env.example` in the repository root.
- Updates to `README.md` for local setup and log viewing instructions.
- New `npm run local:logs` command implementation.
- Optimized `firebase-emulator` setup (pre-baked dependencies or improved init).
- Pub/Sub emulator integration in `docker-compose.local.yaml`.
- Healthchecks and `depends_on` improvements in Docker Compose.
- NATS healthcheck fix (replace `wget` with `curl`).
- Populated missing environment variables in `env/local/*.yaml`.

## Acceptance Criteria
- `npm run local -- --dry-run` succeeds without errors for all services.
- All services pass the `BaseServer.ensureRequiredEnv` check when started locally.
- `firebase-emulator` starts without massive runtime `apt-get` installs.
- Services connect to the Pub/Sub emulator instead of real GCP Pub/Sub.
- Services wait for emulators to be healthy before starting.
- `npm run local:logs` successfully shows logs from running containers.
- `validate_deliverable.sh` completes successfully.

## Testing Strategy
- Manual verification of `npm run local`.
- Observation of container logs to verify startup sequence and emulator connectivity.
- Verification of `.env.local` generation via `merge-env.js`.

## Deployment Approach
- This sprint focuses on local development infrastructure; no cloud deployment is required.

## Dependencies
- Local Docker installation.
- Valid Google Cloud Service Account key for ADC (for full functionality).

## Definition of Done
- All deliverables completed.
- `validate_deliverable.sh` passes.
- PR created and linked in manifest.
- Retro and learnings documented.
