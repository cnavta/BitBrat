# Service Health Check Audit

**Date**: 2026-08-27 02:10
**Sprint**: sprint-27-6tp11t
**Investigation**: Health check status for event-stream-analyzer, claim-check, ollama, obs-mcp

---

## Executive Summary

✅ **Network Configuration**: All services on correct network (bitbrat-staging-network)
✅ **3 of 4 services healthy**: event-stream-analyzer, claim-check, ollama
❌ **obs-mcp unhealthy**: Multiple health check configuration issues identified and fixed

---

## Service Status Summary

| Service | Network | Health Check | Status | Issues |
|---------|---------|--------------|--------|--------|
| event-stream-analyzer | ✅ bitbrat-staging-network | curl-based | ✅ Healthy | None |
| claim-check | ✅ bitbrat-staging-network | curl-based | ✅ Healthy | None |
| ollama | ✅ bitbrat-staging-network | None | ✅ Up | None |
| obs-mcp | ✅ bitbrat-staging-network | curl-based | ❌ Unhealthy | 5 issues found |

---

## Network Verification

**All services on correct network** - No network-related issues detected.

```bash
$ docker inspect <service> --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'

event-stream-analyzer-1: bitbrat-staging-network ✅
claim-check-1:           bitbrat-staging-network ✅
ollama-1:                bitbrat-staging-network ✅
obs-mcp-1:               bitbrat-staging-network ✅
```

**Conclusion**: Orchestrator network fixes (Sprint 27) working correctly for all services.

---

## obs-mcp Health Check Issues

### Issue 1: Missing curl Binary

**Problem**: Health check command uses `curl`, but obs-mcp Docker image doesn't include it

**Evidence**:
```
exec: "curl": executable file not found in $PATH
```

**Root Cause**: obs-mcp uses external image (`us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest`), not built from bitbrat-base

**Impact**: All health checks fail immediately

---

### Issue 2: Wrong Port

**Problem**: Health check targets port 3000, but obs-mcp runs on port 8080

**Evidence**:
```bash
# Test port 3000
$ docker exec obs-mcp-1 node -e "http.get('http://localhost:3000/...')"
3000: FAILED  # Connection refused

# Test port 8080
$ docker exec obs-mcp-1 node -e "http.get('http://localhost:8080/...')"
8080: 401 Unauthorized  # Service responding
```

**Container Logs**:
```
[2026-08-28T02:26:16.555Z] LOG: OBS MCP Server running on SSE at http://localhost:8080
```

**Impact**: Even if curl were available, health check would fail due to wrong port

---

### Issue 3: Non-Existent Endpoint

**Problem**: Health check targets `/healthz` endpoint, but it doesn't exist

**Evidence**:
```bash
$ docker exec obs-mcp-1 node -e "http.get('http://localhost:8080/healthz', ...)"
/healthz with auth: 404 Not Found
```

**Available Endpoints** (from logs and testing):
- `/sse` - SSE connection endpoint (200 OK with auth)
- `/messages` - MCP message endpoint (requires POST)

**Impact**: Health check would fail even with correct port and auth

---

### Issue 4: Missing Authentication

**Problem**: All obs-mcp endpoints require MCP_AUTH_TOKEN, health check doesn't include it

**Evidence**:
```bash
# Without auth
$ http.get('http://localhost:8080/sse')
Status: 401 Unauthorized

# With auth
$ http.get('http://localhost:8080/sse', headers: { Authorization: 'Bearer $MCP_AUTH_TOKEN' })
Status: 200 OK
```

**Impact**: Even if all other issues were fixed, health check would fail without authentication header

---

### Issue 5: Incorrect Port Mapping

**Problem**: Docker Compose port mapping targets container port 3000, but service runs on 8080

**Original Configuration**:
```yaml
ports:
  - "${OBS_MCP_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
```

**Actual Service Behavior**:
- Container port: 8080 (hardcoded in obs-mcp image)
- SERVICE_PORT env var: Ignored by obs-mcp

**Impact**: 
- Port mapping ineffective (mapping to wrong port)
- External access to obs-mcp would fail if attempted via host port 3001

---

## Fixes Applied

### File: `infrastructure/docker-compose/services/obs-mcp.compose.yaml`

#### Fix 1: Health Check Command (Lines 22-26)

**Before**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3000/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
```

**After**:
```yaml
healthcheck:
  test: ["CMD", "sh", "-c", "node -e \"const http = require('http'); const options = { hostname: 'localhost', port: 8080, path: '/sse', headers: { 'Authorization': 'Bearer ' + process.env.MCP_AUTH_TOKEN } }; http.get(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); });\""]
  interval: 5s
  timeout: 3s
  retries: 10
```

**Changes**:
- ✅ Use `node` instead of `curl` (available in obs-mcp image)
- ✅ Target port 8080 (correct port)
- ✅ Use `/sse` endpoint (exists and responds 200)
- ✅ Include `Authorization: Bearer $MCP_AUTH_TOKEN` header
- ✅ Exit code 0 on success (200 status), exit code 1 on failure

#### Fix 2: Port Mapping (Line 14)

**Before**:
```yaml
ports:
  - "${OBS_MCP_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
