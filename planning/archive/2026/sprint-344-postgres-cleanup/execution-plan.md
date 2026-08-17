# Sprint 344: PostgreSQL Migration Cleanup - Execution Plan

**Sprint ID:** 344
**Sprint Name:** PostgreSQL Migration Cleanup
**Created:** 2026-07-18
**Status:** Planning
**Lead Implementor:** Claude Code

## Executive Summary

Sprint 344 focuses on addressing critical dangling ends from the PostgreSQL migration (Sprint 343) and establishing PostgreSQL as the **default** persistence store for the BitBrat platform. This sprint ensures data integrity, fixes missing functionality, and updates all tooling, configurations, and defaults to reflect the new PostgreSQL-first architecture.

## Problem Statement

After the PostgreSQL migration in Sprint 343, three critical issues have been identified:

1. **Missing Personalities Table**: The `personalities` table was not included in the PostgreSQL migration schema, breaking personality resolution in the llm-bot service
2. **Empty prompt_logs Table**: Despite prompt logging being enabled, the `prompt_logs` table remains empty, indicating a runtime configuration or initialization issue
3. **Inconsistent Default Configuration**: PostgreSQL should be the default persistence driver, but production configs still lack `PERSISTENCE_DRIVER` settings

## Investigation Findings

### Issue 1: Missing Personalities Table

**Current State:**
- `infrastructure/postgres/init/02-create-tables.sql` contains 22 tables but no `personalities` table
- `src/services/llm-bot/processor.ts:624` queries Firestore for personalities:
  ```typescript
  const db = getFirestore();
  const snap = await db.collection('personalities')...
  ```
- The code uses `PERSONALITY_COLLECTION` config (default: 'personalities') but always queries Firestore directly

**Root Cause:**
- Personalities collection was never migrated to PostgreSQL schema
- Code hardcoded to use Firestore `getFirestore()` instead of using the document store abstraction

**Impact:**
- HIGH: Personality resolution silently fails when Firestore is unavailable in PostgreSQL-only environments
- Personality-driven prompts fall back to generic system prompts

### Issue 2: Empty prompt_logs Table

**Current State:**
- Table exists in schema: `infrastructure/postgres/init/02-create-tables.sql:217`
- Prompt logging is enabled in all environments:
  - `env/local/global.yaml:FF_LLM_PROMPT_LOGGING: true`
  - `env/staging/global.yaml:FF_LLM_PROMPT_LOGGING: true`
- Code attempts to log prompts:
  - `src/services/llm-bot/processor.ts:743`: `promptLogStore.log(...)`
  - `src/services/query-analyzer/llm-provider.ts:239`: `promptLogStore.log(...)`

**Root Cause:**
- `createPromptLogStore()` factory receives `undefined` for documentStore parameter
- Code path: `(server as any).getResource?.('firestore') || (server as any).getResource?.('documentStore')`
- When both resources are undefined, factory falls back to creating a Firestore-based store
- In PostgreSQL-only environments, Firestore may not be initialized, causing silent failures

**Impact:**
- MEDIUM: No prompt logs captured for debugging, compliance, or analysis
- Silent failures make debugging difficult

### Issue 3: PostgreSQL Not Default

**Current State:**
- `env/local/global.yaml`: `PERSISTENCE_DRIVER: postgres` ✓
- `env/staging/global.yaml`: `PERSISTENCE_DRIVER: postgres` ✓
- `env/dev/global.yaml`: Missing `PERSISTENCE_DRIVER` (defaults to firestore)
- `env/prod/global.yaml`: Missing `PERSISTENCE_DRIVER` (defaults to firestore)
- `src/common/persistence/factory.ts:28`: Hardcoded default is `'firestore'`

**Root Cause:**
- Factory default was never updated to reflect PostgreSQL-first architecture
- Production and dev configs not updated during Sprint 343

**Impact:**
- MEDIUM: New environments default to Firestore, creating inconsistency
- Documentation drift between stated defaults and actual behavior

## Goals

1. **Data Integrity**: Add `personalities` table to PostgreSQL schema with migration
2. **Functional Completeness**: Fix prompt logging to work with PostgreSQL
3. **Default Configuration**: Establish PostgreSQL as platform-wide default persistence driver
4. **Code Quality**: Remove Firestore hardcoding, use persistence abstraction consistently

## Success Criteria

