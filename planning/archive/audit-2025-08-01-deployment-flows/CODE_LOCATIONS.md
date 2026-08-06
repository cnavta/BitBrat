# Code Locations & Exact References

## The Gap Locations

### 1. PRIMARY GAP: Empty serviceFiles Array

**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Lines:** 71-78
**Severity:** CRITICAL

```typescript
export class DockerOrchestrator {
  constructor(private readonly options: DockerOrchestratorOptions) {
    // ...
  }

  public async up(): Promise<void> {
    const { arch, targetConfig, envName, contextName, securePath } = await this.prepare();
    // ... 
    
    // Sprint 378: Use custom compose file if provided (for bulk deployments)
    const composeFileSet = this.options.composeFile
      ? {
          baseFile: this.options.composeFile,
          serviceFiles: [],              // ← THIS IS THE GAP
          targetService: undefined,
        }
      : this.composeFactory.getComposeFiles(this.options.service, inactiveServices, this.options.loki);
    
    // ... rest of method
  }
```

**Why this happens:**
- When `options.composeFile` is provided (bulk deployments only)
- The code explicitly sets `serviceFiles: []` because it's already using the merged file path
- PortManager can't extract service names from empty array

---

### 2. CONSEQUENCE: PortManager Gets Empty Array

**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Lines:** 315-361 (writeEnvFile method)
**Key lines:** 317-318

```typescript
private async writeEnvFile(
  envName: string, 
  targetConfig: any, 
  contextName?: string, 
  securePath?: string
): Promise<string> {
  const env = this.envResolver.resolve(envName, securePath);
  
  // Sprint 378: Use custom compose file if provided (for bulk deployments)
  const composeFileSet = this.composeFactory.getComposeFiles(
    this.options.service,  // ← undefined for bulk deployments
    undefined, 
    this.options.loki
  );
  
  // ← THIS IS WHERE EMPTY ARRAY GETS PASSED
  const assignments = await this.portManager.resolvePorts(
    composeFileSet.serviceFiles,  // ← EMPTY for bulk!
    env, 
    targetConfig
  );
  
  const portOverrides = this.portManager.getEnvOverrides(assignments);
  
  // No port overrides generated from empty assignments
  const mergedEnv: Record<string, string | number | boolean> = {
    ...env,
    ...portOverrides,              // ← Empty object for bulk deployments
    COMPOSE_PROJECT_NAME: composeProjectName
  };
  
  // ... rest of method (writeFile, etc.)
}
```

**Flow:**
1. Line 317: `getComposeFiles(undefined, ...)` returns empty serviceFiles
2. Line 318: `portManager.resolvePorts([], env, targetConfig)` gets empty array
3. Line 319: `getEnvOverrides([])` returns empty object
4. Line 325: Merges empty overrides into env

---

### 3. WHERE BULK DEPLOYMENT CALLS ORCHESTRATOR

**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Lines:** 1055-1070
**Sprint:** 378

```typescript
async deployAll(
  services: ServiceWithName[],
  context: ResolvedContext,
  options: DeployOptions
): Promise<DeploymentResult[]> {
  const startTime = Date.now();
  const repoRoot = process.cwd();
  
  // ... STAGE 1-7 (building merged compose file) ...
  
  // STAGE 8: Extract buildable services from merged compose file
  const mergedCompose = yaml.load(mergedYaml) as any;
  const buildableServices: string[] = [];
  
  if (mergedCompose?.services && typeof mergedCompose.services === 'object') {
    for (const [serviceName, serviceConfig] of Object.entries(mergedCompose.services)) {
      const service = serviceConfig as any;
      if (service && typeof service === 'object' && service.build != null) {
        buildableServices.push(serviceName);
      }
    }
  }
  
  // STAGE 9: Execute orchestrator with merged compose file
  let composeFilePath = tempMergedPath;
  if (isRemote) {
    const remoteDir = context.deployment!.docker!.remoteDir || '/opt/BitBratPlatform';
    composeFilePath = `${remoteDir}/.docker-compose.merged.yaml`;
  }
  
  const orchestratorOptions: DockerOrchestratorOptions = {
    repoRoot,
    context: context.name,
    service: undefined,                // ← Undefined (no single service)
    composeFile: composeFilePath,      // ← Custom merged file (triggers gap!)
    servicesToStart: buildableServices, 
    dryRun: options.dryRun || false,
    forceRecreate: options.forceRecreate || false,
    noCache: options.forceBuild || false,
    rebuildBase: options.rebuildBase || false,
    loki: options.loki || false,
    noDeps: options.noDeps || false,
  };
  
  // ← NO PORT ASSIGNMENT OPTIONS PASSED
  
  const orchestrator = new DockerOrchestrator(orchestratorOptions);
  await orchestrator.up();  // ← PortManager gets empty array inside
  
  // ... rest of method ...
}
```

**Key observation:**
- Line 1059: `composeFile: composeFilePath` is set
- Line 1058: `service: undefined` (not a single-service deployment)
- No `allServiceNames` or similar option passed
- Orchestrator can't reconstruct which services are being deployed

