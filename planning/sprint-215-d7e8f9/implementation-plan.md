# Implementation Plan – sprint-215-d7e8f9

## Objective
Resolve the `PathError: Missing parameter name` in the `oauth-flow` service by using the correct wildcard syntax for `path-to-regexp` v8.

## Scope
- Update `src/apps/oauth-service.ts` to use named wildcards (e.g., `:path(.*)`).
- Update `infrastructure/scripts/bootstrap-service.js` to use the correct syntax when generating new services.
- Update `infrastructure/scripts/bootstrap-service.test.js` to verify the fix.

## Deliverables
- Modified `src/apps/oauth-service.ts`.
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Modified `infrastructure/scripts/bootstrap-service.test.js`.

## Acceptance Criteria
- `oauth-flow` service starts without `PathError` in Docker Compose.
- `bootstrap-service.test.js` passes.
- Generated services use the correct wildcard syntax.

## Testing Strategy
- Run `npm test` to ensure generator logic is correct.
- Create a `validate_deliverable.sh` script to verify the fix via a local dry-run.

## Definition of Done
- Code matches project style.
- Tests pass.
- `validate_deliverable.sh` is logically passable.
- PR created.
