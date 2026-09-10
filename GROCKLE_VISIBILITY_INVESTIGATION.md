# Grockle Composition Visibility Investigation

**Date**: 2026-09-10
**Sprint**: Sprint 50 (MCP Tool Response Shortcuts)
**Issue**: Grockle composition not visible to LLM despite successful registration
**Status**: Root cause identified, pending fix implementation

---

## Executive Summary

The grockle composition is successfully compiled and registered in tool-gateway's internal ToolRegistry, but does NOT appear in the LLM's tool list. Investigation revealed a **timing/synchronization issue** between composition registration and MCP client connections.

**Key Finding**: Grockle is registered ~9 seconds AFTER llm-bot connects and fetches its initial tool list, but llm-bot is not receiving or processing the MCP notification to refresh its tool list.

---

## Timeline of Events

### Service Startup Sequence (2026-09-10)

1. **17:20:33.000** - tool-gateway service starts
2. **17:20:33.148** - Grockle compilation FAILS (dependencies not ready)
   - Error: `Tool not found: mcp:get_state`
   - Error: `Tool not found: mcp:generate_image`
   - Logged as: `compilation_failed_validation`

3. **17:20:54.000** - llm-bot connects to tool-gateway
   - llm-bot requests initial tool list via MCP `tools/list` handler
   - Grockle NOT in list (compilation still failing)
   - llm-bot caches this tool list internally

4. **17:21:03.162** - Grockle compilation SUCCEEDS
   - All dependencies (state-engine, image-gen-mcp) now available
   - Logged as: `compilation_succeeded`

5. **17:21:03.195** - Grockle registered in tool-gateway
   - Logged as: `mcp_server.tool_registered` (base-server registration)
   - `registerCompositionTool()` completes successfully
   - Tool added to internal `ToolRegistry`

6. **17:21:03.195+** - Broadcast notification SHOULD be sent
   - `broadcastListChangedNotifications()` should notify connected clients
   - **PROBLEM**: No logs showing broadcast occurred
   - **PROBLEM**: llm-bot shows no logs of receiving notification

---

## Investigation Steps Taken

### Step 1: Verified Grockle Registration Status

**Method**: Asked LLM to call `mcp:composition.list_tools` with filter "grockle"

**Result**: ✅ **SUCCESS** - Grockle IS registered!

```
LLM Response:
"Found it. `mcp:composition.list_tools` with filter `"grockle"` returned **1 tool**:
- **ID:** `grockle`
- **Display name:** `grockle`
- **Source:** `composition`
- **Description:** Generates an image from a caller-supplied description, prefixed with the user's stored notes when any exist.
- **Has input schema:** `true`"
```

**Conclusion**: Grockle IS in the internal ToolRegistry, accessible via MCP tools, but NOT in the LLM's cached tool list.

### Step 2: Compared Code Paths

**Path A: `composition.list_tools` (WORKS)**
```typescript
// tools/tool-gateway.ts:1079
const toolsRecord = this.registry.getTools();
const allTools = Object.values(toolsRecord);
// Returns grockle ✅
```

**Path B: MCP `tools/list` handler (FAILS)**
```typescript
// tools/tool-gateway.ts:2322
const rawTools = Object.values(this.registry.getTools());
const visibleTools = trustedDiscovery ? rawTools : rawTools.filter(...);
// Should return grockle but LLM doesn't see it ❌
```

**Key Insight**: Both paths call the SAME function (`this.registry.getTools()`), but llm-bot doesn't see grockle. This means llm-bot's tool list is STALE (cached from initial connection before grockle was ready).

### Step 3: Verified Notification Architecture

**Broadcasting Code** (`tool-gateway.ts:1807-1850`):
```typescript
private async broadcastListChangedNotifications(): Promise<void> {
  if (sessionCount === 0) {
    logger.debug('tool_gateway.notifications.no_sessions');
    return;  // ❌ Early return if no sessions
  }

  // Send notifications to all connected MCP clients
  await Promise.allSettled([
    server.notification({
      method: 'notifications/tools/list_changed',
      params: {}
    })
  ]);
}
```

**Client Handler Code** (`common/mcp/client-manager.ts:607-609`):
```typescript
client.setNotificationHandler('notifications/tools/list_changed', async () => {
  await scheduleRefresh('tools');  // Re-fetch tool list after 500ms debounce
});
```

