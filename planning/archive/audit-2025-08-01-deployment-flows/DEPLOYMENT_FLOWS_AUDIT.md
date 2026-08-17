# Comprehensive Audit Report: `brat bit deploy` Port Assignment Flows

## Executive Summary

This audit examines how port assignment works in the `brat bit deploy` command across both single-service and bulk (`--all`) deployment modes. The analysis reveals a critical gap: **PortManager is currently used ONLY in single-service deployments via DockerOrchestrator.writeEnvFile(). The bulk deployment flow (deployAll) completely bypasses PortManager.**

## 1. Current State Analysis: Where PortManager IS Used

### 1.1 Single-Service Deployment Flow

**Path:** `brat bit deploy <service>` (without `--all`)

```
BitDeploy.run()
  ├─ deployServices() [lines 188-253 in deploy.ts]
  │  └─ strategy.prepare() → strategy.validate() → strategy.execute()
  │     └─ DockerComposeStrategy.execute() [lines 187-372]
  │        └─ DockerOrchestrator(orchestratorOptions)
  │           └─ DockerOrchestrator.up() [lines 58-224]
  │              ├─ prepare() [lines 711-752]
  │              ├─ writeEnvFile() [lines 315-361]
  │              │  ├─ portManager.resolvePorts(composeFileSet.serviceFiles, env, targetConfig)
  │              │  │  ├─ discoverUsedPorts(targetConfig) → docker ps probe
  │              │  │  ├─ First pass: explicit ports from {SERVICE}_HOST_PORT env vars
  │              │  │  └─ Second pass: implicit ports from available range
  │              │  └─ portManager.getEnvOverrides(assignments) → generates {SERVICE}_HOST_PORT vars
  │              └─ Merges port overrides into env file
  │
  └─ Calls strategy.execute() which delegates to DockerOrchestrator.up()
```

**Key Code Points:**

1. **Line 318 in orchestrator.ts**: Port resolution happens in writeEnvFile()
```typescript
const assignments = await this.portManager.resolvePorts(
  composeFileSet.serviceFiles, 
  env, 
  targetConfig
);
const portOverrides = this.portManager.getEnvOverrides(assignments);
```

2. **Line 325**: Port overrides are merged into env
```typescript
const mergedEnv: Record<string, string | number | boolean> = {
  ...env,
  ...portOverrides,        // <<< Port assignments injected here
  COMPOSE_PROJECT_NAME: composeProjectName
};
```

3. **Port Resolution Logic (port-manager.ts):**
   - Discovers live ports via `docker ps` (lines 21-55)
   - First pass: Reads explicit `{SERVICE}_HOST_PORT` environment variables
   - Second pass: Assigns free ports starting from 3001
   - Returns assignments and env overrides

### 1.2 PortManager Interface

**Location:** `tools/brat/src/orchestration/docker/port-manager.ts`

**Public Methods:**
- `resolvePorts(serviceFiles, env, targetConfig?)` → Promise<PortAssignment[]>
  - Queries live container ports on target (local or remote via SSH)
  - Processes explicit ports from env vars
  - Assigns implicit ports avoiding conflicts
  
- `getEnvOverrides(assignments)` → Record<string, string>
  - Generates `{SERVICE}_HOST_PORT` env var overrides for implicit ports only

**Data Structure:**
```typescript
interface PortAssignment {
  service: string;
  port: number;
  explicit: boolean;  // true if from env var, false if auto-assigned
}
```

## 2. Gap Analysis: Where PortManager is NOT Used

### 2.1 Bulk Deployment Flow (--all flag)

**Path:** `brat bit deploy --all`

