# Sprint 353: PostgreSQL Default Persistence - Execution Plan

## Sprint Overview

**Sprint ID**: 353
**Sprint Name**: PostgreSQL Default Persistence
**Branch**: `feature/postgres-default-sprint`
**Duration**: 2-3 days
**Lead Implementor**: Claude Code

### Objective

Systematically ensure PostgreSQL is the default persistence layer throughout the BitBrat codebase, eliminating all instances where Firestore is assumed or defaulted to when no explicit persistence driver is specified.

### Success Criteria

- [ ] All factory functions and services default to PostgreSQL when `PERSISTENCE_DRIVER` is unset
- [ ] Docker orchestrator defaults to PostgreSQL
- [ ] Base server initializes PostgreSQL DocumentStore by default, Firestore only when explicitly configured
- [ ] All "Default to Firestore" comments updated to reflect current architecture
- [ ] Services with incomplete PostgreSQL implementations either:
  - Have PostgreSQL implementations added, OR
  - Gracefully warn and fall back (with tracking issue created)
- [ ] Documentation reflects PostgreSQL as default, Firestore as legacy
- [ ] Integration tests validate default behavior

### Current State Analysis

**What Works (✅)**:
- `src/common/persistence/factory.ts` correctly defaults to `postgres` (Line 31)
- Environment configs (`env/local/`, `env/staging/`, `env/prod/`) all set `PERSISTENCE_DRIVER: postgres`
- PostgreSQL DocumentStore implementation is complete and tested

**What's Broken (❌)**:
- Docker orchestrator defaults to `firestore` (Line 365)
- Base server always initializes Firestore first, PostgreSQL conditionally
- 11 factory functions have misleading "Default to Firestore" comments
- 5 repository factories throw errors when `PERSISTENCE_DRIVER=postgres` without DocumentStore
- 19 documentation files describe Firestore as default

**Impact**:
- Fresh installations using `brat docker up` get Firestore by default
- New developers are confused by contradictory defaults
- Services crash when using the "default" configuration

---

## Phase 1: Critical Infrastructure Fixes

### Task 1.1: Fix Docker Orchestrator Default (P0 - CRITICAL)

**File**: `tools/brat/src/orchestration/docker/orchestrator.ts`
**Lines**: 365-366
**Complexity**: Trivial (1-line change)
**Risk**: Low (well-tested path)

**Change**:
```typescript
// BEFORE:
const persistenceDriver = env['PERSISTENCE_DRIVER'] || 'firestore'; // Default was firestore historically

// AFTER:
const persistenceDriver = env['PERSISTENCE_DRIVER'] || 'postgres'; // Default is postgres (Sprint 344)
```

**Testing**:
- Run `BITBRAT_CONTEXT=staging brat docker up` without setting `PERSISTENCE_DRIVER`
- Verify PostgreSQL is used (no Firestore initialization)
- Verify no GCP credentials are synced

**Acceptance Criteria**:
- Docker orchestrator logs show: `[brat] Skipping GCP credentials sync (PERSISTENCE_DRIVER=postgres, MESSAGE_BUS_DRIVER=nats do not require GCP)`
- Services connect to PostgreSQL successfully
- No Firestore errors in logs

---

### Task 1.2: Fix Base Server Resource Initialization Order (P0 - CRITICAL)

**File**: `src/common/base-server.ts`
**Lines**: 651-658
**Complexity**: Medium (conditional logic change)
**Risk**: Medium (affects all services)

**Change**:
```typescript
// BEFORE: Always init Firestore, conditionally init PostgreSQL
if (!isJest) {
  logger.debug('base_server.resources.firestore.init');
  defaults.firestore = new FirestoreManager();

  const persistenceDriver = process.env.PERSISTENCE_DRIVER;
  if (persistenceDriver === 'postgres' || persistenceDriver === 'postgresql') {
    logger.debug('base_server.resources.document_store.init', { driver: persistenceDriver });
    defaults.documentStore = new DocumentStoreManager();
  }
}

// AFTER: Init based on PERSISTENCE_DRIVER, default to PostgreSQL
if (!isJest) {
  const persistenceDriver = process.env.PERSISTENCE_DRIVER || 'postgres';

  if (persistenceDriver === 'postgres' || persistenceDriver === 'postgresql') {
    logger.debug('base_server.resources.document_store.init', { driver: persistenceDriver });
    defaults.documentStore = new DocumentStoreManager();
  } else if (persistenceDriver === 'firestore') {
    logger.debug('base_server.resources.firestore.init', { driver: persistenceDriver });
    defaults.firestore = new FirestoreManager();
  } else {
    logger.warn('base_server.resources.unknown_driver', { driver: persistenceDriver });
    throw new Error(`Unknown PERSISTENCE_DRIVER: ${persistenceDriver}. Expected: postgres, postgresql, or firestore`);
  }
}
```

