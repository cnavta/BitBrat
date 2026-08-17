# Implementation Plan: Redis BEC Generation Gaps

**Sprint**: sprint-2-8olsv2
**Owner**: @navta
**Status**: Planning
**Created**: 2026-08-07

---

## Executive Summary

**Problem**: New execution contexts created via `brat context create` or `agent_dev.provision()` are missing Redis configuration that was added in Sprint 1 for distributed idempotency.

**Impact**: New contexts will fail-open on idempotency (no duplicate detection), causing potential debug trace message re-delivery after platform re-deployments.

**Solution**: Update BEC generation tooling to automatically include Redis in environment variables, infrastructure detection, docker-compose volumes, and service dependencies.

**Effort**: 7-9.5 hours (1.5 days)
**Tasks**: 13 tasks across 4 phases

---

## Background

Sprint 1 (sprint-1-9ih2e3) successfully implemented Redis-based distributed idempotency for existing contexts (`local`, `staging`). However, the implementation was manual - Redis was added directly to those specific contexts without updating the BEC generation tooling.

**Current State**:
| Context Type | Redis Config | Redis Service | Redis Dependencies | Status |
|--------------|--------------|---------------|-------------------|--------|
| **local** (existing) | ❌ Missing | ✅ Manual | ❌ Missing | Partially Fixed |
| **staging** (existing) | ✅ Manual | ✅ Fixed (Sprint 1) | ✅ Fixed (Sprint 1) | Complete |
| **New contexts** | ❌ Missing | ❌ Missing | ❌ Missing | **BROKEN** |
| **agent-dev-\*** | ❌ Missing | ❌ Missing | ❌ Missing | **BROKEN** |

---

## Root Cause Analysis

### Gap 1: Environment Configuration Template
**File**: `tools/brat/src/commands/context/create.ts:230-280`
**Function**: `generateGlobalYaml()`
**Issue**: Redis environment variables not included in template

### Gap 2: Infrastructure Detection
**File**: `tools/brat/src/context/parse-dependencies.ts:150-185`
**Function**: `getRequiredInfrastructure()`
**Issue**: Redis not included in infrastructure set

### Gap 3: Volume Generation
**File**: `tools/brat/src/context/generate-docker-compose.ts:217-225`
**Function**: `generateDockerCompose()`
**Issue**: Redis data volume not created

### Gap 4: Service Dependency Injection
**File**: `tools/brat/src/context/parse-dependencies.ts:80-130`
**Function**: `parseServiceDependencies()`
**Issue**: Services using idempotency don't auto-add Redis to depends_on

---

## Solution Architecture

**Approach**: Conservative Enhancement - Always include Redis for docker-compose contexts (like nats).

**Rationale**:
1. Redis is lightweight (minimal overhead)
2. Idempotency is a platform-level feature (should be universal)
3. Services fail-open gracefully if they don't use it
4. Consistent infrastructure across all contexts
5. Future-proof (all services may eventually use idempotency)

**Scope**:
- ✅ Fix environment variable generation
- ✅ Fix infrastructure detection
- ✅ Fix volume generation
- ✅ Fix service dependency logic
- ✅ Update existing `local` context manually
- ✅ Validate with new test context
- ✅ Update agent-dev generation (reuses same code paths)
- ❌ Cloud Run contexts (out of scope - uses managed Redis)
- ❌ Kubernetes contexts (out of scope - different orchestration)

---

## Implementation Plan

### Phase 1: Code Fixes (2-3 hours)

#### Task 1: REDIS-BEC-001 - Add Redis config to generateGlobalYaml() [30 min]
**File**: `tools/brat/src/commands/context/create.ts`
**Changes**:
```typescript
// Add to config object in generateGlobalYaml():

// Redis Configuration (Sprint 1+: Distributed Idempotency Layer)
REDIS_URL: "redis://redis:6379",
REDIS_IDEMPOTENCY_ENABLED: true,
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300,
```

**Acceptance Criteria**:
- Generated global.yaml includes `REDIS_URL`
- Generated global.yaml includes `REDIS_IDEMPOTENCY_ENABLED`
- Generated global.yaml includes `REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS`
- Config values match staging reference implementation

---

#### Task 2: REDIS-BEC-002 - Add Redis to getRequiredInfrastructure() [15 min]
**File**: `tools/brat/src/context/parse-dependencies.ts`
**Changes**:
```typescript
// Add after infrastructure.add('nats'):

// Always need redis for idempotency (Sprint 1+)
infrastructure.add('redis');
```

**Acceptance Criteria**:
- `getRequiredInfrastructure()` returns Set including `'redis'`
- Redis included regardless of service dependencies
- Redis extraction works from `docker-compose.local.yaml`

---

