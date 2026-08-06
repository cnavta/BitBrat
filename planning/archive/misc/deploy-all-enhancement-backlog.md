# Option 1 Implementation Backlog: Enhanced deployAll()

**Epic:** Fix `brat bit deploy --all` Environment Variable Handling
**Sprint:** 378
**Estimate:** 2-3 days
**Priority:** High
**Related Document:** `planning/deploy-all-env-vars-issue.md`

---

## Overview

Enhance the `deployAll()` method in `docker-compose-strategy.ts` to process service-specific configuration (compose file merging and secureFiles) before bulk deployment, ensuring identical behavior between single-service and bulk deployments.

---

## Task Breakdown by Phase

### **Phase 1: Analysis & Design** (0.5 day)

#### Task 1.1: Understand Current Implementation
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Objective:** Deep dive into existing single-service deployment flow
**Actions:**
- Read `execute()` method (lines 185-340)
- Trace compose file merging logic
- Trace secureFiles processing flow
- Document data structures and transformations

**Deliverable:** Mental model of existing flow
**Estimate:** 1 hour

---

#### Task 1.2: Design Bulk Merge Strategy
**Objective:** Design how to merge multiple service-specific compose files into one base compose
**Considerations:**
- Order of merging (does it matter?)
- Conflict resolution (last-wins vs error)
- Performance (merge N files efficiently)
- Validation (detect incompatible service configs)

**Questions to Answer:**
- What if two services override the same network config?
- What if two services declare conflicting volume names?
- Should we validate cross-service dependencies?

**Deliverable:** Design document or pseudocode
**Estimate:** 2 hours

**Dependencies:** Task 1.1

---

### **Phase 2: Core Implementation** (1 day)

#### Task 2.1: Implement Service-Specific Compose Collection
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()`
**Objective:** Collect all service-specific compose files for bulk processing

**Implementation:**
```typescript
// After line 598 in deployAll()
const serviceComposeFiles: Array<{ service: string; path: string; yaml: string }> = [];

for (const service of services) {
  const serviceComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/services',
    `${service.name}.compose.yaml`
  );

  if (fs.existsSync(serviceComposePath)) {
    const yaml = await fs.promises.readFile(serviceComposePath, 'utf-8');
    serviceComposeFiles.push({
      service: service.name,
      path: serviceComposePath,
      yaml,
    });
    console.log(`[docker-compose-strategy] Collected ${service.name}.compose.yaml`);
  }
}
```

**Tests:**
- Service without compose file → skip
- Service with compose file → collected
- Multiple services → all collected

**Estimate:** 1 hour
**Dependencies:** None

---

#### Task 2.2: Implement Iterative Compose Merging
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()`
**Objective:** Merge all collected service-specific compose files into base compose

**Implementation:**
```typescript
// Read base compose file
const baseComposePath = this.getBaseComposeFilePath(context);
let mergedYaml = await fs.promises.readFile(baseComposePath, 'utf-8');

// Merge each service-specific file
const merger = new ComposeMerger();
for (const { service, yaml } of serviceComposeFiles) {
  const mergeResult = merger.merge(mergedYaml, yaml, {
    serviceName: service,
    validationMode: 'lenient',
  });

  mergedYaml = mergeResult.yaml;

  console.log(
    `[docker-compose-strategy] Merged ${service}: ` +
    `volumes=${mergeResult.stats.volumesAdded}, ` +
    `env=${mergeResult.stats.environmentAdded}, ` +
    `deps=${mergeResult.stats.dependenciesAdded}`
  );
}
```

**Edge Cases:**
- Conflicting environment variables (last-wins)
- Duplicate volume names (should merge or error?)
- Overlapping port mappings (should detect and warn)

**Tests:**
- Single service merge → base + service overrides
- Multiple services merge → base + all overrides
- Conflicting configs → last-wins behavior
- Empty service file → no-op

**Estimate:** 2 hours
**Dependencies:** Task 2.1

---

#### Task 2.3: Implement SecureFiles Collection and Validation
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()`
**Objective:** Collect and validate secureFiles from ALL services

**Implementation:**
```typescript
// After compose merging
const allSecureFiles: Map<string, SecureFile[]> = new Map();

