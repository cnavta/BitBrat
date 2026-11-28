# Proposal: DocumentStore Array Query Operators

**Author**: Lead Implementor
**Date**: 2026-11-27
**Status**: Proposed
**Related**: Tool Namespace Implementation (Sprint 1-4)

---

## Overview

Extend `IDocumentStore` query interface to support advanced array operations needed for hierarchical namespace filtering. This maintains BitBrat's architectural abstraction while enabling efficient namespace queries.

**Key Requirement**: Support namespace queries without breaking DocumentStore abstraction or Firestore compatibility.

---

## Current State

**Existing Array Operators** (interfaces.ts:13):
```typescript
export interface QueryFilter {
  field: string;
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains' | 'array-contains-any';
  value: any;
}
```

**Limitations for Namespace Use Case**:
- ❌ `array-contains-any`: Checks if array contains ANY of the values (not if value is in ANY of the arrays) - **semantics mismatch**
- ❌ No array overlap operator: Can't query "tools in namespaces A OR B"
- ❌ No prefix matching: Can't query "tools in platform/* (all sub-namespaces)"

---

## Proposed Extension

### New Operators

Add two new query operators to `QueryFilter.operator` union type:

```typescript
export interface QueryFilter {
  field: string;
  operator:
    | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
    | 'array-contains' | 'array-contains-any'
    | 'array-overlap'        // NEW: Array overlap (intersection non-empty)
    | 'array-prefix-match';  // NEW: Prefix matching within array elements
  value: any;
}
```

---

## Operator Semantics

### `array-overlap` (Array Intersection)

**Purpose**: Check if document's array field has ANY elements in common with query array.

**Use case**: "Find tools in namespaces A OR B OR C"

**Example**:
```typescript
// Query tools in 'platform/admin' OR 'domain/creative'
await store.query<ToolRegistryDocument>('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-overlap',
    value: ['platform/admin', 'domain/creative']
  }]
});

// Returns tools where:
// tool.namespaces ∩ ['platform/admin', 'domain/creative'] ≠ ∅
```

**PostgreSQL Implementation**:
```typescript
case 'array-overlap':
  // JSONB ?| operator: Check if any array elements match
  // Equivalent to: namespaces && ARRAY['platform/admin', 'domain/creative']
  return `data->'${field}' ?| $${paramIndex}`;
```

**Firestore Implementation**:
```typescript
case 'array-overlap':
  // Firestore array-contains-any does exactly this!
  // Query each namespace separately, union results
  const queries = filter.value.map(ns =>
    collection.where(field, 'array-contains', ns)
  );
  // Return union of all queries
```

**Performance**:
- PostgreSQL: Uses GIN index on JSONB array (O(log n))
- Firestore: Native `array-contains-any` operator (indexed)

---

### `array-prefix-match` (Hierarchical Prefix)

**Purpose**: Check if any element in document's array starts with given prefix.

**Use case**: "Find tools in 'platform' namespace and all sub-namespaces (platform/*, platform/*/*)"

**Example**:
```typescript
// Query tools in 'platform' and all sub-namespaces
await store.query<ToolRegistryDocument>('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-prefix-match',
    value: 'platform'  // Matches 'platform', 'platform/admin', 'platform/admin/config'
  }]
});

// Returns tools where:
// ANY element in tool.namespaces starts with 'platform'
```

**PostgreSQL Implementation**:
```typescript
case 'array-prefix-match':
  // Use jsonb_array_elements_text + LIKE for prefix matching
  return `EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(data->'${field}') AS elem
    WHERE elem = $${paramIndex} OR elem LIKE $${paramIndex} || '/%'
  )`;
```

**Firestore Implementation**:
```typescript
case 'array-prefix-match':
  // Firestore doesn't support prefix on array elements natively
  // Workaround: Fetch all documents, filter in-memory
  // OR: Denormalize by storing namespace prefixes separately
  // (e.g., namespacesPrefixes: ['platform', 'platform/admin'])

  // Option 1: In-memory filter (acceptable for <10k docs)
  const allDocs = await collection.get();
  return allDocs.docs
    .filter(doc => {
      const arr = doc.data()[field] || [];
      return arr.some(elem =>
        elem === prefix || elem.startsWith(prefix + '/')
      );
    })
    .map(doc => doc.data());
```

**Performance**:
- PostgreSQL: Uses subquery with LIKE (slower than GIN, but <100ms for 505 tools)
- Firestore: In-memory filter (acceptable for <10k documents)

---

## Implementation Plan

### Phase 1: Interface Extension (30 minutes)

**File to modify**: `src/common/persistence/interfaces.ts`

```typescript
/**
 * Query filter for document queries
 */
export interface QueryFilter {
  field: string;
  operator:
    | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
    | 'array-contains' | 'array-contains-any'
    | 'array-overlap'        // Array intersection (PostgreSQL: ?|, Firestore: array-contains-any per element)
    | 'array-prefix-match';  // Prefix matching within array (PostgreSQL: LIKE subquery, Firestore: in-memory)
  value: any;
}
```

---

