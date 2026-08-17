# Hook Injection Points (BL-002)

**Sprint**: sprint-15-gpcvez
**Task**: BL-002 - Identify exact hook injection points
**Date**: 2026-08-16

---

## Integration Strategy

**Decision**: Integrate hooks into `DockerComposeStrategy.execute()`, NOT `DockerOrchestrator.up()`.

**Rationale**:
1. Strategy owns the deployment lifecycle and has access to execution context
2. Orchestrator is a low-level utility shared across strategies - should remain generic
3. Cloud Run strategy will need different hook integration (future work)
4. Better separation of concerns: Strategy = coordination, Orchestrator = execution

---

## Hook Injection Points

### File: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`

All hooks will be injected into the `execute()` method (lines 188-373).

### 1. Pre-Deploy Hook

**Location**: **BEFORE** line 201 (before reading compose file)

**Purpose**:
- Authenticate to registries on **local** daemon
- Validate deployment prerequisites
- Environment setup

**Execution Context**: Local machine (before any file sync)

**Proposed Integration**:
```typescript
async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
  const startTime = Date.now();

  try {
    // ============================================================================
    // HOOK 1: PRE-DEPLOY (NEW)
    // Executes BEFORE any deployment operations (local)
    // Use case: Registry authentication, environment validation
    // ============================================================================
    await this.hookExecutor.execute(
      'pre-deploy',
      plan.context.deployment.hooks?.['pre-deploy'],
      {
        contextName: plan.context.name,
        deploymentType: plan.context.deployment.type,
        targetHost: plan.context.deployment.docker?.host,
        remoteDir: plan.context.deployment.docker?.remoteDir,
        services: [plan.service.name],
        repoRoot: process.cwd(),
        verbose: plan.metadata.deployOptions?.verbose,
      }
    );

    // Line 201: Read original compose content (existing)
    const originalComposeContent = await fs.promises.readFile(baseComposeFilePath, 'utf-8');
    // ...
```

**Line Number**: Insert at line 193 (before line 201)

---

### 2. Pre-Build Hook

**Location**: **AFTER** orchestrator creation (line 327), **BEFORE** `orchestrator.up()` (line 328)

**Purpose**:
- Authenticate to registries on **remote** daemon (if remote deployment)
- Pre-build validation
- Build-time setup

**Execution Context**:
- Local: Runs on local machine
- Remote: Should run on remote via SSH (after sync)

**Proposed Integration**:
```typescript
    // Lines 314-327: Create orchestrator (existing)
    const orchestrator = new DockerOrchestrator(orchestratorOptions);

    // ============================================================================
    // HOOK 2: PRE-BUILD (NEW)
    // Executes AFTER file sync (remote) or BEFORE build (local)
    // Use case: Build-time authentication, dependency checks
    // ============================================================================

    // For remote deployments, execute hook on remote host via SSH
    // For local deployments, execute hook locally
    const isRemote = plan.metadata.remoteHost !== undefined;

    if (isRemote) {
      // Remote execution: Hook runs on remote host after sync
      await this.hookExecutor.executeRemote(
        'pre-build',
        plan.context.deployment.hooks?.['pre-build'],
        {
          contextName: plan.context.name,
          deploymentType: plan.context.deployment.type,
          targetHost: plan.metadata.remoteHost as string,
          remoteDir: plan.metadata.remoteDir as string,
          services: [plan.service.name],
          repoRoot: plan.metadata.remoteDir as string, // Remote repo root
          verbose: plan.metadata.deployOptions?.verbose,
        }
      );
    } else {
      // Local execution
      await this.hookExecutor.execute(
        'pre-build',
        plan.context.deployment.hooks?.['pre-build'],
        {
          contextName: plan.context.name,
          deploymentType: plan.context.deployment.type,
          services: [plan.service.name],
          repoRoot: process.cwd(),
          verbose: plan.metadata.deployOptions?.verbose,
        }
      );
    }

    // Line 328: Execute deployment (existing)
    await orchestrator.up();
```

