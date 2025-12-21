# Implementation Plan – sprint-154-e4f5g6

## Objective
- Enable the persistence service to handle DLQ events and record terminal failures in the event store.

## Scope
- `persistence` service: topic subscriptions and DLQ event processing.
- `PersistenceStore`: data model and logic for dead-letter updates.
- `architecture.yaml`: update service definitions.

## Deliverables
- `planning/sprint-154-e4f5g6/technical-architecture.md`: Technical design for DLQ handling.
- Code changes in `src/apps/persistence-service.ts` to subscribe to DLQ topics.
- Code changes in `src/services/persistence/store.ts` and `model.ts` to handle DLQ updates.
- Updated `architecture.yaml`.
- Tests for DLQ processing in persistence service.
- `validate_deliverable.sh` for this sprint.

## Acceptance Criteria
- Persistence service successfully subscribes to `internal.deadletter.v1` and `internal.router.dlq.v1`.
- When a DLQ event is received, the corresponding event document in Firestore is updated with `status: ERROR`.
- The error details (reason, last step, error message) are recorded in the document.
- Idempotency is maintained (multiple DLQ events for the same correlationId handled correctly).

## Testing Strategy
- Unit tests for `PersistenceStore.applyDeadLetter`.
- Integration test or script to simulate a DLQ event and verify Firestore update.

## Deployment Approach
- Standard Cloud Run deployment for `persistence` service.

## Dependencies
- NATS/PubSub (depending on driver) for message delivery.
- Firestore for event storage.

## Definition of Done
- All deliverables completed.
- `validate_deliverable.sh` passes.
- PR created and URL recorded.
