# Docker Configuration Fixes Summary

**Date**: 2026-08-27 23:45
**Sprint**: sprint-27-6tp11t
**Services Fixed**: utility, claim-check

---

## Overview

Fixed Docker configuration issues in 2 services discovered during utility service deployment audit. Both services had:
1. Wrong/slow healthcheck configuration
2. Missing explicit MCP_AUTH_TOKEN environment variable

---

## Services Fixed

### 1. Utility Service ✅

**Issues**:
- ❌ Slow healthcheck timing (30s interval → 5s)
- ❌ Missing silent flag on curl
- ❌ Missing explicit MCP_AUTH_TOKEN

**Impact**:
- Slow service discovery (30-90s to detect healthy)
- Cluttered logs with curl progress output
- Implicit dependency on env_file

**Status**: ✅ Fixed

**File**: `infrastructure/docker-compose/services/utility.compose.yaml`

---

### 2. Claim-Check Service ✅

**Issues**:
- ❌ **CRITICAL**: Wrong healthcheck endpoint (`/health` instead of `/healthz`)
- ❌ Slow healthcheck timing (30s interval → 5s)
- ❌ Missing silent flag on curl
- ❌ Missing explicit MCP_AUTH_TOKEN

**Impact**:
- Container likely marked unhealthy (404 on `/health` endpoint!)
- Tool-gateway unable to discover claim tools
- Progress messages failing (claim.event.retrieve unavailable)
- Slow service discovery when endpoint was working

**Status**: ✅ Fixed

**File**: `infrastructure/docker-compose/services/claim-check.compose.yaml`

---

## Standard Healthcheck Pattern

All platform services should use this pattern:

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:${PORT}/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

**Rationale**:
- **`/healthz`**: Base server registers this endpoint (not `/health`)
- **5s interval**: Fast detection (30s is too slow)
- **3s timeout**: Fail quickly on issues
- **10 retries**: Resilient to temporary issues (50s total before unhealthy)
- **`-sf` flags**: Silent (clean logs) + Fail on HTTP errors

---

## Changes Applied

### Utility Service

```diff
 services:
   utility:
     env_file:
       - .env.brat
+    environment:
+      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
     build:
       # ... (unchanged)
     healthcheck:
-      test: ["CMD", "curl", "-f", "http://localhost:3020/healthz"]
-      interval: 30s
-      timeout: 10s
-      retries: 3
+      test: ["CMD", "curl", "-sf", "http://localhost:3020/healthz"]
+      interval: 5s
+      timeout: 3s
+      retries: 10
```

### Claim-Check Service

```diff
 services:
   claim-check:
     env_file:
       - .env.brat
+    environment:
+      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
     build:
       # ... (unchanged)
     healthcheck:
-      test: ["CMD", "curl", "-f", "http://localhost:3008/health"]
-      interval: 30s
-      timeout: 10s
-      retries: 3
+      test: ["CMD", "curl", "-sf", "http://localhost:3008/healthz"]
+      interval: 5s
+      timeout: 3s
+      retries: 10
```

---

## Testing Checklist

### After Rebuild

**For both services**, verify:

1. **Container Health**:
   ```bash
   docker ps | grep -E "(utility|claim-check)"
   # Expected: Both show (healthy) within 5-15 seconds
   ```

2. **Healthcheck Endpoints**:
   ```bash
   curl -sf http://localhost:3020/healthz  # utility
   curl -sf http://localhost:3008/healthz  # claim-check
   # Expected: Both return 200 OK with JSON
   ```

3. **MCP_AUTH_TOKEN**:
   ```bash
   docker exec bitbrat-staging-utility-1 env | grep MCP_AUTH_TOKEN
   docker exec bitbrat-staging-claim-check-1 env | grep MCP_AUTH_TOKEN
   # Expected: Both show MCP_AUTH_TOKEN=<token>
   ```

4. **Tool-Gateway Connection**:
   ```bash
   docker logs bitbrat-staging-tool-gateway-1 | grep -E "(utility|claim-check)" | grep "connected"
   # Expected: Both services show mcp.client_manager.connected
   ```

5. **Tool Availability**:
   ```bash
   # Test utility counter tool
   curl -X POST http://localhost:3000/v1/tools/mcp_counter_increment \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -d '{"name":"test","delta":1,"scopeType":"global","scopeValue":"test"}'

   # Test claim-check event tool
   curl -X POST http://localhost:3000/v1/tools/mcp_claim_event_exists \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -d '{"correlationId":"test-123"}'

   # Expected: Both respond in < 1 second (no 404 errors)
   ```

