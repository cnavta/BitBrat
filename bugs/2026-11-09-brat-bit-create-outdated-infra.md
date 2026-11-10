# Bug Report: `brat bit create` Generates Outdated Infrastructure Configuration

**Bug ID**: BUG-2026-11-09-003
**Severity**: High
**Status**: Open
**Reported**: 2026-11-09
**Affects**: All new services created with `brat bit create`
**Component**: `brat bit create` command / service template generation

---

## Summary

The `brat bit create` command generates files using outdated patterns, causing deployment failures and runtime issues:

1. **Infrastructure Issue**: Docker-compose configuration uses outdated patterns (pre-Sprint 375) with service-specific Dockerfiles instead of shared `Dockerfile.service`
2. **Service Code Issue**: TypeScript service template doesn't include `onStartup()` hook registration, preventing setup() method from being called

---

## Environment

- **Command**: `npm run brat -- bit create <name> [flags]`
- **Affected Services**: All newly created services (discovered: tool-orchestrator in Sprint 57)
- **Sprint Context**: Sprint 375 introduced shared Dockerfile.base and Dockerfile.service
- **Current State**: 20+ existing services use modern approach; `brat bit create` still generates old approach

---

## Problem Description

### Issue 1: Docker-Compose Infrastructure (Original Issue)

When creating a new service using `brat bit create`, the generated `infrastructure/docker-compose/services/<service>.compose.yaml` file contains:

```yaml
# GENERATED (WRONG)
build:
  context: .
  dockerfile: Dockerfile.<service-name>
```

This causes deployment failures:
```
failed to solve: failed to read dockerfile: open Dockerfile.<service-name>: no such file or directory
```

**Expected**: Generate modern Sprint 375 configuration:
```yaml
# EXPECTED (CORRECT)
build:
  context: ../..  # Sprint 375: Build context is repository root
  dockerfile: Dockerfile.service
  args:
    BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
    SERVICE_NAME: <service-name>
    SERVICE_ENTRY: dist/apps/<service-name>.js
    SERVICE_PORT: "3000"
```

---

### Issue 2: Missing onStartup() Hook Registration (Discovered 2026-11-09)

When creating a new service that includes a `setup()` method, the generated TypeScript code in `src/apps/<service>-service.ts` does not register the setup method as a startup hook.

**Generated Code (WRONG)**:
```typescript
export class ServiceNameServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform-only' });
    // ❌ Missing: No onStartup() registration!
  }

  public async setup(): Promise<void> {
    // Setup logic that will NEVER be called
    this.logger.info('setup.start');
    // ... initialization code
  }
}
```

**Impact**: The `setup()` method is never called, causing:
- Services fail to initialize properly
- Resources not created (ToolRegistry, ModelRegistry, etc.)
- MCP tools not registered
- Silent failure (no error, service appears healthy but non-functional)

**Expected Pattern** (from claim-check-service.ts, utility-service.ts):
```typescript
export class ServiceNameServer extends Bit {
  constructor() {
    super({ mcpExposure: 'platform-only' });

    // ✅ REQUIRED: Register setup to run on startup
    this.onStartup(async () => {
      await this.setup();
    });
  }

  public async setup(): Promise<void> {
    // Setup logic now WILL be called
    this.logger.info('setup.start');
    // ... initialization code
  }
}
```

**Evidence (tool-orchestrator)**:
- **Before fix**: No setup logs, ToolRegistry/ModelRegistry not initialized, custom MCP tools missing
- **After fix**: All setup logs present, all resources initialized, all 15 MCP tools registered

**Root Cause**: The service template doesn't include the `onStartup()` hook pattern, even though multiple existing services (claim-check, utility) use it correctly.

---

## Steps to Reproduce

### Infrastructure Issue (Issue 1)

1. **Create new service**:
   ```bash
   npm run brat -- bit create test-service \
     --profile core \
     --exposure platform-only \
     --register --active
   ```

2. **Check generated compose file**:
   ```bash
   cat infrastructure/docker-compose/services/test-service.compose.yaml
   ```

