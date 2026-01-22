# Implementation Plan – sprint-216-b2c4d5

## Objective
Resolve the `PathError: Missing parameter name` in `oauth-flow` service.

## Scope
- Investigate and fix the Express route syntax in `src/apps/oauth-service.ts`.
- Update `infrastructure/scripts/bootstrap-service.js` to ensure future services are generated with compatible syntax.

## Deliverables
- Modified `src/apps/oauth-service.ts`.
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Modified `infrastructure/scripts/bootstrap-service.test.js`.

## Acceptance Criteria
- `oauth-flow` service starts without `PathError`.
- `bootstrap-service.test.js` passes.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Create a small reproduction script to test `path-to-regexp` behavior directly if needed.
- Run existing unit tests for the generator.
- Local dry-run for `oauth-flow`.

## Definition of Done
- Code changes applied.
- Tests passing.
- PR created.
- Verification report and retro completed.
