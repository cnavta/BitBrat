# Claim-Check Docker Configuration Fixes

**Date**: 2026-08-27 23:45
**Service**: claim-check
**Context**: Follow-up to utility service Docker audit

---

## Issues Fixed

### Issue 1: Wrong Healthcheck Endpoint ❌ → ✅ FIXED

**Before**:
```yaml
test: ["CMD", "curl", "-f", "http://localhost:3008/health"]
```

**After**:
```yaml
test: ["CMD", "curl", "-sf", "http://localhost:3008/healthz"]
```

**Why**:
- Base server registers health endpoints at `/healthz`, `/readyz`, `/livez` (not `/health`)
- Using wrong endpoint meant healthcheck was always failing (404)
- Container would be marked unhealthy, preventing tool-gateway discovery

**Impact**:
- Service will now pass healthchecks correctly
- Tool-gateway can discover claim-check tools immediately

---

### Issue 2: Slow Healthcheck Timing ❌ → ✅ FIXED

**Before**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3008/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

**After**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3008/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

**Changes**:
- **Interval**: 30s → 5s (6x faster detection)
- **Timeout**: 10s → 3s (fail faster)
- **Retries**: 3 → 10 (more resilient)
- **Curl flags**: `-f` → `-sf` (silent + fail, cleaner logs)

**Impact**:
- Service detected as healthy in 5-15 seconds (was 30-90 seconds)
- More resilient to temporary issues
- Cleaner Docker logs (no curl progress noise)

---

### Issue 3: Missing Explicit MCP_AUTH_TOKEN ⚠️ → ✅ FIXED

**Before**:
```yaml
claim-check:
  env_file:
    - .env.brat
  # No explicit environment section
```

**After**:
```yaml
claim-check:
  env_file:
    - .env.brat
  environment:
    - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
```

**Why**:
- Claim-check has `mcp.exposure: platform-only` in architecture.yaml
- Services with MCP exposure authenticate via MCP_AUTH_TOKEN
- Explicit declaration documents the dependency and follows platform standard

**Impact**:
- Better documentation
- Matches auth, scheduler, tool-gateway, utility pattern
- Allows environment-specific overrides

---

## Complete Diff

```diff
 services:
   claim-check:
     env_file:
       - .env.brat
+    environment:
+      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
     build:
       context: ../..
       dockerfile: Dockerfile.service
       args:
         BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
         SERVICE_NAME: claim-check
         SERVICE_ENTRY: dist/apps/claim-check-service.js
         SERVICE_PORT: "3008"
     ports:
       - "${CLAIM_CHECK_HOST_PORT:-3008}:3008"
     healthcheck:
-      test: ["CMD", "curl", "-f", "http://localhost:3008/health"]
-      interval: 30s
-      timeout: 10s
-      retries: 3
+      test: ["CMD", "curl", "-sf", "http://localhost:3008/healthz"]
+      interval: 5s
+      timeout: 3s
+      retries: 10
     depends_on:
       nats:
         condition: service_healthy
       redis:
         condition: service_healthy
     networks:
       bitbrat-network:
         aliases:
           - claim-check.bitbrat.local
```

---

## Verification Steps

### After Rebuild

1. **Check Container Health**:
   ```bash
   docker ps | grep claim-check
   # Expected: "Up X seconds (healthy)" within 5-15 seconds
   ```

2. **Verify Healthcheck Endpoint**:
   ```bash
   docker exec bitbrat-staging-claim-check-1 curl -sf http://localhost:3008/healthz
   # Expected: HTTP 200 with health status JSON
   ```

3. **Check MCP_AUTH_TOKEN**:
   ```bash
   docker exec bitbrat-staging-claim-check-1 env | grep MCP_AUTH_TOKEN
   # Expected: MCP_AUTH_TOKEN=<token>
   ```

