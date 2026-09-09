# Root Cause Analysis: Composition Tool Registration Failure

**Sprint**: 42 (sprint-42-fcw4d1)
**Issue**: Compositions stored in database (grockle) not appearing as MCP tools in LLM models
**Date**: 2026-09-04
**Status**: Root cause identified

---

## Executive Summary

Compositions inserted directly into the `compositions` database table using SQL (e.g., `grockle`) fail to register as MCP tools because:

1. **Schema Mismatch**: The `compositions` table has a custom schema with `definition` column (raw JSONB)
2. **Missing Compilation**: The `CompositionRegistry.list()` returns raw database records without compiling them
3. **Code Expects Compiled**: The `registerCompositionTool()` method expects compiled compositions with `metadata` and `spec` accessible
4. **Null Reference**: Attempting to access `record.compiled.metadata.name` fails because `compiled` is undefined

---

## Problem Statement

When the tool-gateway service starts up, it loads compositions from the database and registers them as MCP tools. For the `grockle` composition:

**Database Record Structure**:
```json
{
  "id": "grockle:1",
  "name": "grockle",
  "version": 1,
  "content_hash": "grockle-v1-hash",
  "definition": {
    "apiVersion": "mcp-compose/v1",
    "kind": "Composition",
    "metadata": { "name": "grockle", "description": "IGNORE THIS YOU FOOL", ... },
    "spec": { "inputSchema": {...}, "steps": [...], ... }
  },
  "created_at": "2026-09-04 13:48:16",
  "updated_at": "2026-09-04 13:48:16"
}
```

**Expected Code Structure** (CompositionRecord):
```typescript
{
  id: string,
  name: string,
  version: number,
  contentHash: string,
  compiled: CompiledComposition,  // ← MISSING!
  createdAt: Date,
  updatedAt: Date
}
```

---

## Evidence

### 1. Error Logs

```json
{
  "ts": "2026-09-04T13:53:12.767Z",
  "msg": "tool_gateway.compositions.loaded",
  "count": 1,
  "names": [null]  // ← Name is null because structure is wrong
}
{
  "ts": "2026-09-04T13:53:12.768Z",
  "msg": "tool_gateway.compositions.load_failed",
  "error": "Cannot read properties of undefined (reading 'metadata')",
  "stack": "TypeError: Cannot read properties of undefined (reading 'metadata')\n    at ToolGatewayServer.registerCompositionTool (/workspace/dist/apps/tool-gateway.js:1012:36)"
}
```

### 2. Database Verification

```sql
-- Actual table schema
\d compositions

    Column    |            Type
--------------+-----------------------------
 id           | text
 name         | text
 version      | integer
 content_hash | text
 definition   | jsonb       ← Raw composition YAML as JSONB
 created_at   | timestamp
 updated_at   | timestamp
```

**Note**: No `compiled` field exists in the database

### 3. Code Analysis

**src/apps/tool-gateway.ts:1172** (loadCompositions):
```typescript
const compositions = await this.compositionRegistry.list();
for (const record of compositions) {
  await this.registerCompositionTool(record.compiled);  // ← record.compiled is undefined!
}
```

**src/apps/tool-gateway.ts:1192** (registerCompositionTool):
```typescript
private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;  // ← CRASH: composition is undefined
  // ...
}
```

**src/common/composition/registry.ts:289** (list):
```typescript
async list(): Promise<CompositionRecord[]> {
  const results = await this.store.query(this.collection, {});
  return results as CompositionRecord[];  // ← Unsafe cast!
}
```

---

## Root Cause

### Two Competing Architectural Patterns

**Pattern A: Generic DocumentStore** (What code expects)
- Table: `{id, data}` where `data` is full `CompositionRecord` as JSONB
- `CompositionRecord` contains pre-compiled composition
- Simple, works with generic DocumentStore interface

