# Key Learnings - sprint-162-8e12a3

- **SSE Transport in MCP**: Requires both `eventSourceInit` (for GET) and `requestInit` (for POST) to be properly configured if headers like `Authorization` are needed.
- **Flexible JSON parsing**: Using a simple check for `Array.isArray()` vs checking for a specific property like `mcpServers` allows supporting multiple common configuration formats.
- **TypeScript & External Libs**: Type definitions for libraries like `eventsource` might not always match the latest Node.js implementations, necessitating careful use of `any` or custom type extensions.
