# Implementation Plan: obs-mcp Deployment Fix

**Sprint**: sprint-17-btnxhl
**Goal**: Investigate and fix why obs-mcp service is recognized but not deployed when running 'brat bit deploy --all'
**Lead Implementor**: Claude Code
**Created**: 2026-08-17

## Problem Analysis

### Root Cause
The obs-mcp service is recognized during deployment orchestration but never actually deployed. Analysis of the deployment logs and code reveals:

1. **obs-mcp appears in port resolution** (line in logs: `Services for port resolution: oauth-flow, ingress-egress, auth, query-analyzer, event-router, llm-bot, persistence, obs-mcp, scheduler, ...`)

2. **obs-mcp does NOT appear in buildable services** (line in logs shows 21 buildable services, obs-mcp is not listed)

3. **obs-mcp uses a pre-built image** from Google Artifact Registry (`us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest`) rather than being built from source

4. **The deployment logic only includes services with a `build` section** in the compose file (see `docker-compose-strategy.ts:1188-1212`)

### Key Code Location
`tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:1188-1212`

```typescript
// STAGE 8: Extract buildable services from merged compose file
const buildableServices: string[] = [];
const infrastructureServices = InfrastructureRegistry.getInfrastructureServices(
  repoRoot,
  context.name
);

if (mergedCompose?.services && typeof mergedCompose.services === 'object') {
  for (const [serviceName, serviceConfig] of Object.entries(mergedCompose.services)) {
    const service = serviceConfig as any;
    // Include services that have a build section OR are infrastructure services
    if (service && typeof service === 'object') {
      if (service.build != null || infrastructureServices.includes(serviceName)) {
        buildableServices.push(serviceName);
      }
    }
  }
}
```

**Problem**: Services with `image:` but no `build:` section are excluded from deployment.

### Impact
- obs-mcp is never started during bulk deployments (`brat bit deploy --all`)
- obs-mcp is properly configured in architecture.yaml and has a service-specific compose file
- obs-mcp would work if deployed individually, but bulk deployment skips it

## Solution

### Option 1: Include All Services in Merged Compose (RECOMMENDED)
Modify the buildable services extraction logic to include ALL services present in the merged compose file, regardless of whether they have a `build` section.

**Rationale**:
- Services with `image:` (pre-built) still need to be started by `docker compose up`
- The current logic conflates "buildable" (needs docker build) with "startable" (needs docker compose up)
- The variable name `buildableServices` is misleading - it should really be `servicesToStart`

**Changes**:
1. Rename `buildableServices` → `servicesToStart` for clarity
2. Include all services in the merged compose file (both `build` and `image` services)
3. Update logs to reflect this change

### Option 2: Add obs-mcp to InfrastructureRegistry
Add obs-mcp to the infrastructure services list so it's included via the existing `infrastructureServices.includes(serviceName)` check.

**Rationale**: Doesn't fix the root cause; obs-mcp is not infrastructure

### Option 3: Add Explicit Handling for Image-Only Services
Create a separate category for image-only services and explicitly include them.

**Rationale**: More complex than Option 1

## Implementation Steps

1. **Update docker-compose-strategy.ts** (`deployAll` method, lines 1180-1212):
   - Rename `buildableServices` → `servicesToStart`
   - Change extraction logic to include all services in merged compose
   - Update console logs to use new terminology
   - Update comments to clarify distinction between "needs build" vs "needs start"

2. **Update orchestrator.ts** (if needed):
   - Check if DockerOrchestrator expects `servicesToStart` parameter
   - Verify it handles both build and image-only services correctly

3. **Test with agent-dev context**:
   - Provision agent-dev environment
   - Run `brat bit deploy --all --context agent-dev-xxx`
   - Verify obs-mcp appears in "services to start" list
   - Verify obs-mcp container is created and running
   - Check obs-mcp logs for successful startup

4. **Create sprint artifacts**:
   - Implementation plan (this document)
   - Request log
   - Verification report
   - Retrospective

## Acceptance Criteria

- [ ] obs-mcp appears in deployment logs as a service to start
- [ ] obs-mcp container is created and running after `brat bit deploy --all`
- [ ] obs-mcp health check passes
- [ ] Other services (with `build` sections) continue to work correctly
- [ ] Code changes are well-documented with inline comments
- [ ] Solution tested in agent-dev environment

## Files to Modify

1. `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` (primary fix)
2. Potentially `tools/brat/src/orchestration/docker/orchestrator.ts` (if parameter name changes)

## Risk Assessment

**Low Risk**:
- Change is minimal (include all services instead of filtering)
- Docker Compose already knows the difference between build and image services
- No breaking changes to architecture.yaml or service configs
- Can be validated in agent-dev before staging

## Timeline

- Investigation: ✅ Complete
- Implementation: ~30 minutes
- Testing: ~15 minutes
- Documentation: ~15 minutes
- **Total**: ~1 hour

## References

- architecture.yaml obs-mcp definition (uses `image:` not `build:`)
- infrastructure/docker-compose/services/obs-mcp.compose.yaml
- tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:1188-1212
- User logs showing obs-mcp recognized but not deployed