```
BitDeploy.run()
  ├─ if (flags.all && strategy.supportsBulkDeployment)
  │  │  [line 166 in deploy.ts]
  │  └─ strategy.deployAll(servicesToDeploy, resolvedContext, deployOptions)
  │     │
  │     └─ DockerComposeStrategy.deployAll() [lines 595-1112]
  │        ├─ STAGE 1: Read base compose file (docker-compose.local.yaml)
  │        ├─ STAGE 2: Collect service-specific compose files
  │        ├─ STAGE 3: Iteratively merge service-specific files
  │        ├─ STAGE 4: Collect and validate secureFiles
  │        ├─ STAGE 5: Process secureFiles (volume mounts, SCP transfer)
  │        ├─ STAGE 6: Inject image tags for buildable services
  │        ├─ STAGE 7: Write temporary merged compose file
  │        ├─ STAGE 8: Execute orchestrator with merged compose file
  │        │  └─ DockerOrchestrator(orchestratorOptions)
  │        │     ├─ options.composeFile = tempMergedPath    [line 1059]
  │        │     ├─ options.servicesToStart = buildableServices [line 1060]
  │        │     └─ orchestrator.up()
  │        │        └─ writeEnvFile() [lines 315-361]
  │        │           ├─ getComposeFiles() -> returns EMPTY serviceFiles! [line 317]
  │        │           │  (because options.composeFile is provided, not service names)
  │        │           └─ portManager.resolvePorts([], env, targetConfig)
  │        │              └─ Processes ZERO service files [line 318]
  │        │
  │        └─ STAGE 9: Cleanup temporary merged file
  │
  └─ NO PORT ASSIGNMENT HAPPENS!
```

**The Critical Gap (Line 317-318 in orchestrator.ts):**

```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],              // <<< EMPTY!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(this.options.service, ...);

// ...later in writeEnvFile():
const assignments = await this.portManager.resolvePorts(
  composeFileSet.serviceFiles,  // <<< This is EMPTY for bulk deployments!
  env,
  targetConfig
);
```

**Why it fails:**

1. PortManager.resolvePorts() expects an array of compose file paths
2. For bulk deployments, options.composeFile is provided directly (merged file path)
3. composeFileSet.serviceFiles is intentionally empty (no individual service files)
4. PortManager can't extract service names from empty array
5. **Result: NO port assignments are generated for bulk deployments**

### 2.2 Current Bulk Deployment Port Handling

Despite the PortManager gap, bulk deployments DO work because:

1. **Services define explicit ports in architecture.yaml** (line port: 3000, 3001, etc.)
2. **Service-specific compose files use these ports directly**
   - Example: `infrastructure/docker-compose/services/llm-bot.compose.yaml`
   - Ports are hardcoded in compose files, not in env overrides
3. **Docker Compose handles port binding** based on ports: section
4. **Manual port conflicts require --force-recreate flag**

**This is problematic because:**
- Hardcoded ports in compose files mean port conflicts if deployed to shared hosts
- No live port discovery (like single-service deployments have)
- --force-recreate is a workaround, not a solution
- Multiple deployments to same host (e.g., multiple agent-dev contexts) will conflict

## 3. Code Flow Diagrams

### 3.1 Single-Service Deployment (WITH Port Management)

```
User: brat bit deploy llm-bot

    [BitDeploy.run]
           |
           v
    [Select service: llm-bot]
           |
           v
    [Create DockerComposeStrategy]
           |
           v
    [strategy.prepare(llm-bot, context, options)]
           |
           v
    [strategy.validate(plan)]
           |
           v
    [strategy.execute(plan)]
           |
           v
    [DockerOrchestrator.up()]
           |
           +--- [prepare()] 
           |       └─> Load arch, context, env
           |
           +--- [writeEnvFile()]
           |       |
           |       +--- [getComposeFiles('llm-bot')] 
           |       |     └─> ['infrastructure/docker-compose/services/llm-bot.compose.yaml']
           |       |
           |       +--- [portManager.resolvePorts(['llm-bot.compose.yaml'], env, targetConfig)]
           |       |     |
           |       |     +--- [discoverUsedPorts(targetConfig)]
           |       |     |     └─> docker ps → {3001, 3002, 3003, ...}
           |       |     |
           |       |     +--- First pass: check LLM_BOT_HOST_PORT env var
           |       |     |     └─> Not found (implicit assignment)
           |       |     |
           |       |     +--- Second pass: find next free port
           |       |     |     └─> Start at 3001, skip used ports
           |       |     |     └─> Assign llm-bot → 3004
           |       |     |
           |       |     └─> Return [{service: 'llm-bot', port: 3004, explicit: false}]
           |       |
           |       +--- [getEnvOverrides(assignments)]
           |       |     └─> {LLM_BOT_HOST_PORT: '3004'}
           |       |
           |       +--- Merge env: {...globalEnv, LLM_BOT_HOST_PORT: '3004', ...}
           |       |
           |       └─> Write .env.brat with port override
           |
           +--- [buildBaseImage()]
           |
           +--- [executeDockerCompose(..., ['up', '-d', '--build', 'llm-bot'])]
           |     └─> docker compose -f docker-compose.local.yaml \
           |         --env-file .env.brat \
           |         up -d --build llm-bot
           |
           └─> Container binds to localhost:3004 (from LLM_BOT_HOST_PORT)


    OUTPUT: llm-bot running on localhost:3004
```

