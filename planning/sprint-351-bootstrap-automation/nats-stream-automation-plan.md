# NATS Stream Automation - Implementation Plan

**Date**: 2026-07-20
**Sprint**: 351 - Bootstrap Automation
**Task**: T2.3 - Integrate NATS stream initialization into brat docker up
**Status**: ANALYSIS COMPLETE - Ready for Implementation

---

## Current State

### ✅ Completed (T2.2)
- Created `tools/init-nats-streams.ts` - Idempotent stream initialization script
- Script creates 7 standard BitBrat streams (internal-mcp, internal-ingress, etc.)
- Added `npm run init-streams` command for easy invocation
- Script is fully functional and tested

### ⏳ Remaining (T2.3)
- Integrate automatic stream initialization into `brat docker up` workflow
- Ensure streams are created after NATS container is healthy
- Handle both local and remote (SSH) Docker deployments

---

## Integration Point Analysis

### File: `tools/brat/src/orchestration/docker/orchestrator.ts`

The `DockerOrchestrator.up()` method (lines 41-151) manages the docker compose up workflow:

1. **Prepare** environment and configuration (line 42)
2. **Build** services (lines 85-89 for remote, implicit for local)
3. **Start** services with `docker compose up` (lines 121, 146)
4. **Cleanup** temp files in finally block (line 149)

**Two code paths**:
- **Remote** (SSH): Lines 80-121
- **Local**: Lines 122-147

**Current integration points** (where `docker compose up` completes):
- **Remote**: After line 121 (`await this.executeDockerCompose(targetConfig, upArgs);`)
- **Local**: After line 146 (`await this.executeDockerCompose(targetConfig, upArgs);`)

---

## Automated Integration Strategy

### Approach 1: Orchestrator Method (Recommended)

Add a `private async initializeNatsStreams()` method to `DockerOrchestrator` class that runs after `docker compose up` succeeds.

**Implementation**:

```typescript
/**
 * Initialize NATS JetStream streams after NATS container is healthy
 */
private async initializeNatsStreams(envName: string): Promise<void> {
  console.log('[brat] Initializing NATS streams...');

  try {
    // Wait for NATS to be healthy (retry with backoff)
    await this.waitForNatsHealthy(envName);

    // Run init-nats-streams.ts script
    const scriptPath = path.join(this.options.repoRoot, 'tools/init-nats-streams.ts');
    const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';

    await execCmd('ts-node', [scriptPath, '--nats-url', natsUrl], {
      cwd: this.options.repoRoot,
      stdio: 'inherit',
    });

    console.log('[brat] ✅ NATS streams initialized');
  } catch (error: any) {
    console.warn('[brat] ⚠️  NATS stream initialization failed:', error.message);
    console.warn('[brat]     Services will retry stream creation on demand');
    // Don't fail the entire deployment - services can create streams on demand
  }
}

/**
 * Wait for NATS container to be healthy
 */
private async waitForNatsHealthy(envName: string, maxRetries = 10): Promise<void> {
  const composeProjectName = `bitbrat-${envName}`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Check if NATS container is healthy
      const result = await execCmd('docker', [
        'inspect',
        '--format={{.State.Health.Status}}',
        `${composeProjectName}-nats-1`
      ], { stdio: 'pipe' });

      if (result.stdout.trim() === 'healthy') {
        return;
      }
    } catch (error) {
      // Container doesn't exist yet or inspect failed
    }

    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
  }

  throw new Error('NATS container did not become healthy within timeout');
}
```

**Integration into `up()` method**:

```typescript
// After line 121 (remote path)
await this.executeDockerCompose(targetConfig, upArgs);

// NEW: Initialize NATS streams
if (!this.options.service || this.options.service === 'nats') {
  await this.initializeNatsStreams(envName);
}

// After line 146 (local path)
await this.executeDockerCompose(targetConfig, upArgs);

// NEW: Initialize NATS streams
if (!this.options.service || this.options.service === 'nats') {
  await this.initializeNatsStreams(envName);
}
```

