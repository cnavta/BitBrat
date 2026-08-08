# Execution Plan: Redis BEC Generation Gaps

**Status**: Provisional
**Priority**: High
**Created**: 2026-08-07
**Related**: Sprint 1 (sprint-1-9ih2e3) - Redis-based distributed idempotency

---

## Problem Statement

Sprint 1 successfully implemented Redis-based distributed idempotency for existing execution contexts (local, staging). However, the **BEC (BitBrat Execution Context) generation tooling** does not automatically configure Redis when new contexts are created.

### Impact

Any new execution context created via:
- `brat context create <name>`
- `agent_dev.provision()` (agent-dev MCP tool)

Will be **missing Redis configuration entirely**, causing:
- ❌ Idempotency layer fails-open (no duplicate detection)
- ❌ Services start without Redis dependency
- ❌ Missing Redis container in docker-compose files
- ❌ Missing Redis environment variables
- ❌ Inconsistent behavior across contexts

### Current Status

| Context Type | Redis Config | Redis Service | Redis Dependencies | Status |
|--------------|--------------|---------------|-------------------|--------|
| **local** (existing) | ✅ Manual | ✅ Manual | ❌ Missing | Partially Fixed |
| **staging** (existing) | ✅ Manual | ✅ Fixed (Sprint 1) | ✅ Fixed (Sprint 1) | Complete |
| **New contexts** | ❌ Missing | ❌ Missing | ❌ Missing | **BROKEN** |
| **agent-dev-\*** | ❌ Missing | ❌ Missing | ❌ Missing | **BROKEN** |

---

## Root Cause Analysis

### Gap 1: Environment Configuration Template
**File**: `tools/brat/src/commands/context/create.ts`
**Function**: `generateGlobalYaml()`
**Issue**: Redis environment variables not included in template

```typescript
// Current: MISSING Redis config
export function generateGlobalYaml(contextName: string, contextConfig: any): string {
  const config: any = {
    NODE_ENV: contextName === 'local' ? 'development' : 'production',
    LOG_LEVEL: contextName === 'local' ? 'debug' : 'info',
    COMPOSE_PROJECT_NAME: `bitbrat-${contextName}`,
    MESSAGE_BUS_DRIVER: 'nats',
    NATS_URL: 'nats://nats:4222',
    // ... other config

    // ❌ MISSING:
    // REDIS_URL: "redis://redis:6379",
    // REDIS_IDEMPOTENCY_ENABLED: true,
    // REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300,
  };
}
```

### Gap 2: Infrastructure Detection
**File**: `tools/brat/src/context/parse-dependencies.ts`
**Function**: `getRequiredInfrastructure()`
**Issue**: Redis not included in infrastructure set

```typescript
// Current: MISSING redis detection
export function getRequiredInfrastructure(
  repoRoot: string,
  activeServices: ServiceMetadata[]
): Set<string> {
  const infrastructure = new Set<string>();

  infrastructure.add('nats');      // ✅ Always included
  // ... postgres detection
  // ... firebase detection
  infrastructure.add('nats-box');  // ✅ Always included

  // ❌ MISSING: infrastructure.add('redis');

  return infrastructure;
}
```

### Gap 3: Volume Generation
**File**: `tools/brat/src/context/generate-docker-compose.ts`
**Function**: `generateDockerCompose()`
**Issue**: Redis data volume not created

```typescript
// Current: MISSING redis-data volume
if (infrastructure.has('postgres')) {
  config.volumes!['postgres-data'] = {};
}
if (infrastructure.has('nats')) {
  config.volumes!['nats-data'] = {};
}
// ❌ MISSING:
// if (infrastructure.has('redis')) {
//   config.volumes!['redis-data'] = {};
// }
```

### Gap 4: Service Dependency Injection
**File**: `tools/brat/src/context/generate-docker-compose.ts`
**Function**: `generateServiceCompose()`
**Issue**: Services using idempotency don't auto-add Redis to depends_on

