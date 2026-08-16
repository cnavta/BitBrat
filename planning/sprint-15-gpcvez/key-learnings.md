# Sprint 15 Key Learnings

**Sprint ID**: sprint-15-gpcvez
**Sprint Goal**: Implement deployment lifecycle hooks system
**Date**: 2026-08-16

## Technical Learnings

### 1. Docker Compose Deployment Flow Architecture

**Context**: Understanding BitBrat's deployment flow was critical for identifying hook injection points.

**Learning**: The deployment flow is a 7-stage pipeline with clear separation of concerns:

```
User → brat deploy → DockerComposeStrategy → DockerOrchestrator
                            ↓
                    1. Context Resolution (architecture.yaml)
                    2. File Reading (docker-compose.yml, .env)
                    3. File Sync (rsync to remote)
                    4. Orchestrator Creation
                    5. Build (docker compose build)
                    6. Up (docker compose up -d)
                    7. Duration Tracking
```

**Key Insight**: Hooks belong in **strategy layer** (not orchestrator layer) because:
- Strategy owns deployment lifecycle (knows about stages)
- Strategy has access to execution context (knows about hooks config)
- Orchestrator is generic (should not know about deployment-specific concerns)

**Application**: When adding cross-cutting concerns to BitBrat, prefer strategy layer over orchestrator layer unless the concern is truly deployment-agnostic.

**Files**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` (strategy), `tools/brat/src/orchestration/docker/orchestrator.ts` (orchestrator)

---

### 2. Jest Mocking Patterns for Filesystem Operations

**Context**: HookExecutor unit tests required mocking `fs.existsSync()` and `fs.statSync()`.

**Learning**: Module-level `jest.mock()` vs `jest.spyOn()`:

```typescript
// ❌ WRONG: Causes "Cannot redefine property" error
beforeEach(() => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
});

// ✅ CORRECT: Mock entire module at top level
jest.mock('fs');
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

beforeEach(() => {
  mockExistsSync.mockReturnValue(true);
});
```

**Key Insight**: `jest.spyOn()` creates new property descriptors, which fails for already-mocked modules. Module-level `jest.mock()` hoists the mock before imports, allowing type-safe mocking.

**Application**: For built-in Node.js modules (`fs`, `path`, `crypto`), use module-level `jest.mock()`. For custom modules, `jest.spyOn()` is acceptable.

**Files**: `tools/brat/src/orchestration/hooks/hook-executor.test.ts:11-14`

---

### 3. Zod Refinement Validation for Security

**Context**: Hook paths and additionalSyncPaths needed security validation (reject absolute paths, prevent path traversal).

**Learning**: Zod's `.refine()` enables complex validation with custom error messages:

```typescript
z.array(z.string()).optional().refine(
  (paths) => {
    if (!paths) return true;

    for (const syncPath of paths) {
      if (path.isAbsolute(syncPath)) {
        throw new Error(
          `additionalSyncPaths must be relative (not absolute): ${syncPath}\n` +
          `Expected: .brat/hooks or custom-scripts\n` +
          `Received: ${syncPath}`
        );
      }

      if (syncPath.startsWith('../') || syncPath.includes('/../')) {
        throw new Error(
          `additionalSyncPaths must not escape repository: ${syncPath}\n` +
          `Paths outside repo root are rejected for security.`
        );
      }
    }

    return true;
  },
  { message: 'Additional sync paths must be relative and within repository' }
)
```

**Key Insight**: Refinement validation runs AFTER type validation, allowing custom logic with helpful error messages. The generic `message` is fallback; throwing explicit `Error` provides context-specific guidance.

**Application**: For security-critical validation (paths, URLs, credentials), use `.refine()` with explicit error messages that explain WHY the validation failed and HOW to fix it.

**Files**: `tools/brat/src/config/execution-context-schema.ts:95-115`

---

### 4. Local vs Remote Hook Execution Strategy

**Context**: Hooks must execute both locally (laptop) and remotely (bitbrat.lan) depending on deployment target.

**Learning**: Environment variable propagation differs for local vs remote:

```typescript
// LOCAL: Use execCmd with env object
const env: NodeJS.ProcessEnv = {
  ...process.env,
  BRAT_CONTEXT_NAME: context.contextName,
};
await execCmd(fullPath, [], { env, stdio: 'inherit' });

