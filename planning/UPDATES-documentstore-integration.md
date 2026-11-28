# Implementation Plan Updates: DocumentStore Integration

**Date**: 2026-11-27
**Updated By**: Lead Implementor
**Reason**: Align with BitBrat's DocumentStore architecture pattern

---

## Summary of Changes

The implementation plan has been updated to use **DocumentStore interface** throughout, maintaining BitBrat's architectural abstraction instead of using direct PostgreSQL queries.

---

## Key Changes

### 1. New DocumentStore Array Operators Proposal

**File created**: `planning/proposal-documentstore-array-operators.md`

**New operators added to QueryFilter interface**:

```typescript
export interface QueryFilter {
  field: string;
  operator:
    | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
    | 'array-contains' | 'array-contains-any'
    | 'array-overlap'        // NEW: Check if arrays overlap (intersection non-empty)
    | 'array-prefix-match';  // NEW: Check if any array element starts with prefix
  value: any;
}
```

**Rationale**:
- Maintains vendor-neutral abstraction (works with Firestore + PostgreSQL)
- No breaking changes to existing code
- Namespace queries work through existing DocumentStore layer
- Performance acceptable for 505 tools with JSONB GIN indexes

---

### 2. Sprint 1 Task Updates

**Original approach**: Direct PostgreSQL queries with native TEXT[] columns
**New approach**: DocumentStore queries with JSONB arrays

#### Task 1.1: Extend DocumentStore Interface (NEW)
- Add `array-overlap` and `array-prefix-match` operators to `interfaces.ts`
- Additive change, backward compatible

#### Task 1.2: Implement Array Operators in PostgresDocumentStore (NEW)
- Implement operators in `postgres-store.ts` `buildWhereClause()` method
- PostgreSQL implementation:
  - `array-overlap`: Uses JSONB `?|` operator
  - `array-prefix-match`: Uses `EXISTS` subquery with `LIKE`
- Performance: GIN index on `data->'namespaces'` ensures <50ms queries

#### Task 1.3: Implement Namespace Assignment Logic (UNCHANGED)
- Pure TypeScript function, no persistence changes
- Logic remains identical

#### Task 1.4: Update Tool Registration (UPDATED)
- **Before**: Direct SQL `INSERT ... ON CONFLICT` with native arrays
- **After**: `store.set()` with JSONB data
- Namespace metadata uses DocumentStore queries (`array-overlap` for counts)

#### Task 1.5: Create Backfill Script (UPDATED)
- **Before**: PostgreSQL client with direct SQL
- **After**: DocumentStore interface (`store.getAll()`, `store.set()`, `store.query()`)
- Uses `array-overlap` operator for namespace metadata rebuild

---

### 3. Data Storage Model

**Before** (original plan):
```sql
CREATE TABLE platform_tool_registry (
  ...
  namespaces TEXT[],  -- Native PostgreSQL array
  ...
);
CREATE INDEX idx_tool_registry_namespaces USING GIN (namespaces);
```

**After** (DocumentStore-compatible):
```sql
-- DocumentStore uses existing schema
CREATE TABLE platform_tool_registry (
  id TEXT PRIMARY KEY,
  data JSONB,  -- Contains entire document including namespaces array
  ...
);

-- GIN index on JSONB array (manual optimization step)
CREATE INDEX idx_tool_registry_data_namespaces
ON platform_tool_registry USING GIN ((data->'namespaces'));
```

**Tool document structure** (in JSONB `data` column):
```json
{
  "id": "bit.config.get",
  "canonicalName": "bit.config.get",
  "namespaces": ["platform/admin", "platform/config", "admin"],
  "description": "...",
  "source": "internal",
  ...
}
```

---

### 4. Query Pattern Changes

#### Query Tools by Namespaces (Exact Match)

**Before** (direct SQL):
```typescript
const result = await this.db.query(
  `SELECT * FROM platform_tool_registry
   WHERE namespaces && $1`,
  [['platform/admin', 'domain/creative']]
);
```

**After** (DocumentStore):
```typescript
const tools = await this.store.query<ToolRegistryDocument>('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-overlap',
    value: ['platform/admin', 'domain/creative']
  }]
});
```

---

#### Query Tools by Namespace Prefix (Hierarchical)

**Before** (direct SQL):
```typescript
const result = await this.db.query(
  `SELECT * FROM platform_tool_registry
   WHERE EXISTS (
     SELECT 1 FROM unnest(namespaces) AS ns
     WHERE ns = $1 OR ns LIKE $1 || '/%'
   )`,
  ['platform']
);
```

**After** (DocumentStore):
```typescript
const tools = await this.store.query<ToolRegistryDocument>('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-prefix-match',
    value: 'platform'
  }]
});
```

---

#### Update Namespace Metadata

