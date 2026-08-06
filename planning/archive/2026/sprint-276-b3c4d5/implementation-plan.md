# Implementation Plan – sprint-276-b3c4d5

## Objective
Ensure that `DISCORD_BOT_TOKEN` is appropriately used and validated, particularly when `DISCORD_USE_TOKEN_STORE` is set to `false`.

## Scope
- `src/common/config.ts`: Update `assertRequiredSecrets` to include Discord-related checks.
- `src/services/oauth/routes.ts`: Optionally check `discordUseTokenStore` before storing tokens if desired.
- `src/services/ingress/discord/discord-ingress-client.ts`: Verify current behavior.

## Deliverables
- Updated `src/common/config.ts` with improved secret validation.
- Unit tests verifying the improved validation.
- Verification that `ingress-egress` service uses `DISCORD_BOT_TOKEN` when store is disabled.

## Acceptance Criteria
- `assertRequiredSecrets` throws an error if `discordEnabled` is true, `discordUseTokenStore` is false, and `discordBotToken` is missing.
- `assertRequiredSecrets` throws an error if `discordClientId` or `discordClientSecret` are missing when they are needed for the OAuth flow.
- `DiscordIngressClient` successfully connects with a provided `DISCORD_BOT_TOKEN` when the store is disabled.

## Testing Strategy
- Create a unit test for `assertRequiredSecrets` to cover all new validation cases.
- Use existing `discord-bot-token-use.spec.ts` (newly created) to ensure existing behavior is maintained.

## Deployment Approach
Standard Cloud Build and Cloud Run deployment.

## Dependencies
None.

## Definition of Done
- Code changes implemented.
- All tests pass, including validation tests.
- PR created and URL recorded in `publication.yaml`.
- Documentation updated.