- [ ] `personalities` table exists in PostgreSQL with appropriate indexes
- [ ] Personality resolution works end-to-end with PostgreSQL backend
- [ ] Prompt logs are successfully written to PostgreSQL `prompt_logs` table
- [ ] All environments (local, dev, staging, prod) explicitly set `PERSISTENCE_DRIVER=postgres`
- [ ] Factory default changed to `'postgres'` with deprecation notice for `'firestore'`
- [ ] All services use `getResource('documentStore')` instead of `getResource('firestore')`
- [ ] Integration tests validate personalities + prompt logging on PostgreSQL

## Implementation Plan

### Phase 1: Schema & Migration (Personalities Table)

**Objective:** Add missing `personalities` table to PostgreSQL schema

**Tasks:**
1. Create migration `009-add-personalities-table.sql` with:
   - Table definition matching Firestore `personalities` collection schema
   - Indexes: `name`, `status`, `version`, composite `(name, status, version DESC)`
   - JSONB data column for flexibility
2. Add personalities table to `02-create-tables.sql` (for new installations)
3. Test migration against local PostgreSQL instance
4. Document personality schema in `documentation/schemas/personality.v1.json`

**Files Modified:**
- `infrastructure/postgres/migrations/009-add-personalities-table.sql` (new)
- `infrastructure/postgres/init/02-create-tables.sql` (append table definition)
- `documentation/schemas/personality.v1.json` (new)

**Validation:**
- Migration runs without errors
- Table created with correct indexes
- Schema validated by `brat config validate`

### Phase 2: Persistence Abstraction (Document Store)

**Objective:** Replace hardcoded Firestore calls with document store abstraction

**Tasks:**
1. Update `src/services/llm-bot/processor.ts:624-629`:
   - Replace `getFirestore()` with document store from resources
   - Use `documentStore.query()` instead of Firestore `.collection().where()`
   - Support both Firestore and PostgreSQL backends via abstraction
2. Create `PersonalityStore` abstraction (similar to `ContextPackStore`):
   - Interface: `getByName(name: string): Promise<PersonalityDoc | undefined>`
   - Firestore implementation
   - PostgreSQL/DocumentStore implementation
   - Factory function with driver detection
3. Update processor to inject `PersonalityStore` via dependencies

**Files Modified:**
- `src/services/llm-bot/processor.ts` (refactor personality lookup)
- `src/services/llm-bot/personality-store.ts` (new abstraction)
- `src/apps/llm-bot-service.ts` (inject PersonalityStore)

**Validation:**
- Personality resolution works with `PERSISTENCE_DRIVER=postgres`
- Personality resolution works with `PERSISTENCE_DRIVER=firestore`
- Tests pass for both backends

### Phase 3: Prompt Logging Fix

**Objective:** Ensure prompt logs are written to PostgreSQL

**Tasks:**
1. Update `src/common/base-server.ts`:
   - Register `documentStore` resource in `initializeResources()`
   - Ensure documentStore is available via `getResource('documentStore')`
2. Update `src/services/llm-bot/processor.ts:743`:
   - Change resource lookup from `getResource('firestore') || getResource('documentStore')` to `getResource('documentStore')`
   - Add fallback to `createDocumentStore()` if resource missing
   - Log warning if documentStore unavailable
3. Update `src/services/query-analyzer/llm-provider.ts:220`:
   - Ensure `options.documentStore` is always provided by caller
   - Add validation/error handling if missing
4. Create integration test:
   - Validate prompt logs written to PostgreSQL
   - Verify log structure matches schema
   - Test with both llm-bot and query-analyzer

**Files Modified:**
- `src/common/base-server.ts` (register documentStore resource)
- `src/services/llm-bot/processor.ts` (fix resource access)
- `src/services/query-analyzer/llm-provider.ts` (add validation)
- `src/apps/llm-bot-service.ts` (pass documentStore to processor)
- `src/apps/query-analyzer-service.ts` (pass documentStore to provider)
- `test/integration/prompt-logging.spec.ts` (new)

**Validation:**
- Prompt logs written to `prompt_logs` table
- Logs include all required fields (correlationId, platform, model, etc.)
- Feature flag `FF_LLM_PROMPT_LOGGING=true` controls behavior
- No silent failures or unhandled errors

### Phase 4: Default Configuration Update

**Objective:** Establish PostgreSQL as platform-wide default

**Tasks:**
1. Update environment configs:
   - Add `PERSISTENCE_DRIVER: postgres` to `env/dev/global.yaml`
   - Add `PERSISTENCE_DRIVER: postgres` to `env/prod/global.yaml`
   - Verify `env/local/global.yaml` already has it
   - Verify `env/staging/global.yaml` already has it
