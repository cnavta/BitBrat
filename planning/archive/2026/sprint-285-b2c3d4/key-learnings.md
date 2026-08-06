# Key Learnings – sprint-285-b2c3d4

## Technical Insights
- **BaseServer Lifecycle**: In `jest` tests, if a `BaseServer` instance is created and subscribes to message bus topics, it must be explicitly closed via `server.close()` to avoid "open handles" and ensure the process can exit gracefully.
- **Type Safety in Tests**: Extending a Zod schema in a core service like `query-analyzer` can have downstream effects on tests that use that type. Updating the related interfaces and mock data is essential.

## Process Improvements
- **Service Factory Pattern**: Using `createServer()` in addition to `createApp()` provides better control for test teardown.
- **Full Test Run**: Running `validate_deliverable.sh` or a full test suite with `--detectOpenHandles` periodically is crucial for catching leaks early.
