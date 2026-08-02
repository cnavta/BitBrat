# brat bit deploy --all vs Single Service: Environment Variable Handling Issue

**Date:** 2026-08-01
**Status:** Investigation Complete
**Sprint:** Post-377
**Severity:** High - Affects production deployments

---

## Executive Summary

The `brat bit deploy` command handles environment variables and secrets differently when using the `--all` flag versus deploying a single service. This inconsistency can lead to:
- **Missing environment variables** in bulk deployments
- **Missing secure file mounts** for services that declare `secureFiles` in architecture.yaml
- **Inconsistent service behavior** between single and bulk deployment modes
- **Production deployment failures** when switching from testing single services to deploying all

**Root Cause:** The `--all` flag uses `deployAll()` which bypasses service-specific compose file merging and secureFiles processing.

---

## Technical Analysis

### Code Path Comparison

#### **Single Service Deployment** (`brat bit deploy <service>`)

```
BitDeploy.run()
  └─> deployServices()
      └─> strategy.prepare()       ← Loads context.runtime.envVars
          └─> strategy.validate()
              └─> strategy.execute()
                  ├─> Read base compose file
                  ├─> Merge service-specific compose file (services/*.compose.yaml)
                  ├─> Validate secureFiles
                  ├─> Transfer secureFiles to remote (if SSH)
                  ├─> Generate volume mounts for secureFiles
                  ├─> Extract env vars from secureFiles (e.g., GOOGLE_APPLICATION_CREDENTIALS)
                  ├─> Inject secureFiles into final compose YAML
                  ├─> Write temporary merged compose file
                  └─> DockerOrchestrator.up()
                      ├─> EnvironmentResolver.resolve() → .env.brat
                      └─> docker compose up
```

**Environment Variable Sources (Single Service):**
1. `env/{context}/*.yaml` files → EnvironmentResolver → `.env.brat`
2. `.secure.{context}/.env` → EnvironmentResolver → `.env.brat`
3. Service-specific compose file (`services/<service>.compose.yaml`) → Merged into final compose
4. **secureFiles `env` properties** → Injected by ComposeMerger (e.g., `GOOGLE_APPLICATION_CREDENTIALS`)
5. Port assignments → PortManager → `.env.brat`

---

#### **Bulk Deployment** (`brat bit deploy --all`)

```
BitDeploy.run()
  └─> strategy.deployAll()  ← SKIPS prepare/validate/execute!
      └─> DockerOrchestrator.up()
          ├─> EnvironmentResolver.resolve() → .env.brat
          └─> docker compose up
```

**Environment Variable Sources (--all):**
1. `env/{context}/*.yaml` files → EnvironmentResolver → `.env.brat`
2. `.secure.{context}/.env` → EnvironmentResolver → `.env.brat`
3. Port assignments → PortManager → `.env.brat`

**Missing:**
- ❌ Service-specific compose file merging
- ❌ secureFiles validation and processing
- ❌ secureFiles environment variable injection
- ❌ secureFiles volume mounts

---

## Concrete Example: image-gen-mcp Service

### architecture.yaml Configuration

```yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS  ← Sets this env var
        permissions: "0400"
        required: true
        context: staging
```

### Single Service Deployment (WORKS)

```bash
brat bit deploy image-gen-mcp --context staging
```

**What Happens:**
1. `execute()` validates `.secure.staging/gcp-credentials.json` exists
2. Transfers file to remote host via SCP (if remote deployment)
3. **Injects `GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json` into compose**
4. Adds volume mount: `<remote-path>:/var/secrets/gcp-credentials.json:ro`
5. Container receives both the file AND the environment variable

**Result:** ✅ Service can authenticate to GCP

---

### Bulk Deployment (BROKEN)

```bash
brat bit deploy --all --context staging
```

**What Happens:**
1. `deployAll()` calls `DockerOrchestrator.up()` directly
2. **Skips secureFiles processing entirely**
3. No environment variable injection
4. No volume mount generation
5. Container starts without GCP credentials

**Result:** ❌ Service fails with "credentials not found" error

---

## Affected Features

### 1. **Secure Files (Sprint 374)**

**Impact:** HIGH
**Affected Services:** Any service declaring `secureFiles` in architecture.yaml

Services that rely on `secureFiles` for credentials will fail when deployed via `--all`:
- `image-gen-mcp` (GCP credentials)
- Any service using SSL certificates
- Any service using API keys in JSON format

