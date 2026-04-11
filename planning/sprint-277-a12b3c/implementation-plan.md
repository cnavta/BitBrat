# Implementation Plan – sprint-277-a12b3c

## Objective
- Ensure Twitch stream.online events are published with 'system.stream.online' type instead of 'twitch.eventsub.v1'.
- Fix the persistence service to correctly record 'system.stream.online' and 'system.stream.offline' events in the 'events' collection as initial ingress events.

## Scope
- Twitch EventSub ingress normalization.
- `eventsub-envelope-builder.ts` and its callers.
- `src/apps/persistence-service.ts` message handler logic.

## Deliverables
- Code fix for event type normalization.
- Code fix for persistence routing of 'system.' events.
- Unit tests for both fixes.
- Verification report.

## Acceptance Criteria
- When a Twitch `stream.online` event is received via EventSub, the internal event published to `internal.ingress.v1` has `type: 'system.stream.online'`.
- The persistence service records these events in the `events` Firestore collection (via `upsertIngressEvent`) and updates the `sources` collection (via `upsertSourceState`).
- Downstream services (e.g., `event-router`) can find the event aggregate by `correlationId`.

## Testing Strategy
- Unit test for `EventsubEnvelopeBuilder` (completed).
- Integration/unit test for `PersistenceServer` logic (using mocks or stubs).
- Verify the published event type in the `internal.ingress.v1` topic.

## Deployment Approach
- Cloud Run (standard BitBrat deployment).

## Definition of Done
- Code quality adheres to standards.
- Tests pass.
- PR created.
- Documentation updated.
