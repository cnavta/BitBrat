# Implementation Plan – sprint-268-b7a1e2

## Objective
- Resolve the "not_supported" error in Discord OAuth callback by implementing `exchangeCodeForToken` in `DiscordAdapter`.

## Scope
- Implement `exchangeCodeForToken` in `src/services/oauth/providers/discord-adapter.ts`.
- Ensure it handles the `bot` identity, which might involve different parameters or expected outcomes.
- Update `DiscordAdapter` to use necessary environment variables for token exchange (Client Secret).

## Deliverables
- `src/services/oauth/providers/discord-adapter.ts`: Implementation of `exchangeCodeForToken`.
- `planning/sprint-268-b7a1e2/validate_deliverable.sh`: Validation script.

## Acceptance Criteria
- `oauth-flow` callback for Discord `bot` identity no longer returns 500 with `not_supported`.
- Discord token exchange is correctly implemented using standard OAuth2 `authorization_code` grant.
- Bot-specific information (like `guild_id`) is captured if available in the callback.

## Testing Strategy
- Unit test for `DiscordAdapter.exchangeCodeForToken`.
- Integration test in `src/services/oauth/routes.test.ts` (mocking the Discord exchange).

## Definition of Done
- Code updated and verified with tests.
- PR created.