---

## PortManager Implementation

### PortManager.resolvePorts() 

**File:** `tools/brat/src/orchestration/docker/port-manager.ts`
**Lines:** 57-100

```typescript
public async resolvePorts(
  serviceFiles: string[],          // ← Expects compose file paths
  env: { [key: string]: any },
  targetConfig?: any
): Promise<PortAssignment[]> {
  const assignments: PortAssignment[] = [];

  // Discover ports already in use by running containers on the target
  // This ensures we don't conflict with services that aren't in our compose file list
  // (e.g., when using --service tool-gateway --no-deps, other services are still running)
  const usedPorts = targetConfig 
    ? await this.discoverUsedPorts(targetConfig) 
    : new Set<number>();

  // First pass: identify explicit ports from environment variables
  for (const file of serviceFiles) {  // ← Iterates over files (EMPTY for bulk!)
    const serviceName = path.basename(file).replace('.compose.yaml', '');
    const upperSvc = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const portVar = `${upperSvc}_HOST_PORT`;

    const hostPort = env[portVar];
    if (hostPort !== undefined) {
      const port = parseInt(String(hostPort), 10);
      assignments.push({ service: serviceName, port, explicit: true });
      usedPorts.add(port);
    } else {
      assignments.push({ service: serviceName, port: -1, explicit: false });
    }
  }

  // Second pass: resolve implicit ports by finding next available port
  let nextFreePort = this.defaultStartPort;
  for (const assignment of assignments) {  // ← Empty loop for bulk!
    if (!assignment.explicit) {
      while (usedPorts.has(nextFreePort)) {
        nextFreePort++;
      }
      assignment.port = nextFreePort;
      usedPorts.add(nextFreePort);
      nextFreePort++;
    }
  }

  return assignments;  // ← Returns empty array for bulk deployments!
}
```

**How it's designed:**
1. Lines 70-83: Iterates over serviceFiles array (file paths)
2. Extracts service name from filename
3. Looks up explicit port from env var
4. If not found, marks for implicit assignment
5. Returns empty assignments for empty serviceFiles

---

### PortManager.discoverUsedPorts()

**File:** `tools/brat/src/orchestration/docker/port-manager.ts`
**Lines:** 21-55

```typescript
private async discoverUsedPorts(targetConfig: any): Promise<Set<number>> {
  const usedPorts = new Set<number>();

  try {
    // Get all running container port mappings
    // Format: "8080/tcp -> 0.0.0.0:8080" or "8080/tcp, 9090/tcp -> 0.0.0.0:9090"
    const isRemote = targetConfig?.host?.startsWith('ssh://');

    let result: { code: number; stdout: string; stderr: string };

    if (isRemote && targetConfig?.host && targetConfig?.remoteDir) {
      // Remote: ssh root@host "docker ps --format '{{.Ports}}'"
      const sshHost = targetConfig.host.replace('ssh://', '');
      result = await execCmd('ssh', [sshHost, 'docker ps --format "{{.Ports}}"']);
    } else {
      // Local: docker ps --format '{{.Ports}}'
      result = await execCmd('docker', ['ps', '--format', '{{.Ports}}']);
    }

    if (result.stdout) {
      // Parse port mappings like "0.0.0.0:3001->3000/tcp"
      const portRegex = /0\.0\.0\.0:(\d+)/g;
      let match;
      while ((match = portRegex.exec(result.stdout)) !== null) {
        usedPorts.add(parseInt(match[1], 10));
      }
    }
  } catch (error) {
    // If docker ps fails (daemon not running, SSH error, etc.), log and continue
    // with empty set. This gracefully degrades to the existing behavior.
    console.warn(
      `[brat] Failed to discover used ports: ${error}. Continuing without live port discovery.`
    );
  }

  return usedPorts;
}
```

**Design notes:**
- Handles both local and remote (SSH) deployment targets
- Queries live containers via `docker ps`
- Parses output format: `0.0.0.0:3001->3000/tcp`
- Returns set of in-use host ports
- Gracefully handles docker daemon not running

---

## How Single-Service Deployment Works

**File:** `tools/brat/src/oclif-commands/bit/deploy.ts`
**Lines:** 188-253

