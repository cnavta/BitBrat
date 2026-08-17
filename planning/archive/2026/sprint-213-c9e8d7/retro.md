# Retro – sprint-213-c9e8d7

## What worked
- The issue was quickly identified as a network configuration omission in the generated compose files.
- The `bootstrap-service.js` script makes it easy to apply project-wide changes to the local runtime environment.
- The `docker compose config` command proved effective for validating the merged configuration.

## What didn’t work
- The initial `validate_deliverable.sh` failed because it didn't use `--project-directory`, causing it to look for `.env.local` in the wrong place when multiple `-f` flags were used.

## Lessons learned
- When using Docker Compose with multiple files located in different directories, always specify `--project-directory` to ensure relative paths for volumes and env files resolve correctly.
- Infrastructure-as-Code (or scripts that generate it) should always ensure that services intended to communicate are joined to a common network.
