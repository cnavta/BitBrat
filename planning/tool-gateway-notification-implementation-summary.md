# Tool Gateway & LLM-Bot Notification Implementation Summary

**Sprint:** Tool-Gateway Registration Issue Remediation
**Date:** 2026-07-11
**Status:** Implementation Complete - Ready for Staging Deployment

---

## Overview

Implemented MCP Tool List Change Notifications to solve the startup race condition where llm-bot connects to tool-gateway before tool-gateway has discovered all Bits.

**Root Issue:** llm-bot performs one-time tool discovery at startup, missing tools from Bits that register later.

**Solution:** tool-gateway broadcasts `ToolListChangedNotification` when new Bits register; llm-bot listens and automatically refreshes its tool registry.

---

## Changes Implemented

### Phase 1: Tool-Gateway Notification Broadcasting

**File:** `src/apps/tool-gateway.ts`

**Changes:**
1. Added `sessionServers` map to track connected MCP clients
2. Implemented `broadcastListChangedNotifications()` method
3. Modified `start()` to call broadcast when Bits connect/disconnect
4. Updated `getMcpServerForConnection()` to register session servers
5. Updated `close()` to clean up session servers

**Key Features:**
- Tracks all active MCP session servers (clients connected to tool-gateway)
- Broadcasts 3 notification types: `tools`, `resources`, `prompts`
- Comprehensive logging for debugging
- Graceful error handling (non-fatal if notification send fails)

**Logging Added:**
- `tool_gateway.session.registered` - Session registered with ID and agent name
- `tool_gateway.notifications.broadcasting` - Starting broadcast to N sessions
- `tool_gateway.notifications.sent` - Successfully sent to session
- `tool_gateway.notifications.send_failed` - Failed to send (non-fatal)
- `tool_gateway.notifications.broadcast_complete` - Summary of broadcast

---

### Phase 2: LLM-Bot Notification Handling

**File:** `src/common/mcp/client-manager.ts`

**Changes:**
1. Imported notification schemas from MCP SDK
2. Added `notificationDebounceTimers` map for debouncing
3. Implemented `setupNotificationHandlers()` method
4. Modified `connectServer()` to call setup after initial discovery
5. Updated `shutdown()` to clear debounce timers

**Key Features:**
- Listens for `ToolListChangedNotification`, `ResourceListChangedNotification`, `PromptListChangedNotification`
- Debounces rapid notifications (500ms default, configurable via `MCP_NOTIFICATION_DEBOUNCE_MS`)
- Re-discovers all types (tools, resources, prompts) on any notification for consistency
- Comprehensive logging for debugging

**Logging Added:**
- `mcp.client_manager.notification_handlers_registered` - Handlers set up successfully
- `mcp.client_manager.notification_received` - Received notification from server
- `mcp.client_manager.notification_refresh` - Starting refresh after debounce
- `mcp.client_manager.notification_refresh_complete` - Completed with counts
- `mcp.client_manager.notification_refresh_error` - Refresh failed (non-fatal)

---

## Configuration

### Environment Variables

**MCP_NOTIFICATION_DEBOUNCE_MS** (default: 500)
- Debounce delay for notification-triggered re-discovery
- Prevents rapid successive calls if multiple Bits register simultaneously
- Lower values = faster discovery, higher load
- Higher values = less load, slower discovery

---

## Technical Details

### Notification Flow

1. **Bit Startup:**
   - Bit publishes registration to `INTERNAL_MCP_REGISTRATION_V1`
   - tool-gateway receives registration, writes to Firestore
   - RegistryWatcher receives Firestore snapshot event
   - `onServerActive` callback fires
   - tool-gateway connects to Bit via `mcpManager.connectServer()`
   - `discoverTools/Resources/Prompts()` called
   - `broadcastListChangedNotifications()` called

2. **Notification Broadcast:**
   - tool-gateway iterates over all active `sessionServers`
   - Calls `server.notification()` with 3 notification types
   - Logs success/failure for each session

3. **llm-bot Receives Notification:**
   - Notification handler fires
   - Clears any pending debounce timer
   - Schedules new debounced refresh (500ms default)
   - After debounce expires, calls `discoverTools/Resources/Prompts()`
   - Logs counts of discovered items

### Debouncing Strategy

**Problem:** If 10 Bits register simultaneously, we'd trigger 10 rapid re-discoveries.

**Solution:** Use a single debounce timer per server. Each notification resets the timer.

**Example Timeline:**
```
T+0ms:    Bit1 registers → notification sent → timer set for 500ms
T+100ms:  Bit2 registers → notification sent → timer reset to 500ms from now
T+200ms:  Bit3 registers → notification sent → timer reset to 500ms from now
T+700ms:  Timer expires → ONE re-discovery happens (discovers all 3 Bits)
```

### Session Tracking

**Challenge:** MCP SDK doesn't expose connection close events easily.

**Solution:**
- Track sessions in `sessionServers` map
- Sessions are removed when `close()` is called (server shutdown)
- Stale sessions are harmless (notification send will fail silently)
- Could add periodic cleanup timer in future if needed

---

## Testing

