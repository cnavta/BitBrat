# Implementation Plan – sprint-274-f1a2b3

## Objective
Fix regressions in OAuth test suites after merge from main.

## Scope
- `src/services/oauth/routes.test.ts`
- `src/services/oauth/providers/discord-adapter.ts`
- `src/services/oauth/providers/discord-adapter.test.ts`

## Deliverables
- Corrected unit tests for OAuth routes to match current state handling.
- Updated `DiscordAdapter` to use Discord API v10 consistently.
- Aligned `DiscordAdapter` error messages with test expectations.

## Acceptance Criteria
- `npm test src/services/oauth/routes.test.ts` passes.
- `npm test src/services/oauth/providers/discord-adapter.test.ts` passes.
- `validate_deliverable.sh` (build + tests) passes.

## Testing Strategy
- Unit and integration tests for affected files.

## Definition of Done
- Code matches project standards.
- All tests pass.
- PR created.
