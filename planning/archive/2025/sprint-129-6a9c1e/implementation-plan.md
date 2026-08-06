Implementation Plan - sprint-129-6a9c1e

Objective
- Extend the event-router so that when a rule matches, any annotations on the matching RuleDoc are appended to the event before routing along the routingSlip. Maintain immutability by returning an updated event copy.

Scope
- In scope
  - Rule schema handling in rule-loader to surface optional annotations: AnnotationV1[] on RuleDoc
  - RouterEngine change: on first matching rule, append RuleDoc.annotations to event.annotations on a cloned event
  - Structured logging and robust validation for annotations
  - Unit tests and a lightweight integration-style test
  - Planning and publication artifacts per AGENTS.md
- Out of scope
  - Changes to InternalEventV2 and AnnotationV1 types (already defined)
  - Persistence of annotations beyond RuleDoc (no Firestore writes)

Deliverables
- Code
  - rule-loader: include annotations in validated RuleDoc cache entries; drop malformed with warnings
  - router-engine: return { slip, decision, evtOut } where evtOut is input event clone with appended annotations
- Tests
  - rule-loader annotations handling (valid, empty, malformed)
  - router-engine append, no-op when no match, immutability checks
  - evaluator stub integration to prove end-to-end propagation
- Scripts/Docs
  - planning folder with backlog and plan
  - sprint validate_deliverable.sh delegating to root

Acceptance Criteria
- If a rule matches and it contains annotations, those are appended to evtOut.annotations while preserving existing annotations order
- Input event is not mutated
- Malformed annotations are skipped with warn logs, routing continues
- All new unit tests pass locally via validate_deliverable.sh

Testing Strategy
- Unit tests for rule-loader and router-engine using mocks/stubs
- Integration-style test with mocked evaluator to force a match and verify appended annotations order

Deployment Approach
- No infra changes; reuse existing build/test via root validate_deliverable.sh

Dependencies
- src/types/events.ts (InternalEventV2, AnnotationV1)
- jsonlogic-evaluator for routing condition evaluation

Definition of Done
- Code aligns with architecture.yaml and AGENTS.md
- Tests added and passing
- Logging added for annotation append and malformed drops
- Publication attempt documented per protocol
