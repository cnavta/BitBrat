# Implementation Plan – sprint-155-a8c2d4

## Objective
Enhance platform egress routing to allow cross-platform delivery by replacing `egressDestination` string with a structured `egress` object containing a type discriminator.

## Scope
- Refactor `EnvelopeV1` and `InternalEventV2` usages to use `egress: EgressV1`.
- Update `EventRouter` to support `egress` enrichment in rules.
- Update `IngressEgressService` to route based on `egress.type`.
- Update Ingress clients (`Twitch`, `Discord`) to populate the new `egress` property.

## Deliverables
- Code changes in `src/common/events/adapters.ts`, `src/services/routing/router-engine.ts`, `src/apps/ingress-egress-service.ts`.
- Updated Ingress builders and clients.
- Updated tests.

## Acceptance Criteria
- [ ] `InternalEventV2` events published by ingress clients contain `egress: { destination: string, type: string }`.
- [ ] `EventRouter` rules can successfully override or add the `egress` property.
- [ ] `IngressEgressService` correctly routes messages to Twitch or Discord based on `egress.type`, regardless of event `source`.
- [ ] Existing tests pass after refactoring.

## Testing Strategy
- **Unit Tests**:
  - `RouterEngine.spec.ts`: Test egress enrichment.
  - `adapters.spec.ts`: Test V1/V2 conversion with egress.
  - Ingress builder tests: Test egress population.
- **Integration Tests**:
  - `ingress-egress-service.test.ts`: Verify routing logic.

## Deployment Approach
- Standard Cloud Build deployment for `ingress-egress` and `event-router`.

## Definition of Done
- All code changes trace back to sprint-155-a8c2d4.
- `validate_deliverable.sh` passes.
- PR created and linked.