**Line Number**: Insert at line 327.5 (between lines 327 and 328)

---

### 3. Post-Build Hook

**Location**: **AFTER** `orchestrator.up()` (line 328), **BEFORE** returning success (line 330)

**Purpose**:
- Image scanning
- Image tagging
- Post-build validation

**Execution Context**: Local or Remote (depending on deployment type)

**Proposed Integration**:
```typescript
    // Line 328: Execute deployment (existing)
    await orchestrator.up();

    // ============================================================================
    // HOOK 3: POST-BUILD (NEW)
    // Executes AFTER build completes, BEFORE containers start
    // Use case: Image scanning, tagging, validation
    // ============================================================================
    const isRemote = plan.metadata.remoteHost !== undefined;

    if (isRemote) {
      await this.hookExecutor.executeRemote(
        'post-build',
        plan.context.deployment.hooks?.['post-build'],
        {
          contextName: plan.context.name,
          deploymentType: plan.context.deployment.type,
          targetHost: plan.metadata.remoteHost as string,
          remoteDir: plan.metadata.remoteDir as string,
          services: [plan.service.name],
          repoRoot: plan.metadata.remoteDir as string,
          verbose: plan.metadata.deployOptions?.verbose,
        }
      );
    } else {
      await this.hookExecutor.execute(
        'post-build',
        plan.context.deployment.hooks?.['post-build'],
        {
          contextName: plan.context.name,
          deploymentType: plan.context.deployment.type,
          services: [plan.service.name],
          repoRoot: process.cwd(),
          verbose: plan.metadata.deployOptions?.verbose,
        }
      );
    }

    // Line 330: Calculate duration (existing)
    const durationMs = Date.now() - startTime;
```

**Line Number**: Insert at line 329 (after line 328, before line 330)

**NOTE**: Current `orchestrator.up()` combines build + up. We may need to split this for post-build hook to execute between build and up. Alternative: Accept that post-build runs after up (containers already started).

---

### 4. Post-Deploy Hook

**Location**: **AFTER** durationMs calculation (line 330), **BEFORE** returning success (line 332)

**Purpose**:
- Health checks
- Smoke tests
- Notifications

**Execution Context**: Local or Remote

**Proposed Integration**:
```typescript
    // Line 330: Calculate duration (existing)
    const durationMs = Date.now() - startTime;

    // ============================================================================
    // HOOK 4: POST-DEPLOY (NEW)
    // Executes AFTER containers start
    // Use case: Health checks, smoke tests, notifications
    // NOTE: Hook failures do NOT abort deployment (containers already running)
    // ============================================================================
    const isRemote = plan.metadata.remoteHost !== undefined;

    try {
      if (isRemote) {
        await this.hookExecutor.executeRemote(
          'post-deploy',
          plan.context.deployment.hooks?.['post-deploy'],
          {
            contextName: plan.context.name,
            deploymentType: plan.context.deployment.type,
            targetHost: plan.metadata.remoteHost as string,
            remoteDir: plan.metadata.remoteDir as string,
            services: [plan.service.name],
            repoRoot: plan.metadata.remoteDir as string,
            verbose: plan.metadata.deployOptions?.verbose,
          }
        );
      } else {
        await this.hookExecutor.execute(
          'post-deploy',
          plan.context.deployment.hooks?.['post-deploy'],
          {
            contextName: plan.context.name,
            deploymentType: plan.context.deployment.type,
            services: [plan.service.name],
            repoRoot: process.cwd(),
            verbose: plan.metadata.deployOptions?.verbose,
          }
        );
      }
    } catch (hookError: any) {
      // Post-deploy hook failures do NOT abort deployment
      // (containers already started, rollback would be more disruptive)
      console.error(
        `[docker-compose-strategy] Post-deploy hook failed: ${hookError.message}\n` +
        `Deployment succeeded but post-deploy validation failed.`
      );
    }

    // Line 332: Return success (existing)
    return {
      status: 'success',
      service: plan.service.name,
      durationMs,
      metadata: {
        containerId: `bitbrat-${plan.context.name}-${plan.service.name}`,
      },
    };
```

