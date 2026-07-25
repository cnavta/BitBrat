# Sprint 361: Execution Plan - Data & Migration Command Migration
## Backup, PostgreSQL, Database Validation, and Migration Commands

**Sprint**: 361
**Lead Implementor**: AI Agent (Sprint Protocol v3)
**Duration**: 1 sprint (~3-5 days)
**Start Date**: 2026-07-25
**Target Completion**: 2026-07-30

---

## Executive Summary

Sprint 361 continues the oclif migration by focusing on **Data & Migration commands** - the critical infrastructure for database operations, backups, and migrations. This sprint migrates **9 commands** organized into three families:

1. **Backup Commands** (3 commands) - Firestore backup/restore operations
2. **PostgreSQL Commands** (2 commands) - PostgreSQL-specific backup/restore
3. **Database Commands** (4 commands) - Validation, migration, seeding

**Success Criteria**: All 9 commands migrated, tests passing, zero regressions, consistent patterns with Sprint 360.

**Foundation**: Sprint 360 successfully established:
- ✅ BratCommand base class with full context integration
- ✅ FleetCommand base class for MCP-based operations
- ✅ 14 commands migrated (context, fleet, config families)
- ✅ Business logic extraction patterns validated
- ✅ Comprehensive testing framework

---

## Sprint Objectives

### Primary Objectives (P0 - Must Complete)

| ID | Objective | Success Metric | Acceptance Criteria |
|----|-----------|----------------|---------------------|
| OBJ-1 | Backup family complete | 3/3 backup commands migrated | All backup commands pass tests |
| OBJ-2 | PostgreSQL family complete | 2/2 pg commands migrated | All pg:backup/restore commands work |
| OBJ-3 | Database family complete | 4/4 db commands migrated | seed, validate, migrate commands pass tests |
| OBJ-4 | Zero regressions | All existing tests pass | npm test shows 100% pass rate |
| OBJ-5 | Help text polished | All commands have examples | Every command has --help with usage examples |

### Secondary Objectives (P1 - Should Complete)

| ID | Objective | Success Metric | Acceptance Criteria |
|----|-----------|----------------|---------------------|
| OBJ-6 | Test coverage maintained | ≥80% on new code | Jest coverage report shows adequate coverage |
| OBJ-7 | Performance validated | No regression vs Sprint 360 | Startup time < 200ms, help < 50ms |
| OBJ-8 | Documentation updated | Migration patterns documented | Sprint completion report created |

---

## Command Inventory & Migration Status

### Sprint 360: Completed (14 commands)
- [x] Context family (6 commands)
- [x] Fleet family (7 commands)
- [x] Config validate (1 command)

### Sprint 361: Target (9 commands)

#### Backup Family (3 commands) - Priority 1
- [ ] `backup list` - List available Firestore backups
- [ ] `backup export [--project-id <id> | --target <name>]` - Export Firestore data
- [ ] `backup import --in <path>` - Import Firestore data

**Rationale**: Backup commands are foundational for disaster recovery and data migration. Critical for production operations.

#### PostgreSQL Family (2 commands) - Priority 2
- [ ] `pg:backup [--output <path>]` - Export PostgreSQL data
- [ ] `pg:restore --input <path>` - Import PostgreSQL data

**Rationale**: PostgreSQL is the default persistence driver (Sprint 344+). These commands are essential for backups and environment cloning.

#### Database Family (4 commands) - Priority 3
- [ ] `seed [--context <name>]` - Populate initial data
- [ ] `db:validate [--collection <name> | --all]` - Validate Firestore ↔ PostgreSQL consistency
- [ ] `migrate collection <name>` - Migrate single Firestore collection to PostgreSQL
- [ ] `migrate all` - Migrate all Firestore collections to PostgreSQL

**Rationale**: Migration commands enable the Firestore → PostgreSQL transition. Seeding is required for local development.

---

## Phase Breakdown

### Phase 0: Planning & Analysis (Day 1, 3-4 hours)

**Objective**: Analyze command complexity, identify shared logic, create detailed backlog

**Tasks**:
1. Read all source implementations for 9 commands
2. Identify shared business logic to extract:
   - Backup operations (Firestore read/write)
   - PostgreSQL operations (pg_dump/pg_restore)
   - Migration logic (Firestore → PostgreSQL)
   - Validation logic (data consistency checks)
3. Create task backlog with time estimates
4. Review Sprint 360 lessons learned

**Deliverables**:
- `backlog.yaml` - Prioritized task list with time estimates
- `shared-logic-analysis.md` - Business logic extraction plan

