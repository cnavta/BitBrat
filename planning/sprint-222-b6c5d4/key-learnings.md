# Key Learnings – sprint-222-b6c5d4

- **MCP Tool Testing**: Directly accessing `registeredTools` from the server instance allows testing the logic without needing a full SSE/JSON-RPC client.
- **Firestore Mocking**: Spying on `BaseServer.prototype.getResource` is an effective way to inject mock Firestore/Publishers into services during tests.
- **Event Contracts**: Adding new event types to the central `InternalEventType` ensures type safety across the system.
