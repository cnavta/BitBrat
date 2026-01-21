# Sprint Execution Plan – sprint-204-c4d5e6

## Objective
Implement MCP administrative capabilities in the Auth service, including user role management and cross-platform banning.

## Phase 1: Foundation & UserRepo Enhancements
- **Goal**: Prepare the data layer for administrative operations.
- **Tasks**:
    - Implement `updateUser` in `FirestoreUserRepo`.
    - Implement `searchUsers` in `FirestoreUserRepo` to allow finding users by display name or email.
    - Add unit tests for these new methods.

## Phase 2: Auth Service MCP Migration
- **Goal**: Expose administrative tools via MCP.
- **Tasks**:
    - Refactor `AuthServer` to extend `McpServer`.
    - Register `update_user` MCP tool.
    - Register `ban_user` MCP tool.
    - Implement moderation event emission (`moderation.action.v1`) when a user is banned.
    - Integration tests for MCP tools.

## Phase 3: Ingress-Egress Service Moderation Handling
- **Goal**: Enable cross-platform banning.
- **Tasks**:
    - Update `IngressEgressServer` to subscribe to `moderation.action.v1`.
    - Implement `banUser` in `TwitchConnectorAdapter` (using Twitch API).
    - Implement `banUser` in `DiscordIngressClient` (using Discord API).
    - Wiring moderation events to connector `banUser` methods.

## Phase 4: Validation & Publication
- **Goal**: Ensure everything works end-to-end and publish.
- **Tasks**:
    - Final end-to-end validation using `validate_deliverable.sh`.
    - Update documentation if necessary.
    - Create Pull Request.
