# Deliverable Verification – sprint-230-e4f1a2

## Completed
- [x] Refactored `src/types/events.ts`: Removed `InternalEventV1`, `EnvelopeV1`; updated `InternalEventV2` with `Ingress` and `Identity` groups.
- [x] Cleaned up common libraries (`adapters.ts`, `base-server.ts`, `attributes.ts`).
- [x] Migrated Ingress Services (API Gateway, Twitch, Discord, Twilio) to new schema.
- [x] Migrated Auth Service Enrichment to use `identity.external`.
- [x] Migrated Routing and Processing (`RouterEngine`, `JsonLogicEvaluator`, `LLM Bot`) to new schema.
- [x] Migrated Egress Services (API Gateway, `IngressEgressServer`) to new schema.
- [x] Full test suite pass (198 suites passed, 1 skipped).
- [x] Removed all lingering `InternalEventV1` and `EnvelopeV1` references.
- [x] Validated build and tests via `validate_deliverable.sh`.
- [x] Fixed regression in `tests/apps/scheduler-service.spec.ts` where assertions still expected root-level `source`.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- Updated `JsonLogicEvaluator` to provide backward-compatible context fields (`source`, `channel`, `userId`, `user`, `auth`) at the root during evaluation, ensuring existing rules continue to work despite the underlying schema change.
- Refactored `IngressEgressServer` to handle broadcast egress events by inspecting both `ingress` and `identity` metadata.
- Ensured `auth.v` is set to `'2'` in `Identity` to signify the refactored auth structure.
