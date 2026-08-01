# Sprint 378: Deploy All Enhancement - Execution Plan

**Sprint Goal:** Fix bulk deployment (`--all` flag) to process service-specific configuration identically to single-service deployments

**Duration:** Days 1-4 (4 working days)
**Priority:** High
**Complexity:** Medium-High
**Risk:** Low (isolated to deployment code path)

---

## Executive Summary

The `brat bit deploy --all` command currently bypasses critical service-specific configuration processing, causing services to fail with missing environment variables and credentials. This sprint enhances the `deployAll()` method to:

1. Merge all service-specific compose files
2. Validate and process secureFiles for all services
3. Inject environment variables and volume mounts
4. Maintain bulk deployment performance

**Impact:**
- ✅ Consistent deployment behavior (single vs bulk)
- ✅ SecureFiles work correctly in bulk mode
- ✅ No breaking changes
- ✅ ~40% faster than sequential deployment

**Key Deliverables:**
- Enhanced `deployAll()` method with full service-specific config processing
- 8 unit tests + 2 integration tests
- Staging validation
- Comprehensive documentation

---

## Problem Statement

### Current Behavior (Broken)

```bash
# Single service deployment - WORKS
brat bit deploy image-gen-mcp --context staging
✅ SecureFiles validated
✅ GCP credentials mounted at /var/secrets/gcp-credentials.json
✅ GOOGLE_APPLICATION_CREDENTIALS env var set
✅ Service authenticates to GCP

# Bulk deployment - BROKEN
brat bit deploy --all --context staging
❌ SecureFiles processing skipped
❌ No volume mounts created
❌ No environment variables injected
❌ Service fails: "credentials not found"
```

### Root Cause

The `--all` flag uses a different code path:

**Single Service:** `prepare() → validate() → execute()` (full processing)
**Bulk Deployment:** `deployAll()` (skips to orchestrator)

Missing in bulk deployment:
- Service-specific compose file merging
- SecureFiles validation and transfer
- Environment variable injection
- Volume mount generation

---

## Sprint Phases

### **Day 1: Analysis & Core Implementation**

#### Morning: Analysis (3 hours)
- Deep dive into existing `execute()` method
- Trace compose merging logic (ComposeMerger)
- Trace secureFiles processing flow
- Design bulk merge strategy

**Deliverable:** Design document with pseudocode

#### Afternoon: Compose Merging (5 hours)
- Implement service-specific compose collection
- Implement iterative compose merging
- Add merge conflict handling
- Add comprehensive logging

**Deliverable:** Compose files successfully merged in bulk mode

---

### **Day 2: SecureFiles Processing**

#### Morning: Validation & Collection (4 hours)
- Implement secureFiles collection for all services
- Implement validation for each service
- Add context filtering
- Handle validation errors gracefully

**Deliverable:** All secureFiles validated across all services

#### Afternoon: Transfer & Injection (4 hours)
- Implement remote file transfer for SSH deployments
- Generate volume mounts (local and remote paths)
- Extract environment variables from secureFiles
- Inject into merged compose YAML

**Deliverable:** SecureFiles fully processed in bulk deployment

---

### **Day 3: Testing & Validation**

#### Morning: Unit Tests (4 hours)
- Test compose file collection and merging
- Test secureFiles validation
- Test remote transfer logic
- Test environment variable injection
- Test merge conflict handling

**Deliverable:** 8 unit tests passing

#### Afternoon: Integration Tests (4 hours)
- Test single vs bulk deployment equivalence
- Test secureFiles in bulk deployment
- Test staging environment deployment
- Verify image-gen-mcp GCP credentials
- Performance benchmark

**Deliverable:** 2 integration tests passing + staging validation complete

---

### **Day 4: Documentation & Release**

#### Morning: Documentation (3 hours)
- Update deployment strategy guide
- Update user guide with --all behavior
- Add troubleshooting section
- Create migration guide

**Deliverable:** Complete documentation set

