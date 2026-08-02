# Task 378-001: Single-Service Deployment Implementation Analysis

**Task ID:** 378-001
**Phase:** Analysis (Day 1)
**Duration:** 3 hours
**Status:** Complete
**Date:** 2026-08-01

---

## Executive Summary

The `execute()` method in `docker-compose-strategy.ts` implements a comprehensive **6-stage processing pipeline** for single-service deployments. The `deployAll()` method currently **bypasses all 6 stages** and goes directly to `DockerOrchestrator.up()`, which is the root cause of the deployment inconsistency bug.

**Critical Finding:** The deployAll() method skips **100% of service-specific configuration processing**, including compose file merging, secureFiles validation, file transfer, and environment variable injection.

---

## Single-Service Deployment Flow (execute() method)

### Complete Processing Pipeline

File: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:185-370`

```
execute(plan: DeploymentPlan) → DeploymentResult
  │
  ├─ Stage 1: Read Original Compose File (lines 196-199)
  │   └─ Save original content for restoration in finally block
  │
  ├─ Stage 2: Service-Specific Compose Merging (lines 201-242)
  │   ├─ Check for service-specific override file
  │   ├─ If exists: ComposeMerger.merge(base, override)
  │   └─ Log merge statistics (volumes, env vars, dependencies)
  │
  ├─ Stage 3: SecureFiles Processing (lines 244-302)
  │   ├─ Extract secureFiles from plan metadata
  │   ├─ Determine deployment type (local vs remote)
  │   ├─ If local:
  │   │   └─ Generate volume mounts with absolute local paths
  │   ├─ If remote:
  │   │   ├─ Transfer files via SCP (transferSecureFilesToRemote)
  │   │   └─ Generate volume mounts with remote paths
  │   ├─ Extract environment variables from secureFiles
  │   └─ Inject into compose YAML (merger.injectSecureFiles)
  │
  ├─ Stage 4: Write Merged Compose (lines 304-308)
  │   └─ Temporarily replace base compose file with merged content
  │
  ├─ Stage 5: Orchestrator Execution (lines 310-325)
  │   ├─ Map DeploymentPlan to DockerOrchestratorOptions
  │   └─ Execute orchestrator.up()
  │
  └─ Stage 6: Cleanup (finally block, lines 347-369)
      └─ ALWAYS restore original compose file (success or failure)
```

---

## Stage-by-Stage Detailed Analysis

### **Stage 1: Read Original Compose File**

**Lines:** 196-199

```typescript
// Sprint 375: Read original compose file FIRST (before any processing)
// This ensures we can restore even if merge/secureFiles processing fails
originalComposeContent = await fs.promises.readFile(baseComposeFilePath, 'utf-8');
tempComposePath = baseComposeFilePath; // Track for cleanup
```

**Purpose:**
- Save original compose file content before any modifications
- Enable guaranteed restoration in finally block (even on error)
- Prevent compose file corruption if deployment fails mid-process

**Why This Matters:**
- Without this, deployment failures could leave compose files in a corrupted state
- Enables rollback to known-good state
- Critical for multi-attempt deployments

---

### **Stage 2: Service-Specific Compose Merging**

**Lines:** 201-242

```typescript
// Sprint 375: Merge service-specific compose file with generated compose file
const serviceComposeFilePath = path.join(
  repoRoot,
  'infrastructure',
  'docker-compose',
  'services',
  `${plan.service.name}.compose.yaml`
);

let finalComposeYaml: string;
const merger = new ComposeMerger();

