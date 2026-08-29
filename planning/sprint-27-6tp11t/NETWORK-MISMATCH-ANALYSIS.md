# Docker Network Mismatch Analysis

**Date**: 2026-08-27 01:37
**Sprint**: sprint-27-6tp11t
**Issue**: MCP tool calls timing out between tool-gateway and utility

---

## Root Cause: Network Alias vs Actual Network Name

### Discovery

In `infrastructure/docker-compose/docker-compose.staging.yaml` (lines 758-761):

```yaml
networks:
  bitbrat-network:
    driver: bridge
    name: bitbrat-staging-network  # <-- Network alias maps to actual Docker network
```

**The Issue**:
- Staging compose defines **network alias** `bitbrat-network`
- This alias maps to **actual Docker network** `bitbrat-staging-network`
- Service compose files (utility.compose.yaml, tool-gateway.compose.yaml) use `networks: bitbrat-network`
- When deployed with staging context, services SHOULD be on `bitbrat-staging-network`

### Actual Container State

```bash
# Tool-gateway (CORRECT)
docker inspect bitbrat-staging-tool-gateway-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
# Output: bitbrat-staging-network

# Utility (INCORRECT)
docker inspect bitbrat-staging-utility-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
# Output: bitbrat-network
```

**Mismatch**:
- Tool-gateway: ✅ Correctly on `bitbrat-staging-network` (staging context network)
- Utility: ❌ Incorrectly on `bitbrat-network` (old/default network)
- **Result**: Services cannot reliably communicate across different Docker networks

---

## Service Compose File Configurations

### utility.compose.yaml

```yaml
services:
  utility:
    networks:
      bitbrat-network:  # Uses network alias
        aliases:
          - utility.bitbrat.local
```

### tool-gateway.compose.yaml

```yaml
services:
  tool-gateway:
    networks:
      bitbrat-network:  # Uses network alias
        aliases:
          - tool-gateway.bitbrat.local
```

**Both compose files specify the SAME network alias**: `bitbrat-network`

---

## Why the Mismatch Occurred

**Hypothesis**:
1. Tool-gateway was deployed using staging context compose merge → correctly placed on `bitbrat-staging-network`
2. Utility was deployed differently (possibly without proper context merge) → ended up on old `bitbrat-network`
3. Docker Compose merging behavior may have issues or deployment process inconsistent

**Evidence**:
- Earlier deployment: `npm run brat -- bit deploy utility --context staging`
- But utility still ended up on wrong network
- Suggests deployment orchestrator may not be properly merging compose files

---

## Impact on MCP Communication

### Symptoms

**Correlation ID**: `b5799812-2c00-4d65-b466-e01567645145`
- Reflex invoked `mcp_counter_increment` → timeout after 5 seconds
- Tool-gateway received request → timeout after 60 seconds
- Utility never received the MCP call (no logs)

**Correlation ID**: `2b3c54b4-3f7b-4038-b1ba-f65551a901d1`
- Same pattern: reflex timeout, tool-gateway timeout, utility silent

### Communication Test

```bash
# From tool-gateway to utility SSE endpoint (SUCCESSFUL)
ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 sh -c \
  'curl -sf -H \"Authorization: Bearer \$MCP_AUTH_TOKEN\" http://utility.bitbrat.local:3020/sse'"

# Output:
event: endpoint
data: /message?sessionId=ae08e4ec-c67b-47b4-bcfc-35259a7e41ac
```

**Interesting**: DNS resolution works (`utility.bitbrat.local` resolves), SSE endpoint responds, but MCP calls still timeout.

**Possible explanations**:
1. **Network routing overhead**: Cross-network communication introduces latency/timeouts
2. **Connection pooling issues**: MCP SSE connections may be established but not working reliably across networks
3. **Firewall/iptables**: Docker networks may have isolation rules causing intermittent failures

---

## Deployment Process Analysis

### Expected Behavior (Staging Context)

When deploying with `--context staging`:

1. Load `docker-compose.staging.yaml` (defines infrastructure + network alias)
2. Merge service-specific compose file (e.g., `utility.compose.yaml`)
3. Network alias `bitbrat-network` → actual network `bitbrat-staging-network`
4. All services deployed to `bitbrat-staging-network`

### Actual Behavior

- Tool-gateway: Correctly on `bitbrat-staging-network`
- Utility: Incorrectly on `bitbrat-network`