### 3.2 Bulk Deployment (WITHOUT Port Management) - THE GAP

```
User: brat bit deploy --all

    [BitDeploy.run]
           |
           v
    [Select all active services: llm-bot, tool-gateway, auth, ...]
           |
           v
    [Create DockerComposeStrategy]
           |
           v
    [strategy.deployAll([llm-bot, tool-gateway, auth, ...], context, options)]
           |
           ├─ STAGE 1: Read infrastructure/docker-compose/docker-compose.local.yaml
           ├─ STAGE 2: Collect service-specific compose files
           ├─ STAGE 3: Merge all compose files into one
           ├─ STAGE 4-6: Process secureFiles, inject image tags
           ├─ STAGE 7: Write .docker-compose.merged.yaml (all services in one file)
           |
           └─ STAGE 8: Execute orchestrator
               |
               [DockerOrchestrator.up()]
               |
               +--- [prepare()]
               |
               +--- [writeEnvFile()]
               |       |
               |       +--- [getComposeFiles(options.service=undefined)]
               |       |     └─> Because options.composeFile is set!
               |       |     └─> Returns {baseFile, serviceFiles: [], targetService: undefined}
               |       |
               |       +--- [portManager.resolvePorts([], env, targetConfig)]
               |       |     └─> ZERO service files!
               |       |     └─> No port assignments generated!
               |       |     └─> Returns []
               |       |
               |       +--- [getEnvOverrides([])]
               |       |     └─> Returns {} (empty)
               |       |
               |       └─> Write .env.brat with NO port overrides
               |
               +--- [executeDockerCompose(..., ['up', '-d', '--build'])]
               |     └─> docker compose -f .docker-compose.merged.yaml \
               |         --env-file .env.brat \
               |         up -d --build
               |
               └─> Services use hardcoded ports from compose files
                   (POTENTIAL CONFLICTS: all services bind to defined ports)


    PROBLEM: If other services are running on ports 3000-3010,
    new deployment will fail with "port already in use"
```

## 4. Port Assignment Logic Details

### 4.1 PortManager.resolvePorts() Algorithm

**Input:**
- `serviceFiles: string[]` - Array of compose file paths
- `env: Record<string, any>` - Current environment variables
- `targetConfig?: any` - Docker host config (for remote port discovery)

**Process:**

```
Step 1: Discover Live Ports
  if (targetConfig provided)
    if (SSH remote)
      docker ps via SSH → parse port mappings
    else (local)
      docker ps locally → parse port mappings
  usedPorts = Set{3001, 3002, 3005, 3008, ...}

Step 2: First Pass - Explicit Ports from Environment
  for each serviceFile:
    serviceName = basename(serviceFile) without .compose.yaml
    envVarName = uppercase(serviceName).replace(/[^A-Z0-9]/g, '_') + '_HOST_PORT'
    
    if env[envVarName] exists:
      assignments.push({service: serviceName, port: parseInt(env[envVarName]), explicit: true})
      usedPorts.add(port)
    else:
      assignments.push({service: serviceName, port: -1, explicit: false})

Step 3: Second Pass - Implicit Ports
  nextFreePort = 3001
  for each assignment where explicit=false:
    while (usedPorts.has(nextFreePort)):
      nextFreePort++
    assignment.port = nextFreePort
    usedPorts.add(nextFreePort)
    nextFreePort++

Step 4: Generate Env Overrides
  for each assignment where explicit=false:
    overrides['{SERVICE}_HOST_PORT'] = assignment.port

Return {assignments, overrides}
```

**Example:**

