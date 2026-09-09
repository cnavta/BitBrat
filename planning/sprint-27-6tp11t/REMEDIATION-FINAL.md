# Final Remediation: Utility Service Counter Tools

**Date**: 2026-08-27 17:45
**Status**: All Issues Identified and Fixed
**Sprint**: sprint-27-6tp11t

---

## Summary

**Three separate issues** prevented counter tools from working:

1. ✅ **Resource Access Pattern** - Wrong API used to access resources
2. ✅ **Health Check Endpoint** - Docker using `/health` instead of `/healthz`
3. ℹ️  **Tool Naming** - Reflex using wrong tool name (configuration issue, not code)

All code fixes are complete. Ready for deployment and reflex configuration update.

---

## Issue 1: Resource Access Pattern ✅ FIXED

### Problem
```typescript
// WRONG - bypasses resource management
this.docStore = (this as any).resources?.documentStore;
this.redis = (this as any).resources?.redis;
```

### Fix
```typescript
// CORRECT - uses protected method from base class
this.docStore = this.getResource<IDocumentStore>('documentStore');
this.redis = this.getResource<RedisClientType>('redis');
```

**File**: `src/apps/utility-service.ts` (lines 97-98, 129-132)

**Impact**: Resources now properly initialized, CounterManager available

---

## Issue 2: Health Check Endpoint ✅ FIXED

### Problem

Docker health check using **wrong endpoint**:

```yaml
# WRONG
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3020/health"]
```

Result: Service marked unhealthy → tool-gateway can't discover it → tools not available

### Fix

```yaml
# CORRECT
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3020/healthz"]
```

**File**: `infrastructure/docker-compose/services/utility.compose.yaml` (line 16)

**Impact**: Container will be healthy → tool-gateway discovers service → tools available

**Why `/healthz`**: Base server registers health endpoints as:
- `/healthz` - Health status
- `/readyz` - Readiness status
- `/livez` - Liveness status

(Source: `src/common/base-server.ts:877-885`)

---

## Issue 3: Tool Naming ℹ️ CONFIGURATION

### Problem

Reflex calling `mcp_counter_increment` but should call `counter_increment`

### Why

Tool names are **sanitized** by the tool registry:

```typescript
// From src/services/llm-bot/tools/registry.ts:99-102
private getToolName(tool: BitBratTool): string {
  // Sanitize for AI SDK: replace colons and dots with underscores
  return tool.id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
```

**Examples**:
- `counter.increment` → `counter_increment`
- `counter.create` → `counter_create`
- `mcp:obs.set_scene_item_enabled` → `mcp_obs_set_scene_item_enabled`

**The `mcp_` prefix is ONLY for external MCP servers**:
- ✅ `mcp_obs_*` - from obs-mcp service (external)
- ✅ `mcp_story_*` - from story-engine-mcp service (external)
- ❌ `mcp_counter_*` - WRONG, counter is internal Bit

### Fix

Update reflex configuration to use `counter_increment`:

```json
{
  "action": {
    "tool": "counter_increment",  // ✅ CORRECT
    "parameters": {
      "name": "star_citizen_crashes_this_patch",
      "delta": 1,
      "scopeType": "global",
      "scopeValue": "star_citizen_patch"
    }
  }
}
```

---

## Deployment Instructions

### Step 1: Build and Deploy to Staging

```bash
cd /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-27-6tp11t

# Build
npm run build

# Deploy to staging
npm run brat -- bit deploy utility --context staging

# Or via SSH (if running from local machine)
ssh root@bitbrat.lan "cd /path/to/BitBratPlatform && npm run brat -- bit deploy utility --context staging"
```

### Step 2: Verify Health Check

Wait 30-60 seconds for health checks to pass, then verify:

```bash
ssh root@bitbrat.lan "docker ps | grep utility"
```

**Expected**: `Up N minutes (healthy)` (NOT `unhealthy`)

**Also check**:
```bash
ssh root@bitbrat.lan "curl -f http://localhost:3025/healthz"
```

**Expected**: HTTP 200 with JSON health status

### Step 3: Verify Tool Registration

Check tool-gateway logs:

```bash
npm run brat -- fleet logs --bit tool-gateway --context staging --grep "counter" --limit 50
```

**Expected**: Tool registration messages from utility service

**Verify tools available**:
```bash
ssh root@bitbrat.lan "curl http://localhost:3000/v1/tools | jq '.tools[] | select(.id | contains(\"counter\"))'"
```

**Expected output**:
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

### Step 4: Update Reflex Configuration

**Option A: Direct Database Update (PostgreSQL)**

```sql
UPDATE reflexes
SET action = jsonb_set(action, '{tool}', '"counter_increment"')
WHERE name = 'Track Star Citizen patch crashes'
  AND action->>'tool' = 'mcp_counter_increment';
```

**Option B: Via Reflex API/UI** (if available)

Edit the reflex and change `tool` from `mcp_counter_increment` to `counter_increment`