#### Task 3: REDIS-BEC-003 - Add redis-data volume to generateDockerCompose() [15 min]
**File**: `tools/brat/src/context/generate-docker-compose.ts`
**Depends On**: REDIS-BEC-002
**Changes**:
```typescript
// Add after firebase-emulator volume block:

if (infrastructure.has('redis')) {
  config.volumes!['redis-data'] = {};
}
```

**Acceptance Criteria**:
- Generated docker-compose includes `redis-data` volume
- Volume added only when redis in infrastructure
- Volume definition matches staging reference

---

#### Task 4: REDIS-BEC-004 - Add Redis dependency to idempotency services [45 min]
**Files**:
- `tools/brat/src/context/parse-dependencies.ts` (parseServiceDependencies)
- `tools/brat/src/context/generate-docker-compose.ts` (generateServiceCompose)

**Depends On**: REDIS-BEC-002

**Approach**: Hardcode service list (Option A)
- Simple, explicit, no detection logic needed
- Must update when new services add idempotency
- Recommended for now

**Changes**:
```typescript
// In parseServiceDependencies():
const infraDeps = [...deps.infrastructure];

// Services using idempotency need redis
const idempotencyServices = ['ingress-egress', 'auth', 'llm-bot'];
if (idempotencyServices.includes(serviceName)) {
  if (!infraDeps.includes('redis')) {
    infraDeps.push('redis');
  }
}

return { ...deps, infrastructure: infraDeps };
```

**Acceptance Criteria**:
- `ingress-egress` depends_on includes `redis:condition:service_healthy`
- `auth` depends_on includes `redis:condition:service_healthy`
- `llm-bot` depends_on includes `redis:condition:service_healthy`
- Other services do NOT have redis dependency
- Redis starts before idempotency services

---

### Phase 2: Testing (3-4 hours)

#### Task 5: REDIS-BEC-005 - Unit tests for environment generation [45 min]
**File**: `tools/brat/src/commands/context/create.test.ts`
**Depends On**: REDIS-BEC-001

**Test Cases**:
1. generateGlobalYaml includes Redis config
2. Redis URL format is correct (`redis://redis:6379`)
3. Redis config consistent in local vs staging

**Acceptance Criteria**:
- All test cases pass
- 100% coverage for Redis config generation
- Tests fail if Redis config removed

---

#### Task 6: REDIS-BEC-006 - Unit tests for infrastructure detection [30 min]
**File**: `tools/brat/src/context/parse-dependencies.test.ts`
**Depends On**: REDIS-BEC-002

**Test Cases**:
1. getRequiredInfrastructure includes redis
2. Redis included regardless of service deps

**Acceptance Criteria**:
- All test cases pass
- Tests verify redis always present

---

#### Task 7: REDIS-BEC-007 - Unit tests for docker-compose generation [60 min]
**File**: `tools/brat/src/context/generate-docker-compose.test.ts`
**Depends On**: REDIS-BEC-003, REDIS-BEC-004

**Test Cases**:
1. Redis service included in compose
2. redis-data volume created
3. Idempotency services depend on redis
4. Non-idempotency services don't depend on redis

**Acceptance Criteria**:
- All test cases pass
- Tests validate complete Redis integration

---

#### Task 8: REDIS-BEC-008 - Integration test for new context creation [45 min]
**File**: `tools/brat/src/commands/context/create.integration.test.ts`
**Depends On**: REDIS-BEC-001, REDIS-BEC-002, REDIS-BEC-003, REDIS-BEC-004

**Test Scenario**:
1. Create test context: `brat context create test-redis-integration`
2. Validate env/test-redis-integration/global.yaml exists
3. Validate Redis config in global.yaml
4. Validate docker-compose.test-redis-integration.yaml exists
5. Validate Redis service in compose file
6. Validate redis-data volume in compose file
7. Validate service dependencies include redis
8. Start docker-compose stack
9. Verify redis container running and healthy
10. Deploy auth service
11. Verify redis started before auth
12. Cleanup test context

**Acceptance Criteria**:
- End-to-end test passes
- Test can be run in CI
- Test cleans up after itself

---

### Phase 3: Validation (1 hour)

#### Task 9: REDIS-BEC-009 - Manually validate new context creation [30 min]
**Depends On**: REDIS-BEC-001, REDIS-BEC-002, REDIS-BEC-003, REDIS-BEC-004

**Validation Steps**:
1. Create test context:
   ```bash
   brat context create test-redis-manual \
     --non-interactive \
     --type docker-compose \
     --persistence-driver postgres
   ```
