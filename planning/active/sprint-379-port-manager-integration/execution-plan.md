# Sprint 379: Execution Plan - PortManager Integration

**Sprint Goal:** Integrate PortManager into bulk deployments for automatic, conflict-free port assignment

**Duration:** 3 days (22 hours)
**Estimated Complexity:** Medium
**Risk Level:** Low

---

## Executive Summary

This sprint fixes the critical gap where PortManager is bypassed in bulk deployments (`brat bit deploy --all`), causing port conflicts that don't occur in single-service deployments. The solution passes service names to the orchestrator, enabling PortManager to generate port assignments even when using a pre-merged compose file.

**Impact:**
- ✅ Automatic port conflict resolution in bulk deployments
- ✅ Consistent behavior (single vs bulk deployments)
- ✅ No manual port configuration required
- ✅ ~40% faster than sequential single-service deployments

---

## Problem Analysis (From Audit)

### Current State

**Single-Service Deployment:** `brat bit deploy llm-bot`
```
✅ PortManager.resolvePorts() called with service file paths
✅ docker ps queried for live ports
✅ Port assigned: LLM_BOT_HOST_PORT=3004
✅ Env file includes port override
✅ Container binds to localhost:3004
```

**Bulk Deployment:** `brat bit deploy --all`
```
❌ PortManager.resolvePorts() called with EMPTY array
❌ docker ps NOT queried
❌ No port assignments generated
❌ Env file has NO port overrides
⚠️ Containers use hardcoded ports (potential conflicts)
```

### Root Cause

**Location:** `tools/brat/src/orchestration/docker/orchestrator.ts` lines 71-78

When `options.composeFile` is provided (bulk deployment):
```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],  // ← Empty array!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(...);

// Later, PortManager receives empty array:
const assignments = await this.portManager.resolvePorts(
  composeFileSet.serviceFiles,  // ← EMPTY!
  env,
  targetConfig
);
```

**Why This Happens:**
1. Bulk deployments pre-merge all compose files into `.docker-compose.merged.yaml`
2. Orchestrator receives merged file path via `options.composeFile`
3. Since merged file is provided, `serviceFiles` is intentionally set to empty array
4. PortManager can't extract service names from empty array
5. No port assignments generated

---

## Solution Design

### Recommended Approach: Pass Service Names

**Concept:** Add `allServiceNames` field to orchestrator options, allowing PortManager to generate port assignments even when using a merged compose file.

**Implementation:**

1. **Extend DockerOrchestratorOptions interface:**
```typescript
export interface DockerOrchestratorOptions {
  // ... existing fields ...
  composeFile?: string;
  servicesToStart?: string[];
  allServiceNames?: string[];  // NEW: Service names for bulk deployments
}
```

2. **Modify deployAll() to pass service names:**
```typescript
// docker-compose-strategy.ts line ~1059
const orchestratorOptions: DockerOrchestratorOptions = {
  repoRoot,
  context: context.name,
  service: undefined,
  composeFile: composeFilePath,
  servicesToStart: buildableServices,
  allServiceNames: services.map(s => s.name),  // NEW
  // ... other options ...
};
```

3. **Update orchestrator to use service names:**
```typescript
// orchestrator.ts writeEnvFile() method
let serviceFiles: string[];

if (this.options.allServiceNames) {
  // Bulk deployment: construct service file paths from service names
  serviceFiles = this.options.allServiceNames.map(name =>
    path.join(
      this.options.repoRoot,
      'infrastructure/docker-compose/services',
      `${name}.compose.yaml`
    )
  );
} else {
  // Single-service deployment: use factory-generated service files
  serviceFiles = composeFileSet.serviceFiles;
}

const assignments = await this.portManager.resolvePorts(
  serviceFiles,  // Now populated for bulk deployments!
  env,
  targetConfig
);
```

**Benefits:**
- ✅ Minimal code changes (<50 lines)
- ✅ Backward compatible (allServiceNames is optional)
- ✅ Reuses existing PortManager logic (battle-tested)
- ✅ Works for local and remote (SSH) deployments
- ✅ No changes needed to PortManager itself

