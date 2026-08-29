# Docker Deployment Audit: Utility Service

**Date**: 2026-08-27 23:40
**Service**: utility
**Sprint**: sprint-27-6tp11t

---

## Executive Summary

Audit of utility service Docker configuration revealed **3 issues** that need to be addressed:

1. ❌ **Healthcheck timing too slow** (30s interval vs standard 5s)
2. ❌ **Missing silent flag** in healthcheck curl command
3. ⚠️ **Missing explicit MCP_AUTH_TOKEN** environment variable

All other configurations are correct and follow platform standards.

---

## Comparison Matrix

### Healthcheck Configuration

| Service | Endpoint | Interval | Timeout | Retries | Curl Flags | Status |
|---------|----------|----------|---------|---------|------------|--------|
| **auth** | `/healthz` | 5s | 3s | 10 | `-sf` | ✅ Standard |
| **scheduler** | `/healthz` | 5s | 3s | 10 | `-sf` | ✅ Standard |
| **tool-gateway** | `/healthz` | 5s | 3s | 10 | `-sf` | ✅ Standard |
| **claim-check** | `/health` ❌ | 30s | 10s | 3 | `-f` | ⚠️ Wrong endpoint |
| **utility** | `/healthz` | 30s ❌ | 10s ❌ | 3 ❌ | `-f` ❌ | ⚠️ Slow timing |

**Standard Pattern** (recommended):
```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:${PORT}/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

### Environment Variables

| Service | env_file | Explicit Vars | MCP_AUTH_TOKEN | Status |
|---------|----------|---------------|----------------|--------|
| **auth** | `.env.brat` | Yes (3 vars) | ✅ Explicit | ✅ Correct |
| **scheduler** | `.env.brat` | Yes (1 var) | ✅ Explicit | ✅ Correct |
| **tool-gateway** | `.env.brat` | Yes (1 var) | ✅ Explicit | ✅ Correct |
| **claim-check** | `.env.brat` | No | ❌ Via env_file | ⚠️ Should be explicit |
| **utility** | `.env.brat` | No | ❌ Via env_file | ⚠️ Should be explicit |

**Best Practice**: Services with MCP exposure should explicitly set `MCP_AUTH_TOKEN`

---

## Issue 1: Healthcheck Timing Too Slow ❌

**Current Configuration** (utility.compose.yaml:15-19):
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3020/healthz"]
  interval: 30s   # ❌ Too slow
  timeout: 10s    # ❌ Too slow
  retries: 3      # ❌ Too few
```

**Problem**:
- **30-second interval** means it takes up to 30 seconds to detect the service is healthy
- **3 retries** means service marked unhealthy after only 90 seconds of issues
- Slower detection = slower deployments, slower failure detection

**Impact**:
- Tool-gateway may not discover utility service for up to 30 seconds after start
- In the rebuild scenario, this delayed service discovery
- Other services (auth, scheduler, tool-gateway) become healthy in ~15-25 seconds

**Fix**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3020/healthz"]
  interval: 5s    # ✅ Fast detection
  timeout: 3s     # ✅ Quick timeout
  retries: 10     # ✅ More retries before marking unhealthy
```

**Benefit**:
- Service detected as healthy in 5-15 seconds (vs 30+ seconds)
- More resilient to temporary issues (10 retries vs 3)

---

## Issue 2: Missing Silent Flag ❌

**Current**: `curl -f` (fail on HTTP errors only)
**Standard**: `curl -sf` (silent + fail)

**Problem**:
- Without `-s`, curl outputs progress/error messages to Docker logs
- Clutters logs with unnecessary healthcheck output
- All other services use `-sf` for clean logs

**Fix**: Add `-s` flag to curl command

---

## Issue 3: Missing Explicit MCP_AUTH_TOKEN ⚠️

**Current Configuration**:
```yaml
utility:
  env_file:
    - .env.brat
  # No explicit environment section
```

**Standard Pattern** (from scheduler, auth, tool-gateway):
```yaml
scheduler:
  env_file:
    - .env.brat
  environment:
    - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
```

**Why This Matters**:
- Services with MCP exposure (`platform-only` or `platform+domain`) authenticate via MCP_AUTH_TOKEN
- Making it explicit in compose file:
  1. Documents the dependency
  2. Allows environment-specific overrides
  3. Catches missing token earlier (Docker Compose validation)

**Recommendation**: Add explicit `environment` section

---

## Additional Observations ✅

### Correct Configurations

1. **✅ Build Configuration** - Uses Sprint 375 pattern:
   ```yaml
   build:
     context: ../..
     dockerfile: Dockerfile.service
     args:
       BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
       SERVICE_NAME: utility
       SERVICE_ENTRY: dist/apps/utility-service.js
       SERVICE_PORT: "3020"
   ```

2. **✅ Dependencies** - Correctly depends on:
   - `nats` (condition: service_healthy)
   - `redis` (condition: service_healthy)
   - `postgres` (condition: service_healthy)

3. **✅ Networking**:
   - Uses `bitbrat-network`
   - Alias: `utility.bitbrat.local` ✅

4. **✅ Port Mapping**:
   - Uses environment variable for host port: `${UTILITY_HOST_PORT:-3020}:3020`
   - Follows standard pattern

5. **✅ Healthcheck Endpoint**:
   - Uses `/healthz` (correct, not `/health`)
   - Matches base-server.ts implementation

---

## Recommended Fixes

### Fix 1: Update Healthcheck Configuration

**File**: `infrastructure/docker-compose/services/utility.compose.yaml`

**Change** (lines 15-19):
```yaml
# BEFORE
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3020/healthz"]
  interval: 30s
  timeout: 10s
  retries: 3