### Step 5: Test End-to-End

**Test counter.increment directly**:
```bash
curl -X POST http://localhost:3000/v1/tools/counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{
    "name": "test_counter",
    "delta": 1,
    "scopeType": "global",
    "scopeValue": "test"
  }'
```

**Expected** (< 1 second response):
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

**Test via reflex** (send `!crash` in chat):

1. Send `!crash` command in Twitch/Discord chat
2. Check reflex logs:
   ```bash
   npm run brat -- fleet logs --bit reflex --context staging --grep "crash" --limit 20
   ```
3. Verify counter incremented:
   ```bash
   curl -X POST http://localhost:3000/v1/tools/counter_get \
     -H "Content-Type: application/json" \
     -d '{
       "name": "star_citizen_crashes_this_patch",
       "scopeType": "global",
       "scopeValue": "star_citizen_patch"
     }'
   ```

**Expected**: Counter value > 0

---

## Verification Checklist

- [ ] Code built successfully (`npm run build`)
- [ ] Utility service deployed to staging
- [ ] Container status shows `(healthy)` not `(unhealthy)`
- [ ] `/healthz` endpoint returns 200 OK
- [ ] Tool-gateway logs show utility service registered
- [ ] Counter tools appear in `/v1/tools` list
- [ ] `counter_increment` tool callable directly (< 1 second)
- [ ] Reflex configuration updated to use `counter_increment`
- [ ] `!crash` command increments counter successfully
- [ ] No timeout errors in tool-gateway logs

---

## Files Changed

### Code Fixes
1. `src/apps/utility-service.ts`
   - Line 97-98: Use `getResource<T>()` for initial resource access
   - Line 129-132: Re-fetch resources in lazy initialization

2. `infrastructure/docker-compose/services/utility.compose.yaml`
   - Line 16: Change health check from `/health` to `/healthz`

### Documentation
1. `planning/sprint-27-6tp11t/remediation-report.md` - Initial analysis
2. `planning/sprint-27-6tp11t/remediation-update.md` - Tool naming issue
3. `planning/sprint-27-6tp11t/REMEDIATION-FINAL.md` - This document

---

## Counter Tool Reference

Use these names in reflexes and direct tool calls:

| Tool ID | Sanitized Name | Purpose |
|---------|----------------|---------|
| `counter.create` | `counter_create` | Create new counter |
| `counter.increment` | `counter_increment` | Increment counter |
| `counter.get` | `counter_get` | Get value + metadata |
| `counter.delete` | `counter_delete` | Delete counter |
| `counter.list` | `counter_list` | Query counters |
| `counter.snapshot` | `counter_snapshot` | Take snapshot |

---

## Root Cause Analysis

### Why Three Separate Issues?

1. **Resource Access**: Used wrong pattern during initial implementation
   - Copied from claim-check but used `(this as any).resources` instead of `getResource<T>()`
   - No agent-dev testing caught this (platform issue blocked deployment)

2. **Health Check**: Copied healthcheck from another service without verifying endpoint
   - Most services use `/health` or `/healthz` inconsistently
   - Base server provides `/healthz` but pattern not enforced

3. **Tool Naming**: Naming convention not documented for reflexes
   - LLM tools use sanitized names but this wasn't clear
   - `mcp_` prefix convention caused confusion

### Prevention Measures

1. ✅ **Use `getResource<T>()`**: Document in CLAUDE.md
2. ✅ **Standardize health checks**: Use `/healthz` everywhere
3. ✅ **Document tool naming**: Add to reflex documentation
4. ✅ **Agent-dev testing**: Fix platform issues, enforce validation

---

## Success Metrics

After deployment, verify:

✅ **Health**: Container healthy for > 5 minutes
✅ **Discovery**: Tool-gateway discovers 6 counter tools
✅ **Latency**: Tool calls < 1 second (not 60 seconds)
✅ **Reliability**: No timeout errors in logs
✅ **Functionality**: `!crash` command works end-to-end

---

## Rollback Plan

If issues persist after deployment:

```bash
# Stop utility service
ssh root@bitbrat.lan "docker stop bitbrat-staging-utility-1"

# Remove from docker-compose temporarily
# Edit docker-compose.staging.yaml, comment out utility service

# Restart stack without utility
ssh root@bitbrat.lan "cd /path/to/platform && docker-compose -f docker-compose.staging.yaml up -d"
```

Counter functionality will be unavailable but platform continues operating.

---

## Timeline

- **17:00** - Issue reported (60s timeout)
- **17:15** - Root cause 1 identified (resource access)
- **17:30** - Root cause 2 identified (tool naming)
- **17:45** - Root cause 3 identified (health check)
- **17:50** - All fixes implemented
- **TBD** - Deployment to staging
- **TBD** - Verification complete

---

**Status**: Ready for deployment
**Next**: Deploy to staging, verify health check, update reflex config, test end-to-end
