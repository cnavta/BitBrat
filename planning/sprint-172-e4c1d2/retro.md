# Retro – sprint-172-e4c1d2

## What Worked
- The separation of concerns between schema, loader, and orchestration in `brat` made it easy to inject the new deployment path.
- Dry-run verification proved invaluable for testing Cloud Build substitution logic without actually running builds.
- The `validate_deliverable.sh` script helped catch a side-effect regression in the network tests early.

## What Didn't
- `ts-node` had some issues with missing type declarations for `js-yaml` when running directly from source, requiring `--transpile-only`.
- The `deploy-cloud.sh` bash script is becoming a legacy artifact that doesn't share logic with the `brat` tool, leading to duplication and potential divergence.

## Improvements
- Consider migrating the remaining logic from `deploy-cloud.sh` into `brat` to have a single, unified deployment tool.
