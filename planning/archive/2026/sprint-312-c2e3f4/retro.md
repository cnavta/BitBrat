# Retro - sprint-312-c2e3f4

## What worked
- Extracting the rule generation logic into a testable function made verification much easier.
- Direct alignment with the `RuleDoc` interface ensures that any future changes to the interface will likely cause compilation errors in the setup script, alerting us to the need for updates.

## What didn't work
- The previous sprint (311) missed the mandatory `enrichments` property and didn't have specific tests for the rule structure, leading to a regressions/incomplete fix reported by the user.

## Improvements for next time
- Always add structural tests when adding or modifying data-population logic (like CLI setup tools).
- Use shared types/interfaces between the service and the CLI tool if possible to prevent schema drift.
