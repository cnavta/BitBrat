# Sprint 378: Key Learnings

**Sprint:** Deploy All Enhancement
**Date:** 2026-08-01
**Duration:** 3 days

---

## Technical Insights

### 1. Docker Compose Port Conflicts Prevent Network Attachment

**Discovery:**
When multiple services default to the same host port, Docker Compose creates containers but **fails to start them**. Containers that fail to start are **never connected to Docker networks**, causing DNS resolution failures.

**Root Cause:**
```yaml
# Multiple services with same default port
services:
  tool-gateway:
    ports:
      - "${TOOL_GATEWAY_HOST_PORT:-3001}:3000"
  auth:
    ports:
      - "${AUTH_HOST_PORT:-3001}:3000"  # Conflict!
```

**Symptom:**
```
Error: getaddrinfo EAI_AGAIN nats.bitbrat.local
```

**Why This Happens:**
1. Docker Compose processes services in parallel
2. First container claims port 3001 successfully
3. Second container fails with "port already allocated"
4. Failed container is created but never started
5. Never started = never connected to `bitbrat-network`
6. No network = DNS resolution fails for network aliases

**Detection:**
```bash
# Check container networks
docker inspect bitbrat-staging-auth-1 | jq '.[0].NetworkSettings.Networks'
# Output: {} (empty - no networks!)
```

**Fix:**
Assign unique host ports via environment variables:
```yaml
# env/staging/global.yaml
TOOL_GATEWAY_HOST_PORT: '3013'
AUTH_HOST_PORT: '3004'
```

**Lesson:** Port conflicts don't just cause binding errors - they prevent network attachment, which manifests as DNS failures, not port errors.

**Prevention:**
- Use unique default ports in service compose files
- Implement PortManager for automatic port assignment
- Add pre-deployment port conflict validation

---

### 2. PortManager Exists But Was Never Integrated

**Discovery:**
The platform has a fully-functional `PortManager` class that auto-assigns unique ports, but it was **never integrated** into the new `deployAll()` method.

**Location:**
`tools/brat/src/orchestration/docker/port-manager.ts`

**What It Does:**
```typescript
export class PortManager {
  // Discovers ports in use by running containers (local or remote via SSH)
  private async discoverUsedPorts(targetConfig: any): Promise<Set<number>>;

  // Two-pass algorithm: explicit ports first, then auto-assign
  public async resolvePorts(
    serviceFiles: string[],
    env: { [key: string]: any },
    targetConfig?: any
  ): Promise<PortAssignment[]>;

  // Generates env overrides like { TOOL_GATEWAY_HOST_PORT: "3013" }
  public getEnvOverrides(assignments: PortAssignment[]): { [key: string]: string };
}
```

**Where It's Used:**
- ✅ Single-service deployments: `orchestrator.ts:318-319`
- ❌ Bulk deployments: Missing from `deployAll()`

**Why This Matters:**
Single-service deployments auto-assign ports, bulk deployments don't. This creates **inconsistent behavior** and requires manual port configuration.

**Proper Integration:**
```typescript
async deployAll(services: string[], context: ExecutionContext): Promise<void> {
  // ... merge compose files ...

  // NEW: Auto-assign ports
  const portManager = new PortManager();
  const assignments = await portManager.resolvePorts(serviceFiles, env, context.deployment.docker);
  const portOverrides = portManager.getEnvOverrides(assignments);
  Object.assign(env, portOverrides);

  // ... continue deployment ...
}
```

**Lesson:** Always search for existing components before implementing new logic. PortManager existed but was undiscovered during initial analysis.

**Action Item:** Implement Bug #19 (PortManager integration) in Sprint 379

---

### 3. Last-Wins Merge Strategy for Docker Compose

**Pattern:**
When merging multiple Docker Compose files, use **last-wins** strategy for conflicts instead of failing.

**Implementation:**
```typescript
let mergedYaml = baseYaml;

for (const serviceFile of serviceFiles) {
  const mergeResult = merger.merge(mergedYaml, serviceFile.yaml, {
    serviceName: serviceFile.service,
    validationMode: 'lenient',  // Last-wins for conflicts
  });
  mergedYaml = mergeResult.yaml;
}
```

