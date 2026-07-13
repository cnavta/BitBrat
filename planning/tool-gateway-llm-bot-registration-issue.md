# Tool Gateway & LLM-Bot Registration Issue - Root Cause & Remediation Plan

## Investigation Summary

**Issue:** After a fresh platform deployment, tool-gateway only exposes a fraction of available tools to llm-bot until both services are restarted.

**Status:** Root cause identified. Remediation plan drafted.

**Date:** 2026-07-11

---

## Root Cause Analysis

### The Race Condition

The issue is a **startup race condition** between llm-bot, tool-gateway, and the individual Bits:

#### Timeline from Staging Logs (2026-07-11 18:20:xx)

```
18:20:42.824Z  llm-bot starts initialization
18:20:43.073Z  llm-bot begins connecting to tool-gateway
18:20:43.505Z  llm-bot successfully connects to tool-gateway
               ⚠️ llm-bot calls discoverTools() and gets snapshot of tools
                  available AT THIS MOMENT (very few or none)
18:20:45.192Z  tool-gateway STARTS connecting to first Bit
               (1.7 seconds AFTER llm-bot already got its tool snapshot!)
18:20:45.192Z
    to         tool-gateway discovers tools from multiple Bits
18:20:52.905Z  (~7.7 seconds of ongoing discovery)
```

**Gap:** llm-bot connects to tool-gateway ~2 seconds before tool-gateway has discovered any Bits.

### How It Works Today

#### Tool-Gateway Initialization (`src/apps/tool-gateway.ts:52-74`)
1. Starts `RegistryWatcher` which watches Firestore `mcp_servers` collection
2. Initial snapshot fires immediately with whatever is already in Firestore
3. Subscribes to `INTERNAL_MCP_REGISTRATION_V1` messages from Bits
4. As Bits start up and publish registrations, tool-gateway:
   - Writes registration to Firestore (`mcp_servers` collection)
   - RegistryWatcher receives onSnapshot event
   - Calls `onServerActive(config)` → `mcpManager.connectServer(config)`
   - Discovers tools from that Bit via `discoverTools()`

#### LLM-Bot Initialization (`src/common/profiles/mcp-client-profile.ts:56-100`)
1. McpClientProfile's `connect()` method runs during `onStartup` hook
2. Reads `MCP_GATEWAY_URL` and creates SSE connection to tool-gateway
3. Calls `manager.connectServer(cfg)` which:
   - Connects to tool-gateway SSE endpoint
   - Calls `discoverTools()` **ONE TIME** (`src/common/mcp/client-manager.ts:275-278`)
   - Registers discovered tools in its local registry
4. **No mechanism exists to refresh tools when tool-gateway discovers new ones**

### Why Restarting Fixes It

**When tool-gateway is restarted (after all Bits have registered):**
1. RegistryWatcher's initial Firestore snapshot contains ALL registered Bits
2. tool-gateway immediately connects to all of them
3. When llm-bot connects, it gets the full tool list

**When llm-bot is restarted (after tool-gateway has all tools):**
1. llm-bot's `connect()` method runs again
2. Calls `discoverTools()` and gets the current (complete) tool list from tool-gateway

---

## Current Architecture Gaps

### 1. No Tool List Change Notifications (Tool-Gateway → LLM-Bot)

**Gap:** Tool-gateway does NOT send `ToolListChangedNotification` when new tools are discovered.

**MCP SDK Support:** The MCP SDK provides `ToolListChangedNotificationSchema` for exactly this purpose.

**Location:** When tool-gateway's McpClientManager discovers tools (after connecting to a new Bit), it should notify all connected MCP clients (like llm-bot).

**File:** `src/apps/tool-gateway.ts` - the session MCP server created in `getMcpServerForConnection()`

### 2. No Notification Listeners (LLM-Bot)

**Gap:** llm-bot's MCP client does NOT listen for `ToolListChangedNotification` from tool-gateway.

**MCP SDK Support:** MCP SDK Client supports notification handlers.