// REMOTE: Use SSH with env vars in command string
const envVars = [
  `BRAT_CONTEXT_NAME=${context.contextName}`,
  `BRAT_SERVICES="${context.services.join(' ')}"`,
].join(' ');
const sshCommand = `cd "${context.remoteDir}" && ${envVars} bash "${remoteHookPath}"`;
await execCmd('ssh', [sshHost, sshCommand], { stdio: 'inherit' });
```

**Key Insight**: SSH does not propagate environment variables by default. Must explicitly set them in the remote command string using `ENV_VAR=value` prefix syntax.

**Application**: When designing remote execution features, assume environment variables are NOT propagated. Explicitly serialize them into command arguments.

**Files**: `tools/brat/src/orchestration/hooks/hook-executor.ts:148-181, 226-255`

---

### 5. Post-Deployment Hook Error Handling

**Context**: Post-deploy hooks run AFTER containers start. Failures should not abort successful deployment.

**Learning**: Different hook stages require different error handling:

```typescript
// PRE-DEPLOY, PRE-BUILD, POST-BUILD: Fatal errors (abort deployment)
await this.hookExecutor.execute('pre-deploy', hooks?.['pre-deploy'], context);

// POST-DEPLOY: Non-fatal errors (log and continue)
try {
  await this.hookExecutor.execute('post-deploy', hooks?.['post-deploy'], context);
} catch (hookError: any) {
  console.error(
    `[docker-compose-strategy] Post-deploy hook failed: ${hookError.message}\n` +
    `Deployment succeeded but post-deploy validation failed.`
  );
  // Don't re-throw - containers already running
}
```

**Key Insight**: Post-deploy hooks are verification/notification, not validation. Containers are already running; aborting deployment would require rollback (disruptive). Prefer graceful degradation.

**Application**: For hooks that run after point-of-no-return, use try/catch and log failures instead of throwing. Add monitoring alerts for these failures (future sprint).

**Files**: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:435-449`

---

### 6. Validation Script Design Patterns

**Context**: Automated validation script needed to verify all 8 acceptance criteria.

**Learning**: Effective validation scripts follow this structure:

```bash
# 1. Color-coded output for visual scanning
GREEN='\033[0;32m'
RED='\033[0;31m'
pass() { echo -e "${GREEN}✓${NC} $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}✗${NC} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# 2. Phased validation with section headers
section "Phase 1: Core Hook System Files"

# 3. File existence checks before content validation
if [ -f "tools/brat/src/orchestration/hooks/hook-executor.ts" ]; then
  pass "HookExecutor class exists"
  # Content validation only if file exists
  if grep -q "async execute" "tools/brat/src/orchestration/hooks/hook-executor.ts"; then
    pass "HookExecutor.execute() method exists"
  fi
fi

# 4. Count-based validation for test coverage
test_count=$(grep -c "it('should" "hook-executor.test.ts" || echo "0")
if [ "$test_count" -ge 20 ]; then
  pass "HookExecutor has $test_count tests"
fi

# 5. Summary report with exit code
echo "Total Checks:"
echo "  ✓ Passed: $PASS_COUNT"
echo "  ✗ Failed: $FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
```

**Key Insight**: Validation scripts are executable documentation. Use visual feedback (colors, sections), defensive checks (file existence first), and summary reports (pass/fail counts).

**Application**: For complex features with multiple acceptance criteria, create validation scripts DURING implementation (not after). Run after each phase for rapid feedback.

**Files**: `planning/sprint-15-gpcvez/validate_deliverable.sh`

---

## Architecture Learnings

### 7. File Sync Whitelist Pattern

**Context**: Remote deployments use rsync to sync files from laptop to remote host. Only whitelisted files are synced.

**Learning**: The file sync whitelist is hardcoded in `orchestrator.ts`:

```typescript
const filesToSync = [
  'docker-compose.yml',
  '.env',
  '.env.local',
  // ... hardcoded list
];
```

**Problem**: Adding hook scripts requires modifying hardcoded whitelist OR extending via execution context.

**Solution**: Added `additionalSyncPaths` to execution context config:

```yaml
staging:
  deployment:
    docker:
      additionalSyncPaths:
        - .brat/hooks  # Sync entire hooks directory
```

**Key Insight**: Hardcoded whitelists are anti-pattern for extensible systems. Provide extension mechanism (additionalSyncPaths) while maintaining secure defaults.

**Application**: When designing sync/allowlist features, support BOTH:
1. Secure defaults (hardcoded common paths)
2. User extensions (config-driven additional paths)

**Files**: `tools/brat/src/orchestration/docker/orchestrator.ts:599-638`

---

### 8. Configuration Schema Hierarchy

**Context**: Hook configuration needed to live in execution context, not service definition.

**Learning**: BitBrat has 3-level configuration hierarchy:

```
architecture.yaml
├── executionContexts    # Environment-specific (local, staging, prod)
│   └── deployment       # Where hooks live
│       └── hooks        # Pre-deploy, pre-build, post-build, post-deploy
└── services             # Service-specific (llm-bot, ingress-egress)
    └── env              # Environment variables
    └── secureFiles      # Secret files
```

**Key Insight**: Hooks are **deployment concerns** (not service concerns). A service doesn't know HOW it's deployed (Docker vs K8s vs Cloud Run), so hooks belong in execution context.

**Application**: When adding new config fields, ask: "Is this deployment-specific or service-specific?" Deployment-specific → `executionContexts`, Service-specific → `services`.

**Files**: `architecture.yaml:1065-1070` (staging execution context)

---

### 9. TypeScript Interface vs Zod Schema Duplication

**Context**: Hooks configuration needed both TypeScript types AND Zod validation.

**Learning**: BitBrat maintains parallel type systems:

```typescript
// TypeScript interface (compile-time)
export interface DeploymentHooks {
  'pre-deploy'?: string;
  'pre-build'?: string;
  'post-build'?: string;
  'post-deploy'?: string;
}

// Zod schema (runtime)
export const DeploymentHooksSchema = z.object({
  'pre-deploy': z.string().optional(),
  'pre-build': z.string().optional(),
  'post-build': z.string().optional(),
  'post-deploy': z.string().optional(),
}).optional();
```

**Problem**: Duplication requires maintaining 2 definitions. Changes must be synchronized.

**Solution**: Use `z.infer<typeof DeploymentHooksSchema>` to derive TypeScript type from Zod schema (eliminates duplication).

**Status**: NOT IMPLEMENTED in Sprint 15 (to maintain consistency with existing codebase patterns).

**Key Insight**: Zod can be single source of truth for both runtime validation AND compile-time types. Use `z.infer<>` to derive TypeScript types.

**Application**: For new config fields, define Zod schema first, then derive TypeScript type using `z.infer<typeof Schema>`.

**Files**: `tools/brat/src/config/types.ts:88-92`, `tools/brat/src/config/execution-context-schema.ts:76-94`

---

## Process Learnings

### 10. Git Worktree Workflow for Sprints

**Context**: Sprint 15 used git worktree (`feat/sprint-15-gpcvez`) to isolate work from main branch.

**Learning**: Worktrees enable:
- Parallel work (multiple branches checked out simultaneously)
- Clean separation (no stashing/unstashing)
- Isolated testing (each worktree has own `node_modules`)

**Workflow**:
```bash
# Create worktree
git worktree add .worktrees/sprint-15-gpcvez -b feat/sprint-15-gpcvez

# Work in isolation
cd .worktrees/sprint-15-gpcvez
npm install
npm test

# When done, create PR from worktree branch
gh pr create --base main --head feat/sprint-15-gpcvez
```

**Key Insight**: Worktrees are ideal for sprint workflow because they allow testing sprint branch WITHOUT affecting main branch working directory.

**Application**: For sprint work that requires extended time (multi-hour sessions), use worktrees. For quick fixes (<30min), branch in main working directory is sufficient.

