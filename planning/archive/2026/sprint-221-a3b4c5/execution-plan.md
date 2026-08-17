# Execution Plan — sprint-221-a3b4c5

## Objective
Implement Twitch DM (Whisper) support in the egress pipeline by leveraging the Twitch Helix API and the updated `egress.type` property in the event envelope.

## Scope
- Enhance `TwitchIrcClient` with `sendWhisper` capability using Twitch Helix.
- Update `ingress-egress-service.ts` to route messages based on `egress.type`.
- Implement rate limiting and error handling for Twitch whispers.

## Deliverables
- Enhanced `src/services/ingress/twitch/twitch-irc-client.ts`.
- Updated `src/apps/ingress-egress-service.ts`.
- Unit tests for new logic.
- `validate_deliverable.sh` updated for this sprint.

## Execution Phases

### Phase 1: Twitch Client Enhancement
1. **BL-002**: Add `sendWhisper` to `TwitchIrcClient`.
    - Use `twurple`'s Helix client (or raw API if necessary, but `twurple` is preferred as it's already used).
    - Ensure `user:manage:whispers` scope handling.
    - Target `userId` as recipient.

### Phase 2: Egress Pipeline Logic
1. **BL-003**: Update delivery logic in `ingress-egress-service.ts`.
    - Check `evt.egress?.type === 'dm'`.
    - Branch to `twitchClient.sendWhisper` when appropriate.
2. **BL-004**: Implement error handling and rate limiting.
    - Handle Twitch API errors for whispers.
    - Ensure `finalize` topic is notified of success/failure.

### Phase 3: Validation
1. **BL-005**: Testing and Verification.
    - Write unit tests for `TwitchIrcClient.sendWhisper`.
    - Write integration test for the egress pipeline branching logic.
    - Create/update `validate_deliverable.sh`.

## Definition of Done
- All code changes follow project style.
- Tests pass (`npm test`).
- `validate_deliverable.sh` runs successfully.
- PR created and verified.
