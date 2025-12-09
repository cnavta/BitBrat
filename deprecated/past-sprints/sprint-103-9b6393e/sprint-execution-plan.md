# Sprint Execution Plan – sprint-103-9b6393e

Objective
- Deliver Observability, Hardening, and Integration Tests for the event-router routing system, aligning with architecture.yaml and prior technical architecture decisions.

Context & Assumptions
- Canonical reference: architecture.yaml (source of truth).
- Predecessor artifacts:
  - planning/sprint-100-e9a29d/technical-architecture.md (Observability and Error Handling guidance)
  - planning/sprint-100-e9a29d/sprint-execution-plan.md (Sprint 103 scope, lines 46–54)
  - planning/sprint-100-e9a29d/trackable-backlog.yaml (Sprint 103 items BB-103-01..03, lines 131–174)
- Active branch: feature/sprint-103-9b6393e-observability-hardening-integration-tests
- Coding is forbidden until this plan is approved per AGENTS.md Sprint Protocol.

Scope (Sprint 103)
- Observability
  - Add /_debug/ HTTP endpoints exposing counters: router.events.total, router.rules.matched, router.rules.defaulted.
  - Emit structured debug logs for routing decisions: { matched, ruleId, priority, selectedTopic }.
- Hardening
  - Ensure invalid rule documents are skipped with error logging.
  - Ensure Firestore read/listener failures gracefully fall back to default routing slip (DLQ constant) without crashing service.
- Integration Tests
  - Use Firestore emulator to verify RuleLoader reacts to onSnapshot updates.
  - Verify RouterEngine reroutes after rule changes and defaulting behavior holds on failures.

Deliverables
- Trackable backlog (this sprint): planning/sprint-103-9b6393e/trackable-backlog.yaml
- Updated/added service code to support:
  - /_debug/ counters endpoint in event-router service
  - Robust error paths in routing components
  - Integration tests under tests/integration/ using emulator
- Documentation updates where relevant (service README) – scoped to added endpoints and testing instructions.

Milestones & Exit Criteria
- Milestone: Observability endpoint implemented and counters increment on message handling.
  - Exit: Unit/integration tests confirm endpoint returns JSON counters and values update over time.
- Milestone: Hardening paths implemented.
  - Exit: Unit tests prove invalid docs are skipped and Firestore failures use default slip without throwing.
- Milestone: Integration tests using emulator.
  - Exit: Tests demonstrate rule update reactivity via onSnapshot and correct rerouting.
- Sprint Exit Criteria:
  - validate_deliverable.sh passes logically: build + tests + local up/down + dry-run.
  - All Sprint 103 backlog items moved to done or documented deviations captured for follow-up.

Execution Approach
- Branching: feature/sprint-103-9b6393e-observability-hardening-integration-tests; small commits mapped to backlog IDs (BB-103-01..03).
- Testing: Jest unit tests for error paths and counters; Firestore emulator-backed integration tests for snapshot reactivity.
- Validation: Use repository-level validate_deliverable.sh. If environment gaps exist (e.g., emulator), document in verification report per AGENTS.md.

Dependencies
- firebase-admin / emulator for Firestore interactions
- jest/ts-jest; supertest (or similar) for HTTP endpoint testing

Risks & Mitigations
- Emulator availability/port conflicts → allow mocked firestore in unit tests; guard integration tests behind emulator detection.
- Flaky snapshot timing in CI → include polling/retry in tests and generous timeouts.

Definition of Done (project DoD)
- No TODOs in production paths; code adheres to architecture.yaml.
- Jest tests for new behavior; npm test passes.
- Documentation updated for /_debug/ usage and testing steps.
- All changes traced in planning/sprint-103-9b6393e/request-log.md with backlog IDs.
