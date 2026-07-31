# Sprint 376: Bulk Deployment secureFiles Bug

**Date Discovered:** 2026-07-31
**Priority:** High
**Status:** Documented - Scheduled for Sprint 376

## Issue Summary

When using `brat bit deploy --all` with bulk deployment, services with `secureFiles` defined in architecture.yaml do not have their credential files mounted. This causes runtime failures for services that depend on secure credentials (e.g., GCS service accounts).

## Root Cause

The bulk deployment feature (Sprint 375) uses `DockerComposeStrategy.deployAll()` which creates a single `docker compose up` command for all services. However, the secure file injection logic in `docker-compose-strategy.ts` only applies to **individual service deployments** via the `execute()` method.

**Code Location:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`

### Individual Deployment (WORKS)
```typescript
async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
  // ...

  // Secure files are processed HERE
  const secureFiles = plan.service.secureFiles || [];
  const applicableFiles = secureFiles.filter(/* context filtering */);

  if (applicableFiles.length > 0) {
    // Transfer files via SCP
    // Inject volume mounts and env vars into merged compose
    // Restore original compose after deployment
  }

  // Docker compose up with merged file
}
```

### Bulk Deployment (BROKEN)
```typescript
async deployAll(services, context, options): Promise<DeploymentResult[]> {
  // ...

  // NO secure file processing here!
  const orchestrator = new DockerOrchestrator(orchestratorOptions);
  await orchestrator.up();

  // Returns success for all services, but secure files not mounted
}
```

## Observed Behavior

### Timeline:
1. **22:20 UTC** - Deployed `image-gen-mcp` individually → Credentials mounted correctly
2. **00:22 UTC** - Someone ran `brat bit deploy --all` → Container recreated **without** credentials mount
3. **00:25 UTC** - Image generation attempted → **Failed** with "Could not load the default credentials"

### Error Message:
```json
{
  "ts":"2026-07-31T00:25:56.070Z",
  "service":"image-gen-mcp",
  "level":"error",
  "msg":"Image generation or persistence failed",
  "errorMessage":"Failed to upload file bcb55d15-587e-439a-857a-e4988b2bd654.png to GCS after 3 attempts: Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
  "errorType":"Error"
}
```

### Container Inspection:
```bash
# After individual deploy (CORRECT)
$ docker inspect bitbrat-staging-image-gen-mcp-1 --format '{{range .Mounts}}{{.Destination}}\n{{end}}'
/var/secrets/gcp-credentials.json  # ✅ Credentials mounted
/var/bitbrat/storage

# After bulk deploy (BROKEN)
$ docker inspect bitbrat-staging-image-gen-mcp-1 --format '{{range .Mounts}}{{.Destination}}\n{{end}}'
/var/bitbrat/storage  # ❌ Credentials mount missing
```

## Impact

**Affected Services:**
- Any service with `secureFiles` defined in `architecture.yaml`
- Currently: `image-gen-mcp` (GCS credentials)
- Future: Any service requiring SSL certs, API keys in JSON format, etc.

**Severity:**
- **High** - Breaks production functionality for affected services
- Silent failure - deployment reports success but service fails at runtime
- Confusing UX - works with individual deploy, breaks with `--all`

## Workaround

**Until Fixed:**
Deploy services with `secureFiles` **individually** instead of using `--all`:

```bash
# DON'T: Bulk deploy (breaks secure files)
brat bit deploy --all --context staging

# DO: Deploy services individually
brat bit deploy image-gen-mcp --context staging
brat bit deploy other-service --context staging
```

Or deploy secure services individually after bulk deployment:

```bash
# 1. Bulk deploy everything
brat bit deploy --all --context staging