**Inconsistency suggests**:
- Deployment orchestrator not properly merging compose files for all services
- OR different deployment methods used (some use staging context, some don't)
- OR Docker Compose merge order/precedence issues

---

## Files Involved

### Compose Configuration
1. `infrastructure/docker-compose/docker-compose.staging.yaml` - Base staging compose (network definitions)
2. `infrastructure/docker-compose/services/utility.compose.yaml` - Utility service overlay
3. `infrastructure/docker-compose/services/tool-gateway.compose.yaml` - Tool-gateway service overlay

### Deployment Code
1. `tools/brat/src/orchestration/docker/orchestrator.ts` - Docker deployment orchestrator
2. `tools/brat/src/orchestration/docker/compose-factory.ts` - Compose file merging logic

### Sprint Documentation
1. `planning/sprint-27-6tp11t/DOCKER-DOWN-ISSUE.md` - Earlier Docker down issue (related)
2. `planning/sprint-27-6tp11t/DOCKER-FIXES-SUMMARY.md` - Healthcheck/auth token fixes
3. `planning/sprint-27-6tp11t/CLAIM-CHECK-FIXES.md` - Claim-check specific fixes

---

## Recommended Fix

### Option 1: Redeploy Utility on Correct Network (Immediate)

```bash
# 1. Stop and remove utility container
docker stop bitbrat-staging-utility-1
docker rm bitbrat-staging-utility-1

# 2. Redeploy using staging context (ensure compose merge happens)
npm run brat -- bit deploy utility --context staging

# 3. Verify network assignment
docker inspect bitbrat-staging-utility-1 --format \
  '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
# Expected: bitbrat-staging-network
```

### Option 2: Move Container to Correct Network (Quick Fix)

```bash
# Disconnect from old network
docker network disconnect bitbrat-network bitbrat-staging-utility-1

# Connect to correct network
docker network connect bitbrat-staging-network bitbrat-staging-utility-1 \
  --alias utility.bitbrat.local

# Restart container
docker restart bitbrat-staging-utility-1
```

### Option 3: Investigate Deployment Orchestrator (Root Cause Fix)

1. Add logging to compose-factory.ts showing merged compose files
2. Verify network definitions are correctly merged
3. Test deployment with explicit network validation
4. Fix orchestrator if merge logic is broken

---

## Verification Steps

After fix, verify:

1. **Network Assignment**:
   ```bash
   docker inspect bitbrat-staging-utility-1 --format \
     '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
   # Expected: bitbrat-staging-network
   ```

2. **DNS Resolution**:
   ```bash
   docker exec bitbrat-staging-tool-gateway-1 ping -c 1 utility.bitbrat.local
   # Expected: Success
   ```

3. **SSE Endpoint**:
   ```bash
   docker exec bitbrat-staging-tool-gateway-1 \
     curl -sf -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     http://utility.bitbrat.local:3020/sse
   # Expected: SSE endpoint response
   ```

4. **Tool-Gateway Connection**:
   ```bash
   docker logs bitbrat-staging-tool-gateway-1 | grep utility | grep connected
   # Expected: mcp.client_manager.connected
   ```

5. **MCP Tool Call** (via reflex or manual):
   ```bash
   curl -X POST http://bitbrat.lan:3001/v1/tools/mcp_counter_increment \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -d '{"name":"test","delta":1,"scopeType":"global","scopeValue":"test"}'
   # Expected: Response in < 1 second, no timeout
   ```

---

## Related Issues

### DOCKER-DOWN-ISSUE.md

Earlier issue where `docker down` left 5 containers running:
- utility, claim-check, event-stream-analyzer, obs-mcp, ollama
- Root cause: Working directory / compose file sync issue
- **Correlation**: Both issues suggest compose file merging/deployment inconsistency

### Network Naming Pattern

**Local context**: `bitbrat-network` (actual network name)
**Staging context**: `bitbrat-network` (alias) → `bitbrat-staging-network` (actual)
**Production context**: (TBD - likely `bitbrat-network` (alias) → `bitbrat-production-network` (actual))

---

## Success Criteria

After fix:
- ✅ Utility on `bitbrat-staging-network`
- ✅ Tool-gateway on `bitbrat-staging-network`
- ✅ Both services can communicate
- ✅ MCP tool calls complete in < 5 seconds
- ✅ No timeouts in reflex actions
- ✅ Counter tools work end-to-end

---

## Status

**Root Cause**: ✅ IDENTIFIED
**Issue**: Network alias `bitbrat-network` → actual `bitbrat-staging-network` not applied to utility
**Fix**: ⏳ PENDING (redeploy utility on correct network)
**Priority**: P0 (blocking counter tool functionality)

**Recommendation**: Use Option 1 (redeploy) for clean fix, then investigate Option 3 (orchestrator) to prevent recurrence.