**Workaround:** Deploy services with secureFiles individually

---

### 2. **Service-Specific Compose Overrides**

**Impact:** MEDIUM
**Affected Services:** Services with `infrastructure/docker-compose/services/<name>.compose.yaml` files

Examples:
- Custom volume mounts
- Additional environment variables
- Service dependencies
- Resource limits

**Example:** `llm-bot.compose.yaml`

```yaml
services:
  llm-bot:
    environment:
      - LLM_PROVIDER=${LLM_BOT_LLM_PROVIDER}
      - LLM_MODEL=${LLM_BOT_LLM_MODEL}
      - LLM_BASE_URL=${LLM_BOT_LLM_BASE_URL}
    ports:
      - "${LLM_BOT_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
    depends_on:
      tool-gateway:
        condition: service_healthy
```

When deployed via `--all`, these overrides are **ignored** because the service-specific file is never merged.

---

### 3. **Context-Specific Configuration**

**Impact:** LOW
**Reason:** Context-specific config is handled by EnvironmentResolver regardless of deployment mode

Both single and bulk deployments correctly load:
- `env/{context}/global.yaml`
- `env/{context}/infra.yaml`
- `env/{context}/{service}.yaml`
- `.secure.{context}/.env`

**No issue here** - this works consistently.

---

## Why This Wasn't Caught Earlier

1. **Sprint 374 Testing:** Secure files deployment was tested using single service deployments
2. **Sprint 375 Testing:** Base image caching was tested using `--all` but didn't use secureFiles
3. **No Integration Test:** No test validates that `--all` produces the same result as deploying services individually
4. **Bulk Deployment Optimization:** The `deployAll()` method was designed for speed (single `docker compose up` call) but didn't account for service-specific processing

---

## Proposed Solutions

### **Option 1: Make deployAll() Process Service-Specific Config (Recommended)**

**Approach:** Enhance `deployAll()` to perform the same processing as `execute()` but in a batched manner.

**Implementation:**

```typescript
async deployAll(
  services: ServiceWithName[],
  context: ResolvedContext,
  options: DeployOptions
): Promise<DeploymentResult[]> {
  const startTime = Date.now();
  const repoRoot = process.cwd();

  console.log(`[docker-compose-strategy] Bulk deployment of ${services.length} services`);

  // NEW: Process service-specific config for ALL services
  const baseComposePath = this.getBaseComposeFilePath(context);
  let baseComposeContent = await fs.promises.readFile(baseComposePath, 'utf-8');
  const merger = new ComposeMerger();

  // Track all secure files across all services
  const allSecureFiles: Map<string, SecureFile[]> = new Map();

  // Merge all service-specific compose files
  for (const service of services) {
    const serviceComposeFilePath = path.join(
      repoRoot,
      'infrastructure/docker-compose/services',
      `${service.name}.compose.yaml`
    );

    if (fs.existsSync(serviceComposeFilePath)) {
      const serviceYaml = await fs.promises.readFile(serviceComposeFilePath, 'utf-8');
      const mergeResult = merger.merge(baseComposeContent, serviceYaml, {
        serviceName: service.name,
        validationMode: 'lenient',
      });
      baseComposeContent = mergeResult.yaml;
      console.log(`[docker-compose-strategy] Merged ${service.name}.compose.yaml`);
    }

    // Collect secureFiles for this service
    if (service.secureFiles && service.secureFiles.length > 0) {
      // Validate secure files
      const validator = new SecureFilesValidator(repoRoot);
      const validationResult = await validator.validate(service.secureFiles, context.name);

      if (!validationResult.valid) {
        throw new Error(
          `Secure file validation failed for ${service.name}:\n` +
          validationResult.errors.map(e => `  - ${e}`).join('\n')
        );
      }

      // Filter by context
      const contextFiles = service.secureFiles.filter(file => {
        if (!file.context) return true;
        return file.context === context.name;
      });

      if (contextFiles.length > 0) {
        allSecureFiles.set(service.name, contextFiles);
      }
    }
  }

  // Process all secure files
  const isRemote = context.deployment.docker?.host?.startsWith('ssh://');
  for (const [serviceName, secureFiles] of allSecureFiles.entries()) {
    let volumeMounts: string[];
    const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);

    if (isRemote) {
      const remoteHost = context.deployment.docker!.host!;
      const remoteDir = context.deployment.docker!.remoteDir;
      if (!remoteDir) {
        throw new Error(`Remote directory not configured for context '${context.name}'`);
      }

      const remotePaths = await this.transferSecureFilesToRemote(
        secureFiles,
        remoteHost,
        remoteDir,
        repoRoot
      );

      volumeMounts = secureFiles.map(file => {
        const remotePath = remotePaths.get(file.local)!;
        return `${remotePath}:${file.target}:ro`;
      });
    } else {
      volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);
    }

    // Inject into final compose
    baseComposeContent = merger.injectSecureFiles(
      baseComposeContent,
      serviceName,
      volumeMounts,
      secureFileEnvVars
    );
  }

  // Write temporary merged compose file
  const tempComposePath = path.join(repoRoot, 'infrastructure/docker-compose/.docker-compose.merged.yaml');
  await fs.promises.writeFile(tempComposePath, baseComposeContent);

  try {
    // Use merged compose file for deployment
    const orchestratorOptions: DockerOrchestratorOptions = {
      repoRoot,
      context: context.name,
      service: undefined,
      dryRun: options.dryRun || false,
      forceRecreate: options.forceRecreate || false,
      noCache: options.forceBuild || false,
      rebuildBase: options.rebuildBase || false,
      loki: options.loki || false,
      noDeps: options.noDeps || false,
      composeFile: tempComposePath, // Use merged file
    };

    const orchestrator = new DockerOrchestrator(orchestratorOptions);
    await orchestrator.up();

    const durationMs = Date.now() - startTime;

    return services.map(service => ({
      status: 'success' as const,
      service: service.name,
      durationMs,
      metadata: {
        containerId: `bitbrat-${context.name}-${service.name}`,
      },
    }));
  } finally {
    // Cleanup temporary merged compose file
    if (fs.existsSync(tempComposePath)) {
      await fs.promises.unlink(tempComposePath);
    }
  }
}
```

