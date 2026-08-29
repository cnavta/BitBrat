# Compose Merger Network Fix

**Date**: 2026-08-27 01:55
**Sprint**: sprint-27-6tp11t
**Issue**: ComposeMerger losing network alias configuration during merge
**Priority**: P0 (platform bug affecting all context-specific deployments)

---

## Root Cause

The `ComposeMerger` class was NOT preserving top-level network definitions from the base compose file when merging service-specific overrides.

### The Problem

**Base File** (`docker-compose.staging.yaml`):
```yaml
networks:
  bitbrat-network:
    driver: bridge
    name: bitbrat-staging-network  # ✅ Correct network alias
```

**After Merge** (`.docker-compose.merged.yaml`):
```yaml
networks:
  bitbrat-network:
    external: false
    name: bitbrat-network  # ❌ Wrong - lost the alias!
```

### Impact

Services deployed with the merged compose file ended up on the WRONG Docker network:
- **Expected**: `bitbrat-staging-network` (from context-specific compose)
- **Actual**: `bitbrat-network` (default network name)

**Result**: Services on different networks cannot communicate, causing:
- MCP tool calls timing out (tool-gateway ↔ utility)
- Service discovery failures
- DNS resolution working but connections failing
- Earlier "docker down" issue (containers on wrong network not cleaned up)

---

## Analysis

### ComposeMerger Flow

1. **Parse** base compose file (docker-compose.staging.yaml)
2. **Parse** service-specific compose file (utility.compose.yaml)
3. **Merge** service definitions (build, env, volumes, networks, etc.)
4. **Call** `mergeTopLevelVolumes(baseCompose, serviceCompose)`
5. **Call** `yaml.dump(baseCompose)` to serialize
6. **Write** merged YAML back to base file path

### The Bug

Step 4 called `mergeTopLevelVolumes` to preserve volume definitions but did NOT call an equivalent `mergeTopLevelNetworks` to preserve network definitions.

When `yaml.dump()` serialized the baseCompose object, it auto-generated a default networks section based on service-level network references, LOSING the original network configuration from the base file.

### Why It Happened

`ComposeMerger` was created in Sprint 375 to support secureFiles volume mounts. It added `mergeTopLevelVolumes` to preserve volume definitions but FORGOT to add an equivalent method for networks.

---

## The Fix

### Code Changes

**File**: `tools/brat/src/orchestration/docker/compose-merger.ts`

**Added method** `mergeTopLevelNetworks`:

```typescript
/**
 * Merge top-level networks from base and service compose files.
 *
 * **Sprint 27:** Preserves network aliases from context-specific compose files
 * (e.g., docker-compose.staging.yaml with `name: bitbrat-staging-network`).
 *
 * Service-specific compose files may reference networks but should NOT override
 * the base file's network definitions (driver, name, external, etc.).
 *
 * **Precedence:** Base file network definitions always take precedence.
 * Service file networks are only added if not already defined in base.
 *
 * @param baseCompose - Base compose file to modify
 * @param serviceCompose - Service override file with potential network references
 */
private mergeTopLevelNetworks(baseCompose: ComposeFile, serviceCompose: ComposeFile): void {
  // Skip if service file has no top-level networks
  if (!serviceCompose.networks || typeof serviceCompose.networks !== 'object') {
    return;
  }

  // Initialize networks section in base if missing
  if (!baseCompose.networks) {
    baseCompose.networks = {};
  }

  // Merge networks from service file into base
  const baseNetworks = baseCompose.networks as Record<string, unknown>;
  const serviceNetworks = serviceCompose.networks as Record<string, unknown>;

  for (const [networkName, networkConfig] of Object.entries(serviceNetworks)) {
    // Only add if not already in base (base takes precedence)
    if (!baseNetworks[networkName]) {
      baseNetworks[networkName] = networkConfig;
    }
  }
}
```

**Updated merge paths** (2 locations):

```typescript
// Path 1: Service doesn't exist in base (lines 190-193)
this.mergeAdditionalServices(baseCompose, serviceCompose, serviceName);
this.mergeTopLevelVolumes(baseCompose, serviceCompose);
this.mergeTopLevelNetworks(baseCompose, serviceCompose);  // ← ADDED

// Path 2: Service exists in both files (lines 261-267)
this.mergeAdditionalServices(baseCompose, serviceCompose, serviceName);
this.mergeTopLevelVolumes(baseCompose, serviceCompose);
this.mergeTopLevelNetworks(baseCompose, serviceCompose);  // ← ADDED
```

---

## Verification Plan

### 1. Rebuild and Deploy

