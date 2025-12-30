# Sprint Retro – sprint-174-8f2e91

## What Worked
- Test-driven development for `McpStatsCollector` ensured core logic was solid before integration.
- Tool wrapping in `processor.ts` provided a clean way to capture errors without leaking `evt` into the MCP bridge.
- Reusing existing `BaseServer` logging and app setup patterns made adding the debug endpoint straightforward.

## What Didn't
- Initial implementation of `ServerStats` interface and usage had a property name mismatch (`totalErrors` vs `errors`), which was caught by tests.
- Changing `McpBridge` constructor broke existing tests, requiring a second pass to fix them.

## Future Improvements
- Consider moving stats to a separate service or using a standard metrics library if more complex aggregations are needed.
- Add authentication/authorization checks for `/_debug` endpoints if exposed to external traffic.
