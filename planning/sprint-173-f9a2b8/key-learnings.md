# Key Learnings – sprint-173-f9a2b8

## Technical Learnings
- **MCP SDK Transport**: `SSEClientTransport` in the `@modelcontextprotocol/sdk` uses `eventsource` internally. When passing headers, they should be applied to `requestInit` to ensure they are sent with both the initial stream request and subsequent POST messages in the current SDK version.
- **Firestore Snapshot Management**: Storing tool IDs per server in a `Map` is essential for clean cleanup during `onSnapshot` updates. Without this, removing a document would leave orphaned tools in the global registry.
- **RBAC in AI SDK**: Filtering tools *before* passing them to `generateText` is the cleanest way to enforce RBAC, as it prevents the LLM from even seeing the tool's existence if the user isn't authorized.

## Process Learnings
- **Execution Plan Flexibility**: Phase 4 (SSE Support) was added mid-sprint. Having a structured but updatable execution plan allowed for smooth scope expansion without losing track of the core goals.
- **Traceability**: Logging every major implementation step in `request-log.md` made the final verification and retro creation much more efficient.
