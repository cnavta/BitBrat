# Implementation Plan – sprint-143-e2f4a1

## Objective
- Update the Discord OAuth flow to ensure the bot has sufficient permissions to join channels and chat.

## Scope
- `src/types/index.ts`: Add `discordOauthPermissions` to `IConfig`.
- `src/common/config.ts`: Add `discordOauthPermissions` to validation schema and parsing logic.
- `src/services/oauth/providers/discord-adapter.ts`: Use `discordOauthPermissions` in the OAuth2 authorization URL.
- `architecture.yaml`: Add `DISCORD_OAUTH_PERMISSIONS` to the `oauth-flow` service.

## Deliverables
- Code changes in configuration and Discord adapter.
- Updated documentation/architecture.
- Unit tests to verify the generated OAuth URL.

## Acceptance Criteria
- The Discord OAuth2 authorize URL includes a `permissions` query parameter.
- The `permissions` value includes at least `VIEW_CHANNEL`, `SEND_MESSAGES`, and `READ_MESSAGE_HISTORY`.
- The permissions can be overridden via the `DISCORD_OAUTH_PERMISSIONS` environment variable.

## Testing Strategy
- Update/Add unit tests for `DiscordAdapter` to verify the generated URL.
- Verify `buildConfig` correctly parses the new environment variable.

## Deployment Approach
- Standard CI/CD via Cloud Build.

## Dependencies
- None.

## Definition of Done
- All changes are implemented and verified with tests.
- `npm test` passes.
- PR created.
- `validate_deliverable.sh` passes.