**Dependencies**: Sprint 360 complete

**Validation**:
```bash
# All Sprint 360 commands still work
./bin/run context list
./bin/run fleet list
./bin/run config validate

# Build succeeds
npm run build

# Tests pass
npm test
```

---

### Phase 1: Backup Commands (Day 1-2, 6-8 hours)

**Objective**: Migrate all 3 Firestore backup/restore commands

#### 1.1: backup list (1.5 hours)

**Current**: `src/cli/backup.ts` - cmdBackup('list')

**Target**: `src/oclif-commands/backup/list.ts`

**Pattern**: Simple table/JSON output (Pattern 2 from Sprint 360)

**Flags**:
- `--json` - JSON output format

**Acceptance Criteria**:
- ✅ `brat backup list` displays available backups
- ✅ `brat backup list --json` outputs JSON
- ✅ Table shows: FILENAME, SIZE, DATE, COLLECTIONS
- ✅ Handles empty backup directory gracefully

**Validation**:
```bash
./bin/run backup list
./bin/run backup list --json
```

#### 1.2: backup export (3 hours)

**Current**: `src/cli/backup.ts` - cmdBackup('export')

**Target**: `src/oclif-commands/backup/export.ts`

**Pattern**: Complex operation with progress tracking (Pattern 4)

**Flags**:
- `--project-id <id>` - GCP project ID (optional, from env)
- `--target <name>` - Target execution context (optional)
- `--out <path>` - Output path (default: `backups/backup-<timestamp>.json`)
- `--collections <a,b>` - Specific collections (default: all config collections)
- `--include-secrets` - Include secret values (default: redact)
- `--pretty` - Pretty-print JSON (default: compact)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat backup export` exports all config collections
- ✅ `brat backup export --out custom.json` uses custom output path
- ✅ `brat backup export --collections commands,packs` exports specific collections
- ✅ Secrets redacted by default, included with `--include-secrets`
- ✅ Progress tracking shows collection/document counts
- ✅ Never exports events/logs collections (security)

**Validation**:
```bash
./bin/run backup export
./bin/run backup export --out test-backup.json --pretty
./bin/run backup export --collections commands --include-secrets
```

#### 1.3: backup import (3.5 hours)

**Current**: `src/cli/backup.ts` - cmdBackup('import')

**Target**: `src/oclif-commands/backup/import.ts`

**Pattern**: Dangerous operation with confirmation (Pattern 3)

**Args**:
- `--in <path>` - Input backup file (required)

**Flags**:
- `--project-id <id>` - GCP project ID (optional)
- `--target <name>` - Target execution context (optional)
- `--mode <merge|overwrite|skip>` - Import mode (default: merge)
- `--collections <a,b>` - Specific collections (default: all in backup)
- `--include-secrets` - Restore secret values (default: skip)
- `--dry-run` - Preview changes without writing (default: true)
- `--confirm` - Actually perform import (required for write)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat backup import --in backup.json` runs in dry-run mode by default
- ✅ `brat backup import --in backup.json --confirm` actually imports
- ✅ Requires `--confirm` flag to write (safety check)
- ✅ `--mode merge` merges with existing data
- ✅ `--mode overwrite` replaces existing documents
- ✅ `--mode skip` skips existing documents
- ✅ Shows preview of changes in dry-run mode
- ✅ Never imports into production without explicit confirmation

**Validation**:
```bash
# Dry-run (default)
./bin/run backup import --in test-backup.json

# Actual import
./bin/run backup import --in test-backup.json --confirm --mode merge

# Specific collections
./bin/run backup import --in test-backup.json --collections commands --confirm
```

---

### Phase 2: PostgreSQL Commands (Day 2, 3-4 hours)

**Objective**: Migrate PostgreSQL backup/restore commands

#### 2.1: pg:backup (2 hours)

**Current**: `src/cli/pg-backup.ts` - cmdPgBackup()

**Target**: `src/oclif-commands/pg/backup.ts`

**Pattern**: Data export with format options (Pattern 2)

