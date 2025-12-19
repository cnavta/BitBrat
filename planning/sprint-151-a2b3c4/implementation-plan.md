# Implementation Plan – sprint-151-a2b3c4

## Objective
Implement user data enrichment from Twitch and Discord as defined in the technical architecture.

## Scope
- `AuthUserDoc` interface expansion.
- `UserRepo.ensureUserOnMessage` signature update.
- `FirestoreUserRepo` implementation update.
- `enrichment.ts` logic update for Twitch and Discord.
- Configuration support for Discord roles mapping.

## Deliverables
- Code changes in `src/services/auth/user-repo.ts` and `src/services/auth/enrichment.ts`.
- Updated tests in `src/services/auth/__tests__/enrichment.spec.ts`.
- Documentation in `planning/sprint-151-a2b3c4/architecture-enrichment.md`.

## Acceptance Criteria
- Twitch `isMod` and `isSubscriber` flags are correctly mapped to user roles and persisted in Firestore.
- Twitch `login` is persisted as `profile.username`.
- Discord `roles` are captured and mapped to `moderator` role based on configuration.
- Discord `username` is persisted as `profile.username`.
- `internal.user.enriched.v1` events contain the enriched user object.

## Testing Strategy
- Unit tests for `enrichEvent` with mocked Twitch and Discord payloads.
- Integration tests for `FirestoreUserRepo` to verify Firestore persistence.

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build.
- Ensure `DISCORD_MOD_ROLES` is set in the environment if needed for verification.

## Dependencies
- Firestore (for persistence).
- Discord/Twitch event payloads (provided via `internal.ingress.v1`).

## Definition of Done
- Technical Architecture document created and approved.
- Implementation completed and verified via tests.
- PR created and linked in `publication.yaml`.
- Sprint directory updated with all required artifacts.
