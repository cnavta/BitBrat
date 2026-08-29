# FINAL FIX: Counter Tool 404 Error

**Date**: 2026-08-27 23:35
**Issue**: Reflex getting 404 error when calling `counter_increment`
**Root Cause**: Tool naming convention misunderstanding

---

## Problem Summary

After restarting tool-gateway, it successfully connected to the utility service and registered all 6 counter tools. However, the reflex is still getting a 404 error when calling `counter_increment`.

---

## Root Cause Analysis

**What we discovered**:

1. ✅ Utility service is running and healthy
2. ✅ Utility service registered with tool-gateway
3. ✅ Tool-gateway connected to utility service
4. ✅ All 6 counter tools discovered and registered
5. ❌ **Tools are registered with `mcp:` prefix in tool-gateway's internal registry**

**Tool-gateway's internal registry** (from logs):
```json
{
  "toolIds": [
    "mcp:counter.create",
    "mcp:counter.increment",  ← This is the actual tool ID
    "mcp:counter.get",
    "mcp:counter.delete",
    "mcp:counter.list",
    "mcp:counter.snapshot"
  ]
}
```

**This is CONSISTENT across ALL platform services**:
- Claim-check: `mcp:claim.event.retrieve`
- State-engine: `mcp:get_state`
- Scheduler: `mcp:create_schedule`
- **Utility: `mcp:counter.increment`**

---

## The Fix: Use `mcp_counter_increment`

Tool-gateway adds the `mcp:` prefix to ALL tools from ALL MCP servers (both external and platform Bits). When the reflex calls a tool via REST API, the tool name gets sanitized:

**Tool ID in registry**: `mcp:counter.increment`
**Sanitized for REST**: `mcp_counter_increment` (replace `:` and `.` with `_`)

### Correct Reflex Configuration

```json
{
  "action": {
    "tool": "mcp_counter_increment",  // ✅ CORRECT
    "timeout": 5000,
    "parameters": {
      "name": "star_citizen_crashes_this_patch",
      "delta": 1,
      "scopeType": "global",
      "scopeValue": "star_citizen_patch"
    }
  }
}
```

### Update Command (PostgreSQL)

```sql
UPDATE reflexes
SET action = jsonb_set(action, '{tool}', '"mcp_counter_increment"')
WHERE name = 'Track Star Citizen patch crashes';
```

---

## Complete Tool Name Reference

Use these sanitized names in reflexes:

| Tool ID (Registry) | Sanitized Name (Use in Reflex) |
|--------------------|----------------------------------|
| `mcp:counter.create` | `mcp_counter_create` |
| `mcp:counter.increment` | `mcp_counter_increment` |
| `mcp:counter.get` | `mcp_counter_get` |
| `mcp:counter.delete` | `mcp_counter_delete` |
| `mcp:counter.list` | `mcp_counter_list` |
| `mcp:counter.snapshot` | `mcp_counter_snapshot` |

---

## Why the Confusion?

**Earlier remediation documents incorrectly stated**:
- ❌ "Use `counter_increment` (no `mcp_` prefix)"
- ❌ "The `mcp_` prefix is ONLY for external MCP servers"

**The truth**:
- ✅ Tool-gateway adds `mcp:` prefix to **ALL** tools in its internal registry
- ✅ This includes both external MCP servers AND platform Bits
- ✅ The prefix is added by tool-gateway, not by the service itself
- ✅ When calling via REST API, sanitize the full tool ID: `mcp:counter.increment` → `mcp_counter_increment`

---

## Verification Steps

### Step 1: Update Reflex Configuration

```bash
ssh root@bitbrat.lan "docker exec bitbrat-staging-postgres-1 psql -U bitbrat bitbrat_staging -c \"UPDATE reflexes SET action = jsonb_set(action, '{tool}', '\\\"mcp_counter_increment\\\"') WHERE name = 'Track Star Citizen patch crashes';\""
```

### Step 2: Test in Chat

Send `!crash` command in Twitch/Discord chat

### Step 3: Verify Success

Check reflex logs for successful execution (not 404 error):

```bash
npm run brat -- fleet logs --bit reflex --context staging --since 2m --limit 20
```

**Expected**: No 404 errors, tool execution succeeds

### Step 4: Verify Counter Increment

```bash
# Direct tool call to verify counter value
curl -X POST http://localhost:3000/v1/tools/mcp_counter_get \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer b581fac8-cbc5-4de6-bb89-edf4ea2a5b04" \
  -d '{
    "name": "star_citizen_crashes_this_patch",
    "scopeType": "global",
    "scopeValue": "star_citizen_patch"
  }'
```

**Expected**: Counter value > 0

---

## Timeline of Discovery

1. **23:27** - Reflex error: 404 for `counter_increment`
2. **23:31** - Restarted tool-gateway
3. **23:31** - Tool-gateway connected to utility, registered 6 tools
4. **23:32** - Analyzed logs, discovered `mcp:` prefix on ALL tools
5. **23:35** - Identified correct tool name: `mcp_counter_increment`

---

## Platform-Wide Pattern

**ALL tools accessed via tool-gateway REST API** follow this pattern:

```
Service registers: counter.increment
Tool-gateway stores: mcp:counter.increment
REST API expects: mcp_counter_increment
```

**Examples from other services**:
- Claim-check: `claim.event.retrieve` → `mcp:claim.event.retrieve` → `mcp_claim_event_retrieve`
- State-engine: `get_state` → `mcp:get_state` → `mcp_get_state`
- Scheduler: `create_schedule` → `mcp:create_schedule` → `mcp_create_schedule`

---

## Apology for Earlier Confusion

The earlier remediation documents (REMEDIATION-FINAL.md, remediation-update.md) incorrectly stated that:
- Platform Bits should use names WITHOUT the `mcp_` prefix
- Only external MCP servers get the `mcp_` prefix

This was **incorrect**. The correct pattern is:
- **ALL** tools in tool-gateway get the `mcp:` prefix
- **ALL** reflex tool calls must use the sanitized form with `mcp_`

---

## Status

**Code**: ✅ All working correctly
**Configuration**: ⚠️ Needs reflex update to use `mcp_counter_increment`
**Next Action**: Update reflex configuration and test

---

**FINAL ANSWER**: Use `mcp_counter_increment` in the reflex configuration.
