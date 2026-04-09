# Implementation Plan – sprint-141-f8a12b

## Objective
- Resolve the issue where Discord OAuth state validation fails because it's not correctly signed.

## Scope
- Update generic OAuth routes to use `generateState` (which produces a signed state).
- Update generic OAuth tests to correctly verify this signed state.

## Deliverables
- `src/services/oauth/routes.ts`: Updated to use `generateState`.
- `src/services/oauth/routes.test.ts`: Updated to include signed state verification.

## Acceptance Criteria
- Generic OAuth routes produce a signed state that is accepted by `verifyState`.
- Callback handler correctly accepts a signed state and rejects an unsigned one.
- No regression in Twitch OAuth flow.

## Testing Strategy
- Use existing `src/services/oauth/routes.test.ts` and add a specific test case for signed state verification.
- Run `npm test` on all relevant files.

## Definition of Done
- Code updated and verified with tests.
- PR created.
