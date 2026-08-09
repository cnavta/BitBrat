# Implementation Plan: Fix BEC Creation for Remote Docker with PostgreSQL

**Sprint**: sprint-3-p8ehzo
**Goal**: Fix BitBrat Execution Context creation issues, specifically the "no such service: bitbrat-base" error and PostgreSQL connection resolution failures when creating remote Docker contexts
**Owner**: christophernavta
**Date**: 2026-08-08

---

## Problem Statement

When creating a new BitBrat Execution Context (BEC) using `brat context create staging` with remote Docker and PostgreSQL, the following errors occur:

1. **Build Error**: `no such service: bitbrat-base`
2. **Database Seeding Error**: `Cannot resolve PostgreSQL persistence for context 'staging': No connection config or autoDiscover enabled`

These errors prevent successful creation and initialization of execution contexts.

---

## Root Cause Analysis

### Issue #1: "no such service: bitbrat-base"

**Location**: `tools/brat/src/orchestration/docker/orchestrator.ts:235-268` (`buildBaseImage()` method)

**Root Cause**:
- The `bitbrat-base` service in docker-compose files has `profiles: - build-only` (see `infrastructure/docker-compose/docker-compose.staging.yaml:2-11`)
- Docker Compose profiles require explicit activation using `--profile <name>` flag
- The `buildBaseImage()` method builds the base image with `docker compose build bitbrat-base` but doesn't include `--profile build-only`
- Without the profile activation, Docker Compose doesn't recognize the `bitbrat-base` service

**Evidence**:
```typescript
// orchestrator.ts:253-257
const buildArgs = [...composeArgs, 'build'];
if (this.options.noCache) {
  buildArgs.push('--no-cache');
}
buildArgs.push('bitbrat-base'); // ❌ Missing --profile build-only
```

```yaml
# docker-compose.staging.yaml:2-11
services:
  bitbrat-base:
    profiles:
      - build-only  # ⚠️ Requires --profile build-only to build
    build:
      context: ../..
      dockerfile: Dockerfile.base
    image: bitbrat-base:${BITBRAT_VERSION:-latest}
```

### Issue #2: PostgreSQL Connection Resolution Failure

**Root Cause**:
- This is a **secondary issue** cascading from Issue #1
- When the Docker stack fails to start (due to the bitbrat-base build error), PostgreSQL is never initialized
- The seeding code (`create.ts:111-149`) attempts to seed the database but can't resolve the PostgreSQL connection because the stack isn't running
- Additionally, the error message suggests that the context might not have proper `autoDiscover` or `connection` configuration set

**Evidence**:
```typescript
// create.ts:119-129 (seeding code)
if (contextConfig.runtime.persistence?.driver === 'postgres') {
  const conn = contextConfig.runtime.persistence.connection;
  if (conn) {
    // Explicit connection provided
    process.env.DATABASE_URL = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;
  } else {
    // Auto-discover mode - use localhost since we're seeding from host
    process.env.DATABASE_URL = 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';
  }
}
```

The code assumes that if there's no explicit `connection` config, it can fall back to `localhost:5432`. However, if the Docker stack didn't start successfully, PostgreSQL won't be listening on localhost:5432.

---

## Solution Design

### Fix #1: Activate build-only Profile When Building Base Image

**Change**: Update `buildBaseImage()` method in `DockerOrchestrator` to include `--profile build-only` when building the bitbrat-base image.

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

**Implementation**:
```typescript
// Before (lines 253-257):
const buildArgs = [...composeArgs, 'build'];
if (this.options.noCache) {
  buildArgs.push('--no-cache');
}
buildArgs.push('bitbrat-base');

// After:
const buildArgs = [...composeArgs, '--profile', 'build-only', 'build'];
if (this.options.noCache) {
  buildArgs.push('--no-cache');
}
buildArgs.push('bitbrat-base');
```

**Rationale**:
- Docker Compose profiles are activated using `--profile <name>` flag before the subcommand
- Correct syntax: `docker compose --profile build-only build bitbrat-base`
- This ensures Docker Compose recognizes the bitbrat-base service and builds it

