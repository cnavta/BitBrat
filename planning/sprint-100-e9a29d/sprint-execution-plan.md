# Sprint Execution Plan – sprint-100-e9a29d

Objective
- Implement a Firestore-backed, JsonLogic-based routing engine in the event-router service, per the approved Technical Architecture.

Context & Assumptions
- Technical Architecture file: planning/sprint-100-e9a29d/technical-architecture.md.
- Open Questions resolved (Yes/Yes):
  - Add INTERNAL_ROUTER_DLQ_V1 = "internal.router.dlq.v1" to src/types/events.ts.
  - Downstream step status transitions are handled by the receiving service.

Milestones by Sprint
- Sprint 100 (Current) — Planning and Preparation
  - Deliverables:
    - Technical Architecture (drafted and updated with resolved questions)
    - Sprint Execution Plan (this document)
    - Trackable Backlog (linked tasks with IDs, estimates, acceptance criteria)
  - Exit Criteria:
    - Documents reviewed and approved.
    - Feature branch exists: feature/sprint-100-e9a29d-event-router-routing-system

- Sprint 101 — Foundations: RuleLoader + Evaluator + Constants
  - Scope:
    - Add INTERNAL_ROUTER_DLQ_V1 constant to src/types/events.ts.
    - Introduce RuleLoader to read configs/routingRules/rules from Firestore (warm load + onSnapshot, in-memory cache, sort by priority).
    - Add JsonLogic evaluator module with defined event-derived context (type, channel, userId, envelope, payload, now, ts).
    - Unit tests for evaluator truthy/falsey decisions, priority sorting, invalid doc filtering.
  - Acceptance Criteria:
    - npm test passes with new unit tests.
    - Local emulator (optional) verified for a basic onSnapshot callback.
    - No changes to event-router message flow yet (readiness only).
  - Risks:
    - Firestore emulator availability; mitigate via mocking layer for unit tests.

- Sprint 102 — RouterEngine Integration + Default Path
  - Scope:
    - Implement RouterEngine: first-match-wins, short-circuit; default to INTERNAL_ROUTER_DLQ_V1 when no rule matches.
    - Materialize RoutingSlip with status=PENDING, attempt=0, default v="1".
    - Wire into event-router-service ingress subscriber; publish to first step’s nextTopic using existing bus.
    - Add debug logging of decisions and basic counters in memory.
  - Acceptance Criteria:
    - On receiving a synthetic InternalEventV1, engine picks correct topic per rules/default.
    - Bus publisher is mocked in tests; asserts publish to expected topic.
    - Logs show { matched, ruleId, priority, selectedTopic }.

- Sprint 103 — Observability, Hardening, and Integration Tests
  - Scope:
    - /_debug/ endpoints to expose counters: router.events.total, router.rules.matched, router.rules.defaulted.
    - Robust error handling: skip invalid rules, fallback on Firestore failures.
    - Integration tests with Firestore emulator + snapshot updates.
  - Acceptance Criteria:
    - validate_deliverable.sh passes: build + tests + local up/down + dry-run.
    - Integration tests demonstrate rule update reactivity via onSnapshot.

- Sprint 104 — Publication & Deployment Readiness
  - Scope:
    - Documentation updates; example rule documents.
    - Final code cleanup; ensure no TODOs in production paths.
    - Create GitHub PR per AGENTS.md and populate publication.yaml with PR URL.
  - Acceptance Criteria:
    - PR created via gh CLI; publication.yaml updated.
    - Verification report added summarizing deliverables.

Execution Approach
- Branching: Continue on feature/sprint-100-e9a29d-event-router-routing-system; small commits mapped to backlog IDs.
- Testing: Jest unit tests for evaluator/engine; integration tests for Firestore emulator and bus publish behavior.
- Validation: Use repository-level validate_deliverable.sh (invoked by planning/sprint-100-e9a29d/validate_deliverable.sh).

Dependencies
- firebase-admin (already part of dependencies) for Firestore access.
- jest/ts-jest for tests; NATS or PubSub drivers already present for bus mocks.

Definition of Done (per project DoD)
- Code quality: adheres to architecture.yaml; no TODOs in production paths.
- Testing: Jest tests for new behavior; npm test passes in CI.
- Deployment artifacts: No new infra required; reuse existing Cloud Run targets.
- Documentation: Update technical-architecture.md and service README if needed.
- Traceability: Changes referenced in request-log.md with backlog IDs.
