# Sprint Retro – sprint-220-a1b2c3

## What Worked Well
- The type refactor was straightforward and caught most breaking points via TypeScript compiler.
- Updating all ingress clients simultaneously ensured consistency across the platform.
- Fixing underlying infrastructure mocks (NATS) and unrelated test failures (Auth, Firebase) provided a stable baseline for future sprints.

## Challenges
- Many manual constructions of `InternalEventV2` in tests required updates to include the new `egress` property.
- `EventDocV1` inheriting from `InternalEventV2` meant that Persistence documents also changed their schema slightly, requiring careful updates to persistence tests.

## Lessons Learned
- Changing a core required property in a base interface has a wide blast radius in tests. Consider using factory functions for events in tests to minimize future refactor effort.
- Keeping mocks in sync with library updates is critical for CI stability.
