# Tool-Orchestrator Infrastructure Remediation Plan

**Issue**: tool-orchestrator was generated with outdated infrastructure configuration (pre-Sprint 375)
**Sprint**: Sprint 57
**Date**: 2026-11-09
**Status**: Ready for Implementation

---

## Problem Summary

The `tool-orchestrator` service was created using outdated docker-compose infrastructure patterns that predate Sprint 375's standardization. The service is configured to use a service-specific `Dockerfile.tool-orchestrator` which doesn't exist, instead of the modern shared `Dockerfile.service` approach.

### Current Configuration (WRONG)

**File**: `infrastructure/docker-compose/services/tool-orchestrator.compose.yaml`

```yaml
build:
  context: .                              # ❌ Wrong: Current directory
  dockerfile: Dockerfile.tool-orchestrator # ❌ Wrong: Service-specific Dockerfile (doesn't exist)
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3000}:3000"
environment:
  - NODE_ENV=local
  - BITBRAT_ENV=local
  - PORT=3000
```

**Problems**:
1. ❌ References non-existent `Dockerfile.tool-orchestrator`
2. ❌ Uses current directory (`.`) as build context instead of repository root (`../..`)
3. ❌ Hardcodes PORT instead of using build args
4. ❌ Missing BASE_IMAGE, SERVICE_NAME, SERVICE_ENTRY, SERVICE_PORT args
5. ❌ Missing network alias for service discovery
6. ❌ Doesn't use shared base image from Sprint 375

### Modern Pattern (CORRECT)

**Reference**: All other services (tool-gateway, llm-bot, auth, etc.)

```yaml
build:
  context: ../..  # ✅ Repository root (for Dockerfile.base/Dockerfile.service)
  dockerfile: Dockerfile.service
  args:
    BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}  # ✅ Sprint 375: Shared base image
    SERVICE_NAME: tool-orchestrator
    SERVICE_ENTRY: dist/apps/tool-orchestrator-service.js
    SERVICE_PORT: "3000"
environment:
  - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}  # ✅ Standard env var for MCP services
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"  # ✅ Uses build arg
```

---

## Impact

### Deployment Errors

**Current Error**:
```
failed to solve: failed to read dockerfile: open Dockerfile.tool-orchestrator: no such file or directory
```

**Contexts Affected**:
- ✅ **staging**: Blocked (error encountered)
- ✅ **local**: Likely blocked
- ✅ **agent-dev**: Likely blocked
- ✅ **production**: Would be blocked if deployed

### Scope

- **Single service affected**: tool-orchestrator only
- **All other services**: Using modern approach (20+ services audited)
- **Root cause**: `brat bit create` command using outdated template

---

## Remediation Steps

### Step 1: Update docker-compose Configuration

**File**: `infrastructure/docker-compose/services/tool-orchestrator.compose.yaml`

**Action**: Replace build section

```yaml
# BEFORE (lines 3-5):
build:
  context: .
  dockerfile: Dockerfile.tool-orchestrator

# AFTER:
build:
  context: ../..  # Sprint 375: Build context is repository root (for Dockerfile.base/Dockerfile.service)
  dockerfile: Dockerfile.service
  args:
    BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}  # Sprint 375: Use shared base image
    SERVICE_NAME: tool-orchestrator
    SERVICE_ENTRY: dist/apps/tool-orchestrator-service.js
    SERVICE_PORT: "3000"
```

### Step 2: Update Port Configuration

**File**: Same file

**Action**: Replace hardcoded port with build arg reference

```yaml
# BEFORE (line 7):
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3000}:3000"

# AFTER:
ports:
  - "${TOOL_ORCHESTRATOR_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
```

**Note**: Changed default host port from 3000 to 3001 to match pattern of other services (avoid conflict with postgres/nats/redis)

### Step 3: Add Standard Environment Variables

**File**: Same file

**Action**: Add MCP_AUTH_TOKEN to environment section

```yaml
# BEFORE (lines 8-11):
environment:
  - NODE_ENV=local
  - BITBRAT_ENV=local
  - PORT=3000

# AFTER:
environment:
  - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
```

**Note**: Remove hardcoded PORT (now provided by Dockerfile.service via build args)

### Step 4: Update Healthcheck

**File**: Same file

**Action**: Update healthcheck to match modern pattern

```yaml
# BEFORE (lines 14-17):
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3

# AFTER:
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3000/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

**Changes**:
- ✅ Use `/healthz` endpoint (platform standard)
- ✅ Add `-s` flag to curl (silent mode)
- ✅ Reduce interval from 30s → 5s (faster startup detection)
- ✅ Reduce timeout from 10s → 3s (faster failure detection)
- ✅ Increase retries from 3 → 10 (more resilient to slow starts)

### Step 5: Add Network Alias

**File**: Same file

**Action**: Add service discovery alias

```yaml
# BEFORE (lines 24-25):
networks:
  - bitbrat-network

# AFTER:
networks:
  bitbrat-network:
    aliases:
      - tool-orchestrator.bitbrat.local
```

**Purpose**: Enables service discovery via DNS (e.g., `http://tool-orchestrator.bitbrat.local:3000`)

---

## Complete Updated Configuration

**File**: `infrastructure/docker-compose/services/tool-orchestrator.compose.yaml`

