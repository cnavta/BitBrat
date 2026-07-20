# Sprint 352: Context Creation Automation - Implementation Plan

**Sprint Goal**: Make new execution contexts 100% functional upon creation by automating service configuration generation and data seeding.

**Duration**: 8-10 days
**Priority**: P0 - Critical Platform Infrastructure
**Lead Implementor**: Claude
**Sprint Start**: 2026-07-20

---

## Executive Summary

Sprint 351 revealed critical gaps in the context creation workflow. When creating the agent-dev context, **6 out of 18 services failed** due to missing configuration files and environment variables. Additionally, the PostgreSQL database was empty (no routing rules, personalities, or seed data), rendering the event router non-functional.

This sprint automates the entire post-context-creation workflow, eliminating **7+ manual configuration steps** and ensuring new contexts are production-ready immediately.

---

## Problem Statement

### Current State (Broken)
```
brat context create agent-dev
→ Creates env/agent-dev/global.yaml
→ Creates env/agent-dev/infra.yaml
→ Creates .secure.agent-dev

❌ Missing: 7 service-specific YAML files
❌ Missing: Environment variable defaults
❌ Missing: PostgreSQL seed data (routing_rules, personalities, context_packs)
❌ No validation of required environment variables
❌ Services fail on startup with "Missing required environment variables"
```

### Target State (Fixed)
```
brat context create agent-dev
→ Creates env/agent-dev/global.yaml (with DB passwords)
→ Creates env/agent-dev/infra.yaml
→ Creates .secure.agent-dev
✅ Auto-generates all service YAML files (llm-bot, persistence, ingress-egress, etc.)
✅ Populates intelligent defaults based on architecture.yaml
✅ Seeds PostgreSQL with routing rules, personalities, context packs
✅ Validates all required env vars present
✅ All services start successfully
✅ Event router functional (routing rules populated)
```

---

## Sprint 351 Audit Findings

### Critical Issues Discovered

1. **Service Configuration Gap**
   - **Impact**: 6 services failed (llm-bot, persistence, ingress-egress, disposition-service, query-analyzer, reflex, api-gateway)
   - **Root Cause**: `brat context create` only generates global.yaml and infra.yaml
   - **Manual Workaround**: Copy 7 files from env/local/ with manual adjustments
   - **Time Cost**: ~30 minutes per context

2. **PostgreSQL Password Interpolation Failure**
   - **Impact**: reflex service crashed with password authentication error
   - **Root Cause**: `${POSTGRES_PASSWORD}` placeholder not interpolated from .secure files
   - **Manual Workaround**: Hardcode password matching postgres container default
   - **Time Cost**: ~10 minutes debugging + fix

3. **No Configuration Validation**
   - **Impact**: Silent failures, container restart loops, difficult debugging
   - **Root Cause**: No cross-check between architecture.yaml requirements and generated configs
   - **Manual Workaround**: Check docker logs after deployment, trial-and-error debugging
   - **Time Cost**: ~20 minutes per missing variable

