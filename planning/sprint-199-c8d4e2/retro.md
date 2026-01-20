# Retro – sprint-199-c8d4e2

## What Worked
- Docker Compose 2.x `depends_on` with `condition: service_healthy` is a robust way to handle startup ordering.
- The modular service compose structure made it easy to audit and update each service.
- The `validate_deliverable.sh` script provided quick feedback on the changes.

## What Didn't
- Some services were already partially using the long-form `depends_on`, while others were using the short-form, leading to inconsistency before this sprint.

## Improvements for Next Sprint
- Consider adding a global `check.sh` that validates all compose files against a standard set of requirements (healthchecks, dependencies, etc.).