**Location:** llm-bot's McpClientManager should register a notification handler to refresh tools when notified.

**File:** `src/common/mcp/client-manager.ts` - add notification handler during `connectServer()`

### 3. Startup Ordering Assumptions

**Gap:** The system assumes services start in a specific order and that tool-gateway will be "ready" before clients connect. This is not guaranteed in Cloud Run or Docker Compose.

---

## Remediation Plan

### Option 1: Implement MCP Tool List Change Notifications (RECOMMENDED)

**Approach:** Use the MCP protocol's built-in notification mechanism to keep tool lists synchronized.

#### Changes Required:

##### A. Tool-Gateway: Send Notifications When Tools Change

**File:** `src/apps/tool-gateway.ts`

**Implementation:**
1. Track all active MCP session servers (clients connected to tool-gateway)
2. When `mcpManager` discovers new tools (via `onServerActive` callback), notify all connected clients
3. Send `ToolListChangedNotification` (and `ResourceListChangedNotification`, `PromptListChangedNotification`)

**Code Changes:**
- Add private field: `private sessionServers: Map<string, Server> = new Map()`
- Modify `getMcpServerForConnection()` to register each session server in the map
- Add callback to `RegistryWatcher` options to fire when tools/resources/prompts are discovered
- Broadcast notifications to all session servers

**Pseudocode:**
```typescript
// In RegistryWatcher callback after tool discovery:
private notifyToolsChanged() {
  for (const [sessionId, server] of this.sessionServers.entries()) {
    server.notification({
      method: 'notifications/tools/list_changed',
      params: {}
    });
  }
}
```

##### B. LLM-Bot: Listen for Notifications and Refresh Tools

**File:** `src/common/mcp/client-manager.ts`

**Implementation:**
1. After connecting to tool-gateway, register notification handlers
2. When `ToolListChangedNotification` received, call `discoverTools()` again
3. Similarly for resources and prompts

**Code Changes:**
- Modify `connectServer()` to set up notification handlers after successful connection:

**Pseudocode:**
```typescript
// After client.connect(transport):
client.setNotificationHandler(ToolListChangedNotificationSchema, async (notification) => {
  logger.info('mcp.client_manager.tools_changed_notification', { server: config.name });
  await this.discoverTools(config.name, config.requiredRoles);
});

client.setNotificationHandler(ResourceListChangedNotificationSchema, async (notification) => {
  logger.info('mcp.client_manager.resources_changed_notification', { server: config.name });
  await this.discoverResources(config.name, config.requiredRoles);
});

client.setNotificationHandler(PromptListChangedNotificationSchema, async (notification) => {
  logger.info('mcp.client_manager.prompts_changed_notification', { server: config.name });
  await this.discoverPrompts(config.name, config.requiredRoles);
});
```

**Benefits:**
- Standards-compliant (uses MCP protocol as designed)
- Works for any MCP client, not just llm-bot
- Handles dynamic tool additions/removals during runtime
- No polling required
- Minimal performance overhead

**Risks:**
- Requires careful concurrency handling (multiple Bits registering simultaneously)
- Need to deduplicate redundant re-discovery calls
- Must handle notification delivery failures gracefully

---

### Option 2: Startup Coordination via Firestore

**Approach:** Add a "ready" flag to tool-gateway that llm-bot waits for before connecting.

**Changes Required:**
1. Tool-gateway writes a "ready" document to Firestore after discovering all initial tools
2. llm-bot polls Firestore for the ready flag before connecting
3. Add timeout and fallback logic

**Benefits:**
- Simpler initial implementation
- Works even if notifications aren't supported

**Drawbacks:**
- Only solves the startup race; doesn't handle runtime tool additions
- Adds Firestore dependency to startup path
- Requires polling or onSnapshot watcher (additional complexity)
- Doesn't scale well if tool-gateway is restarted frequently

**Verdict:** Not recommended as the primary solution. Could be used as a supplementary health check.

---

### Option 3: Periodic Tool Refresh (Polling)

