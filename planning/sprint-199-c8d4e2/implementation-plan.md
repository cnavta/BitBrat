# Implementation Plan – sprint-199-c8d4e2

## Objective
- Ensure all microservices defined in Docker Compose wait for infrastructure dependencies (NATS and Firebase Emulator) to be healthy before starting.

## Scope
- `infrastructure/docker-compose/services/*.compose.yaml`
- `infrastructure/docker-compose/docker-compose.local.yaml` (for healthcheck verification)

## Deliverables
- Updated Docker Compose service files with robust `depends_on` conditions.
- `validate_deliverable.sh` for this sprint.
- Verification report and retro.

## Acceptance Criteria
- All service compose files use the long-form `depends_on` with `condition: service_healthy` for `nats` and `firebase-emulator`.
- `docker compose config` passes with the updated files.
- Services do not start implementation-level logic until infra is ready (as enforced by Compose).

## Testing Strategy
- Manual verification of `docker compose config`.
- Dry-run validation via `validate_deliverable.sh`.
- Local execution test using `npm run local`.

## Definition of Done
- `validate_deliverable.sh` passes.
- PR created and branch pushed.
- Sprint artifacts documented.