// Check if service-specific compose file exists
if (fs.existsSync(serviceComposeFilePath)) {
  console.log(
    `[docker-compose-strategy] Merging service-specific compose file: ${serviceComposeFilePath}`
  );

  // Read service-specific file (base already read above)
  const serviceYaml = await fs.promises.readFile(serviceComposeFilePath, 'utf-8');

  // Merge service-specific overrides
  const mergeResult = merger.merge(originalComposeContent, serviceYaml, {
    serviceName: plan.service.name,
    validationMode: 'lenient', // Don't fail if service missing
  });

  console.log(
    `[docker-compose-strategy] Merge stats: ` +
      `volumes=${mergeResult.stats.volumesAdded}, ` +
      `env=${mergeResult.stats.environmentAdded}, ` +
      `deps=${mergeResult.stats.dependenciesAdded}`
  );

  finalComposeYaml = mergeResult.yaml;
} else {
  console.log(
    `[docker-compose-strategy] No service-specific compose file found at ${serviceComposeFilePath}, ` +
      `using base compose only`
  );
  finalComposeYaml = originalComposeContent; // Use already-read content
}
```

**Purpose:**
- Load service-specific overrides from `infrastructure/docker-compose/services/<service>.compose.yaml`
- Merge overrides into base compose file using ComposeMerger
- Log merge statistics for debugging

**Merge Capabilities:**
- **Volume additions**: Service-specific volume mounts
- **Environment variable overrides**: Service-specific env vars
- **Dependency additions**: Service-specific service dependencies
- **Lenient mode**: Don't fail if service not found in override file

**Why This Matters:**
- Services can declare custom volumes, env vars, dependencies without modifying base compose
- Example: image-gen-mcp needs GCP credentials mounted → declared in service-specific compose
- Without this, services lose their custom configuration

---

### **Stage 3: SecureFiles Processing**

**Lines:** 244-302

This is the **most complex stage** with branching logic for local vs remote deployments.

#### 3A. Extract SecureFiles and Determine Deployment Type

```typescript
// Sprint 374/375: Process secure files
const secureFiles = (plan.metadata.secureFiles || []) as SecureFile[];
const isRemote = plan.metadata.remoteHost !== undefined;

if (secureFiles.length > 0) {
  console.log(
    `[docker-compose-strategy] Processing ${secureFiles.length} secure file(s) for ${plan.service.name}`
  );

  let volumeMounts: string[];
  const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);
```

**SecureFile Structure** (from architecture.yaml):
```yaml
secureFiles:
  - local: .secure.staging/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    env: GOOGLE_APPLICATION_CREDENTIALS
    permissions: "0400"
    required: true
    context: staging
```

#### 3B. Local Deployment Path

```typescript
if (!isRemote) {
  // Local deployment: Generate volume mounts with local paths
  volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);
}
```

**What generateVolumeMounts() does:**
1. Resolves local paths to absolute paths
2. Generates volume mount strings: `<host-path>:<container-path>:ro`
3. Example output: `/Users/user/BitBratPlatform/.secure.local/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro`

#### 3C. Remote Deployment Path

```typescript
else {
  // Remote deployment: Transfer files via scp first
  const remoteHost = plan.metadata.remoteHost as string;
  const remoteDir = plan.metadata.remoteDir as string;

  if (!remoteDir) {
    throw new Error(
      `Remote directory not configured in context '${plan.context.name}'. ` +
        `Set deployment.docker.remoteDir in architecture.yaml`
    );
  }

  // Transfer files to remote host
  const remotePaths = await this.transferSecureFilesToRemote(
    secureFiles,
    remoteHost,
    remoteDir,
    repoRoot
  );

  // Generate volume mounts using remote paths
  volumeMounts = secureFiles.map((file) => {
    const remotePath = remotePaths.get(file.local)!;
    return `${remotePath}:${file.target}:ro`;
  });

  console.log(
    `[docker-compose-strategy] Transferred ${secureFiles.length} secure file(s) to remote`
  );
}
```

**What transferSecureFilesToRemote() does (lines 400-483):**

1. **Parse SSH host:**
   ```typescript
   const sshMatch = remoteHost.match(/^ssh:\/\/([^@]+)@([^:]+)(?::(\d+))?$/);
   // Example: ssh://root@bitbrat.lan:22
   ```

2. **Create remote .secure directory:**
   ```bash
   ssh -p 22 root@bitbrat.lan "mkdir -p /opt/BitBratPlatform/.secure"
   ```

3. **Transfer each file with SCP:**
   ```bash
   scp -P 22 ".secure.staging/gcp-credentials.json" root@bitbrat.lan:/opt/BitBratPlatform/.secure/gcp-credentials.json
   ```

4. **Set file permissions:**
   ```bash
   ssh -p 22 root@bitbrat.lan "chmod 0400 /opt/BitBratPlatform/.secure/gcp-credentials.json"
   ```

5. **Retry logic:**
   - 3 max attempts per file
   - Exponential backoff (2^attempt * 1000ms)
   - Detailed error messages on final failure

6. **Return Map:**
   ```typescript
   Map {
     '.secure.staging/gcp-credentials.json' => '/opt/BitBratPlatform/.secure/gcp-credentials.json'
   }
   ```

#### 3D. Inject SecureFiles into Compose YAML

```typescript
// Inject secureFiles into final compose YAML
finalComposeYaml = merger.injectSecureFiles(
  finalComposeYaml,
  plan.service.name,
  volumeMounts,
  secureFileEnvVars
);