# AFTER
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3020/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

### Fix 2: Add Explicit Environment Variables

**File**: `infrastructure/docker-compose/services/utility.compose.yaml`

**Add after line 4** (after `env_file`):
```yaml
    env_file:
      - .env.brat
    environment:
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
```

### Fix 3: Consider Fixing claim-check (Separate Issue)

**Note**: While auditing, discovered claim-check has similar issues:
- Uses `/health` instead of `/healthz` ❌
- Slow healthcheck timing (30s interval)
- Missing explicit MCP_AUTH_TOKEN

This should be addressed in a separate fix.

---

## Testing Plan

### Before Deployment

1. **Build Test**:
   ```bash
   docker-compose -f docker-compose.staging.yaml build utility
   ```

2. **Syntax Validation**:
   ```bash
   docker-compose -f docker-compose.staging.yaml config
   ```

### After Deployment

1. **Healthcheck Timing**:
   ```bash
   # Watch container status
   watch -n 1 'docker ps | grep utility'

   # Should show (healthy) within 5-15 seconds
   # Previously took 30+ seconds
   ```

2. **Log Cleanliness**:
   ```bash
   docker logs bitbrat-staging-utility-1 --tail 50

   # Should NOT see curl progress output
   ```

3. **MCP Authentication**:
   ```bash
   # Verify MCP_AUTH_TOKEN is set
   docker exec bitbrat-staging-utility-1 env | grep MCP_AUTH_TOKEN
   ```

4. **Tool Discovery**:
   ```bash
   # Tool-gateway should discover utility faster
   docker logs bitbrat-staging-tool-gateway-1 | grep "utility"

   # Expected: Connection within 5-10 seconds
   ```

---

## Impact Assessment

### Low Risk ✅

- **Healthcheck changes**: Only affects detection speed, not functionality
- **Silent flag**: Cosmetic (log cleanliness)
- **Explicit env var**: Already available via env_file, just making it explicit

### Benefits

1. **Faster Startup**: Service marked healthy 6x faster (5-15s vs 30-90s)
2. **Better Resilience**: 10 retries vs 3 (more tolerant of temporary issues)
3. **Cleaner Logs**: No curl progress noise
4. **Explicit Dependencies**: MCP_AUTH_TOKEN documented in compose file

---

## Deployment Order

1. **Apply fixes to utility.compose.yaml**
2. **Rebuild utility service**:
   ```bash
   docker-compose -f docker-compose.staging.yaml build utility
   ```
3. **Restart utility**:
   ```bash
   docker-compose -f docker-compose.staging.yaml up -d utility
   ```
4. **Monitor healthcheck**:
   ```bash
   watch -n 1 'docker ps | grep utility'
   ```
5. **Verify tool-gateway connection**:
   ```bash
   docker logs bitbrat-staging-tool-gateway-1 --tail 100 | grep utility
   ```

---

## Related Issues

### Platform-Wide Healthcheck Audit Needed

Services using outdated healthcheck patterns:
- **claim-check**: `/health` instead of `/healthz`, slow timing
- Potentially others not checked in this audit

**Recommendation**: Run platform-wide audit to standardize all healthcheck configurations

### Platform-Wide MCP_AUTH_TOKEN Audit

Services with MCP exposure that may need explicit environment variable:
- **claim-check** (platform-only)
- **event-stream-analyzer** (platform-only)
- **persistence** (platform-only)
- Others with `mcp.exposure` set

**Recommendation**: Add explicit `MCP_AUTH_TOKEN` to all MCP-exposed services

---

## Files Changed

### Proposed Changes

**File**: `infrastructure/docker-compose/services/utility.compose.yaml`

**Lines Modified**:
- Line 5 (after): Add `environment:` section
- Lines 16-19: Update healthcheck timing
- Line 16: Add `-s` flag to curl

**Diff**:
```diff
 services:
   utility:
     env_file:
       - .env.brat
+    environment:
+      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
     build:
       context: ../..
       dockerfile: Dockerfile.service
       args:
         BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
         SERVICE_NAME: utility
         SERVICE_ENTRY: dist/apps/utility-service.js
         SERVICE_PORT: "3020"
     ports:
       - "${UTILITY_HOST_PORT:-3020}:3020"
     healthcheck:
-      test: ["CMD", "curl", "-f", "http://localhost:3020/healthz"]
-      interval: 30s
-      timeout: 10s
-      retries: 3
+      test: ["CMD", "curl", "-sf", "http://localhost:3020/healthz"]
+      interval: 5s
+      timeout: 3s
+      retries: 10
     depends_on:
       nats:
         condition: service_healthy
       redis:
         condition: service_healthy
       postgres:
         condition: service_healthy
     networks:
       bitbrat-network:
         aliases:
           - utility.bitbrat.local
```

---

## Summary

**Status**: ⚠️ 3 issues identified, fixes ready

**Priority**:
- **P1**: Healthcheck timing (impacts service discovery speed)
- **P2**: Silent flag (log cleanliness)
- **P3**: Explicit MCP_AUTH_TOKEN (best practice, already works)

**Recommendation**: Apply all fixes before final deployment to avoid any potential discovery delays in production.

**Next Steps**:
1. Apply proposed changes to utility.compose.yaml
2. Test in staging
3. Consider platform-wide healthcheck audit
4. Update claim-check and other services with similar issues
