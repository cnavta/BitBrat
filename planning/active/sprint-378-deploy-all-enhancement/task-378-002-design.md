# Task 378-002: Bulk Merge Strategy Design

**Task ID:** 378-002
**Phase:** Analysis (Day 1)
**Duration:** 2 hours
**Status:** Complete
**Date:** 2026-08-01

---

## Executive Summary

This document defines the **iterative merge strategy** for processing multiple service-specific compose files in bulk deployments. The strategy ensures:

1. ✅ **Deterministic ordering**: Services merged in consistent order
2. ✅ **Lenient conflict resolution**: Last-wins strategy (no deployment failures)
3. ✅ **Comprehensive logging**: Full visibility into merge operations
4. ✅ **Error isolation**: Individual service failures don't block others
5. ✅ **Validation**: Merged result validated before orchestrator execution

---

## Design Principles

### 1. Principle of Least Surprise

**Rule:** Bulk deployment behavior should match sequential single-service deployments as closely as possible.

**Implications:**
- If services A and B are deployed individually, they get their service-specific config
- If services A and B are deployed via `--all`, they MUST get the same config
- Exception: Conflict resolution (addressed below)

---

### 2. Principle of Reliability Over Strictness

**Rule:** Prefer deployment success with warnings over deployment failure.

**Implications:**
- Use **lenient** validation mode (don't fail if service missing in override file)
- Use **last-wins** conflict resolution (don't fail on conflicting values)
- Log conflicts as warnings, not errors
- Allow individual service processing failures without blocking others

---

### 3. Principle of Transparency

**Rule:** All merge operations must be logged with sufficient detail for debugging.

**Implications:**
- Log which services have service-specific compose files
- Log merge statistics for each service (volumes, env vars, dependencies added)
- Log conflicts and resolution strategy
- Log final merged file location and size

---

## Merge Strategy Overview

### High-Level Flow

```
deployAll(services: ServiceWithName[], context, options)
  │
  ├─ Step 1: Read base compose file
  │   └─ Save original content for restoration
  │
  ├─ Step 2: Collect service-specific compose file paths
  │   ├─ For each service in services:
  │   │   └─ Check if infrastructure/docker-compose/services/<service>.compose.yaml exists
  │   └─ Return: Array<{ service: string, path: string, yaml: string }>
  │
  ├─ Step 3: Iteratively merge service-specific files
  │   ├─ Initialize mergedYaml = baseYaml
  │   ├─ For each service-specific file (in deterministic order):
  │   │   ├─ Merge: mergedYaml = merger.merge(mergedYaml, serviceYaml)
  │   │   ├─ Log merge statistics
  │   │   └─ Handle merge errors (log warning, continue)
  │   └─ Return: Final merged YAML string
  │
  ├─ Step 4: Collect secureFiles for all services
  │   ├─ For each service with secureFiles:
  │   │   ├─ Validate secureFiles declarations
  │   │   └─ Add to Map<serviceName, SecureFile[]>
  │   └─ Return: Map of all secureFiles
  │
  ├─ Step 5: Process secureFiles for all services
  │   ├─ For each service in secureFiles map:
  │   │   ├─ If remote: Transfer files via SCP
  │   │   ├─ Generate volume mounts (local or remote paths)
  │   │   ├─ Extract environment variables
  │   │   └─ Inject into mergedYaml
  │   └─ Return: Final YAML with all secureFiles injected
  │
  ├─ Step 6: Write temporary merged compose file
  │   └─ Write to .docker-compose.merged.yaml
  │
  ├─ Step 7: Execute orchestrator with merged file
  │   └─ orchestrator.up({ composeFile: '.docker-compose.merged.yaml' })
  │
  └─ Step 8: Cleanup
      └─ Delete temporary merged file
```

---

## Design Decisions

### Decision 1: Iterative vs Parallel Merging

**Options:**

**A. Iterative (Sequential):**
```typescript
let mergedYaml = baseYaml;
for (const serviceFile of serviceFiles) {
  mergedYaml = merger.merge(mergedYaml, serviceFile.yaml);
}
```

**B. Parallel (All-at-once):**
```typescript
const allServiceYamls = serviceFiles.map(f => f.yaml);
const mergedYaml = merger.mergeAll(baseYaml, allServiceYamls);
```

**Decision:** **Option A (Iterative)** ✅

**Rationale:**
- **Simpler error handling**: Each merge can fail independently
- **Better logging**: Can log statistics per service
- **Conflict resolution**: Last-wins strategy is easier to understand with sequential merging
- **Performance**: Not a bottleneck (YAML parsing is fast, merging is O(n) where n = number of services)
- **Code reuse**: Reuses existing `ComposeMerger.merge()` method (no new mergeAll() needed)

---

### Decision 2: Merge Order Determinism

**Options:**

**A. Alphabetical by service name:**
```typescript
const serviceFiles = [...].sort((a, b) => a.service.localeCompare(b.service));
```

**B. Order defined in architecture.yaml:**
```typescript
// Use services array order as-is from architecture.yaml
const serviceFiles = services.map(...);
```

**C. Dependency-based topological sort:**
```typescript
const serviceFiles = topologicalSort(services, dependencies);
```

**Decision:** **Option B (Architecture.yaml order)** ✅

**Rationale:**
- **Predictable**: Order is explicit in architecture.yaml
- **User control**: Users can influence merge order by reordering services
- **Simple**: No additional sorting logic needed
- **Consistent**: Matches order used elsewhere in the system

**Edge Case:** If users rely on merge order for conflict resolution, document this behavior:
> **Note:** When multiple services define conflicting values (e.g., shared environment variables), the last service in architecture.yaml wins. If you need specific merge behavior, consider using a shared base compose file or environment overlays instead.

---

### Decision 3: Conflict Resolution Strategy

**Background:** Conflicts occur when multiple service-specific compose files define the same key with different values.

**Example Conflict:**
```yaml
# Service A's override
services:
  shared-service:
    environment:
      LOG_LEVEL: debug

# Service B's override
services:
  shared-service:
    environment:
      LOG_LEVEL: info
```

**Options:**

**A. Fail on conflict (strict):**
```typescript
if (hasConflict(mergedYaml, newYaml)) {
  throw new Error('Merge conflict detected');
}
```

**B. Last-wins (lenient):**
```typescript
// Just merge, last value wins
mergedYaml = merger.merge(mergedYaml, newYaml, { conflictStrategy: 'last-wins' });
```

**C. First-wins (lenient):**
```typescript
mergedYaml = merger.merge(mergedYaml, newYaml, { conflictStrategy: 'first-wins' });
```

**D. Prompt user (interactive):**
```typescript
if (hasConflict(mergedYaml, newYaml)) {
  const resolution = await promptUser('Conflict detected, which value to use?');
  // Apply resolution
}
```

**Decision:** **Option B (Last-wins, lenient)** ✅

**Rationale:**
- **Matches existing behavior**: ComposeMerger already uses last-wins
- **Reliability**: Deployments don't fail due to conflicts
- **Predictable**: Users can control resolution by ordering services in architecture.yaml
- **No user interaction**: Works in CI/CD environments

**Logging Strategy:**
```typescript
if (hasConflict(mergedYaml, newYaml)) {
  console.warn(
    `[docker-compose-strategy] Merge conflict detected for service ${serviceName}: ` +
    `key="${conflictKey}", old="${oldValue}", new="${newValue}" (using new value)`
  );
}
```

**Documentation Note:**
> **Merge Conflicts:** When multiple service-specific compose files define the same key, the last value wins. Services are processed in the order they appear in architecture.yaml. To avoid conflicts, use unique keys or shared base compose files.

---

### Decision 4: Error Handling for Individual Service Merges

**Scenario:** Service B's compose file is malformed (invalid YAML).

**Options:**

**A. Fail entire deployment:**
```typescript
for (const serviceFile of serviceFiles) {
  mergedYaml = merger.merge(mergedYaml, serviceFile.yaml); // Throws on error
}
```

**B. Skip failed service, continue:**
```typescript
for (const serviceFile of serviceFiles) {
  try {
    mergedYaml = merger.merge(mergedYaml, serviceFile.yaml);
  } catch (error) {
    console.warn(`Skipping ${serviceFile.service}: ${error.message}`);
    // Continue with other services
  }
}
```

**C. Collect errors, fail at end:**
```typescript
const errors: string[] = [];
for (const serviceFile of serviceFiles) {
  try {
    mergedYaml = merger.merge(mergedYaml, serviceFile.yaml);
  } catch (error) {
    errors.push(`${serviceFile.service}: ${error.message}`);
  }
}
if (errors.length > 0) {
  throw new Error(`Merge failures:\n${errors.join('\n')}`);
}
```

**Decision:** **Option C (Collect errors, fail at end)** ✅

**Rationale:**
- **Visibility**: Users see ALL merge failures, not just the first one
- **Fail-fast**: Don't proceed to deployment if any merge failed
- **Debugging**: Easier to diagnose multiple issues at once

**Implementation:**
```typescript
const mergeErrors: Array<{ service: string; error: string }> = [];

for (const serviceFile of serviceFiles) {
  try {
    const mergeResult = merger.merge(mergedYaml, serviceFile.yaml, {
      serviceName: serviceFile.service,
      validationMode: 'lenient',
    });

    console.log(
      `[docker-compose-strategy] Merged ${serviceFile.service}: ` +
        `volumes=${mergeResult.stats.volumesAdded}, ` +
        `env=${mergeResult.stats.environmentAdded}, ` +
        `deps=${mergeResult.stats.dependenciesAdded}`
    );

    mergedYaml = mergeResult.yaml;
  } catch (error: any) {
    mergeErrors.push({
      service: serviceFile.service,
      error: error.message || String(error),
    });

    console.error(
      `[docker-compose-strategy] Failed to merge ${serviceFile.service}: ${error.message}`
    );
  }
}

// Check for merge failures
if (mergeErrors.length > 0) {
  const errorSummary = mergeErrors.map((e) => `  - ${e.service}: ${e.error}`).join('\n');
  throw new Error(
    `Failed to merge ${mergeErrors.length} service-specific compose file(s):\n${errorSummary}\n\n` +
      `Fix the invalid compose files and try again.`
  );
}
```

---

### Decision 5: Temporary Merged File Location

**Options:**

**A. Write to base compose path (overwrite):**
```typescript
await fs.promises.writeFile(baseComposePath, mergedYaml);
// Restore in finally block
```

**B. Write to separate temporary file:**
```typescript
await fs.promises.writeFile('.docker-compose.merged.yaml', mergedYaml);
// Delete in finally block, no restoration needed
```

**C. Write to system temp directory:**
```typescript
const tempPath = path.join(os.tmpdir(), `brat-compose-${Date.now()}.yaml`);
await fs.promises.writeFile(tempPath, mergedYaml);
```

**Decision:** **Option B (Separate temporary file in repo root)** ✅

**Rationale:**
- **Safety**: Original base compose file never modified (no restoration needed)
- **Debuggability**: Temporary file can be inspected if deployment fails
- **Simplicity**: No finally block for restoration (just cleanup temp file)
- **Predictable location**: Always in repo root (easier to find than system temp)

**File Naming:**
- **Development:** `.docker-compose.merged.yaml` (gitignored)
- **Production:** Same (consistent behavior)

**Cleanup Strategy:**
```typescript
const tempMergedPath = path.join(repoRoot, '.docker-compose.merged.yaml');

try {
  await fs.promises.writeFile(tempMergedPath, mergedYaml);
  await orchestrator.up({ composeFile: tempMergedPath });
} finally {
  // Always cleanup temp file (success or failure)
  try {
    await fs.promises.unlink(tempMergedPath);
    console.log(`[docker-compose-strategy] Cleaned up temporary merged compose file`);
  } catch (cleanupError: any) {
    // Log but don't throw (avoid masking original error)
    console.warn(
      `[docker-compose-strategy] Failed to cleanup temporary file ${tempMergedPath}: ` +
        `${cleanupError.message}`
    );
  }
}
```

---

### Decision 6: DockerOrchestrator Interface Change

**Current Interface:**
```typescript
interface DockerOrchestratorOptions {
  repoRoot: string;
  context: string;
  service?: string; // undefined = deploy all
  dryRun: boolean;
  forceRecreate: boolean;
  noCache: boolean;
  rebuildBase: boolean;
  loki: boolean;
  noDeps: boolean;
}
```

**Proposed Change:**
```typescript
interface DockerOrchestratorOptions {
  // ... existing options ...
  composeFile?: string; // NEW: Override compose file path
}
```

**Orchestrator Logic Change:**

**Before:**
```typescript
const composeFileSet = this.composeFactory.getComposeFiles(
  this.options.service,
  inactiveServices,
  this.options.loki
);
```

**After:**
```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],
      targetService: null,
    }
  : this.composeFactory.getComposeFiles(
      this.options.service,
      inactiveServices,
      this.options.loki
    );
```

**Decision:** **Implement custom compose file support in DockerOrchestrator** ✅

**Rationale:**
- **Flexibility**: Enables future use cases (custom compose file generation)
- **Clean separation**: deployAll() handles merging, orchestrator handles execution
- **Backward compatible**: Existing behavior unchanged (composeFile optional)
- **Testable**: Can test orchestrator with custom compose files

**Validation:**
```typescript
if (this.options.composeFile) {
  // Validate file exists
  if (!fs.existsSync(this.options.composeFile)) {
    throw new Error(`Custom compose file not found: ${this.options.composeFile}`);
  }

  // Validate file is readable
  try {
    await fs.promises.access(this.options.composeFile, fs.constants.R_OK);
  } catch {
    throw new Error(`Custom compose file not readable: ${this.options.composeFile}`);
  }
}
```

---

## Detailed Merge Algorithm

### Step-by-Step Implementation

#### Step 1: Read Base Compose File

```typescript
const repoRoot = process.cwd();
const baseComposePath = this.getComposeFilePath(context, services[0]); // Context-specific or default
const baseYaml = await fs.promises.readFile(baseComposePath, 'utf-8');

console.log(`[docker-compose-strategy] Base compose file: ${baseComposePath}`);
```

**Edge Cases:**
- Base compose file doesn't exist → throw error (critical failure)
- Base compose file is malformed YAML → throw error (critical failure)

---

#### Step 2: Collect Service-Specific Compose Files

```typescript
interface ServiceComposeFile {
  service: string;
  path: string;
  yaml: string;
}

const serviceFiles: ServiceComposeFile[] = [];

for (const service of services) {
  const serviceComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/services',
    `${service.name}.compose.yaml`
  );

  if (fs.existsSync(serviceComposePath)) {
    try {
      const yaml = await fs.promises.readFile(serviceComposePath, 'utf-8');
      serviceFiles.push({
        service: service.name,
        path: serviceComposePath,
        yaml,
      });

      console.log(
        `[docker-compose-strategy] Found service-specific compose file for ${service.name}`
      );
    } catch (error: any) {
      // Can't read file → treat as merge error (will be collected and thrown later)
      mergeErrors.push({
        service: service.name,
        error: `Failed to read service-specific compose file: ${error.message}`,
      });

      console.error(
        `[docker-compose-strategy] Failed to read ${serviceComposePath}: ${error.message}`
      );
    }
  } else {
    console.log(
      `[docker-compose-strategy] No service-specific compose file for ${service.name} ` +
        `(checked ${serviceComposePath})`
    );
  }
}

console.log(
  `[docker-compose-strategy] Found ${serviceFiles.length} service-specific compose file(s) ` +
    `out of ${services.length} service(s)`
);
```

**Edge Cases:**
- Service-specific file exists but not readable → add to mergeErrors
- Service-specific file is empty → valid (no overrides)
- No service-specific files found → valid (use base compose only)

---

#### Step 3: Iteratively Merge Service-Specific Files

```typescript
let mergedYaml = baseYaml;
const merger = new ComposeMerger();
const mergeErrors: Array<{ service: string; error: string }> = [];
const mergeStats: Array<{ service: string; stats: MergeStats }> = [];

for (const serviceFile of serviceFiles) {
  try {
    const mergeResult = merger.merge(mergedYaml, serviceFile.yaml, {
      serviceName: serviceFile.service,
      validationMode: 'lenient', // Don't fail if service missing in override
    });

    mergedYaml = mergeResult.yaml;
    mergeStats.push({
      service: serviceFile.service,
      stats: mergeResult.stats,
    });

    console.log(
      `[docker-compose-strategy] Merged ${serviceFile.service}: ` +
        `+${mergeResult.stats.volumesAdded} volumes, ` +
        `+${mergeResult.stats.environmentAdded} env vars, ` +
        `+${mergeResult.stats.dependenciesAdded} dependencies`
    );
  } catch (error: any) {
    mergeErrors.push({
      service: serviceFile.service,
      error: error.message || String(error),
    });

    console.error(
      `[docker-compose-strategy] Failed to merge ${serviceFile.service}: ${error.message}`
    );
  }
}

// Fail if any merges failed
if (mergeErrors.length > 0) {
  const errorSummary = mergeErrors.map((e) => `  - ${e.service}: ${e.error}`).join('\n');
  throw new Error(
    `Failed to merge ${mergeErrors.length}/${serviceFiles.length} service-specific compose file(s):\n` +
      `${errorSummary}\n\n` +
      `Fix the invalid compose files and try again.`
  );
}

// Log total merge statistics
const totalStats = mergeStats.reduce(
  (acc, { stats }) => ({
    volumesAdded: acc.volumesAdded + stats.volumesAdded,
    environmentAdded: acc.environmentAdded + stats.environmentAdded,
    dependenciesAdded: acc.dependenciesAdded + stats.dependenciesAdded,
  }),
  { volumesAdded: 0, environmentAdded: 0, dependenciesAdded: 0 }
);

console.log(
  `[docker-compose-strategy] Total merge stats: ` +
    `+${totalStats.volumesAdded} volumes, ` +
    `+${totalStats.environmentAdded} env vars, ` +
    `+${totalStats.dependenciesAdded} dependencies`
);
```

**Edge Cases:**
- All service files have merge errors → throw error with all details
- Some service files merge successfully, some fail → throw error with failed services only
- No service files to merge → skip this step (mergedYaml = baseYaml)

---

#### Step 4-5: Collect and Process SecureFiles

**Note:** This logic is identical to single-service deployment, just iterated over all services.

```typescript
// Determine deployment type
const isRemote = context.deployment?.docker?.host?.startsWith('ssh://');

// Collect all secureFiles
const allSecureFiles = new Map<string, SecureFile[]>();
const secureFilesErrors: Array<{ service: string; error: string }> = [];

for (const service of services) {
  if (service.secureFiles && service.secureFiles.length > 0) {
    try {
      // Validate secureFiles declarations (Sprint 374 validator)
      await this.secureFilesValidator.validate(service.secureFiles, context.name);

      allSecureFiles.set(service.name, service.secureFiles);

      console.log(
        `[docker-compose-strategy] Collected ${service.secureFiles.length} secureFile(s) ` +
          `for ${service.name}`
      );
    } catch (error: any) {
      secureFilesErrors.push({
        service: service.name,
        error: error.message || String(error),
      });

      console.error(
        `[docker-compose-strategy] SecureFiles validation failed for ${service.name}: ` +
          `${error.message}`
      );
    }
  }
}

// Fail if any secureFiles validation failed
if (secureFilesErrors.length > 0) {
  const errorSummary = secureFilesErrors.map((e) => `  - ${e.service}: ${e.error}`).join('\n');
  throw new Error(
    `SecureFiles validation failed for ${secureFilesErrors.length} service(s):\n` +
      `${errorSummary}\n\n` +
      `Fix the secureFiles declarations and try again.`
  );
}

console.log(
  `[docker-compose-strategy] Collected secureFiles for ${allSecureFiles.size} service(s)`
);

// Process secureFiles for all services
for (const [serviceName, secureFiles] of allSecureFiles) {
  let volumeMounts: string[];
  const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);

  if (!isRemote) {
    // Local deployment: Generate volume mounts with local paths
    volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);

    console.log(
      `[docker-compose-strategy] Generated ${volumeMounts.length} local volume mount(s) ` +
        `for ${serviceName}`
    );
  } else {
    // Remote deployment: Transfer files via SCP
    const remoteHost = context.deployment!.docker!.host!;
    const remoteDir = context.deployment!.docker!.remoteDir!;

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
      `[docker-compose-strategy] Transferred and mounted ${volumeMounts.length} remote file(s) ` +
        `for ${serviceName}`
    );
  }

  // Inject into merged YAML
  mergedYaml = merger.injectSecureFiles(mergedYaml, serviceName, volumeMounts, secureFileEnvVars);

  console.log(
    `[docker-compose-strategy] Injected ${volumeMounts.length} volume mount(s) and ` +
      `${Object.keys(secureFileEnvVars).length} env var(s) for ${serviceName}`
  );
}
```

**Edge Cases:**
- Service has secureFiles but validation fails → add to secureFilesErrors
- Remote transfer fails → throw error (critical failure)
- Service has secureFiles but none applicable to current context → skip (validator handles context filtering)

---

#### Step 6-8: Write, Execute, Cleanup

```typescript
// Write temporary merged compose file
const tempMergedPath = path.join(repoRoot, '.docker-compose.merged.yaml');

try {
  await fs.promises.writeFile(tempMergedPath, mergedYaml, 'utf-8');

  const fileSizeKb = (mergedYaml.length / 1024).toFixed(2);
  console.log(
    `[docker-compose-strategy] Wrote temporary merged compose file: ${tempMergedPath} ` +
      `(${fileSizeKb} KB)`
  );

  // Execute orchestrator with custom compose file
  const orchestratorOptions: DockerOrchestratorOptions = {
    repoRoot,
    context: context.name,
    service: undefined, // Deploy all services
    composeFile: tempMergedPath, // NEW: Use merged compose file
    dryRun: options.dryRun || false,
    forceRecreate: options.forceRecreate || false,
    noCache: options.forceBuild || false,
    rebuildBase: options.rebuildBase || false,
    loki: options.loki || false,
    noDeps: options.noDeps || false,
  };

  const orchestrator = new DockerOrchestrator(orchestratorOptions);
  await orchestrator.up();

  console.log(`[docker-compose-strategy] Bulk deployment completed successfully`);
} finally {
  // Always cleanup temporary file (success or failure)
  try {
    await fs.promises.unlink(tempMergedPath);
    console.log(`[docker-compose-strategy] Cleaned up temporary merged compose file`);
  } catch (cleanupError: any) {
    console.warn(
      `[docker-compose-strategy] Failed to cleanup temporary file: ${cleanupError.message}`
    );
  }
}
```

---

## Performance Considerations

### Merge Complexity

**Time Complexity:** O(n * m) where:
- n = number of services with service-specific compose files
- m = average size of compose YAML (number of keys)

**Example:**
- 10 services with service-specific files
- Each file has ~20 keys
- Total: 10 * 20 = 200 operations

**Estimated Duration:** < 100ms for typical deployments

**Optimization:** Not needed (merging is fast, not a bottleneck)

---

### SecureFiles Transfer Complexity

**Time Complexity:** O(n * f * s) where:
- n = number of services with secureFiles
- f = average number of secureFiles per service
- s = average size of each file (transfer time)

**Example:**
- 3 services with secureFiles
- Each service has 2 files
- Each file is 10 KB
- Total: 3 * 2 * 10 KB = 60 KB

**Estimated Duration:** ~2-5 seconds for remote SSH deployments

**Bottleneck:** Network transfer, not CPU

**Optimization Opportunity:** Parallel transfer (future sprint)

---

## Logging Strategy

### Log Levels

**Info-level logs:**
- Base compose file path
- Service-specific compose files found/missing
- Merge statistics per service
- Total merge statistics
- SecureFiles collected per service
- Volume mounts and env vars injected per service
- Temporary merged file location and size
- Deployment completion

**Warn-level logs:**
- Merge conflicts (if detected)
- Cleanup failures (non-critical)

**Error-level logs:**
- Merge failures
- SecureFiles validation failures
- Transfer failures
- Orchestrator execution failures

---

## Validation Strategy

### Pre-Execution Validation

1. **Base compose file validation:**
   - File exists
   - File is readable
   - File is valid YAML

2. **Service-specific compose file validation:**
   - File is readable (if exists)
   - File is valid YAML (if exists)

3. **SecureFiles validation:**
   - Sprint 374 SecureFilesValidator
   - All required files exist
   - All files are git-ignored
   - All target paths are valid

### Post-Merge Validation

**Current:** None (trust ComposeMerger output)

**Future Enhancement:** Validate merged YAML against Docker Compose schema (optional, low priority)

---

## Error Messages

### User-Facing Error Messages

#### Merge Failure

```
Error: Failed to merge 2/5 service-specific compose file(s):
  - image-gen-mcp: Invalid YAML: unexpected token at line 12
  - llm-bot: Service not found in base compose file

Fix the invalid compose files and try again.
```

#### SecureFiles Validation Failure

```
Error: SecureFiles validation failed for 1 service(s):
  - image-gen-mcp: File not git-ignored: .secure.staging/gcp-credentials.json

Add the files to .gitignore and try again.
```

#### Transfer Failure

```
Error: Failed to transfer secure files to remote host:
  - .secure.staging/gcp-credentials.json: Connection refused (attempt 3/3)

Check SSH connectivity to root@bitbrat.lan and try again.
```

---

## Testing Strategy

### Unit Tests

1. **Test: Iterative merge with no service-specific files**
   - Input: Base compose only
   - Expected: mergedYaml === baseYaml

2. **Test: Iterative merge with one service-specific file**
   - Input: Base + service A override
   - Expected: mergedYaml contains base + A overrides

3. **Test: Iterative merge with multiple service-specific files**
   - Input: Base + service A + service B overrides
   - Expected: mergedYaml contains base + A + B overrides (in order)

4. **Test: Merge conflict (last-wins)**
   - Input: Base + A (LOG_LEVEL=debug) + B (LOG_LEVEL=info)
   - Expected: mergedYaml has LOG_LEVEL=info (last wins)

5. **Test: Merge error collection**
   - Input: Base + A (valid) + B (malformed YAML)
   - Expected: Throw error with B details, A successfully merged

6. **Test: SecureFiles collection with no services**
   - Input: No services with secureFiles
   - Expected: allSecureFiles is empty, no errors

7. **Test: SecureFiles collection with multiple services**
   - Input: Service A (1 file) + Service B (2 files)
   - Expected: allSecureFiles has 2 entries

8. **Test: SecureFiles validation failure**
   - Input: Service A with invalid secureFiles
   - Expected: Throw error with validation details

---

### Integration Tests

1. **Test: Bulk deployment equivalence**
   - Deploy services A, B, C individually → capture compose files
   - Deploy services A, B, C via --all → capture merged compose file
   - Compare: Both should have identical final configuration

2. **Test: SecureFiles in bulk deployment**
   - Deploy services with secureFiles via --all
   - Verify: All files transferred, all env vars set, all volume mounts present

3. **Test: Bulk deployment dry-run**
   - Run with --dry-run flag
   - Verify: Merge happens, orchestrator not executed, temp file cleaned up

---

## Acceptance Criteria

- ✅ Design document approved
- ✅ All design decisions documented with rationale
- ✅ Merge algorithm defined step-by-step
- ✅ Error handling strategy defined
- ✅ Logging strategy defined
- ✅ Validation strategy defined
- ✅ Testing strategy defined
- ✅ Performance considerations addressed

---

## Next Steps

- **Task 378-003:** Implement service-specific compose file collection
- **Task 378-004:** Implement iterative merging
- **Task 378-005:** Implement secureFiles collection and validation

---

**Document Status:** ✅ Complete
**Design Duration:** 2 hours
**Next Task:** 378-003 (Implement compose file collection)