### Build Status
✅ TypeScript compilation: **PASSED**
✅ Existing tests: **26/27 passed** (1 pre-existing failure unrelated to changes)

### Manual Testing Needed
- [ ] Deploy to staging
- [ ] Restart all services (fresh deployment scenario)
- [ ] Verify llm-bot has all tools within 5 seconds
- [ ] Check logs for notification flow
- [ ] Test runtime Bit addition (add new Bit while running)
- [ ] Verify llm-bot discovers new Bit's tools automatically

---

## Files Modified

### Core Implementation
1. `src/apps/tool-gateway.ts` - Notification broadcasting
2. `src/common/mcp/client-manager.ts` - Notification handling

### Documentation
3. `planning/tool-gateway-llm-bot-registration-issue.md` - Root cause analysis & plan
4. `planning/tool-gateway-notification-implementation-summary.md` - This file

---

## Deployment Instructions

### 1. Build
```bash
npm run build
```

### 2. Deploy to Staging
```bash
npm run brat -- deploy services --all --stage staging
```

Or deploy specific services:
```bash
npm run brat -- deploy service tool-gateway --stage staging
npm run brat -- deploy service llm-bot --stage staging
```

### 3. Monitor Logs

**Tool-Gateway:**
```bash
npm run brat -- fleet logs tool-gateway --since 5m --level info
```

Look for:
- `tool_gateway.session.registered` - Sessions connecting
- `tool_gateway.notifications.broadcasting` - Notifications being sent
- `tool_gateway.notifications.broadcast_complete` - Successful broadcasts

**LLM-Bot:**
```bash
npm run brat -- fleet logs llm-bot --since 5m --level info
```

Look for:
- `mcp.client_manager.notification_received` - Receiving notifications
- `mcp.client_manager.notification_refresh` - Starting refresh
- `mcp.client_manager.notification_refresh_complete` - Completed (with counts)

### 4. Validation

**Check tool counts:**
```bash
# Access llm-bot's debug endpoint to see tool count
curl -H "x-mcp-token: $MCP_AUTH_TOKEN" \
  https://api.staging.bitbrat.com/llm-bot/_debug/mcp | jq '.registry.totalTools'
```

**Expected:** Should match the total tools across all registered Bits.

**Check tool-gateway tool count:**
```bash
curl -H "x-mcp-token: $MCP_AUTH_TOKEN" \
  https://api.staging.bitbrat.com/tool-gateway/v1/tools | jq '.tools | length'
```

---

## Success Metrics

### Before Implementation
- **Manual restarts required:** 100% of fresh deployments
- **Tool discovery latency:** Indefinite (until manual restart)
- **User impact:** llm-bot fails to find most tools

### After Implementation (Expected)
- **Manual restarts required:** 0%
- **Tool discovery latency:** <5 seconds from Bit registration
- **User impact:** None - seamless tool discovery

---

## Rollback Plan

If issues arise in staging:

### 1. Immediate Rollback
```bash
# Revert to previous version
git revert <commit-sha>
npm run build
npm run brat -- deploy services --all --stage staging
```

### 2. Monitor for Issues
- Tool discovery failures
- High CPU/memory usage (unlikely, but possible with rapid notifications)
- Error logs from notification handling

### 3. Adjust Configuration
If notifications are too frequent (high load):
```bash
# Increase debounce delay via environment variable
MCP_NOTIFICATION_DEBOUNCE_MS=2000  # 2 seconds instead of 500ms
```

---

## Future Enhancements

### Nice-to-Have (Not Blocking)
1. **Unit Tests** - Add comprehensive tests for notification flow
2. **Metrics** - Track notification send/receive rates, latency
3. **Periodic Cleanup** - Remove stale sessions from sessionServers map
4. **Selective Refresh** - Only refresh changed type (tools/resources/prompts) instead of all
5. **Backpressure** - Limit max notification send rate if many clients

### Already Handled
✅ Debouncing to prevent rapid re-discoveries
✅ Logging for observability
✅ Graceful error handling (non-fatal failures)
✅ Configurable debounce delay

---

## Known Limitations

1. **Session Cleanup:** Stale sessions remain in `sessionServers` map until tool-gateway restarts
   - **Impact:** Minimal - failed notification sends are logged but non-fatal
   - **Mitigation:** Could add periodic cleanup timer if this becomes an issue

2. **No Retry on Notification Send Failure:** If a notification send fails, we don't retry
   - **Impact:** Client might miss an update
   - **Mitigation:** Periodic refresh fallback (not implemented yet, but could be added)

3. **All Types Refreshed:** Any notification triggers refresh of tools, resources, AND prompts
   - **Impact:** Slightly more work than necessary
   - **Mitigation:** Simpler logic, ensures consistency, negligible performance impact

---

## Conclusion

**Status:** ✅ Implementation Complete

**Next Steps:**
1. Deploy to staging
2. Validate fresh deployment scenario
3. Monitor logs for notification flow
4. If successful, deploy to production

**Estimated Impact:**
- Eliminates 100% of manual restart requirements
- Reduces tool discovery latency from indefinite to <5 seconds
- Improves developer experience and system reliability

**Risk:** Low - Changes are additive, backward compatible, and fail gracefully.
