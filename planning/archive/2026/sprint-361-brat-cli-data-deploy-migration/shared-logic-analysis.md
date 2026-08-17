# Sprint 361: Shared Business Logic Analysis
## Data & Migration Commands

**Date**: 2026-07-25
**Sprint**: 361
**Author**: Lead Implementor

---

## Executive Summary

Analysis of 9 data/migration commands reveals that **2 commands already use extracted business logic**, while **3 command families require extraction** to follow Sprint 360 patterns.

**Extraction Required:**
1. **PostgreSQL Backup/Restore** - Extract from `pg-backup.ts` → `business/pg-backup.ts`
2. **Database Validation** - Extract from `db-validate.ts` → `business/db-validation.ts`
3. **Migration** - Extract from `migrate.ts` → `business/migration.ts`

**No Extraction Needed:**
- `backup.ts` - Already uses modular business logic
- `seed.ts` - Already uses modular seeding modules

Total Business Logic Modules to Create: **3**
Estimated Extraction Time: **5-6 hours**

---

## Command Analysis

### 1. Backup Commands (`backup.ts`)

**Status**: ✅ Already well-separated

**Current Architecture**:
```typescript
// src/cli/backup.ts
import { CONFIG_BACKUP_REGISTRY, FORBIDDEN_PREFIXES } from '../backup/registry';
import { resolveBackupConnection } from '../backup/connection';
import { exportConfig } from '../backup/export';
import { importConfig } from '../backup/import';

export async function cmdBackup(action, flags, rest, logger) {
  switch (action) {
    case 'list': cmdBackupList(flags);
    case 'export': cmdBackupExport(flags, rest, logger);
    case 'import': cmdBackupImport(flags, rest, logger);
  }
}
```

**Business Logic Modules** (already exist):
- `backup/registry.ts` - CONFIG_BACKUP_REGISTRY, FORBIDDEN_PREFIXES, assertRegistrySafe()
- `backup/connection.ts` - resolveBackupConnection()
- `backup/export.ts` - exportConfig()
- `backup/import.ts` - importConfig(), ImportMode

**oclif Migration Strategy**: Wrap existing business logic in thin command classes

**No Further Extraction Needed**: ✅

---

### 2. PostgreSQL Commands (`pg-backup.ts`)

**Status**: ⚠️ Needs extraction

**Current Architecture**: All logic in CLI file (375 lines)

**Functions to Extract**:

```typescript
// Proposed: business/pg-backup.ts

export interface BackupOptions {
  collections?: string[];
  compress?: boolean;
  format?: 'json' | 'sql';
}

export interface RestoreOptions {
  dryRun?: boolean;
  mode?: 'merge' | 'overwrite';
  format?: 'json' | 'sql';
}

export async function backupToJson(
  postgres: PostgresDocumentStore,
  options: BackupOptions,
  logger: Logger
): Promise<{ data: Record<string, any[]>; metadata: any }> {
  // Extract from pg-backup.ts:72-101
}

export async function backupToSql(
  outputPath: string,
  options: BackupOptions,
  logger: Logger
): Promise<{ success: boolean; path: string; size: number }> {
  // Extract from pg-backup.ts:106-137
  // Wraps pg_dump
}

export async function restoreFromJson(
  postgres: PostgresDocumentStore,
  data: Record<string, any[]>,
  options: RestoreOptions,
  logger: Logger
): Promise<{ restored: number; errors: number }> {
  // Extract from pg-backup.ts:142-191
}

export async function restoreFromSql(
  inputPath: string,
  options: RestoreOptions,
  logger: Logger
): Promise<{ success: boolean }> {
  // Extract from pg-backup.ts:196-231
  // Wraps pg_restore
}

export function detectFormat(filePath: string): 'json' | 'sql' {
  if (filePath.endsWith('.pgdump')) return 'sql';
  if (filePath.endsWith('.json') || filePath.endsWith('.json.gz')) return 'json';
  throw new Error(`Unknown backup format: ${filePath}`);
}
```

**Extraction Complexity**: Medium (4 functions, gzip handling, pg_dump/pg_restore wrappers)

**Estimated Time**: 1.5 hours

