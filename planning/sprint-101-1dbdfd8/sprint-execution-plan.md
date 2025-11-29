# Implementation Plan – sprint-101-1dbdfd8

## Objective
- Foundations for routing engine per sprint-100 Technical Architecture: add INTERNAL_ROUTER_DLQ_V1 constant; implement RuleLoader (warm load + onSnapshot with in-memory cache sorted by priority); and JsonLogic-based evaluator with well-defined context. No message flow wiring yet.

## Scope
- In scope
  - Add INTERNAL_ROUTER_DLQ_V1 = "internal.router.dlq.v1" to src/types/events.ts (planned; code will be delivered after plan approval in this sprint)
  - RuleLoader module reading Firestore path configs/routingRules
    - Warm load on startup, validate documents, filter invalid/disabled
    - Maintain in-memory cache sorted by ascending priority (lower = higher priority)
    - Subscribe via onSnapshot to keep cache up to date
  - JsonLogic evaluator module (json-logic-js) with context derived from InternalEventV1: { type, channel, userId, envelope, payload, now, ts }
  - Unit tests for evaluator truthy/falsey, priority sorting, and invalid doc filtering (Firestore access mocked)
- Out of scope
  - RouterEngine integration and message publishing (deferred to Sprint 102)
  - Observability endpoints and integration tests (Sprint 103)
  - Publication/PR (Sprint 104)

## Deliverables
- Code artifacts (to be implemented after plan approval)
  - src/services/router/rule-loader.ts
  - src/services/router/jsonlogic-evaluator.ts
  - src/types/events.ts update to include INTERNAL_ROUTER_DLQ_V1
- Tests
  - __tests__/router/jsonlogic-evaluator.test.ts
  - __tests__/router/rule-loader.test.ts
  - Mocks for Firestore and time utilities
- Documentation
  - Inline module docs and usage notes
  - Update planning docs as needed
- Sprint artifacts (this folder)
  - sprint-execution-plan.md, sprint-manifest.yaml, trackable-backlog.yaml, request-log.md, validate_deliverable.sh

## Acceptance Criteria
- npm test passes with new unit tests
- RuleLoader sorts enabled rules by ascending priority and filters invalid docs
- Evaluator returns deterministic boolean decisions given the defined context
- Optional: basic verification against Firestore emulator onSnapshot (documented but not required for CI)
- No changes to runtime routing behavior yet

## Testing Strategy
- Unit tests only (CI-friendly)
  - Evaluator truthy/falsey cases and nested var access (e.g., payload.message)
  - RuleLoader validation and sorting; ignores disabled/invalid docs
  - Snapshot update handler logic via mocked listeners
- Integration (optional/local): Firestore emulator smoke test for onSnapshot

## Deployment Approach
- No deployment changes this sprint. Modules are added but not wired into services. Existing build/test pipeline remains unchanged.

## Dependencies
- firebase-admin for Firestore access (already in dependencies)
- json-logic-js (to be added if not already present)
- jest/ts-jest for tests

## Risks & Mitigations
- Firestore emulator availability: mitigate with mocks for unit tests; emulator steps marked optional
- Rule shape drift: validate against minimal schema in RuleLoader; skip invalid docs

## Definition of Done
- Adheres to architecture.yaml and AGENTS.md
- Jest tests for new behavior; npm test passes
- No TODOs in production paths of added modules
- All actions traceable via sprint request-log.md