**Approach:** llm-bot periodically re-discovers tools from tool-gateway on a schedule.

**Implementation:**
- Add a periodic timer in McpClientManager to call `discoverTools()` every N seconds
- Configurable interval via environment variable (e.g., `MCP_REFRESH_INTERVAL_MS`)

**Benefits:**
- Simple to implement
- Eventually consistent
- Doesn't require notification support

**Drawbacks:**
- Inefficient (constant polling even when nothing changes)
- Delayed discovery (bounded by refresh interval)
- Adds unnecessary load to tool-gateway
- Doesn't help with initial startup race unless interval is very short

**Verdict:** Could be used as a fallback or belt-and-suspenders approach alongside notifications.

---

## Recommended Solution

**Primary:** **Option 1** (MCP Tool List Change Notifications)
- Standards-compliant
- Efficient and immediate
- Works at runtime and startup
- Extensible to other MCP clients

**Supplementary:** **Option 3** (Periodic Refresh as Fallback)
- Only if notifications fail or are not delivered
- Long interval (e.g., 5 minutes) to catch edge cases
- Disabled by default, enabled via flag

---

## Implementation Phases

### Phase 1: Tool-Gateway Notification Broadcasting
**Estimated Effort:** 4-6 hours

**Tasks:**
1. Add session server tracking in tool-gateway
2. Implement notification broadcasting when tools/resources/prompts change
3. Add logging for notification sends
4. Write unit tests for notification logic

**Deliverables:**
- Tool-gateway sends `ToolListChangedNotification` when new Bits register
- Logs confirm notifications are being sent

### Phase 2: LLM-Bot Notification Handling
**Estimated Effort:** 3-4 hours

**Tasks:**
1. Add notification handlers to McpClientManager
2. Implement tool re-discovery on notification
3. Add debouncing/throttling for rapid notifications
4. Add logging for notification receipt and refresh actions
5. Write unit tests for notification handling

**Deliverables:**
- llm-bot listens for and handles `ToolListChangedNotification`
- Tool registry refreshes automatically when notification received
- Tests verify end-to-end notification flow

### Phase 3: Testing & Validation
**Estimated Effort:** 3-4 hours

**Tasks:**
1. Deploy to staging
2. Test fresh deployment scenario (restart all services)
3. Test runtime scenario (add new Bit while system is running)
4. Test tool-gateway restart scenario
5. Verify logs show notifications being sent and received
6. Measure latency from Bit registration to llm-bot tool availability

**Success Criteria:**
- llm-bot has all tools within 5 seconds of any Bit publishing registration
- No manual restarts required after fresh deployment
- Logs show clear notification flow

### Phase 4: Optional Fallback (Periodic Refresh)
**Estimated Effort:** 2-3 hours

**Tasks:**
1. Add optional periodic refresh timer to McpClientManager
2. Disabled by default, enabled via `MCP_REFRESH_INTERVAL_MS`
3. Log when fallback refresh discovers new tools (indicates notification gap)
4. Write tests

**Deliverables:**
- Fallback mechanism available for edge cases

---

## Testing Strategy

### Unit Tests
- Tool-gateway notification broadcasting logic
- LLM-bot notification handler and re-discovery
- Debouncing/throttling of rapid notifications

### Integration Tests
- End-to-end notification flow (mock MCP client/server)
- Verify tool registry updates after notification

### Staging Tests
1. **Fresh Deployment Test:**
   - Deploy all services from scratch
   - Verify llm-bot has all tools within 5 seconds

2. **Runtime Addition Test:**
   - Start with all services running
   - Add a new Bit
   - Verify llm-bot discovers its tools automatically

3. **Tool-Gateway Restart Test:**
   - Restart tool-gateway while llm-bot is running
   - Verify llm-bot reconnects and refreshes tools

4. **Notification Failure Test:**
   - Simulate notification delivery failure
   - Verify fallback (if implemented) catches the gap

---

## Rollout Plan

### Stage 1: Development & Unit Testing
- Implement Phase 1 & 2
- Run unit tests
- Manual local testing with Docker Compose