---

### 3. Database Validation (`db-validate.ts`)

**Status**: ⚠️ Needs extraction

**Current Architecture**: All logic in CLI file (264 lines)

**Functions to Extract**:

```typescript
// Proposed: business/db-validation.ts

export interface ValidationOptions {
  sampleSize?: number;
}

export interface ValidationResult {
  collection: string;
  firestoreCount: number;
  postgresCount: number;
  countMatch: boolean;
  sampled: number;
  checksumMatches: number;
  checksumMismatches: number;
  missingInPostgres: number;
  missingInFirestore: number;
  differences: Array<{ id: string; issue: string }>;
}

export interface ValidationSummary {
  collections: ValidationResult[];
  totalIssues: number;
  success: boolean;
}

export function calculateChecksum(doc: any): string {
  // Extract from db-validate.ts:50-53
  const normalized = JSON.stringify(doc, Object.keys(doc).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function validateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: ValidationOptions,
  logger: Logger
): Promise<ValidationResult> {
  // Extract from db-validate.ts:58-155
}

export async function validateAll(
  collections: string[],
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: ValidationOptions,
  logger: Logger
): Promise<ValidationSummary> {
  const results: ValidationResult[] = [];
  let totalIssues = 0;

  for (const collection of collections) {
    const result = await validateCollection(collection, firestore, postgres, options, logger);
    results.push(result);
    totalIssues += result.checksumMismatches + result.missingInPostgres + result.missingInFirestore;
  }

  return {
    collections: results,
    totalIssues,
    success: totalIssues === 0,
  };
}

export function formatValidationResult(result: ValidationResult): string {
  // Format validation result as human-readable text
}

export function formatValidationSummary(summary: ValidationSummary): string {
  // Format summary for all collections
}
```

**Extraction Complexity**: Medium (2 core functions, checksum logic, formatting utilities)

**Estimated Time**: 1.5 hours

---

### 4. Migration Commands (`migrate.ts`)

**Status**: ⚠️ Needs extraction

**Current Architecture**: All logic in CLI file (546 lines)

**Functions to Extract**:

```typescript
// Proposed: business/migration.ts

export interface MigrationOptions {
  dryRun?: boolean;
  showProgress?: boolean;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
}

export interface MigrationSummary {
  collections: Record<string, MigrationResult>;
  totalMigrated: number;
  totalErrors: number;
  success: boolean;
}

// Firestore collection → PostgreSQL table mapping
export const COLLECTION_MAPPING: Record<string, string> = {
  'configs': 'routing_rules',
  'users': 'auth_users',
  'oauth': 'auth_scopes',
  'state': 'user_state',
  'services': 'service_registry',
};

export const NESTED_COLLECTION_PATHS: Record<string, string> = {
  'configs': 'configs/routingRules/rules',
};

export const COLLECTIONS = [
  'events',
  'configs',
  'context_packs',
  'services',
  'users',
  'oauth',
  'state',
  'global_state',
  'sessions',
  'conversation_history',
  'llm_responses',
  'integration_configs',
  'metrics',
  'tool_usage',
  'reflexes',
];

export async function migrateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger,
  onProgress?: (current: number, total: number) => void
): Promise<MigrationResult> {
  // Extract from migrate.ts:71-146
  // Map Firestore collection → PostgreSQL table
  // Handle nested collections
  // Batch migration with progress tracking
}

export async function migrateAll(
  collections: string[],
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger,
  onProgress?: (collection: string, current: number, total: number) => void
): Promise<MigrationSummary> {
  const results: Record<string, MigrationResult> = {};
  let totalMigrated = 0;
  let totalErrors = 0;

  for (const collection of collections) {
    const result = await migrateCollection(
      collection,
      firestore,
      postgres,
      options,
      logger,
      (current, total) => onProgress?.(collection, current, total)
    );
    results[collection] = result;
    totalMigrated += result.migrated;
    totalErrors += result.errors;
  }

  return {
    collections: results,
    totalMigrated,
    totalErrors,
    success: totalErrors === 0,
  };
}

export async function migrateOAuthTokens(
  provider: string | undefined,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger
): Promise<MigrationResult> {
  // Extract from migrate.ts:275-388
}

export async function migrateApiTokens(
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: MigrationOptions,
  logger: Logger,
  onProgress?: (current: number, total: number) => void
): Promise<MigrationResult> {
  // Extract from migrate.ts:393-480
}
```

