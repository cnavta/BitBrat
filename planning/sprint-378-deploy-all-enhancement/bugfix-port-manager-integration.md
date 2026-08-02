# Bug #19: Bulk Deployment Missing PortManager Integration

**Status**: Identified - Needs Implementation
**Severity**: High
**Sprint**: 378 (discovered during Day 3 staging validation)
**Date Identified**: 2026-08-01

## Summary

The new `deployAll()` method in `docker-compose-strategy.ts` does not use the existing `PortManager` for automatic port conflict resolution. This causes port conflicts when multiple services use the same default host ports, leading to containers failing to start and not being connected to the Docker network.

## Root Cause

When Sprint 378 introduced bulk deployment (`brat bit deploy --all`), the new `deployAll()` method was implemented without integrating the existing `PortManager` class that handles automatic port assignment.

**Single-service deployments** (orchestrator.ts:318-319):
```typescript
// ✅ Uses PortManager
const assignments = await this.portManager.resolvePorts(composeFileSet.serviceFiles, env, targetConfig);
const portOverrides = this.portManager.getEnvOverrides(assignments);
```

**Bulk deployments** (docker-compose-strategy.ts `deployAll()`):
```typescript
// ❌ Does NOT use PortManager
// Goes straight to merging compose files without resolving ports
```

## Impact

### What Failed

When deploying all services with `brat bit deploy --all`:
- 10 services defaulted to port 3001 (auth, ingress-egress, llm-bot, obs-mcp, oauth-flow, persistence, query-analyzer, scheduler, state-engine, tool-gateway)
- 2 services defaulted to port 8080 (disposition-service, story-engine-mcp, image-gen-mcp)
- 1 service defaulted to port 3000 (reflex)

### Consequences

1. **Port conflicts**: Only first container claiming each port succeeded
2. **Network isolation**: Failed containers were never connected to `bitbrat-network`
3. **DNS resolution failures**: Services without network access couldn't resolve `nats.bitbrat.local`, `postgres.bitbrat.local`
4. **Misleading symptoms**: DNS errors (`EAI_AGAIN`) obscured root cause (port conflicts)

### Services Affected

- **Failed to start** (port conflicts): tool-gateway, auth, llm-bot, persistence, query-analyzer, scheduler, state-engine, disposition-service, reflex, story-engine-mcp, image-gen-mcp
- **Started successfully** (claimed ports first): oauth-flow (3001), stream-analyst-service (8080), context-pack (3000)

## Why Single-Service Deployments Worked

Before Sprint 378, deploying services individually worked because:
1. `DockerOrchestrator.writeEnvFile()` called `portManager.resolvePorts()`
2. PortManager discovered existing container ports
3. PortManager assigned next available port (e.g., if 3001-3005 taken, assigned 3006)
4. No conflicts occurred

## Workaround Applied

Manually configured unique host ports in `env/staging/global.yaml`:

```yaml
AUTH_HOST_PORT: '3004'
DISPOSITION_SERVICE_HOST_PORT: '3014'
IMAGE_GEN_MCP_HOST_PORT: '3017'
INGRESS_EGRESS_HOST_PORT: '3005'
LLM_BOT_HOST_PORT: '3006'
OBS_MCP_HOST_PORT: '3007'
OAUTH_FLOW_HOST_PORT: '3008'
PERSISTENCE_HOST_PORT: '3009'
QUERY_ANALYZER_HOST_PORT: '3010'
REFLEX_HOST_PORT: '3015'
SCHEDULER_HOST_PORT: '3011'
STATE_ENGINE_HOST_PORT: '3012'
STORY_ENGINE_MCP_HOST_PORT: '3016'
TOOL_GATEWAY_HOST_PORT: '3013'
```

This workaround **manually does what PortManager should do automatically**.

## Proper Fix

Integrate PortManager into `deployAll()` method:

### Location
`tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`

### Implementation

```typescript
async deployAll(services: string[], context: ExecutionContext): Promise<void> {
  // ... existing environment resolution ...

  // Sprint 378 Bug #19 FIX: Integrate PortManager for automatic port assignment
  const portManager = new PortManager();
  const serviceFiles = services.map(s =>
    path.join(this.repoRoot, 'infrastructure/docker-compose/services', `${s}.compose.yaml`)
  );

  // Resolve ports: discovers used ports, reads explicit config, auto-assigns for unspecified services
  const assignments = await portManager.resolvePorts(serviceFiles, env, context.deployment.docker);
  const portOverrides = portManager.getEnvOverrides(assignments);

  // Log port assignments for visibility
  console.log(`[docker-compose-strategy] Port assignments:`);
  for (const assignment of assignments) {
    const status = assignment.explicit ? 'explicit' : 'auto-assigned';
    console.log(`  ${assignment.service}: ${assignment.port} (${status})`);
  }

  // Merge port overrides into environment BEFORE generating .env.brat
  Object.assign(env, portOverrides);

  // ... continue with existing merge logic ...
}
```

### Benefits of Proper Fix

1. ✅ **Zero-config deployments**: Works without manual port configuration
2. ✅ **Conflict-free**: Automatically avoids ports in use by running containers
3. ✅ **Consistent behavior**: Bulk and single-service deployments use same logic
4. ✅ **Discoverable**: Logs show which ports were auto-assigned vs explicitly configured
5. ✅ **Remote-aware**: Works for both local Docker and remote SSH deployments

## Testing

### Test Case 1: No Explicit Ports (Auto-Assignment)
```bash
# Remove all *_HOST_PORT from env/staging/global.yaml
brat bit deploy --all --context staging

# Expected: All services get unique auto-assigned ports starting from 3001
# Log should show: "tool-gateway: 3001 (auto-assigned)", "auth: 3002 (auto-assigned)", etc.
```

### Test Case 2: Mixed Explicit/Auto Ports
```bash
# Set only TOOL_GATEWAY_HOST_PORT=5000 in env/staging/global.yaml
brat bit deploy --all --context staging

# Expected:
# - tool-gateway gets explicit port 5000
# - Other services get auto-assigned ports 3001, 3002, etc. (skipping 5000)
```

### Test Case 3: Port Conflict Detection
```bash
# Deploy with one service already running
brat bit deploy tool-gateway --context staging  # Claims port 3001
brat bit deploy --all --context staging

# Expected:
# - tool-gateway keeps 3001 (already running, port already in use)
# - Other services get 3002, 3003, etc.
```

## Related Issues

- **Port defaults inconsistency**: Multiple service compose files use same default ports (3001, 8080, 3000)
  - **Future improvement**: Each service should have unique default port in its compose file
  - **See**: Backlog task for better default port assignments

## References

- **PortManager implementation**: `tools/brat/src/orchestration/docker/port-manager.ts`
- **Single-service deployment (working)**: `tools/brat/src/orchestration/docker/orchestrator.ts:318-319`
- **Bulk deployment (broken)**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` `deployAll()` method
- **Sprint 378 planning**: `planning/sprint-378-deploy-all-enhancement/execution-plan.md`

## Timeline

- **2026-08-01**: Bug discovered during Sprint 378 Day 3 staging validation
- **2026-08-01**: Workaround applied (manual port configuration)
- **2026-08-01**: Bug documented
- **Status**: Awaiting implementation in future sprint

---

**Next Steps:**
1. Implement PortManager integration in `deployAll()`
2. Add test coverage for port auto-assignment
3. Update deployment documentation to mention automatic port resolution
4. Consider improving default ports in service compose files (separate backlog item)
