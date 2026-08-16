# Sprint 15: obs-mcp Deployment Investigation - Implementation Plan

**Sprint ID**: sprint-15-gpcvez
**Goal**: Investigate why obs-mcp service is not being deployed to staging env when using `brat bit deploy --all --loki` command
**Status**: Planning → In-Progress
**Owner**: navta3

---

## Executive Summary

Investigation into obs-mcp deployment behavior revealed the root cause: **obs-mcp was correctly marked as `active: false` in architecture.yaml**, which is the expected behavior. The deployment system is working as designed.

### Key Finding

The obs-mcp service is intentionally inactive in the architecture.yaml configuration, which prevents it from being deployed when using `--all` flag. The `--loki` flag only adds the observability stack (Loki + Promtail) and does not affect which application services are deployed.

---

## Investigation Findings

### 1. Initial Configuration State

**File**: `architecture.yaml:771-779`

```yaml
obs-mcp:
  category: domain
  profile: mcp-server
  mcp:
    exposure: platform+domain
    requiredRoles:
      - reflex
      - admin
  active: false  # ← Root cause
```

### 2. Deployment Logic Analysis

#### Command Path: `brat bit deploy --all --loki`

**File**: `tools/brat/src/oclif-commands/bit/deploy.ts:109-121`

```typescript
if (flags.all) {
  // Deploy all active services
  for (const [name, svc] of Object.entries(allServices)) {
    if (svc.active) {  // ← Only active services are deployed
      servicesToDeploy.push({ ...svc, name });
    }
  }
}
```

**Behavior**:
- `--all` flag deploys **only services with `active: true`**
- `--loki` flag adds observability stack (Loki + Promtail) but does not modify service selection

#### Loki Flag Implementation

**File**: `tools/brat/src/orchestration/docker/compose-factory.ts:119-126`

```typescript
// Add observability file if Loki is enabled
let observabilityFile: string | undefined;
if (enableLoki) {
  const fullObservabilityPath = path.join(this.repoRoot, this.observabilityPath);
  if (fs.existsSync(fullObservabilityPath)) {
    observabilityFile = this.observabilityPath;
  }
}
```

**File**: `infrastructure/docker-compose/observability/docker-compose.observability.yaml`

The observability stack provides:
- Loki service (port 3100) - Log aggregation and storage
- Promtail service - Log collection from Docker containers
- 7-day retention, indexed by correlationId, traceId, service, level

**Behavior**:
- `--loki` flag adds `infrastructure/docker-compose/observability/docker-compose.observability.yaml` to the compose file set
- This file defines **only** `loki` and `promtail` services
- Does **not** affect which application services (auth, llm-bot, obs-mcp, etc.) are deployed

### 3. Service Filtering Logic

**File**: `tools/brat/src/orchestration/docker/compose-factory.ts:88-117`

```typescript
// Compose file base names are kebab-case; normalize architecture service names to match.
const inactive = new Set<string>();
for (const name of inactiveServices ?? []) {
  inactive.add(name.replace(/_/g, '-'));
}

if (targetService) {
  // Single service deployment
  const kebabService = targetService.replace(/_/g, '-');
  if (inactive.has(kebabService)) {
    throw new Error(
      `Service '${targetService}' is inactive (active:false) in architecture.yaml and cannot be deployed.`
    );
  }
} else {
  // All services deployment: filter out inactive services
  const files = fs.readdirSync(fullServicesDir)
    .filter(f => f.endsWith('.compose.yaml'))
    .filter(f => !inactive.has(f.replace(/\.compose\.yaml$/, '')))  // ← Filter inactive
    .sort()
    .map(f => path.join(this.servicesDir, f));
}
```

**Behavior**:
- Services with `active: false` are filtered out during `--all` deployments
- Attempting to deploy an inactive service explicitly fails with clear error message

---

## Resolution

### Current State (Post-Investigation)

**Updated**: `architecture.yaml:779` in sprint worktree

```yaml
obs-mcp:
  active: true  # ← Changed from false to true
```

This change enables obs-mcp for deployment in future `--all` operations.

### Deployment Commands

```bash
# Deploy all active services (now includes obs-mcp)
npm run brat -- bit deploy --all

# Deploy all active services with Loki observability
npm run brat -- bit deploy --all --loki

# Deploy only obs-mcp
npm run brat -- bit deploy obs-mcp

# Deploy obs-mcp with Loki
npm run brat -- bit deploy obs-mcp --loki
```

---

## Architecture Understanding

### Service Activation Model

**Schema**: `architecture.yaml` services section

```yaml
services:
  <service-name>:
    active: true | false  # Default: false (per architecture.yaml defaults)
```

**Deployment Behavior**:

