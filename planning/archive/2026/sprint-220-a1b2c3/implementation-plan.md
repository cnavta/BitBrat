# Implementation Plan – sprint-220-a1b2c3

## Objective
Refactor `EnvelopeV1` to replace `egressDestination` (string) with a descriptive `Egress` type, improving metadata support for message routing and delivery.

## Scope
- Update core event types in `src/types/events.ts`.
- Update event mapping adapters in `src/common/events/adapters.ts`.
- Update Ingress services (Twitch, Discord, Twilio) to populate the new `egress` field.
- Update Egress logic in `ingress-egress-service.ts` to consume the new `egress` field.
- Fix all related tests and ensure platform stability.

## Deliverables
- Code changes in `src/types/events.ts`, `src/common/events/adapters.ts`, `src/apps/ingress-egress-service.ts`, and various ingress client services.
- Updated unit and integration tests.
- Validation report.

## Acceptance Criteria
- `EnvelopeV1` correctly uses the `Egress` interface.
- All ingress events correctly populate `egress.destination` and, where applicable, `egress.type`.
- The `ingress-egress-service` correctly routes egress messages using `egress.destination`.
- `validate_deliverable.sh` passes successfully.

## Testing Strategy
- Run `npm test` to identify breaking changes.
- Focus on `src/common/events/__tests__/adapters.spec.ts` (if it exists) and service tests for ingress/egress.
- Manual verification of event flow via logs if local environment allows.

## Deployment Approach
- Standard Cloud Build / Cloud Run deployment.
- As this is a core type change, it requires a coordinated rollout (or ensuring backward compatibility if needed, but here we are refactoring the platform).

## Dependencies
- `src/types/events.ts` (Core contract)
- `src/common/events/adapters.ts` (Mapping logic)

## Definition of Done
- All code changes implemented.
- All tests passing.
- PR created and linked in `publication.yaml`.
- Sprint closed with documentation.