console.log(
  `[docker-compose-strategy] Injected ${volumeMounts.length} volume mount(s) and ` +
    `${Object.keys(secureFileEnvVars).length} environment variable(s)`
);
```

**What injectSecureFiles() does:**
1. Parse YAML to object
2. Add volume mounts to `services.<service>.volumes` array
3. Add environment variables to `services.<service>.environment` object
4. Serialize back to YAML

**Example Transformation:**

**Before:**
```yaml
services:
  image-gen-mcp:
    image: bitbrat-image-gen-mcp:latest
    environment:
      NODE_ENV: staging
```

**After:**
```yaml
services:
  image-gen-mcp:
    image: bitbrat-image-gen-mcp:latest
    environment:
      NODE_ENV: staging
      GOOGLE_APPLICATION_CREDENTIALS: /var/secrets/gcp-credentials.json  # ADDED
    volumes:
      - /opt/BitBratPlatform/.secure/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro  # ADDED
```

**Why This Matters:**
- Without environment variable injection, services cannot find credential files
- Without volume mounts, credential files don't exist inside containers
- Example failure: image-gen-mcp cannot authenticate to GCP Storage

---

### **Stage 4: Write Merged Compose**

**Lines:** 304-308

```typescript
// Write merged content to base path (orchestrator will pick it up)
await fs.promises.writeFile(baseComposeFilePath, finalComposeYaml, 'utf-8');
console.log(
  `[docker-compose-strategy] Temporarily replaced ${baseComposeFilePath} with merged content`
);
```

**Purpose:**
- Write the fully merged compose file (base + service-specific + secureFiles) to disk
- DockerOrchestrator will read this file when executing `docker compose up`
- Temporary modification (restored in finally block)

---

### **Stage 5: Orchestrator Execution**

**Lines:** 310-325

```typescript
// Map new deployment plan to DockerOrchestratorOptions
const orchestratorOptions: DockerOrchestratorOptions = {
  repoRoot,
  context: plan.context.name,
  service: plan.service.name,
  dryRun: deployOptions.dryRun || false,
  forceRecreate: deployOptions.forceRecreate || false,
  noCache: deployOptions.forceBuild || false,
  rebuildBase: deployOptions.rebuildBase || false, // Sprint 375: Force rebuild base image
  loki: deployOptions.loki || false, // Enable Loki + Promtail observability stack
  noDeps: deployOptions.noDeps || false, // Don't start linked services
};

// Create orchestrator and execute deployment
const orchestrator = new DockerOrchestrator(orchestratorOptions);
await orchestrator.up();
```

**Purpose:**
- Execute `docker compose up` with the merged compose file
- Pass deployment options (dry-run, force-recreate, etc.)

**Important:** By this stage, the compose file on disk contains:
1. Base compose configuration
2. Service-specific overrides
3. SecureFiles volume mounts
4. SecureFiles environment variables

---

### **Stage 6: Cleanup (finally block)**

**Lines:** 347-369

```typescript
finally {
  // Sprint 375: ALWAYS restore original compose file (success, failure, or early error)
  // This finally block ensures cleanup even if errors occur during:
  // - File reading/merging
  // - SecureFiles processing
  // - File replacement
  // - Orchestrator execution
  if (originalComposeContent !== null && tempComposePath !== null) {
    try {
      await fs.promises.writeFile(tempComposePath, originalComposeContent, 'utf-8');
      console.log(`[docker-compose-strategy] Restored original compose file: ${tempComposePath}`);
    } catch (restoreError: any) {
      // Log restoration failure but don't throw (avoid masking original error)
      console.error(
        `[docker-compose-strategy] CRITICAL: Failed to restore original compose file: ${tempComposePath}`,
        restoreError
      );
      console.error(
        `[docker-compose-strategy] MANUAL RECOVERY REQUIRED: Restore from git or backup`
      );
    }
  }
}
```

**Purpose:**
- **ALWAYS** restore original compose file (success, failure, or error)
- Guarantees compose file is never left in a corrupted state
- Even if restoration fails, log critical error (don't mask original error)

**Why This Matters:**
- Without this, failed deployments would leave compose files in a modified state
- Subsequent deployments would use corrupted compose files
- Impossible to rollback to known-good state

---

## Bulk Deployment Flow (deployAll() method)

### Complete "Processing" Pipeline

File: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:590-639`