**Impact**:
- **Positive**: Fixes the build error for all execution contexts (local, staging, production)
- **Minimal Risk**: The change is localized to the buildBaseImage method and only affects base image builds
- **Backward Compatible**: Existing contexts will benefit from the fix without requiring changes

### Fix #2: Improve Error Handling for PostgreSQL Connection

**Change**: Add better error handling and validation when seeding the database during context creation.

**File**: `tools/brat/src/commands/context/create.ts`

**Implementation**:

1. **Validate Docker Stack Started Successfully** (lines 90-108):
   - Wrap the `cmdDocker('up', ...)` call in try-catch
   - If Docker stack fails to start, skip seeding entirely (already done)
   - Add clearer error messaging

2. **Add PostgreSQL Connection Validation** (new method):
   ```typescript
   /**
    * Validate PostgreSQL connection before seeding
    * Returns true if PostgreSQL is accessible, false otherwise
    */
   async function validatePostgresConnection(contextConfig: any): Promise<boolean> {
     if (contextConfig.runtime.persistence?.driver !== 'postgres') {
       return false;
     }

     const { Pool } = await import('pg');
     const conn = contextConfig.runtime.persistence.connection;

     const poolConfig = conn
       ? {
           host: conn.host,
           port: conn.port,
           database: conn.database,
           user: conn.username,
           password: conn.password,
         }
       : {
           host: 'localhost',
           port: 5432,
           database: 'bitbrat',
           user: 'bitbrat',
           password: 'bitbrat_dev_password',
         };

     const pool = new Pool({ ...poolConfig, connectionTimeoutMillis: 2000 });

     try {
       await pool.query('SELECT 1');
       await pool.end();
       return true;
     } catch (error) {
       await pool.end();
       return false;
     }
   }
   ```

3. **Use Validation Before Seeding** (lines 111-150):
   ```typescript
   if (shouldSeed) {
     console.log();
     console.log('Validating PostgreSQL connection...');

     const isConnected = await validatePostgresConnection(contextConfig);

     if (!isConnected) {
       console.error();
       console.error('⚠️  Warning: PostgreSQL is not accessible');
       console.error('   Skipping database seeding');
       console.error();
       console.error('You can manually seed later with: brat seed --context ' + contextName);
       console.error();
     } else {
       console.log('✅ PostgreSQL connection validated');
       console.log();
       console.log('Seeding database with initial data...');

       // ... existing seeding code ...
     }
   }
   ```

**Rationale**:
- Provides early detection of PostgreSQL connection issues
- Prevents cryptic errors from the seeding process
- Gives users clear guidance on how to recover (manual seeding)

**Impact**:
- **Positive**: Better error messages and user guidance
- **Low Risk**: Adds validation step but doesn't change core logic
- **User Experience**: Users understand what failed and how to fix it

### Fix #3: Include bitbrat-base in Generated Docker Compose Files

**Change**: Update `generateInfrastructureCompose()` to always include bitbrat-base service from base docker-compose file.

**File**: `tools/brat/src/context/generate-docker-compose.ts`

**Root Cause** (discovered during testing):
- When `brat context create` generates a context-specific docker-compose file, it only includes infrastructure services from the dependency set
- `bitbrat-base` is not in the infrastructure dependency set because it's a build-only service
- Result: Generated docker-compose files lack the bitbrat-base service definition
- Effect: Even with --profile flag, Docker Compose can't find the service to build