4. **Missing PostgreSQL Seed Data** (CRITICAL)
   - **Impact**: Empty routing_rules table → event router cannot route events → **system non-functional**
   - **Root Cause**: `brat setup` only seeds Firestore, not PostgreSQL
   - **Manual Workaround**: Manual SQL inserts or system unusable
   - **Time Cost**: Infinite (system doesn't work)

### Agent-Dev Database Audit
```sql
-- Populated (auto-created by migrations)
context_packs:     3 rows  ✅ (router.jsonlogic-guide, scheduler.guide, schema.internal-event-v2)
events:            5 rows  ✅ (startup events)
snapshots:        15 rows  ✅ (persistence snapshots)

-- MISSING (critical for functionality)
routing_rules:     0 rows  ❌ CRITICAL - event router non-functional
reflexes:          0 rows  ❌ reflex system inactive
personalities:     0 rows  ❌ no bot personalities
auth_users:        0 rows  ❌ no authenticated users
state:             0 rows  ❌ no initial state
```

---

## Implementation Strategy

### Phase-Based Delivery

**Phase 1: Critical Path (Days 1-3)** - P0
- Service config generation
- PostgreSQL seed data
- Basic validation
- **Deliverable**: New contexts work out-of-the-box

**Phase 2: Robustness (Days 4-6)** - P0
- Environment variable interpolation
- Comprehensive validation
- Context-aware defaults
- **Deliverable**: Configs are correct and validated

**Phase 3: Polish (Days 7-8)** - P1
- Migration tooling
- Documentation
- Testing
- **Deliverable**: Production-ready, well-documented

**Phase 4: Optional Enhancements (Days 9-10)** - P2
- Advanced features
- Nice-to-haves
- **Deliverable**: Enhanced DX

---

## Phase 1: Critical Path (Days 1-3)

### Goals
1. Auto-generate service YAML files during context create
2. Seed PostgreSQL with routing rules, personalities, context packs
3. New contexts fully functional on first `docker up`

### Epic 1: Service Config Generation
**Priority**: P0
**Estimate**: 12 hours / 2 days

**Story 1.1**: Parse architecture.yaml for Active Services (3 hours)
- Extract services with `active: true`
- Extract required `env` and `secrets` arrays per service
- Build service metadata map
- **Acceptance**: Accurate service metadata extracted

**Story 1.2**: Generate Service YAML Files with Defaults (4 hours)
- For each active service, create `env/{context}/{service}.yaml`
- Copy from `env/local/{service}.yaml` if exists (preferred)
- Generate from architecture.yaml if no template exists
- Apply intelligent defaults (PERSISTENCE_*, LLM_*, integration flags)
- **Acceptance**: All active services have config files

**Story 1.3**: Create Default Value Mapping Rules (3 hours)
- PERSISTENCE_* → standard persistence config
- *_ENABLED → false for dev/agent, true for prod
- *_TIMEOUT_MS → reasonable defaults
- LLM_BOT_* → sensible LLM defaults
- Database vars → match global.yaml
- External integrations → disabled for dev contexts
- **Acceptance**: Intelligent defaults for common patterns

**Story 1.4**: Context-Aware Configuration Adjustments (2 hours)
- Dev/agent-dev: disable external integrations
- Prod/staging: require explicit integration config
- Log levels appropriate per context
- **Acceptance**: Context-specific adjustments applied

### Epic 6: Unified Data Seeding (PostgreSQL + Firestore)
**Priority**: P0
**Estimate**: 14 hours / 2 days

**Story 6.1**: Create Persistence-Agnostic Seed Data Model (3 hours)
- Define SeedDataDefinition interface
- Port getInitialRoutingRules from setup.ts to common format
- Define types for routing rules, personalities, context packs, auth tokens
- Support bot name parameterization
- **Acceptance**: Common seed data format

**Story 6.2**: Implement PostgreSQL Seed Writer (4 hours)
- Generate INSERT statements for routing_rules, personalities, context_packs, api_tokens
- Handle JSONB columns correctly
- Support upsert (ON CONFLICT DO UPDATE)
- Transaction-based seeding (all-or-nothing)
- Idempotent (can run multiple times)
- **Acceptance**: PostgreSQL seeding working

**Story 6.3**: Implement Firestore Seed Writer (3 hours)
- Refactor existing setup.ts logic
- Write to Firestore collections
- Batch writes, merge mode
- Idempotent
- **Acceptance**: Firestore seeding working (backwards compat)

**Story 6.4**: Create Unified Seed Command (2 hours)
- CLI: `brat seed [--context {context}]`
- Auto-detect PERSISTENCE_DRIVER
- Route to PostgreSQL or Firestore writer
- Flags: --dry-run, --wipe, --bot-name
- **Acceptance**: brat seed command functional

**Story 6.5**: Integrate Seeding into Context Create (2 hours)
- Auto-seed after config files generated
- Optional --no-seed flag
- Handle failures gracefully
- **Acceptance**: Seeding automatic during context create

**Phase 1 Deliverable**:
```bash
brat context create test-context
# → Creates all service configs
# → Seeds routing_rules, personalities, context_packs
# → All services start successfully
# → Event router functional
```

---

## Phase 2: Robustness (Days 4-6)

### Epic 2: Environment Variable Interpolation
**Priority**: P1
**Estimate**: 8 hours / 1 day

**Story 2.3**: PostgreSQL Connection Configuration (2 hours)
- Ensure DATABASE_URL and POSTGRES_* vars consistent
- Works with both connection methods (URL vs individual params)
- **Acceptance**: Consistent database config

**Story 2.2**: Use Explicit Values (2 hours) [PREFERRED APPROACH]
- Dev contexts: `bitbrat_dev_password`
- Prod contexts: generate secure passwords
- Store in .secure.{context}
- Match postgres container defaults
- **Acceptance**: Explicit password values, no interpolation needed

### Epic 3: Configuration Validation
**Priority**: P0
**Estimate**: 10 hours / 1.5 days

**Story 3.1**: Create Config Validation Module (4 hours)
- Cross-check generated configs vs architecture.yaml requirements
- Report missing variables per service
- Validate value formats (URLs, booleans, numbers)
- Exit with error if critical vars missing
- **Acceptance**: Validation catches missing vars

**Story 3.2**: Integrate Validation into Context Create (2 hours)
- Run validation after config generation
- Fail creation if critical vars missing
- Optional --no-validate flag
- **Acceptance**: Automatic validation

**Story 3.3**: Create Standalone Validation Command (2 hours)
- CLI: `brat context validate {context}`
- Can validate all contexts (--all)
- Generates detailed report
- **Acceptance**: Standalone validation command

**Story 3.4**: Add Pre-Deployment Validation Check (2 hours)
- Run validation before `docker up` and `brat deploy`
- Fail early if config invalid
- Suggest fixes for common issues
- **Acceptance**: Pre-deployment validation

**Phase 2 Deliverable**:
```bash
brat context create test-context
# → All configs validated
# → Clear error messages if issues found
# → Passwords configured correctly

brat context validate test-context
# → Detailed validation report
# → Exit code indicates pass/fail
```

---

## Phase 3: Polish (Days 7-8)

### Epic 4: Testing & Documentation
**Priority**: P0
**Estimate**: 12 hours / 1.5 days

**Story 4.1**: Unit Tests for Config Generation (4 hours)
- Test parseActiveServices
- Test generateServiceConfigs
- Test default value rules
- Test context adjustments
- Coverage > 90%

**Story 4.2**: Integration Tests for Context Create (4 hours)
- End-to-end test of context creation
- Test deployment of created context
- Test service startup without env errors

**Story 4.3**: Update Documentation (3 hours)
- Update CLAUDE.md with new workflow
- Document default value rules
- Add troubleshooting section

**Story 4.4**: Create Validation Report (1 hour)
- Test all existing contexts (local, staging, agent-dev)
- Generate report of findings

### Epic 5: Backwards Compatibility & Migration
**Priority**: P0
**Estimate**: 6 hours / 1 day

**Story 5.1**: Preserve Existing Context Behavior (2 hours)
- Existing contexts unchanged
- New automation only for new contexts
- Optional --regenerate flag

**Story 5.2**: Create Migration Tool (3 hours)
- CLI: `brat context migrate {context}`
- Generates missing service files
- Preserves customizations
- Dry-run mode

**Story 5.3**: Test Migration on Agent-Dev (1 hour)
- Verify migration works
- Document results

---

## Phase 4: Optional Enhancements (Days 9-10) - P2

### Story 2.1: Implement Secret Interpolation (4 hours) [IF TIME PERMITS]
- Replace ${VAR} placeholders with values from .secure files
- Handle missing variables gracefully
- Secure handling (don't log secret values)

---

## Success Criteria

### Must-Have (Phase 1-3)
- ✅ `brat context create` generates all service YAML files
- ✅ All required env vars from architecture.yaml present
- ✅ Validation catches missing variables before deployment
- ✅ No manual config file creation needed
- ✅ Seed data automatically populated (routing_rules, personalities, context_packs)
- ✅ Works with both PostgreSQL and Firestore backends
- ✅ `brat seed` command functional
- ✅ Existing contexts unchanged (backwards compatible)
- ✅ All tests passing
- ✅ Documentation updated

### Nice-to-Have (Phase 4)
- Secret interpolation from .secure files
- Advanced migration features
- Detailed validation reports

---

## Risk Management

### Risk 1: Breaking Existing Contexts
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**: Only affect new contexts, comprehensive testing, backwards compat checks
- **Contingency**: Rollback mechanism, --no-auto-generate flag

### Risk 2: Seed Data Backend Divergence
- **Likelihood**: Medium
- **Impact**: Medium
- **Mitigation**: Single source of truth (seed data definitions), test both backends
- **Contingency**: Manual seeding if unified approach fails

### Risk 3: PostgreSQL Schema Mismatch
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**: Test against latest schema, validate JSONB structure
- **Contingency**: Update seed writer to match schema

### Risk 4: Incomplete Default Rules
- **Likelihood**: Medium
- **Impact**: Medium
- **Mitigation**: Copy from local as baseline, extensive testing
- **Contingency**: Document missing defaults, allow manual override

---

## Metrics & KPIs

### Automation Metrics
- **Manual Steps Eliminated**: 7+ per context creation
- **Time Saved**: ~60 minutes per new context
- **Error Rate**: 0% (down from ~33% service failure rate)
- **Automation Coverage**: 100% of active services

### Quality Metrics
- **Config Accuracy**: 100% (all required vars present)
- **Deployment Success Rate**: 100% (up from ~67%)
- **Test Coverage**: >90%
- **Validation Coverage**: 100% of required env vars

---

## Deliverables

### Code Artifacts
1. Enhanced `tools/brat/src/context/create.ts` with auto-generation
2. New `tools/brat/src/seeding/` module (seed data model, writers)
3. New `tools/brat/src/context/validate-config.ts` validation module
4. New `tools/brat/src/context/config-defaults.ts` default rules
5. Enhanced `tools/brat/src/cli/setup.ts` using unified seeding
6. New `tools/brat/src/cli/seed.ts` standalone seed command
7. New `tools/brat/src/context/migrate-command.ts` migration tool

### Documentation
1. Updated CLAUDE.md with new context creation workflow
2. New `documentation/guides/context-creation-guide.md`
3. Updated troubleshooting sections
4. Validation report for all contexts

### Testing
1. Unit tests for config generation (>90% coverage)
2. Integration tests for context create end-to-end
3. Validation tests for all context types

---

## Sprint Execution Timeline

```
Day 1-2: Epic 1 (Service Config Generation)
  ├─ Story 1.1: Parse architecture.yaml (3h)
  ├─ Story 1.2: Generate service YAMLs (4h)
  ├─ Story 1.3: Default value rules (3h)
  └─ Story 1.4: Context-aware adjustments (2h)

Day 2-3: Epic 6 (Unified Data Seeding)
  ├─ Story 6.1: Seed data model (3h)
  ├─ Story 6.2: PostgreSQL writer (4h)
  ├─ Story 6.3: Firestore writer (3h)
  ├─ Story 6.4: brat seed command (2h)
  └─ Story 6.5: Integrate into context create (2h)

Day 4: Epic 2 (Environment Variable Interpolation)
  ├─ Story 2.3: PostgreSQL config (2h)
  └─ Story 2.2: Explicit values (2h)

Day 4-6: Epic 3 (Configuration Validation)
  ├─ Story 3.1: Validation module (4h)
  ├─ Story 3.2: Integrate into context create (2h)
  ├─ Story 3.3: Standalone command (2h)
  └─ Story 3.4: Pre-deployment validation (2h)

Day 7-8: Epic 4 (Testing & Documentation)
  ├─ Story 4.1: Unit tests (4h)
  ├─ Story 4.2: Integration tests (4h)
  ├─ Story 4.3: Documentation (3h)
  └─ Story 4.4: Validation report (1h)

Day 8: Epic 5 (Backwards Compatibility)
  ├─ Story 5.1: Preserve existing behavior (2h)
  ├─ Story 5.2: Migration tool (3h)
  └─ Story 5.3: Test migration (1h)

Day 9-10: Optional Enhancements (if time permits)
  └─ Story 2.1: Secret interpolation (4h)
```

---

## Definition of Done

- [ ] All P0 stories complete and tested
- [ ] `brat context create` generates all service configs
- [ ] `brat seed` populates routing_rules, personalities, context_packs
- [ ] `brat context validate` catches missing env vars
- [ ] New contexts deploy successfully without manual intervention
- [ ] Event router functional in new contexts (routing rules populated)
- [ ] All tests passing (unit + integration)
- [ ] Documentation updated
- [ ] Existing contexts unchanged (backwards compatible)
- [ ] Code reviewed and merged to main
- [ ] Sprint retrospective complete

---

## Next Steps

1. Review and approve this implementation plan
2. Begin Phase 1: Service Config Generation (Epic 1, Story 1.1)
3. Track progress in backlog.yaml
4. Daily standups to assess progress and blockers

---

**Sprint Lead**: Claude (Lead Implementor)
**Approval Required**: User sign-off before beginning implementation
**Status**: ✅ Ready for execution
