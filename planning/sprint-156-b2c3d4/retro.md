# Retro – sprint-156-b2c3d4

## What went well
- Unified delivery logic significantly simplified the `onMessage` handlers.
- Discriminator-first routing provides a clearer path for future platform support.
- DLQ fallback ensures no messages are lost without a trace when clients are misconfigured.

## What could be improved
- The `IngressEgressServer` setup is getting a bit large; could be further modularized in future sprints.
- Integration testing with `BaseServer` and its auto-initializing resources requires careful mocking to avoid side effects or hanging tests.

## Lessons Learned
- When mocking constructors used with `new`, `mockImplementation` or throwing errors is more reliable than `mockReturnValue` for simulating missing instances.
- Always pass `Buffer` or JSON strings to `onMessage` handlers in integration tests to match `BaseServer`'s expectation of raw payloads.
