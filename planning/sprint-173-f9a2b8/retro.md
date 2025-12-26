# Sprint Retro – sprint-173-f9a2b8

## What Worked
- **Bottom-up Implementation**: Starting with types and bridge logic made the `McpClientManager` refactor much smoother.
- **Firestore Snapshots**: `onSnapshot` proved to be a highly effective way to handle dynamic server configuration without service restarts.
- **Tool ID Tracking**: Adding a way to track which tools belong to which server was crucial for implementing clean "remove/inactive" logic.

## What Didn't
- **Test Fragility**: Transitioning from environment variables to Firestore broke several existing tests that relied on the old `initFromConfig` behavior. This required significant mocking updates.

## Next Steps
- Implement embedding-based tool lookup for scenarios with many MCP servers.
- Add UI or CLI tools to manage the `mcp_servers` collection easily.
