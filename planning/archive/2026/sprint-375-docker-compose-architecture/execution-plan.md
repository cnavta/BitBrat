# Sprint 375: Execution Plan

**Role**: Lead Implementor
**Sprint Goal**: Complete secureFiles feature and optimize Docker builds
**Duration**: 2-3 weeks
**Start Date**: 2026-07-30

---

## Executive Summary

This execution plan breaks down Sprint 375 into **actionable, trackable tasks** organized by phase and priority. The plan follows a **risk-first approach**: complete the critical secureFiles fix (Phase 1) before optimizing build performance (Phase 2).

**Critical Path:**
```
Phase 1 (Week 1):  secureFiles Fix → Unblocks GCS, credentials
Phase 2 (Week 2):  Build Optimization → 83% faster builds
```

---

## Implementation Strategy

### Parallel vs Sequential Execution

**Recommendation: Sequential Execution**

**Rationale:**
1. **Shared Components**: Both phases touch `DockerComposeStrategy` and `DockerOrchestrator`
2. **Risk Mitigation**: Validate secureFiles fix before adding build complexity
3. **Testing Clarity**: Isolate changes for easier debugging
4. **Team Size**: Single implementor benefits from focus

**Alternative (if team size > 2):**
- Engineer A: Phase 1 (secureFiles)
- Engineer B: Phase 2 (Build Optimization)
- Requires coordination on `DockerComposeStrategy.execute()` merge

---

## Phase 1: Fix secureFiles Feature

**Priority**: P0 (Critical - Blocking GCS usage)
**Duration**: 5-7 days
**Goal**: Automatic volume mount injection for secure files

### Tasks Breakdown

#### Task 1.1: Create ComposeMerger Utility
**Effort**: 2 days
**Deliverable**: `tools/brat/src/orchestration/docker/compose-merger.ts`

**Subtasks:**
1. Create `ComposeMerger` class skeleton
2. Implement YAML parsing (use `js-yaml` library)
3. Implement service section merge logic
   - Merge `volumes` arrays (append, deduplicate)
   - Merge `environment` objects (service overrides generated)
   - Merge `depends_on` objects (union of deps)
   - Merge `networks` objects
4. Implement secureFiles volume mount injection
5. Add error handling (invalid YAML, missing services)
6. Add TypeScript types for merge operations

**Acceptance Criteria:**
- [ ] Merges two valid YAML compose files without data loss
- [ ] Handles missing service sections gracefully
- [ ] Injects volume mounts into correct service
- [ ] Preserves comments in YAML (nice-to-have)
- [ ] TypeScript types prevent invalid operations

**Dependencies:** None

**Testing:**
```typescript
// compose-merger.test.ts
describe('ComposeMerger', () => {
  it('merges volumes arrays without duplicates');
  it('merges environment with service precedence');
  it('injects secureFiles volume mounts');
  it('handles missing service in base compose');
  it('throws error on invalid YAML');
});
```

---

#### Task 1.2: Add ComposeMerger Tests
**Effort**: 1 day
**Deliverable**: `tools/brat/src/orchestration/docker/compose-merger.test.ts`

**Subtasks:**
1. Test volume array merging (append + dedupe)
2. Test environment object merging (precedence)
3. Test secureFiles injection (multiple files)
4. Test edge cases:
   - Empty service compose file
   - Service missing in base compose
   - Invalid YAML syntax
   - Nested objects in environment
5. Test real-world scenario: image-gen-mcp with GCP credentials

**Acceptance Criteria:**
- [ ] >90% code coverage
- [ ] All edge cases tested
- [ ] Tests pass in CI
- [ ] Performance test (merge <100ms for typical files)

**Dependencies:** Task 1.1

---

#### Task 1.3: Integrate ComposeMerger with DockerComposeStrategy
**Effort**: 1.5 days
**Deliverable**: Updated `docker-compose-strategy.ts`

**Subtasks:**
1. Import `ComposeMerger` in `DockerComposeStrategy`
2. Update `execute()` method:
   - Load generated compose file
   - Check if service has specific compose file
   - If exists, merge using `ComposeMerger`
   - If secureFiles defined, inject volume mounts
   - Write temporary `.merged.tmp` file
   - Update `orchestratorOptions` to use merged file