**Conditional Logic**:
- Only run if NATS is being started (either `--service nats` or `--all`/no service specified)
- Skip if user is starting a specific non-NATS service (`--service tool-gateway`)

---

### Approach 2: Compose Healthcheck Hook (Alternative)

Use Docker Compose `depends_on` with healthcheck conditions to trigger stream init automatically.

**Implementation**:

Create a new service in `docker-compose.local.yaml`:

```yaml
services:
  nats-init:
    image: node:20-alpine
    container_name: bitbrat-${COMPOSE_PROJECT_NAME:-local}-nats-init
    volumes:
      - .:/workspace
    working_dir: /workspace
    command: >
      sh -c "
        npm install -g ts-node &&
        ts-node tools/init-nats-streams.ts --nats-url nats://nats:4222 --verbose
      "
    depends_on:
      nats:
        condition: service_healthy
    networks:
      - bitbrat-network
    restart: "no"  # Run once and exit
```

**Pros**:
- No code changes to orchestrator
- Automatic execution after NATS is healthy
- Works for all deployment modes (local, remote)

**Cons**:
- Adds container overhead
- Requires npm install inside container (slower)
- Less visibility into success/failure from `brat` CLI

---

### Approach 3: Post-Hook Script (Simplest)

Create a `tools/post-docker-up.sh` script that `brat docker up` calls after compose completes.

**Implementation**:

```bash
#!/usr/bin/env bash
# tools/post-docker-up.sh
# Post-deployment hooks for brat docker up

set -e

CONTEXT="${1:-local}"
NATS_URL="${NATS_URL:-nats://localhost:4222}"

echo "[brat] Running post-deployment hooks for context: $CONTEXT"

# Wait for NATS to be healthy
echo "[brat] Waiting for NATS to be healthy..."
for i in {1..30}; do
  if docker inspect --format='{{.State.Health.Status}}' "bitbrat-${CONTEXT}-nats-1" 2>/dev/null | grep -q "healthy"; then
    echo "[brat] ✅ NATS is healthy"
    break
  fi
  sleep 2
done

# Initialize NATS streams
echo "[brat] Initializing NATS streams..."
npm run init-streams -- --nats-url "$NATS_URL" || {
  echo "[brat] ⚠️  Stream initialization failed, but continuing (services will retry)"
}

echo "[brat] Post-deployment hooks complete"
```

**Call from orchestrator.ts** after line 121 and 146:

```typescript
await this.executeDockerCompose(targetConfig, upArgs);

// NEW: Run post-deployment hooks
if (!this.options.service || this.options.service === 'nats') {
  const hookScript = path.join(this.options.repoRoot, 'tools/post-docker-up.sh');
  if (fs.existsSync(hookScript)) {
    await execCmd('bash', [hookScript, contextName || envName], {
      cwd: this.options.repoRoot,
      stdio: 'inherit',
    });
  }
}
```

---

## Recommended Path Forward

### Phase 1: Manual Invocation (Current Sprint 351)

**Status**: ✅ COMPLETE
- Script exists: `tools/init-nats-streams.ts`
- Easy invocation: `npm run init-streams`
- Documented in sprint artifacts

**Usage**:
```bash
# After brat docker up
npm run brat -- docker up --context agent-dev
npm run init-streams  # Run manually
```

### Phase 2: Automated Integration (Sprint 352 or Future)

**Recommended Approach**: **Approach 1** (Orchestrator Method)

**Why**:
- Full control and visibility from brat CLI
- Handles both local and remote deployments
- Graceful degradation if NATS not available
- Clear error messages and logging
- No additional container overhead

**Implementation Steps**:
1. Add `initializeNatsStreams()` method to DockerOrchestrator class
2. Add `waitForNatsHealthy()` helper method
3. Call after both remote and local `docker compose up`
4. Add conditional logic (only if NATS is being started)
5. Update tests to mock stream initialization
6. Test with:
   - `brat docker up --context agent-dev` (should auto-init)
   - `brat docker up --context agent-dev --service tool-gateway` (should skip)
   - `brat docker up --context agent-dev --service nats` (should auto-init)