**Pros:**
- ✅ Consistent behavior between single and bulk deployments
- ✅ Preserves bulk deployment performance (single `docker compose up`)
- ✅ Supports all service-specific features (compose overrides, secureFiles)
- ✅ No breaking changes to API

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Need to handle merge conflicts between service-specific files
- ⚠️ Increased processing time before `docker compose up`

**Estimated Effort:** 2-3 days

---

### **Option 2: Remove deployAll() - Use Sequential Deployment**

**Approach:** Remove the `deployAll()` optimization and always deploy services individually.

**Implementation:**

```typescript
// In docker-compose-strategy.ts
export class DockerComposeStrategy implements DeploymentStrategy {
  readonly supportsBulkDeployment = false;  // ← Change to false

  // Remove deployAll() method entirely
}
```

**Pros:**
- ✅ Simple fix - just delete code
- ✅ Guaranteed consistency
- ✅ Already tested and working

**Cons:**
- ❌ Slower deployments (N docker compose calls instead of 1)
- ❌ Loses bulk deployment performance optimization
- ❌ More container restarts (each service deployed independently)

**Estimated Effort:** 1 hour

---

### **Option 3: Hybrid Approach - Conditional Bulk Deployment**

**Approach:** Use `deployAll()` only when services don't have service-specific config.

**Implementation:**

```typescript
async run() {
  // ... existing code ...

  // Determine if bulk deployment is safe
  const hasSer viceSpecificConfig = servicesToDeploy.some(service => {
    const serviceComposePath = path.join(
      repoRoot,
      `infrastructure/docker-compose/services/${service.name}.compose.yaml`
    );
    const hasComposeFile = fs.existsSync(serviceComposePath);
    const hasSecureFiles = service.secureFiles && service.secureFiles.length > 0;
    return hasComposeFile || hasSecureFiles;
  });

  // Use bulk deployment ONLY if all services are simple
  if (flags.all && !hasServiceSpecificConfig && strategy.supportsBulkDeployment && strategy.deployAll) {
    this.log(`Using bulk deployment (no service-specific config detected)`);
    results = await strategy.deployAll(servicesToDeploy, resolvedContext, deployOptions);
  } else {
    if (flags.all && hasServiceSpecificConfig) {
      this.log(`Using sequential deployment (service-specific config detected)`);
    }
    results = await this.deployServices(servicesToDeploy, resolvedContext, strategy, deployOptions);
  }
}
```

**Pros:**
- ✅ Best of both worlds (fast when possible, correct always)
- ✅ No breaking changes
- ✅ Automatic fallback to safe mode