**Why Last-Wins:**
- **Predictable:** User controls resolution order via architecture.yaml
- **Lenient:** Doesn't block deployments on benign conflicts
- **Transparent:** Merge order visible in config
- **Practical:** Strict mode would require perfect conflict-free configs

**Example:**
```yaml
# Service 1 sets PORT=3000
# Service 2 sets PORT=4000
# Result: PORT=4000 (last service wins)
```

**Trade-off:**
- ✅ Pro: Deployments succeed even with conflicts
- ⚠️ Con: Silent conflicts (only logged, not failed)

**When to Use:**
- Bulk deployments where strict validation would be too rigid
- User-controlled merge order (architecture.yaml)
- Non-critical conflicts (environment variables, labels)

**When NOT to Use:**
- Security-critical configurations
- When conflicts indicate design problems
- When user expects explicit conflict resolution

**Lesson:** Last-wins is pragmatic for bulk deployments, but requires comprehensive logging.

---

### 4. SecureFiles Transfer Requires Remote Path Remapping

**Discovery:**
When transferring secureFiles to remote hosts via SSH, volume mounts must use **remote paths**, not local paths.

**Local Deployment (Direct Mount):**
```yaml
services:
  image-gen-mcp:
    volumes:
      - /Users/user/IdeaProjects/BitBratPlatform/.secure.local/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
```

**Remote Deployment (SCP Transfer):**
```typescript
// 1. Transfer file to remote host
await transferSecureFilesToRemote(secureFiles, remoteHost, remoteDir, repoRoot);
// Transfers to: /opt/BitBratPlatform/.secure.staging/gcp-credentials.json

// 2. Generate volume mounts with remote paths
const volumeMounts = secureFiles.map(file => {
  const remotePath = `/opt/BitBratPlatform/${file.local}`;
  return `${remotePath}:${file.target}:ro`;
});
```

**Result:**
```yaml
services:
  image-gen-mcp:
    volumes:
      - /opt/BitBratPlatform/.secure.staging/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
```

**Why This Matters:**
Using local paths in remote deployments causes "file not found" errors because Docker on the remote host looks for files **on the remote filesystem**, not local.

**Lesson:** Always remap paths when crossing filesystem boundaries (local → remote).

---

### 5. Temporary File Cleanup Must Use Finally Block

**Pattern:**
Always use `try/finally` for temporary file cleanup, never `try/catch`.

**Anti-Pattern:**
```typescript
// ❌ BAD: Cleanup skipped on early return or throw
const tempFile = path.join(repoRoot, '.temp.yaml');
await fs.promises.writeFile(tempFile, yaml);

await orchestrator.up();

await fs.promises.unlink(tempFile); // Skipped on error!
```

**Correct Pattern:**
```typescript
// ✅ GOOD: Cleanup always runs
const tempFile = path.join(repoRoot, '.temp.yaml');
await fs.promises.writeFile(tempFile, yaml);

try {
  await orchestrator.up();
} finally {
  try {
    if (fs.existsSync(tempFile)) {
      await fs.promises.unlink(tempFile);
    }
  } catch (cleanupError: any) {
    console.warn(`Failed to cleanup: ${cleanupError.message}`);
  }
}
```

**Why Double Try/Catch:**
- Outer `try/finally`: Guarantees cleanup runs
- Inner `try/catch`: Prevents cleanup errors from masking original error

**Lesson:** Temporary files are leaks waiting to happen - always use `finally`.

**Test Coverage:**
```typescript
it('should cleanup temporary file even on deployment error', async () => {
  orchestratorMock.up.mockRejectedValue(new Error('Deployment failed'));

  await expect(strategy.deployAll(services, context, options)).rejects.toThrow();

  expect(fs.existsSync(tempMergedPath)).toBe(false); // Cleanup happened!
});
```

---

### 6. Docker Compose Networks: External vs Managed

**Discovery:**
Bulk deployments failed when using `external: true` for networks. Switching to **managed networks** (created by Docker Compose) fixed the issue.

**Before (External Network):**
```yaml
networks:
  bitbrat-network:
    external: true  # Assumes network exists
    name: bitbrat-network
```