```yaml
services:
  tool-orchestrator:
    env_file:
      - .env.brat
    build:
      context: ../..  # Sprint 375: Build context is repository root (for Dockerfile.base/Dockerfile.service)
      dockerfile: Dockerfile.service
      args:
        BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}  # Sprint 375: Use shared base image
        SERVICE_NAME: tool-orchestrator
        SERVICE_ENTRY: dist/apps/tool-orchestrator-service.js
        SERVICE_PORT: "3000"
    environment:
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
    ports:
      - "${TOOL_ORCHESTRATOR_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/healthz"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      bitbrat-network:
        aliases:
          - tool-orchestrator.bitbrat.local

networks:
  bitbrat-network:
    external: true
```

---

## Verification Plan

### Pre-Remediation Checks

1. **Verify current state fails**:
   ```bash
   npm run brat -- bit deploy tool-orchestrator --context staging
   # Expected: Dockerfile.tool-orchestrator not found
   ```

2. **Backup current config** (optional):
   ```bash
   cp infrastructure/docker-compose/services/tool-orchestrator.compose.yaml \
      infrastructure/docker-compose/services/tool-orchestrator.compose.yaml.bak
   ```

### Post-Remediation Checks

1. **Verify configuration syntax**:
   ```bash
   docker-compose -f infrastructure/docker-compose/services/tool-orchestrator.compose.yaml config
   # Should validate without errors
   ```

2. **Build shared base image** (if not already built):
   ```bash
   docker build -t bitbrat-base:latest -f Dockerfile.base .
   ```

3. **Deploy to staging**:
   ```bash
   npm run brat -- bit deploy tool-orchestrator --context staging
   # Expected: Successful build and deployment
   ```

4. **Verify service starts**:
   ```bash
   docker logs tool-orchestrator | grep "tool_orchestrator.setup.complete"
   # Expected: Setup completion log entry
   ```

5. **Verify healthcheck passes**:
   ```bash
   docker ps | grep tool-orchestrator
   # Expected: Status shows "healthy" (may take up to 50 seconds: 10 retries × 5s interval)
   ```

6. **Verify MCP tools registered**:
   ```bash
   curl -sf http://tool-orchestrator.bitbrat.local:3000/healthz
   # Expected: 200 OK

   # Check logs for MCP tool registration
   docker logs tool-orchestrator | grep "mcp_tools_registration_complete"
   # Expected: toolsRegistered: 4
   ```

7. **Verify network alias**:
   ```bash
   docker exec -it llm-bot ping -c 1 tool-orchestrator.bitbrat.local
   # Expected: Successful DNS resolution
   ```

8. **Test full deployment**:
   ```bash
   npm run brat -- bit deploy --all --context staging
   # Expected: All services deploy successfully, including tool-orchestrator
   ```

---

## Rollback Plan

If remediation causes issues:

```bash
# 1. Stop service
docker stop tool-orchestrator

# 2. Restore backup (if created)
cp infrastructure/docker-compose/services/tool-orchestrator.compose.yaml.bak \
   infrastructure/docker-compose/services/tool-orchestrator.compose.yaml

# 3. Alternative: Revert via git
git checkout infrastructure/docker-compose/services/tool-orchestrator.compose.yaml

# 4. Document issue for further investigation
```

---

## Dependencies

### Required Files (Already Exist)

- ✅ `Dockerfile.base` - Shared base image (Sprint 375)
- ✅ `Dockerfile.service` - Generic service Dockerfile (Sprint 375)
- ✅ `src/apps/tool-orchestrator-service.ts` - Service implementation
- ✅ PostgreSQL migration files (024, 025, 026)
- ✅ Model seed YAML and script

### Environment Variables Required

- ✅ `MCP_AUTH_TOKEN` - MCP authentication (standard for all MCP services)
- ✅ `DATABASE_URL` - PostgreSQL connection (inherited from base config)
- ✅ `NATS_URL` - NATS connection (inherited from base config)

---

## Success Criteria

- ✅ Deployment to staging succeeds without Dockerfile errors
- ✅ Service starts and reaches healthy state
- ✅ MCP tools (4) registered successfully
- ✅ PostgreSQL connection established
- ✅ NATS connection established
- ✅ Network alias resolves correctly
- ✅ Healthcheck endpoint (`/healthz`) responds with 200 OK
- ✅ No regression in other services (bulk deployment succeeds)

---

## Related Issues

- **BUG-2026-11-09-001**: firebase-emulator dependency (✅ Fixed)
- **BUG-2026-11-09-002**: Single-service deployment missing dependencies (Open)
- **BUG-2026-11-09-003**: `brat bit create` generates outdated infra (NEW - see bug report)

---

## Implementation Priority

**Priority**: High
**Blocking**: Yes - Prevents staging/production deployment
**Effort**: 5-10 minutes (configuration update only)
**Risk**: Low - Changes match proven pattern used by 20+ services

---

## Notes

- This remediation only affects docker-compose configuration - no code changes required
- The service implementation (`tool-orchestrator-service.ts`) is correct and production-ready
- All other Sprint 57 deliverables (migrations, registries, MCP tools) are unaffected
- This issue affects ONLY tool-orchestrator; all other services use modern approach
- Root cause is `brat bit create` template being outdated (separate bug BUG-2026-11-09-003)
