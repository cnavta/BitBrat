# Sprint 375: Docker Compose Architecture & Build Optimization

**Status**: Planning
**Sprint Goal**: Complete the incomplete `secureFiles` feature from Sprint 374 and optimize Docker build performance for Bit services
**Priority**: P0 (secureFiles), P1 (build optimization)

---

## Overview

This sprint addresses two critical infrastructure issues discovered during Sprint 374's secure file deployment work:

### Primary Objective: Complete secureFiles Feature
The `secureFiles` feature defined in `architecture.yaml` was partially implemented in Sprint 374 but requires volume mount injection to work correctly. Currently, GCP credentials and other secure files are transferred to remote hosts but not properly mounted into containers.

### Secondary Objective: Optimize Docker Builds
All 15+ Bit services use identical source code, dependencies, and build process, yet build times for full stack deployments are 25-40 minutes. We can reduce this to ~6 minutes with a shared base image strategy.

---

## Sprint Documents

### [Technical Architecture](./technical-architecture.md)
Comprehensive analysis of the Docker Compose orchestration architecture, including:
- Current deployment paths (legacy `brat docker up` vs new `brat bit deploy`)
- Root cause analysis of secureFiles incomplete implementation
- Three proposed solutions for volume mount injection
- Recommended implementation: Compose File Merge strategy

### [Build Optimization Analysis](./build-optimization-analysis.md)
Detailed investigation of Docker build performance, including:
- Current build architecture and timing breakdown
- Four optimization strategies evaluated
- Recommended implementation: Shared Base Image strategy
- Performance benchmarks (projected 70-85% improvement)

---

## Key Findings

### Finding 1: Two Deployment Paths with Feature Parity Gap

BitBrat currently has **two** deployment paths:

| Path | Entry Point | Uses Service Compose Files? | secureFiles Support? |
|------|-------------|----------------------------|---------------------|
| **Legacy** | `brat docker up` → `DockerOrchestrator` | ✅ Yes (via `ComposeFactory`) | ❌ No |
| **New** | `brat bit deploy` → `DockerComposeStrategy` → `DockerOrchestrator` | ❌ No (only generated compose) | ⚠️ Partial (transfer only) |

**Impact**: The new unified deployment path (`brat bit deploy`) doesn't use service-specific compose files for remote deployments, causing `secureFiles` volume mounts to be ignored.

### Finding 2: Generated Compose Files Are Static

`docker-compose.{context}.yaml` files are:
- Generated once by `brat context create`
- Checked into git
- Not updated during deployment
- Missing service-specific overrides from `services/*.compose.yaml`

**Impact**: Even if we add volume mounts to service compose files, they're ignored for context-specific deployments.

### Finding 3: Build Process Rebuilds Identical Layers

Current build process for 15 services:
```
Total build time (cold cache): ~25-40 minutes
  - llm-bot: 249s (includes npm ci, TypeScript build)
  - api-gateway: 219s (rebuilds same layers)
  - auth: 219s (rebuilds same layers)
  - ... (12 more services)
```

**Opportunity**: All services share >95% of build layers. With shared base image:
```
Total build time: ~6 minutes
  - bitbrat-base: 249s (once)
  - llm-bot: 5s (just metadata)
  - api-gateway: 5s
  - ... (12 more services × 5s each)
```

---

## Recommended Solutions

### Solution 1: Compose File Merger (secureFiles Fix)

**Approach**: Dynamically merge service-specific compose files into generated compose file during deployment.

**Implementation:**
1. Create `ComposeMerger` utility class
2. In `DockerComposeStrategy.execute()`:
   - Load generated `docker-compose.{context}.yaml`
   - Load service-specific `services/{service}.compose.yaml`
   - Merge service overrides (volumes, environment, etc.)
   - Inject `secureFiles` volume mounts
   - Write temporary `.merged.tmp` file
   - Deploy using merged file
   - Cleanup temp file

**Benefits:**
- ✅ No breaking changes (existing compose files unchanged)
- ✅ Works for both local and remote deployments
- ✅ Preserves service-specific overrides
- ✅ Testable (merge logic isolated)

**Complexity**: Medium (YAML merging with edge cases)

### Solution 2: Shared Base Image (Build Optimization)

**Approach**: Build common layers once, derive service images from base.

**Implementation:**
1. Create `Dockerfile.base` (builder + runner stages, no entry point)
2. Update `Dockerfile.service` to use `BASE_IMAGE` arg
3. Add `bitbrat-base` service to `docker-compose.local.yaml`
4. Modify `DockerOrchestrator` to build base image first
5. Service images just set `SERVICE_ENTRY` and `CMD`

**Benefits:**
- ✅ 70-85% faster builds
- ✅ Works identically for local/remote
- ✅ Backward compatible (can rollback)
- ✅ No per-service Dockerfile changes

**Complexity**: Low (two Dockerfiles, orchestrator logic update)

---

## Success Criteria

### secureFiles Feature Complete
- [ ] `brat bit deploy image-gen-mcp --context staging` mounts GCP credentials without manual editing
- [ ] Volume mounts from `architecture.yaml` secureFiles appear in deployed containers
- [ ] Environment variables set correctly (e.g., `GOOGLE_APPLICATION_CREDENTIALS`)
- [ ] Works for both local and remote deployments
- [ ] Validation prevents deploying with missing/invalid files

### Build Optimization
- [ ] Base image build: <5 minutes
- [ ] Service-specific build: <10 seconds (using cached base)
- [ ] Full stack rebuild (15 services): <6 minutes (vs current ~25 minutes)
- [ ] Baseline metrics documented (before/after comparison)
- [ ] No duplicate layer builds

