# Implementation Plan – sprint-214-e5f6a7

## Objective
Resolve `PathError` in `oauth-flow` service (and others) caused by invalid wildcard syntax (`*`) in Express routes. Update the bootstrapping script to prevent recurrence.

## Scope
- `infrastructure/scripts/bootstrap-service.js`: Update `generateAppSource` and `generateTestSource` to use `(.*)` or similar compatible syntax for wildcards.
- `src/apps/oauth-service.ts`: Update manually.
- `infrastructure/scripts/bootstrap-service.test.js`: Update to match new syntax.
- Scan and fix other services in `src/apps/`.

## Deliverables
- Modified `infrastructure/scripts/bootstrap-service.js`.
- Modified `src/apps/oauth-service.ts`.
- Modified `infrastructure/scripts/bootstrap-service.test.js`.
- Verification report.

## Acceptance Criteria
- `oauth-flow` service starts without `PathError` (verified via dry-run).
- `bootstrap-service.js` generates routes with `(.*)` for `*` wildcards.
- Tests in `bootstrap-service.test.js` pass.

## Testing Strategy
- Manual check of generated source code.
- Run `validate_deliverable.sh`.
- Local dry-run of affected services.

## Definition of Done
- All fixes applied.
- Validation script passes.
- PR created.
