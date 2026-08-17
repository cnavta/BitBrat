# Sprint 6 Execution Plan: Foundation & Production Migration

**Role**: Lead Implementor
**Sprint**: Sprint 6
**Duration**: 2 weeks (estimated)
**Focus**: Complete Phase 1 (Foundation) + Begin Phase 4 (Production Migration)
**Dependencies**: Sprint 5 completion (InfrastructureRegistry)

---

## Executive Summary

Sprint 6 completes the **foundation layer** that Sprint 5 skipped and begins **production migration** to architecture.yaml v2. This establishes the validation and tooling infrastructure needed for safe, scalable multi-environment deployments.

**Key Deliverables**:
1. JSON Schema for architecture.yaml v2 with automated validation
2. Configuration validation CLI (`brat config validate --schema v2`)
3. Migration validator CLI (`brat config migrate`)
4. Staging/production context migration to architecture.yaml v2
5. GCP provider implementation in InfrastructureRegistry

**Strategic Rationale**:
- **Foundation First**: Schema validation prevents misconfigurations before they reach production
- **Production Safety**: Migration validator ensures zero-downtime transitions
- **Multi-Cloud Ready**: GCP provider implementation proves portability of InfrastructureRegistry

---

## Sprint 5 Gap Analysis Summary

Based on the Sprint 4 roadmap vision, Sprint 5 delivered:
- ✅ **100% of Phase 2** (InfrastructureRegistry) - Complete
- ✅ **75% of Phase 3** (Docker Compose Generation) - Complete
- ❌ **0% of Phase 1** (Foundation/Validation) - Not started
- ❌ **0% of Phase 4** (Production Migration) - Not started

**Sprint 6 fills the gap** by completing Phase 1 (Foundation) and beginning Phase 4 (Production Migration).

---

## Execution Plan

### Phase 1: Schema & Validation (Week 1, Days 1-3)

#### Task Group 1.1: JSON Schema Definition
**Owner**: Platform Team
**Duration**: 2 days
**Priority**: P0 (Blocker for validation)

**Objectives**:
1. Create formal JSON Schema for architecture.yaml v2
2. Define validation rules for all sections (platform, infrastructure, executionContexts, services)
3. Add conditional validation (e.g., if service declares infrastructure dependency, provider must implement it)

**Deliverables**:
- `documentation/schemas/architecture.v2.json`
- Unit tests for schema validation edge cases
- Schema documentation with examples

**Acceptance Criteria**:
- [ ] Schema validates all Sprint 5 architecture.yaml examples
- [ ] Schema catches invalid configurations (missing providers, circular dependencies)
- [ ] Schema supports all providers (docker, gcp, aws, azure, k8s)
- [ ] 90%+ test coverage

**Technical Approach**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BitBrat Architecture.yaml v2",
  "type": "object",
  "required": ["platform", "infrastructure", "executionContexts", "services"],
  "properties": {
    "platform": {
      "type": "object",
      "required": ["infrastructure"],
      "properties": {
        "infrastructure": {
          "type": "object",
          "patternProperties": {
            "^[a-z-]+$": {
              "$ref": "#/definitions/platformCapability"
            }
          }
        }
      }
    },
    "infrastructure": {
      "type": "object",
      "patternProperties": {
        "^(docker|gcp|aws|azure|k8s)$": {
          "$ref": "#/definitions/provider"
        }
      }
    }
  },
  "definitions": {
    "platformCapability": {
      "type": "object",
      "properties": {
        "required": {"type": "boolean"},
        "config": {"type": "object"},
        "constraints": {"type": "object"},
        "intent": {
          "type": "array",
          "items": {"type": "string"}
        }
      }
    },
    "provider": {
      "type": "object",
      "patternProperties": {
        "^[a-z-]+$": {
          "$ref": "#/definitions/providerImplementation"
        }
      }
    }
  }
}
```

---

#### Task Group 1.2: Validation CLI
**Owner**: Platform Team
**Duration**: 1 day
**Priority**: P0 (Blocker for migration)

**Objectives**:
1. Implement `brat config validate --schema v2` command
2. Report validation errors with file paths and line numbers
3. Support `--json` output for CI/CD integration

**Deliverables**:
- `tools/brat/src/oclif-commands/config/validate.ts` (enhanced)
- CLI tests with valid/invalid configurations
- Error message templates

**Acceptance Criteria**:
- [ ] Validates architecture.yaml against JSON Schema
- [ ] Reports errors with context (file path, line number, field)
- [ ] Supports `--json` flag for machine-readable output
- [ ] Exit code 0 (valid) or 1 (invalid)

**Example Usage**:
```bash
$ brat config validate --schema v2

