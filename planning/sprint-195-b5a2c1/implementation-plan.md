# Implementation Plan – sprint-195-b5a2c1

## Objective
Restore the local execution environment (`npm run local`) to a functional and user-friendly state by addressing identified configuration gaps and documentation deficiencies.

## Scope
- Configuration files in `env/local/`.
- Environment variable templates (`.env.example`).
- Local deployment scripts (`deploy-local.sh`, `merge-env.js`).
- Documentation (`README.md`).

## Deliverables
- New YAML configuration files: `auth.yaml`, `event-router.yaml`, `persistence.yaml`, `scheduler.yaml` in `env/local/`.
- New `.env.example` in the repository root.
- Updates to `README.md` for local setup instructions.
- (Optional) Improvements to `deploy-local.sh` for better error messaging.

## Acceptance Criteria
- `npm run local -- --dry-run` succeeds without errors for all services.
- All services pass the `BaseServer.ensureRequiredEnv` check when started locally (provided required secrets are in `.env.local`).
- A new developer can follow `README.md` to set up the local environment from scratch.
- `validate_deliverable.sh` completes successfully.

## Testing Strategy
- Manual verification of `npm run local -- --dry-run`.
- Individual service start-up tests to verify `ensureRequiredEnv` passes.
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