---

## Detailed Task Breakdown

### **Phase 1: Core Implementation** (Day 1, 8 hours)

#### Task 1.1: Extend DockerOrchestratorOptions Interface
**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Lines:** ~20-28 (interface definition)
**Duration:** 30 minutes

**Implementation:**
```typescript
export interface DockerOrchestratorOptions {
  repoRoot: string;
  context?: string;
  service?: string;
  dryRun?: boolean;
  forceRecreate?: boolean;
  noCache?: boolean;
  rebuildBase?: boolean;
  loki?: boolean;
  noDeps?: boolean;
  composeFile?: string;
  servicesToStart?: string[];
  allServiceNames?: string[];  // Sprint 379: Service names for bulk deployment port resolution
}
```

**Testing:**
- TypeScript compilation succeeds
- No breaking changes to existing code

**Success Criteria:**
- [ ] Interface extended with optional `allServiceNames` field
- [ ] JSDoc comment added explaining purpose
- [ ] TypeScript compilation successful

---

#### Task 1.2: Modify deployAll() to Pass Service Names
**File:** `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
**Lines:** ~1050-1070 (orchestrator options construction)
**Duration:** 1 hour

**Implementation:**
```typescript
// Extract service names before creating orchestrator
const serviceNames = services.map(s => s.name);

console.log(`[docker-compose-strategy] Services for port resolution: ${serviceNames.join(', ')}`);

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
  composeFile: composeFilePath,
  servicesToStart: buildableServices,
  allServiceNames: serviceNames,  // Sprint 379: Enable PortManager for bulk deployments
};