# 2. Re-deploy services with secure files
brat bit deploy image-gen-mcp --context staging
```

## Proposed Fix

### Option 1: Aggregate secureFiles in deployAll()

Collect all `secureFiles` from all services being deployed and process them before calling `DockerOrchestrator.up()`:

```typescript
async deployAll(services, context, options): Promise<DeploymentResult[]> {
  // 1. Collect all secure files from all services
  const allSecureFiles: Map<string, SecureFileConfig[]> = new Map();

  for (const service of services) {
    const secureFiles = service.secureFiles || [];
    const applicable = secureFiles.filter(f =>
      !f.context || f.context === context.name
    );

    if (applicable.length > 0) {
      allSecureFiles.set(service.name, applicable);
    }
  }

  // 2. Transfer all secure files (SCP for remote)
  const remoteFiles: string[] = [];
  for (const [serviceName, files] of allSecureFiles) {
    for (const file of files) {
      await transferSecureFile(file, context);
      remoteFiles.push(file.local);
    }
  }

  // 3. Create merged compose with ALL secure file mounts
  const mergedCompose = await createMergedCompose(services, allSecureFiles);

  // 4. Deploy with merged compose
  const orchestrator = new DockerOrchestrator({
    ...orchestratorOptions,
    composeFile: mergedCompose
  });

  await orchestrator.up();

  // 5. Restore original compose
  await restoreOriginalCompose();
}
```

### Option 2: Sequential Individual Deploys (Fallback)

If any service has `secureFiles`, fall back to sequential individual deployments:

```typescript
async deployAll(services, context, options): Promise<DeploymentResult[]> {
  // Check if any service has secure files
  const hasSecureFiles = services.some(s =>
    (s.secureFiles || []).some(f => !f.context || f.context === context.name)
  );

  if (hasSecureFiles) {
    console.log('Services with secureFiles detected - using sequential deployment');

    // Fall back to individual deployments (slower but correct)
    const results: DeploymentResult[] = [];
    for (const service of services) {
      const plan = await this.prepare(service, context, options);
      const result = await this.execute(plan);
      results.push(result);
    }
    return results;
  }

  // No secure files - use fast bulk deployment
  // ... existing bulk deployment logic
}
```

### Recommendation: **Option 1** (Aggregate secureFiles)

**Pros:**
- Preserves bulk deployment performance
- Properly handles all secure files
- Maintains user expectations (--all works correctly)

**Cons:**
- More complex implementation
- Requires careful compose merging logic

## Testing Plan

### Test Cases:
1. **Baseline**: Deploy single service with secureFiles individually
   - ✅ Verify volume mount exists
   - ✅ Verify file accessible in container
   - ✅ Verify service functionality

2. **Bulk with secureFiles**: Deploy all services including one with secureFiles
   - ✅ Verify all services deploy
   - ✅ Verify secure file volume mounts present
   - ✅ Verify service functionality

3. **Multiple secureFiles**: Deploy services with different secure files
   - ✅ Verify each service gets correct mounts
   - ✅ Verify no file leakage between services

4. **Context Filtering**: Deploy with context-specific secureFiles
   - ✅ Verify only applicable files mounted
   - ✅ Verify required files cause errors if missing

### Validation Commands:
```bash
# Check volume mounts
docker inspect <container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}\n{{end}}'

# Check file permissions
docker exec <container> ls -la /var/secrets/

# Check file accessibility
docker exec <container> cat /var/secrets/gcp-credentials.json | head -c 50

# Check environment variable
docker exec <container> printenv GOOGLE_APPLICATION_CREDENTIALS
```

## Related Files

- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:590-639` - deployAll() method
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:227-339` - execute() with secureFiles
- `tools/brat/src/oclif-commands/bit/deploy.ts:165-171` - Bulk deployment decision logic
- `architecture.yaml` - Service definitions with secureFiles

## References

- **Sprint 374**: Secure File Deployment feature implementation
- **Sprint 375**: Bulk deployment feature implementation
- **Issue discovered**: 2026-07-31 during staging image generation testing
- **Git commit**: cc8f5045 (Sprint 374/375 deliverables)

## Next Steps for Sprint 376

1. **Implementation**: Implement Option 1 (aggregate secureFiles in deployAll)
2. **Testing**: Execute full test plan (4 test cases)
3. **Validation**: Deploy to staging with `--all` flag and verify functionality
4. **Documentation**: Update deployment guide with bulk deployment + secureFiles behavior
5. **Regression**: Ensure existing individual deploys still work correctly
