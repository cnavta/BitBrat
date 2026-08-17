# Implementation Plan – sprint-292-a1b2c3

## Objective
- Fix regressions in egress candidate selection and message extraction causing test failures.
- Restore legacy fallback for events without `candidates` array.
- Ensure `FAILED` status is returned for metadata/configuration errors in egress.

## Scope
- `src/common/events/selection.ts`: Adjust `extractEgressTextFromEvent` logic.
- `src/apps/ingress-egress-service.ts`: Adjust `processEgress` status return logic.

## Deliverables
- Code fixes.
- Verified test suite.

## Acceptance Criteria
- All failing tests reported in the issue pass.
- Egress events with explicitly empty `candidates` array still result in `IGNORED`.
- Egress events with invalid `accountType` return `FAILED`.

## Testing Strategy
- Run the specifically failing test suites:
  - `src/apps/__tests__/account-type-egress.test.ts`
  - `tests/apps/ingress-egress-egress.test.ts`
  - `tests/integration/generic-egress.integration.test.ts`
  - `src/apps/__tests__/ingress-egress-routing.test.ts`
- Run all project tests.

## Definition of Done
- Code changes implemented.
- All tests pass.
- PR created.
