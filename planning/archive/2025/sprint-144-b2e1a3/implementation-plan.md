# Implementation Plan – sprint-144-b2e1a3

## Objective
- Re-introduce `DISCORD_BOT_TOKEN` as a valid configuration option for the Discord ingress, ensuring it is properly managed as a secret and used by the `ingress-egress` service.

## Scope
- `architecture.yaml`: Add `DISCORD_BOT_TOKEN` to `ingress-egress` secrets.
- `src/services/ingress/discord/discord-ingress-client.ts`: Ensure the client uses the configured `discordBotToken` from environment if available/appropriate.
- `src/common/config.ts`: Verify that `DISCORD_BOT_TOKEN` is correctly mapped.

## Deliverables
- Updated `architecture.yaml`.
- Updated `ingress-egress` configuration/service code if needed.
- Tests verifying token fallback/usage.

## Acceptance Criteria
- `DISCORD_BOT_TOKEN` is listed in `architecture.yaml` secrets for `ingress-egress`.
- Ingress service can start using `DISCORD_BOT_TOKEN` from environment.
- Tests confirm that the token is picked up correctly.

## Testing Strategy
- Unit tests for configuration parsing.
- Integration tests or mocks for `DiscordIngressClient` to verify it uses the token.

## Deployment Approach
- Cloud Build deployment (dry-run).
- Environment variables updated in secret manager (manual/out of scope for this script, but documented).

## Dependencies
- Discord Bot Token (must be provided in environment for tests if not mocked).

## Definition of Done
- All code changes trace back to this sprint.
- `validate_deliverable.sh` passes.
- PR created.