3. Add cleanup logic (remove `.merged.tmp` on success/failure)
4. Add logging (merge operations, files used)
5. Update error handling

**Code Location:**
`tools/brat/src/orchestration/deployment/docker-compose-strategy.ts:178-300`

**Acceptance Criteria:**
- [ ] Merged file created during deployment
- [ ] secureFiles volume mounts appear in merged file
- [ ] Temporary file cleaned up on success
- [ ] Temporary file cleaned up on failure
- [ ] Error messages indicate merge failure vs deployment failure

**Dependencies:** Task 1.1, 1.2

**Testing:**
```bash
# Manual test
npm run brat -- bit deploy image-gen-mcp --context staging --dry-run

# Should show:
# [docker-compose-strategy] Loading generated compose: docker-compose.staging.yaml
# [docker-compose-strategy] Loading service compose: services/image-gen-mcp.compose.yaml
# [docker-compose-strategy] Merging compose files...
# [docker-compose-strategy] Injecting 1 secureFiles volume mount(s)
# [docker-compose-strategy] Writing merged compose: docker-compose.staging.yaml.merged.tmp
```

---

#### Task 1.4: Add .gitignore Entry for Temporary Files
**Effort**: 0.25 days
**Deliverable**: Updated `.gitignore`

**Subtasks:**
1. Add `*.merged.tmp` to `.gitignore`
2. Add `docker-compose.*.merged.yaml` to `.gitignore`
3. Verify no temp files in git status

**Acceptance Criteria:**
- [ ] `git status` ignores `.merged.tmp` files
- [ ] No temp files committed to repo

**Dependencies:** None

---

#### Task 1.5: Integration Test - Local Deployment
**Effort**: 0.5 days
**Deliverable**: Verified local deployment with secureFiles

**Test Steps:**
1. Add test secureFiles to image-gen-mcp in architecture.yaml
2. Create dummy credential file in `.secure.local/`
3. Run `brat bit deploy image-gen-mcp --context local`
4. Verify:
   - Merge log messages appear
   - Temp file created and cleaned up
   - Volume mount appears in container
   - File accessible inside container
   - Environment variable set correctly

**Acceptance Criteria:**
- [ ] Local deployment succeeds
- [ ] Credentials mounted at correct path
- [ ] No temp files left after deployment
- [ ] Service starts and health check passes

**Dependencies:** Task 1.3

---

#### Task 1.6: Integration Test - Remote Deployment
**Effort**: 1 day
**Deliverable**: Verified remote deployment with secureFiles

**Test Steps:**
1. Configure staging context with secureFiles
2. Run `brat bit deploy image-gen-mcp --context staging`
3. Verify on remote host:
   - Credentials file transferred to `/opt/BitBratPlatform/secrets/`
   - Merged compose file used for deployment
   - Volume mount in running container
   - GCS upload works (end-to-end test)

**Acceptance Criteria:**
- [ ] Remote deployment succeeds
- [ ] GCS storage works (image upload test)
- [ ] No manual editing required
- [ ] Service health check passes

**Dependencies:** Task 1.5

---

#### Task 1.7: Documentation Updates
**Effort**: 0.5 days
**Deliverable**: Updated documentation

**Files to Update:**
1. `README.md` - Update secureFiles usage example
2. `documentation/guides/secure-files.md` - Add merge behavior notes
3. `tools/brat/src/orchestration/docker/compose-merger.ts` - JSDoc comments
4. `planning/sprint-375-docker-compose-architecture/` - Implementation notes

**Acceptance Criteria:**
- [ ] All public methods have JSDoc comments
- [ ] Usage examples updated
- [ ] Merge precedence rules documented
- [ ] Troubleshooting section added

**Dependencies:** Task 1.6

---

### Phase 1 Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| YAML merge edge cases | Medium | High | Comprehensive test coverage, fallback to manual |
| Breaking existing deployments | Low | Critical | Feature flag, extensive testing |
| Performance degradation | Low | Medium | Benchmark merge operation (<100ms target) |
| Temp file cleanup failures | Medium | Low | Use try/finally, add cleanup command |

---

## Phase 2: Build Optimization

