# Retro – sprint-235-d1e2f3

## What Worked
- Dynamic port discovery via Docker labels proved to be a robust solution for local development mismatches.
- The `deploy-local.sh` script's existing auto-assignment logic was successfully leveraged by making the port implicit in `global.yaml`.

## Challenges
- Mocking `execSync` in Jest required careful setup to avoid side effects in other tests.
- Port discovery depends on Docker CLI being available; provided a fallback to 3001 to maintain compatibility.

## Key Learnings
- Container metadata (labels) is more reliable than name filtering in Docker environments.
- Making configuration implicit rather than explicit can resolve many "hardcoded" collision issues.