```
deployAll(services, context, options) → DeploymentResult[]
  │
  └─ DockerOrchestrator.up()  // THAT'S IT!
```

**Current deployAll() Implementation (50 lines):**

```typescript
async deployAll(
  services: ServiceWithName[],
  context: ResolvedContext,
  options: DeployOptions
): Promise<DeploymentResult[]> {
  const startTime = Date.now();
  const repoRoot = process.cwd();

  console.log(`[docker-compose-strategy] Bulk deployment of ${services.length} services`);

  try {
    // Use DockerOrchestrator to deploy all services at once
    const orchestratorOptions: DockerOrchestratorOptions = {
      repoRoot,
      context: context.name,
      service: undefined, // No specific service - deploy all
      dryRun: options.dryRun || false,
      forceRecreate: options.forceRecreate || false,
      noCache: options.forceBuild || false,
      rebuildBase: options.rebuildBase || false,
      loki: options.loki || false,
      noDeps: options.noDeps || false,
    };

    const orchestrator = new DockerOrchestrator(orchestratorOptions);
    await orchestrator.up();

    const durationMs = Date.now() - startTime;

    // Return success for all services
    return services.map((service) => ({
      status: 'success' as const,
      service: service.name,
      durationMs,
      metadata: {
        containerId: `bitbrat-${context.name}-${service.name}`,
      },
    }));
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    // Return failure for all services
    return services.map((service) => ({
      status: 'failed' as const,
      service: service.name,
      durationMs,
      error: error.message || String(error),
    }));
  }
}
```

**What's Missing:**

| Stage | Description | Impact |
|-------|-------------|--------|
| **Stage 1** | Read original compose file | No backup for rollback |
| **Stage 2** | Service-specific compose merging | Services lose custom config |
| **Stage 3** | SecureFiles processing | Credentials not mounted, env vars missing |
| **Stage 4** | Write merged compose | Only base compose used |
| **Stage 5** | Orchestrator execution | ✅ (ONLY stage that runs) |
| **Stage 6** | Cleanup | No restoration needed (nothing modified) |

---

## Critical Differences: execute() vs deployAll()

### Feature Comparison Matrix

| Feature | execute() | deployAll() | Impact |
|---------|-----------|-------------|--------|
| **Service-specific compose merging** | ✅ Yes | ❌ No | Services lose custom volumes, env vars, dependencies |
| **SecureFiles validation** | ✅ Yes | ❌ No | Invalid secureFiles not detected |
| **SecureFiles transfer (remote)** | ✅ Yes | ❌ No | Credentials never reach remote host |
| **SecureFiles volume mounts** | ✅ Yes | ❌ No | Credentials files not mounted in containers |
| **SecureFiles env var injection** | ✅ Yes | ❌ No | Services cannot find credential files |
| **Original file backup** | ✅ Yes | ❌ No | No rollback on failure |
| **Merge statistics logging** | ✅ Yes | ❌ No | No visibility into what was merged |
| **Error handling** | ✅ Granular | ⚠️ All-or-nothing | Can't identify which service failed |
| **Cleanup** | ✅ Always | N/A | No cleanup needed (nothing modified) |

---

## Example: image-gen-mcp Deployment

### Single Service (execute() - WORKS)

**Command:**
```bash
brat bit deploy image-gen-mcp --context staging
```

**Processing:**
1. **Stage 1:** Read `docker-compose.staging.yaml`
2. **Stage 2:** Merge `services/image-gen-mcp.compose.yaml`
   - Adds custom volumes
   - Adds custom env vars
3. **Stage 3:** Process secureFiles
   - Transfer `.secure.staging/gcp-credentials.json` to remote host
   - Generate volume mount: `/opt/BitBratPlatform/.secure/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro`
   - Extract env var: `GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json`
   - Inject into compose YAML
