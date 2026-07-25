# Sprint 361: Sprint 360 Lessons Applied
## Key Learnings and Application Strategy

**Date**: 2026-07-25
**Sprint**: 361
**Source**: Sprint 360 completion-report.md

---

## Executive Summary

Sprint 360 successfully migrated 14 commands using a **business logic extraction strategy** that achieved:
- ✅ 93% code reduction through base class pattern
- ✅ 8.5 hours net time savings
- ✅ Improved testability and maintainability
- ✅ Single source of truth for complex operations

**Sprint 361 will apply these lessons to migrate 9 data/migration commands.**

---

## Key Lessons from Sprint 360

### 1. Business Logic First Strategy ⭐

**Lesson**: Extract shared business logic BEFORE migrating commands.

**Sprint 360 Investment**:
- Time: 6.5 hours extracting 9 business logic modules
- Payoff: ~15 hours saved during migration
- Net benefit: **8.5 hours + better testability + single source of truth**

**Application to Sprint 361**:
- ✅ Extract 3 business logic modules BEFORE command migration:
  - `business/pg-backup.ts` (5 functions)
  - `business/db-validation.ts` (4 functions)
  - `business/migration.ts` (4 functions)
- ✅ Estimated extraction time: 5 hours
- ✅ Expected savings: ~10 hours during migration
- ✅ Net benefit: **5 hours + improved testability**

**Action**: Complete Phase 0B (business logic extraction) before Phase 1-3 (command migration).

---

### 2. Base Class Orchestration Pattern ⭐

**Lesson**: When commands share heavy infrastructure, base class abstraction is essential.

**Sprint 360 Result**:
- FleetCommand base class reduced fleet commands from 283 → 39 lines (93% reduction)
- Centralized: registry resolution, gateway URL resolution, transport creation, RBAC, cleanup

