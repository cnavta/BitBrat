# Sprint Execution Plan – sprint-151-a2b3c4

## Objective
Implement user data enrichment from Twitch and Discord as defined in the technical architecture documentation (`architecture-enrichment.md`). This plan focuses on expanding the `auth` service's capabilities to capture, normalize, and persist platform-specific user metadata.

## Scope
- **Data Model**: Expansion of `AuthUserDoc` to include `profile` and `rolesMeta`.
- **Repository**: Enhancing `FirestoreUserRepo` to handle new fields and ensure idempotent merging of platform data.
- **Enrichment Logic**: Updating `enrichment.ts` to extract data from `rawPlatformPayload` for both Twitch and Discord.
- **Normalization**: Implementing a configurable mapping for Discord server roles to platform-wide "moderator" status.

## Deliverables
- **Core Code**:
  - Updated `src/services/auth/user-repo.ts` (Interfaces and implementation).
  - Updated `src/services/auth/enrichment.ts` (Twitch/Discord mapping logic).
- **Tests**:
  - Updated unit tests in `src/services/auth/__tests__/enrichment.spec.ts`.
  - New integration tests in `src/services/auth/__tests__/user-repo.test.ts` (if it exists, otherwise create it).
- **Backlog**: `planning/sprint-151-a2b3c4/backlog.yaml` (task-level tracking).

## Acceptance Criteria
- **Twitch Enrichment**:
  - `isMod` -> `roles: ["moderator"]` + `rolesMeta.twitch: ["moderator"]`.
  - `isSubscriber` -> `roles: ["subscriber"]` + `rolesMeta.twitch: ["subscriber"]`.
  - `badges` containing `broadcaster`/`vip` -> appropriate roles and meta.
  - `user-login` persisted in `profile.username`.
- **Discord Enrichment**:
  - `author.username` persisted in `profile.username`.
  - `member.roles` captured in `rolesMeta.discord`.
  - `DISCORD_MOD_ROLES` mapping correctly identifies moderators.
  - `guild.ownerId == author.id` correctly identifies owners.
- **Persistence**: Data merged into Firestore without losing existing platform-specific metadata.

## Testing Strategy
1. **Unit Tests**: Mock `rawPlatformPayload` for various Twitch/Discord scenarios and verify `enrichEvent` output.
2. **Integration Tests**: Use a Firestore emulator or test collection to verify that `ensureUserOnMessage` correctly merges data over multiple calls (e.g., a user seen on Twitch then seen on Discord).

## Deployment Approach
- Deploy `auth` service to Cloud Run.
- Configure `DISCORD_MOD_ROLES` secret/env var if applicable.
- Monitor `internal.user.enriched.v1` for correct payload structure.

## Dependencies
- `internal.ingress.v1` payload structure (must contain `rawPlatformPayload`).
- `DISCORD_MOD_ROLES` configuration.

## Definition of Done
- All backlog items in `backlog.yaml` marked as `done`.
- `validate_deliverable.sh` passes successfully.
- Code reviewed and PR created.
- `verification-report.md` confirms all requirements met.
