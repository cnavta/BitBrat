Implementation Plan – sprint-107-8ae3c1

Objective
- Migrate active services to fully support InternalEventV2 (flattened EnvelopeV1 fields plus message/annotations/candidates) while maintaining backward compatibility with V1 during transition.

Scope
- In scope:
  - Shared adapters V1↔V2 and pub/sub attribute helpers
  - Ingress (Twitch) emits V2 with optional dual-publish (V1+V2) behind flag
  - Auth consumes V1 or V2, emits V2 with enrichment and routing step update
  - Event Router consumes V1 or V2, emits V2 with routing slip updates
  - Egress marks selected candidate and logs selection rationale
  - Command Processor constants and V2 consumer stub
  - Tests and validation pipeline updates
- Out of scope:
  - Schema registry and strict runtime validation (deferred)
  - Full LLM bot and finalizer migrations (inactive services per architecture.yaml)

Deliverables
- Code:
  - `src/common/events/adapters.ts`: V1↔V2 adapters and `busAttrsFromEvent()`
  - `src/services/ingress/*`: Twitch translator outputs V2 (+ optional dual-publish)
  - `src/apps/auth-service.ts`: V2 out; dual-shape in; routing step update
  - `src/apps/event-router-service.ts`: dual-shape in; V2 out; attribute helper
  - `src/services/egress/selection.ts`: add `markSelectedCandidate()`
  - `src/apps/command-processor-service.ts`: subscribe stub using V2
- Types/Constants:
  - Add missing command topic constant(s) in `src/types/events.ts`
- Tests:
  - Unit tests for adapters, attribute helper, candidate selection status marking, and service-specific handlers (auth/router basic flows)
- Docs:
  - Update service README notes and examples to V2
- Validation:
  - Update sprint validation script to build, test, and run a V2 smoke path

Acceptance Criteria
- All active services (ingress-egress, auth, event-router, command-processor stub) compile and run with V2 paths.
- Auth and Router accept V1 or V2 inputs, publish V2.
- Egress selection marks exactly one candidate as `selected` when candidates exist and logs rationale.
- Command processor subscribes to the canonical command topic constant and is ready to process V2 events.
- `validate_deliverable.sh` is logically passable and aligned with repo DoD.

Testing Strategy
- Unit tests:
  - V1↔V2 adapters: mapping coverage including `message.rawPlatformPayload` and envelope fields
  - `busAttrsFromEvent()` parity for V1 and V2
  - Egress selection status marking and tie-breakers
  - Auth enrichment: V1→V2 and V2→V2 paths
  - Router decision flow with V2 payloads
- Smoke test:
  - Simulated V2 ingress → auth → router with egress mocked

Deployment Approach
- Backward compatible rollout; dual-publish flag on ingress for safe migration; Cloud Run defaults from architecture.yaml; no special IaC changes required this sprint.

Dependencies
- Internal: existing message-bus and Twitch ingress components; architecture.yaml topic definitions
- External: Firestore availability for auth user repo in non-test runs

Definition of Done
- Code, tests, and docs implemented as per Deliverables
- All unit tests pass locally and in CI
- Validation script logically passable and executed locally
- Traceability: request-log entries and sprint artifacts updated

Approvals Required
- User approval of this plan prior to implementing code changes (Sprint Protocol §2.4)
