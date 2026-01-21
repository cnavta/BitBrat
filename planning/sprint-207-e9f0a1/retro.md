# Retro – sprint-207-e9f0a1

## What Worked
- Investigation using `docker compose config` was crucial to understanding how `--project-directory` affects relative path resolution.
- Parallelizing the fix with port variable enhancements improved overall template quality.

## What Didn't
- Initial assumption about `../../../` being correct based on directory levels didn't account for the `--project-directory` override.

## Lessons Learned
- Always verify Docker Compose paths using `docker compose config` when multiple files or project directory overrides are involved.
