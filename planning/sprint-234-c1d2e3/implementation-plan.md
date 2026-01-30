# Implementation Plan - Brat Setup Auto Port (sprint-234-c1d2e3)

## Objective
Automate the configuration of `API_GATEWAY_HOST_PORT` during the `brat setup` command to ensure `brat chat` works out of the box.

## Scope
- Modify `tools/brat/src/cli/setup.ts` to persist `API_GATEWAY_HOST_PORT`.
- Update `env/local/global.yaml` with the default port (3001) during setup.

## Deliverables
- Code changes in `tools/brat/src/cli/setup.ts`.
- Updated unit tests in `tools/brat/src/cli/setup.test.ts`.
- Sprint artifacts.

## Acceptance Criteria
- Running `brat setup` successfully adds or updates `API_GATEWAY_HOST_PORT: "3001"` in `env/local/global.yaml`.
- After `brat setup`, running `brat chat` (locally) uses the correct port without needing manual environment variables.

## Testing Strategy
- Unit test for `updateYaml` and new setup logic.
- Manual verification: delete `.env.local` and `env/local/global.yaml`, run `brat setup`, and check if `API_GATEWAY_HOST_PORT` is present.

## Definition of Done
- All changes merged to feature branch.
- `validate_deliverable.sh` passes.
- PR created.
