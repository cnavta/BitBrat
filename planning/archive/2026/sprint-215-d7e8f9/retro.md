# Retro – sprint-215-d7e8f9

## What Worked
- Rapid identification of the `path-to-regexp` version mismatch.
- Automated validation via `validate_deliverable.sh` and existing generator tests.

## What Didn't
- The previous attempt to fix the wildcard syntax with `(.*)` was insufficient because `path-to-regexp` v8 requires named groups or explicit `:name(.*)` syntax for wildcards.

## Key Learnings
- When updating dependencies or responding to breaking changes in routing libraries, always verify the exact required syntax for the installed version. `path-to-regexp` v8 is significantly stricter than previous versions.