---

## Impact Analysis

### Utility Service

**Before**:
- Took 30-90 seconds to be marked healthy
- Tool-gateway discovery delayed
- Logs cluttered with curl output

**After**:
- Healthy in 5-15 seconds (6x faster)
- Immediate tool discovery
- Clean logs

**Risk**: Low (new service, no production usage yet)

---

### Claim-Check Service

**Before**:
- **Likely unhealthy** due to 404 on `/health` endpoint
- Tool-gateway couldn't discover 6 claim tools
- Progress messages failing silently
- May have caused intermittent issues with LLM streaming

**After**:
- Correct healthcheck endpoint (`/healthz`)
- Healthy in 5-15 seconds
- Tools discoverable immediately
- Progress messages work reliably

**Risk**: Medium to High
- Claim-check is critical infrastructure (used by tool-gateway for progress updates)
- Wrong endpoint may have caused historical issues
- Fix should improve platform stability

---

## Root Cause Analysis

### Why These Issues Existed

1. **Utility Service**:
   - New service (Sprint 27)
   - Copied healthcheck from claim-check (which was wrong)
   - No platform-wide healthcheck standard enforced

2. **Claim-Check Service**:
   - Likely created before `/healthz` endpoint was standardized
   - Never updated to match current platform pattern
   - Wrong endpoint went unnoticed because service was working (despite being marked unhealthy)

### Prevention

1. **Document standard pattern**: Add to CLAUDE.md or platform docs
2. **Service creation template**: Update `bit create` to use correct healthcheck
3. **Platform-wide audit**: Check all services for correct healthcheck configuration
4. **CI/CD validation**: Consider adding healthcheck endpoint validation

---

## Files Changed

### Modified
1. `infrastructure/docker-compose/services/utility.compose.yaml`
   - Added MCP_AUTH_TOKEN environment variable
   - Updated healthcheck timing (5s/3s/10)
   - Added silent flag to curl

2. `infrastructure/docker-compose/services/claim-check.compose.yaml`
   - Added MCP_AUTH_TOKEN environment variable
   - **Fixed healthcheck endpoint** (`/health` → `/healthz`)
   - Updated healthcheck timing (5s/3s/10)
   - Added silent flag to curl

### Created Documentation
1. `planning/sprint-27-6tp11t/DOCKER-AUDIT.md` - Utility service audit
2. `planning/sprint-27-6tp11t/CLAIM-CHECK-FIXES.md` - Claim-check specific fixes
3. `planning/sprint-27-6tp11t/DOCKER-FIXES-SUMMARY.md` - This document

---

## Recommended Follow-Up

### Immediate (This Sprint)
- ✅ Fix utility service
- ✅ Fix claim-check service
- ⏳ Rebuild and test both services in staging
- ⏳ Verify counter tools work end-to-end
- ⏳ Verify progress messages work correctly

### Short-Term (Next Sprint)
- [ ] Audit all remaining services for healthcheck configuration
- [ ] Update service creation template (`bit create`)
- [ ] Document standard healthcheck pattern in CLAUDE.md

### Long-Term (Platform Improvement)
- [ ] Add CI/CD healthcheck endpoint validation
- [ ] Standardize all Docker compose files
- [ ] Consider healthcheck configuration in architecture.yaml

---

## Success Metrics

After deployment, expect:

**Service Health**:
- ✅ Both services healthy within 5-15 seconds
- ✅ No unhealthy status in `docker ps`

**Tool Discovery**:
- ✅ Tool-gateway connects to both services immediately
- ✅ All 12 tools available (6 counter + 6 claim)
- ✅ No 404 errors when calling tools via REST API

**Platform Stability**:
- ✅ Progress messages work reliably
- ✅ Counter tools respond in < 1 second
- ✅ Claim tools respond in < 1 second
- ✅ Clean Docker logs (no curl noise)

---

## Timeline

- **23:30** - Started utility service Docker audit
- **23:35** - Discovered utility issues
- **23:35** - Discovered claim-check has similar issues (plus wrong endpoint!)
- **23:40** - Fixed utility.compose.yaml
- **23:45** - Fixed claim-check.compose.yaml
- **23:45** - Created documentation
- **TBD** - Rebuild and test in staging

---

## Status

**Code**: ✅ Complete
**Documentation**: ✅ Complete
**Testing**: ⏳ Awaiting rebuild
**Priority**: P1 (both services critical)

**Ready for deployment** - All fixes applied and documented.
