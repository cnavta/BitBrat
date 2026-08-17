# Implementation Plan - sprint-150-f1e2d3

## Objective
Fix Firestore "undefined" value error in the auth service when creating or updating users.

## Scope
- `src/services/auth/user-repo.ts`: `FirestoreUserRepo` implementation.

## Deliverables
- Bug fix in `user-repo.ts`.
- Reproduction test case.

## Acceptance Criteria
- Firestore operations in `ensureUserOnMessage` do not fail when `email` is undefined.
- All tests pass.

## Testing Strategy
- Create a unit test that mocks Firestore and passes an object with `email: undefined` to `ensureUserOnMessage`.
- Verify that the error is thrown without the fix and resolved with the fix.

## Definition of Done
- Code passes all tests.
- PR created.
- `validate_deliverable.sh` passes.
