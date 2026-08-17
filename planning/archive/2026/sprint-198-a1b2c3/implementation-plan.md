# Implementation Plan – sprint-198-a1b2c3

## Objective
- Fix Firebase emulator startup, NATS stream auto-provisioning, and environment validation issues in local execution.

## Scope
- `firebase.json` configuration.
- `infrastructure/docker-compose/firebase-emulator-bootstrap.sh`.
- `src/services/message-bus/nats-driver.ts`.
- `src/common/base-server.ts`.

## Deliverables
- Updated `firebase.json` with explicit service keys and host binding.
- Updated `firebase-emulator-bootstrap.sh` with better logging and config handling.
- Enhanced `nats-driver.ts` with auto-stream-provisioning.
- Modified `BaseServer.ensureRequiredEnv` to allow optional local secrets.

## Acceptance Criteria
- `firebase emulators:start` starts `pubsub` and `ui` emulators.
- NATS JetStream subscriptions do not fail with "no stream matches subject".
- `ingress-egress` service starts locally even if Twilio secrets are missing.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Manual verification of logs during `npm run local`.
- Scripted verification of emulator reachability.

## Definition of Done
- All changes implemented and verified.
- PR created.
- Retro and key learnings documented.