#### Afternoon: Final Validation & Release (2 hours)
- Run full test suite
- Commit with comprehensive message
- Create pull request
- Update backlog tracking

**Deliverable:** PR ready for review

---

## Detailed Task Breakdown

### **Phase 1: Analysis & Design** (Day 1 Morning)

#### Task 1.1: Understand Current Implementation
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Time:** 1 hour

**Actions:**
1. Read `execute()` method (lines 185-340)
2. Trace how ComposeMerger is used
3. Trace secureFiles validation and processing
4. Document the full flow with diagrams

**Success Criteria:**
- [ ] Flow diagram created
- [ ] All data structures documented
- [ ] Ready to design bulk implementation

---

#### Task 1.2: Design Bulk Merge Strategy
**Time:** 2 hours

**Actions:**
1. Design how to merge N service-specific compose files
2. Decide conflict resolution strategy (last-wins vs error)
3. Design secureFiles aggregation across services
4. Plan temporary file handling
5. Write pseudocode for enhanced `deployAll()`

**Decisions to Make:**
- Service not found in base compose → Skip with warning (lenient)
- Conflicting environment variables → Last-wins
- Duplicate volume names → Allow (Docker handles it)
- Conflicting port mappings → Detect and warn

**Success Criteria:**
- [ ] Design document created
- [ ] Pseudocode written
- [ ] Edge cases identified
- [ ] Ready to implement

---

### **Phase 2: Core Implementation** (Day 1 Afternoon + Day 2)

#### Task 2.1: Implement Service-Specific Compose Collection
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Method:** `deployAll()` (after line 598)
**Time:** 1 hour

**Implementation:**
```typescript
// Collect all service-specific compose files
const serviceComposeFiles: Array<{ service: string; path: string; yaml: string }> = [];

for (const service of services) {
  const serviceComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/services',
    `${service.name}.compose.yaml`
  );

  if (fs.existsSync(serviceComposePath)) {
    const yaml = await fs.promises.readFile(serviceComposePath, 'utf-8');
    serviceComposeFiles.push({ service: service.name, path: serviceComposePath, yaml });
    console.log(`[docker-compose-strategy] Collected ${service.name}.compose.yaml`);
  }
}

console.log(`[docker-compose-strategy] Collected ${serviceComposeFiles.length} service-specific compose files`);
```

**Success Criteria:**
- [ ] All service-specific files collected
- [ ] Non-existent files skipped without error
- [ ] Logging confirms collection

---

#### Task 2.2: Implement Iterative Compose Merging
**File:** Same as above
**Time:** 2 hours

**Implementation:**
```typescript
// Read base compose file
const baseComposePath = this.getBaseComposeFilePath(context);
let mergedYaml = await fs.promises.readFile(baseComposePath, 'utf-8');

// Merge each service-specific file
const merger = new ComposeMerger();
const mergeStats = { totalVolumes: 0, totalEnv: 0, totalDeps: 0 };

for (const { service, yaml } of serviceComposeFiles) {
  try {
    const mergeResult = merger.merge(mergedYaml, yaml, {
      serviceName: service,
      validationMode: 'lenient',
    });

    mergedYaml = mergeResult.yaml;
    mergeStats.totalVolumes += mergeResult.stats.volumesAdded;
    mergeStats.totalEnv += mergeResult.stats.environmentAdded;
    mergeStats.totalDeps += mergeResult.stats.dependenciesAdded;

    console.log(
      `[docker-compose-strategy] Merged ${service}: ` +
      `volumes=${mergeResult.stats.volumesAdded}, ` +
      `env=${mergeResult.stats.environmentAdded}, ` +
      `deps=${mergeResult.stats.dependenciesAdded}`
    );
  } catch (error: any) {
    throw new Error(`Failed to merge compose file for ${service}: ${error.message}`);
  }
}

console.log(`[docker-compose-strategy] Total merge stats: ${JSON.stringify(mergeStats)}`);
```

