# MCP Testing Utilities

Reusable utilities for testing MCP (Model Context Protocol) endpoints.

## Overview

This directory contains tools for testing MCP servers via HTTP/HTTPS, created during Sprint 63 to solve the recurring need for manual MCP endpoint testing.

## Files

- **mcp-client.ts** - Reusable MCP test client with JSON-RPC 2.0 support
- **README.md** - This documentation

## Quick Start

```typescript
import { McpTestClient, createMcpClientForContext } from './tools/test-utils/mcp-client';

// Option 1: Auto-configure from context
const client = await createMcpClientForContext('local');

// Option 2: Manual configuration
const client = new McpTestClient({
  url: 'http://localhost:3020/mcp',
  authToken: 'your-token-here'
});

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('model.get', { id: 'gpt-4' });
```

## Usage from Scripts

See `scripts/test-mcp-tools.ts` for a complete integration test example.

```bash
# Test local context
npm run test:mcp

# Test staging context
npm run test:mcp:staging

# Test custom URL
npm run test:mcp -- --url http://custom:3000/mcp --token xyz
```

## Key Learnings

### MCP Protocol Over HTTP

The MCP SDK uses **Streamable HTTP transport** which has specific requirements:

1. **Headers Required**:
   - `Content-Type: application/json`
   - `Accept: application/json, text/event-stream` (both required!)
   - `Authorization: Bearer <token>` (if auth enabled)

2. **Response Format**:
   - Server responds with **SSE (Server-Sent Events)** format
   - Even for POST requests!
   - Format: `event: message\ndata: {json}\n\n`

3. **Port Discovery**:
   - Use `docker port <container> 3000` to find mapped port
   - Different contexts may use different ports (local: 3020, staging: 3027)

### Common Issues

**Issue**: "Not Acceptable: Client must accept both application/json and text/event-stream"
**Fix**: Add `Accept: application/json, text/event-stream` header

**Issue**: "HTTP request failed" with empty message
**Fix**: Check port number (use `docker port` to discover)

**Issue**: "Failed to parse JSON response: event: message"
**Fix**: Need to parse SSE format, not plain JSON (TODO: Update client)

**Issue**: "Internal server error" from staging
**Status**: Under investigation - local works, staging returns 500

## TODO

### High Priority
- [ ] Update `McpTestClient.sendRequest()` to parse SSE responses
- [ ] Add SSE parsing utility function
- [ ] Test against staging once SSE parsing is fixed
- [ ] Investigate staging 500 error (separate from SSE issue)

### Medium Priority
- [ ] Add Jest integration (reusable test helpers)
- [ ] Add retry logic for flaky connections
- [ ] Add request/response logging (debug mode)
- [ ] Support WebSocket transport (alternative to HTTP)

### Nice to Have
- [ ] Add TypeScript types for all MCP protocol messages
- [ ] Create CLI tool for interactive MCP testing
- [ ] Add performance benchmarking utilities
- [ ] Generate API documentation from tool schemas

## Architecture

### McpTestClient Class

Core client implementing MCP JSON-RPC 2.0 protocol:

```typescript
class McpTestClient {
  initialize(): Promise<void>           // Initialize MCP session
  listTools(): Promise<McpTool[]>       // Get available tools
  callTool(name, args): Promise<Result> // Invoke a tool
  sendRequest(method, params): Promise  // Low-level JSON-RPC
}
```

### Helper Functions

```typescript
createMcpClientForContext(context): Promise<McpTestClient>
  // Auto-configure from architecture.yaml + .secure.{context}/.env

McpTestClient.formatToolResult(result): string
  // Pretty-print tool results

McpTestClient.assertSuccess(result): void
  // Throw if tool call failed

McpTestClient.extractText(result): string
  // Get text content from result

McpTestClient.parseJson<T>(result): T
  // Parse JSON from text content
```

## Related Files

- `scripts/test-mcp-tools.ts` - Integration test suite using these utilities
- `package.json` - npm scripts (`test:mcp`, `test:mcp:staging`)

## Contributing

When adding new features:
1. Keep utilities reusable and context-agnostic
2. Add TypeScript types for all interfaces
3. Include usage examples in comments
4. Update this README with learnings and gotchas

## Sprint 63 Context

These utilities were created to solve the recurring problem of manually testing MCP endpoints. Previously, we had to:
- Manually craft curl commands
- Remember port numbers and auth tokens
- Parse JSON responses by hand
- No reusable testing infrastructure

Now we have:
- Reusable client library
- Context-aware configuration
- Automated test suites
- Foundation for future MCP tooling

---

*Created: Sprint 63 (2026-11-15)*
*Last Updated: 2026-11-15*