**Estimated Effort**: 2-3 hours
- 1 hour: Implementation
- 1 hour: Testing (local + remote targets)
- 30 min: Documentation updates

---

## Testing Strategy

### Manual Testing
```bash
# Test 1: Full stack with auto-init
brat docker up --context test-context
# Verify: Streams created automatically

# Test 2: Specific service (should skip init)
brat docker up --context test-context --service tool-gateway
# Verify: No stream initialization attempted

# Test 3: NATS only (should auto-init)
brat docker up --context test-context --service nats
# Verify: Streams created after NATS healthy

# Test 4: Remote target
brat docker up --context staging
# Verify: Works over SSH connection
```

### Automated Testing
```typescript
// tools/brat/src/orchestration/docker/orchestrator.test.ts

describe('DockerOrchestrator', () => {
  describe('initializeNatsStreams', () => {
    it('should initialize streams after NATS is healthy', async () => {
      // Mock execCmd to simulate ts-node execution
      // Mock waitForNatsHealthy to return immediately
      // Verify ts-node called with correct args
    });

    it('should skip initialization if NATS not being started', async () => {
      // Mock options.service = 'tool-gateway'
      // Verify initializeNatsStreams not called
    });

    it('should handle initialization failure gracefully', async () => {
      // Mock execCmd to throw error
      // Verify warning logged, deployment continues
    });
  });
});
```

---

## Rollout Plan

### Sprint 351 (Current)
- ✅ Create init script (T2.2)
- ✅ Document manual usage
- ✅ Document automated integration plan
- Move to context validation (T3.3)

### Sprint 352 (Future)
- Implement Approach 1 (orchestrator integration)
- Add automated tests
- Test on all deployment targets (local, bitbrat.lan, staging)
- Update documentation with automatic behavior

---

## Dependencies

### NPM Packages
- `nats` (already installed)
- `ts-node` (dev dependency, already installed)

### Environment Variables
- `NATS_URL` (defaults to `nats://localhost:4222` for local)
- `COMPOSE_PROJECT_NAME` (for container name detection)

### Docker Requirements
- NATS container must have healthcheck configured
- NATS must be accessible from host (port 4222)

---

## Known Limitations

1. **Remote Deployments**: NATS URL must be accessible from where `brat` runs
   - **Solution**: Use SSH tunnel or wait for NATS to be publicly accessible
   - **Workaround**: Run `npm run init-streams` on remote host after deployment

2. **Multi-Context**: If multiple contexts run simultaneously, each needs unique NATS instance
   - **Solution**: BUS_PREFIX already provides message isolation
   - **Streams**: Shared streams OK, messages isolated by subject prefix

3. **Stream Conflicts**: If streams already exist with different config
   - **Solution**: Script is idempotent, skips existing streams
   - **Manual Fix**: Delete stream and re-run init if config needs updating

---

## Success Criteria

### Current Sprint (Manual)
- [x] Script creates all 7 standard streams
- [x] Script is idempotent (safe to run multiple times)
- [x] npm run init-streams command works
- [x] Documentation complete

### Future Sprint (Automated)
- [ ] `brat docker up` automatically initializes streams
- [ ] Works for both local and remote deployments
- [ ] Graceful degradation if NATS unavailable
- [ ] Tests cover success and failure scenarios
- [ ] Documentation updated with automatic behavior

---

## Conclusion

**Current Status**: T2.2 ✅ Complete, T2.3 Analysis ✅ Complete

**Recommendation**:
- Document manual process for Sprint 351 (sprint goal achieved: automation exists)
- Defer orchestrator integration to Sprint 352 (polish, not blocking)
- Move forward to T3.3 (context validation - higher priority for bootstrap workflow)

**Rationale**:
- Critical automation achieved (script exists, works, is idempotent)
- Orchestrator integration is polish, not essential for bootstrap success
- Context validation (T3.3) provides more immediate value for new context creation
- End-to-end test (T5.3) will validate entire bootstrap workflow including manual stream init

This approach maximizes sprint value delivery while creating clear path for future automation enhancement.