Validating architecture.yaml (v2 schema)
==========================================

✓ Platform infrastructure defined (3 capabilities)
✓ Docker provider implements all capabilities
✗ GCP provider missing 'caching' implementation

Errors (1):
  infrastructure.gcp: Missing required capability 'caching'
    File: architecture.yaml
    Line: 145
    Required by: platform.infrastructure.caching
    Solution: Add infrastructure.gcp.caching implementation

Validation Result: FAILED (1 error)
Exit Code: 1
```

---

### Phase 2: Migration Tooling (Week 1, Days 4-5)

#### Task Group 2.1: Migration Validator
**Owner**: Platform Team
**Duration**: 2 days
**Priority**: P1 (Required for safe migration)

**Objectives**:
1. Implement `brat config migrate` command
2. Detect v1 vs v2 schema automatically
3. Generate migration report with breaking changes
4. Support `--dry-run` mode (preview without mutation)

**Deliverables**:
- `tools/brat/src/oclif-commands/config/migrate.ts`
- Migration report template
- Before/after diff output

**Acceptance Criteria**:
- [ ] Detects v1 schema (hardcoded infrastructure patterns)
- [ ] Suggests v2 equivalents (declarative infrastructure)
- [ ] Reports breaking changes (removed fields, renamed sections)
- [ ] Supports `--dry-run` flag
- [ ] Generates machine-readable migration report (YAML/JSON)

**Example Output**:
```
$ brat config migrate --dry-run

Architecture.yaml Migration Report
===================================

Schema Version: v1 → v2

Breaking Changes (3):
  ✗ infrastructure.gcp.resources → infrastructure.gcp.{capability}
  ✗ services.llm-bot: Missing dependencies.infrastructure
  ✗ executionContexts.local: Missing infrastructure.provider

Recommended Actions:
  1. Add platform.infrastructure section with capabilities
  2. Add services.*.dependencies.infrastructure declarations
  3. Specify executionContexts.*.infrastructure.provider

Migration Path:
  - Update architecture.yaml (see migration-guide.md)
  - Run: brat config validate --schema v2
  - Deploy: brat deploy services --all --context local

Estimated Migration Time: 2-3 hours
Risk Level: Medium (requires service dependency review)
```

**Technical Detection Logic**:
```typescript
function detectSchemaVersion(arch: any): 'v1' | 'v2' {
  // v2 has platform.infrastructure
  if (arch.platform?.infrastructure) return 'v2';

  // v1 has infrastructure.gcp.resources
  if (arch.infrastructure?.gcp?.resources) return 'v1';

  // v2 has services.*.dependencies.infrastructure
  const hasInfraDeps = Object.values(arch.services || {}).some(
    (s: any) => Array.isArray(s.dependencies?.infrastructure)
  );
  if (hasInfraDeps) return 'v2';

  return 'v1'; // Default to v1 for backward compatibility
}
```

---

#### Task Group 2.2: Migration Documentation
**Owner**: Documentation Team
**Duration**: 0.5 days
**Priority**: P1

**Objectives**:
1. Document migration process with step-by-step guide
2. Provide before/after examples for common scenarios
3. Document rollback procedures

**Deliverables**:
- `planning/sprint-6-foundation/migration-workflow.md`
- Before/after migration examples
- Rollback procedure documentation

**Acceptance Criteria**:
- [ ] Step-by-step migration guide complete
- [ ] Examples for local, staging, prod contexts
- [ ] Rollback procedure documented
- [ ] Common issues and solutions documented

---

### Phase 3: Production Migration (Week 2, Days 1-4)

#### Task Group 3.1: Staging Context Migration
**Owner**: Platform Team + DevOps
**Duration**: 1 day
**Priority**: P1 (Production readiness)

**Objectives**:
1. Migrate `staging` context to architecture.yaml v2
2. Validate migration with `brat config validate --schema v2`
3. Test deployment in staging environment

**Deliverables**:
- Updated `architecture.yaml` with staging context in v2 schema
- Migration validation report
- Staging deployment test results

**Acceptance Criteria**:
- [ ] Staging context uses architecture.yaml v2 (platform.infrastructure, infrastructure.docker)
- [ ] All services declare infrastructure dependencies explicitly
- [ ] Staging deployment successful with v2 config
- [ ] All services healthy after deployment
- [ ] Rollback tested and documented

**Migration Checklist**:
```yaml
staging:
  - [ ] Add platform.infrastructure declarations
  - [ ] Define infrastructure.docker.{capability} implementations
  - [ ] Update executionContexts.staging.infrastructure.provider: docker
  - [ ] Add services.*.dependencies.infrastructure
  - [ ] Validate with JSON Schema
  - [ ] Deploy to staging
  - [ ] Verify all services healthy
  - [ ] Document any issues