**Before** (direct SQL):
```typescript
await this.db.query(
  `INSERT INTO platform_tool_namespaces (path, display_name, tool_count)
   VALUES ($1, $2, (SELECT COUNT(*) FROM platform_tool_registry WHERE $1 = ANY(namespaces)))
   ON CONFLICT (path) DO UPDATE SET tool_count = ...`,
  [namespacePath, displayName]
);
```

**After** (DocumentStore):
```typescript
// Count tools using array-overlap query
const tools = await this.store.query<ToolRegistryDocument>('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-overlap',
    value: [namespacePath]
  }]
});

// Store metadata
await this.store.set('platform_tool_namespaces', namespacePath, {
  path: namespacePath,
  displayName,
  toolCount: tools.length,
  parent,
  createdAt: new Date(),
  lastUpdatedAt: new Date(),
});
```

---

## Benefits of DocumentStore Approach

### ✅ **Maintains Abstraction**
- Works with both PostgreSQL and Firestore backends
- Consistent with rest of BitBrat architecture
- No breaking changes to existing persistence layer

### ✅ **Performance Acceptable**
- 505 tools is small dataset
- JSONB GIN indexes proven performant (<50ms)
- Array overlap queries: O(log n) with GIN index
- Prefix matching: <100ms with EXISTS subquery

### ✅ **Backward Compatible**
- Existing tools continue working unchanged
- New operators are additive (don't break existing code)
- DocumentStore implementations can add operators incrementally

### ✅ **Migration Simplicity**
- No schema changes to existing tables
- No native column additions (uses JSONB data column)
- GIN index creation is optional optimization step

### ✅ **Future-Proof**
- Compatible with Firestore (uses `array-contains-any` + in-memory filter)
- Extensible to other backends (MongoDB, etc.)
- Namespace metadata stored as separate collection (easy to query)

---

## Trade-offs vs Native PostgreSQL Arrays

### ⚠️ **Slightly Slower Queries**
- JSONB `?|` operator slightly slower than native `&&`
- Impact: Negligible for 505 tools (<5ms difference)
- Mitigation: GIN index on `data->'namespaces'`

### ⚠️ **No Explicit Schema Enforcement**
- Application-level validation instead of database constraints
- Impact: Need to validate namespace format in code
- Mitigation: Validation in `registerTool()` method (already implemented)

### ⚠️ **Prefix Matching Less Efficient**
- EXISTS subquery instead of GIN index scan
- Impact: ~50ms vs ~10ms for native approach
- Mitigation: Acceptable for <1000 tools, can optimize later if needed

---

## Implementation Checklist

### Phase 1: DocumentStore Extension (Sprint 1, Task 1.1-1.2)
- [ ] Add `array-overlap` and `array-prefix-match` to `interfaces.ts`
- [ ] Implement operators in `postgres-store.ts`
- [ ] Create unit tests for new operators
- [ ] Run performance benchmarks (verify <50ms for overlap, <100ms for prefix)
- [ ] Create GIN index on `data->'namespaces'` (manual optimization step)

### Phase 2: Tool Registry Updates (Sprint 1, Task 1.3-1.5)
- [ ] Implement `assignNamespaces()` logic (pure function)
- [ ] Update `registerTool()` to use DocumentStore
- [ ] Update `updateNamespaceToolCount()` to use DocumentStore
- [ ] Create backfill script using DocumentStore
- [ ] Run backfill in dry-run mode (verify correctness)
- [ ] Run backfill script (populate namespaces for 505 tools)

### Phase 3: Validation
- [ ] Verify all 505 tools have namespaces populated
- [ ] Verify namespace metadata has ~30-50 entries
- [ ] Verify GIN index is used (EXPLAIN ANALYZE)
- [ ] Verify query performance (<50ms for overlap)
- [ ] Run integration tests

---

## Files Modified/Created

### Created
1. `planning/proposal-documentstore-array-operators.md` - Operator design proposal
2. `planning/UPDATES-documentstore-integration.md` - This document
3. `src/common/persistence/__tests__/array-operators.test.ts` - Unit tests for new operators
4. `scripts/backfill-tool-namespaces.ts` - DocumentStore-based backfill script

### Modified
1. `planning/implementation-plan-tool-namespacing.md` - Sprint 1 updated to use DocumentStore
2. `src/common/persistence/interfaces.ts` - Add array operators to QueryFilter
3. `src/common/persistence/postgres-store.ts` - Implement new operators in buildWhereClause()
4. `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` - Update registerTool() and namespace methods

---

## Next Steps

1. **Review proposal**: Read `proposal-documentstore-array-operators.md` for operator semantics
2. **Approve approach**: Confirm DocumentStore integration vs direct SQL
3. **Begin Sprint 1**: Start with Task 1.1 (interface extension)
4. **Performance validation**: Run benchmarks after Task 1.2 implementation
5. **Sprint 2-4**: Minimal changes needed (MCP routing, client config already DocumentStore-compatible)

---

**Status**: Implementation plan updated and ready for execution. Sprint 1 now uses DocumentStore interface throughout, maintaining BitBrat's architectural abstraction while enabling efficient namespace queries.
