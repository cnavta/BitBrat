# Implementation Plan – sprint-310-b4c5d6

## Objective
Update the auth service to emit system events for a user's first session message and first message ever.

## Scope
- `src/types/events.ts`: Define new event types and system event topic.
- `src/apps/auth-service.ts`: Implement logic to emit system events.
- `src/services/auth/enrichment.ts`: Ensure enrichment flags are correctly propagated.
- `tests/`: Add integration tests for the new events.

## Deliverables
- Code changes in Auth Service.
- Updated Event contracts.
- Integration tests.
- `validate_deliverable.sh` script.

## Acceptance Criteria
- When a user sends their first message ever, a `system.user.first_message` event is published to `internal.system.events.v1`.
- When a user sends their first message in a new session, a `system.user.first_session_message` event is published to `internal.system.events.v1`.
- System events include the `userRef` and `correlationId`.
- The original event flow remains uninterrupted.

## Testing Strategy
- **Unit Tests:** Update `enrichment.spec.ts` to verify flags are correctly set.
- **Integration Tests:** Use a test message bus to verify that processing an event in `AuthServer` results in the expected system events being published.

## Deployment Approach
- Standard Cloud Build and Cloud Run deployment for the auth service.

## Dependencies
- Message Bus (Pub/Sub or NATS).
- Firestore (for user repository).

## Definition of Done
- All acceptance criteria met.
- `validate_deliverable.sh` passes.
- PR created and linked.
