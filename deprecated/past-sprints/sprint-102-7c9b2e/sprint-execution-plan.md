# Sprint Execution Plan – sprint-102-7c9b2e

Objective
- Integrate the RouterEngine into event-router and implement the default routing path per the approved Technical Architecture.

Context & Dependencies
- Reference architecture: planning/sprint-100-e9a29d/technical-architecture.md
- Depends on Sprint 101 foundations:
  - INTERNAL_ROUTER_DLQ_V1 constant
  - RuleLoader with Firestore-backed cache
  - JsonLogic Evaluator for rule.logic decisions

Scope (Sprint 102 — RouterEngine Integration + Default Path)
- Implement RouterEngine with first-match-wins, short-circuit evaluation; fall back to INTERNAL_ROUTER_DLQ_V1 when no rule matches.
- Normalize selected RoutingSlip steps with status=PENDING, attempt=0, and default v="1" when missing.
- Wire RouterEngine into event-router ingress subscriber; publish the event to the first step’s nextTopic via the existing message bus.
- Add debug logging of routing decisions with fields: { matched, ruleId, priority, selectedTopic }.

Out of Scope (deferred to later sprints)
- /_debug/ counters endpoint and metrics publication (Sprint 103)
- Firestore emulator integration tests exercising snapshot updates (Sprint 103)
- Publication/PR and final documentation pass (Sprint 104)

Deliverables (code + tests)
- src/services/routing/router-engine.ts
- Integration in src/apps/event-router-service.ts
- Unit tests:
  - RouterEngine priority and short-circuit behavior
  - Default path when no rules match
  - Ingress integration with mocked bus publisher asserting publish subject

Acceptance Criteria
- Given a synthetic InternalEventV1, the engine selects the correct topic per matching rule, or uses the default INTERNAL_ROUTER_DLQ_V1 when no rule matches.
- The bus publisher (mocked) is called with the expected nextTopic from the first RoutingSlip step.
- Debug logs include: { matched, ruleId, priority, selectedTopic }.
- npm test passes for the new unit tests.

Milestones
- M1: RouterEngine implemented with unit tests for match/priority/default behavior.
- M2: event-router ingress wired to RouterEngine; publisher mocked in tests.
- M3: Debug decision logging verified in tests (log capturing or logger spy).

Risks & Mitigations
- Foundations incomplete (RuleLoader/Evaluator): mitigate with stubs/mocks to unblock RouterEngine unit tests.
- Firestore availability: unit tests do not rely on Firestore (use in-memory data/mocks).

Execution Approach
- Branching: feature/sprint-102-7c9b2e-routerengine-default-path
- Small, traceable commits referencing backlog IDs (BB-102-01, BB-102-02).
- Testing: Jest unit tests; message bus interactions mocked.
- Validation: Use repository-level validate_deliverable.sh for build and tests.

Definition of Done (project-wide)
- Code adheres to architecture.yaml; no TODOs in production paths.
- Jest tests covering new behavior; npm test passes.
- Documentation and logs sufficiently describe decisions.
- All changes traceable via planning artifacts and request-log.md with backlog IDs.
