# Retro – sprint-279-e5f6g7

## What worked
- The reproduction test suite successfully caught current behavior and validated the fix.
- Initializing separate clients for each account type (bot/broadcaster) simplifies the identity logic in the connector implementations.
- Configuration extension via `IConfig` was straightforward.

## What didn’t
- Initial mocks in the reproduction test were incomplete (missing `start`/`stop`), which caused initial failures during test run.
- `DiscordIngressClient` needed some refactoring to support custom identities for token resolution.

## Improvements for future sprints
- Ensure all connector-related mocks are robust and include lifecycle methods (`start`, `stop`, `getSnapshot`).
- Consider a more unified `AccountManager` if the number of accounts for each platform grows further.