**Caveat**: Remember to `npm install` in worktree (doesn't share `node_modules` with main).

---

### 11. Acceptance Criteria as Executable Validation

**Context**: Sprint planning defined 8 acceptance criteria in `backlog.yaml`.

**Learning**: Acceptance criteria should be testable in automated fashion:

```yaml
# backlog.yaml
- id: AC-01
  description: HookExecutor class with execute() and executeRemote()
  validation:
    - File exists: tools/brat/src/orchestration/hooks/hook-executor.ts
    - Class exports: HookExecutor
    - Method exists: execute()
    - Method exists: executeRemote()
```

This YAML structure maps directly to validation script:

```bash
# validate_deliverable.sh
if [ -f "tools/brat/src/orchestration/hooks/hook-executor.ts" ]; then
  pass "HookExecutor class exists"
  if grep -q "async execute" "...hook-executor.ts"; then
    pass "HookExecutor.execute() method exists"
  fi
fi
```

**Key Insight**: Acceptance criteria should be written in **testable language** (not vague requirements). Each criterion should map to 1+ validation checks.

**Application**: When writing acceptance criteria, ask: "How would I verify this automatically?" Structure criteria to enable script generation.

---

### 12. Documentation-Driven Example Design

**Context**: Example hooks needed to demonstrate 4 use cases (Docker Hub, AWS ECR, GCP Artifact Registry, health checks).

**Learning**: Effective examples follow this pattern:

```bash
#!/bin/bash
#
# Example: Docker Hub Authentication
# Hook Type: pre-deploy
# Purpose: Authenticate to Docker Hub using access tokens
#
# Environment Variables Required:
# - DOCKERHUB_USERNAME: Docker Hub username
# - DOCKERHUB_ACCESS_TOKEN: Docker Hub access token (NOT password)
#
# Usage:
# 1. Create access token: https://hub.docker.com/settings/security
# 2. Store in .secure.{context}/.env:
#    DOCKERHUB_USERNAME=myusername
#    DOCKERHUB_ACCESS_TOKEN=dckr_pat_xxx
# 3. Configure in architecture.yaml:
#    hooks:
#      pre-deploy: .brat/hooks/examples/pre-deploy-docker-hub-auth.sh
```

**Key Insight**: Example code should be **self-documenting**. Header comments explain What/Why/How without requiring external documentation.

**Application**: For example code, include:
1. Purpose (what problem it solves)
2. Hook type (when it runs)
3. Required environment variables
4. Setup instructions (step-by-step)
5. Configuration example (copy/paste ready)

**Files**: `.brat/hooks/examples/*.sh` (all 5 example hooks)

---

## Future Work Identified

### High Priority
1. **Hook Timeout Enforcement**: Add configurable timeout (default: 300s) to prevent infinite hangs
2. **Remote Execution Integration Tests**: Add docker-in-docker test fixture for SSH hook execution
3. **IDE TypeScript Configuration**: Add `.vscode/settings.json` for correct TypeScript SDK

### Medium Priority
4. **Hook Failure Recovery**: Add `hooks.on-failure` config (abort | warn | ignore)
5. **Additional Registry Examples**: Harbor, Azure Container Registry, GitHub Container Registry
6. **Unit Testing Patterns Guide**: Document filesystem mocking, process mocking, date mocking

### Low Priority
7. **Sprint Planning Templates**: Create reusable templates for execution plans, backlogs, validation scripts
8. **Hook Discovery Command**: Add `brat hook list` to discover available example hooks
9. **Hook Array Support**: Enable multiple hooks per stage (e.g., `pre-deploy: [auth.sh, validate.sh]`)

### Deferred
10. **TypeScript/JavaScript Hook Support**: Currently only shell scripts (.sh, .bash) are documented
11. **Hook Retry Logic**: Automatic retry on transient failures (network timeout, API rate limit)
12. **Hook Metrics**: Prometheus metrics for hook execution time, failure rate, timeout rate

---

## Reusable Patterns

### Pattern: Hook Execution Framework
**Problem**: Need to execute shell scripts at deployment lifecycle stages
**Solution**: HookExecutor class with local/remote execution methods
**Reusability**: Generic pattern for any lifecycle hooks (not just deployment)
**Files**: `tools/brat/src/orchestration/hooks/hook-executor.ts`

### Pattern: Configuration Extension Points
**Problem**: Need to extend hardcoded whitelist without modifying code
**Solution**: Add `additionalSyncPaths` array to execution context
**Reusability**: Pattern for extending any hardcoded list via configuration
**Files**: `tools/brat/src/config/types.ts:81-87`

### Pattern: Validation Script Structure
**Problem**: Need automated verification of acceptance criteria
**Solution**: Multi-phase validation with color-coded output and summary report
**Reusability**: Template for future sprint validation scripts
**Files**: `planning/sprint-15-gpcvez/validate_deliverable.sh`

### Pattern: Example-Driven Documentation
**Problem**: Users need to understand how to use new feature
**Solution**: Provide 4+ working examples with self-documenting headers
**Reusability**: Pattern for documenting any extensible feature
**Files**: `.brat/hooks/examples/*.sh`, `.brat/hooks/examples/README.md`

---

## Conclusion

Sprint 15 delivered **13 key learnings** across 3 categories:
- **6 Technical Learnings**: Jest mocking, Zod refinement, SSH env vars, error handling, validation scripts, deployment flow
- **4 Architecture Learnings**: File sync whitelist, config hierarchy, type/schema duplication, worktree workflow
- **3 Process Learnings**: Acceptance criteria automation, documentation-driven examples, git worktree benefits

These learnings inform:
1. **Future sprint planning** (timeout enforcement, remote testing)
2. **Documentation improvements** (unit testing guide, IDE setup)
3. **Architectural patterns** (extension points, validation automation)

**Most Impactful Learning**: Acceptance criteria should be executable validation scripts, not prose checklists. This pattern will be applied to all future sprints.

---

**Author**: Claude (Lead Implementor)
**Date**: 2026-08-16
**Sprint**: sprint-15-gpcvez
