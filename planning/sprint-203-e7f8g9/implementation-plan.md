# Implementation Plan – sprint-203-e7f8g9

## Objective
Resolve the "push consumer requires deliver_subject" error in NATS JetStream subscriptions.

## Scope
- `src/services/message-bus/nats-driver.ts`: Refactor `subscribe` method to ensure `deliverTo` is always called for push consumers.

## Deliverables
- Modified `nats-driver.ts`.
- Tests verifying that both queue-based and non-queue-based subscriptions work without the "deliver_subject" error.

## Acceptance Criteria
- No "push consumer requires deliver_subject" errors in logs when starting services.
- Messages are correctly delivered to subscribers, including those in queue groups.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Update `src/services/message-bus/nats-driver.test.ts` to mock the behavior and ensure `deliverTo` is called in all scenarios.
- (Optional) Manual verification by running `npm run local` and checking logs.

## Deployment Approach
- N/A (Local fix for dev environment).

## Dependencies
- NATS server with JetStream enabled (already in Docker Compose).

## Definition of Done
- Implementation plan approved.
- Code changes applied.
- Tests passing.
- Validation script passing.
- PR created.
