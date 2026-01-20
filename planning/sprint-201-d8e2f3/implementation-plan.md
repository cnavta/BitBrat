# Implementation Plan – sprint-201-d8e2f3

## Objective
- Fix Firestore emulator connectivity issues (ECONNREFUSED) in local Docker environment.
- Fix NATS subscription error: "durable requires no queue group".

## Scope
- `firebase.json`: Firestore emulator host configuration.
- Docker Compose configuration (to be identified).
- Base server messaging logic (NATS subscription).

## Deliverables
- Fixed `firebase.json` or related config for Firestore emulator.
- Fixed `src/common/base-server.ts` (or relevant file) for NATS subscriptions.
- Updated `validate_deliverable.sh`.

## Acceptance Criteria
- Firestore connection is successful for all services in Docker.
- NATS subscriptions no longer fail with "durable requires no queue group".
- Services start up without connection errors in logs.

## Testing Strategy
- Local validation using `go.sh` or equivalent to start environment and check logs.
- Unit/integration tests if applicable to the fix.

## Definition of Done
- Code adheres to style rules.
- Tests pass.
- `validate_deliverable.sh` passes.
- PR created.