**Priority**: P1 (Performance Improvement)
**Duration**: 5-7 days
**Goal**: 70-85% faster Docker builds via shared base image

### Tasks Breakdown

#### Task 2.1: Create Dockerfile.base
**Effort**: 1 day
**Deliverable**: `Dockerfile.base`

**Subtasks:**
1. Extract builder stage from `Dockerfile.service`
2. Extract runner stage from `Dockerfile.service`
3. Remove service-specific layers (SERVICE_ENTRY, CMD)
4. Test base image builds successfully
5. Verify artifacts present (dist/, node_modules/, architecture.yaml)

**Dockerfile Structure:**
```dockerfile
# Builder stage
FROM node:24-bookworm-slim AS builder
# ... install deps, build TypeScript ...

# Runner stage
FROM node:24-bookworm-slim AS runner
# ... production deps, copy dist/ ...
# NO CMD (added in service images)
```

**Acceptance Criteria:**
- [ ] `docker build -f Dockerfile.base -t bitbrat-base:test .` succeeds
- [ ] Base image contains `/workspace/dist/`
- [ ] Base image contains `/workspace/node_modules/`
- [ ] Base image contains `/workspace/architecture.yaml`
- [ ] Base image does NOT have CMD (service images add this)

**Dependencies:** None

---

#### Task 2.2: Update Dockerfile.service
**Effort**: 0.5 days
**Deliverable**: Updated `Dockerfile.service`

**Subtasks:**
1. Add `BASE_IMAGE` build arg
2. Replace builder/runner stages with `FROM ${BASE_IMAGE}`
3. Keep only service-specific layers (SET ENV, EXPOSE, CMD)
4. Test service image builds from base

**New Dockerfile Structure:**
```dockerfile
ARG BASE_IMAGE=bitbrat-base:latest
FROM ${BASE_IMAGE}

ARG SERVICE_NAME
ARG SERVICE_ENTRY
ARG SERVICE_PORT=3000

ENV SERVICE_NAME=${SERVICE_NAME}
ENV SERVICE_PORT=${SERVICE_PORT}
ENV SERVICE_ENTRY=${SERVICE_ENTRY}

EXPOSE ${SERVICE_PORT}
CMD ["sh", "-c", "exec node \"$SERVICE_ENTRY\""]
```

**Acceptance Criteria:**
- [ ] Service image builds in <10 seconds (using cached base)
- [ ] Service image runs correctly
- [ ] All ENV vars set correctly

**Dependencies:** Task 2.1

---

#### Task 2.3: Add bitbrat-base Service to docker-compose.local.yaml
**Effort**: 0.25 days
**Deliverable**: Updated `docker-compose.local.yaml`

