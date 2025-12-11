# Implementation Plan – sprint-127-c711fe

## Objective
- Deliver a set of JsonLogic helper operators to the event-router to make rule authoring simpler and more robust:
  - ci_eq: case-insensitive string equality
  - re_test: regular expression test for strings (with optional flags and safe caching)
  - slip_complete: true when an InternalEventV2 routing slip is fully complete (no PENDING or ERROR, or explicit terminal OK)
  - Additional InternalEventV2-aware helpers to improve matching ergonomics

## Scope
In scope
- Define, register, and test custom JsonLogic operators within src/services/router/jsonlogic-evaluator.ts (or a dedicated operators module imported by it).
- Ensure operators are available to RouterEngine evaluation without changing rule storage.
- Unit tests for evaluator and new operators.
- Update planning and validation artifacts for this sprint.

Out of scope
- UI for rule editing.
- Persistence changes to rule documents.
- Production rollout; only local/test validation in this sprint.

## Deliverables
- Code: operator implementations and registration, minimal refactor of evaluator to host/register operators.
- Tests: unit tests under src/services/router/__tests__/ for each operator and key edge cases.
- Docs: inline JSDoc and examples in tests; brief mention in planning artifacts.
- CI/Validation: sprint validate script aligning to repo-level scripts.

## Acceptance Criteria
- ci_eq returns true when two strings are equal ignoring case; non-string inputs are coerced to strings safely and trimmed opt-in behavior is documented; null/undefined handled gracefully (returns false unless both are empty strings after coercion).
- re_test supports patterns as string or [pattern, flags]; returns true if RegExp.test(value) matches; caches compiled regex by (pattern, flags) to avoid perf regressions; safely handles invalid patterns returning false.
- slip_complete returns true when event.routingSlip exists and all steps have status === 'OK' OR when a terminal step indicates end-of-pipeline (no nextTopic) with OK; returns false if any step is PENDING or ERROR.
- Operators are registered exactly once and available wherever evaluate() is used by RouterEngine.
- Tests demonstrate usage inside a JsonLogic expression evaluated via evaluate().
- No changes break existing tests; npm test passes locally.

## Testing Strategy
- Unit tests:
  - jsonlogic-evaluator.ci-eq.spec.ts: target ci_eq across varied cases (different casing, non-strings, empty, whitespace).
  - jsonlogic-evaluator.re-test.spec.ts: valid/invalid patterns, flags, caching behavior (hit path), non-string inputs.
  - jsonlogic-evaluator.slip-complete.spec.ts: events with PENDING/ERROR/OK combinations; no routingSlip; terminal step with/without nextTopic.
  - Integration: small RouterEngine test that uses a rule invoking each operator to confirm end-to-end availability.
- Mock Date.now() where needed for deterministic behavior.

## Deployment Approach
- No deployment changes this sprint. Ensure artifacts compile and tests pass. The repo-level validate_deliverable.sh is used; a sprint wrapper is provided for convenience.

## Dependencies
- json-logic-js already in repo. No external libraries required.
- Existing InternalEventV2 shape in src/types/events.ts

## Definition of Done
- All acceptance criteria above satisfied with passing tests.
- Planning artifacts updated; request-log reflects key actions.
- Feature branch pushed and PR created per protocol in a later phase of the sprint.