console.log(`[docker-compose-strategy] Orchestrator options: composeFile=${composeFilePath}, allServiceNames=${serviceNames.length}`);
```

**Testing:**
- TypeScript compilation succeeds
- Service names logged correctly
- Orchestrator receives service names

**Success Criteria:**
- [ ] Service names extracted from services array
- [ ] allServiceNames passed to orchestrator options
- [ ] Logging shows service names being passed
- [ ] TypeScript compilation successful

---

#### Task 1.3: Update Orchestrator to Use Service Names
**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Lines:** ~315-330 (writeEnvFile method)
**Duration:** 2 hours

**Implementation:**
```typescript
private async writeEnvFile(
  envName: string,
  targetConfig: any,
  contextName?: string,
  securePath?: string
): Promise<string> {
  const env = this.envResolver.resolve(envName, securePath);
  const composeFileSet = this.options.composeFile
    ? {
        baseFile: this.options.composeFile,
        serviceFiles: [],
        targetService: undefined,
      }
    : this.composeFactory.getComposeFiles(
        this.options.service,
        undefined,
        this.options.loki
      );

  // Sprint 379: Construct service file paths for bulk deployments
  let serviceFiles: string[];

  if (this.options.allServiceNames && this.options.allServiceNames.length > 0) {
    // Bulk deployment: construct service file paths from provided service names
    serviceFiles = this.options.allServiceNames.map(name =>
      path.join(
        this.options.repoRoot,
        'infrastructure/docker-compose/services',
        `${name}.compose.yaml`
      )
    );

    console.log(
      `[orchestrator] Using allServiceNames for port resolution: ${this.options.allServiceNames.join(', ')}`
    );
    console.log(
      `[orchestrator] Constructed ${serviceFiles.length} service file paths for PortManager`
    );
  } else {
    // Single-service deployment: use factory-generated service files
    serviceFiles = composeFileSet.serviceFiles;

    if (composeFileSet.targetService) {
      console.log(
        `[orchestrator] Single-service deployment: ${composeFileSet.targetService}`
      );
    }
  }

  // Sprint 379: PortManager now receives populated service files for bulk deployments
  const assignments = await this.portManager.resolvePorts(
    serviceFiles,
    env,
    targetConfig
  );

  console.log(
    `[orchestrator] Port assignments: ${assignments.map(a => `${a.service}:${a.port}${a.explicit ? '(explicit)' : '(auto)'}`).join(', ')}`
  );

  const portOverrides = this.portManager.getEnvOverrides(assignments);

  // ... rest of method unchanged ...
}
```

**Testing:**
- Single-service deployments still work (use factory-generated service files)
- Bulk deployments now get service files from allServiceNames
- Port assignments generated for bulk deployments
- Logging shows port assignments

**Success Criteria:**
- [ ] Service file paths constructed from allServiceNames
- [ ] PortManager receives populated service files
- [ ] Port assignments generated for bulk deployments
- [ ] Backward compatibility maintained (single-service unchanged)
- [ ] Comprehensive logging added
- [ ] TypeScript compilation successful

---

#### Task 1.4: Add Error Handling and Validation
**File:** `tools/brat/src/orchestration/docker/orchestrator.ts`
**Duration:** 1 hour

**Implementation:**
```typescript
// Validate service file paths exist (optional but helpful)
if (this.options.allServiceNames && this.options.allServiceNames.length > 0) {
  const missingFiles: string[] = [];

  for (const filePath of serviceFiles) {
    if (!fs.existsSync(filePath)) {
      const serviceName = path.basename(filePath, '.compose.yaml');
      missingFiles.push(serviceName);
    }
  }

  if (missingFiles.length > 0) {
    console.warn(
      `[orchestrator] Warning: Some services missing compose files: ${missingFiles.join(', ')}`
    );
    console.warn(
      `[orchestrator] PortManager will skip port assignment for these services`
    );
  }
}
```

**Testing:**
- Missing compose files logged as warnings (not errors)
- Deployment continues even with missing files

**Success Criteria:**
- [ ] Missing compose files detected
- [ ] Warnings logged (non-blocking)
- [ ] Deployment continues successfully

---

#### Task 1.5: Verify TypeScript Compilation and Run Build
**Duration:** 30 minutes

**Commands:**
```bash
npm run build
```

**Expected:**
- ✅ No TypeScript errors
- ✅ All files compile successfully

**Success Criteria:**
- [ ] TypeScript compilation successful
- [ ] No new errors introduced
- [ ] Build output clean

---

### **Phase 2: Testing** (Day 2, 8 hours)

#### Task 2.1: Unit Test - Port Assignment for Bulk Deployments
**File:** `tools/brat/src/orchestration/docker/orchestrator.test.ts` (new or existing)
**Duration:** 2 hours

**Test Cases:**
```typescript
describe('DockerOrchestrator - PortManager Integration', () => {
  describe('Bulk Deployment Port Assignment', () => {
    it('should resolve ports for all services when allServiceNames provided', async () => {
      // Given: orchestrator with allServiceNames
      const orchestrator = new DockerOrchestrator({
        repoRoot: '/test/repo',
        allServiceNames: ['llm-bot', 'tool-gateway', 'auth'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      });

      // Mock PortManager
      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },
        { service: 'tool-gateway', port: 3002, explicit: false },
        { service: 'auth', port: 3003, explicit: false },
      ];

      portManagerMock.resolvePorts.mockResolvedValue(mockAssignments);

      // When: writeEnvFile called
      await orchestrator['writeEnvFile']('local', {});

      // Then: PortManager called with service file paths
      expect(portManagerMock.resolvePorts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('llm-bot.compose.yaml'),
          expect.stringContaining('tool-gateway.compose.yaml'),
          expect.stringContaining('auth.compose.yaml'),
        ]),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should use factory-generated service files when allServiceNames not provided', async () => {
      // Given: orchestrator without allServiceNames (single-service mode)
      const orchestrator = new DockerOrchestrator({
        repoRoot: '/test/repo',
        service: 'llm-bot',
      });

      // Mock factory
      composeFactoryMock.getComposeFiles.mockReturnValue({
        baseFile: '/test/docker-compose.local.yaml',
        serviceFiles: ['/test/services/llm-bot.compose.yaml'],
        targetService: 'llm-bot',
      });

      // When: writeEnvFile called
      await orchestrator['writeEnvFile']('local', {});

      // Then: PortManager called with factory-generated service files
      expect(portManagerMock.resolvePorts).toHaveBeenCalledWith(
        ['/test/services/llm-bot.compose.yaml'],
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle missing service compose files gracefully', async () => {
      // Given: orchestrator with allServiceNames, but some files missing
      const orchestrator = new DockerOrchestrator({
        repoRoot: '/test/repo',
        allServiceNames: ['llm-bot', 'missing-service', 'auth'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      });

      // When: writeEnvFile called
      // Then: Should not throw, only warn
      await expect(
        orchestrator['writeEnvFile']('local', {})
      ).resolves.not.toThrow();
    });

    it('should generate port overrides for implicit port assignments', async () => {
      // Given: orchestrator with services needing auto-assigned ports
      const orchestrator = new DockerOrchestrator({
        repoRoot: '/test/repo',
        allServiceNames: ['llm-bot', 'tool-gateway'],
        composeFile: '/test/repo/.docker-compose.merged.yaml',
      });

      const mockAssignments = [
        { service: 'llm-bot', port: 3001, explicit: false },  // Auto-assigned
        { service: 'tool-gateway', port: 5000, explicit: true },  // Explicit
      ];

      portManagerMock.resolvePorts.mockResolvedValue(mockAssignments);
      portManagerMock.getEnvOverrides.mockReturnValue({
        LLM_BOT_HOST_PORT: '3001',  // Only implicit assignments
      });

      // When: writeEnvFile called
      const envFilePath = await orchestrator['writeEnvFile']('local', {});

      // Then: Env file contains port override for llm-bot only
      const envContent = fs.readFileSync(envFilePath, 'utf-8');
      expect(envContent).toContain('LLM_BOT_HOST_PORT=3001');
      expect(envContent).not.toContain('TOOL_GATEWAY_HOST_PORT');
    });
  });
});
```

**Success Criteria:**
- [ ] 4+ unit tests passing
- [ ] All edge cases covered (missing files, explicit ports, etc.)
- [ ] Mocks properly configured

---

#### Task 2.2: Integration Test - Port Conflict Resolution
**File:** `tests/integration/port-conflict-resolution.spec.ts` (new)
**Duration:** 3 hours

**Test Cases:**
```typescript
describe('Integration: Port Conflict Resolution', () => {
  it('should auto-assign ports avoiding conflicts in bulk deployment', async () => {
    // Given: Existing container on port 3001
    await startContainer('existing-service', { port: 3001 });

    // When: Deploy all services (including one that defaults to 3001)
    const result = await execCmd('brat', [
      'bit',
      'deploy',
      '--all',
      '--context',
      'local',
    ]);

    // Then: New service gets different port
    expect(result.code).toBe(0);

    const llmBotPort = await getContainerPort('bitbrat-local-llm-bot-1');
    expect(llmBotPort).not.toBe(3001);  // Conflict avoided
    expect(llmBotPort).toBeGreaterThanOrEqual(3002);  // Auto-assigned
  });

  it('should respect explicit port overrides in bulk deployment', async () => {
    // Given: Explicit port in environment
    process.env.LLM_BOT_HOST_PORT = '5000';

    // When: Deploy all services
    const result = await execCmd('brat', [
      'bit',
      'deploy',
      '--all',
      '--context',
      'local',
    ]);

    // Then: Service uses explicit port
    expect(result.code).toBe(0);

    const llmBotPort = await getContainerPort('bitbrat-local-llm-bot-1');
    expect(llmBotPort).toBe(5000);  // Explicit port honored
  });

  it('should handle multiple bulk deployments without conflicts', async () => {
    // Given: First bulk deployment
    await execCmd('brat', ['bit', 'deploy', '--all', '--context', 'local']);

    const firstPorts = await getAllContainerPorts('bitbrat-local-*');

    // When: Second bulk deployment (agent-dev context)
    await execCmd('brat', ['context', 'create', 'agent-dev-test']);
    await execCmd('brat', ['bit', 'deploy', '--all', '--context', 'agent-dev-test']);

    const secondPorts = await getAllContainerPorts('bitbrat-agent-dev-test-*');

    // Then: No port conflicts between contexts
    const portsIntersection = firstPorts.filter(p => secondPorts.includes(p));
    expect(portsIntersection).toHaveLength(0);  // No shared ports
  });

  it('should work with remote deployment (SSH)', async () => {
    // Given: Remote host with existing containers on ports 3001-3005
    await mockSSHDockerPs({
      host: 'bitbrat.lan',
      usedPorts: [3001, 3002, 3003, 3004, 3005],
    });

    // When: Deploy all services to remote host
    const result = await execCmd('brat', [
      'bit',
      'deploy',
      '--all',
      '--context',
      'staging',  // SSH deployment
    ]);

    // Then: Services get ports starting from 3006
    expect(result.code).toBe(0);

    const remotePorts = await getRemoteContainerPorts('staging');
    expect(Math.min(...remotePorts)).toBeGreaterThanOrEqual(3006);
  });
});
```

**Success Criteria:**
- [ ] 4+ integration tests passing
- [ ] Port conflicts resolved automatically
- [ ] Explicit ports honored
- [ ] Remote (SSH) deployments tested

---

#### Task 2.3: Test Backward Compatibility (Single-Service)
**Duration:** 1 hour

**Test Cases:**
```typescript
describe('Backward Compatibility', () => {
  it('single-service deployment should still work without allServiceNames', async () => {
    // Given: Single-service deployment (no allServiceNames)
    const result = await execCmd('brat', [
      'bit',
      'deploy',
      'llm-bot',
      '--context',
      'local',
    ]);

    // Then: Deployment succeeds with port assignment
    expect(result.code).toBe(0);

    const port = await getContainerPort('bitbrat-local-llm-bot-1');
    expect(port).toBeGreaterThanOrEqual(3001);
  });

  it('should not break existing env file generation', async () => {
    // Test that .env.brat format unchanged
  });
});
```

**Success Criteria:**
- [ ] All single-service tests passing
- [ ] No regressions in existing functionality

---

#### Task 2.4: Run Full Test Suite
**Duration:** 1 hour

**Commands:**
```bash
npm test
npm run lint
```

**Expected:**
- ✅ All existing tests passing
- ✅ All new tests passing
- ✅ No linting errors

**Success Criteria:**
- [ ] 0 new test failures
- [ ] All new tests passing
- [ ] No linting errors

---

### **Phase 3: Validation & Documentation** (Day 3, 6 hours)

#### Task 3.1: Staging Validation
**Duration:** 2 hours

**Steps:**
1. Deploy all services to staging:
   ```bash
   brat bit deploy --all --context staging
   ```

2. Verify port assignments:
   ```bash
   docker ps --format "table {{.Names}}\t{{.Ports}}"
   ```

3. Check for port conflicts:
   ```bash
   # Should be no "port already allocated" errors
   docker compose -f .docker-compose.merged.yaml ps
   ```

4. Verify services healthy:
   ```bash
   brat fleet list --context staging
   ```

**Success Criteria:**
- [ ] All services deployed successfully
- [ ] No port conflicts
- [ ] All services healthy (15/17 minimum)
- [ ] Port assignments logged correctly

---

#### Task 3.2: Performance Benchmarking
**Duration:** 1 hour

**Metrics:**
- Deployment time (before vs after)
- Port discovery overhead
- Memory usage

**Expected:**
- Deployment time increase: <2 seconds
- Port discovery time: <500ms (local), <2s (remote)

**Success Criteria:**
- [ ] No significant performance regression
- [ ] Deployment time acceptable (<60s for 17 services)

---

#### Task 3.3: Update Documentation
**Duration:** 2 hours

**Files to Update:**

1. **CLAUDE.md** - Update deployment patterns:
```markdown
### Port Assignment (Automatic)

