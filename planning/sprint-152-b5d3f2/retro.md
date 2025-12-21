# Retro – sprint-152-b5d3f2

## What worked
- The extension of `InternalEventV2` with `externalEvent` provided a clean way to handle behavioral events without breaking chat message logic.
- `EventSubEnvelopeBuilder` successfully decoupled normalization from the connection client.
- Mocking the new client in existing tests allowed for a safe integration without regressions.

## What didn't work
- Initial dependency installation hit peer dependency conflicts because `@twurple/api` defaulted to v8 while other project deps were on v7. Manually standardizing on `^7.4.0` resolved this.
- Strict null checks in TypeScript required updating several existing test files to use optional chaining on `evt.message`.
- Twurple's EventSub v2 implementation (especially `channel.follow` and `channel.update`) has strict and sometimes hardcoded user context requirements that differ from documentation, requiring explicit bot token registration and aliasing for broadcasters.

## Improvements for next sprint
- Consider a more automated way to manage peer dependencies for Twurple modules.
- Ensure that any schema changes are immediately followed by a test-all run to catch regressions early.
