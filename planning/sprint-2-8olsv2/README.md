# Sprint 2: Redis BEC Generation Gaps

**Sprint ID**: sprint-2-8olsv2
**Status**: Planning (awaiting approval)
**Owner**: @navta
**Created**: 2026-08-07
**Branch**: feature/sprint-2-8olsv2-redis-bec-generation-gaps-auto

---

## Quick Summary

**Problem**: New execution contexts created via `brat context create` or `agent_dev.provision()` are missing Redis configuration.

**Impact**: New contexts will fail-open on idempotency (no duplicate detection), causing potential debug trace message re-delivery.

**Solution**: Update BEC generation tooling to automatically include Redis in:
1. Environment variable generation
2. Infrastructure detection
3. Docker compose volumes
4. Service dependencies

**Effort**: 7-9.5 hours (1.5 days) | **Tasks**: 13 across 4 phases

---

## Sprint Artifacts

### Core Documents
- **[implementation-plan.md](./implementation-plan.md)** - Complete implementation plan with task breakdown
- **[request-log.md](./request-log.md)** - Sprint execution log
- **[sprint-manifest.yaml](./sprint-manifest.yaml)** - Sprint metadata

### Reference Materials (from backlog)
- **[reference-execution-plan.md](./reference-execution-plan.md)** - Original backlog execution plan
- **[reference-backlog.yaml](./reference-backlog.yaml)** - Original YAML task breakdown (13 tasks)

---

## Task Breakdown

### Phase 1: Code Fixes (2-3 hours)
- ✅ **REDIS-BEC-001**: Add Redis config to generateGlobalYaml() [30 min]
- ✅ **REDIS-BEC-002**: Add Redis to getRequiredInfrastructure() [15 min]
- ✅ **REDIS-BEC-003**: Add redis-data volume to generateDockerCompose() [15 min]
- ✅ **REDIS-BEC-004**: Add Redis dependency to idempotency services [45 min]

### Phase 2: Testing (3-4 hours)
- ✅ **REDIS-BEC-005**: Unit tests for environment generation [45 min]
- ✅ **REDIS-BEC-006**: Unit tests for infrastructure detection [30 min]
- ✅ **REDIS-BEC-007**: Unit tests for docker-compose generation [60 min]
- ✅ **REDIS-BEC-008**: Integration test for new context creation [45 min]

### Phase 3: Validation (1 hour)
- ✅ **REDIS-BEC-009**: Manually validate new context creation [30 min]
- ✅ **REDIS-BEC-010**: Validate agent-dev provisioning includes Redis [30 min]

### Phase 4: Documentation (1-1.5 hours)
- ✅ **REDIS-BEC-011**: Update local context with Redis config [15 min]
- ✅ **REDIS-BEC-012**: Create Redis migration guide for custom contexts [45 min]
- ✅ **REDIS-BEC-013**: Update CLAUDE.md with Redis BEC generation info [15 min]

---

## Key Files to Modify

### Code Changes
1. `tools/brat/src/commands/context/create.ts` (generateGlobalYaml)
2. `tools/brat/src/context/parse-dependencies.ts` (getRequiredInfrastructure, parseServiceDependencies)
3. `tools/brat/src/context/generate-docker-compose.ts` (generateDockerCompose)
4. `env/local/global.yaml` (Redis config)

### New Test Files
1. `tools/brat/src/commands/context/create.test.ts`
2. `tools/brat/src/context/parse-dependencies.test.ts`
3. `tools/brat/src/context/generate-docker-compose.test.ts`
4. `tools/brat/src/commands/context/create.integration.test.ts`

### Documentation
1. `documentation/guides/redis-migration.md` (new)
2. `CLAUDE.md` (update execution contexts section)

---

## Acceptance Criteria

### Code Generation
- [ ] New contexts include Redis config in `env/*/global.yaml`
- [ ] New contexts include Redis service in docker-compose
- [ ] New contexts include `redis-data` volume
- [ ] Idempotency services (ingress-egress, auth, llm-bot) depend on Redis

### Testing
- [ ] All unit tests pass (environment, infrastructure, compose generation)
- [ ] Integration test passes (end-to-end context creation)
- [ ] Manual validation succeeds (test context creation and deployment)
- [ ] Agent-dev validation succeeds (MCP provisioning)

### Documentation
- [ ] Local context updated with Redis config
- [ ] Migration guide created for custom contexts
- [ ] CLAUDE.md updated with Redis generation info

---

## Success Metrics

1. **Coverage**: 100% of new docker-compose contexts include Redis
2. **Consistency**: Redis config matches `staging` reference
3. **Tests**: 100% test pass rate
4. **Documentation**: Migration guide validated by manual test

---

## Related Work

- **Sprint 1** (sprint-1-9ih2e3): Redis-based distributed idempotency implementation
- **Backlog**: `planning/backlog/` (execution plan + YAML backlog)
- **Reference**: `infrastructure/docker-compose/docker-compose.staging.yaml` (Redis service definition)

---

## Next Steps

1. **Await approval** of implementation plan
2. **Update sprint status** to 'in-progress' (via MCP update-sprint-status)
3. **Begin Phase 1**: Code fixes (REDIS-BEC-001 through REDIS-BEC-004)
4. **Execute phases** 2-4 sequentially
5. **Validate deliverables** before completion
6. **Create PR** with all changes

---

**Status**: ⏳ Awaiting implementation approval