**Success Criteria:**
- [ ] All service files merged into base
- [ ] Merge stats logged for each service
- [ ] Errors include service name
- [ ] Last-wins for conflicts

---

#### Task 2.3: Implement SecureFiles Collection and Validation
**File:** Same as above
**Time:** 2 hours

**Implementation:**
```typescript
// Collect and validate secureFiles from all services
const allSecureFiles: Map<string, SecureFile[]> = new Map();
const validator = new SecureFilesValidator(repoRoot);

for (const service of services) {
  if (!service.secureFiles || service.secureFiles.length === 0) {
    continue;
  }

  // Validate secure files for this service
  const validationResult = await validator.validate(service.secureFiles, context.name);

  // Log warnings (non-fatal)
  if (validationResult.warnings.length > 0) {
    console.warn(
      `[docker-compose-strategy] Secure file warnings for ${service.name}:\n` +
      validationResult.warnings.map(w => `  - ${w}`).join('\n')
    );
  }

  // Abort on validation errors (fatal)
  if (!validationResult.valid) {
    throw new Error(
      `Secure file validation failed for ${service.name}:\n` +
      validationResult.errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Filter by execution context
  const contextFiles = service.secureFiles.filter(file => {
    if (!file.context) return true; // No context restriction
    return file.context === context.name;
  });

  if (contextFiles.length > 0) {
    allSecureFiles.set(service.name, contextFiles);
    console.log(
      `[docker-compose-strategy] Collected ${contextFiles.length} secure file(s) for ${service.name}`
    );
  }
}

console.log(
  `[docker-compose-strategy] Total secure files across all services: ` +
  `${Array.from(allSecureFiles.values()).reduce((sum, files) => sum + files.length, 0)}`
);
```

**Success Criteria:**
- [ ] All services' secureFiles collected
- [ ] Validation errors throw with service name
- [ ] Warnings logged but don't fail
- [ ] Context filtering works correctly

---

#### Task 2.4: Implement SecureFiles Transfer to Remote
**File:** Same as above
**Time:** 1.5 hours

**Implementation:**
```typescript
// Process secure files for injection
const isRemote = context.deployment.docker?.host?.startsWith('ssh://');
const secureFileVolumeMounts: Map<string, { volumeMounts: string[]; envVars: Record<string, string> }> = new Map();

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

  secureFileVolumeMounts.set(serviceName, { volumeMounts, envVars: secureFileEnvVars });
}
```

**Success Criteria:**
- [ ] Local deployments use local paths
- [ ] Remote deployments transfer files via SCP
- [ ] Missing remoteDir throws clear error
- [ ] All files transferred successfully

---

#### Task 2.5: Implement SecureFiles Injection
**File:** Same as above
**Time:** 1 hour

**Implementation:**
```typescript
// Inject secureFiles into merged compose YAML
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

**Success Criteria:**
- [ ] Volume mounts injected for all services
- [ ] Environment variables injected for all services
- [ ] Merged YAML is valid

---

#### Task 2.6: Implement Temporary File Handling
**File:** Same as above
**Time:** 1 hour

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
  // Update orchestrator options to use merged compose
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
    composeFile: tempComposePath, // CRITICAL: Use merged file
  };

  const orchestrator = new DockerOrchestrator(orchestratorOptions);
  await orchestrator.up();

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

**Success Criteria:**
- [ ] Temp file created before deployment
- [ ] Orchestrator uses temp file
- [ ] Temp file cleaned up on success
- [ ] Temp file cleaned up on failure

---

#### Task 2.7: Update DockerOrchestrator for Custom Compose File
**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Time:** 1 hour

**Implementation:**
```typescript
// In DockerOrchestratorOptions interface
export interface DockerOrchestratorOptions {
  // ... existing options ...
  composeFile?: string; // NEW: Override compose file path for bulk deployment
}

// In up() method (around line 68)
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],
      targetService: null,
      loki: this.options.loki || false,
    }
  : this.composeFactory.getComposeFiles(
      this.options.service,
      inactiveServices,
      this.options.loki
    );