for (const service of services) {
  if (!service.secureFiles || service.secureFiles.length === 0) {
    continue;
  }

  // Validate secure files
  const validator = new SecureFilesValidator(repoRoot);
  const validationResult = await validator.validate(service.secureFiles, context.name);

  if (!validationResult.valid) {
    throw new Error(
      `Secure file validation failed for ${service.name}:\n` +
      validationResult.errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Log warnings
  if (validationResult.warnings.length > 0) {
    console.warn(
      `[docker-compose-strategy] Secure file warnings for ${service.name}:\n` +
      validationResult.warnings.map(w => `  - ${w}`).join('\n')
    );
  }

  // Filter by context
  const contextFiles = service.secureFiles.filter(file => {
    if (!file.context) return true;
    return file.context === context.name;
  });

  if (contextFiles.length > 0) {
    allSecureFiles.set(service.name, contextFiles);
    console.log(
      `[docker-compose-strategy] Collected ${contextFiles.length} secure file(s) for ${service.name}`
    );
  }
}
```

**Tests:**
- Service with no secureFiles → skipped
- Service with secureFiles → validated and collected
- Invalid secureFile → validation error thrown
- Context-filtered secureFiles → only matching context collected

**Estimate:** 2 hours
**Dependencies:** Task 2.1

---

#### Task 2.4: Implement SecureFiles Transfer for Remote Deployments
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()` (call existing `transferSecureFilesToRemote()`)
**Objective:** Transfer all secureFiles to remote host if SSH deployment

**Implementation:**
```typescript
// Process secure files for injection
const isRemote = context.deployment.docker?.host?.startsWith('ssh://');

for (const [serviceName, secureFiles] of allSecureFiles.entries()) {
  let volumeMounts: string[];
  const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);

  if (isRemote) {
    const remoteHost = context.deployment.docker!.host!;
    const remoteDir = context.deployment.docker!.remoteDir;

    if (!remoteDir) {
      throw new Error(
        `Remote directory not configured for context '${context.name}'. ` +
        `Set deployment.docker.remoteDir in architecture.yaml`
      );
    }

    // Transfer files to remote host (reuse existing method)
    const remotePaths = await this.transferSecureFilesToRemote(
      secureFiles,
      remoteHost,
      remoteDir,
      repoRoot
    );

    // Generate volume mounts using remote paths
    volumeMounts = secureFiles.map(file => {
      const remotePath = remotePaths.get(file.local)!;
      return `${remotePath}:${file.target}:ro`;
    });

    console.log(
      `[docker-compose-strategy] Transferred ${secureFiles.length} secure file(s) ` +
      `to ${remoteHost} for ${serviceName}`
    );
  } else {
    // Local deployment: generate volume mounts with local paths
    volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);
  }

  // Store for injection step
  secureFileVolumeMounts.set(serviceName, { volumeMounts, envVars: secureFileEnvVars });
}
```

**Tests:**
- Local deployment → volume mounts use local paths
- Remote deployment → files transferred via SCP, remote paths used
- Missing remoteDir config → error thrown

**Estimate:** 1.5 hours
**Dependencies:** Task 2.3

---

#### Task 2.5: Implement SecureFiles Injection into Merged Compose
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()`
**Objective:** Inject volume mounts and environment variables from secureFiles

**Implementation:**
```typescript
// After all transfers complete
for (const [serviceName, { volumeMounts, envVars }] of secureFileVolumeMounts.entries()) {
  mergedYaml = merger.injectSecureFiles(
    mergedYaml,
    serviceName,
    volumeMounts,
    envVars
  );

  console.log(
    `[docker-compose-strategy] Injected ${volumeMounts.length} volume mount(s) and ` +
    `${Object.keys(envVars).length} env var(s) for ${serviceName}`
  );
}
```

**Tests:**
- SecureFile with env var → environment variable injected
- SecureFile with volume → volume mount injected
- Multiple secureFiles → all injected correctly

**Estimate:** 1 hour
**Dependencies:** Task 2.4

---

#### Task 2.6: Implement Temporary Merged Compose File Handling
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()`
**Objective:** Write merged compose to temp file, use for deployment, cleanup after

**Implementation:**
```typescript
// Write temporary merged compose file
const tempComposePath = path.join(
  repoRoot,
  'infrastructure/docker-compose/.docker-compose.merged.yaml'
);

await fs.promises.writeFile(tempComposePath, mergedYaml);
console.log(`[docker-compose-strategy] Wrote merged compose to ${tempComposePath}`);

try {
  // Use merged compose for deployment
  const orchestratorOptions: DockerOrchestratorOptions = {
    repoRoot,
    context: context.name,
    service: undefined, // Deploy all
    dryRun: options.dryRun || false,
    forceRecreate: options.forceRecreate || false,
    noCache: options.forceBuild || false,
    rebuildBase: options.rebuildBase || false,
    loki: options.loki || false,
    noDeps: options.noDeps || false,
    composeFile: tempComposePath, // IMPORTANT: Use merged file
  };

  const orchestrator = new DockerOrchestrator(orchestratorOptions);
  await orchestrator.up();

  // Success!
  const durationMs = Date.now() - startTime;
  return services.map(service => ({
    status: 'success' as const,
    service: service.name,
    durationMs,
    metadata: { containerId: `bitbrat-${context.name}-${service.name}` },
  }));

} catch (error: any) {
  const durationMs = Date.now() - startTime;
  return services.map(service => ({
    status: 'failed' as const,
    service: service.name,
    durationMs,
    error: error.message || String(error),
  }));
} finally {
  // ALWAYS cleanup temporary file
  if (fs.existsSync(tempComposePath)) {
    await fs.promises.unlink(tempComposePath);
    console.log(`[docker-compose-strategy] Cleaned up ${tempComposePath}`);
  }
}
```

**Tests:**
- Temp file created → exists during deployment
- Deployment succeeds → temp file cleaned up
- Deployment fails → temp file still cleaned up
- Process crashes → temp file cleaned up (requires OS-level testing)

**Estimate:** 1 hour
**Dependencies:** Task 2.5

---

#### Task 2.7: Update DockerOrchestrator to Accept Custom Compose File
**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Objective:** Allow orchestrator to use a custom compose file path instead of auto-detection

**Current Behavior:**
```typescript
// orchestrator.ts line 68
const composeFileSet = this.composeFactory.getComposeFiles(
  this.options.service,
  inactiveServices,
  this.options.loki
);
```

**New Behavior:**
```typescript
export interface DockerOrchestratorOptions {
  // ... existing options ...
  composeFile?: string; // NEW: Override compose file path
}

// In up() method:
const composeFileSet = this.options.composeFile
  ? { baseFile: this.options.composeFile, serviceFiles: [], targetService: null }
  : this.composeFactory.getComposeFiles(
      this.options.service,
      inactiveServices,
      this.options.loki
    );
```

**Tests:**
- composeFile option provided → use custom file
- composeFile option not provided → use auto-detection (existing behavior)

**Estimate:** 1 hour
**Dependencies:** Task 2.6

---

### **Phase 3: Error Handling & Logging** (0.25 day)

#### Task 3.1: Add Error Handling for Compose Merge Conflicts
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Objective:** Detect and handle merge conflicts gracefully

**Scenarios:**
1. **Service not found in base compose**
   - Should skip or error?
   - Decision: Skip with warning (lenient mode)

2. **Duplicate volume names**
   - Should merge or error?
   - Decision: Allow (Docker handles conflicts)

3. **Conflicting port mappings**
   - Should detect and error?
   - Decision: Detect and warn (Docker will error anyway)

**Implementation:**
```typescript
try {
  const mergeResult = merger.merge(mergedYaml, yaml, {
    serviceName: service,
    validationMode: 'lenient',
  });

  if (mergeResult.warnings.length > 0) {
    console.warn(
      `[docker-compose-strategy] Merge warnings for ${service}:\n` +
      mergeResult.warnings.map(w => `  - ${w}`).join('\n')
    );
  }

  mergedYaml = mergeResult.yaml;

} catch (error: any) {
  throw new Error(
    `Failed to merge compose file for ${service}: ${error.message}`
  );
}
```

**Estimate:** 1 hour
**Dependencies:** Task 2.2

---

#### Task 3.2: Add Comprehensive Logging
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Objective:** Log all processing steps for debugging

**Log Points:**
1. Start of deployAll()
2. Service compose file collection
3. Each compose merge operation
4. SecureFiles collection and validation
5. SecureFiles transfer (if remote)
6. SecureFiles injection
7. Temp file creation
8. Orchestrator execution
9. Temp file cleanup
10. Success/failure summary

**Example:**
```typescript
console.log(`[docker-compose-strategy] ========================================`);
console.log(`[docker-compose-strategy] Bulk deployment starting`);
console.log(`[docker-compose-strategy] Services: ${services.map(s => s.name).join(', ')}`);
console.log(`[docker-compose-strategy] Context: ${context.name}`);
console.log(`[docker-compose-strategy] ========================================`);
```

**Estimate:** 30 minutes
**Dependencies:** All Phase 2 tasks

---

### **Phase 4: Testing** (0.5 day)

#### Task 4.1: Unit Test - Compose File Processing
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts` (new)
**Objective:** Test that deployAll() processes service-specific compose files

**Test Cases:**
```typescript
describe('DockerComposeStrategy.deployAll()', () => {
  describe('Service-Specific Compose Files', () => {
    it('should collect service-specific compose files', async () => {
      // Given: 2 services with compose files, 1 without
      // When: deployAll() is called
      // Then: 2 compose files collected
    });

    it('should merge service-specific compose into base', async () => {
      // Given: Service with environment override
      // When: deployAll() is called
      // Then: Merged compose contains override
    });

    it('should merge multiple services without conflicts', async () => {
      // Given: 3 services with different overrides
      // When: deployAll() is called
      // Then: All overrides present in merged compose
    });
  });
});
```

**Estimate:** 2 hours
**Dependencies:** Task 2.2

---

#### Task 4.2: Unit Test - SecureFiles Validation
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts`
**Objective:** Test secureFiles validation in bulk deployment

**Test Cases:**
```typescript
describe('SecureFiles Validation', () => {
  it('should validate secureFiles for all services', async () => {
    // Given: 2 services with secureFiles
    // When: deployAll() is called
    // Then: Both services' files validated
  });

  it('should throw error if secureFile validation fails', async () => {
    // Given: Service with non-existent secureFile
    // When: deployAll() is called
    // Then: Error thrown with service name
  });

  it('should filter secureFiles by execution context', async () => {
    // Given: SecureFile with context: staging, deploying to local
    // When: deployAll() is called
    // Then: File skipped
  });
});
```

**Estimate:** 1.5 hours
**Dependencies:** Task 2.3

---

#### Task 4.3: Unit Test - Remote SecureFiles Transfer
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts`
**Objective:** Test secureFiles transfer for remote deployments

**Test Cases:**
```typescript
describe('Remote SecureFiles Transfer', () => {
  it('should transfer secureFiles to remote host', async () => {
    // Given: Service with secureFile, SSH deployment
    // When: deployAll() is called
    // Then: transferSecureFilesToRemote() called with correct args
  });

  it('should use remote paths for volume mounts', async () => {
    // Given: Remote deployment
    // When: deployAll() is called
    // Then: Volume mounts use remote paths
  });

  it('should throw error if remoteDir not configured', async () => {
    // Given: SSH deployment without remoteDir
    // When: deployAll() is called
    // Then: Error thrown
  });
});
```

**Estimate:** 1 hour
**Dependencies:** Task 2.4

---

#### Task 4.4: Unit Test - SecureFiles Injection
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts`
**Objective:** Test secureFiles environment variable and volume injection

**Test Cases:**
```typescript
describe('SecureFiles Injection', () => {
  it('should inject environment variables from secureFiles', async () => {
    // Given: SecureFile with env: GOOGLE_APPLICATION_CREDENTIALS
    // When: deployAll() is called
    // Then: Merged compose contains environment variable
  });

  it('should inject volume mounts from secureFiles', async () => {
    // Given: SecureFile with target path
    // When: deployAll() is called
    // Then: Merged compose contains volume mount
  });

  it('should inject multiple secureFiles for same service', async () => {
    // Given: Service with 2 secureFiles
    // When: deployAll() is called
    // Then: Both files injected
  });
});
```

**Estimate:** 1 hour
**Dependencies:** Task 2.5

---

#### Task 4.5: Unit Test - Merge Conflict Handling
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts`
**Objective:** Test graceful handling of merge conflicts

**Test Cases:**
```typescript
describe('Merge Conflict Handling', () => {
  it('should handle conflicting environment variables (last-wins)', async () => {
    // Given: Two services setting same env var to different values
    // When: deployAll() is called
    // Then: Last service's value used
  });

  it('should warn on service not found in base compose', async () => {
    // Given: Service-specific file for non-existent service
    // When: deployAll() is called
    // Then: Warning logged, continues
  });
});
```

**Estimate:** 1 hour
**Dependencies:** Task 3.1

---

#### Task 4.6: Integration Test - Single vs Bulk Equivalence
**File:** `tests/integration/deployment-equivalence.spec.ts` (new)
**Objective:** Verify single and bulk deployments produce identical results

**Test:**
```typescript
describe('Deployment Equivalence', () => {
  it('should produce identical environments for single vs bulk deployment', async () => {
    // Given: 3 services (llm-bot, event-router, reflex)

    // When: Deploy individually
    await strategy.execute(preparePlan('llm-bot'));
    await strategy.execute(preparePlan('event-router'));
    await strategy.execute(preparePlan('reflex'));
    const singleEnv = await getContainerEnv('llm-bot');

    // Teardown
    await teardown();

    // When: Deploy via --all
    await strategy.deployAll([llm-bot, event-router, reflex], context, options);
    const bulkEnv = await getContainerEnv('llm-bot');

    // Then: Environment variables identical
    expect(bulkEnv).toEqual(singleEnv);
  });
});
```

**Estimate:** 2 hours
**Dependencies:** All Phase 2 tasks

---

#### Task 4.7: Integration Test - SecureFiles in Bulk Deployment
**File:** `tests/integration/bulk-deployment-securefiles.spec.ts` (new)
**Objective:** Verify secureFiles work correctly in bulk deployment

**Test:**
```typescript
describe('Bulk Deployment SecureFiles', () => {
  it('should mount secureFiles and set environment variables', async () => {
    // Given: image-gen-mcp with GOOGLE_APPLICATION_CREDENTIALS from secureFile

    // When: Deploy via --all
    await strategy.deployAll([imageGenMcp], context, options);

    // Then: File mounted
    const fileExists = await execInContainer(
      'image-gen-mcp',
      'test -f /var/secrets/gcp-credentials.json'
    );
    expect(fileExists).toBe(true);

    // Then: Env var set
    const envVar = await getContainerEnv('image-gen-mcp', 'GOOGLE_APPLICATION_CREDENTIALS');
    expect(envVar).toBe('/var/secrets/gcp-credentials.json');
  });
});
```

**Estimate:** 1.5 hours
**Dependencies:** All Phase 2 tasks

---

### **Phase 5: Staging Validation** (0.25 day)

#### Task 5.1: Test Bulk Deployment in Staging
**Environment:** staging (bitbrat.lan)
**Objective:** Validate enhanced deployAll() works in real environment

**Steps:**
1. Deploy all services via `brat bit deploy --all --context staging`
2. Verify all services start successfully
3. Check logs for FeedbackMiddleware initialization (llm-bot)
4. Verify secureFiles-dependent services work (image-gen-mcp)
5. Check for any error logs or warnings

**Acceptance Criteria:**
- ✅ All services start within 2 minutes
- ✅ No deployment errors
- ✅ All health checks pass
- ✅ SecureFiles-dependent services functional

**Estimate:** 1 hour
**Dependencies:** All Phase 2 tasks

---

#### Task 5.2: Verify image-gen-mcp GCP Credentials
**Environment:** staging
**Objective:** Confirm GCP authentication works via --all deployment

**Steps:**
1. Check image-gen-mcp container environment
   ```bash
   ssh root@bitbrat.lan "docker exec bitbrat-staging-image-gen-mcp-1 env | grep GOOGLE"
   ```
2. Verify file exists
   ```bash
   ssh root@bitbrat.lan "docker exec bitbrat-staging-image-gen-mcp-1 ls -la /var/secrets/"
   ```
3. Test GCP API call (if service has test endpoint)

**Acceptance Criteria:**
- ✅ GOOGLE_APPLICATION_CREDENTIALS environment variable set
- ✅ /var/secrets/gcp-credentials.json exists and has correct permissions (400)
- ✅ Service can authenticate to GCP

**Estimate:** 30 minutes
**Dependencies:** Task 5.1

---

#### Task 5.3: Performance Benchmark
**Objective:** Measure deployment time for different modes

**Scenarios:**
1. **Single Service Deployment**
   ```bash
   time brat bit deploy llm-bot event-router reflex --context staging
   ```

2. **Sequential Deployment (current --all)**
   ```bash
   time brat bit deploy --all --context staging
   ```
   (Before enhancement)

3. **Enhanced Bulk Deployment**
   ```bash
   time brat bit deploy --all --context staging
   ```
   (After enhancement)

**Metrics:**
- Total deployment time
- Time per service
- Docker build time
- Docker compose up time

**Expected Results:**
- Single service: ~30s per service = ~90s total
- Sequential (old): ~30s per service = ~90s total
- Enhanced bulk: ~50s total (10s processing + 40s docker compose)

**Estimate:** 30 minutes
**Dependencies:** Task 5.1

---

### **Phase 6: Documentation** (0.25 day)

#### Task 6.1: Update Deployment Strategy Documentation
**File:** `documentation/guides/deployment-strategy.md` (or create if missing)
**Objective:** Document deployAll() behavior and enhancements

**Sections to Add:**
```markdown
## Bulk Deployment (--all flag)

### How It Works

The `--all` flag uses an optimized bulk deployment strategy that:

1. **Collects service-specific configuration** from `infrastructure/docker-compose/services/*.compose.yaml`
2. **Validates and processes secureFiles** for all services
3. **Merges all configuration** into a single temporary compose file
4. **Executes single `docker compose up`** for all services

### Performance

Bulk deployment is faster than deploying services individually:
- Single service: ~30 seconds
- 3 services individually: ~90 seconds
- 3 services via --all: ~50 seconds

### Behavior Guarantees

Bulk deployment produces **identical results** to deploying services individually:
- Same environment variables
- Same volume mounts
- Same secureFiles processing
- Same service dependencies

### When to Use --all

✅ **Use --all when:**
- Deploying all active services
- Initial environment setup
- Full stack updates

❌ **Deploy individually when:**
- Testing single service changes
- Debugging specific service
- Avoiding full stack restart
```

**Estimate:** 1 hour
**Dependencies:** Task 5.3 (for performance numbers)

---

#### Task 6.2: Update User Guide
**File:** `documentation/guides/deployment.md`
**Objective:** Document --all flag usage and behavior

**Sections to Update:**

**Before:**
```markdown
## Deploying All Services

To deploy all active services:

```bash
brat bit deploy --all --context staging
```

**Known Limitations:**
- Service-specific compose files not merged
- SecureFiles not processed in bulk mode
- Workaround: Deploy services individually
```

**After:**
```markdown
## Deploying All Services

To deploy all active services in a single operation:

```bash
brat bit deploy --all --context staging
```

This uses an optimized bulk deployment that:
- Merges all service-specific compose configurations
- Processes secureFiles for all services
- Executes a single `docker compose up` call

**Equivalent to deploying individually:**
```bash
brat bit deploy llm-bot --context staging
brat bit deploy event-router --context staging
brat bit deploy reflex --context staging
# ... etc
```

But faster (~50s vs ~90s for 3 services).
```

**Estimate:** 30 minutes
**Dependencies:** None

---

#### Task 6.3: Add Troubleshooting Section
**File:** `documentation/guides/troubleshooting-deployment.md` (or add to existing)
**Objective:** Help users debug bulk deployment issues

**Content:**
```markdown
## Troubleshooting Bulk Deployment (--all)

### Issue: Services Missing Environment Variables

**Symptom:**
```
Service 'llm-bot' fails with "OPENAI_API_KEY not set"
```

**Diagnosis:**
Check if environment variables are defined in:
1. `env/{context}/global.yaml`
2. `env/{context}/{service}.yaml`
3. `.secure.{context}/.env`

**Resolution:**
Add missing variables to appropriate env file, then redeploy.

---

### Issue: SecureFiles Not Mounted

**Symptom:**
```
Service 'image-gen-mcp' fails with "credentials file not found"
```

**Diagnosis:**
1. Check `architecture.yaml` for `secureFiles` declaration
2. Verify file exists at `local` path
3. Check `context` filter matches deployment context

**Resolution:**
Ensure secureFile declaration is correct:
```yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        context: staging  # Must match deployment context
```

---

### Issue: Compose Merge Conflicts

**Symptom:**
```
Failed to merge compose file for llm-bot: duplicate key 'environment'
```

**Diagnosis:**
Service-specific compose file conflicts with another service's config.

**Resolution:**
Review merge order and ensure service-specific files only override service-specific sections, not shared resources.
```

**Estimate:** 1 hour
**Dependencies:** Task 5.1 (real-world debugging)

---

#### Task 6.4: Create Migration Guide
**File:** `documentation/guides/migration-deploy-all-enhancement.md` (new)
**Objective:** Help users migrate from workaround to fixed version

**Content:**
```markdown
# Migration Guide: Enhanced Bulk Deployment

## What Changed

**Before Sprint 378:**
The `--all` flag did not process service-specific configuration:
- Service-specific compose files ignored
- SecureFiles not validated or mounted
- Environment variables from secureFiles missing

**Workaround:**
Deploy services with secureFiles individually.

**After Sprint 378:**
The `--all` flag now processes all service-specific configuration, producing identical results to individual deployments.

## Migration Steps

### Step 1: Verify Your Configuration

Ensure all service-specific config is properly declared:

**architecture.yaml:**
```yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS
        context: staging
```

**Service-specific compose (optional):**
`infrastructure/docker-compose/services/llm-bot.compose.yaml`

### Step 2: Test in Staging

Deploy via `--all` flag:
```bash
brat bit deploy --all --context staging
```

Verify all services start correctly:
```bash
brat fleet list --context staging
```

### Step 3: Verify SecureFiles

For services with secureFiles:
```bash
# Check environment variable
ssh root@bitbrat.lan "docker exec bitbrat-staging-image-gen-mcp-1 env | grep GOOGLE"

# Check file exists
ssh root@bitbrat.lan "docker exec bitbrat-staging-image-gen-mcp-1 ls -la /var/secrets/"
```

### Step 4: Deploy to Production

Once validated in staging:
```bash
brat bit deploy --all --context prod
```

## Rollback Plan

If issues occur, deploy services individually:
```bash
brat bit deploy llm-bot event-router reflex --context staging
```

## FAQ

**Q: Do I need to change anything?**
A: No, existing configurations work without changes.

**Q: Will --all be slower now?**
A: Slightly (~5-10s overhead for processing), but still faster than deploying individually.

**Q: What if I have custom deployment scripts?**
A: They continue to work. The enhancement only affects `brat bit deploy --all`.
```

**Estimate:** 1 hour
**Dependencies:** Task 5.1

---

### **Phase 7: Final Validation & Commit** (0.25 day)

#### Task 7.1: Run Full Test Suite
**Objective:** Ensure no regressions in existing functionality

**Commands:**
```bash
npm test                                    # Unit tests
npm test -- docker-compose-strategy        # Strategy-specific tests
npm test -- deployment-equivalence         # Integration tests
npm run build                              # TypeScript compilation
npm run lint                               # Code quality
```

**Acceptance Criteria:**
- ✅ All existing tests pass
- ✅ New tests pass
- ✅ No TypeScript errors
- ✅ No linting errors
- ✅ No new warnings

**Estimate:** 1 hour
**Dependencies:** All previous tasks

---

#### Task 7.2: Commit Enhanced deployAll() Implementation
**Objective:** Commit with comprehensive message and documentation

**Commit Message:**
```
feat(deployment): Enhance deployAll() to process service-specific config

Sprint 378: Fix bulk deployment (--all flag) environment variable handling

**Problem:**
The --all flag used a different code path (deployAll()) that skipped:
- Service-specific compose file merging
- SecureFiles validation and processing
- Environment variable injection from secureFiles

This caused services deployed via --all to fail with missing credentials
or incorrect configuration.

**Solution:**
Enhanced deployAll() to:
1. Collect all service-specific compose files
2. Iteratively merge into base compose
3. Validate and process secureFiles for ALL services
4. Transfer secureFiles to remote host (if SSH)
5. Inject volume mounts and environment variables
6. Write temporary merged compose file
7. Execute single `docker compose up` with merged config

**Impact:**
- Bulk deployment now produces IDENTICAL results to individual deployment
- Services with secureFiles now work correctly via --all
- Maintains performance benefit of single `docker compose up` call

**Testing:**
- 8 new unit tests for compose merging and secureFiles processing
- 2 new integration tests for deployment equivalence
- Validated in staging environment with all services
- Performance benchmark: 50s for 3 services (vs 90s individually)

**Breaking Changes:** None
**Backward Compatibility:** Full

Related: planning/deploy-all-env-vars-issue.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Files to Commit:**
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- `tools/brat/src/orchestration/docker/orchestrator.ts`
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts` (new)
- `tests/integration/deployment-equivalence.spec.ts` (new)
- `tests/integration/bulk-deployment-securefiles.spec.ts` (new)
- `documentation/guides/deployment-strategy.md`
- `documentation/guides/deployment.md`
- `documentation/guides/troubleshooting-deployment.md`
- `documentation/guides/migration-deploy-all-enhancement.md`
- `planning/deploy-all-env-vars-issue.md`
- `planning/deploy-all-enhancement-backlog.md`

**Estimate:** 30 minutes
**Dependencies:** Task 7.1

---

#### Task 7.3: Create Pull Request
**Objective:** Create PR with comprehensive description

**PR Title:**
```
feat(deployment): Fix bulk deployment environment variable handling (Sprint 378)
```

**PR Description:**
```markdown
## Summary

Fixes a critical issue where `brat bit deploy --all` skipped service-specific configuration processing, causing services to fail with missing environment variables and credentials.

## Problem

The `--all` flag used `deployAll()` which bypassed:
- Service-specific compose file merging (`services/*.compose.yaml`)
- SecureFiles validation and processing
- Environment variable injection from secureFiles (e.g., `GOOGLE_APPLICATION_CREDENTIALS`)

**Example:**
- ✅ `brat bit deploy image-gen-mcp` → Works (GCP credentials mounted)
- ❌ `brat bit deploy --all` → Fails (credentials missing)

## Solution

Enhanced `deployAll()` to:
1. Collect and merge ALL service-specific compose files
2. Validate and process secureFiles for ALL services
3. Transfer files to remote host (if SSH deployment)
4. Inject volume mounts and environment variables
5. Execute single `docker compose up` with merged configuration

## Testing

**Unit Tests:**
- ✅ Compose file merging (4 tests)
- ✅ SecureFiles validation (3 tests)
- ✅ Remote transfer (2 tests)
- ✅ Environment variable injection (3 tests)

**Integration Tests:**
- ✅ Single vs bulk deployment equivalence
- ✅ SecureFiles work in bulk deployment

**Staging Validation:**
- ✅ All services deployed via `--all`
- ✅ image-gen-mcp GCP credentials functional
- ✅ Performance: 50s for 3 services (was 90s individually)

## Breaking Changes

None. Fully backward compatible.

## Documentation

- [x] Deployment strategy guide updated
- [x] User guide updated
- [x] Troubleshooting guide added
- [x] Migration guide created

## Related

- Issue: planning/deploy-all-env-vars-issue.md
- Sprint: 378
- Epic: Deployment Consistency

## Checklist

- [x] Code follows project conventions
- [x] Tests added and passing
- [x] Documentation updated
- [x] Backward compatible
- [x] Staging validated
- [x] Performance benchmarked
```

**Labels:**
- `enhancement`
- `deployment`
- `sprint-378`
- `high-priority`

**Reviewers:** (Assign appropriate reviewers)

**Estimate:** 30 minutes
**Dependencies:** Task 7.2

---

## Task Summary

| Phase | Tasks | Total Estimate |
|-------|-------|----------------|
| Phase 1: Analysis & Design | 2 | 3 hours |
| Phase 2: Core Implementation | 7 | 10.5 hours |
| Phase 3: Error Handling & Logging | 2 | 1.5 hours |
| Phase 4: Testing | 7 | 10.5 hours |
| Phase 5: Staging Validation | 3 | 2 hours |
| Phase 6: Documentation | 4 | 3.5 hours |
| Phase 7: Final Validation & Commit | 3 | 2 hours |
| **TOTAL** | **28** | **33 hours (~4 days)** |

## Critical Path

```
1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 5.1 → 7.1 → 7.2 → 7.3
```

## Parallel Work Opportunities

- **Phase 3 (Error Handling)** can start once Phase 2 tasks 2.1-2.5 are complete
- **Phase 4 (Testing)** can be done in parallel with Phase 3
- **Phase 6 (Documentation)** can be done in parallel with Phase 4

## Risk Mitigation

1. **Compose Merge Conflicts**
   - Risk: Services with conflicting configurations fail to merge
   - Mitigation: Use lenient merge mode, log warnings, allow last-wins

2. **Performance Degradation**
   - Risk: Processing overhead makes --all slower than individual deployments
   - Mitigation: Benchmark early, optimize merge algorithm

3. **Breaking Existing Deployments**
   - Risk: Changes break existing --all workflows
   - Mitigation: Comprehensive testing, staging validation before prod

## Success Criteria

- ✅ All 28 tasks completed
- ✅ All tests passing (existing + new)
- ✅ Staging validation successful
- ✅ Performance maintained or improved
- ✅ Documentation complete
- ✅ Zero breaking changes

---

**Document Status:** Ready for Implementation
**Next Action:** Begin Phase 1 (Analysis & Design)
