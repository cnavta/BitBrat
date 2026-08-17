# Sprint 375: Executive Summary

**Date**: 2026-07-30
**Author**: Architect (Claude Code)
**Status**: Planning Phase

---

## The Problem in One Sentence

The `secureFiles` feature from Sprint 374 transfers credential files to remote hosts but doesn't mount them into containers, and Docker builds waste 70-80% of time rebuilding identical layers for each service.

---

## What We're Solving

### Issue #1: Incomplete secureFiles Implementation (P0 - Critical)

**Current Behavior:**
```bash
# User adds GCP credentials to architecture.yaml
services:
  image-gen-mcp:
    secureFiles:
      - local: .secure.staging/gcp-credentials.json
        target: /var/secrets/gcp-credentials.json
        env: GOOGLE_APPLICATION_CREDENTIALS

# User deploys
$ npm run brat -- bit deploy image-gen-mcp --context staging

# What happens:
✅ File transferred to remote host (/opt/BitBratPlatform/secrets/)
❌ Volume mount NOT injected into docker-compose.staging.yaml
❌ Container doesn't have file at /var/secrets/gcp-credentials.json
❌ User must MANUALLY edit generated compose file
```

**Root Cause:**
- `DockerComposeStrategy` only uses **generated** `docker-compose.{context}.yaml` files
- Generated files are static (created once by `brat context create`)
- Service-specific compose files (`services/*.compose.yaml`) are **ignored** for remote deployments
- No dynamic volume mount injection during deployment

**Impact:**
- GCS storage doesn't work in staging
- Other secure file use cases blocked
- Manual intervention required after every deployment
- Feature advertised in architecture.yaml doesn't work

---

### Issue #2: Slow Docker Builds (P1 - Performance)

**Current Behavior:**
```bash
# Building 15 services (llm-bot, api-gateway, auth, etc.)
$ npm run brat -- bit deploy --all --context staging

Service 1 (llm-bot):     249s  ← npm ci (90s) + build (45s) + prod install (60s)
Service 2 (api-gateway): 219s  ← REBUILDS same npm ci, same build
Service 3 (auth):        219s  ← REBUILDS again
... (12 more services)
───────────────────────────────
TOTAL: ~40 minutes
```

**Root Cause:**
- All services use:
  - ✅ Same source code (`src/`)
  - ✅ Same dependencies (`package.json`, `package-lock.json`)
  - ✅ Same Dockerfile (`Dockerfile.service`)
  - ✅ Same build commands (`npm ci`, `npm run build`)
- Only difference: Entry point (`dist/apps/llm-bot-service.js` vs `dist/apps/api-gateway.js`)
- Docker rebuilds all layers for each service instead of sharing cache

**Impact:**
- **40-minute deployments** for full stack
- **4-minute rebuilds** for single service changes
- Developer productivity hit
- CI/CD pipeline slowness

---

## The Solution in Two Parts

### Part 1: Compose File Merger (Fixes secureFiles)

**How It Works:**
```typescript
// During deployment, BEFORE calling Docker
const merger = new ComposeMerger();

// 1. Load generated compose file
const generated = loadYAML('docker-compose.staging.yaml');

// 2. Load service-specific overrides
const serviceOverrides = loadYAML('services/image-gen-mcp.compose.yaml');

// 3. Merge (service overrides win)
const merged = merger.merge(generated, serviceOverrides);

// 4. Inject secureFiles volume mounts
const final = merger.injectSecureFiles(merged, service.secureFiles);

// 5. Deploy using merged config
deploy(final);
```

**Result:**
```bash
$ npm run brat -- bit deploy image-gen-mcp --context staging

✅ File transferred to remote: /opt/BitBratPlatform/secrets/gcp-credentials.json
✅ Volume mount injected: /opt/.../secrets/gcp-credentials.json:/var/secrets/gcp-credentials.json:ro
✅ Environment variable set: GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/gcp-credentials.json
✅ Container has file at expected path
✅ GCS storage works
```

**Time to Implement**: 1 week

---

### Part 2: Shared Base Image (Speeds Up Builds)

**How It Works:**
```dockerfile
# NEW: Dockerfile.base (built once)
FROM node:24-bookworm-slim AS builder
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build
# ... produces /workspace/dist with all compiled TypeScript

# UPDATED: Dockerfile.service (builds in 5 seconds)
ARG BASE_IMAGE=bitbrat-base:latest
FROM ${BASE_IMAGE}
ARG SERVICE_ENTRY
ENV SERVICE_ENTRY=${SERVICE_ENTRY}
CMD ["sh", "-c", "exec node \"$SERVICE_ENTRY\""]
```

**Build Process:**
```bash
# Step 1: Build base image ONCE
docker compose build bitbrat-base   # 4 minutes

# Step 2: Build all services (they use cached base)
docker compose build llm-bot        # 5 seconds
docker compose build api-gateway    # 5 seconds
docker compose build auth           # 5 seconds
... (12 more × 5 seconds each)
───────────────────────────────────
TOTAL: ~6 minutes (vs 40 minutes)
```

**Result:**
- ✅ **83% faster** full builds (40 min → 6 min)
- ✅ **98% faster** single service rebuilds (4 min → 5s)
- ✅ Base image cached and reused
- ✅ Rebuild base only when dependencies or source code change

**Time to Implement**: 1-2 weeks

---

## Why This Matters

### User Impact

