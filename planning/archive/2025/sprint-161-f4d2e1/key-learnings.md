# Key Learnings – sprint-161-f4d2e1

## Model Context Protocol (MCP)
- MCP servers using `stdio` transport are easy to integrate into Node.js applications by spawning them as child processes.
- Always check the `bin` or `main` fields in an MCP server's `package.json` to identify the correct entry point.

## BitBrat Integration
- The `McpClientManager` and `McpBridge` implemented in Sprint 160 are flexible enough to handle external packages without modification.
- Tool registration in BitBrat should consistently use the `mcp_` prefix for tools originating from MCP servers to maintain clear provenance.

## Testing
- Integration tests that spawn the actual MCP server are valuable for verifying pathing and environment variables (like `node` command availability).