4. **Stage 4:** Write merged compose to disk
5. **Stage 5:** Execute `docker compose up`
6. **Stage 6:** Restore original compose file

**Result:** Service has credentials, authenticates to GCP successfully ✅

---

### Bulk Deployment (deployAll() - BROKEN)

**Command:**
```bash
brat bit deploy --all --context staging
```

**Processing:**
1. ~~Stage 1~~ SKIPPED
2. ~~Stage 2~~ SKIPPED (no service-specific compose merging)
3. ~~Stage 3~~ SKIPPED (no secureFiles processing)
4. ~~Stage 4~~ SKIPPED (no merged compose)
5. **Stage 5:** Execute `docker compose up` with base compose ONLY
6. ~~Stage 6~~ SKIPPED (nothing to restore)

**Result:** Service has NO credentials, GCP authentication fails ❌

**Error Message:**
```
Error: Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.
```

**Root Cause:** `GOOGLE_APPLICATION_CREDENTIALS` environment variable never set, credential file never mounted.

---

## Key Implementation Details to Replicate

### 1. ComposeMerger Usage

**Location:** `tools/brat/src/orchestration/deployment/compose-merger.ts`

**Key Methods:**
- `merge(base: string, override: string, options?: MergeOptions): MergeResult`
- `injectSecureFiles(yaml: string, serviceName: string, volumeMounts: string[], envVars: Record<string, string>): string`
- `static generateVolumeMounts(secureFiles: SecureFile[], repoRoot: string): string[]`
- `static extractEnvVars(secureFiles: SecureFile[]): Record<string, string>`

**Merge Options:**
```typescript
interface MergeOptions {
  serviceName?: string;
  validationMode?: 'strict' | 'lenient';
}
```

**Merge Result:**
```typescript
interface MergeResult {
  yaml: string;
  stats: {
    volumesAdded: number;
    environmentAdded: number;
    dependenciesAdded: number;
  };
}
```

---

### 2. SecureFiles Transfer Logic

**Retry Strategy:**
- Max 3 attempts per file
- Exponential backoff: 2^attempt * 1000ms
- Log warnings on retry, throw on final failure

**Error Handling:**
- Invalid SSH host format → throw immediately
- Missing remoteDir → throw immediately
- SCP failure → retry with backoff
- chmod failure → retry with backoff

**Performance:**
- Sequential transfers (not parallel) for reliability
- Each file transfer logged with checkmark on success
- Total transfer count logged after all files complete

---

### 3. Environment Variable Extraction

**Logic:** `ComposeMerger.extractEnvVars(secureFiles)`

```typescript
static extractEnvVars(secureFiles: SecureFile[]): Record<string, string> {
  const envVars: Record<string, string> = {};

  for (const file of secureFiles) {
    if (file.env) {
      envVars[file.env] = file.target;  // NOT file.local!
    }
  }

  return envVars;
}
```

**Example:**
```yaml
secureFiles:
  - local: .secure.staging/gcp-credentials.json
    target: /var/secrets/gcp-credentials.json
    env: GOOGLE_APPLICATION_CREDENTIALS  # Key
```

**Result:**
```typescript
{
  "GOOGLE_APPLICATION_CREDENTIALS": "/var/secrets/gcp-credentials.json"  // Value is target, not local!
}
```

**Common Mistake:** Using `file.local` instead of `file.target` for env var value (file path inside container, not on host).

---

### 4. Volume Mount Generation

**Local Deployment:**
```typescript
ComposeMerger.generateVolumeMounts(secureFiles, repoRoot)
// Returns: [
//   "/Users/user/BitBratPlatform/.secure.local/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro"
// ]
```

**Remote Deployment:**
```typescript
// After transferSecureFilesToRemote() returns Map<local, remote>
volumeMounts = secureFiles.map((file) => {
  const remotePath = remotePaths.get(file.local)!;
  return `${remotePath}:${file.target}:ro`;
});
// Returns: [
//   "/opt/BitBratPlatform/.secure/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro"
// ]
```

---

### 5. Temporary File Handling

**Pattern:**
1. Save original content BEFORE any modifications
2. Write merged content to SAME file path (orchestrator expects specific path)
3. ALWAYS restore in finally block (success or failure)