**Problem:**
External networks must be created manually before deployment. In bulk mode, the network may not exist yet, causing "network not found" errors.

**After (Managed Network):**
```yaml
networks:
  bitbrat-network:
    driver: bridge
    name: bitbrat-network
```

**Why This Works:**
- Docker Compose creates network if it doesn't exist
- Idempotent (safe to re-create)
- Works for both single and bulk deployments

**When to Use External:**
- Network shared across multiple Compose projects
- Network has specific configuration (subnets, gateways)
- Network managed by external tool (Terraform, Ansible)

**When to Use Managed:**
- Network only used by this Compose project
- Deployment should be self-contained
- Network configuration is simple (default driver)

**Lesson:** Prefer managed networks for deployment simplicity unless external is required.

---

### 7. Staging Validation Reveals Issues Unit Tests Miss

**Discovery:**
Unit tests achieved 100% code coverage but missed 3 critical bugs that only appeared in staging.

**Bugs Found Only in Staging:**
1. **Bug #17:** Port conflicts causing network isolation
2. **Bug #18:** Individual service port conflicts
3. **Bug #19:** Missing PortManager integration

**Why Unit Tests Missed These:**
- **Port conflicts:** Unit tests mock Docker, don't actually bind ports
- **Network isolation:** Unit tests don't validate Docker network attachment
- **PortManager:** Unit tests didn't trace full deployment flow

**What Staging Revealed:**
- Real Docker Compose environment
- Actual port binding and network creation
- Multi-service interactions
- Remote SSH deployment
- DNS resolution across services

**Lesson:** Unit tests validate logic, staging validates integration. Both are essential.

**Recommendation:**
- Always validate in staging before PR
- Create integration tests for deployment equivalence
- Automate staging deployment testing in CI

---

### 8. Environment Variable Precedence Matters

**Discovery:**
When merging environment variables from multiple sources, order matters for override behavior.

**Sources (Highest to Lowest Priority):**
1. Runtime flags (`--env VAR=value`)
2. SecureFiles environment variables
3. Service-specific environment variables
4. Global environment variables
5. Infrastructure environment variables
6. Default values in compose files

**Implementation:**
```typescript
// 1. Start with global env
const env = this.envResolver.resolve(context.envOverlay.path, context.envOverlay.secure);

// 2. Merge secureFiles env vars (higher priority)
const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);
Object.assign(env, secureFileEnvVars);

// 3. Merge PortManager overrides (highest priority)
const portOverrides = portManager.getEnvOverrides(assignments);
Object.assign(env, portOverrides);
```

**Why Precedence Matters:**
- PortManager should override explicit config (conflict resolution)
- SecureFiles should override global config (security)
- Global should override defaults (user control)

**Anti-Pattern:**
```typescript
// ❌ BAD: Port overrides merged first, then global
Object.assign(env, portOverrides);
Object.assign(env, globalEnv); // Overwrites port assignments!
```

**Correct Pattern:**
```typescript
// ✅ GOOD: Global first, then overrides
Object.assign(env, globalEnv);
Object.assign(env, portOverrides); // Overrides global
```

**Lesson:** Be explicit about merge order and document precedence rules.

---

### 9. Health Check Failures Don't Always Mean Service Failures

**Discovery:**
2 services reported "unhealthy" status but were actually running and processing messages correctly.

**Services:** stream-analyst-service, context-pack

**Symptom:**
```bash
docker ps
# stream-analyst-service: unhealthy
```

**Actual Status:**
- Service running ✅
- Processing messages ✅
- Health check endpoint returns 404 ❌

**Root Cause:**
Health check configured in Docker Compose:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
```

But service doesn't implement `/healthz` endpoint!

**Why This Matters:**
- Docker reports unhealthy but service works
- Monitoring systems may flag false alarms
- Developers waste time debugging "broken" services

**Lesson:** Health checks are only as good as their implementation. Missing endpoints = misleading metrics.

**Action Item:** Standardize `/healthz` endpoint across all services

---

### 10. Comprehensive Logging Makes Debugging Trivial

**Pattern:**
Log **every stage** of deployment with detailed context.

**Implementation:**
```typescript
console.log(`[docker-compose-strategy] Stage 1: Reading base compose file`);
console.log(`[docker-compose-strategy] Using base file: ${baseComposePath}`);