**Implementation**:
```typescript
// Before (lines 160-182):
export function generateInfrastructureCompose(
  repoRoot: string,
  infrastructure: Set<string>
): Record<string, ComposeServiceDef> {
  const services: Record<string, ComposeServiceDef> = {};

  // Read base docker-compose.local.yaml for infrastructure definitions
  const baseComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/docker-compose.local.yaml'
  );
  const baseComposeContent = fs.readFileSync(baseComposePath, 'utf-8');
  const baseCompose = yaml.parse(baseComposeContent) as ComposeConfig;

  // Extract infrastructure services
  for (const infraName of infrastructure) {
    if (baseCompose.services[infraName]) {
      services[infraName] = baseCompose.services[infraName];
    }
  }

  return services;
}

// After:
export function generateInfrastructureCompose(
  repoRoot: string,
  infrastructure: Set<string>
): Record<string, ComposeServiceDef> {
  const services: Record<string, ComposeServiceDef> = {};

  // Read base docker-compose.local.yaml for infrastructure definitions
  const baseComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/docker-compose.local.yaml'
  );
  const baseComposeContent = fs.readFileSync(baseComposePath, 'utf-8');
  const baseCompose = yaml.parse(baseComposeContent) as ComposeConfig;

  // Sprint 3: Always include bitbrat-base service (required for building application services)
  // The bitbrat-base service has profiles: [build-only] and is used as the base image
  // for all BitBrat application services (via BASE_IMAGE build arg in Dockerfile.service).
  if (baseCompose.services['bitbrat-base']) {
    services['bitbrat-base'] = baseCompose.services['bitbrat-base'];
  }

  // Extract infrastructure services
  for (const infraName of infrastructure) {
    if (baseCompose.services[infraName]) {
      services[infraName] = baseCompose.services[infraName];
    }
  }

  return services;
}
```

**Rationale**:
- bitbrat-base is required for ALL application service builds (used as BASE_IMAGE in Dockerfile.service)
- It should be present in every generated docker-compose file regardless of infrastructure dependencies
- This ensures Docker Compose can build the base image when orchestrator calls buildBaseImage()

**Impact**:
- **Positive**: Generated docker-compose files now complete and functional
- **Critical**: Without this fix, Fix #1 (profile activation) is ineffective
- **Backward Compatible**: Existing hand-written docker-compose files unaffected

### Fix #5: Populate serviceFiles for Context-Specific Compose Files