**Why not use a separate temporary file?**
- DockerOrchestrator expects compose files at specific paths
- Changing paths would require orchestrator refactoring
- Current approach is safer: guaranteed restoration, no path confusion

---

## Implementation Recommendations for deployAll()

### Option 1: Enhanced deployAll() (RECOMMENDED)

**Approach:** Replicate all 6 stages from execute() but optimized for bulk processing.

**Pseudo-code:**
```typescript
async deployAll(services, context, options) {
  // Stage 1: Read original compose file
  const originalComposeContent = await fs.promises.readFile(baseComposePath, 'utf-8');

  try {
    let mergedYaml = originalComposeContent;

    // Stage 2: Iteratively merge ALL service-specific compose files
    for (const service of services) {
      const serviceComposePath = `infrastructure/docker-compose/services/${service.name}.compose.yaml`;
      if (fs.existsSync(serviceComposePath)) {
        const serviceYaml = await fs.promises.readFile(serviceComposePath, 'utf-8');
        mergedYaml = merger.merge(mergedYaml, serviceYaml, { serviceName: service.name });
      }
    }

    // Stage 3: Collect ALL secureFiles for ALL services
    const allSecureFiles = new Map<string, SecureFile[]>();
    for (const service of services) {
      if (service.secureFiles) {
        await validator.validate(service.secureFiles, context.name);
        allSecureFiles.set(service.name, service.secureFiles);
      }
    }

    // Transfer and inject for each service
    for (const [serviceName, secureFiles] of allSecureFiles) {
      const volumeMounts = isRemote
        ? await transferToRemote(secureFiles)
        : generateLocalMounts(secureFiles);
      const envVars = extractEnvVars(secureFiles);
      mergedYaml = merger.injectSecureFiles(mergedYaml, serviceName, volumeMounts, envVars);
    }

    // Stage 4: Write temporary merged file
    const tempMergedPath = '.docker-compose.merged.yaml';
    await fs.promises.writeFile(tempMergedPath, mergedYaml);

    try {
      // Stage 5: Execute orchestrator with custom compose file
      await orchestrator.up({ composeFile: tempMergedPath });
    } finally {
      // Stage 6: Cleanup temporary file
      await fs.promises.unlink(tempMergedPath);
    }
  } finally {
    // Restore original if we modified it (not needed if using separate temp file)
  }
}
```

**Advantages:**
- ✅ Identical behavior to single-service deployments
- ✅ Single `docker compose up` (fast)
- ✅ All services get their configuration
- ✅ Proper error handling

**Disadvantages:**
- ⚠️ Requires orchestrator refactoring (accept custom compose file path)
- ⚠️ More complex than current implementation

---

### Option 2: Sequential execute() Calls (SIMPLE)

**Approach:** Loop through services and call execute() for each.

```typescript
async deployAll(services, context, options) {
  const results: DeploymentResult[] = [];

  for (const service of services) {
    const plan = await this.prepare(service, context, options);
    await this.validate(plan);
    const result = await this.execute(plan);
    results.push(result);
  }

  return results;
}
```

**Advantages:**
- ✅ Trivial to implement (5 lines)
- ✅ Guaranteed identical behavior
- ✅ No orchestrator changes needed

**Disadvantages:**
- ❌ Multiple `docker compose up` calls (slower)
- ❌ No bulk optimization
- ❌ May cause service restart issues (dependencies)

---

## Conclusion

The single-service deployment flow (`execute()`) implements a comprehensive **6-stage processing pipeline** that handles:

1. ✅ Original file backup for rollback
2. ✅ Service-specific compose file merging
3. ✅ SecureFiles validation, transfer, and injection
4. ✅ Temporary compose file creation
5. ✅ Orchestrator execution
6. ✅ Guaranteed cleanup

The bulk deployment flow (`deployAll()`) **skips stages 1-4 and 6**, going directly to orchestrator execution with the base compose file. This causes services with secureFiles or service-specific compose overrides to fail.

**Next Steps:**
- Task 378-002: Design bulk merge strategy (iterative merging, conflict resolution)
- Task 378-003: Implement service-specific compose file collection
- Task 378-004: Implement iterative merging
- Task 378-005: Implement secureFiles collection and validation

---

**Document Status:** ✅ Complete
**Analysis Duration:** 3 hours
**Next Task:** 378-002 (Design bulk merge strategy)
