# MCP Notification System Issue

**Status**: Backlog
**Priority**: Medium
**Discovered**: Sprint 42 (2026-09-04)
**Related**: Tool-gateway composition hot-reload

## Problem

The `broadcastListChangedNotifications()` method in tool-gateway reports "no active sessions" even when MCP clients (like llm-bot) are connected and have registered notification handlers.

```json
{"msg":"tool_gateway.notifications.no_sessions","message":"No active sessions to notify"}
```

This prevents clients from automatically discovering new tools (including compositions) without restarting.

## Root Cause

The `getMcpServerForConnection()` method creates session tracking and populates the `sessionServers` map (line 2232 in tool-gateway.ts), but this method is **never being invoked** by the base MCP server implementation.

**Expected flow:**
1. Client connects via SSE endpoint
2. `getMcpServerForConnection()` is called (override from base class)
3. Session added to `sessionServers` map
4. Notifications can be broadcast to active sessions

**Actual flow:**
1. Client connects via SSE endpoint
2. `getMcpServerForConnection()` is **NOT** called
3. `sessionServers` map remains empty
4. Broadcast notifications are skipped ("no active sessions")

## Evidence

### llm-bot successfully connects:
```json
{"ts":"2026-09-04T16:48:15.343Z","service":"llm-bot","level":"debug","msg":"mcp.client_manager.notification_handlers_registered","server":"tool-gateway","types":["tools","resources","prompts"]}
{"ts":"2026-09-04T16:48:15.343Z","service":"llm-bot","level":"info","msg":"mcp.client_manager.connected","name":"tool-gateway"}
```

### Tool-gateway claims no sessions:
```json
{"ts":"2026-09-04T16:49:13.458Z","service":"tool-gateway","level":"debug","msg":"tool_gateway.notifications.no_sessions","message":"No active sessions to notify"}
```

### Missing session registration logs:
Expected log `tool_gateway.session.registered` (line 2242) is never emitted, confirming `getMcpServerForConnection()` is not called.

## Impact

- **Workaround exists**: Clients can restart to discover new tools
- **Hot-reload works**: Compositions load successfully in tool-gateway
- **Severity**: Medium - affects UX but not core functionality

## Investigation Notes

### Relevant Code
- **tool-gateway.ts:2209-2247**: `getMcpServerForConnection()` method
- **tool-gateway.ts:1742-1812**: `broadcastListChangedNotifications()` method
- **tool-gateway.ts:150**: `sessionServers` map declaration

### Related Commits
- `74cab136` - "fix: Create new MCP Server instance per SSE connection"
- Sprint 28 Phase 2 - MCP SDK 2.0 migration

### Hypothesis
The base `McpServer` class (src/common/mcp-server.ts) or `Bit` base class may not properly invoke the `getMcpServerForConnection()` override when using SSE transport. This needs investigation into:

1. How SSE connections are established in the base class
2. Where `getMcpServerForConnection()` should be called
3. Whether this is a regression from MCP SDK 2.0 migration

## Proposed Fix

**Option 1**: Fix base class to invoke `getMcpServerForConnection()`
- Investigate MCP server initialization flow
- Ensure override method is called on SSE connection
- **Pros**: Proper architectural fix
- **Cons**: Requires deep understanding of MCP base classes

**Option 2**: Track sessions differently
- Listen to connection events from MCP SDK
- Populate `sessionServers` via event handlers
- **Pros**: Simpler, decoupled from base class
- **Cons**: May duplicate tracking logic

**Option 3**: Periodic session discovery
- Poll connected clients periodically
- Refresh `sessionServers` map from active connections
- **Pros**: Resilient to missed connection events
- **Cons**: Adds overhead, doesn't solve root cause

## Recommendation

Assign to a future sprint focused on MCP infrastructure improvements. Not critical for Sprint 42 since:
- Composition hot-reload works correctly
- Clients can restart to discover new tools
- Core functionality is not blocked

## Acceptance Criteria (Future Sprint)

- [ ] `getMcpServerForConnection()` is called when clients connect
- [ ] `sessionServers` map is populated with active sessions
- [ ] `broadcastListChangedNotifications()` successfully notifies clients
- [ ] llm-bot automatically discovers new compositions without restart
- [ ] Unit tests verify session tracking
- [ ] Integration tests verify notification delivery
