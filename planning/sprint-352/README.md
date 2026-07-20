# Sprint 352: Context Creation Automation

**Status**: ✅ Ready for Execution
**Branch**: `feature/sprint-352-context-automation`
**Lead**: Claude (Lead Implementor)
**Start Date**: 2026-07-20
**Duration**: 8-10 days

---

## Sprint Goal

**Make new execution contexts 100% functional upon creation** by automating service configuration generation and data seeding.

Currently, creating a new context leaves it in a broken state:
- ❌ 6 out of 18 services fail with missing environment variables
- ❌ PostgreSQL database empty (no routing rules, personalities)
- ❌ Event router non-functional
- ❌ Requires ~60 minutes of manual configuration

After this sprint:
- ✅ All service configs auto-generated
- ✅ All environment variables populated
- ✅ Database seeded with routing rules, personalities, context packs
- ✅ All services start successfully
- ✅ Event router functional
- ✅ **Zero manual steps required**

---

## Sprint 351 Audit - Critical Findings

### Problem: Agent-Dev Context Deployment Failure

When deploying the agent-dev context after Sprint 351, we discovered:

1. **6 Services Failed** (out of 18 total)
   - llm-bot
   - persistence
   - ingress-egress
   - disposition-service
   - query-analyzer
   - reflex
   - api-gateway

2. **Root Cause**: Missing service-specific YAML configuration files
   - `brat context create` only generates `global.yaml` and `infra.yaml`
   - Each service needs its own config file (e.g., `llm-bot.yaml`, `persistence.yaml`)
   - Manual workaround: Copy 7 files from `env/local/` with context-specific adjustments

3. **PostgreSQL Database Empty** (CRITICAL)
   ```sql
   routing_rules:  0 rows  ❌ Event router cannot route events
   personalities:  0 rows  ❌ No bot personalities
   reflexes:       0 rows  ❌ Reflex system inactive
   ```
   - System non-functional without routing rules
   - `brat setup` only seeds Firestore, not PostgreSQL

4. **No Configuration Validation**
   - Silent failures, container restart loops
   - Difficult debugging (check docker logs manually)
   - Trial-and-error to find missing variables

5. **PostgreSQL Password Issues**
   - `${POSTGRES_PASSWORD}` placeholder not interpolated
   - reflex service failed with authentication error
   - Manual fix: Use explicit password values

---

## Implementation Plan

See [`implementation-plan.md`](./implementation-plan.md) for detailed execution strategy.

### Phase 1: Critical Path (Days 1-3) - P0
- **Epic 1**: Service Config Generation (12 hours)
  - Auto-generate service YAML files
  - Intelligent defaults based on architecture.yaml
  - Context-aware adjustments (dev/staging/prod)

- **Epic 6**: Unified Data Seeding (14 hours)
  - Persistence-agnostic seed data model
  - PostgreSQL seed writer
  - Firestore seed writer (backwards compat)
  - `brat seed` command
  - Auto-seed during context create

**Deliverable**: New contexts work out-of-the-box

### Phase 2: Robustness (Days 4-6) - P0
- **Epic 2**: Environment Variable Interpolation (8 hours)
  - Fix PostgreSQL password configuration
  - Use explicit values (simpler than interpolation)

- **Epic 3**: Configuration Validation (10 hours)
  - Validate configs against architecture.yaml
  - Pre-deployment validation
  - Clear error messages

**Deliverable**: Configs validated and correct

### Phase 3: Polish (Days 7-8) - P0
- **Epic 4**: Testing & Documentation (12 hours)
  - Unit tests (>90% coverage)
  - Integration tests
  - Update documentation

- **Epic 5**: Backwards Compatibility & Migration (6 hours)
  - Existing contexts unchanged
  - Migration tool for existing contexts

**Deliverable**: Production-ready, well-documented

---

## Trackable Backlog

See [`backlog.yaml`](./backlog.yaml) for detailed, trackable task list.

**Sprint Metrics**:
- **Total Stories**: 20
- **Total Estimate**: 62 hours / 8-10 days
- **P0 Stories**: 15 (48 hours)
- **P1 Stories**: 5 (14 hours)

**Key Stories**:
- S1.1: Parse architecture.yaml for Active Services (3h)
- S1.2: Generate Service YAML Files with Defaults (4h)
- S6.2: Implement PostgreSQL Seed Writer (4h) - **CRITICAL**
- S6.5: Integrate Seeding into Context Create (2h) - **CRITICAL**
- S3.1: Create Config Validation Module (4h)

