# Sprint 15: Deployment Lifecycle Hooks System

**Sprint ID**: sprint-15-gpcvez
**Status**: Planning → Ready for Approval
**Goal**: Implement deployment lifecycle hooks to enable private container registry authentication

---

## Sprint Artifacts

### Planning Documents
- ✅ **Technical Architecture** - `private-registry-auth-technical-architecture.md`
  - Problem analysis and solution design
  - Hook system architecture
  - Security considerations
  - Implementation recommendations

- ✅ **Execution Plan** - `execution-plan.md`
  - Detailed implementation plan
  - 5 phases with exit gates
  - Acceptance criteria (15 ACs)
  - Risk analysis and mitigations

- ✅ **Backlog** - `backlog.yaml`
  - 29 trackable tasks (BL-001 through BL-504)
  - Task dependencies and priorities
  - Status tracking and history

### Investigative Documents
- ✅ **Implementation Plan** - `implementation-plan.md`
  - Initial investigation findings
  - obs-mcp deployment issue analysis
  - `--all` and `--loki` flag behavior

- ✅ **Remote Docker Image Handling** - `remote-docker-image-handling.md`
  - How images are built/transferred in remote deployments
  - Build remote, not transfer local

---

## Quick Start

### Review Order

1. **Start here**: `private-registry-auth-technical-architecture.md`
   - Understand the problem and proposed solution
   - Review hook system design

2. **Then review**: `execution-plan.md`
   - Understand implementation approach
   - Review phases, acceptance criteria, risks

3. **Finally check**: `backlog.yaml`
   - Detailed task breakdown
   - Dependencies and sequencing

### Approval

When ready to proceed:
```
Approve execution plan and start implementation
```

---

## Problem Summary

**Issue**: obs-mcp service uses private Google Artifact Registry image. Remote deployments (SSH to staging) fail because remote Docker daemon lacks authentication credentials.

**Root Cause**: No mechanism to inject registry authentication before pulling images.

**Impact**:
- obs-mcp cannot deploy to staging
- Any future service using private images faces same issue
- Platform lacks deployment extensibility

---

## Solution Summary

**Deployment Lifecycle Hooks System**

A flexible, implementation-independent system that allows projects to inject custom logic at critical deployment stages:

| Hook Type | Execution Stage | Use Case |
|-----------|----------------|----------|
| `pre-deploy` | Before sync (remote) or build (local) | Registry auth, env validation |
| `post-deploy` | After containers start | Health checks, notifications |
| `pre-build` | Before `docker compose build` | Build-time auth, checks |
| `post-build` | After `docker compose build` | Image scanning, tagging |

**Key Features**:
- ✅ BEC-specific (different hooks per context)
- ✅ Implementation-independent (no hard-coded provider logic)
- ✅ Extensible (supports auth + future use cases)
- ✅ Backward compatible (hooks are optional)
- ✅ Secure (uses `.secure.{ENV}/` pattern)

---

## Implementation Phases

### Phase 0: Discovery and Baseline (4 tasks)
- Verify deployment flow
- Identify hook injection points
- Establish test baseline
- Validate schema approach

### Phase 1: Core Hook System (8 tasks)
- HookExecutor class
- TypeScript types (hooks + additionalSyncPaths)
- Schema validation (hooks + additionalSyncPaths)
- syncRemoteFiles() extension for additionalSyncPaths
- Unit tests (hooks + sync paths)

### Phase 2: Deployment Integration (5 tasks)
- Integrate all 4 hook types
- Integration tests
- Error handling

### Phase 3: obs-mcp Fix (5 tasks)
- GCP auth hook
- Configure staging context
- Test deployment
- Verify container health

### Phase 4: Examples & Docs (5 tasks)
- Example hooks (GCP, AWS, Azure, Docker Hub)
- Hook development guide
- Security best practices
- Update extending-bitbrat.md

### Phase V: Validation & Close-out (5 tasks)
- validate_deliverable.sh
- verification-report.md
- CHANGELOG.md
- PR creation
- Retro & learnings

**Total**: 33 tasks across 5 phases

---

## Deliverables

### Code (6 files)
- `tools/brat/src/orchestration/hooks/hook-executor.ts`
- `tools/brat/src/config/types.ts` (updated)
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts` (updated)
- `tools/brat/src/config/execution-context-schema.ts` (updated)
- `.brat/hooks/staging/pre-deploy-gcp-auth.sh`
- `architecture.yaml` (updated)

### Tests (2 files)
- `tools/brat/src/orchestration/hooks/hook-executor.test.ts`
- `tools/brat/src/orchestration/deployment/docker-compose-strategy-hooks.test.ts`

### Documentation (7 files)
- `documentation/guides/deployment-hooks.md`
- `documentation/guides/hook-security-best-practices.md`
- `documentation/guides/extending-bitbrat.md` (updated)
- `documentation/examples/hooks/*.sh` (6 example hooks)

### Sprint Artifacts (8 files)
- All planning documents (this README, execution plan, backlog, etc.)
- validate_deliverable.sh
- verification-report.md
- publication.yaml
- retro.md
- key-learnings.md

---

## Acceptance Criteria (15 ACs)

1. ✅ Hook System Infrastructure
2. ✅ Hook Integration
3. ✅ Hook Configuration
4. ✅ Hook Validation
5. ✅ Hook Environment
6. ✅ Hook Execution Logging
7. ✅ Hook Failure Handling
8. ✅ obs-mcp Deployment
9. ✅ Backward Compatibility
10. ✅ Example Hooks
11. ✅ Documentation
12. ✅ Tests
13. ✅ validate_deliverable.sh
14. ✅ verification-report.md
15. ✅ Publication

---

## Success Metrics

- **Primary**: obs-mcp deploys to staging successfully
- **Secondary**: Hook system documented and extensible
- **Tertiary**: No breaking changes (100% backward compatible)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Hook execution breaks existing deployments | Thorough backward compatibility testing |
| Security issues with hook scripts | Security guide, example hooks, validation |
| Remote hook execution fails | Clear error messages, SSH testing |
| GCP auth hook doesn't work | Test with actual service account key |

---

## Next Steps

**Owner Action Required**: Review and approve execution plan

**When approved**:
```bash
# Proceed with Phase 0
npm run build  # Verify baseline
npm test       # Establish test baseline
# Begin implementation of BL-001 (verify deployment flow)
```

---

## Support Documentation

### Related Files
- `CLAUDE.md` - BitBrat platform overview
- `AGENTS.md` - Sprint protocol
- `architecture.yaml` - System configuration

### Key References
- Docker Compose Strategy: `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- Docker Orchestrator: `tools/brat/src/orchestration/docker/orchestrator.ts`
- Execution Contexts: `architecture.yaml:1019-1094`

---

**Last Updated**: 2026-08-16
**Owner**: Lead Implementor
**Sprint Status**: Awaiting Approval