2. Validate global.yaml: `grep REDIS env/test-redis-manual/global.yaml`
3. Validate compose file: `grep -A 10 'redis:' infrastructure/docker-compose/docker-compose.test-redis-manual.yaml`
4. Validate volume: `grep 'redis-data' infrastructure/docker-compose/docker-compose.test-redis-manual.yaml`
5. Start stack: `brat docker up --context test-redis-manual`
6. Verify Redis running: `docker ps | grep redis`
7. Test Redis connectivity: `docker exec <redis-container> redis-cli ping`
8. Deploy idempotency service: `brat bit deploy auth --context test-redis-manual`
9. Check idempotency logs: `docker logs <auth-container> | grep idempotency`
10. Cleanup

**Acceptance Criteria**:
- All validation steps pass
- Redis healthy and accessible
- Services start with Redis dependency satisfied
- No errors in logs

---

#### Task 10: REDIS-BEC-010 - Validate agent-dev provisioning includes Redis [30 min]
**Depends On**: REDIS-BEC-001, REDIS-BEC-002, REDIS-BEC-003, REDIS-BEC-004

**Validation Steps**:
1. Provision agent-dev: `agent_dev.provision()`
2. Check global.yaml: `grep REDIS env/agent-dev-*/global.yaml`
3. Check compose file: `grep redis infrastructure/docker-compose/docker-compose.agent-dev-*.yaml`
4. Start agent-dev: `agent_dev.start({ name: 'agent-dev-*' })`
5. Verify Redis: `docker ps | grep agent-dev | grep redis`
6. Cleanup: `agent_dev.destroy({ name: 'agent-dev-*', confirm: true })`

**Acceptance Criteria**:
- Agent-dev contexts include Redis
- Redis starts automatically with agent-dev stack
- Consistent behavior with manual context create

---

### Phase 4: Documentation (1-1.5 hours)

#### Task 11: REDIS-BEC-011 - Update local context with Redis config [15 min]
**File**: `env/local/global.yaml`

**Changes**:
```yaml
# Redis Configuration (Sprint 1+: Distributed Idempotency Layer)
REDIS_URL: "redis://redis:6379"
REDIS_IDEMPOTENCY_ENABLED: true
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300
```

**Note**: `infrastructure/docker-compose/docker-compose.local.yaml` already has Redis service (no change needed)

**Acceptance Criteria**:
- env/local/global.yaml includes Redis config
- Config matches staging and generated contexts
- Local deployment works with Redis

---

#### Task 12: REDIS-BEC-012 - Create Redis migration guide for custom contexts [45 min]
**Deliverable**: `documentation/guides/redis-migration.md`
**Depends On**: REDIS-BEC-009, REDIS-BEC-010

**Sections**:
1. Overview (Sprint 1 added Redis idempotency)
2. Affected Contexts (any context created before this sprint)
3. Migration Steps
   - Step 1: Add Redis config to global.yaml
   - Step 2: Add Redis service to docker-compose file
   - Step 3: Add redis-data volume
   - Step 4: Update service dependencies
   - Step 5: Restart and validate
4. Validation (Redis running, services start, idempotency active)
5. Troubleshooting (common errors and fixes)

**Acceptance Criteria**:
- Guide is comprehensive and actionable
- User can follow guide without asking questions
- Validation section confirms success

---

#### Task 13: REDIS-BEC-013 - Update CLAUDE.md with Redis BEC generation info [15 min]
**File**: `CLAUDE.md`
**Section**: "Execution Contexts"
**Depends On**: REDIS-BEC-012

**Changes**:
```markdown
**Redis Configuration (Sprint 1+)**:
- All new docker-compose contexts include Redis by default
- Used for distributed idempotency (message deduplication)
- Services: ingress-egress, auth, llm-bot depend on Redis
- For existing contexts, see documentation/guides/redis-migration.md
```

**Acceptance Criteria**:
- CLAUDE.md updated
- Clear explanation for LLM agents
- Link to migration guide

---

## Acceptance Criteria (Sprint-Level)

### Primary Criteria
1. **Environment Generation**: New contexts have Redis config in `env/*/global.yaml`
2. **Infrastructure Detection**: `getRequiredInfrastructure()` returns `redis` for docker-compose
3. **Volume Creation**: Generated docker-compose includes `redis-data` volume
4. **Service Dependencies**: Idempotency services depend on `redis:condition:service_healthy`

### Validation Criteria
1. **New Context Test**: Create test context, verify Redis config, start stack, verify healthy
2. **Agent-Dev Test**: Provision agent-dev, verify Redis included
3. **Deployment Test**: Deploy idempotency service, verify Redis starts first

