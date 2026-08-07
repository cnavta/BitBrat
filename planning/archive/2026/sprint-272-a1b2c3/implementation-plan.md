# Implementation Plan – sprint-272-a1b2c3

## Objective
- Revert Firestore token storage from the newer 'authTokens/' path to the legacy 'oauth/{provider}/{identity}/token' structure.

## Scope
- Update 'src/services/oauth/auth-token-store.ts' path logic.
- Update 'src/services/oauth/auth-token-store.test.ts'.

## Deliverables
- Code changes to token store.
- Updated tests.

## Acceptance Criteria
- Tokens for any provider are written to 'oauth/{provider}/{identity}/token'.
- Reading from 'oauth/{provider}/{identity}/token' works.

## Definition of Done
- Build passes.
- All OAuth tests pass.
- PR created.