```

**After**:
```yaml
ports:
  - "${OBS_MCP_HOST_PORT:-3001}:8080"
```

**Changes**:
- ✅ Map to actual container port (8080 instead of 3000)
- ✅ Remove SERVICE_PORT env var (not used by obs-mcp)

---

## Verification Plan

### 1. Rebuild and Redeploy obs-mcp

```bash
npm run build
npm run brat -- bit deploy obs-mcp --context staging
```

### 2. Verify Container Health

```bash
ssh root@bitbrat.lan "docker ps | grep obs-mcp"
# Expected: "Up X minutes (healthy)" (NOT "unhealthy")
```

### 3. Check Health Check Logs

```bash
ssh root@bitbrat.lan "docker inspect bitbrat-staging-obs-mcp-1 --format '{{range .State.Health.Log}}{{.Output}}{{end}}' | tail -5"
# Expected: No error messages (exit code 0)
```

### 4. Verify Service Functionality

```bash
# Check tool-gateway connection
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1 | grep obs-mcp | grep connected"
# Expected: mcp.client_manager.connected for obs-mcp
```

---

## Root Cause Analysis

### Why This Happened

1. **Health check template copied from bitbrat-base services**
   - Platform services use curl (available in bitbrat-base image)
   - obs-mcp is external image, doesn't inherit bitbrat-base tools
   - Template not validated against actual image capabilities

2. **Port mismatch not detected during integration**
   - obs-mcp default port (8080) differs from platform standard (3000)
   - SERVICE_PORT env var pattern not enforced/validated
   - No automated port verification in deployment

3. **Endpoint inconsistency**
   - Platform services implement `/healthz` endpoint
   - obs-mcp doesn't (external codebase)
   - No health endpoint contract/validation

4. **Authentication requirement not considered**
   - Platform services have unauthenticated health endpoints
   - obs-mcp requires auth for ALL endpoints (security-first design)
   - Health check pattern assumes no auth needed

---

## Prevention Recommendations

### 1. Health Check Validation

Add automated validation during `bit deploy`:
- [ ] Check if health check command binary exists in image
- [ ] Verify target port matches actual service port
- [ ] Test health check endpoint before deployment
- [ ] Validate auth requirements

### 2. External Image Documentation

For services using external images (not built from bitbrat-base):
- [ ] Document available binaries (for health checks)
- [ ] Document actual service port (not assumed)
- [ ] Document available health endpoints
- [ ] Document authentication requirements

### 3. Health Endpoint Contract

Establish platform-wide contract:
- [ ] All services SHOULD implement `/healthz` (unauthenticated)
- [ ] If unauthenticated health not feasible, document alternative
- [ ] Include health endpoint in service integration checklist

### 4. Port Configuration Validation

Add deployment-time validation:
- [ ] Verify SERVICE_PORT matches actual listening port
- [ ] Warn if port mapping targets non-listening port
- [ ] Auto-detect actual listening ports (if possible)

---

## Impact Assessment

### Before Fix

**obs-mcp status**: Unhealthy (but functionally working)
**Docker orchestration**: May restart container unnecessarily
**Tool-gateway**: Successfully connected (MCP communication working)
**User impact**: Minimal (service was functional despite unhealthy status)

### After Fix

**obs-mcp status**: Healthy (once redeployed)
**Docker orchestration**: Stable container lifecycle
**Monitoring**: Accurate health status reporting
**Port mapping**: Correct external access configuration

---

## Files Modified

### Code Changes

1. **infrastructure/docker-compose/services/obs-mcp.compose.yaml**
   - Line 14: Port mapping 3000 → 8080
   - Lines 22-26: Health check curl → node-based with auth

### Documentation Created

1. **planning/sprint-27-6tp11t/SERVICE-HEALTH-CHECK-AUDIT.md** (this document)

---

## Related Issues

### ORCHESTRATOR-FIXES-VERIFICATION.md

**Issue**: Network mismatches due to ComposeMerger and bulk deployment bugs

**Status**: ✅ Fixed and verified - all services on correct network

**Correlation**: This audit confirmed network fixes working correctly for problem services

---

## Success Criteria

After redeployment:

- ✅ obs-mcp container shows `(healthy)` status
- ✅ Health check logs show no errors
- ✅ Tool-gateway maintains connection to obs-mcp
- ✅ Port 3001 (host) correctly maps to 8080 (container)
- ✅ OBS tools available and functional

---

## Status

**Investigation**: ✅ Complete
**Root Cause**: ✅ Identified (5 issues)
**Fixes**: ✅ Applied (2 files changed)
**Testing**: ⏳ Awaiting redeploy to staging
**Priority**: P1 (health reporting issue, service functional)

**Ready for redeployment** - obs-mcp health check fixes applied and documented.