```

**Success Criteria:**
- [ ] composeFile option added to interface
- [ ] When provided, overrides auto-detection
- [ ] When not provided, uses existing behavior
- [ ] No breaking changes

---

### **Phase 3: Testing** (Day 3)

#### Task 3.1: Unit Test - Compose File Processing
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts` (new)
**Time:** 2 hours

**Test Cases:**
```typescript
describe('DockerComposeStrategy.deployAll() - Compose Files', () => {
  it('should collect service-specific compose files', async () => {
    // Given: 3 services, 2 with compose files
    // When: deployAll() called
    // Then: 2 files collected
  });

  it('should merge service-specific compose into base', async () => {
    // Given: Service with environment override in compose file
    // When: deployAll() called
    // Then: Merged compose contains override
  });

  it('should merge multiple services without conflicts', async () => {
    // Given: 3 services with different compose overrides
    // When: deployAll() called
    // Then: All overrides present in final merged compose
  });

  it('should handle last-wins for conflicting environment variables', async () => {
    // Given: Two services setting PORT to different values
    // When: deployAll() called
    // Then: Last service's value wins
  });
});
```

**Success Criteria:**
- [ ] All 4 tests passing
- [ ] Edge cases covered
- [ ] Mock filesystem and ComposeMerger

---

#### Task 3.2: Unit Test - SecureFiles Processing
**File:** Same as above
**Time:** 2 hours

**Test Cases:**
```typescript
describe('DockerComposeStrategy.deployAll() - SecureFiles', () => {
  it('should validate secureFiles for all services', async () => {
    // Given: 2 services with secureFiles
    // When: deployAll() called
    // Then: Both validated via SecureFilesValidator
  });

  it('should throw error if validation fails', async () => {
    // Given: Service with non-existent secureFile
    // When: deployAll() called
    // Then: Error thrown with service name
  });

  it('should filter secureFiles by execution context', async () => {
    // Given: SecureFile with context: staging, deploying to local
    // When: deployAll() called
    // Then: File skipped
  });

  it('should transfer secureFiles to remote host', async () => {
    // Given: SSH deployment with secureFiles
    // When: deployAll() called
    // Then: transferSecureFilesToRemote() called
  });

  it('should inject environment variables from secureFiles', async () => {
    // Given: SecureFile with env: GOOGLE_APPLICATION_CREDENTIALS
    // When: deployAll() called
    // Then: Merged compose contains env var
  });

  it('should inject volume mounts from secureFiles', async () => {
    // Given: SecureFile with target path
    // When: deployAll() called
    // Then: Merged compose contains volume mount
  });
});
```

**Success Criteria:**
- [ ] All 6 tests passing
- [ ] Mock SecureFilesValidator
- [ ] Mock ComposeMerger

---

#### Task 3.3: Integration Test - Deployment Equivalence
**File:** `tests/integration/deployment-equivalence.spec.ts` (new)
**Time:** 2 hours

**Test:**
```typescript
describe('Deployment Equivalence', () => {
  it('should produce identical environments for single vs bulk deployment', async () => {
    // Given: 3 services (llm-bot, event-router, reflex)
    const services = ['llm-bot', 'event-router', 'reflex'];

    // When: Deploy individually
    for (const service of services) {
      await deployService(service, 'staging');
    }
    const singleEnvVars = await getContainerEnv('llm-bot');
    const singleVolumes = await getContainerVolumes('llm-bot');
    await teardown();

    // When: Deploy via --all
    await deployAll(services, 'staging');
    const bulkEnvVars = await getContainerEnv('llm-bot');
    const bulkVolumes = await getContainerVolumes('llm-bot');

    // Then: Environment variables identical
    expect(bulkEnvVars).toEqual(singleEnvVars);
    expect(bulkVolumes).toEqual(singleVolumes);
  });
});
```