**Cons:**
- ⚠️ Complexity - two code paths to maintain
- ⚠️ Detection logic could miss edge cases
- ⚠️ Unpredictable performance (depends on service config)

**Estimated Effort:** 1 day

---

### **Option 4: Deprecate --all, Require Explicit Service Lists**

**Approach:** Remove `--all` flag entirely. Require users to specify services explicitly.

**Example:**

```bash
# Instead of:
brat bit deploy --all

# Require:
brat bit deploy llm-bot event-router reflex ...
```

**Pros:**
- ✅ Forces explicit service selection
- ✅ Users understand exactly what's being deployed
- ✅ No ambiguity

**Cons:**
- ❌ Breaking change
- ❌ Less convenient for users
- ❌ Doesn't solve the underlying issue

**Estimated Effort:** 1 day + migration period

---

## Recommendation

**Primary Recommendation: Option 1 (Enhanced deployAll())**

**Rationale:**
1. **Consistency:** Ensures identical behavior between single and bulk deployments
2. **Feature Completeness:** Supports all service-specific features (secureFiles, compose overrides)
3. **Performance:** Maintains bulk deployment performance (single `docker compose up`)
4. **No Breaking Changes:** Existing users continue to work without modification
5. **Future-Proof:** Supports future service-specific features automatically

**Short-Term Workaround: Document the Issue**

Until Option 1 is implemented:
1. Update deployment guide to warn about `--all` limitations
2. Recommend deploying services with `secureFiles` individually
3. Add validation warning when `--all` is used with services that have secureFiles

---

## Testing Requirements

### Unit Tests

1. **Test: deployAll() processes service-specific compose files**
   - Given: Multiple services with service-specific compose files
   - When: deployAll() is called
   - Then: Final compose includes all service-specific overrides

2. **Test: deployAll() processes secureFiles**
   - Given: Multiple services with secureFiles declared
   - When: deployAll() is called
   - Then: secureFiles are validated, transferred (if remote), and injected

3. **Test: deployAll() handles merge conflicts gracefully**
   - Given: Two services trying to modify the same base config
   - When: deployAll() is called
   - Then: Appropriate error or last-wins merge behavior

### Integration Tests

1. **Test: Single vs Bulk Deployment Equivalence**
   - Given: Same set of services
   - When: Deployed individually vs via --all
   - Then: Resulting containers have identical environment variables

2. **Test: SecureFiles Work in Bulk Deployment**
   - Given: Service with GOOGLE_APPLICATION_CREDENTIALS from secureFile
   - When: Deployed via --all
   - Then: Container can authenticate to GCP

---

## Migration Plan

### Phase 1: Investigation & Planning (Complete)
- ✅ Identified issue
- ✅ Documented root cause
- ✅ Proposed solutions

### Phase 2: Implementation (Sprint 378)
- [ ] Implement Option 1 (Enhanced deployAll())
- [ ] Add unit tests for service-specific config merging
- [ ] Add integration tests for bulk deployment equivalence
- [ ] Update deployment strategy documentation

### Phase 3: Validation (Sprint 378)
- [ ] Test with staging environment
- [ ] Verify all services deploy correctly via --all
- [ ] Performance benchmark (single vs bulk vs enhanced bulk)

### Phase 4: Documentation (Sprint 378)
- [ ] Update user guide with --all behavior
- [ ] Add troubleshooting section for deployment issues
- [ ] Document migration from workaround to fixed version

---

## Related Issues

- **Sprint 374:** Secure Files Deployment Feature
- **Sprint 375:** Base Image Caching
- **Sprint 372:** Unified Bit Deployment Command

---

## References

### Code Files

- `tools/brat/src/oclif-commands/bit/deploy.ts` (lines 142-148) - deployAll() call
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
  - `prepare()` (lines 47-120) - Single service preparation
  - `execute()` (lines 185-340) - Single service execution with secureFiles
  - `deployAll()` (lines 590-639) - Bulk deployment (missing secureFiles processing)
- `tools/brat/src/orchestration/docker/orchestrator.ts`
  - `up()` (lines 55-190) - Docker Compose orchestration
  - `writeEnvFile()` (lines 272-318) - Environment variable generation

### Documentation

- `documentation/guides/secure-file-deployment.md` - SecureFiles feature guide
- `planning/sprint-374-secure-file-deployment/` - Sprint 374 planning docs

---

**Document Status:** Ready for Review
**Next Action:** Approval for Option 1 implementation in Sprint 378