---

## Success Criteria

### Must-Have (P0)
- ✅ `brat context create` generates all service YAML files
- ✅ All required env vars from architecture.yaml present
- ✅ Validation catches missing variables before deployment
- ✅ No manual config file creation needed
- ✅ Seed data automatically populated (routing_rules, personalities, context_packs)
- ✅ Works with both PostgreSQL and Firestore backends
- ✅ `brat seed` command functional
- ✅ Existing contexts unchanged (backwards compatible)
- ✅ All tests passing (>90% coverage)
- ✅ Documentation updated

### Nice-to-Have (P1-P2)
- Secret interpolation from .secure files
- Migration tool for existing contexts
- Advanced validation features

---

## Definition of Done

- [ ] All P0 stories complete and tested
- [ ] `brat context create` generates all service configs
- [ ] `brat seed` populates routing_rules, personalities, context_packs
- [ ] `brat context validate` catches missing env vars
- [ ] New contexts deploy successfully without manual intervention
- [ ] Event router functional in new contexts (routing rules populated)
- [ ] All tests passing (unit + integration, >90% coverage)
- [ ] Documentation updated (CLAUDE.md, guides)
- [ ] Existing contexts unchanged (backwards compatible)
- [ ] Code reviewed and merged to main
- [ ] Sprint retrospective complete

---

## Files Created

### Sprint Planning
- `planning/sprint-352/README.md` (this file)
- `planning/sprint-352/implementation-plan.md`
- `planning/sprint-352/backlog.yaml`

### Code (To Be Created During Sprint)
- `tools/brat/src/context/parse-services.ts`
- `tools/brat/src/context/generate-service-configs.ts`
- `tools/brat/src/context/config-defaults.ts`
- `tools/brat/src/context/context-profiles.ts`
- `tools/brat/src/context/validate-config.ts`
- `tools/brat/src/seeding/seed-data-types.ts`
- `tools/brat/src/seeding/seed-data-definitions.ts`
- `tools/brat/src/seeding/postgres-seed-writer.ts`
- `tools/brat/src/seeding/firestore-seed-writer.ts`
- `tools/brat/src/cli/seed.ts`
- `tools/brat/src/context/migrate-command.ts`

### Tests (To Be Created During Sprint)
- `tools/brat/src/context/__tests__/config-generation.test.ts`
- `tools/brat/src/context/__tests__/create-integration.test.ts`

### Documentation (To Be Created During Sprint)
- `documentation/guides/context-creation-guide.md`
- `planning/sprint-352/context-validation-report.md`
- `planning/sprint-352/agent-dev-migration-report.md`

---

## Risk Management

### Risk 1: Breaking Existing Contexts
- **Mitigation**: Only affect new contexts, backwards compatibility checks
- **Contingency**: Rollback, --no-auto-generate flag

### Risk 2: Seed Data Backend Divergence
- **Mitigation**: Single source of truth, test both backends
- **Contingency**: Manual seeding if unified approach fails

### Risk 3: PostgreSQL Schema Mismatch
- **Mitigation**: Test against latest schema, validate JSONB
- **Contingency**: Update seed writer to match schema

### Risk 4: Incomplete Default Rules
- **Mitigation**: Copy from local as baseline, extensive testing
- **Contingency**: Document missing defaults, manual override

---

## Metrics

### Automation Metrics
- **Manual Steps Eliminated**: 7+ per context creation
- **Time Saved**: ~60 minutes per new context
- **Error Rate**: Target 0% (down from ~33% service failure rate)
- **Automation Coverage**: 100% of active services

### Quality Metrics
- **Config Accuracy**: 100% (all required vars present)
- **Deployment Success Rate**: 100% (up from ~67%)
- **Test Coverage**: >90%
- **Validation Coverage**: 100% of required env vars

---

## Next Steps

1. ✅ Sprint planning complete (implementation plan + backlog created)
2. ✅ Branch created: `feature/sprint-352-context-automation`
3. **→ Awaiting approval to begin implementation**
4. **→ First task**: Story S1.1 - Parse architecture.yaml for Active Services

---

## Contact

**Lead Implementor**: Claude
**Sprint Tracking**: `planning/sprint-352/backlog.yaml`
**Questions**: Review implementation plan or backlog YAML
