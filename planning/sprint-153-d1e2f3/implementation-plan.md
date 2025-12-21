# Implementation Plan – sprint-153-d1e2f3

## Objective
- Establish platform-wide awareness of ingress source status (Twitch/Discord) and stream status (Started/Stopped), persisted in Firestore.

## Scope
- Architectural design for Source State tracking.
- Firestore schema for Source State.
- Twitch EventSub integration for `stream.online` and `stream.offline` events.
- Normalization of source status events to `InternalEventV2`.
- Persistence of source status to Firestore.

## Deliverables
- `planning/sprint-153-d1e2f3/technical-architecture.md`: Technical approach and design.
- Firestore Schema updates (documented).
- Code changes in `ingress-egress` service to publish status events.
- Code changes in `persistence` service (or a new observer) to update Firestore.
- Tests for new event listeners and state transitions.

## Acceptance Criteria
- Technical Architecture document is approved.
- Firestore contains a `sources` collection (or similar) with real-time status of connected ingress clients.
- Twitch stream status (Online/Offline) is accurately reflected in Firestore within seconds of the event.
- Services can query Firestore to determine if a source is connected and if a stream is live.

## Testing Strategy
- Unit tests for event normalization.
- Integration tests for Firestore state updates.
- Mocking Twitch EventSub for testing stream status transitions.

## Deployment Approach
- Deploy updated `ingress-egress` and `persistence` services to Cloud Run.
- Firestore security rules update if necessary.

## Dependencies
- Twitch API / EventSub permissions.
- GCP Project with Firestore enabled.

## Definition of Done
- All deliverables completed.
- `validate_deliverable.sh` passes.
- PR created and linked in `publication.yaml`.
- Documentation updated.
