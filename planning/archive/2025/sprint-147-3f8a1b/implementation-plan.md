# Implementation Plan - sprint-147-3f8a1b

Fixing test regressions in `extract-config.test.ts` and `routing-advance.spec.ts`.

## Objective
- Resolve CI/test failures caused by recent architecture and source-handling changes.

## Scope
- `infrastructure/scripts/extract-config.test.ts`
- `tests/services/command-processor/routing-advance.spec.ts`

## Deliverables
- Updated test files.

## Acceptance Criteria
- `npx jest infrastructure/scripts/extract-config.test.ts` passes.
- `npx jest tests/services/command-processor/routing-advance.spec.ts` passes.

## Testing Strategy
- Run the specific failing test suites.
- Run a full validation suite if possible.

## Definition of Done
- Tests pass.
- PR created.
- Sprint artifacts complete.