**Subtasks:**
1. Add `bitbrat-base` service definition
2. Configure build context and dockerfile
3. Tag with version from architecture.yaml
4. Add to `build-only` profile (doesn't run, only builds)

**Compose Configuration:**
```yaml
services:
  bitbrat-base:
    build:
      context: .
      dockerfile: Dockerfile.base
    image: bitbrat-base:${BITBRAT_VERSION:-latest}
    profiles:
      - build-only
```

**Acceptance Criteria:**
- [ ] `docker compose build bitbrat-base` succeeds
- [ ] Base image tagged with version
- [ ] Service doesn't start during `docker compose up`

**Dependencies:** Task 2.1

---

#### Task 2.4: Update Service Compose Files (Batch 1: 5 services)
**Effort**: 0.5 days
**Deliverable**: Updated compose files for llm-bot, api-gateway, auth, event-router, ingress-egress

**Subtasks:**
1. Add `BASE_IMAGE` build arg to each service
2. Test each service builds correctly
3. Verify service starts and health check passes

**Template:**
```yaml
services:
  llm-bot:
    build:
      context: .
      dockerfile: Dockerfile.service
      args:
        BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
        SERVICE_NAME: llm-bot
        SERVICE_ENTRY: dist/apps/llm-bot-service.js
        SERVICE_PORT: "3000"
```

**Acceptance Criteria:**
- [ ] All 5 services build in <10s each (after base cached)
- [ ] All services start successfully
- [ ] No regression in functionality

**Dependencies:** Task 2.2, 2.3

---

#### Task 2.5: Update Service Compose Files (Batch 2: Remaining 10 services)
**Effort**: 1 day
**Deliverable**: Updated all remaining service compose files

**Services:**
- disposition-service, query-analyzer, reflex
- scheduler, tool-gateway, oauth-flow
- image-gen-mcp, context-pack, state-engine, story-engine-mcp

**Acceptance Criteria:**
- [ ] All 15 services use BASE_IMAGE
- [ ] Full stack builds in <6 minutes
- [ ] All services start successfully

**Dependencies:** Task 2.4

---

#### Task 2.6: Update DockerOrchestrator Build Logic
**Effort**: 1.5 days
**Deliverable**: Updated `orchestrator.ts` with base image build step

**Subtasks:**
1. Add base image build logic before service builds
2. Implement cache key computation (hash of package.json + src/)
3. Skip base build if cache key unchanged
4. Add `--rebuild-base` flag support
5. Update remote build flow (build base first)

**Code Changes:**
```typescript
// In orchestrator.ts up() method

// Step 1: Build base image if needed
if (this.shouldRebuildBase(arch, options)) {
  console.log('[brat] Building shared base image...');
  const baseBuildArgs = [...composeArgs, 'build', 'bitbrat-base'];
  await this.executeDockerCompose(targetConfig, baseBuildArgs);
  this.updateBaseCacheKey(arch);
}

// Step 2: Build services (fast, use cached base)
for (const service of buildServices) {
  // ... existing build logic
}
```

**Acceptance Criteria:**
- [ ] Base image built first
- [ ] Base rebuild skipped when cache key unchanged
- [ ] `--rebuild-base` flag forces base rebuild
- [ ] Cache key stored and validated

**Dependencies:** Task 2.5

---

#### Task 2.7: Add Base Image Cache Management
**Effort**: 0.5 days
**Deliverable**: Cache key computation and storage

**Subtasks:**
1. Create `computeBaseCacheKey()` function
2. Hash package.json, package-lock.json, src/ directory
3. Store cache key in `.base-image-cache-key` file
4. Compare on each deployment
5. Add to `.gitignore`

**Acceptance Criteria:**
- [ ] Cache key changes when dependencies change
- [ ] Cache key changes when source code changes
- [ ] Cache key unchanged when only service files change
- [ ] `.base-image-cache-key` ignored by git

**Dependencies:** Task 2.6

---

#### Task 2.8: Performance Benchmarking
**Effort**: 1 day
**Deliverable**: Before/after performance metrics

**Benchmarks to Run:**
1. **Cold cache full build** (15 services):
   - Before: ~40 min (remote) / ~25 min (local)
   - After: ~6 min (target)
2. **Single service rebuild** (code change):
   - Before: ~4 min
   - After: ~5s (target)
3. **Base rebuild** (dependency change):
   - Expected: ~4 min (acceptable one-time cost)

**Acceptance Criteria:**
- [ ] Full build 70%+ faster
- [ ] Single service rebuild 95%+ faster
- [ ] Metrics documented in sprint report

**Dependencies:** Task 2.7

---

#### Task 2.9: Documentation Updates
**Effort**: 0.5 days
**Deliverable**: Updated documentation

**Files to Update:**
1. `documentation/guides/docker-builds.md` - Base image workflow
2. `DOCKERFILE_MIGRATION_SUMMARY.md` - Update with base image pattern
3. `README.md` - Build time improvements
4. Planning docs - Performance results

**Acceptance Criteria:**
- [ ] Base image workflow documented
- [ ] Cache key management explained
- [ ] Troubleshooting guide updated

**Dependencies:** Task 2.8

---

### Phase 2 Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Base image staleness | Medium | Medium | Automatic cache key, rebuild warnings |
| Build failures with base | Low | High | Keep Dockerfile.service.bak, easy rollback |
| Slower initial builds | Low | Low | Expected, one-time cost, document clearly |
| Remote registry issues | Low | Medium | Start with local builds, add registry later |

---

## Testing Strategy

### Unit Tests
- [ ] ComposeMerger (>90% coverage)
- [ ] Cache key computation
- [ ] YAML merge operations

### Integration Tests
- [ ] Local deployment with secureFiles
- [ ] Remote deployment with secureFiles
- [ ] Base image build workflow
- [ ] Service build from base image

### End-to-End Tests
- [ ] GCS upload with mounted credentials
- [ ] Full stack build (15 services)
- [ ] Single service rebuild performance

### Regression Tests
- [ ] Existing deployments still work
- [ ] No secureFiles deployments unaffected
- [ ] Legacy `brat docker up` still works

---

## Rollback Plan

### Phase 1 Rollback (secureFiles)
**If merge failures occur:**
1. Set feature flag: `BITBRAT_COMPOSE_MERGE=false`
2. Revert to manual file editing workflow
3. Fix merge logic in dev environment
4. Re-enable after validation

**Rollback Time**: <1 hour

### Phase 2 Rollback (Build Optimization)
**If build issues occur:**
1. Restore `Dockerfile.service.bak`
2. Remove `BASE_IMAGE` args from service compose files
3. Remove `bitbrat-base` service
4. Builds revert to old workflow

**Rollback Time**: <2 hours

---

## Dependencies & Prerequisites

### External Dependencies
- ✅ Docker Compose 2.x (already installed)
- ✅ `js-yaml` library (already in package.json)
- ✅ Staging environment access (available)

### Code Dependencies
- ✅ Sprint 374 secureFiles schema (completed)
- ✅ DockerComposeStrategy (existing)
- ✅ DockerOrchestrator (existing)

### Blocking Items
- None (all prerequisites met)

---

## Success Metrics

### Phase 1: secureFiles
- [ ] **Functional**: 100% of secureFiles mount correctly
- [ ] **Manual Intervention**: 0 edits required post-deployment
- [ ] **Deployment Success**: 100% success rate
- [ ] **Test Coverage**: >90% for ComposeMerger

### Phase 2: Build Optimization
- [ ] **Build Time**: 70%+ improvement (40 min → <12 min)
- [ ] **Single Service**: 95%+ improvement (4 min → <15s)
- [ ] **Base Build**: <5 minutes
- [ ] **Cache Hit Rate**: >80% (base unchanged across deploys)

---

## Timeline & Milestones

### Week 1: Phase 1 (secureFiles)
```
Day 1-2:  Tasks 1.1, 1.2 - ComposeMerger implementation & tests
Day 3:    Task 1.3 - Integration with DockerComposeStrategy
Day 4:    Tasks 1.4, 1.5 - Local testing
Day 5:    Task 1.6 - Remote testing, validation
Weekend:  Task 1.7 - Documentation

Milestone: secureFiles feature complete and validated
```

### Week 2: Phase 2 (Build Optimization)
```
Day 1:    Tasks 2.1, 2.2, 2.3 - Dockerfiles and base service
Day 2:    Task 2.4 - Update 5 service compose files
Day 3:    Task 2.5 - Update remaining 10 services
Day 4:    Tasks 2.6, 2.7 - Orchestrator integration
Day 5:    Task 2.8 - Performance benchmarking
Weekend:  Task 2.9 - Documentation

Milestone: Build optimization complete, 70%+ faster
```

### Week 3 (if needed): Polish & Rollout
```
Day 1-2:  Edge case fixes, additional testing
Day 3:    Staged rollout to dev → staging → prod
Day 4-5:  Monitor, gather feedback, final docs

Milestone: Sprint complete, all features in production
```

---

## Next Steps

1. **Review this execution plan** with team/stakeholders
2. **Create YAML backlog** from task breakdown (see `backlog.yaml`)
3. **Assign tasks** to engineers
4. **Set up tracking** (Jira/Linear tickets)
5. **Begin Task 1.1** (ComposeMerger implementation)

---

## Notes for Implementor

### Code Style
- Follow existing TypeScript conventions
- Use `pnpm` for dependency management
- Run `npm run lint` before committing
- Add JSDoc comments to public methods

### Git Workflow
- Create feature branch: `feat/sprint-375-compose-merger`
- Commit frequently with clear messages
- Create PR after each phase completes
- Squash commits before merging

### Communication
- Daily updates in #bitbrat-dev Slack
- Block on issues >1 hour (ask for help)
- Document decisions in sprint docs
- Share benchmarks and metrics

---

**Execution plan ready for implementation. See `backlog.yaml` for trackable task list.**
