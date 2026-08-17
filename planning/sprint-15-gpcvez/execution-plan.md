# Implementation Plan – Deployment Lifecycle Hooks System

- **Sprint:** sprint-15-gpcvez
- **Title:** Private Container Registry Authentication via Deployment Hooks
- **Owner / Role:** Lead Implementor
- **Date:** 2026-08-16
- **Branch:** `feature/sprint-15-gpcvez-obs-mcp-deployment-investigati`
- **Source of truth:** `architecture.yaml` + `AGENTS.md` + `private-registry-auth-technical-architecture.md`
- **Source design / issue / prompt:** User request to investigate obs-mcp deployment failure on staging + architect request for deployment hook system
- **Status:** PLANNING — awaiting owner approval; no implementation begins until approved.

---

## 1. Objective

Implement a deployment lifecycle hook system that enables BitBrat Execution Context (BEC) specific and project-specific authentication to private container registries, allowing `obs-mcp` and other services using external images to deploy successfully to all environments (local, remote, cloud) without hard-coding registry-specific logic in the platform.

**End State**:
- Hook system supports pre-deploy, post-deploy, pre-build, and post-build lifecycle events
- Example hooks provided for GCR, ECR, ACR, Docker Hub authentication
- obs-mcp service successfully deploys to staging environment
- Documentation complete for hook authoring and security best practices
- Backward compatible (hooks are optional)

---

## 2. Problem Statement / Why

### Current Behavior

The `obs-mcp` service is configured with an external image from Google Artifact Registry:
```yaml
services:
  obs-mcp:
    active: true
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
```

**Deployment Outcomes**:
- ✅ **Local** (Docker Desktop): Works if user manually ran `gcloud auth configure-docker`
- ❌ **Remote** (SSH to staging): Fails with "pull access denied" - remote Docker daemon lacks credentials
- ✅ **Cloud Run**: Works automatically via Service Account IAM

**Root Cause**: The deployment system has no mechanism to inject authentication before pulling images from private registries.

### Impact / Risk

- **Immediate**: obs-mcp cannot be deployed to staging, blocking OBS control functionality
- **Medium-term**: Any future service using private images faces the same issue
- **Long-term**: Platform lacks extensibility for deployment customization (authentication, validation, monitoring)

### Why Now

1. obs-mcp is marked `active: true` but fails to deploy to staging
2. Architecture document proposes hook system as best solution
3. Hook system provides general deployment extensibility beyond authentication

---

## 3. Grounding / Verified Baseline Facts

- **Fact 1**: `obs-mcp` service is defined in `architecture.yaml:771-787` with `image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest`
- **Fact 2**: Deployment flow for remote Docker is in `tools/brat/src/orchestration/docker/orchestrator.ts`:
  - Lines 567-689: `syncRemoteFiles()` - Syncs source code, NOT credentials
  - Lines 175-225: Build and up logic - No authentication step
