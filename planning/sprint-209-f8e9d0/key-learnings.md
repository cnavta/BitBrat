# Key Learnings – sprint-209-f8e9d0

- **Manual WS Upgrade**: When using `ws` with `express` (via `BaseServer`/`McpServer`), manual `upgrade` handling is the cleanest way to perform pre-connection authentication.
- **Firestore Token Storage**: Hashing tokens (SHA-256) before storage is essential for security, even in internal systems.
- **Connection Management**: Tracking WebSocket instances in a `Map<string, Set<WebSocket>>` allows for routing messages to multiple concurrent connections for the same user.
- **Event Mapping**: Mapping external "action" events (like `chat.message.send`) to internal "fact" events (`chat.message`) helps maintain a clean domain model.