**Extraction Complexity**: High (4 functions, collection mapping, nested collections, OAuth/API token migration)

**Estimated Time**: 2 hours

---

### 5. Seed Command (`seed.ts`)

**Status**: ✅ Already well-separated

**Current Architecture**:
```typescript
// src/cli/seed.ts
import { seedPostgres } from '../seeding/postgres-seed-writer';
import { seedFirestore } from '../seeding/firestore-seed-writer';

export async function cmdSeed(options, flags) {
  const context = await resolver.resolve(contextFlag);

  if (context.runtime.persistence.driver === 'postgres') {
    result = await seedPostgres(connectionString, seedingOptions);
  } else if (context.runtime.persistence.driver === 'firestore') {
    result = await seedFirestore(firestore, seedingOptions);
  }
}
```

**Business Logic Modules** (already exist):
- `seeding/postgres-seed-writer.ts` - seedPostgres()
- `seeding/firestore-seed-writer.ts` - seedFirestore()
- `seeding/seed-data-types.ts` - SeedingOptions, SeedResult

**oclif Migration Strategy**: Wrap existing business logic in thin command class

**No Further Extraction Needed**: ✅

---

## Extraction Priority

### Phase 0B: Business Logic Extraction (5-6 hours)

| ID | Module | Functions | Complexity | Time | Priority |
|----|--------|-----------|------------|------|----------|
| BIZ-002 | business/pg-backup.ts | 5 functions | Medium | 1.5h | P0 |
| BIZ-004 | business/db-validation.ts | 4 functions | Medium | 1.5h | P0 |
| BIZ-003 | business/migration.ts | 4 functions | High | 2h | P0 |

**Total Extraction Time**: 5 hours

---

## Extraction Benefits

1. **Testability**: Business logic can be tested independently of oclif Command framework
2. **Reusability**: Logic can be used by other tools (scripts, APIs, integrations)
3. **Maintainability**: Single source of truth for complex operations
4. **Consistency**: Follows Sprint 360 patterns (business logic + thin command wrappers)

---

## Testing Strategy

Each business logic module should have comprehensive unit tests:

### business/pg-backup.test.ts
- [ ] backupToJson() - reads all collections, handles compression
- [ ] backupToSql() - wraps pg_dump correctly
- [ ] restoreFromJson() - restores documents, respects mode (merge/overwrite)
- [ ] restoreFromSql() - wraps pg_restore correctly
- [ ] detectFormat() - detects format from file extension

### business/db-validation.test.ts
- [ ] calculateChecksum() - normalized JSON hashing
- [ ] validateCollection() - compares Firestore vs PostgreSQL
- [ ] validateAll() - validates multiple collections
- [ ] formatValidationResult() - formats single collection result
- [ ] formatValidationSummary() - formats summary for all collections

### business/migration.test.ts
- [ ] migrateCollection() - migrates single collection with mapping
- [ ] migrateAll() - migrates all collections
- [ ] migrateOAuthTokens() - migrates OAuth tokens
- [ ] migrateApiTokens() - migrates API tokens
- [ ] COLLECTION_MAPPING - correct Firestore → PostgreSQL mapping

---

## Success Criteria

- [ ] 3 business logic modules extracted
- [ ] All extracted functions have unit tests (≥80% coverage)
- [ ] All existing functionality preserved (zero regressions)
- [ ] Command files become thin wrappers (< 100 lines each)
- [ ] Business logic modules follow Sprint 360 patterns

---

## Next Steps

1. ✅ Complete shared logic analysis (this document)
2. ⏭️ Review Sprint 360 lessons learned (PLAN-003)
3. ⏭️ Validate Sprint 360 foundation (PLAN-004)
4. ⏭️ Extract business logic (BIZ-002, BIZ-003, BIZ-004)
5. ⏭️ Migrate commands (Phase 1, 2, 3)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