**Testing**:
- Start all services with `PERSISTENCE_DRIVER` unset
- Verify only `document_store.init` logs appear
- Verify no `firestore.init` logs appear
- Start services with `PERSISTENCE_DRIVER=firestore`
- Verify only `firestore.init` logs appear

**Acceptance Criteria**:
- Default behavior (no env var) initializes DocumentStore only
- Firestore is ONLY initialized when explicitly set
- Invalid driver values throw clear error
- All existing services continue to work

---

## Phase 2: Factory Comment Updates

### Task 2.1: Update "Default to Firestore" Comments (P1 - HIGH)

**Files**: 11 repository factory files
**Complexity**: Trivial (comment changes only)
**Risk**: None (comments only)

**Files to Update**:
1. `src/services/scheduler/repository.ts:310`
2. `src/services/reflex/reflex-repository.ts:740`
3. `src/services/firestore-token-store.ts:179`
4. `src/services/oauth/auth-token-store.ts:205`
5. `src/services/auth/gateway-token-store.ts:273`
6. `src/services/llm-bot/user-context.ts:144`
7. `src/services/router/rule-loader.ts:392`
8. `src/apps/state-engine-repository.ts:283`
9. `src/apps/disposition-service.ts:131`
10. `src/services/api-gateway/auth.ts:151`
11. `src/services/query-analyzer/llm-provider.ts:136`

**Standard Replacement**:
```typescript
// BEFORE:
// Default to Firestore

// AFTER:
// Fallback to Firestore (legacy, deprecated - default is PostgreSQL via factory.ts)
```

**For test environment comments**:
```typescript
// BEFORE:
// Default to Firestore (for test environments where Firestore is not initialized)

// AFTER:
// Fallback to Firestore (legacy, deprecated - factory.ts defaults to PostgreSQL)
```

**Acceptance Criteria**:
- All 11 files updated
- No references to "Default to Firestore" remain in active code
- Comments accurately reflect that Firestore is a legacy fallback

---

## Phase 3: Handle Incomplete PostgreSQL Implementations

### Task 3.1: Implement PostgreSQL Adapter for User Context (P1 - HIGH)

**File**: `src/services/llm-bot/user-context.ts`
**Lines**: 131-144
**Complexity**: Medium (new adapter implementation)
**Risk**: Medium (affects LLM bot functionality)

**Current Issue**: Throws error when `PERSISTENCE_DRIVER=postgres` without DocumentStore

**Implementation**:
```typescript
// Add new class: DocumentStoreUserContextStore
export class DocumentStoreUserContextStore implements IUserContextStore {
  constructor(private readonly store: IDocumentStore) {}

  async get(userId: string, contextKey: string): Promise<any | null> {
    const docPath = `user_context/${userId}/${contextKey}`;
    const data = await this.store.get(docPath);
    return data || null;
  }

  async set(userId: string, contextKey: string, data: any): Promise<void> {
    const docPath = `user_context/${userId}/${contextKey}`;
    await this.store.set(docPath, data);
  }

  async delete(userId: string, contextKey: string): Promise<void> {
    const docPath = `user_context/${userId}/${contextKey}`;
    await this.store.delete(docPath);
  }
}

// Update createUserContextStore factory
export function createUserContextStore(dbOrStore?: any): IUserContextStore {
  // Check if IDocumentStore (PostgreSQL)
  if (dbOrStore && typeof dbOrStore.get === 'function' && typeof dbOrStore.set === 'function') {
    return new DocumentStoreUserContextStore(dbOrStore);
  }

  // Check if Firestore
  if (dbOrStore && typeof dbOrStore.collection === 'function') {
    return new FirestoreUserContextStore(dbOrStore);
  }

  // Auto-select based on PERSISTENCE_DRIVER
  const driver = process.env.PERSISTENCE_DRIVER || 'postgres';
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreUserContextStore(store);
  }

  // Fallback to Firestore (legacy, deprecated)
  return new FirestoreUserContextStore(undefined as any);
}
```

