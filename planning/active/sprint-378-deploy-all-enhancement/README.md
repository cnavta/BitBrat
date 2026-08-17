# Sprint 378: Deploy All Enhancement

**Status:** Ready for Execution
**Priority:** High
**Complexity:** Medium-High
**Duration:** 4 days (29 hours)

---

## Quick Start

### What is this sprint?

Fix the `brat bit deploy --all` command to process service-specific configuration (compose file merging and secureFiles) identically to single-service deployments.

### Why is it important?

**Current Problem:**
```bash
# Single service - WORKS ✅
brat bit deploy image-gen-mcp --context staging
→ GCP credentials mounted, service authenticates

# Bulk deployment - BROKEN ❌
brat bit deploy --all --context staging
→ No credentials, service fails
```

**Impact:** Services with secureFiles fail when deployed via `--all`, forcing users to deploy individually (slower, inconsistent).

---

## Sprint Documents

| Document | Purpose | Location |
|----------|---------|----------|
| **Execution Plan** | Day-by-day implementation guide with detailed tasks | `execution-plan.md` |
| **Backlog YAML** | Trackable task list with priorities, estimates, dependencies | `backlog.yaml` |
| **Issue Analysis** | Root cause analysis and solution options | `../deploy-all-env-vars-issue.md` |
| **Task Backlog** | Detailed task breakdown with implementation notes | `../deploy-all-enhancement-backlog.md` |

---

## Sprint Phases

### **Day 1: Analysis & Core Implementation** (8 hours)
**Goal:** Understand current flow and implement compose file merging

**Deliverables:**
- Design document with merge strategy
- Service-specific compose files collected and merged
- Comprehensive logging added

**Key Tasks:**
- 378-001: Understand current implementation
- 378-002: Design bulk merge strategy
- 378-003: Implement compose collection
- 378-004: Implement iterative merging
- 378-005: Implement secureFiles collection

---

### **Day 2: SecureFiles Processing** (8 hours)
**Goal:** Validate and process secureFiles for all services

**Deliverables:**
- SecureFiles validated for all services
- Files transferred to remote host (if SSH)
- Environment variables and volume mounts injected
- Temporary merged compose file handling

**Key Tasks:**
- 378-006: Remote file transfer
- 378-007: Environment variable extraction
- 378-008: SecureFiles injection
- 378-009: Temporary file handling
- 378-010: Update DockerOrchestrator
- 378-011: Error handling
- 378-012: Comprehensive logging

---

### **Day 3: Testing & Validation** (8 hours)
**Goal:** Comprehensive testing and staging validation

**Deliverables:**
- 10 unit tests passing
- 2 integration tests passing
- Staging validation complete
- Performance benchmark data

**Key Tasks:**
- 378-013: Unit tests for compose processing
- 378-014: Unit tests for secureFiles
- 378-015: Integration test - equivalence
- 378-016: Integration test - secureFiles
- 378-017: Staging validation
- 378-018: Performance benchmark

---

### **Day 4: Documentation & Release** (5 hours)
**Goal:** Complete documentation and create PR

**Deliverables:**
- Complete documentation set
- Full test suite passing
- PR created and ready for review

**Key Tasks:**
- 378-019: Deployment strategy docs
- 378-020: User guide updates
- 378-021: Troubleshooting guide
- 378-022: Migration guide
- 378-023: Full test suite
- 378-024: Commit changes
- 378-025: Create PR

---

## Success Criteria

### Functional
- ✅ deployAll() processes service-specific compose files
- ✅ deployAll() validates secureFiles
- ✅ deployAll() transfers files to remote host
- ✅ deployAll() injects environment variables and volume mounts
- ✅ Temporary file cleanup works

### Non-Functional
- ✅ Deployment time < 60 seconds (3 services)
- ✅ No breaking changes
- ✅ Full backward compatibility
- ✅ All tests passing

### Quality
- ✅ Test coverage > 90%
- ✅ No TypeScript errors
- ✅ No linting errors
- ✅ Code reviewed

---

## Key Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Deployment time (3 services) | 90s (individual) | 50s (bulk) |
| Code coverage | N/A | >90% |
| Breaking changes | N/A | 0 |
| Test count | 0 | 10+ |

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Compose merge conflicts | Medium | Medium | Lenient mode, last-wins |
| Performance degradation | Low | Medium | Early benchmark, optimize |
| Breaking deployments | Very Low | High | Staging validation |
| Remote transfer failures | Low | Medium | Reuse existing logic |

---

## Quick Reference

### Critical Path
```
Analysis → Design → Compose Collection → Merging → SecureFiles Collection →
Transfer → Injection → Orchestrator → Staging → Tests → Commit → PR
```

### Dependencies
- ComposeMerger (existing)
- SecureFilesValidator (Sprint 374)
- DockerOrchestrator (existing)
- EnvironmentResolver (existing)

### Rollback Plan
1. `git revert <commit-hash>`
2. Workaround: Deploy services individually
3. Root cause analysis and fix

---

## Getting Started

### Step 1: Review Documents
1. Read `execution-plan.md` for day-by-day breakdown
2. Review `backlog.yaml` for detailed task list
3. Check `../deploy-all-env-vars-issue.md` for context

### Step 2: Set Up Environment
1. Ensure staging environment accessible
2. Verify Docker and SSH access
3. Check test suite runs locally

### Step 3: Begin Implementation
1. Start with Task 378-001 (Day 1)
2. Follow execution plan day-by-day
3. Update task status in backlog.yaml
4. Mark todos as completed in TodoWrite

### Step 4: Validation Checklist
- [ ] All 25 tasks completed
- [ ] All tests passing (existing + new)
- [ ] Staging validation successful
- [ ] Performance maintained/improved
- [ ] Documentation complete
- [ ] Zero breaking changes

---

## Related Sprints

- **Sprint 374:** Secure Files Deployment (prerequisite)
- **Sprint 375:** Base Image Caching (related)
- **Sprint 377:** Long-Running Task Feedback (parallel work)

---

## Team

**Sprint Lead:** Claude (AI Assistant)
**Product Owner:** User
**Duration:** 4 working days
**Estimate:** 29 hours

---

## Notes

### What's Working
- Single-service deployments work perfectly
- SecureFiles validated and documented (Sprint 374)
- Compose merging logic exists (ComposeMerger)

### What's Broken
- Bulk deployment (`--all`) skips service-specific config
- SecureFiles not processed in bulk mode
- Environment variables missing in bulk mode

### What Will Change
- Enhanced `deployAll()` to process all config
- Identical behavior: single vs bulk
- Better performance than sequential deployment

---

**Document Created:** 2026-08-01
**Last Updated:** 2026-08-01
**Version:** 1.0
**Status:** ✅ Ready for Implementation