```

---

#### Task Group 3.2: Production Context Migration
**Owner**: Platform Team + DevOps
**Duration**: 2 days
**Priority**: P1 (Critical - Production)

**Objectives**:
1. Migrate `prod` context to architecture.yaml v2
2. Use blue/green deployment for zero-downtime migration
3. Monitor production for 24 hours before decommissioning old environment

**Deliverables**:
- Updated `architecture.yaml` with prod context in v2 schema
- Blue/green deployment plan
- Production migration runbook
- Post-migration validation report

**Acceptance Criteria**:
- [ ] Prod context passes `brat config validate --schema v2`
- [ ] GCP provider infrastructure defined (pubsub, cloudsql, memorystore)
- [ ] Blue/green deployment successful
- [ ] All services healthy in new environment
- [ ] Old environment decommissioned after 24h monitoring
- [ ] Rollback plan documented and tested

**Blue/Green Deployment Plan**:
```
1. Preparation (Day 1):
   - Update architecture.yaml with prod v2 schema
   - Validate with schema validator
   - Create new GCP infrastructure (green)
   - Deploy services to green environment
   - Run smoke tests

2. Traffic Cutover (Day 2, Low-Traffic Window):
   - Update load balancer to route 10% to green
   - Monitor for 1 hour
   - Increase to 50% if healthy
   - Monitor for 1 hour
   - Increase to 100% if healthy

3. Monitoring Period (Day 2-3):
   - Monitor green environment for 24 hours
   - Keep blue environment online for rollback
   - Watch for errors, performance issues

4. Decommissioning (Day 3):
   - If no issues: decommission blue environment
   - If issues: rollback to blue, debug green
```

---

#### Task Group 3.3: GCP Provider Implementation
**Owner**: Cloud Infrastructure Team
**Duration**: 2 days
**Priority**: P2 (Production multi-cloud)

**Objectives**:
1. Implement GCP provider in InfrastructureRegistry
2. Support GCP capabilities (messaging: pubsub, persistence: cloudsql, caching: memorystore)
3. Add GCP-specific health checks

**Deliverables**:
- GCP provider implementation in `InfrastructureRegistry.getInfrastructureByCapability()`
- GCP health check strategies in `HealthGate`
- Unit tests for GCP provider
- Integration tests (if GCP test project available)

**Acceptance Criteria**:
- [ ] InfrastructureRegistry resolves GCP capabilities (messaging → pubsub, persistence → cloudsql)
- [ ] HealthGate validates GCP infrastructure readiness
- [ ] GCP provider tested with prod context
- [ ] Unit tests 90%+ coverage
- [ ] Documentation updated with GCP examples

**Example Implementation**:
```typescript
// In InfrastructureRegistry.getInfrastructureByCapability()
static getInfrastructureByCapability(
  repoRoot: string,
  context: string,
  capability: string
): InfrastructureSpec | null {
  const architecture = this.loadArchitecture(repoRoot);
  const executionContext = architecture.executionContexts![context];
  const providerName = executionContext.infrastructure?.provider;

  if (providerName === 'gcp') {
    const provider = architecture.infrastructure!.gcp;
    const gcpImpl = provider[capability] as GcpProviderImplementation;

    if (!gcpImpl) {
      throw new Error(`GCP provider does not implement capability "${capability}"`);
    }

    // Map to GCP-specific types
    const spec: InfrastructureSpec = {
      capability,
      provider: 'gcp',
      serviceName: gcpImpl.type, // 'pubsub', 'cloudsql', 'memorystore'
      type: gcpImpl.type,
      config: {
        ...platformCap.config,
        ...gcpImpl.config,
        ...executionContext.infrastructure?.[capability]?.config,
      },
      healthCheck: gcpImpl.healthCheck || this.defaultGcpHealthCheck(gcpImpl.type),
      intent: gcpImpl.intent,
    };

    return spec;
  }

  // ... existing docker provider logic
}

