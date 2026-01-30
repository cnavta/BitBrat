# Implementation Plan – sprint-230-e4f1a2

## Objective
- Refactor `InternalEventV2` to incorporate `EnvelopeV1` fields at the root level, group metadata into `Ingress` and `Identity`, and remove all `InternalEventV1` legacy code.

## Scope
- `src/types/events.ts`: Schema refactor.
- `src/common/events/adapters.ts`: Removal of V1 adapters.
- `src/common/base-server.ts`: Removal of V1 auto-conversion logic.
- `src/services/auth/enrichment.ts`: Update to use `identity.external`.
- `src/services/api-gateway/`: Update ingress and egress.
- `src/services/ingress/`: Update Twitch/Discord connectors.
- `src/services/routing/`: Update RouterEngine and JsonLogic mapping.
- `src/services/llm-bot/`: Update processor to use new paths.
- All associated tests.

## Deliverables
- Refactored `InternalEventV2` type definition.
- Updated services and common libraries.
- Cleaned up legacy V1 code.
- `validate_deliverable.sh` script for the new structure.

## Acceptance Criteria
- `InternalEventV1` and `EnvelopeV1` are removed.
- `InternalEventV2` uses `Ingress` and `Identity` objects.
- `Identity.external` is the primary source for platform user data.
- All services pass their respective test suites.
- No regression in core message flow (Ingress -> Auth -> Router -> LLM -> Egress).

## Testing Strategy
- Update `src/types/events.types.test.ts` to verify new schema.
- Run `npm test` across all affected services.
- Verification of the full event lifecycle via integration tests.

## Deployment Approach
- Standard Cloud Run deployment as defined in `architecture.yaml`.
- This is a breaking change; all services must be deployed together.

## Dependencies
- None beyond standard internal project libraries.

## Definition of Done
- Code quality adheres to `architecture.yaml`.
- No `InternalEventV1` usage remains.
- `validate_deliverable.sh` passes.
- PR created and verified.
