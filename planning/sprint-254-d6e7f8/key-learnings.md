# Key Learnings – sprint-254-d6e7f8

- **Dynamic MCP RBAC:** Shared MCP sessions between services require per-request metadata to distinguish between user-level permissions.
- **MCP `_meta` field:** This field is standard-aligned for cross-cutting concerns like identity, tracing, and progress, even if specific tool schemas don't include it.
- **Zod Stripping:** MCP SDK request handlers use Zod to validate incoming requests, which can strip unknown fields like `_meta` if they're not explicitly allowed in the schema used for that specific handler. Using the base `CallToolRequestSchema` and `extra` headers provides a robust fallback mechanism.