### Quality Gates
- [ ] All existing tests pass
- [ ] New tests for `ComposeMerger` (>90% coverage)
- [ ] Backward compatible (existing deployments work)
- [ ] Documentation updated
- [ ] Performance benchmarks validated

---

## Implementation Plan

### Phase 1: Fix secureFiles (Week 1)
**Priority**: P0

**Tasks:**
1. Create `ComposeMerger` utility class
   - YAML merge logic
   - Volume mount injection
   - Environment variable merging
   - Array handling (append vs replace)
2. Integrate with `DockerComposeStrategy`
   - Merge service compose files
   - Inject secureFiles mounts
   - Temporary file management
3. Testing
   - Unit tests for merge scenarios
   - Integration test with image-gen-mcp
   - Remote deployment validation
4. Documentation
   - Update technical architecture docs
   - Add merge behavior examples

**Deliverables:**
- `tools/brat/src/orchestration/docker/compose-merger.ts`
- `tools/brat/src/orchestration/docker/compose-merger.test.ts`
- Updated `docker-compose-strategy.ts`
- Documentation updates

### Phase 2: Build Optimization (Week 2)
**Priority**: P1

**Tasks:**
1. Create base image infrastructure
   - Extract `Dockerfile.base` from `Dockerfile.service`
   - Add `bitbrat-base` service to compose files
   - Update `Dockerfile.service` to use base image
2. Update service compose files
   - Add `BASE_IMAGE` build arg to all 15 services
   - Test individual service builds
3. Integrate with orchestrator
   - Build base image first in deployment flow
   - Add cache key computation (detect when base needs rebuild)
   - Add `--rebuild-base` flag
4. Testing & benchmarking
   - Measure build times (before/after)
   - Validate layer cache reuse
   - Test remote deployments
5. Documentation
   - Base image management guide
   - Migration path documentation
   - Performance benchmarks

**Deliverables:**
- `Dockerfile.base`
- Updated `Dockerfile.service`
- Updated service compose files (15 files)
- Updated `DockerOrchestrator` build logic
- Performance benchmarks document

### Phase 3: Deployment Path Unification (Future Sprint)
**Priority**: P2 (Technical Debt)

**Tasks:**
1. Deprecate `brat docker up`
2. Migrate all functionality to strategy pattern
3. Remove direct `DockerOrchestrator` usage from CLI
4. Migration guide for users

---

## Risks & Mitigation

### Risk 1: YAML Merge Edge Cases

**Risk**: YAML merging has complex edge cases (nested objects, arrays, anchors, aliases)

**Mitigation:**
- Use battle-tested YAML library (`js-yaml`)
- Comprehensive test coverage for merge scenarios
- Clear precedence rules (service overrides generated)
- Fallback: Manual merge if complex structures detected

### Risk 2: Base Image Staleness

**Risk**: Developers might forget to rebuild base image when dependencies change

**Mitigation:**
- Automatic cache key computation (hash of package.json + src/)
- Rebuild base image automatically when cache key changes
- Clear error messages when base image is stale
- Add `brat base-image status` command

### Risk 3: Breaking Changes in Deployment

**Risk**: Compose file merging might break existing deployments

**Mitigation:**
- Feature flag: `BITBRAT_COMPOSE_MERGE=false` (default initially)
- Staged rollout: dev → staging → production
- Rollback plan (keep old code path for 1 sprint)
- Comprehensive testing before enabling

---

## Open Questions

1. **Q: Should we migrate generated compose files to dynamic generation?**
   - **A**: Not in this sprint. Keep generated files in git for now, prove merge approach works first.

2. **Q: How to handle compose file conflicts during merge?**
   - **A**: Service-specific values override generated values (principle of least surprise).

3. **Q: Should base image be pushed to registry?**
   - **A**: Start with local builds, migrate to registry in future sprint if needed.

4. **Q: How to version base image?**
   - **A**: Tag with architecture.yaml version (`bitbrat-base:0.19.1`).

---

## Related Documentation

- [Sprint 374: Secure File Deployment](../sprint-374-secure-file-deployment/technical-architecture.md)
- [Docker Compose Strategy](../../tools/brat/src/orchestration/deployment/docker-compose-strategy.ts)
- [Docker Orchestrator](../../tools/brat/src/orchestration/docker/orchestrator.ts)
- [Reusable Service Dockerfile](../../Dockerfile.service)

---

## Team Notes

### For Implementer

**Start Here:**
1. Read [Technical Architecture](./technical-architecture.md) for full context
2. Review [Build Optimization Analysis](./build-optimization-analysis.md) for performance details
3. Begin with Phase 1 (secureFiles fix) - it's blocking current work
4. Phase 2 (build optimization) can run in parallel or after Phase 1

**Key Files to Understand:**
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- `tools/brat/src/orchestration/docker/orchestrator.ts`
- `tools/brat/src/orchestration/docker/compose-factory.ts`
- `Dockerfile.service`

### For Code Reviewer

**Focus Areas:**
1. YAML merge logic correctness (arrays, nested objects)
2. Temporary file cleanup (no leaks)
3. Error handling (clear messages, graceful fallback)
4. Test coverage (merge edge cases)
5. Performance impact (benchmarks before/after)

### For QA

**Test Scenarios:**
1. Deploy with secureFiles (local and remote)
2. Deploy without secureFiles (regression test)
3. Single service rebuild with base image cache
4. Full stack rebuild with cold cache
5. Base image rebuild when dependencies change
6. Rollback to old deployment path

---

**Next Steps**: Begin implementation of Phase 1 (ComposeMerger).