```typescript
// Current: Uses parseServiceDependencies() but doesn't detect Redis usage
const dependsOn: Record<string, { condition: string }> = {};

for (const infra of dependencies.infrastructure) {
  dependsOn[infra] = { condition: 'service_healthy' };
}

// ❌ MISSING: Logic to detect if service uses idempotency and add redis dependency
```

---

## Solution Architecture

### Approach: Conservative Enhancement

**Philosophy**: Add Redis to all new docker-compose contexts by default (like nats).

**Rationale**:
1. Redis is lightweight (minimal overhead)
2. Idempotency is a platform-level feature (should be universal)
3. Services fail-open gracefully if they don't use it
4. Consistent infrastructure across all contexts
5. Future-proof (all services may eventually use idempotency)

### Alternative Approach: Conditional Detection

**Philosophy**: Only include Redis if services explicitly use idempotency.

**Pros**: Leaner for contexts without idempotency
**Cons**:
- Complex detection logic
- Risk of missing services that might add idempotency later
- Inconsistent infrastructure across contexts

**Decision**: Use conservative approach (always include Redis for docker-compose).

---

## Implementation Scope

### In Scope
1. ✅ Fix environment variable generation (`generateGlobalYaml`)
2. ✅ Fix infrastructure detection (`getRequiredInfrastructure`)
3. ✅ Fix volume generation (`generateDockerCompose`)
4. ✅ Fix service dependency logic (`generateServiceCompose`)
5. ✅ Update existing `local` context manually
6. ✅ Validate with new test context
7. ✅ Update agent-dev generation (reuses same code paths)

### Out of Scope
1. ❌ Cloud Run contexts (no docker-compose, uses managed Redis)
2. ❌ Kubernetes contexts (different orchestration)
3. ❌ Retroactive fix for existing custom contexts (manual migration guide only)

---

## Acceptance Criteria

### Primary Criteria

1. **Environment Generation**
   - `brat context create test` generates `env/test/global.yaml` with Redis config
   - Config includes: `REDIS_URL`, `REDIS_IDEMPOTENCY_ENABLED`, `REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS`

2. **Infrastructure Detection**
   - `getRequiredInfrastructure()` returns `redis` for docker-compose contexts
   - Redis service included in generated docker-compose file

3. **Volume Creation**
   - `docker-compose.test.yaml` includes `redis-data` volume
   - Volume properly mapped in Redis service definition

4. **Service Dependencies**
   - Services using idempotency (ingress-egress, auth, llm-bot) have `redis: condition: service_healthy` in `depends_on`
   - Other services don't have Redis dependency (no unnecessary coupling)

### Validation Criteria

1. **New Context Test**
   ```bash
   brat context create test-redis --type docker-compose --persistence-driver postgres
   # Should generate:
   # - env/test-redis/global.yaml with Redis config
   # - docker-compose.test-redis.yaml with redis service
   # - All three idempotency services depend on redis
   ```

2. **Agent-Dev Test**
   ```bash
   # Via MCP tool
   agent_dev.provision()
   # Should generate agent-dev context with Redis infrastructure
   ```

3. **Deployment Test**
   ```bash
   brat docker up --context test-redis
   # Should start: redis, nats, postgres, services
   # Should show: redis healthy before idempotency services start
   ```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing contexts | Low | High | Only affects new contexts, existing are unchanged |
| Redis not available | Low | Low | Services fail-open gracefully |
| Increased resource usage | Medium | Low | Redis is lightweight (~50MB memory with 256MB limit) |
| Dependency cycle issues | Low | Medium | Redis has no dependencies, can't create cycle |
| Test coverage gaps | Medium | Medium | Add comprehensive test coverage for generation logic |

---

## Testing Strategy

### Unit Tests

**File**: `tools/brat/src/commands/context/create.test.ts`
- Test `generateGlobalYaml()` includes Redis config
- Test Redis config varies by context (local vs staging)

