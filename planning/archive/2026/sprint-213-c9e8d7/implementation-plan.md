# Implementation Plan – sprint-213-c9e8d7

## Objective
Fix service discovery issues in the local Docker Compose environment where services are unable to resolve the 'nats' hostname.

## Scope
- Modify `infrastructure/scripts/bootstrap-service.js` to explicitly include the `bitbrat-network` in the generated Docker Compose files for each service.
- Regenerate all service compose files.
- Verify that services can resolve 'nats'.

## Deliverables
- Updated `infrastructure/scripts/bootstrap-service.js`.
- Regenerated `infrastructure/docker-compose/services/*.compose.yaml` files.
- Validation report confirming service discovery works.

## Acceptance Criteria
- Generated compose files for all services include the `networks: bitbrat-network:` section.
- `docker compose config` validates that all services are on the same network.
- Services can successfully connect to NATS (no `ENOTFOUND nats` error).

## Testing Strategy
- Dry-run validation using `docker compose config`.
- Manual verification of generated files.
- Run `validate_deliverable.sh` which will include a check for the network configuration.

## Deployment Approach
- Local script modification and file regeneration.

## Dependencies
- `docker-compose`
- `bitbrat-network` must exist (managed by `deploy-local.sh`).

## Definition of Done
- All Acceptance Criteria met.
- Sprint artifacts created.
- PR created.
