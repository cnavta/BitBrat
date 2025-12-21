# Implementation Plan – sprint-156-b2c3d4

## Objective
Implement generic egress listener and unified delivery handler with DLQ fallback in `ingress-egress-service.ts`.

## Scope
- Refactor `ingress-egress-service.ts` to extract `handleEgressDelivery`.
- Implement `egress.type` prioritized routing.
- Register `internal.egress.v1` generic listener.
- Implement DLQ fallback to `internal.deadletter.v1`.

## Deliverables
- Updated `src/apps/ingress-egress-service.ts`.
- Updated `architecture.yaml`.
- New integration tests for generic egress.

## Acceptance Criteria
- Logic extracted to private `handleEgressDelivery`.
- `egress.type` used as primary routing signal.
- Service subscribes to `internal.egress.v1` with `ingress-egress.generic` queue.
- undeliverable messages published to `internal.deadletter.v1`.
- Integration tests pass.

## Testing Strategy
- Integration tests using mocked message bus to verify dual listener behavior.
- Integration tests for DLQ fallback scenario.

## Definition of Done
- Code quality standards met.
- Tests passing.
- PR created.
- Verification report and retro completed.
