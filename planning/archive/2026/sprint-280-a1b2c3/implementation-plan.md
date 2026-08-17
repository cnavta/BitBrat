# Implementation Plan – sprint-280-a1b2c3

## Objective
- Fix the module resolution error in `src/apps/__tests__/account-type-egress.test.ts`.

## Scope
- Update `jest.mock()` paths in `src/apps/__tests__/account-type-egress.test.ts`.
- Ensure other related paths in the same file are correct.

## Deliverables
- Fixed test suite `src/apps/__tests__/account-type-egress.test.ts`.

## Acceptance Criteria
- `npx jest src/apps/__tests__/account-type-egress.test.ts` passes without module resolution errors.

## Testing Strategy
- Run the fixed test suite and ensure it passes.
- Verify that other egress-related tests still pass.

## Deployment Approach
- N/A (Test fix)

## Dependencies
- None.

## Definition of Done
- Test suite passes.
- Verification report and retro are completed.
- PR is created.