```
Input serviceFiles:
  - infrastructure/docker-compose/services/llm-bot.compose.yaml
  - infrastructure/docker-compose/services/tool-gateway.compose.yaml
  - infrastructure/docker-compose/services/auth.compose.yaml

Input env:
  TOOL_GATEWAY_HOST_PORT=4000  (explicit)
  LOG_LEVEL=debug

Running services (docker ps):
  nats:3000, postgres:5432

Step 1 result: usedPorts = {3000, 4000, 5432}

Step 2 result:
  assignments = [
    {service: 'llm-bot', port: -1, explicit: false},
    {service: 'tool-gateway', port: 4000, explicit: true},
    {service: 'auth', port: -1, explicit: false}
  ]

Step 3 result (nextFreePort=3001):
  llm-bot: skip 3000 (used), skip 4000 (used), skip 5432 (used) → assign 3001
  (skip 3001, now 3002) → tool-gateway already explicit → skip
  auth: skip 3002 (used), skip 4000 (used), skip 5432 (used) → assign 3002

Hmm that's wrong, let me recalculate:
  nextFreePort = 3001
  llm-bot (implicit):
    - 3001 not in usedPorts → assign 3001
    - usedPorts.add(3001)
    - nextFreePort = 3002
  tool-gateway (explicit: 4000): skip
  auth (implicit):
    - 3002 not in usedPorts → assign 3002
    - usedPorts.add(3002)

Final assignments:
  llm-bot → 3001
  tool-gateway → 4000 (from env)
  auth → 3002

Env overrides:
  LLM_BOT_HOST_PORT=3001
  AUTH_HOST_PORT=3002
  (tool-gateway not overridden because explicit)
```

### 4.2 Port Variable Naming Convention

Service name transformation: `llm-bot` → `LLM_BOT_HOST_PORT`

```typescript
// From port-manager.ts line 72
const upperSvc = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const portVar = `${upperSvc}_HOST_PORT`;
```

Examples:
- `llm-bot` → `LLM_BOT_HOST_PORT`
- `tool-gateway` → `TOOL_GATEWAY_HOST_PORT`
- `auth` → `AUTH_HOST_PORT`
- `config-service` → `CONFIG_SERVICE_HOST_PORT`

## 5. Integration Points & Gaps

### 5.1 Integration Points Summary

| Component | Single-Service | Bulk Deployment | Status |
|-----------|---|---|---|
| **BitDeploy CLI** | strategy.execute() | strategy.deployAll() | Different paths |
| **DockerComposeStrategy** | Delegates to DockerOrchestrator | Orchestrates all logic in-house | Inconsistent |
| **DockerOrchestrator** | Creates temp env with ports | Receives options.composeFile | Bypassed in bulk |
| **PortManager** | Called in writeEnvFile() | NEVER CALLED | **GAP** |
| **Port discovery** | Live via docker ps | Hardcoded in compose | **Missing** |
| **Port conflicts** | Handled automatically | Manual --force-recreate | **Workaround** |

### 5.2 Gap Details

**Where the gap occurs (orchestrator.ts):**

```typescript
// Lines 71-78: When options.composeFile is set, serviceFiles becomes EMPTY
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],              // ← EMPTY for bulk deployments!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(this.options.service, ...);

// Later in writeEnvFile() line 317-318:
const composeFileSet = this.composeFactory.getComposeFiles(this.options.service, ...);
const assignments = await this.portManager.resolvePorts(
  composeFileSet.serviceFiles,  // ← Passes EMPTY array!
  env,
  targetConfig
);
```

**Result:** PortManager can't extract service names from empty array, so no port assignments are generated.

### 5.3 Bulk Deployment Port Assignment Workarounds

Current workarounds that mask the gap:

1. **Hardcoded ports in compose files**
   - Services define ports: `3000`, `3001`, `3002` directly
   - No flexibility for multiple deployments

2. **--force-recreate flag**
   - User must pass `--force-recreate` to restart stopped containers
   - Frees up ports before redeploying
   - Not automatic or discoverable

3. **Manual environment variable override**
   - User can set `LLM_BOT_HOST_PORT=3004` before deployment
   - Requires knowledge of variable naming convention
   - Single-variable changes; doesn't help with multiple conflicts

4. **Single context per port range**
   - agent-dev contexts can't coexist with same port bindings
   - Workaround: use separate Docker namespaces or remote machines

## 6. Proposed Integration Points

### 6.1 Option A: Integrate PortManager into deployAll()

**Modify DockerComposeStrategy.deployAll() to:**