private static defaultGcpHealthCheck(type: string): HealthCheck {
  const healthChecks: Record<string, HealthCheck> = {
    pubsub: {
      test: ['gcloud', 'pubsub', 'topics', 'list', '--limit=1'],
      interval: '30s',
      timeout: '10s',
      retries: 3,
    },
    cloudsql: {
      test: ['gcloud', 'sql', 'instances', 'describe', '${INSTANCE_NAME}'],
      interval: '30s',
      timeout: '10s',
      retries: 3,
    },
    memorystore: {
      test: ['gcloud', 'redis', 'instances', 'describe', '${INSTANCE_NAME}'],
      interval: '30s',
      timeout: '10s',
      retries: 3,
    },
  };

  return healthChecks[type] || {
    test: ['echo', 'No health check defined'],
    interval: '30s',
    timeout: '10s',
    retries: 1,
  };
}
```

---

#### Task Group 3.4: Multi-Environment Validation
**Owner**: QA Team
**Duration**: 0.5 days
**Priority**: P1

**Objectives**:
1. Validate that all environments use architecture.yaml v2 consistently
2. Ensure same platform.infrastructure declarations across environments
3. Verify appropriate provider per context

**Deliverables**:
- Multi-environment validation report
- Consistency test suite

**Acceptance Criteria**:
- [ ] All contexts use same platform.infrastructure declarations
- [ ] Each context uses appropriate provider (local/staging: docker, prod: gcp)
- [ ] All contexts pass schema validation
- [ ] Service dependencies consistent across environments

---

### Phase 4: Cleanup & Documentation (Week 2, Day 5)

#### Task Group 4.1: Deprecation & Cleanup
**Owner**: Platform Team
**Duration**: 0.5 days
**Priority**: P2 (Technical debt)

**Objectives**:
1. Remove docker-compose.local.yaml (fully deprecated in Sprint 5)
2. Archive v1 architecture.yaml examples
3. Update all references to use v2 schema

**Deliverables**:
- Deleted `infrastructure/docker-compose/docker-compose.local.yaml`
- Updated documentation to remove v1 references
- Migration guide for any external dependencies

**Acceptance Criteria**:
- [ ] docker-compose.local.yaml removed
- [ ] All tests pass without docker-compose.local.yaml
- [ ] No references to v1 schema in active documentation
- [ ] Migration guide includes v1 → v2 transition notes

---

#### Task Group 4.2: Documentation Updates
**Owner**: Documentation Team
**Duration**: 0.5 days
**Priority**: P2 (Developer experience)

**Objectives**:
1. Update infrastructure-management.md with Schema v2 examples
2. Add GCP provider examples
3. Create troubleshooting guide for schema validation errors

**Deliverables**:
- Updated `documentation/architecture/infrastructure-management.md`
- GCP provider examples (pubsub, cloudsql, memorystore)
- Schema validation troubleshooting section

**Acceptance Criteria**:
- [ ] All examples use architecture.yaml v2 schema
- [ ] GCP provider examples documented
- [ ] Common validation errors documented with solutions
- [ ] Before/after migration examples included

---

#### Task Group 4.3: Archive v1 References
**Owner**: Documentation Team
**Duration**: 0.25 days
**Priority**: P3 (Nice-to-have)

**Objectives**:
1. Archive all v1 schema documentation to deprecated/ directory
2. Add clear deprecation notices with links to v2 equivalents

**Deliverables**:
- Moved v1 docs to `deprecated/architecture-v1/`
- Added deprecation notices with v2 links
- Updated all active docs to reference v2 only

**Acceptance Criteria**:
- [ ] No v1 references in active documentation
- [ ] v1 docs archived with deprecation notices
- [ ] Clear migration path from v1 → v2 documented

---

## Critical Path & Timeline

### Week 1 (Days 1-5)
```
Day 1-2: S6-F1.1 (JSON Schema Definition) [P0]
Day 3:   S6-F1.2 (Validation CLI) [P0]
Day 4-5: S6-M2.1 (Migration Validator) [P1]
         S6-M2.2 (Migration Docs) [P1, parallel]
         S6-P3.3 (GCP Provider) [P2, parallel]
