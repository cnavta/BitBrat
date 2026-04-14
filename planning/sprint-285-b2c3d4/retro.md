# Retro – sprint-285-b2c3d4

## What went well
- Rapidly identified the root cause of the test failure (schema extension).
- Found and fixed a systemic issue with `BaseServer` leaks in several test suites.
- Integrated the new schema fields into the disposition observation payload correctly.

## What didn’t go well
- The `createApp()` pattern in many services was problematic for lifecycle management in tests.
- `gh pr create` had some shell issues with backticks.

## Recommendations
- Refactor other services to follow the `createServer()` pattern to allow proper closing in tests.
- Add a lint rule or a base test class to ensure all server instances are closed after tests.