### Phase 2: PostgreSQL Implementation (1-2 hours)

**File to modify**: `src/common/persistence/postgres-store.ts`

**Location**: Update `buildWhereClause()` method (around line 456-503)

```typescript
private buildWhereClause(filter: QueryFilter, paramIndex: number): string {
  const field = filter.field;
  const operator = filter.operator;
  const isDateValue = this.isDateString(filter.value);
  const isBooleanValue = typeof filter.value === 'boolean';

  switch (operator) {
    // ... existing cases ...

    case 'array-overlap':
      // PostgreSQL ?| operator: Check if JSONB array overlaps with query array
      // Equivalent to native: namespaces && ARRAY['ns1', 'ns2']
      return `data->'${field}' ?| $${paramIndex}`;

    case 'array-prefix-match':
      // Check if any array element starts with prefix
      // Supports hierarchical queries: 'platform' matches 'platform', 'platform/admin', etc.
      return `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(data->'${field}') AS elem
        WHERE elem = $${paramIndex} OR elem LIKE $${paramIndex} || '/%'
      )`;

    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}
```

**Testing**:
```typescript
// test: array-overlap
const tools = await store.query('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-overlap',
    value: ['platform/admin', 'domain/creative']
  }]
});
expect(tools.every(t =>
  t.namespaces.includes('platform/admin') ||
  t.namespaces.includes('domain/creative')
)).toBe(true);

// test: array-prefix-match
const platformTools = await store.query('platform_tool_registry', {
  filters: [{
    field: 'namespaces',
    operator: 'array-prefix-match',
    value: 'platform'
  }]
});
expect(platformTools.every(t =>
  t.namespaces.some(ns => ns === 'platform' || ns.startsWith('platform/'))
)).toBe(true);
```

---

### Phase 3: Firestore Implementation (Optional, 2-3 hours)

**File to modify**: `src/common/persistence/firestore-store.ts` (if exists)

**Strategy**:
- `array-overlap`: Use Firestore's native `array-contains-any` (up to 10 elements)
- `array-prefix-match`: Fetch all, filter in-memory (acceptable for <10k docs)

**Implementation**:
```typescript
// Firestore array-overlap (leverages native operator)
case 'array-overlap':
  if (filter.value.length > 10) {
    throw new Error('Firestore array-contains-any supports max 10 values');
  }
  // Firestore array-contains-any: check if array contains ANY of these values
  query = query.where(filter.field, 'array-contains-any', filter.value);
  break;

// Firestore array-prefix-match (in-memory filter)
case 'array-prefix-match':
  // Fetch all documents, filter client-side
  // (Firestore doesn't support prefix on array elements)
  needsClientSideFilter = true;
  clientSideFilters.push(filter);
  break;
```

**Note**: Firestore implementation is optional for tool namespace use case since tool-orchestrator uses PostgreSQL exclusively.

---

## Usage in Tool Namespace Implementation

### Query Tools by Namespaces (Exact Match)

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

### Query Tools by Namespace Prefix (Hierarchical)

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

## Performance Validation

### Benchmark Queries

**Setup**:
```sql
-- Create test data (500 tools with namespaces)
INSERT INTO platform_tool_registry (id, data)
SELECT
  'tool-' || i,
  jsonb_build_object(
    'id', 'tool-' || i,
    'canonicalName', 'tool-' || i,
    'namespaces', (
      CASE WHEN i % 2 = 0
        THEN '["platform/admin", "platform/config"]'
        ELSE '["domain/creative", "domain/image"]'
      END
    )::jsonb
  )
FROM generate_series(1, 500) AS i;

-- Create GIN index on namespaces (in JSONB data column)
CREATE INDEX idx_tool_registry_data_namespaces ON platform_tool_registry
USING GIN ((data->'namespaces'));
```

**Benchmark 1: array-overlap (exact match)**
```sql
EXPLAIN ANALYZE
SELECT * FROM platform_tool_registry
WHERE data->'namespaces' ?| ARRAY['platform/admin', 'domain/creative'];

-- Expected: Bitmap Index Scan using idx_tool_registry_data_namespaces
-- Execution time: < 50ms
```

**Benchmark 2: array-prefix-match (hierarchical)**
```sql
EXPLAIN ANALYZE
SELECT * FROM platform_tool_registry
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(data->'namespaces') AS elem
  WHERE elem = 'platform' OR elem LIKE 'platform/%'
);

-- Expected: Seq Scan (no index for LIKE in subquery)
-- Execution time: < 100ms (acceptable for 505 tools)
```

**Performance targets**:
- `array-overlap`: < 50ms (95th percentile)
- `array-prefix-match`: < 100ms (95th percentile)

---

## Migration Path

### Backward Compatibility

**Guarantee**: Existing DocumentStore implementations continue working without changes.

