# Sprint Retro – sprint-173-f9a2b8

## What Worked
- **Dynamic Updates**: The Firestore `onSnapshot` integration worked seamlessly, allowing real-time tool registration without restarts.
- **SSE Integration**: Native SSE support via the MCP SDK was straightforward once the transport branching was implemented.
- **RBAC Filtering**: Implementing filtering in the processor proved to be a robust approach that handles both internal and external tools consistently.
- **Test-Driven Refinement**: Unit tests for `McpClientManager` were critical in verifying complex state reconciliation logic (e.g., tool cleanup on server removal).

## What Didn't Work
- **SSE Header Types**: Encountered a minor mismatch in the `EventSource` types within the MCP SDK, which required mapping `env` to `requestInit` instead of `eventSourceInit`.
- **Legacy Test Cleanup**: Removing the legacy ENV var broke several existing tests that relied on it, requiring more test refactoring than initially planned.

## Future Improvements
- **Exponential Backoff**: Add more sophisticated retry logic for failed MCP connections.
- **Health Checks**: Implement a status update back to Firestore (e.g., a `lastHealthyAt` field) for each MCP server.
- **UI Management**: A future sprint could add a dashboard to manage these Firestore configurations.