- **Fact 3**: Execution contexts defined in `architecture.yaml:1019-1094` support `local` and `staging` contexts
- **Fact 4**: Staging context uses `ssh://root@bitbrat.lan` with `remoteDir: /opt/bitbrat-staging` (architecture.yaml:1063-1064)
- **Fact 5**: Docker Compose strategy is in `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- **Fact 6**: Services with `image:` field use external images (no build), detected at docker-compose-strategy.ts:949-955
- **Fact 7**: Architecture document at `planning/sprint-15-gpcvez/private-registry-auth-technical-architecture.md` proposes deployment hooks as recommended solution
- **Fact 8**: Remote file sync whitelist is hardcoded in `orchestrator.ts:599-626` as `filesToSync` array
- **Fact 9**: Hook scripts (`.brat/hooks/**/*.sh`) are NOT in current sync whitelist and won't be copied to remote
- **Fact 10**: Users need BEC-specific control over what files sync to remote (e.g., custom scripts, configs, credentials)

### Conflicts or inconsistencies discovered

| Item | Source A | Source B | Resolution / Plan of Record |
|---|---|---|---|
| Hook execution location (local vs remote) | Pre-deploy could run locally or remotely | Remote deployments need auth on remote daemon | **Plan of Record**: Pre-deploy runs locally (before sync), pre-build/post-build/post-deploy run remotely (after sync). This allows auth on both local and remote daemons as needed. |
| TypeScript vs shell hooks | Architecture proposes both .ts and .sh hooks | Shell scripts are simpler and more portable | **Plan of Record**: Phase 1 implements shell hooks only. TypeScript hooks deferred to Phase 4 (future enhancement). |

---

## 4. Scope

### In scope

- Hook system core infrastructure (HookExecutor class)
- Four hook types: pre-deploy, post-deploy, pre-build, post-build
- Schema changes to execution context configuration
- **BEC-specific file sync paths** (additionalSyncPaths in execution context)
- Integration into DockerComposeStrategy
- Integration of additionalSyncPaths into syncRemoteFiles()
- Example hooks for GCP Artifact Registry authentication
- obs-mcp deployment fix for staging context
- Hook security validation (file existence, execute permissions)
- Hook execution logging and error reporting
- Documentation (hook development guide, security best practices, sync paths)
- Unit tests for HookExecutor
- Integration tests for hook execution in deployment flow
- Tests for additionalSyncPaths

### Out of scope

- TypeScript/JavaScript hook support (deferred to Phase 4)
- Cloud Run deployment hook integration (deferred to Phase 4)
- Hook templating/parameterization (future enhancement)
- Hook marketplace/discovery (future enhancement)
- Hooks for AWS ECR, Azure ACR, Docker Hub (examples provided, not tested)
- Image scanning, vulnerability management (separate concern)
- Build-time authentication for Cloud Build (Cloud Run handles this)

### Non-goals / explicit deferrals

- **Plugin system** - deferred because hooks provide 90% of value with 10% of complexity. Track as future enhancement.
- **Hook timeout configuration** - deferred because default shell timeout (120s) is sufficient for current use cases.
- **Hook retry logic** - deferred because hooks should be idempotent and fast-failing.
- **Multi-registry auto-detection** - deferred because hooks are explicit and BEC-specific.

---

## 5. Guiding Constraints

- **Canonical-file discipline:** `architecture.yaml` wins. Hook configuration is additive to execution context schema.
- **Planning approval gate:** No implementation begins until this plan is explicitly approved.
- **Repository locality:** All hooks live in project-controlled directories (`.brat/hooks/`). No external dependencies.
- **Traceability:** Every task maps to backlog ID. Hook execution logged with status, duration, exit code.
- **Reversibility:** Hook system is optional and backward compatible. Can be disabled by removing hook config.
- **Behavior preservation:** Existing deployments without hooks remain unchanged.
- **Validation required:** `validate_deliverable.sh` must verify hook system works end-to-end.
- **Security / secrets:** Hooks must use `.secure.{ENV}/` pattern. No hardcoded secrets. No secrets in logs.
- **WIP limit:** 1 task in-progress at a time.
- **Deployment target parity:** Hooks must work on local (macOS/Linux), remote (Linux via SSH), and be Cloud Run-ready.
- **Project-specific constraints**:
  - Hooks execute in repo root directory
  - Hooks receive context via environment variables
  - Hooks must exit 0 (success) or non-zero (failure)
  - Hook failures abort deployment with clear error message

---

## 6. Open Questions and Decisions

| # | Question | Why it matters | Plan of Record | Status |
|---|---|---|---|---|
| 1 | Should pre-deploy hook run locally or remotely for SSH deployments? | Determines where Docker auth credentials are cached | Pre-deploy runs locally (before sync). Pre-build runs remotely (after sync). Both can authenticate if needed. | Accepted |
| 2 | What environment variables should hooks receive? | Defines hook contract and extensibility | Provide: BRAT_CONTEXT_NAME, BRAT_DEPLOYMENT_TYPE, BRAT_TARGET_HOST, BRAT_REMOTE_DIR, BRAT_SERVICES, BRAT_REPO_ROOT. See architecture doc Appendix A. | Accepted |
| 3 | Should hook execution be synchronous or asynchronous? | Affects deployment performance and error handling | Synchronous (blocking). Hook failures abort deployment. Async execution deferred to future enhancement. | Accepted |
| 4 | How to handle hook execution on remote hosts? | Remote hooks need to execute after file sync | Hooks defined in execution context. Pre-deploy runs locally. Pre-build/post-build/post-deploy run remotely via SSH (cd $REMOTE_DIR && bash hook.sh). | Accepted |
| 5 | Should hooks support stdin/stdout piping for complex scenarios? | Enables chaining and composition | Yes. Hooks receive stdin and can output to stdout/stderr. Docker login uses stdin for passwords. | Accepted |

### Owner-accepted decisions

- **D1 — ACCEPTED:** Shell hooks only in Phase 1. TypeScript hooks deferred to Phase 4.
- **D2 — ACCEPTED:** Hook paths are relative to repo root and validated on execution.
- **D3 — ACCEPTED:** Hook execution logged with status, duration, exit code.
- **D4 — ACCEPTED:** Hook failures abort deployment (fail-fast behavior).

---

## 7. Deliverables

### Code

- `tools/brat/src/orchestration/hooks/hook-executor.ts` - HookExecutor class
- `tools/brat/src/config/types.ts` - DeploymentHooks interface, additionalSyncPaths
- Update `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` - Integrate hook execution
- Update `tools/brat/src/orchestration/docker/orchestrator.ts` - Add additionalSyncPaths support to syncRemoteFiles()
- Update `tools/brat/src/config/execution-context-schema.ts` - Add hooks and additionalSyncPaths schema validation
- `.brat/hooks/staging/pre-deploy-gcp-auth.sh` - GCP Artifact Registry authentication hook
- `architecture.yaml` - Add hooks configuration and additionalSyncPaths to staging execution context

### Tests

- `tools/brat/src/orchestration/hooks/hook-executor.test.ts` - Unit tests for HookExecutor
- `tools/brat/src/orchestration/deployment/docker-compose-strategy-hooks.test.ts` - Integration tests for hook execution in deployment flow
- Test cases:
  - Hook file not found
  - Hook not executable
  - Hook exits non-zero (failure)
  - Hook exits zero (success)
  - Hook environment variables passed correctly
  - Hook execution logged
  - Remote hook execution via SSH

### Validation / CI / deployment artifacts

- `planning/sprint-15-gpcvez/validate_deliverable.sh` - Validates:
  - TypeScript compiles cleanly
  - All tests pass
  - Hook executor works with example hook
  - obs-mcp deployment to staging (dry-run mode)

### Documentation and sprint artifacts

- `planning/sprint-15-gpcvez/execution-plan.md` (this document)
- `planning/sprint-15-gpcvez/backlog.yaml`
- `planning/sprint-15-gpcvez/request-log.md`
- `planning/sprint-15-gpcvez/validate_deliverable.sh`
- `planning/sprint-15-gpcvez/verification-report.md`
- `planning/sprint-15-gpcvez/publication.yaml`
- `planning/sprint-15-gpcvez/retro.md`
- `planning/sprint-15-gpcvez/key-learnings.md`
- `documentation/guides/deployment-hooks.md` - Hook development guide
- `documentation/guides/hook-security-best-practices.md` - Security guide
- `documentation/examples/hooks/gcp-artifact-registry-auth.sh` - GCP auth example
- `documentation/examples/hooks/aws-ecr-auth.sh` - AWS ECR auth example
- `documentation/examples/hooks/azure-acr-auth.sh` - Azure ACR auth example
- `documentation/examples/hooks/multi-registry-auth.sh` - Multi-registry example
- `documentation/examples/hooks/health-check-post-deploy.sh` - Health check example
- Update `documentation/guides/extending-bitbrat.md` - Add hooks section

---

## 8. Acceptance Criteria

1. **AC1 - Hook System Infrastructure**: HookExecutor class exists, validates hook files, executes hooks, logs execution, returns status.
2. **AC2 - Hook Integration**: DockerComposeStrategy executes hooks at correct lifecycle stages (pre-deploy, pre-build, post-build, post-deploy).
3. **AC3 - Hook Configuration**: Execution contexts support `deployment.hooks.{pre-deploy,post-deploy,pre-build,post-build}` configuration.
4. **AC4 - Hook Validation**: Hook executor validates file existence, execute permissions (Unix), and fails fast with clear error messages.
5. **AC5 - Hook Environment**: Hooks receive correct environment variables (BRAT_CONTEXT_NAME, BRAT_DEPLOYMENT_TYPE, BRAT_TARGET_HOST, BRAT_REMOTE_DIR, BRAT_SERVICES, BRAT_REPO_ROOT).
6. **AC6 - Hook Execution Logging**: Hook execution logged with hook type, path, status (success/failure), duration, exit code.
7. **AC7 - Hook Failure Handling**: Hook failures abort deployment with error message including hook path, exit code, stderr output.
8. **AC8 - obs-mcp Deployment**: obs-mcp successfully deploys to staging environment using GCP auth hook.
9. **AC9 - Backward Compatibility**: Deployments without hooks continue to work unchanged.
10. **AC10 - Example Hooks**: Example hooks provided for GCP, AWS, Azure, Docker Hub, multi-registry, health check scenarios.
11. **AC11 - Documentation**: Hook development guide, security best practices guide, extending-bitbrat.md updated.
12. **AC12 - Tests**: HookExecutor unit tests pass. Hook integration tests pass. Test coverage >80% for new code.
13. **AC13 - Additional Sync Paths**: Execution contexts support `deployment.docker.additionalSyncPaths` array for BEC-specific files.
14. **AC14 - Sync Path Integration**: additionalSyncPaths files are synced to remote before hooks execute.
15. **AC15 - Hook Scripts Synced**: `.brat/hooks/` directory automatically added to sync whitelist when hooks are configured.
16. `validate_deliverable.sh` is executable and logically passable.
17. `verification-report.md` maps each acceptance criterion to Completed / Partial / Deferred.
18. Publication is attempted; PR URL is recorded in `publication.yaml`, or a failed attempt is logged and explicitly accepted.

---

## 9. Phases and Exit Gates

### Phase 0 — Discovery and baseline validation

**Goal:** Validate current deployment flow, identify exact integration points for hooks, baseline test suite.

Tasks:
- Verify deployment flow for Docker Compose strategy (BL-001)
- Identify exact hook injection points in docker-compose-strategy.ts (BL-002)
- Run existing test suite to establish baseline (BL-003)
- Validate architecture.yaml execution context schema (BL-004)

**Exit Gate G0:**
- [ ] Deployment flow documented with line number references
- [ ] Hook injection points identified (4 locations: pre-deploy, pre-build, post-build, post-deploy)
- [ ] Baseline test results recorded (all existing tests pass)
- [ ] Schema validation approach confirmed

### Phase 1 — Core Hook System Implementation

**Goal:** Implement HookExecutor class, schema changes, and basic integration.

Tasks:
- Create HookExecutor class with execute() method (BL-100)
- Add DeploymentHooks interface to config/types.ts (BL-101)
- Add hooks schema validation to execution-context-schema.ts (BL-102)
- Write HookExecutor unit tests (BL-103)

**Exit Gate G1:**
- [ ] HookExecutor class validates hook files and executes them
- [ ] Hook environment variables passed correctly
- [ ] Hook execution logged with status and duration
- [ ] All unit tests pass
- [ ] Existing tests remain green
- [ ] No behavior change for deployments without hooks

### Phase 2 — Deployment Strategy Integration

**Goal:** Integrate hook execution into DockerComposeStrategy at all lifecycle stages.

Tasks:
- Integrate pre-deploy hook into DockerComposeStrategy.execute() (BL-200)
- Integrate pre-build hook into DockerComposeStrategy.execute() (BL-201)
- Integrate post-build hook into DockerComposeStrategy.execute() (BL-202)
- Integrate post-deploy hook into DockerComposeStrategy.execute() (BL-203)
- Write integration tests for hook execution flow (BL-204)

**Exit Gate G2:**
- [ ] All four hooks execute at correct lifecycle stages
- [ ] Hook execution order verified (pre-deploy → sync → pre-build → build → post-build → up → post-deploy)
- [ ] Integration tests pass
- [ ] Dry-run mode respects hooks
- [ ] Hook failures abort deployment correctly

### Phase 3 — obs-mcp Deployment Fix

**Goal:** Create GCP auth hook and deploy obs-mcp to staging successfully.

Tasks:
- Create .brat/hooks/staging/pre-deploy-gcp-auth.sh (BL-300)
- Make hook executable (chmod +x) (BL-301)
- Add hooks configuration to staging execution context in architecture.yaml (BL-302)
- Test deployment to staging (dry-run first, then real deployment) (BL-303)
- Verify obs-mcp container starts and is healthy on staging (BL-304)

**Exit Gate G3:**
- [ ] GCP auth hook successfully authenticates to Artifact Registry
- [ ] obs-mcp deploys to staging without authentication errors
- [ ] obs-mcp container starts and passes health check on staging
- [ ] Hook execution visible in deployment output
- [ ] Deployment can be repeated successfully (idempotent)

### Phase 4 — Example Hooks & Documentation

**Goal:** Provide comprehensive examples and documentation for hook authoring.

Tasks:
- Create example hooks for GCP, AWS, Azure, Docker Hub (BL-400)
- Create documentation/guides/deployment-hooks.md (BL-401)
- Create documentation/guides/hook-security-best-practices.md (BL-402)
- Update documentation/guides/extending-bitbrat.md (BL-403)
- Add hook examples to documentation/examples/hooks/ (BL-404)

**Exit Gate G4:**
- [ ] Example hooks provided for all major registry providers
- [ ] Hook development guide explains contract, environment variables, best practices
- [ ] Security guide covers secret management, credential handling, common pitfalls
- [ ] extending-bitbrat.md updated with hooks section
- [ ] All examples are copy-paste ready and syntactically correct

### Phase V — Validation, verification, publication, close-out

Tasks:
- Create `validate_deliverable.sh` to run install, build, tests, hook validation (BL-500)
- Produce `verification-report.md`, mapping acceptance criteria to evidence (BL-501)
- Update CHANGELOG.md with hook system feature (BL-502)
- Commit, push feature branch, and attempt PR creation. Record result in `publication.yaml` (BL-503)
- Produce `retro.md` and `key-learnings.md` (BL-504)

**Exit Gate GV:**
- [ ] `validate_deliverable.sh` logically passes or failures documented and accepted
- [ ] Verification report complete with evidence for all acceptance criteria
- [ ] CHANGELOG.md updated
- [ ] PR created or failed PR attempt logged and accepted
- [ ] Retro and learnings produced
- [ ] User says **"Sprint complete"** or **"Force complete sprint"**

---

## 10. Sequencing and Dependencies

```text
Phase 0: Discovery / baseline
  ├─> Phase 1: Core Hook System Implementation
  │     └─> Phase 2: Deployment Strategy Integration
  │           ├─> Phase 3: obs-mcp Deployment Fix
  │           └─> Phase 4: Example Hooks & Documentation
  │                 └─> Phase V: Validate / verify / publish / retro / learn
