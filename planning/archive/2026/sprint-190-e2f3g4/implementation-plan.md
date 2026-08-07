# Implementation Plan – sprint-190-e2f3g4

## Objective
Add a command to the `brat` tool to shutdown all running Cloud Run instances by scaling them to zero, reducing costs when the environment is not in use.

## Scope
- New `brat` command: `brat cloud-run shutdown`
- Targeting all services defined in `architecture.yaml`
- Support for environment selection via `--env`
- Support for `--dry-run` and `--project-id`

## Deliverables
- Modified `tools/brat/src/cli/index.ts` with the new command logic.
- Documentation update in `brat` help output.
- Validation script `validate_deliverable.sh`.

## Acceptance Criteria
- `brat cloud-run shutdown --env dev` iterates through all active services in `architecture.yaml`.
- For each service, it executes (or logs if dry-run) the command to set `min-instances` to 0.
- The command respects the `--dry-run` flag.
- The command requires `--env` to be specified.

## Testing Strategy
- Manual verification using `--dry-run` to ensure correct commands are generated.
- Unit tests for the argument parsing and command routing if applicable.

## Deployment Approach
- The change is to the local `brat` tool; it will be used by developers and in CI/CD pipelines.

## Dependencies
- `gcloud` CLI installed and authenticated (checked by `brat doctor`).
- Access to `architecture.yaml`.

## Definition of Done
- Implementation matches the objective.
- `validate_deliverable.sh` passes.
- PR created and merged.
- Sprint artifacts (retro, learnings) completed.