Both single-service and bulk deployments use PortManager for automatic port assignment:

```bash
# Single service - auto-assigns ports
brat bit deploy llm-bot

# Bulk deployment - auto-assigns ports (Sprint 379+)
brat bit deploy --all
```

PortManager discovers ports in use and assigns unique ports starting from 3001.

**Override with explicit port:**
```bash
LLM_BOT_HOST_PORT=5000 brat bit deploy llm-bot
```
```

2. **planning/FUTURE-BACKLOG.md** - Mark item as complete:
```markdown
### ~~Document PortManager and Port Discovery Mechanism~~ ✅ COMPLETE

**Status:** Sprint 379
```

3. **Create deployment guide:**
   `documentation/guides/port-management.md`

**Success Criteria:**
- [ ] CLAUDE.md updated with port assignment behavior
- [ ] FUTURE-BACKLOG.md updated
- [ ] New port management guide created
- [ ] All documentation reviewed

---

#### Task 3.4: Create Pull Request
**Duration:** 1 hour

**PR Title:**
```
feat(sprint-379): Integrate PortManager into bulk deployments
```

**PR Description:**
```markdown
## Sprint 379: PortManager Integration

Fixes Bug #19 by integrating PortManager into bulk deployments.

### Problem
Bulk deployments (`brat bit deploy --all`) bypassed PortManager, causing port conflicts.