**Status**:
- ✅ Broadcast infrastructure exists
- ✅ Client notification handler exists
- ❌ No logs showing broadcast occurred
- ❌ No logs showing llm-bot received notification

---

## Root Cause Analysis

### Primary Issue: No Active MCP Sessions During Grockle Registration

**Evidence**:
1. tool-gateway logs show NO `tool_gateway.session.registered` entries
2. tool-gateway logs show NO `tool_gateway.notifications.broadcasting` entries
3. llm-bot logs show NO `mcp.client_manager.notification_received` entries

**Hypothesis**: When grockle was registered at 17:21:03, `this.sessionServers.size === 0`, causing `broadcastListChangedNotifications()` to return early without sending any notifications.

### Secondary Issue: MCP Connection Architecture Unclear

**Question**: How does llm-bot connect to tool-gateway?

**Evidence from llm-bot logs** (17:20:54):
- Multiple `mcp.client_manager.connected` logs
- Multiple `mcp.client_manager.list_tools.calling` logs
- These appear to be llm-bot connecting to OTHER MCP servers (tavily, state-engine, etc.)

**Missing Evidence**:
- No clear logs showing llm-bot establishing MCP session TO tool-gateway
- No `tool_gateway.session.registered` logs in tool-gateway

**Possible Explanations**:
1. **In-process communication**: llm-bot may call tool-gateway's ToolRegistry directly (not via MCP transport)
2. **Different transport**: llm-bot may use HTTP/REST instead of MCP SSE for tool discovery
3. **Missing logs**: Session registration logging may be disabled or filtered
4. **Startup race**: Session may have been created before we started capturing logs

---

## Code Locations

### Tool Registration Flow

**1. Composition Compilation** (`tool-gateway.ts:1179-1180`):
```typescript
for (const record of compositions) {
  await this.registerCompositionTool(record.compiled);
}
```

**2. Tool Registration** (`tool-gateway.ts:1253-1296`):
```typescript
private async registerCompositionTool(composition: any): Promise<void> {
  // Step 1: Register in internal ToolRegistry
  this.registry.registerTool({
    id: toolId,
    source: 'composition',
    execute: async (args) => this.executeComposition(composition, args)
  });

  // Step 2: Register via base-server MCP interface
  this.registerTool(toolId, description, standardSchema, handler);

  // Step 3: Log completion (but this log is NOT appearing!)
  this.getLogger().debug('tool_gateway.composition.registered', {
    toolId,
    version: composition.metadata.version
  });
}
```

**3. Notification Broadcast** (`tool-gateway.ts:1414-1424`):
```typescript
await this.registerCompositionTool(composition);

// Broadcast tool list changed notification
try {
  await this.broadcastListChangedNotifications();
} catch (notifyError) {
  this.getLogger().warn('composition_watcher.broadcast_failed', {
    error: notifyError.message
  });
}
```

### MCP Session Management

**Session Creation** (`tool-gateway.ts:2278-2316`):
```typescript
protected async getMcpServerForConnection(req: Request): Promise<Server> {
  const sessionId = `${context.agentName}-${Date.now()}-${Math.random()}`;
  const sessionServer = new Server({...});

  // Track session for broadcasts
  this.sessionServers.set(sessionId, sessionServer);

  logger.info('tool_gateway.session.registered', {
    sessionId,
    agentName: context.agentName,
    totalSessions: this.sessionServers.size
  });

  // Set up request handlers (tools/list, tools/call, etc.)
  sessionServer.setRequestHandler('tools/list', async () => {
    const rawTools = Object.values(this.registry.getTools());
    // ...
  });
}
```

**Tools List Handler** (`tool-gateway.ts:2318-2365`):
```typescript
sessionServer.setRequestHandler('tools/list', async (request, ctx) => {
  const trustedDiscovery = (context.agentName === 'llm-bot') || ...;
  const rawTools = Object.values(this.registry.getTools());
  const visibleTools = trustedDiscovery ? rawTools : rawTools.filter(...);

  logger.trace(`Returning ${tools.length} tools (trustedDiscovery=${trustedDiscovery})`);
  return { tools };
});
```

### ToolRegistry Implementation

**Storage** (`services/llm-bot/tools/registry.ts:4`):
```typescript
private tools: Map<string, BitBratTool> = new Map();
```