```bash
# 1. Build with fix
npm run build

# 2. Deploy utility service (test case that triggered issue)
npm run brat -- bit deploy utility --context staging

# 3. Verify network assignment
ssh root@bitbrat.lan "docker inspect bitbrat-staging-utility-1 --format \
  '{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}'"
# Expected: bitbrat-staging-network
```

### 2. Verify Merged Compose File

```bash
# Check merged compose on remote
ssh root@bitbrat.lan "grep -A 5 '^networks:' /opt/bitbrat-staging/.docker-compose.merged.yaml"

# Expected:
# networks:
#   bitbrat-network:
#     driver: bridge
#     name: bitbrat-staging-network  # ✅ Should preserve alias now
```

### 3. Test MCP Communication

```bash
# Wait for services to start
sleep 15

# Check tool-gateway connects to utility
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 --tail 30 | grep utility"

# Expected: mcp.client_manager.connected for utility
```

### 4. Test Counter Tools End-to-End

```bash
# Via REST API (tool-gateway)
curl -X POST http://bitbrat.lan:3013/v1/tools/mcp_counter_increment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"name":"test","delta":1,"scopeType":"global","scopeValue":"test"}'

# Expected: Response in < 1 second (no timeout)
```

---

## Impact Analysis

### Services Affected

**All services deployed via `brat bit deploy --context <context>`** where the context uses a context-specific compose file with network aliases.

### Contexts Affected

- ✅ **staging**: `bitbrat-network` → `bitbrat-staging-network`
- ✅ **production** (if exists): `bitbrat-network` → `bitbrat-production-network` (likely)
- ❌ **local**: Uses literal `bitbrat-network` (no alias), not affected
- ✅ **agent-dev-***: May use network aliases, potentially affected

### Symptoms

1. **MCP tool timeouts** - Services on different networks cannot communicate
2. **Service discovery failures** - DNS works but connections fail
3. **Docker down leaving containers** - Compose file mismatch between up/down
4. **Intermittent failures** - Some services on correct network, others wrong

---

## Related Issues

### DOCKER-DOWN-ISSUE.md

Earlier issue where `docker down` left 5 containers running:
- utility, claim-check, event-stream-analyzer, obs-mcp, ollama

**Root cause**: Same issue - compose file used for `down` had wrong network configuration, so Docker couldn't find/remove containers on the actual network they were running on.

### NETWORK-MISMATCH-ANALYSIS.md

Investigation that led to discovering this root cause:
- Tool-gateway on `bitbrat-staging-network` (correct)
- Utility on `bitbrat-network` (wrong)
- DNS resolution worked but connections timed out

---

## Prevention

### Code Review Checklist

When adding new top-level compose sections (networks, volumes, configs, secrets):
- [ ] Add corresponding `mergeTopLevel{Section}` method
- [ ] Call method in BOTH merge paths (service exists/doesn't exist)
- [ ] Ensure base file configuration takes precedence
- [ ] Add tests for merge behavior

### Testing

- [ ] Add unit tests for `mergeTopLevelNetworks`
- [ ] Add integration test for context-specific network aliases
- [ ] Verify merged compose files in CI/CD pipeline

---

## Success Criteria

After fix:
- ✅ Merged compose files preserve network aliases from base file
- ✅ All services deployed to correct Docker network
- ✅ MCP tool calls complete in < 5 seconds
- ✅ `docker down` removes all containers cleanly
- ✅ No more network mismatch issues

---

## Files Changed

### Modified
1. `tools/brat/src/orchestration/docker/compose-merger.ts`
   - Added `mergeTopLevelNetworks()` method (lines 396-432)
   - Updated merge path 1 to call `mergeTopLevelNetworks()` (line 193)
   - Updated merge path 2 to call `mergeTopLevelNetworks()` (line 267)

### Documentation Created
1. `planning/sprint-27-6tp11t/COMPOSE-MERGER-NETWORK-FIX.md` (this document)
2. `planning/sprint-27-6tp11t/NETWORK-MISMATCH-ANALYSIS.md` (root cause investigation)
3. `planning/sprint-27-6tp11t/DOCKER-DOWN-ISSUE.md` (related issue)

---

## Timeline

- **01:15** - Discovered MCP tool timeout (utility ↔ tool-gateway)
- **01:20** - Traced to network mismatch (different Docker networks)
- **01:30** - Investigated Docker compose configurations
- **01:37** - Found networks section in docker-compose.staging.yaml
- **01:42** - Discovered merged file had wrong network configuration
- **01:45** - Identified ComposeMerger as root cause
- **01:50** - Implemented fix (mergeTopLevelNetworks method)
- **01:55** - Build successful, ready for testing

---

## Status

**Code**: ✅ Complete
**Build**: ✅ Successful
**Testing**: ⏳ Awaiting deployment verification
**Priority**: P0 (platform bug)

**Ready for testing** - Fix applied and documented.