console.log(`[docker-compose-strategy] Stage 2: Collecting service-specific compose files`);
console.log(`[docker-compose-strategy] Found ${serviceFiles.length} service-specific files`);

for (const serviceFile of serviceFiles) {
  console.log(`[docker-compose-strategy] Merging ${serviceFile.service}: volumes=${stats.volumesAdded}, env=${stats.envAdded}`);
}

console.log(`[docker-compose-strategy] Stage 3: Collected ${allSecureFiles.size} services with secureFiles`);

console.log(`[docker-compose-strategy] Stage 4: Wrote merged compose to ${tempMergedPath} (${fileSize} bytes)`);
```

**Benefits:**
- Easy to see where deployment fails
- Merge statistics visible without reading code
- Progress tracking for long deployments
- Clear context for errors

**Example Output:**
```
[docker-compose-strategy] Stage 1: Reading base compose file
[docker-compose-strategy] Using base file: infrastructure/docker-compose/docker-compose.local.yaml
[docker-compose-strategy] Stage 2: Collecting service-specific compose files
[docker-compose-strategy] Found 14 service-specific files
[docker-compose-strategy] Merging tool-gateway: volumes=2, env=3, deps=1
[docker-compose-strategy] Merging auth: volumes=0, env=5, deps=2
[docker-compose-strategy] Stage 3: Collected 1 services with secureFiles
[docker-compose-strategy] Stage 4: Wrote merged compose to .docker-compose.merged.yaml (15234 bytes)
```

**Lesson:** Logging is not an afterthought - it's a debugging investment.

---

## Architectural Patterns

### Pattern #1: Service-Specific Configuration Layering

**Context:** Services need base configuration + service-specific overrides

**Solution:**
```
Base Compose (infrastructure-only)
  ↓
+ Service-Specific Compose Files (per service)
  ↓
+ SecureFiles (credentials, certificates)
  ↓
+ Environment Overrides (ports, runtime config)
  ↓
= Final Merged Compose
```

**Implementation:**
1. Read base compose file (infrastructure: NATS, PostgreSQL, networks)
2. Merge service-specific files (one per service)
3. Process secureFiles (validation, transfer, injection)
4. Apply environment overrides (ports, flags)
5. Write temporary merged file
6. Deploy with orchestrator

**Benefits:**
- Clear separation of concerns
- Reusable infrastructure base
- Service-specific customization
- Secure credential handling

---

### Pattern #2: Multi-Stage Processing Pipeline

**Context:** Complex deployment requires multiple distinct stages

**Solution:**
Break deployment into 8 stages with clear boundaries:

```
Stage 1: Read Base Compose
  ↓
Stage 2: Collect Service-Specific Compose
  ↓
Stage 3: Merge All Compose Files
  ↓
Stage 4: Collect and Validate SecureFiles
  ↓
Stage 5: Process SecureFiles (transfer, env vars, mounts)
  ↓
Stage 6: Write Temporary Merged File
  ↓
Stage 7: Execute Orchestrator
  ↓
Stage 8: Cleanup Temporary File
```

**Benefits:**
- Clear progress tracking
- Easy debugging (know which stage failed)
- Testable stages (unit test each stage)
- Composable (can add/remove stages)

**Lesson:** Break complex operations into named stages with clear inputs/outputs.

---

### Pattern #3: Explicit Error Collection

**Context:** Multiple independent operations may fail (file reads, validations)

**Solution:**
Collect errors during processing, fail at end with comprehensive report:

```typescript
const errors: string[] = [];

// Collect errors instead of throwing immediately
for (const serviceFile of serviceFiles) {
  try {
    const yaml = await fs.promises.readFile(serviceFile.path, 'utf-8');
    // ...
  } catch (error: any) {
    errors.push(`Failed to read ${serviceFile.service}: ${error.message}`);
  }
}