**Strategy**:
1. Add new operators to interface (non-breaking addition)
2. Implement in PostgresDocumentStore (required for tool-orchestrator)
3. Mark Firestore implementation as optional (tool-orchestrator doesn't use Firestore)
4. Add operator validation in base interface (throw helpful error if not supported)

**Fallback for unsupported backends**:
```typescript
// In DocumentStore implementations
buildWhereClause(filter: QueryFilter, paramIndex: number): string {
  switch (filter.operator) {
    case 'array-overlap':
      if (!this.supportsArrayOverlap) {
        throw new Error(
          'array-overlap operator not supported by this backend. ' +
          'Use array-contains with multiple queries instead.'
        );
      }
      // ... implementation

    case 'array-prefix-match':
      if (!this.supportsArrayPrefixMatch) {
        throw new Error(
          'array-prefix-match operator not supported by this backend. ' +
          'Fetch all documents and filter in-memory instead.'
        );
      }
      // ... implementation
  }
}
```

---

## Testing Plan

### Unit Tests

**File to create**: `src/common/persistence/__tests__/array-operators.test.ts`

```typescript
describe('DocumentStore Array Operators', () => {
  let store: PostgresDocumentStore;

  beforeAll(async () => {
    store = await createTestDocumentStore();
    await seedTestData(store);
  });

  describe('array-overlap', () => {
    it('should return documents with any matching array element', async () => {
      const results = await store.query('test_collection', {
        filters: [{
          field: 'tags',
          operator: 'array-overlap',
          value: ['tag1', 'tag2']
        }]
      });

      expect(results.every(doc =>
        doc.tags.includes('tag1') || doc.tags.includes('tag2')
      )).toBe(true);
    });

    it('should return empty array when no overlap', async () => {
      const results = await store.query('test_collection', {
        filters: [{
          field: 'tags',
          operator: 'array-overlap',
          value: ['nonexistent']
        }]
      });

      expect(results.length).toBe(0);
    });
  });

  describe('array-prefix-match', () => {
    it('should match exact prefix', async () => {
      const results = await store.query('test_collection', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'platform'
        }]
      });

      expect(results.every(doc =>
        doc.namespaces.some(ns => ns === 'platform')
      )).toBe(true);
    });

    it('should match hierarchical paths', async () => {
      const results = await store.query('test_collection', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'platform'
        }]
      });

      const hasSubnamespaces = results.some(doc =>
        doc.namespaces.some(ns => ns.startsWith('platform/'))
      );
      expect(hasSubnamespaces).toBe(true);
    });

    it('should not match unrelated prefixes', async () => {
      const results = await store.query('test_collection', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'domain'
        }]
      });

      expect(results.every(doc =>
        !doc.namespaces.some(ns => ns.startsWith('platform'))
      )).toBe(true);
    });
  });

  describe('performance', () => {
    it('should execute array-overlap in < 50ms', async () => {
      const start = Date.now();
      await store.query('platform_tool_registry', {
        filters: [{
          field: 'namespaces',
          operator: 'array-overlap',
          value: ['platform/admin', 'domain']
        }]
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it('should execute array-prefix-match in < 100ms', async () => {
      const start = Date.now();
      await store.query('platform_tool_registry', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'platform'
        }]
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
```

---

## Alternatives Considered

### Alternative 1: Direct SQL in ToolRegistry

**Pros**: Better performance, explicit schema
**Cons**: Breaks abstraction, Firestore incompatible, inconsistent architecture

**Decision**: ❌ Rejected - Violates BitBrat's architectural principles

---

### Alternative 2: Fetch All, Filter In-Memory

**Pros**: No interface changes needed
**Cons**: Doesn't scale beyond 10k documents, inefficient

**Decision**: ⚠️ Acceptable fallback for Firestore, but prefer server-side filtering

---

### Alternative 3: Denormalize Namespace Prefixes

**Example**: Store both `namespaces` and `namespacePrefixes` arrays
```json
{
  "namespaces": ["platform/admin/config"],
  "namespacePrefixes": ["platform", "platform/admin", "platform/admin/config"]
}
```

**Pros**: Fast prefix queries with `array-contains`
**Cons**: Data duplication, complex updates, storage overhead

**Decision**: ❌ Over-engineering for 505 tools

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| `array-overlap` latency | < 50ms (95th %ile) | EXPLAIN ANALYZE benchmark |
| `array-prefix-match` latency | < 100ms (95th %ile) | EXPLAIN ANALYZE benchmark |
| Backward compatibility | 100% (no breaking changes) | Run existing test suite |
| Test coverage | >90% for new operators | Jest coverage report |

---

## Open Questions

1. **Firestore implementation priority**: Required or optional?
   - **Recommendation**: Optional (tool-orchestrator uses PostgreSQL exclusively)

2. **GIN index on JSONB array**: Create automatically or require manual setup?
   - **Recommendation**: Document in migration guide, don't auto-create (migration responsibility)

3. **Multiple prefix matching**: Support `value: ['platform', 'domain']` for prefix-match?
   - **Recommendation**: Yes, but implement as OR of multiple EXISTS subqueries

---

## Approval & Sign-off

**Reviewed By**: TBD
**Approved By**: TBD
**Implementation Sprint**: Sprint 1 (Namespace Foundation)
**Target Completion**: Sprint 1 completion

---

**End of Proposal**
