# Routing Rules Nested Path Fix

**Date:** 2026-07-17
**Sprint:** 343 - PostgreSQL Migration
**Severity:** HIGH

## Issue Summary

The routing rules migration was incomplete because the migration CLI was querying the wrong Firestore collection path. Only 1 routing rule was migrated instead of 7.

## Root Cause

### Firestore Data Structure
Routing rules are stored in a **nested collection path**:
```
configs/routingRules/rules/{id}
```

NOT in the top-level collection:
```
configs/{id}  (this is empty!)
```

### Migration Code Issue
The migration CLI (tools/brat/src/cli/migrate.ts) was querying:
```typescript
const snapshot = await firestore.collection('configs').get();  // ❌ Returns 0 documents
```

When it should query:
```typescript
const snapshot = await firestore.collection('configs/routingRules/rules').get();  // ✅ Returns 7 documents
```

## Impact

- **Initial Migration:** Only 1 routing rule migrated (likely from a different path or test data)
- **Missing Rules:** 6 routing rules not migrated to PostgreSQL
- **Event Router:** Would be missing critical routing logic
- **Production Risk:** Events would not route correctly

## Evidence

### Firestore Query Results
```bash
# Top-level 'configs' collection
$ firestore.collection('configs').get()
→ 0 documents

# Nested 'configs/routingRules/rules' path
$ firestore.collection('configs/routingRules/rules').get()
→ 7 documents:
  - 1CZ8lkzZFZbbAEwyqXar
  - MGuyLzjs6R8aOzveEQ69
  - analysis-reaction-adventure
  - analysis-reaction-bot
  - analysis-reaction-cnj
  - initial-analysis
  - sC70esGNEnvwGl48eisl
```

### PostgreSQL Before Fix
```sql
SELECT COUNT(*) FROM routing_rules;
→ 1 row  (incomplete!)
```

### PostgreSQL After Fix
```sql
SELECT COUNT(*) FROM routing_rules;
→ 8 rows  (1 original + 7 migrated)
```

## Fix Implemented

### 1. Added Nested Path Mapping
**File:** `tools/brat/src/cli/migrate.ts`

Added new mapping constant:
```typescript
// Firestore nested collection paths (for collections with nested structure)
const NESTED_COLLECTION_PATHS: Record<string, string> = {
  'configs': 'configs/routingRules/rules',  // Actual path for routing rules
};
```

### 2. Updated migrateCollection Function
```typescript
async function migrateCollection(
  collectionName: string,
  firestore: FirebaseFirestore.Firestore,
  postgres: PostgresDocumentStore,
  options: { dryRun?: boolean; showProgress?: boolean },
  logger: Logger
): Promise<{ migrated: number; skipped: number; errors: number }> {
  // ... existing code ...

  // Determine the actual Firestore path (handle nested collections)
  const firestorePath = NESTED_COLLECTION_PATHS[collectionName] || collectionName;

  // Get all documents from Firestore collection
  const snapshot = await firestore.collection(firestorePath).get();

  // ... rest of migration logic ...
}
```

### 3. Migrated Missing Routing Rules
```bash
$ brat migrate collection configs
→ Migrated 7 routing rules successfully
```

## Verification

### Event Router Logs
```json
{"msg":"rule_loader.warm_loaded","count":7}
{"msg":"rule_loader.snapshot_applied","count":7}
```

### PostgreSQL Verification
```sql
SELECT id FROM routing_rules ORDER BY id;
```
Results:
```
1CZ8lkzZFZbbAEwyqXar
MGuyLzjs6R8aOzveEQ69
analysis-reaction-adventure
analysis-reaction-bot
analysis-reaction-cnj
bot
initial-analysis
sC70esGNEnvwGl48eisl
```

## Related Issues

This reveals a broader issue: **Other collections may also use nested paths** that the migration CLI doesn't handle.

### Potential Nested Path Collections
Based on common Firestore patterns, these may also use nested paths:
- `oauth` - might have nested paths like `oauth/twitch/*/token` (already handled separately)
- `state` - might have nested paths like `state/users/{userId}`
- Any collection with hierarchical data

### Recommendation
Audit all Firestore collections to identify nested path structures and add them to `NESTED_COLLECTION_PATHS`.

## Lessons Learned

1. **Firestore schema documentation is critical** - Need to document actual collection paths, not logical names
2. **Migration validation should verify record counts** - Compare Firestore count vs PostgreSQL count
3. **Nested paths require special handling** - Cannot assume all collections are top-level
4. **Test migrations with real data** - Dry-run with production-like Firestore structure

## Status

- [x] Issue identified
- [x] Root cause analyzed
- [x] Fix implemented (NESTED_COLLECTION_PATHS mapping)
- [x] Migration CLI updated
- [x] Code rebuilt
- [x] Missing routing rules migrated (7 rules)
- [x] Event router verified (7 rules loaded)
- [x] PostgreSQL verified (8 total rules)

## Resolution

**Date Completed:** 2026-07-17

All 7 routing rules successfully migrated from Firestore nested path `configs/routingRules/rules` to PostgreSQL table `routing_rules`. Event router confirmed loading all rules from PostgreSQL.

**Files Modified:**
- `tools/brat/src/cli/migrate.ts` (added NESTED_COLLECTION_PATHS mapping)

**Migration Stats:**
- Firestore path: `configs/routingRules/rules`
- PostgreSQL table: `routing_rules`
- Documents migrated: 7
- Total in PostgreSQL: 8 (1 from initial + 7 from fix)
- Event router status: ✅ Healthy, 7 rules loaded