// Fail at end with all errors
if (errors.length > 0) {
  throw new Error(
    `Failed to collect service-specific compose files:\n` +
    errors.map(e => `  - ${e}`).join('\n')
  );
}
```

**Benefits:**
- See all failures at once (not just first)
- Better error messages (grouped, contextualized)
- Easier debugging (comprehensive report)

**Lesson:** Don't fail fast - collect errors and report comprehensively.

---

### Pattern #4: Path Remapping for Cross-Host Deployments

**Context:** Local paths don't work on remote hosts

**Solution:**
```typescript
const isRemote = context.deployment.docker?.host?.startsWith('ssh://');

const volumeMounts = !isRemote
  ? ComposeMerger.generateVolumeMounts(secureFiles, repoRoot)  // Local paths
  : await this.transferSecureFilesToRemote(secureFiles, remoteHost, remoteDir, repoRoot);  // Remote paths
```

**Key Insight:**
- **Local:** Use absolute paths from local filesystem
- **Remote:** Transfer files, then use absolute paths from remote filesystem

**Lesson:** Always remap paths when crossing filesystem boundaries.

---

## Future Improvements

### 1. Automated Port Conflict Detection
**Problem:** Port conflicts discovered at runtime (deployment failure)
**Solution:** Pre-deployment validation of merged compose file
**Benefit:** Fail fast with clear error message

### 2. Integration Test Infrastructure
**Problem:** No automated integration tests for deployment equivalence
**Solution:** Docker Compose test fixtures with automated validation
**Benefit:** Catch integration issues before staging

### 3. Health Check Standardization
**Problem:** Inconsistent health check implementation across services
**Solution:** Base class provides default `/healthz` endpoint
**Benefit:** Reliable health metrics

### 4. Automated Performance Benchmarking
**Problem:** Manual performance testing (time-consuming, error-prone)
**Solution:** CI pipeline runs deployment benchmarks, tracks trends
**Benefit:** Detect performance regressions automatically

### 5. Unique Default Ports in Compose Files
**Problem:** Multiple services default to same ports (3001, 8080, 3000)
**Solution:** Assign unique default ports to all services
**Benefit:** Defense in depth (works even without PortManager)

---

## Reusable Components Discovered

### 1. ComposeMerger
**Purpose:** Merge multiple Docker Compose files with conflict resolution
**Location:** `tools/brat/src/orchestration/deployment/compose-merger.ts`
**Reusability:** ✅ High (used in single and bulk deployments)

### 2. SecureFilesValidator
**Purpose:** Validate secureFiles declarations (git-ignored, valid paths)
**Location:** `tools/brat/src/orchestration/validation/secure-files-validator.ts`
**Reusability:** ✅ High (used in all deployment strategies)

### 3. PortManager
**Purpose:** Auto-assign unique ports, detect conflicts
**Location:** `tools/brat/src/orchestration/docker/port-manager.ts`
**Reusability:** ✅ High (should be used in all deployments)
**Note:** Currently only used in single-service deployments (Bug #19)

### 4. EnvironmentResolver
**Purpose:** Resolve environment variables from multiple sources
**Location:** `tools/brat/src/orchestration/deployment/environment-resolver.ts`
**Reusability:** ✅ High (used in all deployment strategies)

---

## Summary

Sprint 378 revealed **10 key technical insights** and **4 reusable architectural patterns**:

**Technical Insights:**
1. Port conflicts prevent network attachment (not just binding failures)
2. PortManager exists but wasn't integrated
3. Last-wins merge strategy for bulk deployments
4. SecureFiles require remote path remapping
5. Temporary file cleanup must use finally block
6. Docker networks: external vs managed
7. Staging reveals issues unit tests miss
8. Environment variable precedence matters
9. Health check failures ≠ service failures
10. Comprehensive logging makes debugging trivial

**Architectural Patterns:**
1. Service-specific configuration layering
2. Multi-stage processing pipeline
3. Explicit error collection
4. Path remapping for cross-host deployments

**Reusable Components:**
- ComposeMerger (merge strategy)
- SecureFilesValidator (validation)
- PortManager (auto-assignment)
- EnvironmentResolver (environment merging)

**Key Lesson:** Comprehensive planning + reusable components + staging validation = successful delivery.

---

**Document Created:** 2026-08-01
**Sprint:** 378 (Deploy All Enhancement)
**Status:** ✅ **COMPLETE**
