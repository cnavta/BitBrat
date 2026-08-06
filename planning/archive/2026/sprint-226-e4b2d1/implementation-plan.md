# Implementation Plan – sprint-226-e4b2d1

## Objective
- Deprecate the `command-processor` service and move its artifacts to the `deprecated/` directory.

## Scope
- `src/apps/command-processor-service.ts` and related files.
- `src/services/command-processor/` logic.
- Tests associated with `command-processor`.
- `architecture.yaml` entry for `command-processor`.
- Configuration fields in `src/common/config.ts` and `src/types/index.ts` that are unique to `command-processor`.
- `route.json` references to `command-processor`.

## Deliverables
- Cleaned up `architecture.yaml`.
- Refactored `config.ts` and `types/index.ts`.
- Updated `route.json`.
- New `deprecated/services/command-processor/` directory containing all moved artifacts.

## Acceptance Criteria
- `command-processor` service is no longer in `src/apps/` or `architecture.yaml`.
- All `command-processor` specific code, tests, and docs are moved to `deprecated/`.
- Project builds and passes tests.
- `validate_deliverable.sh` executes successfully.

## Testing Strategy
- Run `npm test` after each major move to ensure no broken imports.
- Final verification using `validate_deliverable.sh`.

## Deployment Approach
- This is a deprecation sprint, so "deployment" means updating the configuration and removing the service from the active list.
- Cloud Run services for `command-processor` should be decommissioned (manual step, but out of scope for local file changes).

## Dependencies
- None.

## Definition of Done
- All items in `backlog.yaml` are completed.
- `verification-report.md` and `retro.md` created.
- PR created and linked.