**Change**: Update PortManager invocation in orchestrator to extract active services from architecture.yaml when serviceFiles is empty.

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`

**Root Cause** (discovered during user testing):
- When deploying with context-specific compose files (e.g., docker-compose.gramblewort.yaml), ComposeFactory returns empty serviceFiles array
- Lines 47-51 in compose-factory.ts: When `isContextSpecificCompose = true`, method returns early without populating serviceFiles
- Result: PortManager.resolvePorts() receives empty array, can't assign ports
- Effect: All services use default ports (3001, 3002, etc.) causing port conflicts

**Implementation**:
```typescript
// Sprint 3: For context-specific compose files (like docker-compose.gramblewort.yaml),
// serviceFiles is empty because ComposeFactory returns early for context-specific files.
// Extract active service names from architecture.yaml to enable PortManager port assignment.
if (serviceFiles.length === 0 && contextName) {
  const arch = loadArchitecture(this.options.repoRoot);
  const resolvedServices = resolveServices(arch);
  const activeServiceNames = Object.values(resolvedServices)
    .filter((s) => s.active)
    .map((s) => s.name);

  // Create service file paths for PortManager (format matches per-service compose file pattern)
  serviceFiles = activeServiceNames.map((name) =>
    path.join(
      this.options.repoRoot,
      'infrastructure/docker-compose/services',
      `${name}.compose.yaml`
    )
  );

  console.log(
    `[orchestrator] Context-specific deployment detected: populated ${serviceFiles.length} active services from architecture.yaml`
  );
}
```

**Rationale**:
- PortManager needs service names to discover used ports and assign new ports
- For context-specific compose files, service list must come from architecture.yaml
- Service file paths are created to match the expected format for PortManager
- This enables proper port conflict resolution for all deployment modes

**Impact**:
- **Positive**: Port assignment now works correctly for context-specific deployments
- **Critical**: Without this fix, all services conflict on port 3001
- **Backward Compatible**: Only affects context-specific compose files (new pattern)
- **User Experience**: Users can create and deploy contexts without manual port management

---

## Implementation Steps

### Step 1: Fix Base Image Build Profile Activation
1. Edit `tools/brat/src/orchestration/docker/orchestrator.ts`
2. Locate `buildBaseImage()` method (lines 235-268)
3. Update line 253 to include `--profile build-only`:
   ```typescript
   const buildArgs = [...composeArgs, '--profile', 'build-only', 'build'];
   ```
4. Add comment explaining why profile activation is needed

### Step 2: Add PostgreSQL Connection Validation
1. Edit `tools/brat/src/commands/context/create.ts`
2. Add `validatePostgresConnection()` helper function after `waitForPostgres()` (around line 663)
3. Update seeding logic (lines 111-150) to call validation before attempting to seed

### Step 3: Include bitbrat-base in Generated Docker Compose Files
1. Edit `tools/brat/src/context/generate-docker-compose.ts`
2. Locate `generateInfrastructureCompose()` function (lines 160-182)
3. Add bitbrat-base service inclusion before infrastructure loop (lines 176-181):
   ```typescript
   // Always include bitbrat-base service
   if (baseCompose.services['bitbrat-base']) {
     services['bitbrat-base'] = baseCompose.services['bitbrat-base'];
   }
   ```
4. Add comment explaining why bitbrat-base must always be included

### Step 5: Populate serviceFiles for Context-Specific Compose Files
1. Edit `tools/brat/src/orchestration/docker/orchestrator.ts`
2. Locate writeEnvFile() method where serviceFiles is set (around line 367)
3. Add check after serviceFiles assignment (lines 378-400):
   ```typescript
   if (serviceFiles.length === 0 && contextName) {
     const arch = loadArchitecture(this.options.repoRoot);
     const resolvedServices = resolveServices(arch);
     const activeServiceNames = Object.values(resolvedServices)
       .filter((s) => s.active)
       .map((s) => s.name);
     serviceFiles = activeServiceNames.map((name) =>
       path.join(
         this.options.repoRoot,
         'infrastructure/docker-compose/services',
         `${name}.compose.yaml`
       )
     );
   }
   ```
4. Add comment explaining why this is needed

### Step 6: Testing
1. **Test Case 1: Local Context Creation**
   - Run: `brat context create test-local`
   - Select: docker-compose (local), postgres, auto-discover
   - **Expected**: Base image builds successfully, stack starts, database seeds

2. **Test Case 2: Remote Context Creation**
   - Run: `brat context create test-staging`
   - Select: docker-compose (ssh://root@bitbrat.lan), postgres, auto-discover
   - **Expected**: Base image builds successfully, stack starts remotely, database seeds

3. **Test Case 3: Context Creation Without PostgreSQL Running**
   - Stop local PostgreSQL: `docker stop bitbrat-local-postgres`
   - Run: `brat context create test-fail`
   - **Expected**: Base image builds, stack attempts to start, seeding gracefully fails with clear error message

4. **Test Case 4: Re-create Staging Context**
   - Delete old staging context from architecture.yaml
   - Remove env/staging directory
   - Run: `brat context create staging`
   - Select: docker-compose (ssh://root@bitbrat.lan), postgres, auto-discover
   - **Expected**: Staging context created successfully, all services start

5. **Test Case 5: Verify Generated Docker Compose Files**
   - After creating a context, check generated docker-compose file
   - Verify: `grep -q "bitbrat-base:" infrastructure/docker-compose/docker-compose.<context>.yaml`
   - **Expected**: bitbrat-base service is present in generated file

6. **Test Case 6: Verify Port Assignment for Context-Specific Deployments**
   - Create new context: `brat context create test-ports`
   - Check output for: `[orchestrator] Context-specific deployment detected: populated N active services`
   - Check output for: `[orchestrator] Port assignments: service1:3001(auto), service2:3002(auto)...`
   - **Expected**: No port conflicts, each service gets unique port

### Step 7: Validation
1. Build the code: `npm run build`
2. Run tests: `npm test -- orchestrator`
3. Run tests: `npm test -- context/create`
4. Manually test all test cases above
5. Create validation script in `planning/sprint-3-p8ehzo/validate_deliverable.sh`

---

## Validation Criteria

### Build Validation
- ✅ TypeScript compiles without errors
- ✅ All existing tests pass
- ✅ No new ESLint warnings

### Functional Validation
- ✅ `brat context create` successfully creates local contexts
- ✅ `brat context create` successfully creates remote (SSH) contexts
- ✅ Base image builds successfully with `--profile build-only`
- ✅ PostgreSQL connection validation prevents confusing errors
- ✅ Graceful error handling when Docker stack fails to start
- ✅ Port assignment works correctly for context-specific compose files
- ✅ No port conflicts when creating fresh contexts

### Integration Validation
- ✅ Existing contexts (local, staging) continue to work
- ✅ `brat docker up` still builds base image correctly
- ✅ Bulk deployments still work with base image
- ✅ Cloud Run deployments unaffected (don't use docker-compose)

---

## Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Profile flag breaks existing deployments | High | Low | Test with existing local/staging contexts before deploying |
| PostgreSQL validation adds latency | Low | Medium | Validation timeout is only 2 seconds, acceptable overhead |
| Changes affect other docker commands | Medium | Low | Only buildBaseImage is modified, other commands use same compose args |
| Remote deployments fail with new profile flag | Medium | Low | Test with actual staging environment before committing |

---

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate**: Revert the commit containing the changes
2. **Short-term**: Manual workaround: Run `docker compose --profile build-only build bitbrat-base` before `brat context create`
3. **Long-term**: Investigate and fix root cause with additional testing

---

## Documentation Updates

### Files to Update:
1. **CHANGELOG.md**: Add entry for sprint-3-p8ehzo fix
2. **documentation/guides/execution-contexts.md**: Add note about profile activation for base image
3. **tools/brat/README.md**: Update troubleshooting section with PostgreSQL connection validation

### Documentation Content:
- Explain that bitbrat-base uses build-only profile
- Document the PostgreSQL validation step during context creation
- Add troubleshooting steps for "no such service: bitbrat-base" error

---

## Success Metrics

- **Primary**: User can successfully create staging context using `brat context create staging`
- **Secondary**: Base image builds without errors on both local and remote Docker hosts
- **Tertiary**: PostgreSQL connection errors are clear and actionable

---

## Open Questions

1. **Should we add profile activation to other docker commands?**
   - Answer: No. The `buildBaseImage()` method is only called during `docker up`, which is the only place base image builds are needed.

2. **Should we validate PostgreSQL connection for existing contexts?**
   - Answer: No. This validation is only for new context creation. Existing contexts already have working PostgreSQL connections.

3. **Should we add retry logic for PostgreSQL connection validation?**
   - Answer: Yes, the `waitForPostgres()` function already has retry logic with 30-second timeout. We can reuse this pattern.

---

## Implementation Timeline

- **Phase 1**: Fix base image build profile activation (30 minutes)
- **Phase 2**: Add PostgreSQL connection validation (45 minutes)
- **Phase 3**: Testing and validation (60 minutes)
- **Phase 4**: Documentation updates (30 minutes)

**Total Estimated Time**: 2.5 hours

---

## Appendix: Related Files

### Modified Files:
1. `tools/brat/src/orchestration/docker/orchestrator.ts` - Add profile activation (line 257), populate serviceFiles for context-specific deployments (lines 378-400)
2. `tools/brat/src/commands/context/create.ts` - Add PostgreSQL validation
3. `tools/brat/src/context/generate-docker-compose.ts` - Include bitbrat-base service (lines 176-181), fix build context path (line 107)
4. `tools/brat/src/commands/context/create.integration.test.ts` - Fix test syntax (line 122)

### Test Files:
1. `tools/brat/src/orchestration/docker/orchestrator.test.ts` - Unit tests for profile activation
2. `tools/brat/src/commands/context/create.test.ts` - Unit tests for validation
3. `tools/brat/src/commands/context/create.integration.test.ts` - Integration tests

### Documentation Files:
1. `CHANGELOG.md`
2. `documentation/guides/execution-contexts.md`
3. `tools/brat/README.md`