```typescript
private async deployServices(
  services: ServiceWithName[],
  context: ResolvedContext,
  strategy: any,
  options: DeployOptions
): Promise<any[]> {
  const results: any[] = [];
  const concurrency = options.concurrency || 1;

  // Simple sequential deployment for now (concurrency support in future iteration)
  for (const service of services) {  // ← Single iteration for single-service
    this.log('');
    this.log(`--- Deploying ${service.name} ---`);

    try {
      // PHASE 1: Prepare
      this.logger.debug({ service: service.name }, 'Preparing deployment plan');
      const plan = await strategy.prepare(service, context, options);

      // PHASE 2: Validate
      this.logger.debug({ service: service.name }, 'Validating deployment plan');
      const validation = await strategy.validate(plan);

      if (!validation.valid) {
        this.log(`[${service.name}] Validation failed:`);
        validation.errors.forEach((err: string) => this.log(`  - ERROR: ${err}`));
        results.push({
          status: 'failed',
          service: service.name,
          error: `Validation failed: ${validation.errors.join(', ')}`,
        });
        continue;
      }

      // PHASE 3: Execute
      this.logger.debug({ service: service.name }, 'Executing deployment');
      const result = await strategy.execute(plan);  // ← Calls execute(), not deployAll()

      if (result.status === 'success') {
        this.log(`[${service.name}] ✓ Deployment succeeded (${result.durationMs}ms)`);
        if (result.url) {
          this.log(`[${service.name}] URL: ${result.url}`);
        }
      } else {
        this.log(`[${service.name}] ✗ Deployment failed: ${result.error}`);
      }

      results.push(result);
    } catch (error: any) {
      // Error handling...
    }
  }

  return results;
}
```

**Key difference:**
- Single-service: Calls `strategy.execute()` (lines 229)
- Bulk: Calls `strategy.deployAll()` (line 168 in deploy.ts)
- execute() delegates to DockerOrchestrator.up() → PortManager works
- deployAll() orchestrates everything internally → PortManager skipped

---

## The Routing Decision

**File:** `tools/brat/src/oclif-commands/bit/deploy.ts`
**Lines:** 164-171

```typescript
// Deploy services
// Use bulk deployment if strategy supports it and --all flag is used
let results: any[];
if (flags.all && strategy.supportsBulkDeployment && strategy.deployAll) {
  // ← This branch for bulk deployments
  this.log(`Using bulk deployment (single docker compose up for all services)`);
  results = await strategy.deployAll(servicesToDeploy, resolvedContext, deployOptions);
} else {
  // ← This branch for single-service deployments
  results = await this.deployServices(servicesToDeploy, resolvedContext, strategy, deployOptions);
}
```

**Decision tree:**
- If `--all` flag AND strategy supports bulk AND deployAll method exists
- → Use deployAll (bypasses PortManager)
- Else
- → Use deployServices (uses PortManager)

---

## Service Names to Env Vars Conversion

**File:** `tools/brat/src/orchestration/docker/port-manager.ts`
**Line:** 72

```typescript
const upperSvc = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const portVar = `${upperSvc}_HOST_PORT`;
```

**Examples:**
- `llm-bot` → `LLM_BOT_HOST_PORT`
- `tool-gateway` → `TOOL_GATEWAY_HOST_PORT`
- `auth-service` → `AUTH_SERVICE_HOST_PORT`
- `config-service` → `CONFIG_SERVICE_HOST_PORT`

---

## Where Ports Are Used in Docker Compose

**Example service-specific compose file:**
`infrastructure/docker-compose/services/llm-bot.compose.yaml`

```yaml
services:
  llm-bot:
    build:
      context: ../..
      dockerfile: Dockerfile.service
      args:
        SERVICE_NAME: llm-bot
        SERVICE_ENTRY: dist/apps/llm-bot-service.js
        SERVICE_PORT: 3000
    ports:
      - "${LLM_BOT_HOST_PORT}:3000"  # ← Port assignment from env var
    environment:
      LOG_LEVEL: ${LOG_LEVEL}
      NODE_ENV: ${NODE_ENV}
```

**How it works:**
1. Single-service: `LLM_BOT_HOST_PORT=3001` injected by PortManager
2. Docker reads: `"3001:3000"`
3. Result: Container port 3000 mapped to host port 3001

**Current bulk deployment issue:**
1. Bulk: `LLM_BOT_HOST_PORT` NOT injected (empty array → no assignments)
2. Docker reads: Empty/undefined? Or default?
3. Result: Likely fails or uses wrong port

---

## Test File Locations

### No port tests for bulk deployment

**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts`
**Lines:** 255-300+ (deployAll tests)

Currently only tests:
- File merging
- Service collection
- Orchestrator invocation

Missing tests:
- Port assignment
- Port conflict handling
- Explicit port env vars in bulk mode
- Remote port discovery

**File:** `tools/brat/src/orchestration/docker/orchestrator.default.spec.ts`

Tests PortManager indirectly but:
- Only for single-service mode
- Port manager often mocked
- No integration tests for writeEnvFile()

---

## Environment Variable Structure

### Generated .env.brat file

**Location:** `.env.brat` (temporary file, generated per deploy)

**Contents:**
```bash
# Global env from context
NODE_ENV=development
LOG_LEVEL=debug
DATABASE_URL=postgres://localhost/bitbrat
PERSISTENCE_DRIVER=postgres
MESSAGE_BUS_DRIVER=nats

# Port assignments (ONLY for single-service currently!)
LLM_BOT_HOST_PORT=3001        # ← Auto-assigned by PortManager
TOOL_GATEWAY_HOST_PORT=3002   # ← Would be here in bulk, but ISN'T

# Project name
COMPOSE_PROJECT_NAME=bitbrat-local
```

---

**For more details, see DEPLOYMENT_FLOWS_AUDIT.md**