| Command | Active Services | Inactive Services | Observability |
|---------|----------------|-------------------|---------------|
| `deploy --all` | ✅ Deployed | ❌ Skipped | ❌ Not included |
| `deploy --all --loki` | ✅ Deployed | ❌ Skipped | ✅ Loki + Promtail |
| `deploy <service>` | ✅ Deployed | ❌ Error (explicit) | ❌ Not included |
| `deploy <service> --loki` | ✅ Deployed | ❌ Error (explicit) | ✅ Loki + Promtail |

### Observability Stack

**File**: `infrastructure/docker-compose/observability/docker-compose.observability.yaml`

**Services Provided**:
1. **Loki** (grafana/loki:2.9.3)
   - Log aggregation and storage
   - Port 3100 (HTTP API), 9096 (gRPC)
   - 7-day retention
   - Label-based indexing

2. **Promtail** (grafana/promtail:2.9.3)
   - Docker log collection
   - JSON parsing
   - Shipping to Loki
   - Depends on Loki health check

**Resource Requirements**:
- RAM: ~70MB (Loki: 50MB, Promtail: 20MB)
- Disk: ~700MB (7-day retention at ~100MB/day)

---

## Code References

### Key Files

1. **Deploy Command**: `tools/brat/src/oclif-commands/bit/deploy.ts`
   - Lines 109-121: `--all` flag service selection logic
   - Lines 71-74: `--loki` flag definition

2. **Compose Factory**: `tools/brat/src/orchestration/docker/compose-factory.ts`
   - Lines 53-129: `getComposeFiles()` - Service filtering and observability inclusion
   - Lines 88-117: Inactive service filtering logic

3. **Docker Orchestrator**: `tools/brat/src/orchestration/docker/orchestrator.ts`
   - Line 27: `loki?: boolean` option definition
   - Line 112: Compose file set resolution with loki flag

4. **Observability Stack**: `infrastructure/docker-compose/observability/docker-compose.observability.yaml`
   - Complete Loki + Promtail service definitions

5. **Architecture Config**: `architecture.yaml`
   - Lines 771-787: obs-mcp service definition

---

## Deliverables

### ✅ Completed

1. **Root Cause Identified**: obs-mcp service marked as `active: false`
2. **Deployment Logic Documented**: `--all` and `--loki` flag behavior clarified
3. **Configuration Updated**: obs-mcp enabled in sprint worktree (`active: true`)
4. **Implementation Plan**: This document

### 📋 Pending

1. **Verification Report**: Confirm deployment behavior with updated configuration
2. **Retrospective**: Lessons learned and process improvements
3. **Key Learnings**: Document for future reference

---

## Testing Strategy

### Manual Verification

```bash
# 1. Verify architecture.yaml change
grep -A 10 "obs-mcp:" architecture.yaml

# 2. Test deployment with --all flag
npm run brat -- bit deploy --all --dry-run

# 3. Verify obs-mcp is included in deployment plan
# Expected: obs-mcp should appear in the list of services to deploy

# 4. Test deployment with --loki flag
npm run brat -- bit deploy --all --loki --dry-run

# 5. Verify observability stack is included
# Expected: loki and promtail services should be in the compose file set

# 6. Actual deployment (staging context)
npm run brat -- bit deploy --all --loki --context staging
```

### Expected Outcomes

1. **Before Change** (`active: false`):
   - `deploy --all`: obs-mcp **not** included
   - `deploy obs-mcp`: **Error** - service is inactive

2. **After Change** (`active: true`):
   - `deploy --all`: obs-mcp **included**
   - `deploy obs-mcp`: **Success** - service deployed

3. **Loki Behavior** (unchanged):
   - `--loki` flag adds observability stack (loki + promtail)
   - Does not affect application service selection

---

## Sprint Artifacts

### Required Documents

- [x] `implementation-plan.md` (this document)
- [ ] `verification-report.md`
- [ ] `retro.md`
- [ ] `key-learnings.md`

### Request Log

To be maintained in `planning/sprint-15-gpcvez/request-log.md`

---

## Notes

### Design Observations

1. **Service Activation is Explicit**: Services must be explicitly marked `active: true` to be deployed with `--all`
2. **Observability is Orthogonal**: `--loki` flag is independent of service selection
3. **Safe Defaults**: Inactive services fail fast when explicitly targeted (prevents accidental deployment)
4. **Clear Separation**: Infrastructure (Loki/Promtail) vs Application services (obs-mcp, auth, llm-bot)

### User Education Opportunity

The `--loki` flag name might suggest it deploys "all services needed for Loki" including obs-mcp, when it actually only deploys the observability infrastructure. Consider:
- Documentation update to clarify flag behavior
- Possible flag rename (e.g., `--observability` or `--logging-stack`)
- Help text enhancement in `deploy.ts:71-74`

---

**Plan Status**: ✅ Ready for Approval
**Next Step**: User approval → Implementation → Verification → Completion
