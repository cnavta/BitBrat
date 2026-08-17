# Implementation Plan – sprint-206-a1b2c3

## Objective
Fix the interpolation error in `brat` tool that prevents `service bootstrap` (and likely other commands) from running when `architecture.yaml` contains `${DOMAIN_PREFIX}`.

## Scope
- Modify `tools/brat/src/config/loader.ts` to include `DOMAIN_PREFIX` in the interpolation context.
- Ensure the interpolation context has reasonable defaults for development.

## Deliverables
- Bug fix in `tools/brat/src/config/loader.ts`.
- Reproduction script/test.
- Updated `sprint-manifest.yaml`.

## Acceptance Criteria
- `npm run brat -- service bootstrap --name api-gateway` runs without interpolation errors.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Create a minimal reproduction script that invokes `loadArchitecture` or the `brat` command.
- Verify it fails before the fix and passes after.

## Definition of Done
- Fix implemented.
- `validate_deliverable.sh` passes.
- PR created.
