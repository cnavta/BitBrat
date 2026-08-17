# Implementation Plan – sprint-212-f4b9e2

## Objective
Ensure environment variables from `.secure.local` are correctly incorporated into image-only services like `obs-mcp` in the local Docker Compose environment.

## Scope
- Investigate the interaction between `env_file: .env.local` and the `environment:` section in generated compose files.
- Fix `infrastructure/scripts/bootstrap-service.js` to ensure variables are correctly passed.
- Ensure `infrastructure/deploy-local.sh` properly handles environment variable propagation.

## Deliverables
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Regenerated `infrastructure/docker-compose/services/*.compose.yaml` (where applicable).
- Updated `infrastructure/deploy-local.sh` if necessary.

## Acceptance Criteria
- Variables defined in `.secure.local` (and thus `.env.local`) are available inside the `obs-mcp` container.
- `npm run local -- --service-name obs-mcp` works as expected with all required secrets.
- No regression for `entry`-based services.

## Testing Strategy
- Create a test `.secure.local` with a dummy variable.
- Bootstrap `obs-mcp`.
- Run `npm run local -- --service-name obs-mcp --dry-run` and inspect the generated config.
- Run a real local instance (if possible) and check env via `docker exec`.

## Definition of Done
- Implementation matches the plan.
- Validation script passes.
- PR created.
- Retro and learnings documented.