2. Update factory default:
   - Change `src/common/persistence/factory.ts:28` from `'firestore'` to `'postgres'`
   - Add deprecation warning if `PERSISTENCE_DRIVER=firestore` detected
   - Update JSDoc to reflect new default
3. Update architecture.yaml:
   - Add `PERSISTENCE_DRIVER` to global defaults section
   - Document PostgreSQL as primary backend, Firestore as legacy
   - Update persistence.implementation from `cloud-firestore` to `postgres`
4. Update CLAUDE.md:
   - Reflect PostgreSQL-first architecture
   - Note Firestore as legacy/deprecated backend
   - Update common development patterns

**Files Modified:**
- `env/dev/global.yaml`
- `env/prod/global.yaml`
- `src/common/persistence/factory.ts`
- `architecture.yaml` (update persistence section)
- `CLAUDE.md` (update architecture guidance)

**Validation:**
- New services default to PostgreSQL without explicit config
- Warning logged when Firestore driver explicitly selected
- Architecture validation passes (`brat config validate`)
- All environments consistent

### Phase 5: Integration & Validation

**Objective:** End-to-end validation of all fixes

**Tasks:**
1. Create validation script:
   - Test personalities CRUD via PostgreSQL
   - Test prompt logging writes to PostgreSQL
   - Verify default driver is postgres
   - Check all tables exist and are accessible
2. Run local integration tests:
   - Start local stack with PostgreSQL
   - Seed personalities to PostgreSQL
   - Trigger llm-bot interaction
   - Verify personality applied and prompt logged
3. Update existing tests:
   - Fix any tests assuming Firestore default
   - Add PostgreSQL-specific test cases
   - Ensure test suite passes with `PERSISTENCE_DRIVER=postgres`
4. Documentation:
   - Update migration guide
   - Document personality schema
   - Update troubleshooting guide

**Files Modified:**
- `planning/sprint-344-postgres-cleanup/validate_deliverable.sh` (new)
- `test/integration/postgres-personalities.spec.ts` (new)
- `documentation/guides/postgres-migration.md` (update)
- `documentation/schemas/personality.v1.json` (new)

**Validation:**
- All tests pass with PostgreSQL backend
- Local stack runs without Firestore dependencies
- Validation script returns 0 exit code
- Documentation accurate and complete

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Personality migration breaks existing data | LOW | HIGH | Validate schema against Firestore exports; test on staging |
| Prompt logging fails silently | MEDIUM | MEDIUM | Add explicit error logging; create monitoring alerts |
| Services fail without Firestore | LOW | HIGH | Thorough integration testing; gradual rollout |
| Performance degradation | LOW | MEDIUM | Benchmark PostgreSQL vs Firestore; optimize indexes |

## Dependencies

- Sprint 343 (PostgreSQL Migration) must be completed
- PostgreSQL 15+ with pgvector extension installed
- Local development environment configured with PostgreSQL

## Rollout Plan

1. **Development (env/dev)**: Deploy and test all changes
2. **Local (env/local)**: Validate with local Docker stack
3. **Staging (env/staging)**: Full integration testing
4. **Production (env/prod)**: Deploy after 48h staging soak test

## Rollback Plan

If critical issues arise:
1. Revert `PERSISTENCE_DRIVER` to `firestore` in affected environment
2. Restart services to pick up config change
3. Investigate and fix root cause before retry
4. Personalities + prompt logs will fall back to Firestore seamlessly

## Timeline

- **Phase 1 (Schema)**: 2 hours
- **Phase 2 (Abstraction)**: 4 hours
- **Phase 3 (Prompt Logging)**: 3 hours
- **Phase 4 (Defaults)**: 2 hours
- **Phase 5 (Validation)**: 3 hours

**Total Estimated Effort:** 14 hours

## Notes

- This sprint focuses on **data integrity** and **consistency**, not new features
- Firestore remains supported as a legacy backend during transition period
- Future sprints should deprecate Firestore entirely (target: Sprint 350+)
- All personality data should be migrated from Firestore to PostgreSQL via tooling (not in scope for this sprint)

## References

- Sprint 343 Implementation Plan: `planning/sprint-343-postgres-migration/implementation-plan.md`
- PostgreSQL Schema: `infrastructure/postgres/init/02-create-tables.sql`
- Persistence Factory: `src/common/persistence/factory.ts`
- Prompt Log Store: `src/services/query-analyzer/llm-provider.ts`
- Personality Resolver: `src/services/llm-bot/personality-resolver.ts`