### Success Metrics
1. **Coverage**: All new docker-compose contexts include Redis (100%)
2. **Consistency**: Redis config matches `staging` reference (100%)
3. **Tests**: All new generation tests pass (100%)
4. **Documentation**: Migration guide created and validated

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing contexts | Low | High | Only affects new contexts, existing unchanged |
| Redis not available | Low | Low | Services fail-open gracefully |
| Increased resource usage | Medium | Low | Redis lightweight (~50MB memory, 256MB limit) |
| Dependency cycle issues | Low | Medium | Redis has no dependencies, can't create cycle |
| Test coverage gaps | Medium | Medium | Comprehensive test coverage in Phase 2 |

---

## Dependencies & Constraints

**Dependencies**:
- ✅ Sprint 1 completed (Redis implementation exists)
- ✅ Existing BEC generation code stable
- ✅ Test infrastructure available

**Constraints**:
- Must not break existing contexts (backward compatibility)
- Must maintain platform-agnostic approach (Docker focus)
- Must follow existing BEC generation patterns

---

## Testing Strategy

### Unit Tests (Phase 2)
- `create.test.ts`: Environment generation includes Redis
- `parse-dependencies.test.ts`: Infrastructure detection includes Redis
- `generate-docker-compose.test.ts`: Compose generation includes Redis service, volume, dependencies

### Integration Tests (Phase 2)
- `create.integration.test.ts`: End-to-end context creation with Redis validation

### Manual Validation (Phase 3)
- Create test context and verify all components
- Provision agent-dev and verify Redis inclusion
- Deploy services and verify dependency satisfaction

---

## Migration Path for Existing Contexts

### Local Context (Task 11)
- Add Redis config to `env/local/global.yaml`
- No compose changes needed (already has Redis service)

### Custom Contexts (Task 12)
- Provide comprehensive migration guide
- Users can manually update their contexts
- Guide includes validation steps

---

## Deliverables

### Code Changes
1. `tools/brat/src/commands/context/create.ts` (generateGlobalYaml)
2. `tools/brat/src/context/parse-dependencies.ts` (getRequiredInfrastructure, parseServiceDependencies)
3. `tools/brat/src/context/generate-docker-compose.ts` (generateDockerCompose)
4. `env/local/global.yaml` (Redis config)

### Tests
1. `tools/brat/src/commands/context/create.test.ts` (environment generation)
2. `tools/brat/src/context/parse-dependencies.test.ts` (infrastructure detection)
3. `tools/brat/src/context/generate-docker-compose.test.ts` (compose generation)
4. `tools/brat/src/commands/context/create.integration.test.ts` (end-to-end)

### Documentation
1. `documentation/guides/redis-migration.md` (migration guide)
2. `CLAUDE.md` (execution contexts section update)

### Validation Artifacts
1. Validation script (create test context, verify all components)
2. Verification report (document validation results)

---

## Timeline

| Phase | Tasks | Effort | Duration |
|-------|-------|--------|----------|
| **Phase 1: Code Changes** | 4 fixes | 2-3 hours | 0.5 day |
| **Phase 2: Testing** | Unit + Integration | 3-4 hours | 0.5 day |
| **Phase 3: Validation** | Create test context, deploy | 1 hour | 0.25 day |
| **Phase 4: Documentation** | Migration guide, updates | 1-1.5 hours | 0.25 day |
| **Total** | 13 tasks | **7-9.5 hours** | **1.5 days** |

---

## Execution Strategy

### Recommended: Single Sprint (All 13 Tasks)
- Complete all phases in one sprint
- Ensures end-to-end validation before completion
- Total effort: 7-9.5 hours

### Alternative: Phased Approach (Two Sprints)
**Sprint 1**: Code Fixes + Unit Tests (Tasks 1-7, 5-6 hours)
**Sprint 2**: Validation + Documentation (Tasks 8-13, 2.5-3.5 hours)

**Decision**: Single sprint recommended for continuity and momentum.

---

## Rollback Plan

If issues arise:
1. Revert code changes (`git revert`)
2. New contexts won't have Redis (same as before fix)
3. Existing contexts unaffected
4. No data loss risk (only affects new context generation)

---

## References

- **Execution Plan**: `planning/backlog/redis-bec-generation-gaps-execution-plan.md`
- **YAML Backlog**: `planning/backlog/redis-bec-generation-gaps-backlog.yaml`
- **Sprint 1**: `planning/sprint-1-9ih2e3/` (Redis idempotency implementation)
- **Staging Reference**: `infrastructure/docker-compose/docker-compose.staging.yaml` (Redis service definition)

---

## Notes for Implementation

1. **Follow existing patterns**: Match style of nats, postgres infrastructure handling
2. **Comprehensive comments**: Explain Sprint 1 context in comments
3. **Test thoroughly**: All four code changes must work together
4. **Validate early**: Create test context after Phase 1 to catch issues
5. **Document clearly**: Migration guide must be actionable for users

---

**Status**: Ready for approval
**Next Step**: Get user approval to proceed with implementation