```

### Week 2 (Days 1-5)
```
Day 1:   S6-P3.1 (Staging Migration) [P1]
         S6-P3.3 (GCP Provider cont.) [P2, parallel]
Day 2-3: S6-P3.2 (Production Migration) [P1]
Day 4:   S6-P3.4 (Multi-Env Validation) [P1]
Day 5:   S6-C4.1 (Cleanup) [P2]
         S6-C4.2 (Documentation) [P2, parallel]
         S6-C4.3 (Archive v1) [P3, optional]
```

**Critical Path**:
1. S6-F1.1 (JSON Schema) → S6-F1.2 (Validation CLI)
2. S6-F1.2 → S6-M2.1 (Migration CLI)
3. S6-M2.1 → S6-P3.1 (Staging Migration)
4. S6-P3.1 + S6-P3.3 (GCP Provider) → S6-P3.2 (Production Migration)
5. S6-P3.2 → S6-C4.1 (Cleanup) → S6-X5.1 (Verification)

**Total Duration**: 10.75 days (2 weeks with buffer)

---

## Risk Assessment & Mitigation

### Risk 1: Schema validation too strict
**Probability**: Medium
**Impact**: High
**Mitigation**:
- Validate schema against all Sprint 5 examples first
- Add schema override flag (`--skip-validation`) for edge cases
- Collect feedback from staging migration before production
**Owner**: Platform Team

### Risk 2: Production migration causes downtime
**Probability**: Low
**Impact**: Critical
**Mitigation**:
- Use blue/green deployment (zero-downtime)
- Test staging migration first
- Prepare rollback plan with tested procedure
- Monitor production for 24h before decommissioning old environment
**Owner**: DevOps Team

### Risk 3: GCP provider implementation incomplete
**Probability**: Medium
**Impact**: Medium
**Mitigation**:
- Start with minimal GCP capabilities (pubsub, cloudsql, memorystore)
- Add additional capabilities incrementally
- Use GCP test project for integration testing
- Document GCP provider limitations in known-issues.md
**Owner**: Cloud Infrastructure Team

### Risk 4: Migration tooling misses v1 patterns
**Probability**: Medium
**Impact**: Medium
**Mitigation**:
- Test migration validator with all known v1 examples
- Manual review of migration report before executing
- Dry-run mode mandatory for first migration
- Document manual verification checklist
**Owner**: Platform Team

### Risk 5: Schema changes break existing integrations
**Probability**: Low
**Impact**: Medium
**Mitigation**:
- Maintain backward compatibility with v1 (parallel support)
- Add deprecation warnings before breaking changes
- Provide migration period (1 sprint minimum)
- Test all integrations in staging before production
**Owner**: Integration Team

---

## Success Criteria

### Foundation
- [ ] JSON Schema validates all architecture.yaml v2 configurations
- [ ] Validation CLI catches invalid configurations before deployment
- [ ] Migration CLI generates accurate migration reports
- [ ] 90%+ test coverage for schema validation

### Production
- [ ] Staging context migrated to v2 with zero issues
- [ ] Production context migrated to v2 with zero downtime
- [ ] GCP provider fully functional in production
- [ ] All environments pass schema validation

### Quality
- [ ] No regressions in existing functionality
- [ ] All tests pass (unit, integration, e2e)
- [ ] Documentation complete and accurate
- [ ] Rollback plan tested and documented

### Adoption
- [ ] Team trained on v2 schema and validation
- [ ] Migration guide used successfully for staging/prod
- [ ] Schema validation integrated into CI/CD pipeline
- [ ] Zero schema-related production incidents

---

## Dependencies & Prerequisites

### External Dependencies
- Sprint 5 completion (InfrastructureRegistry)
- GCP test project access (for S6-P3.3)
- Production deployment window (for S6-P3.2)
- DevOps team availability (for migrations)

### Internal Dependencies
- Platform team capacity (5 days minimum)
- Documentation team capacity (2 days minimum)
- QA team capacity (1 day minimum)

### Infrastructure Dependencies
- Staging environment accessible
- Production blue/green deployment capability
- CI/CD pipeline configured for schema validation

---

## Team Allocation

### Platform Team (5 days)
- S6-F1.1: JSON Schema Definition (2 days)
- S6-F1.2: Validation CLI (1 day)
- S6-M2.1: Migration Validator (2 days)
- S6-P3.1: Staging Migration (1 day, with DevOps)
- S6-C4.1: Cleanup (0.5 days)

### Cloud Infrastructure Team (2 days)
- S6-P3.3: GCP Provider Implementation (2 days)

### DevOps Team (3 days)
- S6-P3.1: Staging Migration (1 day, with Platform)
- S6-P3.2: Production Migration (2 days, with Platform)

### Documentation Team (1.25 days)
- S6-M2.2: Migration Documentation (0.5 days)
- S6-C4.2: Documentation Updates (0.5 days)
- S6-C4.3: Archive v1 References (0.25 days)

### QA Team (0.5 days)
- S6-P3.4: Multi-Environment Validation (0.5 days)

---

## Communication Plan

### Daily Standup
- Progress on critical path tasks
- Blockers and dependencies
- Risk updates

### Weekly Review
- Phase completion status
- Test results and quality metrics
- Migration readiness assessment

### Stakeholder Updates
- **Week 1**: Foundation phase complete
- **Week 2**: Production migration status
- **Sprint End**: Verification report and retrospective

### Documentation
- Update `planning/sprint-6-foundation/request-log.md` daily
- Tag commits with `sprint-6` prefix
- Create PR for review before production migration

---

## Sprint Goals & Exit Criteria

### Primary Goals
- Complete Phase 1 (Foundation) - Schema & Validation
- Complete Phase 4 (Production Migration) - Staging & Prod

### Secondary Goals
- Implement GCP provider in InfrastructureRegistry
- Remove docker-compose.local.yaml (cleanup)

### Stretch Goals
- AWS provider scaffolding
- Kubernetes provider research

### Exit Criteria (Must Have)
- [ ] JSON Schema complete and tested
- [ ] Validation CLI functional
- [ ] Migration CLI functional
- [ ] Staging migrated to v2
- [ ] Production migrated to v2
- [ ] All tests passing
- [ ] Documentation updated

### Exit Criteria (Should Have)
- [ ] GCP provider implemented
- [ ] docker-compose.local.yaml removed
- [ ] Multi-environment validation complete

### Exit Criteria (Nice to Have)
- [ ] CI/CD schema validation integrated
- [ ] AWS provider scaffolded
- [ ] Schema validation dashboard

---

## Recommendations

### For Sprint Planning
1. **Assign S6-F1.1 (JSON Schema) to senior engineer** - Foundation work requires deep understanding
2. **Pair S6-P3.2 (Prod Migration) with DevOps** - Critical production change needs dual ownership
3. **Schedule production migration during low-traffic window** - Minimize risk of disruption
4. **Allocate buffer time (1 day)** for unexpected issues in production migration

### For Execution
1. **Start with foundation (S6-F1.1, S6-F1.2)** - Get validation working first
2. **Test migration CLI with real v1 examples** - Ensure accuracy before using in production
3. **Stage migration in controlled environment** - Validate process before production
4. **Use blue/green for production** - Zero-downtime deployment is critical

### For Quality
1. **Require schema validation in CI/CD** - Catch issues before deployment
2. **Manual review of migration reports** - Don't trust automation blindly
3. **Post-migration monitoring (24h minimum)** - Watch for unexpected behavior
4. **Document all production issues** - Build knowledge base for future migrations

---

## Conclusion

Sprint 6 completes the **foundation layer** that enables safe, scalable multi-environment deployments. By investing in schema validation and migration tooling upfront, we:

1. **Prevent misconfigurations** before they reach production
2. **Provide clear migration path** for existing deployments
3. **Establish quality gates** for future infrastructure changes
4. **Enable multi-cloud support** with GCP provider implementation

This positions BitBrat for **production-grade infrastructure management** with confidence in configuration correctness and deployment safety.

---

**Next Steps**:
1. Review and approve this execution plan
2. Assign tasks to team members
3. Schedule sprint planning meeting
4. Begin Sprint 6 work on 2026-08-11

---

**Document History**:
- Created: 2026-08-10
- Author: Lead Implementor (Claude Code)
- Sprint: 6
- Status: Proposed
