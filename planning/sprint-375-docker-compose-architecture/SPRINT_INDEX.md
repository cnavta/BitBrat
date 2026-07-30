# Sprint 375: Documentation Index

This sprint addresses two infrastructure issues:
1. **PRIMARY**: Complete the incomplete `secureFiles` feature from Sprint 374
2. **SECONDARY**: Optimize Docker build performance (70-80% improvement)

---

## Start Here

**New to this sprint?** → Read [Executive Summary](./executive-summary.md) (10 min read)

**Technical lead/architect?** → Read [Technical Architecture](./technical-architecture.md) (30 min read)

**Performance optimization focus?** → Read [Build Optimization Analysis](./build-optimization-analysis.md) (25 min read)

**Implementation starting?** → Read [README](./README.md) for full context (15 min read)

---

## Document Purpose Matrix

| Document | Target Audience | Purpose | Time Investment |
|----------|----------------|---------|-----------------|
| [Executive Summary](./executive-summary.md) | PM, Stakeholders, Management | High-level problem, solution, ROI | 10 min |
| [README](./README.md) | Engineers, QA, Team Leads | Sprint overview, tasks, deliverables | 15 min |
| [Technical Architecture](./technical-architecture.md) | Engineers, Architects | Detailed design, solutions, trade-offs | 30 min |
| [Build Optimization Analysis](./build-optimization-analysis.md) | Performance Engineers | Build performance deep-dive | 25 min |

---

## Quick Reference

### Problem Summary
```
Sprint 374 Issue:
  architecture.yaml secureFiles → transfers files ✅ → mounts files ❌

Build Performance Issue:
  15 services × 4 min each = 40 min total build time
  (all services use identical source code)
```

### Solution Summary
```
Solution 1 (secureFiles):
  Merge service-specific compose files → inject volume mounts → deploy
  Result: Fully automatic secure file mounting

Solution 2 (Build Optimization):
  Build base image once → derive 15 services from base
  Result: 40 min → 6 min (83% faster)
```

### Implementation Phases
```
Phase 1 (Week 1):  Fix secureFiles       [P0 - Critical]
Phase 2 (Week 2):  Build Optimization   [P1 - Performance]
Phase 3 (Future):  Deployment Unification [P2 - Tech Debt]
```

---

## Key Findings

### Finding 1: Two Deployment Paths
BitBrat has two ways to deploy services with different feature sets:

| Feature | `brat docker up` (Legacy) | `brat bit deploy` (New) |
|---------|--------------------------|-------------------------|
| Service compose files | ✅ Used | ❌ Ignored |
| secureFiles support | ❌ No | ⚠️ Partial |

**Impact**: New unified deployment path doesn't work for secure files.

### Finding 2: Generated Compose Files Are Static
`docker-compose.staging.yaml` is:
- Generated once by `brat context create`
- Never updated during deployment
- Missing service-specific overrides

**Impact**: Manual editing required after every deployment.

### Finding 3: 95% of Build Layers Are Identical
All 15 services share:
- Same TypeScript source code
- Same dependencies (package.json)
- Same build process (npm ci, npm run build)
- Same Dockerfile

**Opportunity**: Build common layers once, not 15 times.

---

## Architecture Diagrams

### Current vs Proposed (secureFiles)

**Current (Broken):**
```
architecture.yaml (secureFiles)
  → DockerComposeStrategy.prepare()
    → transfer files to remote ✅
    → inject volume mounts ❌ (MISSING)
      → docker compose up (no mounts)
        → container (no credentials) ❌
```

**Proposed (Fixed):**
```
architecture.yaml (secureFiles)
  → DockerComposeStrategy.prepare()
    → transfer files to remote ✅
    → ComposeMerger.merge() ✅ (NEW)
      → inject volume mounts ✅
        → docker compose up (with mounts)
          → container (credentials mounted) ✅
```

### Current vs Proposed (Build Optimization)

**Current (Slow):**
```
llm-bot:      249s (npm ci + build + prod install)
api-gateway:  219s (rebuilds same layers)
auth:         219s (rebuilds same layers)
... (12 more)
────────────────────────────
TOTAL:        ~40 minutes
```

**Proposed (Fast):**
```
bitbrat-base: 249s (once - all common layers)
  ├─ llm-bot:      5s (just entry point)
  ├─ api-gateway:  5s
  ├─ auth:         5s
  └─ ... (12 more × 5s)
────────────────────────────
TOTAL:        ~6 minutes
```

---

## File Structure

```
planning/sprint-375-docker-compose-architecture/
├── SPRINT_INDEX.md                        ← You are here
├── README.md                               ← Sprint overview
├── executive-summary.md                    ← For stakeholders
├── technical-architecture.md               ← Detailed design
└── build-optimization-analysis.md          ← Performance deep-dive
```

---

## Related Sprints

- [Sprint 374: Secure File Deployment](../sprint-374-secure-file-deployment/) - Where secureFiles was introduced
- [Sprint 372: Unified Bit Deploy](../sprint-372-unified-bit-deploy/) - Where deployment strategy pattern was introduced
- [Sprint 349: Execution Contexts](../sprint-349-execution-contexts/) - Where execution contexts were introduced

---

## Key Metrics

### Success Criteria

**secureFiles Feature:**
- [ ] Zero manual edits after deployment
- [ ] 100% of secureFiles mount correctly
- [ ] Works for local, remote, and cloud deployments

**Build Optimization:**
- [ ] Base image build: <5 min
- [ ] Service build: <10 sec
- [ ] Full stack: <6 min (vs 40 min)

### ROI Calculation

**Build Optimization:**
```
Time saved per deployment:    34 minutes
Deployments per week:         ~10 (dev + staging + prod)
Weekly time savings:          340 minutes (5.6 hours)
Annual time savings:          290 hours (~7 work weeks)

Implementation cost:          2 weeks
ROI break-even point:         3 weeks
```

**secureFiles Fix:**
```
Time saved per credential deployment: 30 minutes (no manual SSH editing)
Credential deployments per month:     ~4 (new services, updates)
Monthly time savings:                  2 hours

Plus: Unlocks GCS, certificates, API keys for all services
```

---

## Next Actions

### For Product Manager
1. Review [Executive Summary](./executive-summary.md)
2. Approve sprint priority (P0 for secureFiles, P1 for optimization)
3. Allocate 2-3 weeks for implementation

### For Tech Lead
1. Review [Technical Architecture](./technical-architecture.md)
2. Assign engineers to Phase 1 (secureFiles) and Phase 2 (optimization)
3. Schedule architecture review meeting

### For Engineer
1. Read [README](./README.md) for full context
2. Set up local environment for testing
3. Begin Phase 1 implementation (ComposeMerger)

### For QA
1. Review test scenarios in [README](./README.md)
2. Prepare staging environment for testing
3. Create test plan for secureFiles and build optimization

---

## Questions?

**Slack**: #bitbrat-dev
**Email**: architect@bitbrat.io
**Sprint Board**: Jira Sprint 375

**Document Author**: Claude Code (Architect Role)
**Last Updated**: 2026-07-30
