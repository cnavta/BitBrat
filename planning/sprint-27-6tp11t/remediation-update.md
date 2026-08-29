# Remediation Update: Tool Naming Issue + Verification Steps

**Date**: 2026-08-27 17:10
**Status**: Additional Issue Identified
**Previous Report**: remediation-report.md

---

## New Finding: Tool Naming Mismatch

###Problem

The reflex configuration is using the **WRONG tool name**:

```json
{
  "action": {
    "tool": "mcp_counter_increment",  // ❌ WRONG
    ...
  }
}
```

### Root Cause

Tool names are **sanitized** when registered in the tool-gateway registry:

**Sanitization Rule** (`src/services/llm-bot/tools/registry.ts:99-102`):
```typescript
private getToolName(tool: BitBratTool): string {
  // Sanitize for AI SDK: replace colons and dots with underscores
  return tool.id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
```

**Examples**:
- `mcp:obs.set_scene_item_enabled` → `mcp_obs_set_scene_item_enabled`
- `counter.increment` → `counter_increment`
- `counter.create` → `counter_create`

### The Fix

**Update the reflex configuration**:

```json
{
  "action": {
    "tool": "counter_increment",  // ✅ CORRECT (no mcp_ prefix)
    "parameters": {
      "name": "star_citizen_crashes_this_patch",
      "delta": 1,
      "scopeType": "global",
      "scopeValue": "star_citizen_patch"
    }
  }
}
```

**Why no `mcp_` prefix?**

The `mcp_` prefix is ONLY for external MCP servers:
- `mcp_obs_*` → from obs-mcp service (external MCP server)
- `mcp_story_*` → from story-engine-mcp service (external MCP server)
- `counter_*` → from utility Bit (internal, no prefix)

---

## Verification Checklist

### Step 1: Verify Resource Fix Was Deployed ✅

Check staging logs for utility service startup:

```bash
npm run brat -- fleet logs --bit utility --context staging --limit 50 --since 30m
```

**Expected Logs** (from fixed version):
```json
{"msg":"utility.resources.initialized","hasDocStore":true,"hasRedis":true}
{"msg":"utility.scope_resolver.initialized"}
{"msg":"utility.counter_manager.initialized"}
{"msg":"utility.counter_tools.registered","tools":[...]}
```

**If missing** → Resource fix NOT deployed, redeploy:
```bash
npm run brat -- bit deploy utility --context staging
```

### Step 2: Verify Tool Registration ✅

Check tool-gateway for registered counter tools:

```bash
# Via REST API
curl http://tool-gateway:3000/v1/tools | jq '.tools[] | select(.id | contains("counter"))'
```

**Expected Tools**:
```json
[
  {"id": "counter.create", "displayName": "counter_create"},
  {"id": "counter.increment", "displayName": "counter_increment"},
  {"id": "counter.get", "displayName": "counter_get"},
  {"id": "counter.delete", "displayName": "counter_delete"},
  {"id": "counter.list", "displayName": "counter_list"},
  {"id": "counter.snapshot", "displayName": "counter_snapshot"}
]
```

### Step 3: Test Tool Directly ✅

Test `counter_increment` via REST API:

```bash
curl -X POST http://tool-gateway:3000/v1/tools/counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{
    "name": "test_counter",
    "delta": 1,
    "scopeType": "global",
    "scopeValue": "test"
  }'
```

**Expected Response** (< 1 second):
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"success\":true,\"newValue\":1,\"key\":\"counter:global:test:test_counter\"}"
    }]
  }
}
```

**If timeout** → Resource fix not working, check utility logs

### Step 4: Update Reflex Configuration ✅

Update the reflex in Firestore/PostgreSQL:

```sql
UPDATE reflexes
SET action = jsonb_set(
  action,
  '{tool}',
  '"counter_increment"'
)
WHERE name = 'Track Star Citizen patch crashes';
```

OR via reflex management tool:
```bash
npm run brat -- reflex update "Track Star Citizen patch crashes" \
  --action-tool counter_increment