**Flags**:
- `--output <path>` - Output path (default: `backups/pg-backup-<timestamp>.json`)
- `--format <json|sql>` - Export format (default: json)
- `--compress` - Compress output with gzip (default: false)
- `--collections <a,b>` - Specific collections (default: all)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat pg:backup` exports to JSON by default
- ✅ `brat pg:backup --format sql` exports as SQL dump
- ✅ `brat pg:backup --compress` creates .gz file
- ✅ `brat pg:backup --collections commands,packs` exports specific collections
- ✅ Progress tracking shows table/row counts
- ✅ Uses PostgreSQL connection from current execution context

**Validation**:
```bash
./bin/run pg:backup
./bin/run pg:backup --format sql --output dump.sql
./bin/run pg:backup --compress --output backup.json.gz
```

#### 2.2: pg:restore (2 hours)

**Current**: `src/cli/pg-backup.ts` - cmdPgRestore()

**Target**: `src/oclif-commands/pg/restore.ts`

**Pattern**: Dangerous operation with confirmation (Pattern 3)

**Flags**:
- `--input <path>` - Input backup file (required)
- `--format <json|sql>` - Import format (auto-detected if not specified)
- `--mode <merge|overwrite>` - Import mode (default: merge)
- `--dry-run` - Preview changes without writing (default: false)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat pg:restore --input backup.json` restores JSON backup
- ✅ `brat pg:restore --input dump.sql --format sql` restores SQL dump
- ✅ Auto-detects format from file extension if `--format` not specified
- ✅ `--mode merge` merges with existing data
- ✅ `--mode overwrite` truncates tables before import
- ✅ Shows preview in dry-run mode
- ✅ Uses PostgreSQL connection from current execution context

**Validation**:
```bash
./bin/run pg:restore --input backup.json --dry-run
./bin/run pg:restore --input backup.json --mode merge
./bin/run pg:restore --input dump.sql --format sql
```

---

### Phase 3: Database Commands (Day 2-3, 6-8 hours)

**Objective**: Migrate validation, migration, and seeding commands

#### 3.1: seed (2 hours)

**Current**: `src/cli/index.ts` - cmdSeed()

**Target**: `src/oclif-commands/db/seed.ts`

**Pattern**: Idempotent data population (Pattern 1)

**Flags**:
- `--context <name>` - Execution context (default: current)
- `--bot-name <name>` - Bot name for personalities (default: from config)
- `--dry-run` - Preview changes without writing (default: false)
- `--wipe` - Clear existing data before seeding (default: false)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat seed` populates routing rules, reflexes, personalities
- ✅ `brat seed --context local` seeds specific context
- ✅ `brat seed --wipe` clears existing data first
- ✅ `brat seed --dry-run` previews changes
- ✅ Idempotent (safe to run multiple times)
- ✅ Works with both PostgreSQL and Firestore drivers

**Validation**:
```bash
./bin/run seed --dry-run
./bin/run seed --context local
./bin/run seed --wipe --context local
```

#### 3.2: db:validate (2 hours)

**Current**: `src/cli/db-validate.ts` - cmdDbValidate()

**Target**: `src/oclif-commands/db/validate.ts`

**Pattern**: Validation with sampling (Pattern 1)

**Flags**:
- `--collection <name>` - Specific collection (optional, default: all)
- `--all` - Validate all collections
- `--sample <N>` - Sample size per collection (default: 100)
- `--json` - JSON output

**Acceptance Criteria**:
- ✅ `brat db:validate --all` validates all collections
- ✅ `brat db:validate --collection commands` validates specific collection
- ✅ `brat db:validate --sample 1000` uses custom sample size
- ✅ Shows: collection, PostgreSQL count, Firestore count, mismatches
- ✅ Exit code 0 if consistent, 1 if mismatches found
- ✅ Detailed mismatch reporting in verbose mode

**Validation**:
```bash
./bin/run db:validate --all
./bin/run db:validate --collection commands --sample 50
```

#### 3.3: migrate collection (2 hours)

**Current**: `src/cli/migrate.ts` - cmdMigrate('collection')

**Target**: `src/oclif-commands/migrate/collection.ts`

**Pattern**: Long-running migration with progress (Pattern 4)

**Args**:
- `<name>` - Collection name (required)

**Flags**:
- `--dry-run` - Preview migration without writing (default: false)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat migrate collection commands` migrates single collection
- ✅ `brat migrate collection commands --dry-run` previews migration
- ✅ Progress tracking shows document counts
- ✅ Handles large collections with batching
- ✅ Idempotent (safe to re-run on partial migration)
- ✅ Shows summary: total, migrated, skipped, failed

**Validation**:
```bash
./bin/run migrate collection commands --dry-run
./bin/run migrate collection packs
```

#### 3.4: migrate all (2 hours)

**Current**: `src/cli/migrate.ts` - cmdMigrate('all')

**Target**: `src/oclif-commands/migrate/all.ts`

**Pattern**: Long-running batch migration (Pattern 4)

**Flags**:
- `--dry-run` - Preview migration without writing (default: false)
- `--json` - JSON status output