**Before Sprint 375:**
```
Developer wants to add GCP credentials for image generation:
1. Add secureFiles to architecture.yaml ✅
2. Deploy with `brat bit deploy` ❌ (doesn't work)
3. SSH to remote host
4. Manually edit docker-compose.staging.yaml
5. Add volume mount manually
6. Restart container manually
7. Hope it works

Build takes 40 minutes, then credentials still don't mount.
Developer gives up and hardcodes file path.
```

**After Sprint 375:**
```
Developer wants to add GCP credentials:
1. Add secureFiles to architecture.yaml ✅
2. Deploy with `brat bit deploy` ✅ (works!)
3. Done.

Build takes 6 minutes, credentials mount automatically.
Developer is happy.
```

### Platform Reliability

**Current State:**
- ❌ Advertised features don't work (`secureFiles` in architecture.yaml)
- ❌ Documentation lies ("just add secureFiles and deploy")
- ❌ Manual workarounds required
- ❌ Inconsistent behavior (local vs remote)

**After Sprint 375:**
- ✅ secureFiles feature complete and tested
- ✅ Documentation accurate
- ✅ No manual intervention needed
- ✅ Consistent behavior across all deployment types

---

## Success Metrics

### Functional Metrics (secureFiles)
- [ ] Zero manual edits required after deployment
- [ ] 100% of secureFiles definitions mount correctly
- [ ] Works identically for local, remote, and cloud deployments
- [ ] Validation catches misconfigurations before deployment

### Performance Metrics (Build Optimization)
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Full stack build (15 services) | 40 min | 6 min | **83% faster** |
| Single service rebuild | 4 min | 5s | **98% faster** |
| Base image build | N/A | 4 min | (one-time cost) |
| Developer iteration time | 4 min | 5s | **98% faster** |

### Quality Metrics
- [ ] All existing tests pass
- [ ] New features have >90% test coverage
- [ ] Zero regression bugs reported
- [ ] Deployment success rate: 100%

---

## Risk Assessment

### High Risk: YAML Merge Edge Cases
**Probability**: Medium
**Impact**: High
**Mitigation**: Comprehensive test coverage, clear precedence rules, fallback to manual merge

### Medium Risk: Base Image Staleness
**Probability**: Low
**Impact**: Medium
**Mitigation**: Automatic cache key computation, rebuild when dependencies change

### Low Risk: Deployment Breakage
**Probability**: Very Low
**Impact**: High
**Mitigation**: Feature flags, staged rollout, rollback plan

---

## Timeline

### Week 1: Fix secureFiles (P0)
- Day 1-2: Implement `ComposeMerger` utility
- Day 3-4: Integrate with `DockerComposeStrategy`
- Day 5: Testing and validation
- Deliverable: Working secureFiles deployment

### Week 2: Build Optimization (P1)
- Day 1-2: Create `Dockerfile.base` and infrastructure
- Day 3: Update service compose files
- Day 4: Integrate with orchestrator
- Day 5: Benchmarking and documentation
- Deliverable: 80%+ faster builds

### Week 3: Polish and Documentation
- Day 1-2: Integration testing
- Day 3: Documentation updates
- Day 4-5: Migration guide and rollout plan

---

## Dependencies

### Required Before Starting
- ✅ Sprint 374 completed (secureFiles schema defined)
- ✅ Docker Compose 2.x installed on all targets
- ✅ Access to staging environment for testing

### Blocking Other Work
- [ ] Cloud Run deployment strategy (needs secureFiles)
- [ ] Multi-environment credential management
- [ ] Additional secure file use cases (SSL certs, API keys)

---

## Decision Points

### Decision 1: Merge Strategy

**Options:**
A. Dynamic merge on every deployment (recommended)
B. Pre-generate merged files and check into git
C. Remove generated files entirely, always generate dynamically

**Recommendation**: Option A (dynamic merge)
- ✅ No git conflicts from generated files
- ✅ Always up-to-date with architecture.yaml
- ✅ Backward compatible
- ⚠️ Slightly slower (merge overhead ~1-2 seconds)

### Decision 2: Base Image Distribution

**Options:**
A. Build locally every time (recommended for Phase 1)
B. Push to Docker Hub and pull
C. Use private registry (GCR, ECR, etc.)

**Recommendation**: Option A initially, migrate to C later
- ✅ Simpler implementation (no registry infrastructure)
- ✅ No registry costs
- ✅ Easier debugging (local build context)
- ⚠️ Slower for multi-developer teams (everyone builds base)

### Decision 3: Rollout Strategy

**Options:**
A. Feature flag with staged rollout (recommended)
B. Direct migration (risky)
C. Parallel systems (complex)

**Recommendation**: Option A
- ✅ Low risk (can disable instantly)
- ✅ Validate on dev before staging/prod
- ✅ Easy rollback
- ⚠️ Requires feature flag infrastructure

---

## Open Questions for User

1. **Priority**: Should we do secureFiles fix first (1 week), then build optimization (1 week)? Or in parallel?

2. **Scope**: Do you want base image optimization in this sprint, or defer to Sprint 376?

3. **Testing**: What's the acceptable downtime window for testing in staging?

4. **Rollback Plan**: If we encounter issues, acceptable to rollback to manual secureFiles editing for 1-2 days while we fix?

---

## Bottom Line

**Sprint 375 makes BitBrat's advertised features actually work and cuts build times by 80%.**

**Investment**: 2-3 weeks of development
**Return**:
- Functional `secureFiles` deployment (unlocks GCS, certificates, keys)
- 35 minutes saved per deployment (ROI after ~5 deployments)
- Developer productivity improvement
- Platform reliability and trust

**Recommendation**: Execute both parts in this sprint. secureFiles is critical (P0), build optimization provides massive ROI.