```

### Step 5: Test End-to-End ✅

1. Send `!crash` command in chat
2. Check reflex logs:
   ```bash
   npm run brat -- fleet logs --bit reflex --context staging --grep "crash" --limit 20
   ```

3. Verify counter increment:
   ```bash
   curl http://tool-gateway:3000/v1/tools/counter_get \
     -H "Content-Type: application/json" \
     -d '{
       "name": "star_citizen_crashes_this_patch",
       "scopeType": "global",
       "scopeValue": "star_citizen_patch"
     }'
   ```

**Expected**: Counter value incremented

---

## Debugging Timeout Issues

If timeout persists after fixing tool name:

### Check 1: Resource Initialization

```bash
npm run brat -- fleet logs --bit utility --context staging --grep "resources" --limit 20
```

Look for:
- ✅ `utility.resources.initialized { hasDocStore: true, hasRedis: true }`
- ❌ `utility.resources.documentStore.unavailable`
- ❌ `utility.resources.redis.unavailable`

### Check 2: Tool Handler Execution

```bash
npm run brat -- fleet logs --bit utility --context staging --grep "counter.increment" --limit 50
```

Look for:
- ✅ `counter.increment.tool_called`
- ✅ `counter.increment.manager_ready`
- ✅ `counter.increment.success`
- ❌ `counter.increment.manager_unavailable` → Resources not ready
- ❌ `counter.increment.error` → Check error details

### Check 3: Network/MCP Communication

```bash
npm run brat -- fleet logs --bit tool-gateway --context staging --grep "counter" --limit 50
```

Look for:
- ✅ `tool_gateway.mcp.call_tool.success { duration: <100ms }`
- ❌ `tool_gateway.mcp.call_tool.error { error: "Request timed out" }`
- ❌ `tool_gateway.rest.tool_not_found`

### Check 4: Redis Connectivity

```bash
# From utility service container
redis-cli -h redis PING
# Expected: PONG

# Check if Redis has counter keys
redis-cli -h redis KEYS "counter:*"
```

### Check 5: DocumentStore Connectivity

```bash
# From utility service container
psql $DATABASE_URL -c "SELECT 1"
# Expected: 1 row returned

# Check for counter_definitions table
psql $DATABASE_URL -c "SELECT COUNT(*) FROM counter_definitions"
```

---

## Complete Tool Name Reference

For all counter tools in reflexes, use these sanitized names:

| Tool ID (Registered) | Sanitized Name (Use in Reflexes) |
|----------------------|-----------------------------------|
| `counter.create` | `counter_create` |
| `counter.increment` | `counter_increment` |
| `counter.decrement` | `counter_decrement` |
| `counter.get` | `counter_get` |
| `counter.set` | `counter_set` |
| `counter.delete` | `counter_delete` |
| `counter.list` | `counter_list` |
| `counter.snapshot` | `counter_snapshot` |

**NOTE**: `counter.decrement` is NOT implemented yet (Phase 1 only has increment).

---

## Quick Fix Commands

### 1. Update Reflex Tool Name

```bash
# Option A: Via database (PostgreSQL)
psql $DATABASE_URL <<SQL
UPDATE reflexes
SET action = jsonb_set(action, '{tool}', '"counter_increment"')
WHERE action->>'tool' = 'mcp_counter_increment';
SQL

# Option B: Via Firestore (if using legacy)
# Use Firestore console or admin SDK
```

### 2. Redeploy Utility Service (if resource fix missing)

```bash
cd /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-27-6tp11t
npm run build
npm run brat -- bit deploy utility --context staging
```

### 3. Verify Fix

```bash
# Test counter increment
curl -X POST http://tool-gateway:3000/v1/tools/counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"name":"test","delta":1,"scopeType":"global","scopeValue":"test"}'

# Should respond in < 1 second with:
# {"result":{"content":[{"type":"text","text":"{\"success\":true,\"newValue\":N,...}"}]}}
```

---

## Summary

**Two Issues Identified**:

1. ✅ **Tool Naming** (Reflex Configuration)
   - WRONG: `mcp_counter_increment`
   - CORRECT: `counter_increment`
   - Fix: Update reflex configuration

2. ⚠️ **Resource Access** (Utility Service Code)
   - WRONG: `(this as any).resources?.documentStore`
   - CORRECT: `this.getResource<IDocumentStore>('documentStore')`
   - Fix: Already implemented, verify deployed to staging

**Next Actions**:
1. Update reflex tool name to `counter_increment`
2. Verify resource fix deployed to staging
3. Test tool directly via REST API
4. Test end-to-end with !crash command
5. Monitor logs for any errors

---

## Reference: Correct Reflex Configuration

```json
{
  "id": "reflex-1787849310955-rynovk9",
  "name": "Track Star Citizen patch crashes",
  "tags": ["counter", "star-citizen", "crash", "chat-command"],
  "match": {
    "type": "exact",
    "field": "message.text",
    "pattern": "!crash",
    "caseSensitive": false
  },
  "action": {
    "tool": "counter_increment",  // ✅ FIXED: removed mcp_ prefix
    "timeout": 5000,
    "parameters": {
      "name": "star_citizen_crashes_this_patch",
      "delta": 1,
      "scopeType": "global",
      "scopeValue": "star_citizen_patch"
    }
  },
  "active": true,
  "priority": 50,
  "conditions": {
    "eventTypes": ["chat.command.v1", "chat.message.v1"],
    "minAuthLevel": 0
  },
  "description": "When chat sends !crash, increment the global counter tracking how many times Star Citizen has crashed this patch.",
  "candidateTemplate": "Crash logged. Star Citizen has performed another involuntary interpretive shutdown this patch."
}
```

---

**Status**: Ready for deployment verification and reflex configuration update.