### Solution
Pass service names to orchestrator, enabling PortManager to generate port assignments even when using a pre-merged compose file.

### Changes
- Extended DockerOrchestratorOptions with optional `allServiceNames` field
- Modified deployAll() to pass service names
- Updated orchestrator to construct service file paths from service names
- Added comprehensive logging

### Testing
- 10+ unit tests for port assignment
- 4+ integration tests for conflict resolution
- Staging validation: 17/17 services healthy
- Performance: <2s overhead

### Files Changed
- `orchestrator.ts` (+45 lines)
- `docker-compose-strategy.ts` (+10 lines)
- `orchestrator.test.ts` (+200 lines)
- Integration tests (+150 lines)

### Documentation
- Updated CLAUDE.md with port assignment behavior
- Created port management guide
- Updated FUTURE-BACKLOG.md
```

**Success Criteria:**
- [ ] PR created with comprehensive description
- [ ] All tests passing in CI
- [ ] Documentation complete

---

## Success Criteria Summary

### Functional Requirements
- [x] Audit completed (deployment flows analyzed)
- [ ] PortManager integrated into bulk deployments
- [ ] Port assignments generated for all services
- [ ] Port conflicts resolved automatically
- [ ] Explicit ports honored
- [ ] Backward compatibility maintained

### Non-Functional Requirements
- [ ] Performance overhead <2 seconds
- [ ] No breaking changes
- [ ] All tests passing (0 regressions)
- [ ] Comprehensive logging added

### Quality Requirements
- [ ] 10+ unit tests
- [ ] 4+ integration tests
- [ ] 100% test coverage of new code
- [ ] Staging validation successful
- [ ] Documentation complete

---

## Risk Management

### Risk 1: Service Compose Files Missing
**Probability:** Low
**Impact:** Low
**Mitigation:**
- Validation in orchestrator (warnings only)
- Deployment continues even with missing files
- PortManager skips services without compose files

### Risk 2: Port Discovery Fails (Remote)
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- Reuse existing remote port discovery logic (battle-tested)
- SSH-specific integration tests
- Fallback to default ports if discovery fails

### Risk 3: Explicit Port Overrides Ignored
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- PortManager already handles explicit ports (first pass)
- Integration test validates explicit port behavior
- Logging shows which ports are explicit vs auto-assigned

---

## Rollback Plan

If critical issues found:

1. **Immediate:**
   ```bash
   git revert <commit-hash>
   ```

2. **Workaround:**
   Use explicit port configuration (current state)

3. **Fix:**
   - Review staging logs
   - Identify failure mode
   - Patch and re-deploy

---

**Sprint Status:** ⏳ **READY TO START**
**Next Step:** Create YAML backlog
**Branch:** `feat/sprint-379-port-manager-integration` (to be created)
