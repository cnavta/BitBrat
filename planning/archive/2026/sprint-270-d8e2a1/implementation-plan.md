# Implementation Plan – sprint-270-d8e2a1

## Objective
- Implement the missing `exchangeCodeForToken` logic in `DiscordAdapter` to support OAuth callback flows and resolve the "not_supported" error.

## Scope
- `src/services/oauth/providers/discord-adapter.ts`: Implement the `exchangeCodeForToken` method.
- `src/services/oauth/providers/discord-adapter.test.ts`: Add unit tests for the token exchange.

## Deliverables
- Code changes in `DiscordAdapter` to handle OAuth2 code-for-token exchange with Discord.
- Unit tests verifying success and failure scenarios for the token exchange.

## Acceptance Criteria
- `DiscordAdapter.exchangeCodeForToken` successfully exchanges a valid code for an access token.
- The method correctly handles Discord-specific metadata (guild_id, permissions) if present.
- Unit tests pass.
- The "not_supported" error is no longer thrown during the Discord callback flow.

## Testing Strategy
- Unit tests for `DiscordAdapter.exchangeCodeForToken` using mocks for the Fetch API.
- Integration test using `src/services/oauth/routes.test.ts` to ensure the callback route works with the new implementation.

## Deployment Approach
- Standard Cloud Build / Cloud Run deployment (out of scope for local implementation, but verified via dry-run).

## Dependencies
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` must be configured in `IConfig`.

## Definition of Done
- Code follows project style.
- Tests pass.
- Documentation (request-log, verification-report) updated.
- Pull Request created.