### Stage 2: Staging Validation
- Deploy to staging
- Run full test suite
- Monitor logs for notification flow
- Leave running for 24 hours to observe stability

### Stage 3: Production Deployment
- Deploy during low-traffic window
- Monitor metrics:
  - Tool discovery latency
  - Notification send/receive rates
  - Error rates
  - llm-bot tool registry size over time
- Rollback plan: revert to previous version if errors spike

---

## Monitoring & Observability

### New Metrics to Track
1. **tool_gateway.notifications.sent** - Counter of notifications sent per type
2. **llm_bot.notifications.received** - Counter of notifications received
3. **llm_bot.tool_discovery.refreshes** - Counter of tool re-discovery calls
4. **llm_bot.tool_discovery.latency** - Time from Bit registration to tool availability

### Log Indicators
- `tool_gateway.notifications.broadcast` - Sent notification to clients
- `mcp.client_manager.tools_changed_notification` - Received notification
- `mcp.client_manager.tools_discovered` - Tools refreshed (with count)

### Alerts
- Alert if notification send/receive rates diverge significantly
- Alert if llm-bot tool count drops unexpectedly
- Alert if tool discovery latency exceeds 10 seconds

---

## Files to Modify

### Primary Changes
1. `src/apps/tool-gateway.ts`
   - Add session server tracking
   - Implement notification broadcasting

2. `src/common/mcp/client-manager.ts`
   - Add notification handlers
   - Implement notification-triggered refresh

### Supporting Changes
3. `src/common/mcp/types.ts`
   - Add notification-related type definitions if needed

### Tests
4. `src/apps/tool-gateway.test.ts`
   - Add notification broadcasting tests

5. `src/common/mcp/client-manager.test.ts`
   - Add notification handling tests

6. New: `tests/integration/mcp-notifications.spec.ts`
   - End-to-end notification flow tests

---

## Open Questions

1. **Notification Delivery Guarantees:** Does MCP SDK guarantee notification delivery, or do we need retry logic?
2. **Debouncing Strategy:** If 10 Bits register within 1 second, should we debounce notifications or send 10 separate ones?
3. **Backward Compatibility:** Do we need to support clients that don't handle notifications? (Probably yes - graceful degradation)
4. **Firestore Trigger:** Should tool-gateway also send notifications when it detects Firestore changes (not just when it connects to a new Bit)?

---

## Risk Assessment

### High Confidence
- Root cause is correctly identified (verified via logs and code review)
- MCP SDK supports the required notification mechanism
- Solution is architecturally sound

### Medium Confidence
- Implementation complexity is manageable (3-4 days total)
- No major side effects expected

### Low Confidence
- Performance impact of frequent notifications (need to measure)
- Edge cases in notification delivery (need comprehensive testing)

---

## Success Metrics

### Before Fix
- **Manual Intervention Required:** 100% of fresh deployments require 2 manual restarts
- **Tool Availability Latency:** Indefinite (until manual restart)
- **User Impact:** llm-bot fails to find most tools, degraded functionality

### After Fix
- **Manual Intervention Required:** 0% (fully automatic)
- **Tool Availability Latency:** <5 seconds from Bit registration
- **User Impact:** None - seamless tool discovery

---

## Conclusion

The root cause is a **startup race condition** where llm-bot connects to tool-gateway before tool-gateway has finished discovering all Bits. The current architecture has no mechanism for clients to refresh their tool lists after the initial connection.

**Recommended Solution:** Implement MCP Tool List Change Notifications per Option 1.

This is a **standards-compliant**, **efficient**, and **runtime-safe** solution that solves both the startup race and future runtime tool additions.

**Estimated Total Effort:** 12-17 hours (1.5-2 days)

**Priority:** High - impacts every deployment and requires manual intervention

---

## Next Steps

1. Get stakeholder approval on remediation approach
2. Create implementation tickets for each phase
3. Begin Phase 1 implementation
4. Schedule staging deployment window for Phase 3
