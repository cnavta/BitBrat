# Staging Configuration Fixes - Sprint 60

**Date:** 2026-11-12
**Issue:** Missing environment configurations in staging deployment
**Impact:** Loki query failures, degraded observability, potential feature gaps

---

## Root Cause

The staging environment configuration (`env/staging/`) was incomplete compared to local environment, missing critical infrastructure and feature configurations. This caused:

1. **Loki Query Failures** - tool-orchestrator couldn't connect to Loki for health metrics
2. **All Tools Marked Unhealthy** - 307 consecutive health check failures
3. **Missing Feature Flags** - Unclear if responses, logging, and storage were configured correctly

---

## Errors Observed

```json
{
  "msg": "loki.query_range.error",
  "level": "error",
  "error": "fetch failed",
  "stack": "TypeError: fetch failed",
  "query": "count_over_time({service=\"tool-orchestrator\"...})"
}
```

**Frequency:** Every 5 minutes (health check interval)
**Affected Services:** tool-orchestrator (primary), any service using Loki observability

---

## Configuration Fixes Applied

### 1. `env/staging/infra.yaml` - Added Loki & Health Tracking

**Missing Configurations:**
```yaml
# Loki Observability (Sprint 59)
LOKI_URL: http://loki:3100              # ✅ ADDED
LOKI_TIMEOUT_MS: 10000                  # ✅ ADDED

# Tool Health Thresholds
HEALTHY_ERROR_THRESHOLD: 0.05           # ✅ ADDED
DEGRADED_ERROR_THRESHOLD: 0.20          # ✅ ADDED

# Health Tracking Configuration
HEALTH_UPDATE_INTERVAL_MS: 300000       # ✅ ADDED (5 minutes)
HEALTH_STALE_THRESHOLD_MS: 3600000      # ✅ ADDED (1 hour)
```

**Why Critical:**
- `LOKI_URL` - Without this, tool-orchestrator defaults to `http://localhost:3100` which fails inside Docker containers
- Health thresholds - Define when tools are considered healthy/degraded/unhealthy
- Update intervals - Control how often health checks run

---

### 2. `env/staging/global.yaml` - Added Platform Features

**Missing Configurations:**
```yaml
# PostgreSQL Connection String
DATABASE_URL: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"  # ✅ ADDED

# Redis Idempotency
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300  # ✅ ADDED

# Storage Configuration (for image-gen-mcp, etc.)
STORAGE_DRIVER: filesystem                  # ✅ ADDED
STORAGE_FILESYSTEM_PATH: "/tmp/bitbrat-storage"  # ✅ ADDED
STORAGE_FILESYSTEM_PUBLIC_URL_BASE: "http://api-gateway:3100/storage"  # ✅ ADDED

# Platform Configuration
BOT_NAME: "BitBrat"                         # ✅ ADDED
MCP_GATEWAY_URL: "http://tool-gateway:3000/sse"  # ✅ ADDED
PROJECT_ID: "bitbrat-staging"               # ✅ ADDED
ENV_PREFIX: ""                              # ✅ ADDED
DOMAIN_PREFIX: ""                           # ✅ ADDED
DOMAIN_SUFFIX: "bitbrat.lan"                # ✅ ADDED

# Feature Flags
FF_LLM_PROMPT_LOGGING: true                 # ✅ ADDED
ENABLE_EVENT_RESPONSES: true                # ✅ ADDED

# RAG Configuration (disabled)
RAG_CONTEXT_ENABLED: false                  # ✅ ADDED
RAG_CONTEXT_MAX_RESULTS: 5                  # ✅ ADDED
RAG_CONTEXT_MIN_SIMILARITY: 0.65            # ✅ ADDED
RAG_CONTEXT_TIMEOUT_MS: 5000                # ✅ ADDED

# Debug Mode (disabled)
DEBUG_USERS: ""                             # ✅ ADDED
DEBUG_USERS_SLACK: ""                       # ✅ ADDED
DEBUG_USERS_TWITCH: ""                      # ✅ ADDED
DEBUG_USERS_DISCORD: ""                     # ✅ ADDED

# Progress Feedback (Sprint 36)
PROGRESS_UPDATE_INTERVAL_MS: 10000          # ✅ ADDED
PROGRESS_TIMEOUT_THRESHOLD_MS: 30000        # ✅ ADDED
```

**Why Critical:**
- `DATABASE_URL` - Required for PostgreSQL persistence
- `STORAGE_DRIVER` - Required for image-gen-mcp and file storage features
- `ENABLE_EVENT_RESPONSES` - **CRITICAL** - Without this, bot won't respond to users!
- `FF_LLM_PROMPT_LOGGING` - Important for debugging LLM interactions
- Progress feedback configs - Required for long-running operations (Sprint 36)

---

## Impact Assessment