```typescript
// After STAGE 7 (before writing merged compose file)

// Extract service names from merged compose YAML
const mergedCompose = yaml.load(mergedYaml);
const serviceNames = Object.keys(mergedCompose.services || {});

// Create pseudo-compose file paths for PortManager
const pseudoServiceFiles = serviceNames.map(name => 
  path.join(repoRoot, 'infrastructure/docker-compose/services', `${name}.compose.yaml`)
);

// Resolve ports using existing PortManager
const portManager = new PortManager();
const assignments = await portManager.resolvePorts(
  pseudoServiceFiles,
  context.runtime.envVars || {},
  targetConfig
);

const portOverrides = portManager.getEnvOverrides(assignments);

// Inject port overrides into environment before orchestrator.up()
```

### 6.2 Option B: Extract PortManager to Strategy Level

**Create new interface in DockerComposeStrategy:**

```typescript
async resolveBulkPorts(
  services: ServiceWithName[],
  context: ResolvedContext,
  targetConfig?: any
): Promise<Record<string, string>> {
  // Extract service names
  const serviceNames = services.map(s => s.name);
  
  // Create compose file paths
  const serviceFiles = serviceNames.map(name =>
    path.join(process.cwd(), 'infrastructure/docker-compose/services', `${name}.compose.yaml`)
  );
  
  // Call PortManager
  const portManager = new PortManager();
  const assignments = await portManager.resolvePorts(
    serviceFiles,
    context.runtime.envVars || {},
    targetConfig
  );
  
  return portManager.getEnvOverrides(assignments);
}
```

### 6.3 Option C: Modify DockerOrchestrator to Extract Service Names

**Enhance orchestrator to support bulk deployment:**

```typescript
export interface DockerOrchestratorOptions {
  // ... existing options ...
  
  // Sprint XXX: For bulk deployments, provide list of all service names
  // so PortManager can resolve ports even when using custom composeFile
  allServiceNames?: string[];
}

// In writeEnvFile():
let serviceFiles: string[];

if (this.options.allServiceNames) {
  // Bulk deployment: reconstruct pseudo-paths from service names
  serviceFiles = this.options.allServiceNames.map(name =>
    path.join(this.options.repoRoot, 'infrastructure/docker-compose/services', `${name}.compose.yaml`)
  );
} else {
  // Single-service deployment: get actual paths
  serviceFiles = composeFileSet.serviceFiles;
}

const assignments = await this.portManager.resolvePorts(serviceFiles, env, targetConfig);
```

## 7. Other Deployment Strategies

### 7.1 Cloud Run Strategy

**Status:** No port management needed

**Why:** 
- Cloud Run doesn't use fixed host ports
- Each service gets a unique HTTPS URL
- Internal port (3000) is mapped internally
- No port conflicts possible

**Code:** `cloud-run-strategy.ts` lines 49-183
- Doesn't use PortManager
- Doesn't need to (Cloud Run handles networking)
- Not affected by this audit

### 7.2 Kubernetes Strategy (Future)

**Status:** Not yet implemented

**Expected impact:**
- K8s uses Services with dynamic port allocation
- Will likely NOT use PortManager
- Ports managed by K8s ingress/service mesh
- Similar to Cloud Run: global port management, not host-local

## 8. Testing Impact

### 8.1 Current Test Coverage

**Single-service deployment tests:**
- Located: `tools/brat/src/orchestration/docker/orchestrator.default.spec.ts`
- Status: Tests PortManager integration indirectly
- Coverage: Partial (port manager mocked in most tests)

**Bulk deployment tests:**
- Located: `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts` (lines 255+)
- Status: Doesn't test port assignment at all
- Coverage: Zero for port management
- Tests only verify file merging and orchestrator invocation

### 8.2 Recommended Test Additions

```typescript
describe('deployAll() port management - Sprint XXX', () => {
  it('should resolve ports for all services during bulk deployment', async () => {
    // Test that PortManager is called with all service names
    // Test that port assignments are injected into env
    // Test that env file contains {SERVICE}_HOST_PORT overrides
  });

  it('should avoid port conflicts when deploying multiple services', async () => {
    // Mock docker ps to return used ports
    // Deploy all services
    // Verify each gets unique port
  });

  it('should respect explicit port env vars during bulk deployment', async () => {
    // Set LLMBOT_HOST_PORT=5000 in env
    // Deploy with --all
    // Verify llm-bot uses port 5000, others auto-assigned
  });

  it('should handle remote port discovery during bulk deployment', async () => {
    // Mock SSH docker ps
    // Deploy with remote context
    // Verify ports discovered from remote containers
  });
});
```

