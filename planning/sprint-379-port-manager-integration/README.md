# Sprint 379: PortManager Integration

**Sprint Goal:** Integrate PortManager into bulk deployments for automatic, conflict-free port assignment

**Duration:** 3 days
**Priority:** High
**Complexity:** Medium
**Risk:** Low

---

## Problem Statement

**Current State:**
- ✅ Single-service deployments (`brat bit deploy <service>`) use PortManager for automatic port assignment
- ❌ Bulk deployments (`brat bit deploy --all`) bypass PortManager entirely
- ⚠️ Port conflicts require manual intervention (--force-recreate or manual port config)

**Root Cause:**
When bulk deployments provide `options.composeFile` (merged compose file), the orchestrator sets `serviceFiles: []` (empty array). PortManager receives empty array and can't extract service names, so no port assignments are generated.

**Location of Gap:**
`tools/brat/src/orchestration/docker/orchestrator.ts` lines 71-78

```typescript
const composeFileSet = this.options.composeFile
  ? {
      baseFile: this.options.composeFile,
      serviceFiles: [],  // ← EMPTY for bulk deployments!
      targetService: undefined,
    }
  : this.composeFactory.getComposeFiles(...);
```

---

## Sprint Objectives

### Primary Objectives
1. ✅ Integrate PortManager into bulk deployment flow
2. ✅ Ensure consistent port assignment behavior (single vs bulk)
3. ✅ Maintain backward compatibility (no breaking changes)
4. ✅ Add comprehensive test coverage
5. ✅ Update documentation

### Success Criteria
- [ ] PortManager called for both single and bulk deployments
- [ ] Port conflicts automatically resolved in bulk mode
- [ ] All existing tests passing (no regressions)
- [ ] 10+ new unit tests for port assignment
- [ ] 2+ integration tests validating port conflict resolution
- [ ] Staging validation successful (all services healthy)
- [ ] Documentation updated with port assignment behavior

---

## Solution Approach

**Option 1: Pass Service Names to Orchestrator (RECOMMENDED)**

Modify bulk deployment to pass service names alongside merged compose file.

**Pros:**
- ✅ Minimal code changes (<50 lines)
- ✅ Backward compatible (no breaking changes)
- ✅ Reuses existing PortManager logic
- ✅ Low risk

**Cons:**
- ⚠️ Requires orchestrator interface change (add optional field)

**Files to Modify:**
1. `docker-compose-strategy.ts` - Add `allServiceNames` to orchestrator options
2. `orchestrator.ts` - Use `allServiceNames` when `composeFile` provided
3. Add unit tests
4. Add integration tests
5. Update documentation

---

## Implementation Phases

### Phase 1: Core Implementation (Day 1)
**Duration:** 8 hours

**Tasks:**
1. Extend DockerOrchestratorOptions interface
2. Modify deployAll() to pass service names
3. Update orchestrator.up() to use service names
4. Add comprehensive logging
5. Verify TypeScript compilation

**Deliverable:** PortManager integrated into bulk deployments

---

### Phase 2: Testing (Day 2)
**Duration:** 8 hours

**Tasks:**
1. Write unit tests for port assignment
2. Write integration tests for conflict resolution
3. Test remote deployment (SSH)
4. Test explicit port overrides
5. Run full test suite

**Deliverable:** 100% test coverage, all tests passing

---

### Phase 3: Validation & Documentation (Day 3)
**Duration:** 6 hours

**Tasks:**
1. Staging validation (deploy --all)
2. Performance benchmarking
3. Update deployment documentation
4. Create troubleshooting guide
5. Create PR and review

**Deliverable:** Staging validated, documentation complete, PR ready

---

## Risk Mitigation

### Risk 1: Breaking Existing Deployments
**Probability:** Low
**Impact:** High
**Mitigation:**
- Maintain backward compatibility
- Add orchestrator option as optional field
- Comprehensive testing before staging
- Rollback plan documented

### Risk 2: Performance Regression
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- Port discovery already happens in single-service mode
- Benchmark before/after
- Optimize if overhead > 2 seconds

### Risk 3: Remote Deployment (SSH) Issues
**Probability:** Medium
**Impact:** Medium
**Mitigation:**
- Test with staging (bitbrat.lan)
- Reuse existing remote port discovery logic
- Add SSH-specific tests

---

## Dependencies

**External Dependencies:** None

**Internal Dependencies:**
- ✅ PortManager (existing, battle-tested)
- ✅ DockerOrchestrator (existing)
- ✅ DockerComposeStrategy (Sprint 378 enhancements)

**Blocking Issues:** None

---

## Rollback Plan

If critical issues found:

1. **Immediate Rollback:**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Workaround:**
   Use explicit port configuration in env files (current state)

3. **Root Cause Analysis:**
   - Review staging logs
   - Identify failure mode
   - Fix and re-test

---

## Timeline

| Day | Phase | Hours | Key Deliverables |
|-----|-------|-------|------------------|
| 1 | Core Implementation | 8 | PortManager integrated into bulk deployments |
| 2 | Testing | 8 | 100% test coverage, all tests passing |
| 3 | Validation & Documentation | 6 | Staging validated, PR ready |
| **Total** | | **22** | **Feature complete** |

---

## Sprint Artifacts

### Planning Documents
- [x] README.md (this file)
- [ ] execution-plan.md (detailed task breakdown)
- [ ] backlog.yaml (trackable YAML format)

### Audit Results (Completed)
- [x] QUICK_REFERENCE.md
- [x] DEPLOYMENT_FLOWS_AUDIT.md
- [x] CODE_LOCATIONS.md

### Implementation Documents (To Create)
- [ ] implementation-notes.md
- [ ] test-plan.md

### Completion Documents (To Create)
- [ ] verification-report.md
- [ ] retro.md
- [ ] key-learnings.md

---

## References

**Related Sprints:**
- Sprint 378: Deploy All Enhancement (introduced bulk deployment)
- Sprint 374: Secure File Deployment

**Related Issues:**
- Bug #19: Bulk Deployment Missing PortManager Integration

**Related Documentation:**
- `planning/FUTURE-BACKLOG.md` - Item #1 (Document PortManager)
- `planning/audit-2025-08-01-deployment-flows/` - Audit results

---

**Sprint Status:** ⏳ **PLANNING**
**Branch:** TBD (will create `feat/sprint-379-port-manager-integration`)
**Created:** 2026-08-01
**Next Step:** Create execution plan and backlog
