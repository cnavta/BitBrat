# Implementation Plan – sprint-278-b4d5e6

## Objective
Address the gap in flexible event egress by utilizing 'connector' properties in Ingress and Egress types within `InternalEventV2`. This enables cross-connector eventing (e.g., routing a Twitch event to Discord).

## Scope
- Update `ConnectorType` definition in `src/types/events.ts` to include `'system'`.
- Update all ingress flows to set the correct `connector` property.
- Update all egress flows to use `egress.connector` for routing instead of heuristics.
- Ensure proper error logging and event finalization when routing fails or is not possible.
- Update relevant tests to reflect the new `connector` requirement.

## Deliverables
- Code changes in `src/types/events.ts`, `src/apps/ingress-egress-service.ts`, `src/apps/api-gateway.ts`, `src/apps/scheduler-service.ts`, `src/apps/auth-service.ts`, and various service adapters.
- Updated unit and integration tests.
- `validate_deliverable.sh` script to verify the sprint goals.
- Verification report and retro documentation.

## Acceptance Criteria
- [ ] Every incoming event published to the bus has its `ingress.connector` correctly set to one of: `'twitch'`, `'discord'`, `'twilio'`, `'webhook'`, `'api'`, or `'system'`.
- [ ] The `ingress-egress-service` uses `egress.connector` to decide where to route events.
- [ ] If `egress.connector` specifies a platform that is not supported or not connected, an appropriate warning/error is logged and the event is finalized with `status: 'FAILED'`.
- [ ] Heuristics for routing in `ingress-egress-service` and `api-gateway` are retained as fallbacks if `egress.connector` is missing (to maintain backward compatibility with legacy events if any).
- [ ] The `validate_deliverable.sh` script builds the project and runs all relevant tests successfully.

## Testing Strategy
- Update existing tests for `IngressEgressServer` and `ApiGatewayServer` to include `connector` fields.
- Add new test cases for cross-connector routing (e.g., event with `ingress.connector: 'twitch'` and `egress.connector: 'discord'`).
- Verify that events with unsupported or missing connectors are handled gracefully.
- Run `npm test` and ensure all tests pass.

## Deployment Approach
- Cloud Run deployment via existing Cloud Build configs (dry-run during validation).

## Dependencies
- `src/types/events.ts` (already contains `connector` properties, but may need `'system'` addition).
- Access to Firestore for integration tests (if applicable).

## Definition of Done
- Code adheres to project-wide DoD.
- `validate_deliverable.sh` passes.
- PR created and URL recorded in `publication.yaml`.
- Documentation (`retro.md`, `key-learnings.md`) complete.