## 9. Findings Summary

### 9.1 Critical Issues

1. **PortManager is completely bypassed in bulk deployments**
   - Impact: Port conflicts when deploying multiple services
   - Severity: High
   - Workaround exists but is manual

2. **No live port discovery in bulk mode**
   - Impact: Can't detect conflicts with services outside Docker Compose
   - Severity: Medium
   - Affects: deployments to shared hosts

3. **Hardcoded ports in compose files**
   - Impact: Multiple deployments to same host will conflict
   - Severity: High
   - Affects: agent-dev contexts, staging environments

### 9.2 Design Inconsistencies

1. **Two different deployment paths with different capabilities**
   - Single-service: Automatic port management
   - Bulk: Manual/hardcoded ports

2. **PortManager designed for single-service, not bulk**
   - Takes array of compose file paths (works for 1, breaks for many)
   - No way to pass service names directly

3. **DockerOrchestrator doesn't know about bulk deployments**
   - Receives options.composeFile but loses service context
   - Can't reconstruct which services are being deployed

### 9.3 Positive Findings

1. **Port discovery implementation is robust**
   - Handles local and remote (SSH) targets
   - Falls back gracefully if docker daemon unavailable
   - Correctly parses docker ps output format

2. **Port assignment algorithm is sound**
   - Respects explicit env var overrides
   - Auto-assigns avoiding conflicts
   - Tracks used ports across multiple services

3. **Single-service flow works well**
   - Port management is automatic
   - No user configuration needed
   - Remote deployments work correctly

## 10. Code References

### 10.1 Key File Locations

| File | Lines | Purpose |
|------|-------|---------|
| `tools/brat/src/oclif-commands/bit/deploy.ts` | 1-255 | CLI command, routes to single/bulk |
| `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` | 1-1138 | Strategy implementation, contains deployAll() |
| `tools/brat/src/orchestration/docker/orchestrator.ts` | 1-857 | Orchestrator, contains writeEnvFile() with PortManager call |
| `tools/brat/src/orchestration/docker/port-manager.ts` | 1-112 | PortManager implementation |
| `tools/brat/src/fleet/docker-ports.ts` | 1-137 | Port discovery for fleet commands |

### 10.2 Critical Code Sections

**Gap location (orchestrator.ts lines 71-78):**
```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],              // ← EMPTY for bulk
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(this.options.service, ...);
```

**PortManager call (orchestrator.ts line 318):**
```typescript
const assignments = await this.portManager.resolvePorts(
  composeFileSet.serviceFiles,  // ← Receives empty array in bulk mode
  env,
  targetConfig
);
```

**Bulk deployment orchestrator invocation (docker-compose-strategy.ts line 1069):**
```typescript
const orchestrator = new DockerOrchestrator(orchestratorOptions);
await orchestrator.up();
// No port assignment happens before or after this call
```

---

## Appendix A: Port Assignment Variable Names

Service name → environment variable mapping:

| Service | Variable | Example Value |
|---------|----------|---|
| `llm-bot` | `LLM_BOT_HOST_PORT` | `3001` |
| `tool-gateway` | `TOOL_GATEWAY_HOST_PORT` | `3002` |
| `event-router` | `EVENT_ROUTER_HOST_PORT` | `3003` |
| `auth-service` | `AUTH_SERVICE_HOST_PORT` | `3004` |
| `config-service` | `CONFIG_SERVICE_HOST_PORT` | `3005` |

---

## Appendix B: Environment File Structure

Generated `.env.brat` file contains:

```bash
# From global.yaml
NODE_ENV=development
LOG_LEVEL=debug
DATABASE_URL=postgres://localhost/bitbrat
PERSISTENCE_DRIVER=postgres
MESSAGE_BUS_DRIVER=nats

# Port assignments (single-service only currently)
LLM_BOT_HOST_PORT=3001
TOOL_GATEWAY_HOST_PORT=3002

# Compose project name
COMPOSE_PROJECT_NAME=bitbrat-local
```

---

**Report Generated:** 2025-08-01
**Audit Scope:** Full deployment flow analysis
**Coverage:** Single-service + Bulk deployments, PortManager usage, integration points