```

### Dependency notes

- Phase 1 must complete before Phase 2 (HookExecutor required for integration)
- Phase 2 must complete before Phase 3 (hook execution must work before deploying obs-mcp)
- Phase 3 and Phase 4 can partially overlap (docs can be written while testing deployment)
- Phase V depends on all prior phases completing

### Parallelization notes

- Safe to parallelize:
  - Phase 4 example hooks (independent)
  - Phase 4 documentation (independent)
- Must be serialized:
  - Phase 0 → Phase 1 (need baseline before implementing)
  - Phase 1 → Phase 2 (need HookExecutor before integrating)
  - Phase 2 → Phase 3 (need working hooks before deploying obs-mcp)

---

## 11. Testing Strategy

### Unit tests

- **HookExecutor.execute()**:
  - Hook file not found → throws clear error
  - Hook not executable (Unix) → throws clear error
  - Hook exits 0 → returns true, logs success
  - Hook exits non-zero → throws error with exit code and stderr
  - Environment variables passed correctly → verify via test hook
  - Hook execution logged → verify log output
- **Schema validation**:
  - Valid hook paths accepted
  - Invalid hook paths rejected (absolute paths, no extension)
  - Optional hooks work (undefined values)

### Integration tests

- **DockerComposeStrategy with hooks**:
  - Pre-deploy hook executes before sync
  - Pre-build hook executes after sync, before build
  - Post-build hook executes after build, before up
  - Post-deploy hook executes after up
  - Hook failure aborts deployment
  - Hook success allows deployment to continue
  - Deployment without hooks works (backward compatibility)

### Contract / conformance tests

- **Hook contract**:
  - Verify environment variables match spec (Appendix A of architecture doc)
  - Verify hook receives stdin
  - Verify hook can output to stdout/stderr
  - Verify hook exit code determines success/failure

### Security / negative tests

- **Security**:
  - Hook path traversal (../) rejected
  - Absolute hook paths outside repo warned/rejected
  - Hook cannot access parent directories (tested via example hook)
- **Negative scenarios**:
  - Hook script with syntax error → fails with stderr
  - Hook with infinite loop → times out (shell default timeout)
  - Hook with missing dependencies → fails with clear error

### Regression / behavior-preservation tests

- **Backward compatibility**:
  - Deployment without hooks configuration works
  - Existing tests pass without modification
  - Deployment output unchanged for non-hook deployments

### Test framework and execution

- Framework: Jest (Node/TypeScript)
- Main commands:
  - `npm ci` - Install dependencies
  - `npm run build` - Compile TypeScript
  - `npm test` - Run all tests
  - `./planning/sprint-15-gpcvez/validate_deliverable.sh` - Full validation

---

## 12. Deployment / Runtime Approach

### Deployment Approach

This feature is **tooling infrastructure** (brat CLI deployment system). It does not deploy as a runtime service.

**Validation Approach**:
1. **Unit tests**: Validate HookExecutor class behavior
2. **Integration tests**: Validate hook execution in deployment flow
3. **Local validation**: Deploy a test service with hooks to local Docker
4. **Staging validation**: Deploy obs-mcp to staging with GCP auth hook
5. **Dry-run validation**: Verify hooks execute in dry-run mode without side effects

**Runtime targets**: N/A (tooling feature)

**Build/deploy commands**:
- `npm run build` - Compile TypeScript
- `npm run brat -- bit deploy obs-mcp --context staging` - Test deployment

**Local runtime validation**:
- Create test hook that logs environment variables
- Deploy a service with test hook
- Verify hook executes and logs appear

**Cloud / remote validation**:
- Deploy obs-mcp to staging with GCP auth hook
- Verify obs-mcp container starts successfully
- Check staging logs for obs-mcp health

**Rollback approach**:
- Remove hooks configuration from architecture.yaml
- Redeploy without hooks (backward compatible)
- Revert commits via git if needed

---

## 13. Observability, Security, and Operational Concerns

### Logging

- **Hook execution start**: Log hook type, path, context name
- **Hook execution end**: Log status (success/failure), duration, exit code
- **Hook output**: Stream stdout/stderr to console (stdio: 'inherit')
- **Hook errors**: Log hook path, exit code, stderr in error message

### Metrics / tracing

- Not applicable (tooling feature, not runtime service)
- Hook execution duration logged for performance analysis

### Health / readiness

- Not applicable (tooling feature)
- Post-deploy hooks can implement health checks

### Auth / authorization

- Hooks execute with same permissions as brat CLI user
- Remote hooks execute with SSH user permissions
- Hooks can access `.secure.{ENV}/` files for credentials

### Secret handling

- Hooks must use `.secure.{ENV}/` pattern for secrets
- Hooks must use `--password-stdin` for Docker login (not command-line args)
- Hook executor does NOT log stdin/stdout by default (use stdio: 'inherit' to stream)
- Security guide documents best practices

### Failure modes

- **Hook file not found**: Deployment aborts with clear error (file path, expected location)
- **Hook not executable**: Deployment aborts with clear error (chmod +x instruction)
- **Hook exits non-zero**: Deployment aborts with error message (exit code, stderr)
- **Hook times out**: Shell timeout (default 120s) aborts hook
- **Remote hook fails**: SSH error propagated, deployment aborts

### Backwards compatibility

- **100% backward compatible**: Hooks are optional
- Deployments without hooks unchanged
- No breaking changes to existing APIs or configurations
- Hooks additive to execution context schema

---

## 14. Backlog Mapping

See companion `backlog.yaml` for full task breakdown with status, dependencies, and history.

| Backlog ID | Priority | Phase | Task | Acceptance |
|---|---:|---|---|---|
| BL-001 | P0 | Phase 0 | Verify deployment flow for Docker Compose strategy | Deployment flow documented |
| BL-002 | P0 | Phase 0 | Identify exact hook injection points | 4 injection points identified |
| BL-003 | P0 | Phase 0 | Run existing test suite to establish baseline | Baseline results recorded |
| BL-004 | P0 | Phase 0 | Validate architecture.yaml execution context schema | Schema approach confirmed |
| BL-100 | P0 | Phase 1 | Create HookExecutor class | HookExecutor validates and executes hooks |
| BL-101 | P0 | Phase 1 | Add DeploymentHooks interface | TypeScript types defined |
| BL-102 | P0 | Phase 1 | Add hooks schema validation | Schema validation works |
| BL-103 | P0 | Phase 1 | Write HookExecutor unit tests | Tests pass, coverage >80% |
| BL-104 | P0 | Phase 1 | Add additionalSyncPaths to DockerConfig | Interface updated |
| BL-105 | P0 | Phase 1 | Update syncRemoteFiles() for additionalSyncPaths | Sync paths extended |
| BL-106 | P0 | Phase 1 | Add additionalSyncPaths schema validation | Schema validates paths |
| BL-107 | P0 | Phase 1 | Write tests for additionalSyncPaths | Tests pass |
| BL-200 | P0 | Phase 2 | Integrate pre-deploy hook | Pre-deploy hook executes before sync |
| BL-201 | P0 | Phase 2 | Integrate pre-build hook | Pre-build hook executes after sync |
| BL-202 | P0 | Phase 2 | Integrate post-build hook | Post-build hook executes after build |
| BL-203 | P0 | Phase 2 | Integrate post-deploy hook | Post-deploy hook executes after up |
| BL-204 | P0 | Phase 2 | Write integration tests for hooks | Integration tests pass |
| BL-300 | P0 | Phase 3 | Create GCP auth hook | Hook authenticates to Artifact Registry |
| BL-301 | P0 | Phase 3 | Make hook executable | chmod +x applied |
| BL-302 | P0 | Phase 3 | Add hooks config to staging context | architecture.yaml updated |
| BL-303 | P0 | Phase 3 | Test deployment to staging | Dry-run and real deployment succeed |
| BL-304 | P0 | Phase 3 | Verify obs-mcp health on staging | Container healthy |
| BL-400 | P1 | Phase 4 | Create example hooks | Examples for GCP, AWS, Azure, Docker Hub |
| BL-401 | P1 | Phase 4 | Create deployment hooks guide | Guide complete |
| BL-402 | P1 | Phase 4 | Create security best practices guide | Security guide complete |
| BL-403 | P1 | Phase 4 | Update extending-bitbrat.md | Hooks section added |
| BL-404 | P1 | Phase 4 | Add hook examples directory | Examples in documentation/examples/hooks/ |
| BL-500 | P0 | Phase V | Create validate_deliverable.sh | Script validates end-to-end |
| BL-501 | P0 | Phase V | Produce verification-report.md | All AC mapped to evidence |
| BL-502 | P1 | Phase V | Update CHANGELOG.md | Feature documented |
| BL-503 | P0 | Phase V | Create PR and record result | PR created or failure logged |
| BL-504 | P0 | Phase V | Produce retro.md and key-learnings.md | Artifacts complete |

---

## 15. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Hook execution breaks existing deployments | Low | High | Thorough backward compatibility testing. Hooks are optional. |
| Security issues with hook scripts | Medium | High | Security guide, example hooks, validation rules. Document best practices clearly. |
| Hooks add significant deployment overhead | Low | Medium | Measure hook execution time. Provide optimization guidance. Async execution deferred. |
| Remote hook execution fails due to SSH issues | Medium | Medium | Clear error messages. Test with actual remote host. Document SSH requirements. |
| Hook paths cause issues on Windows | Medium | Medium | Use Node.js path module. Warn if hooks not supported on platform. Test on Windows. |
| Hooks are hard to debug | Medium | Low | Stream stdout/stderr to console. Log hook path, exit code, duration. |
| GCP auth hook doesn't work on staging | Medium | High | Test with actual GCP service account key. Provide fallback auth methods. |

---

## 16. Definition of Done

This sprint follows the project-wide Definition of Done in `AGENTS.md §3`.

- [ ] Implementation adheres to `architecture.yaml` and this approved plan.
- [ ] No TODOs, placeholder logic, or production stubs unless explicitly accepted and documented.
- [ ] Tests for all new behavior are present and pass (unit + integration).
- [ ] External dependencies are mocked in tests.
- [ ] Deployment / CI / validation artifacts are updated (validate_deliverable.sh).
- [ ] Documentation captures rationale, trade-offs, usage, and operational notes.
- [ ] All meaningful shell/git operations and sprint-relevant prompts are logged in `request-log.md`.
- [ ] `validate_deliverable.sh` is executable and logically passable.
- [ ] `verification-report.md` documents Completed / Partial / Deferred items.
- [ ] PR is created and recorded, or failed PR attempt is logged and accepted.
- [ ] `retro.md` and `key-learnings.md` exist.
- [ ] User has explicitly approved closure with **"Sprint complete"** or **"Force complete sprint"**.

---

## 17. Approval Gate

**Current status:** AWAITING APPROVAL

Implementation is forbidden until the owner explicitly approves this plan.

When approved, the next valid sprint command is:

```text
Start implementation
```

Or continue using the existing sprint with:

```text
Proceed with Phase 0
```