**Acceptance Criteria**:
- ✅ `brat migrate all` migrates all collections
- ✅ `brat migrate all --dry-run` previews full migration
- ✅ Progress tracking per collection
- ✅ Continues on individual collection failures
- ✅ Shows summary: collections migrated, total documents, failed documents
- ✅ Excludes events/logs collections (too large)

**Validation**:
```bash
./bin/run migrate all --dry-run
./bin/run migrate all
```

---

### Phase 4: Testing & Validation (Day 3-4, 4-6 hours)

**Objective**: Ensure zero regressions, comprehensive test coverage

**Tasks**:
1. Write unit tests for all 9 commands
2. E2E integration testing
3. Performance benchmarking
4. Regression testing

#### 4.1: Unit Tests (2 hours)

**Test Files to Create**:
```
tools/brat/src/oclif-commands/
├── backup/
│   ├── list.test.ts
│   ├── export.test.ts
│   └── import.test.ts
├── pg/
│   ├── backup.test.ts
│   └── restore.test.ts
├── db/
│   ├── seed.test.ts
│   └── validate.test.ts
└── migrate/
    ├── collection.test.ts
    └── all.test.ts
```

**Coverage Target**: ≥80% on new code

**Validation**:
```bash
npm test -- tools/brat/src/oclif-commands/backup
npm test -- tools/brat/src/oclif-commands/pg
npm test -- tools/brat/src/oclif-commands/db
npm test -- tools/brat/src/oclif-commands/migrate
```

#### 4.2: Integration Tests (2 hours)

**Scenarios**:
- Backup export → list → import workflow
- PostgreSQL backup → restore workflow
- Seed → validate workflow
- Migrate collection → migrate all workflow

**Validation**:
```bash
# Backup workflow
./bin/run backup export --out test.json
./bin/run backup list
./bin/run backup import --in test.json --dry-run

# PostgreSQL workflow
./bin/run pg:backup --output test-pg.json
./bin/run pg:restore --input test-pg.json --dry-run

# Migration workflow
./bin/run seed --context local
./bin/run db:validate --all
./bin/run migrate collection commands --dry-run
```

#### 4.3: Performance & Regression (2 hours)

**Metrics**:
```bash
# Startup time
time ./bin/run --version  # Target: < 200ms

# Help generation
time ./bin/run backup export --help  # Target: < 50ms

# Regression: All Sprint 360 commands still work
./bin/run context list
./bin/run fleet list
./bin/run config validate
```

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Commands migrated | 9/9 (100%) | Count of working commands |
| Test coverage | ≥80% | Jest coverage on new code |
| Test pass rate | 100% | All tests green |
| Performance (startup) | < 200ms | `time ./bin/run --version` |
| Performance (help) | < 50ms | `time ./bin/run backup export --help` |
| Zero regressions | 100% | All existing tests pass |

### Qualitative Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Help text quality | Excellent | Every command has examples |
| Code maintainability | Improved | Follow oclif patterns |
| Error messages | Clear | User-friendly error messages |
| Documentation | Complete | Sprint completion report |

---

## Risk Management

### High Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Backup/restore data loss | Low | Critical | Dry-run by default, require --confirm |
| Migration complexity | Medium | High | Extensive testing, progress tracking |
| Firestore/PostgreSQL inconsistencies | Medium | Medium | Validation command catches issues |

### Medium Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Large backup file handling | High | Low | Streaming, compression, progress tracking |
| PostgreSQL connection issues | Medium | Low | Clear error messages, connection validation |

---

## Definition of Done

Sprint 361 is complete when:

### Code
- [ ] All 9 commands migrated to oclif
- [ ] All commands follow BratCommand patterns
- [ ] All commands have help text with examples
- [ ] Zero regressions (all existing tests pass)
- [ ] New tests written (≥80% coverage)

### Documentation
- [ ] Sprint completion report created
- [ ] Migration patterns documented
- [ ] All commands have help text with examples

### Validation
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Performance benchmarks met
- [ ] Manual E2E testing successful

### Process
- [ ] Retrospective completed
- [ ] Learnings documented
- [ ] Backlog for Sprint 362 created

---

## Next Sprint Preview (Sprint 362)

Sprint 362 will focus on:

1. **Deploy Commands** (3 commands)
   - deploy services --all
   - deploy service <name>
   - cloud-run shutdown

2. **Infra Commands** (5 commands)
   - infra plan
   - infra apply
   - apis enable
   - lb urlmap render
   - lb urlmap import

**Estimated Effort**: 8 commands (~1 sprint)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Next Review**: End of Day 2 (midpoint check)
