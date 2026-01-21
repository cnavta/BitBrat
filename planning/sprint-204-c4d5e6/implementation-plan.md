# Implementation Plan – sprint-204-c4d5e6

## Objective
- Add MCP administrative capabilities to the auth service.
- Enable updating user roles (e.g., VIP) and banning users via MCP tools.
- Implement cross-platform banning triggers.

## Scope
- `AuthServer` migration to `McpServer`.
- `UserRepo` enhancements (update, search).
- MCP tool registration (`update_user`, `ban_user`).
- `moderation.action.v1` event emission and handling.
- Twitch and Discord connector updates for platform-level banning.

## Deliverables
- `src/apps/auth-service.ts`: Updated to extend `McpServer` and register tools.
- `src/services/auth/user-repo.ts`: Added `updateUser` and `searchUsers`.
- `src/apps/ingress-egress-service.ts`: Added subscription to `moderation.action.v1`.
- `src/services/ingress/twitch/twitch-irc-client.ts`: Added `banUser` support (or via connector adapter).
- `src/services/ingress/discord/discord-ingress-client.ts`: Added `banUser` support.

## Acceptance Criteria
- Bot can add/remove roles from a user via MCP tool call.
- Bot can ban a user via MCP tool call.
- Banning a user sets their Firestore status to "banned".
- Banning a user triggers a platform-specific ban if supported (Twitch/Discord).
- `validate_deliverable.sh` passes.

## Testing Strategy
- Unit tests for `UserRepo` search/update.
- Integration tests for `AuthServer` MCP tools (using `McpClient`).
- Mocked platform API calls for Twitch/Discord bans.

## Deployment Approach
- Cloud Build for service deployment.
- Ensure OAuth scopes for Twitch are updated if necessary (manual step).

## Dependencies
- Model Context Protocol SDK.
- Firestore.
- Twitch/Discord bot permissions.

## Definition of Done
- All code changes trace back to this sprint.
- `validate_deliverable.sh` is passable.
- PR is created.
