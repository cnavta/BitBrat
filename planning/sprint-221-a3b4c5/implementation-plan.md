# Implementation Plan – sprint-221-a3b4c5

## Objective
- Add the ability to send Twitch DMs (whispers) when an event has `egress.type = 'dm'`.

## Scope
- Update `InternalEventV1` and `InternalEventV2` to support the new `Egress` type (already partially done).
- Modify `ingress-egress-service.ts` to handle the `dm` egress type for Twitch.
- Integrate with Twitch Helix API to send whispers (IRC whispers are deprecated).
- Ensure the whisper is sent to the initiator of the original message (`userId` in the event).

## Deliverables
- Technical Architecture document for Twitch DM support.
- Updated `ingress-egress-service.ts` with DM handling logic.
- Tests for DM egress functionality.

## Acceptance Criteria
- When an event with `egress.type = 'dm'` and `source = 'ingress.twitch'` is received on the egress topic:
    - If the platform is Twitch, it should call the Twitch API to send a whisper.
    - The whisper recipient should be the `userId` from the event.
    - If successful, it should publish a 'SENT' finalization event.
    - If it fails, it should publish a 'FAILED' finalization event.

## Testing Strategy
- Integration tests in `src/apps/ingress-egress-service.test.ts` or a new test file.
- Mock Twitch API client to verify whisper calls.

## Deployment Approach
- Deploy via Cloud Build to Cloud Run as part of the `ingress-egress` service.

## Dependencies
- Twitch Helix API access (requires appropriate scopes).

## Definition of Done
- Technical Architecture document created.
- Implementation complete.
- Tests passing.
- `validate_deliverable.sh` passes.
- PR created.