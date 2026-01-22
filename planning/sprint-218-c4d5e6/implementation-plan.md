# Implementation Plan – sprint-218-c4d5e6

## Objective
Fix DNS resolution errors (`EAI_AGAIN`) when `llm-bot` attempts to connect to MCP servers using `.bitbrat.local` hostnames in the local Docker Compose environment.

## Scope
- Update `infrastructure/scripts/bootstrap-service.js` to support network aliases in generated Docker Compose files.
- Add logic to derive the correct `.bitbrat.local` alias for each service, aligning with `internal-load-balancer` rules in `architecture.yaml`.
- Regenerate all service compose files.

## Deliverables
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Updated `infrastructure/docker-compose/services/*.compose.yaml` files.

## Acceptance Criteria
- `llm-bot.compose.yaml` contains network aliases for `llm-bot.bitbrat.local`.
- `obs-mcp.compose.yaml` contains network aliases for `obs-mcp.bitbrat.local`.
- `auth.compose.yaml` contains network aliases for `auth.bitbrat.local`.
- `docker compose config` validates the new configuration.

## Testing Strategy
- Manual verification of generated compose files.
- `validate_deliverable.sh` will:
    - Bootstrap a service.
    - Check for the presence of `networks.bitbrat-network.aliases` in the generated file.
    - Run `docker compose config` validation.

## Definition of Done
- Code quality adheres to project standards.
- All service compose files regenerated.
- PR created and verification report completed.