**Success Criteria:**
- [ ] Test passes in staging environment
- [ ] Environment variables match
- [ ] Volume mounts match
- [ ] Container configs match

---

#### Task 3.4: Integration Test - SecureFiles in Bulk
**File:** `tests/integration/bulk-deployment-securefiles.spec.ts` (new)
**Time:** 1.5 hours

**Test:**
```typescript
describe('Bulk Deployment SecureFiles', () => {
  it('should mount secureFiles and set environment variables', async () => {
    // Given: image-gen-mcp with GCP credentials from secureFile
    const services = ['image-gen-mcp'];

    // When: Deploy via --all
    await deployAll(services, 'staging');

    // Then: File mounted
    const fileExists = await execInContainer(
      'bitbrat-staging-image-gen-mcp-1',
      'test -f /var/secrets/gcp-credentials.json && echo "exists"'
    );
    expect(fileExists.trim()).toBe('exists');

    // Then: Env var set
    const envVar = await getContainerEnv('image-gen-mcp', 'GOOGLE_APPLICATION_CREDENTIALS');
    expect(envVar).toBe('/var/secrets/gcp-credentials.json');

    // Then: File has correct permissions
    const perms = await execInContainer(
      'bitbrat-staging-image-gen-mcp-1',
      'stat -c "%a" /var/secrets/gcp-credentials.json'
    );
    expect(perms.trim()).toBe('400');
  });
});
```

**Success Criteria:**
- [ ] Test passes in staging
- [ ] File exists and has correct permissions
- [ ] Environment variable set correctly

---

#### Task 3.5: Staging Validation
**Environment:** staging (bitbrat.lan)
**Time:** 1.5 hours

**Steps:**
1. Deploy all services via `brat bit deploy --all --context staging`
2. Verify all containers start successfully
3. Check logs for errors
4. Verify secureFiles-dependent services (image-gen-mcp)
5. Performance benchmark

**Validation Checklist:**
- [ ] All services start within 2 minutes
- [ ] No deployment errors in logs
- [ ] All healthchecks pass
- [ ] image-gen-mcp has GCP credentials
- [ ] llm-bot has FeedbackMiddleware initialized
- [ ] Deployment time < 60 seconds

---

### **Phase 4: Documentation** (Day 4 Morning)

#### Task 4.1: Update Deployment Strategy Guide
**File:** `documentation/guides/deployment-strategy.md`
**Time:** 1 hour

**Sections:**
- How bulk deployment works
- Service-specific config processing
- Performance characteristics
- When to use --all vs individual

**Success Criteria:**
- [ ] Bulk deployment flow documented
- [ ] Equivalence guarantees explained
- [ ] Examples provided

---

#### Task 4.2: Update User Guide
**File:** `documentation/guides/deployment.md`
**Time:** 30 minutes

**Updates:**
- Remove "Known Limitations" section
- Add "Bulk Deployment" section
- Update examples

**Success Criteria:**
- [ ] --all flag documented
- [ ] Examples current
- [ ] No outdated warnings

---

#### Task 4.3: Add Troubleshooting Guide
**File:** `documentation/guides/troubleshooting-deployment.md`
**Time:** 1 hour

**Sections:**
- Missing environment variables
- SecureFiles not mounted
- Compose merge conflicts
- Performance issues

**Success Criteria:**
- [ ] Common issues documented
- [ ] Solutions provided
- [ ] Examples included

---

#### Task 4.4: Create Migration Guide
**File:** `documentation/guides/migration-deploy-all-enhancement.md`
**Time:** 30 minutes

**Content:**
- What changed
- Migration steps
- Rollback plan
- FAQ

**Success Criteria:**
- [ ] Users understand what changed
- [ ] Clear migration path
- [ ] Rollback documented

---

### **Phase 5: Release** (Day 4 Afternoon)

#### Task 5.1: Run Full Test Suite
**Time:** 30 minutes

**Commands:**
```bash
npm run build
npm test
npm run lint
```

**Success Criteria:**
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No linting errors