4. **Verify Tool Registration**:
   ```bash
   docker logs bitbrat-staging-tool-gateway-1 | grep "claim-check" | grep "connected"
   # Expected: mcp.client_manager.connected for claim-check
   ```

5. **Test Claim Tool**:
   ```bash
   # Via REST API (should work after tool-gateway reconnects)
   curl -X POST http://localhost:3000/v1/tools/mcp_claim_event_exists \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -d '{"correlationId":"test-123"}'

   # Expected: Response in < 1 second
   ```

---

## Impact on Platform

### Claim-Check Service

Claim-check provides 6 MCP tools used throughout the platform:
- `claim.event.retrieve` - Retrieve stored events (used by tool-gateway for progress updates)
- `claim.event.status` - Get event metadata
- `claim.event.exists` - Check if event exists
- `claim.blob.store` - Store binary data
- `claim.blob.retrieve` - Retrieve binary data
- `claim.blob.exists` - Check blob existence

**Critical Path**: Tool-gateway uses `claim.event.retrieve` for progress messages (Sprint 22). If claim-check is unhealthy, progress updates fail silently.

### Potential Past Issues

The wrong healthcheck endpoint (`/health` instead of `/healthz`) means claim-check may have been marked unhealthy intermittently, causing:
- Tool-gateway unable to discover claim tools
- Progress messages failing to retrieve source events
- Silent failures in LLM streaming updates

This may explain any historical issues with progress messages not working reliably.

---

## Related Services to Audit

Based on this pattern, other services may have similar issues. Recommend auditing:

### High Priority (MCP-exposed services)
- ✅ **utility** - Fixed (Sprint 27)
- ✅ **claim-check** - Fixed (Sprint 27)
- ⚠️ **event-stream-analyzer** - Check needed
- ⚠️ **persistence** - Check needed
- ⚠️ **query-analyzer** - Check needed
- ⚠️ **state-engine** - Check needed

### Medium Priority (Non-MCP services)
- ⚠️ **reflex** - Check needed
- ⚠️ **event-router** - Check needed
- ⚠️ **disposition-service** - Check needed

### Pattern to Check

1. **Healthcheck endpoint**: Should be `/healthz` (not `/health`)
2. **Healthcheck timing**: Should be `interval: 5s, timeout: 3s, retries: 10`
3. **Curl flags**: Should be `-sf` (not just `-f`)
4. **MCP_AUTH_TOKEN**: Services with `mcp.exposure` should have explicit env var

---

## Timeline

- **23:35** - Discovered claim-check issues during utility audit
- **23:45** - Applied fixes to claim-check.compose.yaml
- **TBD** - Rebuild and verify in staging

---

## Files Changed

**Modified**:
- `infrastructure/docker-compose/services/claim-check.compose.yaml`
  - Added explicit `MCP_AUTH_TOKEN` environment variable
  - Changed healthcheck endpoint from `/health` to `/healthz`
  - Updated healthcheck timing (5s interval, 3s timeout, 10 retries)
  - Added silent flag to curl (`-sf` instead of `-f`)

**Documentation**:
- `planning/sprint-27-6tp11t/CLAIM-CHECK-FIXES.md` (this document)
- `planning/sprint-27-6tp11t/DOCKER-AUDIT.md` (utility audit that discovered claim-check issues)

---

## Success Criteria

After deployment:
- ✅ Container shows `(healthy)` status within 5-15 seconds
- ✅ Healthcheck endpoint returns 200 OK at `/healthz`
- ✅ MCP_AUTH_TOKEN present in container environment
- ✅ Tool-gateway connects to claim-check successfully
- ✅ All 6 claim tools available via REST API
- ✅ Progress messages work reliably (dependent on claim.event.retrieve)

---

## Status

**Code Changes**: ✅ Complete
**Testing**: ⏳ Awaiting rebuild
**Priority**: P1 (claim-check is critical for progress messages)

**Recommendation**: Deploy together with utility service fixes for consistent platform healthcheck behavior.