**Testing**:
- Create integration test: `src/services/llm-bot/__tests__/user-context-postgres.spec.ts`
- Verify CRUD operations work with PostgreSQL DocumentStore
- Verify migration path from Firestore to PostgreSQL

**Acceptance Criteria**:
- User context operations work with PostgreSQL
- LLM bot starts successfully with default config
- Integration tests pass for both Firestore and PostgreSQL

---

### Task 3.2: Add Graceful Fallback for Incomplete Implementations (P2 - MEDIUM)

**Files**: 4 repository factories without PostgreSQL implementations
**Complexity**: Low (warning messages)
**Risk**: Low (temporary solution)

**Files to Update**:
1. `src/services/story-engine/repository.ts:214`
2. `src/services/stream-analyst/repository.ts:214`
3. `src/services/query-analyzer/llm-provider.ts:131`
4. `src/services/persistence/repository.ts:308`

**Pattern**:
```typescript
export function createXxxRepository(dbOrStore?: any): IXxxRepository {
  // Check if IDocumentStore (PostgreSQL)
  if (dbOrStore && typeof dbOrStore.get === 'function') {
    const driver = process.env.PERSISTENCE_DRIVER || 'postgres';
    console.warn(
      `[xxx-repository] PostgreSQL persistence not yet implemented. ` +
      `Falling back to Firestore. Track implementation: https://github.com/.../issues/XXX`
    );
    // Fall through to Firestore
  }

  // Fallback to Firestore (legacy, will be PostgreSQL when implementation complete)
  // TODO: Implement PostgreSQL adapter (see Task 3.1 for reference)
  return new FirestoreXxxRepository(dbOrStore);
}
```

**Create Tracking Issues**:
- Document incomplete implementations in `documentation/migrations/postgres-migration-gaps.md`
- Create GitHub issues for each missing implementation
- Link issues in warning messages

**Acceptance Criteria**:
- Services start successfully with default config (no crashes)
- Clear warnings logged when fallback occurs
- Tracking documentation created
- GitHub issues created and referenced

---

## Phase 4: Documentation Updates

### Task 4.1: Update High-Impact User Documentation (P1 - HIGH)

**Files**: 4 user-facing documentation files
**Complexity**: Medium (content updates)
**Risk**: Low (docs only)

**Files to Update**:
1. `documentation/getting-started/quickstart.md`
2. `documentation/getting-started/evaluating-bitbrat.md`
3. `documentation/guides/seed-data.md`
4. `documentation/guides/backup-and-migration.md`

**Changes Required**:

1. Replace "default Firestore" with "default PostgreSQL"
2. Add "Firestore (legacy)" qualifiers
3. Update environment variable examples:
   ```bash
   # BEFORE:
   PERSISTENCE_DRIVER=firestore  # Default

   # AFTER:
   PERSISTENCE_DRIVER=postgres   # Default (platform-agnostic)
   # PERSISTENCE_DRIVER=firestore # Legacy (GCP-specific, deprecated)
   ```

4. Update setup instructions to prioritize PostgreSQL

**Acceptance Criteria**:
- All references to "default Firestore" removed
- PostgreSQL described as default/recommended
- Firestore marked as legacy/deprecated
- Setup instructions work with default config

---

### Task 4.2: Add Deprecation Notices to Firestore-Specific Docs (P2 - MEDIUM)

**Files**: 10 Firestore-specific documentation files
**Complexity**: Low (banner addition)
**Risk**: None

**Standard Deprecation Banner**:
```markdown
> **DEPRECATED - LEGACY BACKEND**
>
> This document describes Firestore which is **legacy** and supported for existing deployments only.
>
> **Default:** BitBrat now uses PostgreSQL (platform-agnostic). See [PostgreSQL Migration Guide](../guides/postgres-migration.md).
>
> **Migration Path:** Existing Firestore deployments can continue using Firestore by explicitly setting `PERSISTENCE_DRIVER=firestore`.
```

**Files**:
1. `documentation/reference/twitch-token-storage-firestore.md`
2. `documentation/reference/firestore-oauth-token-storage.md`
3. `documentation/migrations/*.md` (10 files)

**Acceptance Criteria**:
- All Firestore-specific docs have deprecation banner
- Migration path clearly documented
- Links to PostgreSQL guides provided

---

## Phase 5: Test Coverage

### Task 5.1: Add Integration Tests for Default Behavior (P1 - HIGH)

**New Files**:
1. `src/common/persistence/factory.test.ts`
2. `tools/brat/src/orchestration/docker/orchestrator.default.spec.ts`

**Test Coverage**:

**factory.test.ts**:
```typescript
describe('createDocumentStore default behavior', () => {
  it('defaults to PostgreSQL when PERSISTENCE_DRIVER is unset', () => {
    delete process.env.PERSISTENCE_DRIVER;
    const store = createDocumentStore();
    expect(store.constructor.name).toBe('PostgresDocumentStore');
  });

  it('uses PostgreSQL when PERSISTENCE_DRIVER=postgres', () => {
    process.env.PERSISTENCE_DRIVER = 'postgres';
    const store = createDocumentStore();
    expect(store.constructor.name).toBe('PostgresDocumentStore');
  });

  it('uses Firestore when PERSISTENCE_DRIVER=firestore', () => {
    process.env.PERSISTENCE_DRIVER = 'firestore';
    const store = createDocumentStore();
    expect(store.constructor.name).toBe('FirestoreDocumentStore');
  });
});
```

**orchestrator.default.spec.ts**:
```typescript
describe('DockerOrchestrator persistence driver defaults', () => {
  it('defaults to postgres for GCP credential sync check', async () => {
    const repoRoot = makeRepo(['infrastructure/docker-compose/docker-compose.local.yaml', '.env.brat']);

    // Create env without PERSISTENCE_DRIVER
    const envDir = path.join(repoRoot, 'env', 'test');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'global.yaml'), 'MESSAGE_BUS_DRIVER: nats\n');

    const orch = new DockerOrchestrator({ repoRoot, target: 'test', env: 'test' });
    const target = { host: 'ssh://user@example', remoteDir: '/remote/dir' };

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await (orch as any).syncRemoteFiles(target);

    // Should skip GCP credentials because default is postgres
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping GCP credentials sync'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('PERSISTENCE_DRIVER=postgres'),
    );

    logSpy.mockRestore();
  });
});
```

**Acceptance Criteria**:
- Tests pass with default configuration
- Tests verify PostgreSQL is used when no env var set
- Tests verify Firestore is used when explicitly set
- CI includes these tests

---

### Task 5.2: Update Existing Integration Tests (P2 - MEDIUM)

**Files**: All `*.spec.ts` and `*.test.ts` files that test persistence
**Complexity**: Medium (many files)
**Risk**: Medium (could break existing tests)

**Pattern**:
```typescript
describe('MyService with PostgreSQL', () => {
  beforeEach(() => {
    process.env.PERSISTENCE_DRIVER = 'postgres';
  });
  // ... tests
});

describe('MyService with Firestore (legacy)', () => {
  beforeEach(() => {
    process.env.PERSISTENCE_DRIVER = 'firestore';
  });
  // ... tests
});
```

**Acceptance Criteria**:
- All integration tests explicitly set `PERSISTENCE_DRIVER`
- Tests cover both PostgreSQL and Firestore paths
- No test relies on implicit defaults

---

## Phase 6: Validation & Cleanup

### Task 6.1: End-to-End Validation (P0 - CRITICAL)

**Validation Checklist**:

1. **Fresh Installation Test**:
   ```bash
   # Clone repo, no .env files, no config
   git clone <repo>
   cd BitBratPlatform
   npm install
   npm run build
   npm run brat -- setup  # Should use PostgreSQL by default
   npm run brat -- docker up
   ```
   - [ ] Setup completes without Firestore errors
   - [ ] Services start successfully
   - [ ] PostgreSQL is used (verify logs)
   - [ ] No GCP credentials required

2. **Explicit Firestore Test**:
   ```bash
   export PERSISTENCE_DRIVER=firestore
   npm run brat -- docker up
   ```
   - [ ] Firestore is used
   - [ ] GCP credentials are synced
   - [ ] Services work correctly

3. **Service Health Check**:
   ```bash
   BITBRAT_CONTEXT=staging npm run brat -- fleet list
   ```
   - [ ] All services healthy
   - [ ] PostgreSQL connections successful
   - [ ] No Firestore errors in logs

4. **Migration Test** (existing Firestore → PostgreSQL):
   - [ ] Data migration tools work
   - [ ] Rollback path exists
   - [ ] Documentation is clear

**Acceptance Criteria**:
- All validation tests pass
- Fresh installation "just works" with defaults
- Firestore path still works when explicitly set
- Migration path is documented and tested

---

### Task 6.2: Create Sprint Completion Artifacts (P2 - MEDIUM)

**Deliverables**:

1. **Verification Report** (`planning/sprint-353-postgres-default/verification-report.md`):
   - [ ] List all tasks completed
   - [ ] Document any deferred items
   - [ ] Include test results
   - [ ] Link to PRs/commits

2. **Migration Gaps Document** (`documentation/migrations/postgres-migration-gaps.md`):
   - [ ] List services with incomplete PostgreSQL implementations
   - [ ] Link to tracking issues
   - [ ] Provide migration timeline
   - [ ] Document workarounds

3. **Retrospective** (`planning/sprint-353-postgres-default/retro.md`):
   - [ ] What went well
   - [ ] What didn't go well
   - [ ] Key learnings
   - [ ] Process improvements

**Acceptance Criteria**:
- All artifacts created and committed
- Documentation reflects current state
- Future work clearly tracked

---

## Risk Management

### High-Risk Changes

1. **Base Server Resource Manager** (Task 1.2)
   - **Risk**: Breaking all services
   - **Mitigation**: Comprehensive testing, gradual rollout
   - **Rollback**: Git revert + redeploy

2. **User Context PostgreSQL Implementation** (Task 3.1)
   - **Risk**: Data loss, LLM bot failures
   - **Mitigation**: Integration tests, data migration script, rollback plan
   - **Rollback**: Revert to Firestore, restore data from backup

### Medium-Risk Changes

1. **Docker Orchestrator Default** (Task 1.1)
   - **Risk**: Existing deployments break
   - **Mitigation**: Environment configs already set `PERSISTENCE_DRIVER`
   - **Rollback**: Update env configs to explicitly set `firestore`

---

## Dependencies & Prerequisites

**Before Starting**:
- [ ] Review Sprint 343 (PostgreSQL Migration) artifacts
- [ ] Review Sprint 344 (PostgreSQL Default) artifacts
- [ ] Ensure PostgreSQL migrations are up to date
- [ ] Verify `createDocumentStore()` implementation is complete
- [ ] Confirm all environments have `DATABASE_URL` configured

**External Dependencies**:
- PostgreSQL database (local or remote)
- Docker Compose (for testing)
- NATS message bus (for testing)

---

## Timeline Estimate

**Day 1 (Critical Fixes)**:
- Task 1.1: Docker Orchestrator Default (1 hour)
- Task 1.2: Base Server Resource Init (2 hours)
- Task 2.1: Comment Updates (1 hour)
- Initial testing and validation (2 hours)

**Day 2 (PostgreSQL Implementations)**:
- Task 3.1: User Context Implementation (4 hours)
- Task 3.2: Graceful Fallback (2 hours)
- Integration testing (2 hours)

**Day 3 (Documentation & Validation)**:
- Task 4.1: User Documentation (2 hours)
- Task 4.2: Deprecation Notices (1 hour)
- Task 5.1: Integration Tests (2 hours)
- Task 6.1: E2E Validation (2 hours)
- Task 6.2: Sprint Artifacts (1 hour)

**Total Estimate**: 2-3 days (16-24 hours)

---

## Success Metrics

**Quantitative**:
- [ ] 0 "Default to Firestore" comments in active code
- [ ] 100% of factory functions default to PostgreSQL
- [ ] 100% of services start with default config
- [ ] 0 Firestore errors in default setup logs
- [ ] >95% test coverage for default behavior

**Qualitative**:
- [ ] Fresh installation experience is smooth
- [ ] Documentation is clear and accurate
- [ ] Developer mental model aligns with implementation
- [ ] Firestore migration path is well-documented

---

## Rollback Plan

**If Sprint Fails**:
1. Revert all code changes via `git revert`
2. Explicitly set `PERSISTENCE_DRIVER=firestore` in all env configs
3. Update documentation to reflect "Firestore is default (temporary)"
4. Create post-mortem document
5. Re-plan sprint with smaller scope

**Rollback Trigger**:
- >50% of services fail to start with default config
- Critical data loss or corruption
- Breaking changes in production

---

**END OF EXECUTION PLAN**