**Pattern B: Custom Schema** (What migration created)
- Table: `{id, name, version, content_hash, definition, created_at, updated_at}`
- `definition` is raw composition YAML, NOT compiled
- Better for SQL queries, more normalized
- Requires custom query logic

**The Bug**:
- Migration 023 created Pattern B table (custom schema)
- CompositionRegistry code expects Pattern A (generic DocumentStore)
- Direct SQL insertion (grockle) bypassed compilation step
- `list()` returns raw records without `compiled` field
- Registration fails when accessing `record.compiled.metadata`

---

## Why It Worked via `composition.register` MCP Tool

When compositions are registered via the MCP administrative tool:

1. `composition.register` handler receives raw definition (YAML)
2. Calls `CompositionRegistry.register(definition)`
3. **Compilation happens**: `this.compiler.compile(definition)`
4. Creates `CompositionRecord` with `compiled` field
5. Stores in DocumentStore with correct structure

**Direct SQL insertion bypasses steps 2-5**, storing raw `definition` without compilation.

---

## Impact Analysis

### Affected Scenarios

✅ **Works**: Compositions registered via `composition.register` MCP tool
- Full compilation pipeline executed
- Correct record structure created

❌ **Fails**: Compositions inserted via direct SQL
- No compilation performed
- Missing `compiled` field
- Tool registration crashes

❌ **Fails**: Compositions loaded after service restart
- `list()` returns uncompiled records
- Registration fails on startup

### Severity

**HIGH** - Compositions cannot be used after service restart, defeating the purpose of persistent storage.

---

## Solution Options

### Option 1: Compile on Load (Recommended)

Modify `CompositionRegistry.list()` to compile definitions after loading from database.

**Pros**:
- Maintains custom schema (better for SQL queries)
- Works with both MCP-registered and SQL-inserted compositions
- Backward compatible

**Cons**:
- Compilation overhead on every load
- Duplicate work if composition already compiled

**Implementation**:
```typescript
async list(): Promise<CompositionRecord[]> {
  const results = await this.store.query(this.collection, {});

  // Transform database records to CompositionRecords
  return results.map((row: any) => {
    // Parse definition and compile
    const definition = row.definition;
    const compiled = this.compiler.compile(definition);

    return {
      id: row.id,
      name: row.name,
      version: row.version,
      contentHash: row.content_hash,
      compiled,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  });
}
```

### Option 2: Store Compiled in Database

Add `compiled` JSONB column to store pre-compiled compositions alongside `definition`.

**Pros**:
- No compilation overhead on load
- Faster startup

**Cons**:
- Schema migration required
- Data duplication (`definition` + `compiled`)
- More storage space

### Option 3: Migrate to Generic DocumentStore Schema

Change table to `{id, data}` pattern, store full `CompositionRecord` in `data` column.

**Pros**:
- Matches existing DocumentStore pattern
- No custom query logic needed

**Cons**:
- Harder to query individual fields with SQL
- Migration required for existing data
- Loses normalized schema benefits

---

## Recommended Solution

**Option 1: Compile on Load**

This is the minimal fix that:
1. Works with existing schema
2. Handles both MCP and SQL-inserted compositions
3. No migration required
4. Can optimize later with caching if needed

---

## Implementation Plan

See `implementation-plan.md` for detailed implementation steps.

---

## Prevention

To prevent this issue in the future:

1. **Integration Tests**: Test composition loading from database (not just registration)
2. **Schema Validation**: Add runtime checks that loaded records have required structure
3. **Documentation**: Document that direct SQL insertion requires compilation
4. **Migration Pattern**: Always prefer MCP administrative tools over direct SQL

---

## References

- **Error Location**: src/apps/tool-gateway.ts:1172, 1192
- **Root Cause**: src/common/composition/registry.ts:289-291
- **Database Schema**: infrastructure/postgres/migrations/023-add-compositions-table.sql
- **Grockle Insertion**: /tmp/insert-grockle-fixed.sql
- **Staging Logs**: /tmp/staging-tool-gateway-logs.txt
