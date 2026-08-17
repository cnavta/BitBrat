# Implementation Plan – sprint-271-e9a1c3

## Objective
- Fix Discord OAuth "Invalid state" error by ensuring the state parameter is correctly signed using `generateState` in the generic OAuth routes.

## Scope
- `src/services/oauth/routes.ts`: Use `generateState(cfg)` instead of random bytes.
- `src/services/oauth/routes.test.ts`: Update/add tests to verify signed state.

## Deliverables
- Code fix in `src/services/oauth/routes.ts`.
- Updated test suite.
- Sprint artifacts.

## Acceptance Criteria
- OAuth flow starts with a signed state (3 parts separated by periods).
- OAuth callback successfully verifies the signed state.
- All relevant tests pass.

## Testing Strategy
- Run existing `src/services/oauth/routes.test.ts`.
- Verify the generated URL contains a state that matches the pattern `^[a-f0-9]+\.[0-9]+\.[a-f0-9]+$`.

## Definition of Done
- Code matches architecture and style.
- Tests pass.
- PR created.