3. **Observe outdated configuration**:
   - `dockerfile: Dockerfile.test-service` (doesn't exist)
   - `context: .` (wrong build context)
   - No build args (BASE_IMAGE, SERVICE_NAME, etc.)
   - Hardcoded ports instead of `${SERVICE_PORT:-3000}`

4. **Attempt deployment**:
   ```bash
   npm run brat -- bit deploy test-service --context staging
   ```

5. **Result**: Deployment fails with "failed to read dockerfile" error

---

### Service Code Issue (Issue 2)

1. **Create new service with initialization requirements**:
   ```bash
   npm run brat -- bit create test-service \
     --profile core \
     --exposure platform-only \
     --register --active
   ```

2. **Add setup() method to generated service** (manual addition):
   ```typescript
   // src/apps/test-service-service.ts
   public async setup(): Promise<void> {
     this.logger.info('test_service.setup.start');
     // Initialize resources, register tools, etc.
     this.logger.info('test_service.setup.complete');
   }
   ```

3. **Build and deploy**:
   ```bash
   npm run build
   npm run brat -- bit deploy test-service --context staging
   ```

4. **Check logs**:
   ```bash
   docker logs test-service | grep setup
   ```

5. **Result**: No setup logs appear, setup() never called, service non-functional but appears healthy

---

## Expected Behavior

When `brat bit create` generates a new service, it should:

### Infrastructure (Issue 1)

1. ✅ Use **modern Sprint 375 infrastructure pattern**:
   - Build context: `../..` (repository root)
   - Dockerfile: `Dockerfile.service` (shared)
   - Build args: BASE_IMAGE, SERVICE_NAME, SERVICE_ENTRY, SERVICE_PORT

2. ✅ Match **existing service patterns** (tool-gateway, llm-bot, auth, etc.)

3. ✅ Include **all modern conventions**:
   - Network aliases for service discovery
   - Standard MCP_AUTH_TOKEN environment variable
   - Modern healthcheck configuration (`/healthz`, faster intervals)
   - Port references using `${SERVICE_PORT:-3000}`

4. ✅ **No service-specific Dockerfile** unless explicitly needed (escape hatch)

### Service Code (Issue 2)

5. ✅ **Include onStartup() hook registration** for services with setup():
   - Constructor calls `this.onStartup(async () => { await this.setup(); })`
   - Pattern matches claim-check-service.ts, utility-service.ts
   - Ensures setup() is actually called on service start

6. ✅ **Include setup() method template** with:
   - Proper logging (setup.start, setup.complete)
   - Error handling with try/catch
   - Comments explaining what initialization should happen

---

## Actual Behavior

The `brat bit create` command generates outdated patterns:

### Infrastructure (Issue 1)
- ❌ Service-specific Dockerfile that doesn't exist
- ❌ Wrong build context (`.` instead of `../..`)
- ❌ Missing build args
- ❌ Hardcoded ports
- ❌ Missing network aliases
- ❌ Outdated healthcheck patterns
- ❌ Missing MCP_AUTH_TOKEN

### Service Code (Issue 2)
- ❌ Constructor doesn't call `this.onStartup()`
- ❌ setup() method defined but never called
- ❌ No comments or documentation about startup hook pattern
- ❌ Silent failure (service appears healthy but non-functional)

---

## Impact

### Severity: High

**Why High**:
- **Issue 1**: Blocks deployment of all newly created services
- **Issue 2**: Silent runtime failure (service appears healthy but non-functional)
- Affects developer productivity (manual fix required for both issues)
- Creates inconsistency across codebase
- Violates established infrastructure patterns (Sprint 375) and service initialization patterns

### Scope

**Confirmed Affected**:
- ✅ tool-orchestrator (Sprint 57) - Discovered via staging deployment failure

**Likely Affected** (any service created after Sprint 375):
- Any services created in sprints 375+ using `brat bit create`

**NOT Affected**:
- ✅ Existing 20+ services (manually updated or created before Sprint 375)
- ✅ Test services (test-warning-check, test-final-check) - These intentionally use old pattern for testing

### Impact Timeline

**Sprint 375 (Date Unknown)**: Modern infrastructure introduced
- Dockerfile.base and Dockerfile.service created
- All existing services migrated to new pattern
- `brat bit create` template NOT updated (bug introduced)

**Sprint 57 (2026-11-09)**: Both bugs discovered
- **Issue 1**: tool-orchestrator created with outdated docker-compose config
  - Deployment to staging initially failed
  - Manual remediation applied (fixed docker-compose)
- **Issue 2**: tool-orchestrator deployed successfully but non-functional
  - setup() never called, ToolRegistry/ModelRegistry not initialized
  - Custom MCP tools not registered (silent failure)
  - Fixed by adding `onStartup()` hook to constructor
  - Redeployed and verified working

**Future Sprints**: All new services affected until fixed

---

## Root Cause Analysis

### Code Location

Both issues originate in the `brat bit create` command's template generation logic:

**File**: `tools/brat/src/oclif-commands/bit/create.ts` (or similar)

### Issue 1: Hardcoded or outdated docker-compose template

```typescript
// SUSPECTED (WRONG)
const dockerComposeTemplate = `
services:
  ${serviceName}:
    build:
      context: .
      dockerfile: Dockerfile.${serviceName}  // ❌ OLD PATTERN
    ...
`;
```

**Expected Fix**: Use modern template with build args

```typescript
// EXPECTED (CORRECT)
const dockerComposeTemplate = `
services:
  ${serviceName}:
    env_file:
      - .env.brat
    build:
      context: ../..  # Sprint 375: Build context is repository root
      dockerfile: Dockerfile.service
      args:
        BASE_IMAGE: bitbrat-base:\${BITBRAT_VERSION:-latest}
        SERVICE_NAME: ${serviceName}
        SERVICE_ENTRY: ${serviceEntry}
        SERVICE_PORT: "3000"
    ...
`;
```

---

### Issue 2: Missing onStartup() hook in TypeScript service template

```typescript
// GENERATED (WRONG)
export class ${ServiceName}Server extends Bit {
  constructor() {
    super({ mcpExposure: '${mcpExposure}' });
    // ❌ Missing: No onStartup() registration!
  }

  public async setup(): Promise<void> {
    // Setup logic that will NEVER be called
  }
}
```

**Expected Fix**: Include onStartup() hook registration pattern

```typescript
// EXPECTED (CORRECT)
export class ${ServiceName}Server extends Bit {
  constructor() {
    super({ mcpExposure: '${mcpExposure}' });

    // ✅ REQUIRED: Register setup to run on startup
    this.onStartup(async () => {
      await this.setup();
    });
  }

  public async setup(): Promise<void> {
    this.getLogger().info('${serviceName}.setup.start');

    try {
      // Initialize resources, register tools, etc.
      // TODO: Add your initialization logic here

      this.getLogger().info('${serviceName}.setup.complete');
    } catch (err) {
      this.getLogger().error('${serviceName}.setup_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
```

**Why This Pattern is Required**:
- The Bit base class's `start()` method runs `startupHooks` before listening (base-server.ts:293)
- Services must explicitly register setup() via `onStartup()` for it to be called
- Without this, setup() is defined but never executed (silent failure)
- Pattern is used correctly in claim-check-service.ts, utility-service.ts

---

### Why These Weren't Caught Earlier

1. **Low service creation frequency**: New services created infrequently (Sprint 57 is first since Sprint 375?)
2. **Manual workarounds**: Developers may have manually fixed generated files
3. **Test services exempt**: Test services intentionally use old pattern
4. **No automated validation**: No CI check to verify generated files match modern pattern
5. **Issue 2 specific**: Silent failure makes detection hard
   - Service appears healthy (health check passes)
   - No error logs or warnings
   - Only detected when expected functionality missing (MCP tools not registered)
   - Requires deep investigation of service logs to identify

---

## Proposed Solutions

### Solution 1: Update Templates (Recommended)

**File**: `tools/brat/src/oclif-commands/bit/create.ts` (or template files)

**Actions for Issue 1 (Docker-Compose)**:
1. Update docker-compose template to Sprint 375 standard
2. Include all modern conventions:
   - Build context: `../..`
   - Dockerfile: `Dockerfile.service`
   - Build args: BASE_IMAGE, SERVICE_NAME, SERVICE_ENTRY, SERVICE_PORT
   - Network aliases
   - MCP_AUTH_TOKEN
   - Modern healthcheck

3. Infer SERVICE_ENTRY from service name:
   ```typescript
   const serviceEntry = profile === 'mcp-server'
     ? `dist/services/${serviceName}/index.js`
     : `dist/apps/${serviceName}-service.js`;
   ```

4. Add comments explaining Sprint 375 patterns

**Actions for Issue 2 (TypeScript Service)**:
1. Update TypeScript service template to include onStartup() hook:
   ```typescript
   constructor() {
     super({ mcpExposure: '${mcpExposure}' });

     // Register setup to run on startup
     this.onStartup(async () => {
       await this.setup();
     });
   }
   ```

2. Include setup() method template with:
   - Proper logging (setup.start, setup.complete)
   - Try/catch error handling
   - TODO comments for initialization logic

3. Add comments explaining the startup hook pattern

**Estimated Effort**: 3-4 hours (both issues)

---

### Solution 2: Add Template Validation

**File**: `tools/brat/src/oclif-commands/bit/create.ts`

**Actions**:
1. After generating files, validate both docker-compose and TypeScript code
2. Check for modern patterns:
   ```typescript
   function validateGeneratedFiles(serviceName: string): ValidationResult {
     const errors = [];

     // Issue 1: Validate docker-compose
     const composeConfig = readFileSync(`infrastructure/docker-compose/services/${serviceName}.compose.yaml`, 'utf-8');

     if (composeConfig.includes('dockerfile: Dockerfile.') && !composeConfig.includes('Dockerfile.service')) {
       errors.push('[Issue 1] Uses service-specific Dockerfile (old pattern)');
     }

     if (composeConfig.includes('context: .') && !composeConfig.includes('context: ../..')) {
       errors.push('[Issue 1] Uses current directory build context (old pattern)');
     }

     if (!composeConfig.includes('BASE_IMAGE:')) {
       errors.push('[Issue 1] Missing BASE_IMAGE build arg (required for Sprint 375 pattern)');
     }

     // Issue 2: Validate TypeScript service
     const serviceCode = readFileSync(`src/apps/${serviceName}-service.ts`, 'utf-8');

     if (serviceCode.includes('async setup()') && !serviceCode.includes('this.onStartup')) {
       errors.push('[Issue 2] Service has setup() method but no onStartup() registration');
     }

     return { valid: errors.length === 0, errors };
   }
   ```

3. Warn user if validation fails
4. Optionally: Block creation with `--strict` flag

**Estimated Effort**: 2-3 hours (addition to Solution 1)

---

### Solution 3: Add Documentation Warning

**File**: `documentation/guides/creating-new-bits.md`

**Actions**:
1. Add prominent warning about outdated generation
2. Provide manual fix steps
3. Reference modern pattern examples (tool-gateway, llm-bot)

**Pros**: Quick fix, helps users immediately
**Cons**: Doesn't solve root cause, requires manual intervention

**Estimated Effort**: 30 minutes

---

## Prevention Recommendations

### 1. Automated Template Testing

Add test case to verify `brat bit create` generates modern config:

```typescript
// tools/brat/src/__tests__/bit-create.test.ts
describe('bit create', () => {
  it('should generate Sprint 375 compliant docker-compose config', async () => {
    // Create test service
    await exec('npm run brat -- bit create test-modern --profile core');

    // Read generated config
    const config = readFileSync(
      'infrastructure/docker-compose/services/test-modern.compose.yaml',
      'utf-8'
    );

    // Validate modern patterns
    expect(config).toContain('context: ../..');
    expect(config).toContain('dockerfile: Dockerfile.service');
    expect(config).toContain('BASE_IMAGE: bitbrat-base');
    expect(config).toContain('SERVICE_NAME: test-modern');
    expect(config).toContain('SERVICE_ENTRY:');
    expect(config).toContain('SERVICE_PORT:');
    expect(config).toContain('MCP_AUTH_TOKEN');
    expect(config).toContain('test-modern.bitbrat.local');

    // Validate NOT using old patterns
    expect(config).not.toContain('Dockerfile.test-modern');
    expect(config).not.toContain('context: .');

    // Cleanup
    // ... delete test service files
  });
});
```

### 2. CI/CD Validation

Add GitHub Actions step to validate newly created services:

```yaml
# .github/workflows/validate-infra.yml
name: Validate Infrastructure Config

on: [pull_request]

jobs:
  validate-docker-compose:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for outdated docker-compose patterns
        run: |
          # Find service-specific Dockerfiles in compose files (excluding tests)
          if grep -r "dockerfile: Dockerfile\." infrastructure/docker-compose/services/ \
             | grep -v "test-"; then
            echo "❌ Found service-specific Dockerfile references (old pattern)"
            echo "Use: dockerfile: Dockerfile.service"
            exit 1
          fi

          # Check for wrong build context
          if grep -r "context: \." infrastructure/docker-compose/services/ \
             | grep -v "test-"; then
            echo "❌ Found current directory build context (old pattern)"
            echo "Use: context: ../.."
            exit 1
          fi

          echo "✅ All docker-compose configs use modern Sprint 375 patterns"
```

### 3. Documentation Update

**File**: `CLAUDE.md` (section: Building Services)

Update to be more explicit:

```markdown
### Building Services

**Modern Pattern (Sprint 375+)**: All services MUST use:
- Build context: `../..` (repository root)
- Dockerfile: `Dockerfile.service` (shared)
- Build args: BASE_IMAGE, SERVICE_NAME, SERVICE_ENTRY, SERVICE_PORT

**Old Pattern (DEPRECATED)**: Service-specific Dockerfiles
- `Dockerfile.<service>` - Only for escape hatches (rare cases)
- Do NOT use for new services

**When creating new services**:
1. Use `brat bit create` (generates boilerplate)
2. ⚠️ **IMPORTANT**: Verify generated docker-compose config matches modern pattern
3. If outdated: Manually update to Sprint 375 standard (see tool-gateway example)
```

---

## Verification Plan

After fix is implemented:

### 1. Generate Test Service

```bash
npm run brat -- bit create test-sprint-375 \
  --profile core \
  --exposure platform-only \
  --register --active
```

### 2. Validate Generated Files

```bash
# Check docker-compose config
cat infrastructure/docker-compose/services/test-sprint-375.compose.yaml

# Expected patterns:
# - context: ../..
# - dockerfile: Dockerfile.service
# - BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
# - SERVICE_NAME: test-sprint-375
# - SERVICE_ENTRY: dist/apps/test-sprint-375-service.js
# - SERVICE_PORT: "3000"
# - MCP_AUTH_TOKEN: ${MCP_AUTH_TOKEN}
# - test-sprint-375.bitbrat.local
```

### 3. Deploy Test Service

```bash
# Should build and deploy without errors
npm run brat -- bit deploy test-sprint-375 --context local

# Verify service starts
docker logs test-sprint-375 | grep "setup.complete"
```

### 4. Cleanup

```bash
# Remove test service
docker stop test-sprint-375
docker rm test-sprint-375
rm src/apps/test-sprint-375-service.ts
rm src/apps/test-sprint-375-service.test.ts
rm infrastructure/docker-compose/services/test-sprint-375.compose.yaml

# Update architecture.yaml to remove service
```

---

## Immediate Workaround

For services already created with outdated config (like tool-orchestrator):

1. **Manual fix** (5-10 minutes per service):
   - Copy docker-compose config from tool-gateway or llm-bot
   - Update service name and entry point
   - Redeploy

2. **Reference**: See `planning/sprint-57-54vza9/tool-orchestrator-infra-remediation.md`

---

## Related Issues

- **BUG-2026-11-09-001**: firebase-emulator dependency (✅ Fixed)
- **BUG-2026-11-09-002**: Single-service deployment missing dependencies (Open)
- **Sprint 375**: Infrastructure standardization (modern pattern introduced)

---

## Recommendations

### Immediate (Sprint 57 or 58)
1. ✅ Fix tool-orchestrator (manual remediation)
2. ✅ Update `brat bit create` template (Solution 1)
3. ✅ Add documentation warning (Solution 3)

### Short-term (Sprint 58-59)
1. ✅ Add template validation (Solution 2)
2. ✅ Add automated tests for service generation
3. ✅ Update CLAUDE.md with explicit patterns

### Long-term (Sprint 60+)
1. ✅ Add CI validation for all docker-compose files
2. ✅ Audit all services created since Sprint 375
3. ✅ Consider `brat bit validate` command to check existing services

---

## Comparative Analysis

### Services Using Modern Pattern (Sprint 375) - 20+ Services

All of these use `dockerfile: Dockerfile.service` with build args:

- auth
- claim-check
- ingress-egress
- image-gen-mcp
- query-analyzer
- context-pack
- reflex
- llm-bot
- story-engine-mcp
- api-gateway
- utility
- state-engine
- tool-gateway
- scheduler
- persistence
- event-router
- oauth-flow
- obs-mcp
- event-stream-analyzer
- disposition-service
- stream-analyst-service
- (and more...)

### Services Using Old Pattern - 4 Services

- **tool-orchestrator** (BUG - Sprint 57, should use modern)
- test-warning-check (TEST SERVICE - intentional)
- test-from-main-with-warning (TEST SERVICE - intentional)
- test-final-check (TEST SERVICE - intentional)

**Pattern Clear**: All production services use modern approach; only tool-orchestrator and test services use old approach.

---

## Success Criteria

- ✅ `brat bit create` generates docker-compose files with Sprint 375 patterns
- ✅ Generated services deploy successfully without manual fixes
- ✅ Generated files match existing service patterns (tool-gateway, llm-bot)
- ✅ All modern conventions included (network aliases, MCP_AUTH_TOKEN, etc.)
- ✅ Automated tests validate generation
- ✅ Documentation updated with clear guidance
- ✅ No regression in existing functionality

---

## Notes

- **Issue 1** was introduced sometime after Sprint 375's infrastructure standardization
- **Issue 2** has existed since the Bit base class introduced onStartup() hooks
- Likely went unnoticed due to infrequent service creation
- Tool-orchestrator (Sprint 57) is first confirmed case of both issues
- Fixes are straightforward: Update templates to match existing patterns
- Template updates will prevent future occurrences

---

## Resolution Status

### Issue 1: Docker-Compose Infrastructure
**Status**: ⚠️ **Template NOT Fixed** (manual workaround applied to tool-orchestrator)

- **tool-orchestrator**: ✅ Manually fixed (2026-11-09)
  - Updated docker-compose config to Sprint 375 standard
  - See: `planning/sprint-57-54vza9/REMEDIATION-COMPLETE.md`
- **Template fix**: ⏳ Pending (requires Solution 1)

### Issue 2: Missing onStartup() Hook
**Status**: ✅ **Fixed in tool-orchestrator** / ⚠️ **Template NOT Fixed**

- **tool-orchestrator**: ✅ Fixed (2026-11-09)
  - Added `this.onStartup(async () => { await this.setup(); })` to constructor
  - All setup logs now present, all MCP tools registered
  - Service fully functional
  - See: `planning/sprint-57-54vza9/SETUP-FIX-COMPLETE.md`
- **Template fix**: ⏳ Pending (requires Solution 1)

### Verification

**Before Fixes** (tool-orchestrator):
- ❌ Deployment failed (Issue 1)
- ❌ Service non-functional (Issue 2: setup() never called)
- ❌ ToolRegistry not initialized
- ❌ ModelRegistry not initialized
- ❌ Custom MCP tools missing (4 tools)
- ❌ Total tools: 11 (only bit.* control plane)

**After Fixes** (tool-orchestrator):
- ✅ Deployment successful (Issue 1 fixed)
- ✅ Service fully functional (Issue 2 fixed)
- ✅ ToolRegistry initialized
- ✅ ModelRegistry initialized
- ✅ All custom MCP tools registered (tool.list, tool.get, model.list, model.get)
- ✅ Total tools: 15 (11 bit.* + 4 custom)

### Next Steps

1. **Update `brat bit create` template** (Solution 1)
   - Fix docker-compose generation (Issue 1)
   - Fix TypeScript service template (Issue 2)
   - Estimated effort: 3-4 hours

2. **Add template validation** (Solution 2)
   - Validate both issues after generation
   - Warn developers if outdated patterns detected
   - Estimated effort: 2-3 hours

3. **Update documentation** (Solution 3)
   - Document both issues and workarounds
   - Reference tool-orchestrator fix as example
   - Estimated effort: 30 minutes

### Related Documentation

- **Issue 1 fix**: `planning/sprint-57-54vza9/REMEDIATION-COMPLETE.md`
- **Issue 2 fix**: `planning/sprint-57-54vza9/SETUP-FIX-COMPLETE.md`
- **Post-deployment**: `planning/sprint-57-54vza9/POST-DEPLOYMENT-COMPLETE.md`