**Application to Sprint 361**:
- ❌ No base class needed (data/migration commands don't share heavy infrastructure)
- ✅ But: Extract shared utilities to business logic modules
- ✅ Pattern: Thin command wrappers delegating to business logic modules

**Example**:
```typescript
// NO base class needed
export default class PgBackup extends BratCommand {
  async run(): Promise<void> {
    const { flags } = await this.parse(PgBackup);

    // Delegate to business logic module
    const result = await backupToJson(postgres, options, this.logger);

    // Format output
    this.log(formatBackupResult(result));
  }
}
```

---

### 3. Smoke Tests Strategy ⭐

**Lesson**: Write minimal smoke tests during migration, defer comprehensive testing to Phase 4.

**Sprint 360 Result**:
- Smoke tests: Verify class structure, flags, args, oclif instantiation
- Comprehensive tests: Full business logic coverage (deferred)
- Time savings: Accelerated migration from ~10h to ~6h

**Application to Sprint 361**:
- ✅ Write smoke tests during command migration (Phases 1-3)
- ✅ Write comprehensive business logic tests during extraction (Phase 0B)
- ✅ Write integration tests in Phase 4

**Smoke test template**:
```typescript
describe('oclif Command: pg backup (Smoke Tests)', () => {
  it('should extend BratCommand', () => {
    expect(PgBackup.prototype).toBeInstanceOf(BratCommand);
  });

  it('should have description and examples', () => {
    expect(PgBackup.description).toBeDefined();
    expect(PgBackup.examples).toBeDefined();
  });

  it('should have required flags', () => {
    expect(PgBackup.flags.format).toBeDefined();
    expect(PgBackup.flags.output).toBeDefined();
  });
});
```

---

### 4. Dependency Injection Pattern ⭐

**Lesson**: DI pattern essential for testing commands with external dependencies.

**Sprint 360 Result**:
- FleetDeps interface with 7 injectable dependencies
- Default implementations for production
- Mock implementations for tests
- Commands testable without real network/Firestore/PostgreSQL

**Application to Sprint 361**:
- ⚠️ Some commands have external dependencies:
  - PostgreSQL backup/restore: Needs `PostgresDocumentStore`
  - Database validation: Needs Firestore + PostgreSQL
  - Migration: Needs Firestore + PostgreSQL
- ✅ Inject dependencies via business logic module parameters
- ✅ No command-level DI needed (simpler than fleet commands)

**Example**:
```typescript
// Business logic module accepts dependencies as parameters
export async function backupToJson(
  postgres: PostgresDocumentStore,  // Injectable
  options: BackupOptions,
  logger: Logger  // Injectable
): Promise<BackupResult> {
  // ...
}

// Command just passes dependencies
export default class PgBackup extends BratCommand {
  async run(): Promise<void> {
    const postgres = new PostgresDocumentStore({ connectionString });
    const result = await backupToJson(postgres, options, this.logger);
  }
}
```

---

### 5. Bug Discovery During Extraction ⭐

**Lesson**: Business logic extraction reveals hidden bugs.

**Sprint 360 Bug**: Registry resolver fallback catching config errors.

**Application to Sprint 361**:
- ✅ Carefully review business logic during extraction
- ✅ Write comprehensive tests to catch edge cases
- ✅ Validate error handling paths
- ✅ Look for hidden try/catch blocks masking errors

**Checklist**:
- [ ] Review all try/catch blocks in source files
- [ ] Verify error messages are clear and actionable
- [ ] Test failure scenarios (missing DATABASE_URL, connection errors)
- [ ] Ensure dry-run mode actually prevents writes

---

## Three Migration Patterns (from Sprint 360)

### Pattern 1: Simple Delegation

**When**: Command has existing `execute*()` function with all business logic.

**Example**: `use`, `current` commands

**Sprint 361 Application**:
- ❌ No commands have existing `execute*()` functions
- ✅ But seed.ts is already well-separated (uses `seedPostgres()`, `seedFirestore()`)

---

### Pattern 2: Business Logic Module

**When**: Shared logic across multiple commands, complex validation/processing.

**Example**: `context validate`, `config validate`

**Sprint 361 Application**:
- ✅ PRIMARY PATTERN for all Sprint 361 commands
- ✅ Extract business logic modules first
- ✅ Commands delegate to business logic modules

**Commands using this pattern**:
- `backup list/export/import` → delegates to existing `backup/` modules
- `pg:backup/restore` → delegates to `business/pg-backup.ts` (to be created)
- `db:validate` → delegates to `business/db-validation.ts` (to be created)
- `migrate collection/all` → delegates to `business/migration.ts` (to be created)
- `seed` → delegates to existing `seeding/` modules

---

### Pattern 3: Base Class Orchestration

**When**: Family of commands sharing heavy infrastructure.

**Example**: All 7 fleet commands

**Sprint 361 Application**:
- ❌ NOT NEEDED (data/migration commands don't share heavy infrastructure)
- ✅ Each command is independent (different dependencies, different operations)

---

## Success Criteria Checklist

Based on Sprint 360's success:

### Code Quality
- [ ] All commands follow Pattern 2 (business logic module delegation)
- [ ] All business logic modules have comprehensive tests (≥80% coverage)
- [ ] Zero regressions (all existing tests pass)
- [ ] TypeScript compilation succeeds with zero errors

### Testing Strategy
- [ ] Smoke tests during migration (Phases 1-3)
- [ ] Comprehensive business logic tests during extraction (Phase 0B)
- [ ] Integration tests in Phase 4

### Time Management
- [ ] Phase 0B extraction: 5 hours (3 modules)
- [ ] Phase 1-3 migration: 12-18 hours (9 commands)
- [ ] Phase 4-5 testing/docs: 6-8 hours
- [ ] Total: ~25 hours (matches Sprint 360's 14 commands in similar time)

### Documentation
- [ ] All commands have help text with examples
- [ ] Sprint completion report created
- [ ] Lessons learned documented

---

## Application Plan

### Phase 0B: Business Logic Extraction (5h)

Following Sprint 360's "business logic first" strategy:

1. **BIZ-002**: Extract `business/pg-backup.ts` (1.5h)
   - Functions: backupToJson(), backupToSql(), restoreFromJson(), restoreFromSql(), detectFormat()
   - Tests: Comprehensive coverage (≥80%)

2. **BIZ-004**: Extract `business/db-validation.ts` (1.5h)
   - Functions: validateCollection(), validateAll(), calculateChecksum(), formatters
   - Tests: Comprehensive coverage (≥80%)

3. **BIZ-003**: Extract `business/migration.ts` (2h)
   - Functions: migrateCollection(), migrateAll(), migrateOAuthTokens(), migrateApiTokens()
   - Tests: Comprehensive coverage (≥80%)

### Phases 1-3: Command Migration (12-18h)

Following Sprint 360's "thin wrapper" pattern:

- **Phase 1**: 3 backup commands (already use business logic) - 6-8h
- **Phase 2**: 2 PostgreSQL commands (use new business/pg-backup.ts) - 3-4h
- **Phase 3**: 4 database commands (use new business modules) - 6-8h

### Phase 4-5: Testing & Documentation (6-8h)

Following Sprint 360's comprehensive validation:

- Integration tests (backup → restore, seed → validate → migrate)
- Performance benchmarking (no regression)
- Regression testing (all Sprint 360 commands still work)
- Sprint completion report

---

## Risk Mitigation

Based on Sprint 360 learnings:

### Risk 1: External Dependencies
**Mitigation**: Pass dependencies as parameters to business logic functions (same as Sprint 360's DI pattern)

### Risk 2: Time Overruns
**Mitigation**: Follow proven extraction-first strategy, smoke tests during migration

### Risk 3: Hidden Bugs
**Mitigation**: Comprehensive testing of business logic during extraction (catch bugs early)

### Risk 4: Test Failures
**Mitigation**: Separate structure tests (smoke) from behavior tests (comprehensive)

---

## Conclusion

Sprint 360 proved that **business logic extraction first** is the winning strategy:
- ✅ 8.5 hours net time savings
- ✅ 93% code reduction through abstraction
- ✅ Improved testability
- ✅ Single source of truth

Sprint 361 will apply these lessons to achieve similar results with data/migration commands.

**Key Takeaway**: Invest time in extraction (Phase 0B) to accelerate migration (Phases 1-3) and improve long-term maintainability.

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
