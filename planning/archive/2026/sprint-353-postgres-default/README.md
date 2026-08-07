# Sprint 353: PostgreSQL Default Persistence

## Quick Reference

- **Sprint ID**: 353
- **Sprint Name**: PostgreSQL Default Persistence
- **Branch**: `feature/postgres-default-sprint`
- **Status**: In Progress
- **Start Date**: 2026-07-21
- **Estimated Duration**: 2-3 days
- **Lead Implementor**: Claude Code

## Objective

Systematically ensure PostgreSQL is the default persistence layer throughout the BitBrat codebase, eliminating all instances where Firestore is assumed or defaulted to when no explicit persistence driver is specified.

## Problem Statement

Despite PostgreSQL being designated as the default persistence layer in Sprint 344, the codebase still contains numerous locations where Firestore is assumed or hard-coded as the default:

1. **Docker Orchestrator** defaults to `firestore` when `PERSISTENCE_DRIVER` is unset
2. **Base Server** always initializes Firestore resources first, PostgreSQL conditionally
3. **11 Factory Functions** have misleading "Default to Firestore" comments
4. **5 Repository Factories** throw errors when using PostgreSQL without explicit DocumentStore
5. **19 Documentation Files** describe Firestore as the default backend

This creates confusion for developers and breaks the "platform-agnostic by default" principle.

## Success Criteria

### Quantitative
- ✅ 0 "Default to Firestore" comments in active code
- ✅ 100% of factory functions default to PostgreSQL
- ✅ 100% of services start with default config (no PERSISTENCE_DRIVER set)
- ✅ 0 Firestore errors in default setup logs
- ✅ >95% test coverage for default behavior

### Qualitative
- Fresh installation experience is smooth (no Firestore setup required)
- Documentation clearly reflects PostgreSQL as default, Firestore as legacy
- Developer mental model aligns with implementation
- Firestore migration path is well-documented for existing deployments

## Key Deliverables

### Critical Fixes (P0)
1. **Docker Orchestrator Default** (`tools/brat/src/orchestration/docker/orchestrator.ts:365`)
2. **Base Server Resource Init** (`src/common/base-server.ts:651-658`)

### High Priority (P1)
3. **Comment Updates** (11 files with "Default to Firestore")
4. **User Context PostgreSQL** Implementation
5. **User Documentation Updates** (quickstart, evaluating-bitbrat, seed-data, backup)
6. **Integration Tests** for default behavior

### Medium Priority (P2)
7. **Graceful Fallback Warnings** (4 services without PostgreSQL implementations)
8. **Deprecation Notices** on Firestore-specific docs

## Sprint Artifacts

- **[EXECUTION_PLAN.md](./EXECUTION_PLAN.md)** - Detailed implementation plan with phases, tasks, and testing strategies
- **[backlog.yaml](./backlog.yaml)** - Trackable YAML backlog with all tasks, priorities, and dependencies
- **[verification-report.md](./verification-report.md)** - *(To be created)* Sprint completion status and test results
- **[retro.md](./retro.md)** - *(To be created)* Retrospective and key learnings

## Timeline

### Day 1: Critical Fixes
- Fix Docker orchestrator default (1 hour)
- Fix base server resource initialization (2 hours)
- Update factory comments (1 hour)
- Initial testing (2 hours)

### Day 2: PostgreSQL Implementations
- Implement User Context PostgreSQL adapter (4 hours)
- Add graceful fallback warnings (2 hours)
- Integration testing (2 hours)

### Day 3: Documentation & Validation
- Update user documentation (2 hours)
- Add deprecation notices (1 hour)
- Create integration tests (2 hours)
- End-to-end validation (2 hours)
- Sprint artifacts (1 hour)

**Total Estimate**: 20 hours (2-3 days)

## Risk Management

### High-Risk Changes
1. **Base Server Resource Manager** (affects all services)
   - Mitigation: Comprehensive testing, gradual rollout
   - Rollback: Git revert + redeploy

2. **User Context PostgreSQL** (potential data loss)
   - Mitigation: Integration tests, migration script, backup
   - Rollback: Restore from backup, revert to Firestore

### Medium-Risk Changes
3. **Docker Orchestrator Default** (existing deployments)
   - Mitigation: Environment configs already set `PERSISTENCE_DRIVER`
   - Rollback: Update env configs to explicitly set `firestore`

## Dependencies

### Prerequisites
- PostgreSQL database (local or remote)
- Docker Compose (for testing)
- NATS message bus (for testing)
- Review Sprint 343 & 344 artifacts

### Blocking
None - this sprint is self-contained

### Blocked By
None - ready to start immediately

## Testing Strategy

### Unit Tests
- Factory default behavior tests
- Base server resource initialization tests

### Integration Tests
- E2E with default config (PostgreSQL)
- E2E with explicit Firestore config
- Service startup tests (all services)

### Manual Validation
- Fresh installation flow
- Migration from Firestore to PostgreSQL
- Rollback to Firestore (if needed)

## Notes

- This sprint builds on Sprint 343 (PostgreSQL Migration) and Sprint 344 (PostgreSQL Default)
- Focus is on systematic cleanup of Firestore assumptions, not new functionality
- All changes must maintain backward compatibility with `PERSISTENCE_DRIVER=firestore`
- Documentation updates are critical - many users rely on outdated docs
- Test coverage is essential - we're changing fundamental defaults

## Quick Start

```bash
# Create and checkout sprint branch
git checkout -b feature/postgres-default-sprint origin/main

# Review sprint artifacts
cat planning/sprint-353-postgres-default/EXECUTION_PLAN.md
cat planning/sprint-353-postgres-default/backlog.yaml

# Start with critical fixes (Phase 1)
# See EXECUTION_PLAN.md for detailed steps
```

## Contact

**Lead Implementor**: Claude Code
**Sprint Owner**: Product Owner
**Reviewers**: Technical Lead, Senior Engineers

---

**Last Updated**: 2026-07-21