**Registration** (`registry.ts:20-35`):
```typescript
registerTool(tool: BitBratTool): void {
  this.tools.set(tool.id, tool);

  // TRACE logging (requires LOG_LEVEL=trace)
  this.logger?.trace?.('registry.tool.registered', {
    toolId: tool.id,
    originServer: tool.originServer,
    beforeCount,
    afterCount,
    stack: new Error().stack?.split('\n').slice(2, 5).join(' | ')
  });
}
```

**Retrieval** (`registry.ts:63-74`):
```typescript
getTools(): Record<string, BitBratTool> {
  const record: Record<string, BitBratTool> = {};
  for (const tool of this.tools.values()) {
    const name = this.getToolName(tool);  // Sanitizes for AI SDK
    record[name] = tool;
  }
  return record;
}
```

---

## Verification Commands Used

### Check Composition Registration
```bash
# Via MCP tool
message.send({
  text: "@bitbrat_the_ai please call the tool mcp:composition.list_tools with filter \"grockle\"",
  context: "staging",
  waitForResponse: true
})
```

### Check Tool-Gateway Logs
```bash
fleet.logs({
  bit: "tool-gateway",
  context: "staging",
  limit: 500
})
```

### Check LLM-Bot Logs
```bash
fleet.logs({
  bit: "llm-bot",
  context: "staging",
  limit: 100
})
```

---

## Unanswered Questions

1. **How does llm-bot connect to tool-gateway?**
   - Via MCP SSE transport?
   - Via direct in-process calls?
   - Via HTTP/REST API?

2. **Why are there no `tool_gateway.session.registered` logs?**
   - Is session logging disabled?
   - Do sessions exist but not get logged?
   - Is llm-bot using a different connection method?

3. **Why didn't the broadcast notification work?**
   - Were there truly no sessions at 17:21:03?
   - Did the notification fail silently?
   - Does llm-bot have the notification handler properly registered?

4. **Why doesn't `tool_gateway.composition.registered` debug log appear?**
   - Is debug logging disabled (LOG_LEVEL=info)?
   - Is there an exception preventing line 1285 from executing?
   - Is the try/catch swallowing errors?

---

## Next Steps (Pending)

### Investigation Phase
1. ✅ Verify grockle is registered in ToolRegistry - **CONFIRMED**
2. ✅ Compare code paths for working vs broken tool discovery - **COMPLETED**
3. ✅ Verify notification architecture exists - **CONFIRMED**
4. ⏸️ Determine how llm-bot connects to tool-gateway - **PAUSED**
5. ⏸️ Verify session exists when broadcast is called - **PAUSED**

### Fix Phase (Not Started)
1. Enable TRACE logging to see registry operations
2. Add explicit session existence logging in broadcast
3. Verify notification delivery to llm-bot
4. Implement workaround if needed:
   - Option A: Force llm-bot to refresh tools periodically
   - Option B: Add manual tool refresh MCP tool
   - Option C: Fix session lifecycle to ensure broadcasts work

---

## Related Files

- `src/apps/tool-gateway.ts` - Tool registration, MCP server, broadcast logic
- `src/common/mcp/client-manager.ts` - MCP client notification handling
- `src/services/llm-bot/tools/registry.ts` - Internal tool registry storage
- `examples/compositions/grockle.yaml` - The composition that's not visible
- `planning/sprint-50-mczu42/verification-report.md` - Sprint 50 completion report
- `TRACE_LOGGING_ADDITIONS.md` - Sprint 50 debug logging documentation

---

## Conclusion

Grockle IS successfully registered in tool-gateway's ToolRegistry and is accessible via the `composition.list_tools` admin tool. However, it does NOT appear in llm-bot's cached tool list because:

1. llm-bot connected and fetched tools BEFORE grockle was successfully compiled
2. The MCP notification system to refresh llm-bot's tool list is either:
   - Not being triggered (no active sessions during broadcast)
   - Not being received by llm-bot
   - Not being processed by llm-bot's notification handler

The issue is NOT with the registration logic itself, but with the **synchronization mechanism** between tool registration and client tool list updates.

**Impact**: Any new compositions or tools added after llm-bot starts will not be visible until llm-bot restarts, defeating the purpose of the hot-reload/notification system.

**Priority**: HIGH - This affects the core value proposition of dynamic tool registration (Sprint 27 feature).