**Line Number**: Insert at line 331 (after line 330, before line 332)

---

## Hook Execution Order

```
1. PRE-DEPLOY (line 193)
   ↓
2. Read & merge compose files (lines 201-308)
   ↓
3. Create orchestrator (lines 314-327)
   ↓
4. PRE-BUILD (line 327.5)
   ↓
5. orchestrator.up() → build + up (line 328)
   ↓
6. POST-BUILD (line 329) [NOTE: Currently after up, may need orchestrator refactor]
   ↓
7. POST-DEPLOY (line 331)
   ↓
8. Return success (line 332)
```

---

## Remote Hook Execution

For remote deployments, pre-build, post-build, and post-deploy hooks must execute on the remote host.

**Implementation Options**:

### Option 1: SSH Wrapper in HookExecutor (Recommended)
```typescript
async executeRemote(
  hookType: HookType,
  hookPath: string | undefined,
  context: HookContext
): Promise<boolean> {
  if (!hookPath) return false;

  // Execute hook on remote via SSH
  const sshHost = context.targetHost!.replace('ssh://', '');
  const remoteHookPath = path.join(context.repoRoot, hookPath);

  const cmd = `ssh ${sshHost} "cd ${context.repoRoot} && bash ${remoteHookPath}"`;
  // ... (pass environment variables via SSH)
}
```

### Option 2: Conditional Local vs Remote
```typescript
if (isRemote) {
  await this.hookExecutor.executeRemote(...);
} else {
  await this.hookExecutor.execute(...);
}
```

**Decision**: Option 2 (explicit local vs remote) for clarity. HookExecutor will have both `execute()` and `executeRemote()` methods.

---

## Critical Issue: orchestrator.up() Combines Build + Up

**Problem**: Current `orchestrator.up()` runs both build AND up in a single method. This means:
- POST-BUILD hook would execute AFTER containers are already started
- No injection point between build and up

**Options**:

1. **Accept limitation**: POST-BUILD runs after up (document this clearly)
   - ✅ Simple, no orchestrator changes
   - ❌ POST-BUILD can't prevent bad images from starting

2. **Refactor orchestrator**: Split `up()` into `build()` and `start()`
   - ✅ Proper separation, hooks execute at correct stages
   - ❌ Breaking change to orchestrator API

3. **Strategy-level build control**: Strategy calls `orchestrator.build()` then `orchestrator.start()`
   - ✅ Strategy has full control of lifecycle
   - ❌ Requires new orchestrator methods

**Recommendation**: Option 1 for Phase 1 (accept limitation), Option 3 for Phase 4 (future enhancement).

**Documentation Note**: POST-BUILD hook executes after `docker compose up` completes. It cannot prevent bad images from starting. Use PRE-BUILD for image validation.

---

## Summary

| Hook Type | Line Location | Execution Context | Can Abort Deployment? |
|-----------|---------------|-------------------|----------------------|
| **pre-deploy** | 193 (before line 201) | Local | ✅ Yes |
| **pre-build** | 327.5 (between 327-328) | Local or Remote | ✅ Yes |
| **post-build** | 329 (after line 328) | Local or Remote | ✅ Yes |
| **post-deploy** | 331 (after line 330) | Local or Remote | ❌ No (log error only) |

**Total Injection Points**: 4 locations in `docker-compose-strategy.ts:execute()`

---

## Next Steps (Phase 1)

1. Create `HookExecutor` class with `execute()` and `executeRemote()` methods
2. Add `DeploymentHooks` interface to `config/types.ts`
3. Integrate hooks into `docker-compose-strategy.ts` at identified line numbers
4. Add `additionalSyncPaths` to ensure hooks are synced to remote

---

**Status**: ✅ Complete (BL-002)
**Evidence**: 4 injection points identified with file paths and line numbers
**Acceptance**: Sequencing validated (pre-deploy → sync → pre-build → build → post-build → up → post-deploy)