**File**: `tools/brat/src/context/parse-dependencies.test.ts`
- Test `getRequiredInfrastructure()` includes redis
- Test redis always included for docker-compose

**File**: `tools/brat/src/context/generate-docker-compose.test.ts`
- Test `generateDockerCompose()` includes redis service
- Test redis-data volume created
- Test idempotency services depend on redis

### Integration Tests

**Scenario 1: New Context Creation**
```bash
# Create test context
brat context create test-integration --non-interactive \
  --type docker-compose \
  --persistence-driver postgres

# Validate files generated
test -f env/test-integration/global.yaml
grep "REDIS_URL" env/test-integration/global.yaml
test -f infrastructure/docker-compose/docker-compose.test-integration.yaml
grep "redis:" infrastructure/docker-compose/docker-compose.test-integration.yaml
grep "redis-data:" infrastructure/docker-compose/docker-compose.test-integration.yaml

# Start and verify
brat docker up --context test-integration
docker ps | grep redis
docker exec <redis-container> redis-cli ping
```

**Scenario 2: Agent-Dev Provisioning**
```bash
# Provision agent-dev context
agent_dev.provision()

# Validate Redis included
grep "REDIS_URL" env/agent-dev-*/global.yaml
grep "redis:" infrastructure/docker-compose/docker-compose.agent-dev-*.yaml
```

**Scenario 3: Service Deployment**
```bash
# Deploy idempotency service
brat bit deploy auth --context test-integration

# Verify Redis started automatically
docker ps | grep redis
docker logs <auth-container> | grep "idempotency"
```

---

## Migration Path for Existing Contexts

### Manual Fix for `local` Context

**Add to `env/local/global.yaml`:**
```yaml
# Redis Configuration (Sprint 1+)
REDIS_URL: "redis://redis:6379"
REDIS_IDEMPOTENCY_ENABLED: true
REDIS_IDEMPOTENCY_DEFAULT_TTL_SECONDS: 300
```

**Update `docker-compose.local.yaml`** (already has Redis service, no change needed)

### Custom Contexts

Users with custom contexts created before this fix need to:
1. Add Redis config to `env/<context>/global.yaml`
2. Add Redis service to `infrastructure/docker-compose/docker-compose.<context>.yaml`
3. Add Redis dependencies to idempotency services

**Provide migration guide**: `documentation/guides/redis-migration.md`

---

## Success Metrics

1. **Coverage**: All new docker-compose contexts include Redis (100%)
2. **Consistency**: Redis config matches `staging` reference (100%)
3. **Tests**: All new generation tests pass (100%)
4. **Documentation**: Migration guide created and validated

---

## Timeline Estimate

| Phase | Tasks | Effort | Duration |
|-------|-------|--------|----------|
| **Phase 1: Code Changes** | 4 fixes | 2-3 hours | 0.5 day |
| **Phase 2: Testing** | Unit + Integration | 2-3 hours | 0.5 day |
| **Phase 3: Validation** | Create test context, deploy | 1 hour | 0.25 day |
| **Phase 4: Documentation** | Migration guide, updates | 1 hour | 0.25 day |
| **Total** | | 6-8 hours | **1.5 days** |

---

## Dependencies

- ✅ Sprint 1 completed (Redis implementation exists)
- ✅ Existing BEC generation code stable
- ✅ Test infrastructure available

---

## Rollback Plan

If issues arise:
1. Revert code changes (git revert)
2. New contexts won't have Redis (same as before fix)
3. Existing contexts unaffected
4. No data loss risk (only affects new context generation)

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Create sprint** from YAML backlog
3. **Assign priority** (recommend: High - blocks new context adoption)
4. **Schedule work** (recommend: Immediate follow-up to Sprint 1)

---

**Document Status**: Provisional
**Approval Required**: Yes
**Estimated Start**: Post Sprint 1 completion