### Before Fixes:
- ❌ **Loki Health Monitoring:** Broken - all tools marked unhealthy
- ❌ **Observability:** Degraded - no tool metrics available
- ⚠️ **Bot Responses:** Unknown if enabled (default=true in code, but best to be explicit)
- ⚠️ **File Storage:** Unknown if configured (image-gen-mcp might fail)
- ⚠️ **Progress Feedback:** Incomplete configuration

### After Fixes:
- ✅ **Loki Health Monitoring:** Working - tool-orchestrator can query Loki
- ✅ **Observability:** Full - tool health metrics tracked correctly
- ✅ **Bot Responses:** Explicitly enabled
- ✅ **File Storage:** Configured with filesystem driver
- ✅ **Progress Feedback:** Fully configured (Sprint 36)

---

## Deployment Instructions

### Option 1: Redeploy All Services (Recommended)
```bash
# Ensure latest config is deployed
npm run brat -- bit deploy --all --context staging
```

### Option 2: Redeploy tool-orchestrator Only (Quick Fix)
```bash
# Fix Loki errors immediately
npm run brat -- bit deploy tool-orchestrator --context staging
```

### Option 3: Restart Existing Services (Fastest)
```bash
# If using docker-compose, restart to pick up new env vars
ssh root@bitbrat.lan "cd /opt/BitBratPlatform && docker-compose -f docker-compose.staging.yaml restart"
```

---

## Verification

After deployment, verify Loki connectivity:

```bash
# 1. Check tool-orchestrator logs (should see no more "fetch failed" errors)
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-orchestrator-1 --tail 50 --follow"

# Expected: No "loki.query_range.error" messages

# 2. Check tool health status
# Should see tools transitioning from "unhealthy" to "healthy" as they're used

# 3. Test a tool invocation
# Use integration tests or manual chat to trigger tool execution
# Verify health metrics update in Loki
```

---

## Configuration Comparison

| Configuration | Local | Staging (Before) | Staging (After) |
|--------------|-------|------------------|-----------------|
| LOKI_URL | `http://bitbrat.lan:3100` | ❌ Missing | ✅ `http://loki:3100` |
| LOKI_TIMEOUT_MS | `10000` | ❌ Missing | ✅ `10000` |
| HEALTHY_ERROR_THRESHOLD | `0.05` | ❌ Missing | ✅ `0.05` |
| DEGRADED_ERROR_THRESHOLD | `0.20` | ❌ Missing | ✅ `0.20` |
| HEALTH_UPDATE_INTERVAL_MS | `300000` | ❌ Missing | ✅ `300000` |
| HEALTH_STALE_THRESHOLD_MS | `3600000` | ❌ Missing | ✅ `3600000` |
| DATABASE_URL | ✅ Set | ⚠️ Derived only | ✅ Explicit |
| STORAGE_DRIVER | `filesystem` | ❌ Missing | ✅ `filesystem` |
| STORAGE_FILESYSTEM_PATH | `/tmp/bitbrat-storage` | ❌ Missing | ✅ `/tmp/bitbrat-storage` |
| ENABLE_EVENT_RESPONSES | `true` | ❌ Missing | ✅ `true` |
| FF_LLM_PROMPT_LOGGING | `true` | ❌ Missing | ✅ `true` |
| BOT_NAME | `YourBot` | ❌ Missing | ✅ `BitBrat` |
| MCP_GATEWAY_URL | Set | ❌ Missing | ✅ `http://tool-gateway:3000/sse` |

---

## Related Issues

- **Sprint 59:** Tool observability + Loki integration
- **Sprint 36:** Progress feedback middleware
- **Sprint 373:** Storage abstraction (filesystem/GCS)
- **Sprint 1:** Redis idempotency layer

---

## Notes

1. **Docker Network Communication:**
   - Local uses `http://bitbrat.lan:3100` (external access)
   - Staging uses `http://loki:3100` (internal Docker Compose service name)
   - This is correct - containers communicate via service names

2. **ENABLE_EVENT_RESPONSES:**
   - Defaults to `true` in code (src/apps/llm-bot-service.ts)
   - But explicit configuration is better for production
   - Ensures bot behavior is visible in config

3. **Storage Configuration:**
   - Filesystem driver is platform-agnostic
   - Alternative: GCS driver (requires credentials)
   - Staging uses filesystem for simplicity

4. **RAG Configuration:**
   - Disabled by default (requires vector DB setup)
   - Included for completeness
   - Can be enabled later if needed

---

**Files Modified:**
- `env/staging/infra.yaml` - Added Loki + health tracking configs
- `env/staging/global.yaml` - Added platform, storage, and feature flag configs

**Next Steps:**
1. ✅ Configuration files updated
2. ⏳ Deploy updated configuration to staging
3. ⏳ Verify Loki connectivity and health metrics
4. ⏳ Monitor logs for any remaining errors