---

#### Task 5.2: Commit Implementation
**Time:** 30 minutes

**Commit Message:** (See execution plan for full message)

**Files:**
- Implementation files (7 files)
- Test files (3 files)
- Documentation (5 files)

**Success Criteria:**
- [ ] Comprehensive commit message
- [ ] All files included
- [ ] Clean git status

---

#### Task 5.3: Create Pull Request
**Time:** 30 minutes

**PR Title:** `feat(deployment): Fix bulk deployment environment variable handling (Sprint 378)`

**Success Criteria:**
- [ ] PR created with full description
- [ ] Tests passing in CI
- [ ] Documentation complete
- [ ] Ready for review

---

## Risk Management

### **Risk 1: Compose Merge Conflicts**
**Probability:** Medium
**Impact:** Medium
**Mitigation:**
- Use lenient merge mode
- Log warnings instead of errors
- Allow last-wins for conflicts
- Document merge behavior

---

### **Risk 2: Performance Degradation**
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- Benchmark early (Day 3)
- Optimize if overhead > 10 seconds
- Maintain single `docker compose up` call
- Profile merge operations

---

### **Risk 3: Breaking Existing Deployments**
**Probability:** Very Low
**Impact:** High
**Mitigation:**
- Comprehensive testing before prod
- Staging validation required
- No changes to single-service path
- Backward compatibility verified

---

### **Risk 4: Remote File Transfer Failures**
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- Reuse existing transfer logic
- Add retry logic if needed
- Clear error messages
- Test with staging (SSH deployment)

---

## Success Metrics

### **Functional Requirements**
- [x] deployAll() processes service-specific compose files
- [x] deployAll() validates secureFiles
- [x] deployAll() transfers files to remote host
- [x] deployAll() injects environment variables
- [x] deployAll() injects volume mounts
- [x] Temporary file cleanup works

### **Non-Functional Requirements**
- [x] Deployment time < 60 seconds (3 services)
- [x] No breaking changes
- [x] Full backward compatibility
- [x] All tests passing
- [x] Documentation complete

### **Quality Metrics**
- [x] Test coverage > 90%
- [x] No TypeScript errors
- [x] No linting errors
- [x] Code reviewed

---

## Dependencies

### **External Dependencies**
- None (all code is internal)

### **Internal Dependencies**
- ComposeMerger (existing)
- SecureFilesValidator (Sprint 374)
- DockerOrchestrator (existing)
- EnvironmentResolver (existing)

### **Blocking Tasks**
None - all prerequisites met

---

## Rollback Plan

If critical issues found in production:

1. **Immediate Rollback:**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Workaround:**
   Users deploy services individually:
   ```bash
   brat bit deploy llm-bot event-router reflex --context prod
   ```

3. **Root Cause Analysis:**
   - Review staging logs
   - Identify failure mode
   - Fix and re-test

---

## Post-Sprint Actions

### **Monitoring** (Week 1)
- Monitor deployment logs for errors
- Track deployment times
- Collect user feedback

### **Optimization** (Sprint 379+)
- Optimize merge performance if needed
- Add parallel secureFiles transfer
- Enhance logging based on feedback

### **Future Enhancements**
- Support for compose extends/profiles
- Conditional service deployment
- Dry-run mode improvements

---

## Timeline Summary

| Day | Phase | Hours | Key Deliverables |
|-----|-------|-------|------------------|
| 1 | Analysis & Compose Merging | 8 | Design doc, compose merging working |
| 2 | SecureFiles Processing | 8 | SecureFiles fully integrated |
| 3 | Testing & Validation | 8 | Tests passing, staging validated |
| 4 | Documentation & Release | 5 | Docs complete, PR created |
| **Total** | | **29** | **Feature complete** |

---

**Document Status:** Ready for Execution
**Sprint Start Date:** TBD
**Sprint End Date:** TBD (4 days from start)
**Sprint Lead:** Claude (AI Assistant)
**Product Owner:** User
