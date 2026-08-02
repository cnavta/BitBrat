# Quick Reference: brat bit deploy Port Assignment Audit

## The Core Finding

**PortManager is completely bypassed in bulk deployments (`brat bit deploy --all`).**

This creates a port conflict risk that doesn't exist in single-service deployments.

## Side-by-Side Comparison

### Single-Service: `brat bit deploy llm-bot`

```
Flow: BitDeploy.deployServices() → strategy.execute() → DockerOrchestrator.up()

Port handling:
  1. ✅ PortManager.resolvePorts() called with service file paths
  2. ✅ docker ps queried for live ports
  3. ✅ Port assigned: LLM_BOT_HOST_PORT env var
  4. ✅ Env file includes port override
  5. ✅ Docker Compose uses env var: ports: "${LLM_BOT_HOST_PORT}:3000"

Result: Automatic, conflict-free port assignment
```

### Bulk Deployment: `brat bit deploy --all`

```
Flow: BitDeploy.deployServices() → strategy.deployAll() → DockerOrchestrator.up()

Port handling:
  1. ❌ PortManager.resolvePorts() called with EMPTY array
  2. ❌ docker ps NOT queried
  3. ❌ No port assignments generated
  4. ❌ Env file has NO port overrides
  5. ✅ Docker Compose uses hardcoded ports from compose files

Result: Potential port conflicts with existing containers
```

## Why It Happens

**In orchestrator.ts (lines 71-78):**

When `options.composeFile` is provided (bulk deployment):
```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],  // ← Empty array!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(this.options.service, ...);
```

PortManager gets empty array → can't extract service names → no port assignments.

## Impact

| Scenario | Single-Service | Bulk |
|----------|---|---|
| Deploy to host with port 3001 in use | ✅ Auto-assigns 3002 | ❌ Fails with "port in use" |
| Deploy same services twice | ✅ Second gets 3002-3010 | ❌ Both try ports 3000-3010 |
| Multiple agent-dev contexts | ✅ Each gets own ports | ❌ Port conflicts between contexts |
| Explicit `LLM_BOT_HOST_PORT=4000` | ✅ Honored | ❌ Ignored, uses 3000 from compose |

## Workarounds (Current)

Users can work around this with:

1. **--force-recreate flag** (manual, requires knowing about it)
   ```bash
   brat bit deploy --all --force-recreate
   ```

2. **Explicit environment variable** (tedious for multiple services)
   ```bash
   LLM_BOT_HOST_PORT=4000 TOOL_GATEWAY_HOST_PORT=4001 brat bit deploy --all
   ```

3. **Stop old containers first** (manual cleanup)
   ```bash
   docker compose down
   brat bit deploy --all
   ```

## The Fix (High Level)

**Option 1: Simplest - Pass service names to orchestrator**

In `docker-compose-strategy.ts` line 1060, also pass:
```typescript
const orchestratorOptions: DockerOrchestratorOptions = {
  composeFile: composeFilePath,
  servicesToStart: buildableServices,
  allServiceNames: services.map(s => s.name),  // ← Add this
};
```

Then in `orchestrator.ts` writeEnvFile(), use it:
```typescript
let serviceFiles: string[];
if (this.options.allServiceNames) {
  serviceFiles = this.options.allServiceNames.map(name =>
    path.join(this.options.repoRoot, 'infrastructure/docker-compose/services', `${name}.compose.yaml`)
  );
} else {
  serviceFiles = composeFileSet.serviceFiles;
}

const assignments = await this.portManager.resolvePorts(serviceFiles, env, targetConfig);
```

## Files to Modify

```
tools/brat/src/
  ├─ orchestration/
  │  ├─ deployment/docker-compose-strategy.ts  (line ~1060)
  │  └─ docker/orchestrator.ts                 (lines 20, 315-325)
  └─ (no changes needed to port-manager.ts or port.ts)
```

## Test Cases Needed

```typescript
describe('deployAll() port management', () => {
  it('should resolve ports for all services', async () => {
    // Mock docker ps, deploy --all, verify port assignments
  });

  it('should avoid conflicts with running services', async () => {
    // Start nats:3000, deploy --all, verify llm-bot gets 3001
  });

  it('should respect explicit port env vars', async () => {
    // Set LLM_BOT_HOST_PORT=5000, deploy --all, verify it uses 5000
  });

  it('should work with remote deployment', async () => {
    // SSH mock docker ps, deploy --all to remote, verify port discovery
  });
});
```

## References in Codebase

| What | Where |
|------|-------|
| The Gap | `orchestrator.ts` lines 71-78 (empty serviceFiles) |
| PortManager call | `orchestrator.ts` line 318 (receives empty array) |
| Bulk deployment setup | `docker-compose-strategy.ts` line 1069 (orchestrator invocation) |
| PortManager code | `port-manager.ts` lines 57-100 (resolvePorts) |
| Port env var naming | `port-manager.ts` line 72 (service → {SERVICE}_HOST_PORT) |

## Current Behavior (Workaround Explanation)

Bulk deployments work today because:
1. Service-specific compose files have hardcoded ports: `ports: ["3001:3000"]`
2. Docker Compose respects these bindings
3. If ports are free, deployment succeeds
4. If ports are in use, deployment fails with "port already allocated"
5. User must use `--force-recreate` to restart/rebind

This is OK for dev/local but not ideal for staging/shared hosts.

---

**For full details, see DEPLOYMENT_FLOWS_AUDIT.md**
