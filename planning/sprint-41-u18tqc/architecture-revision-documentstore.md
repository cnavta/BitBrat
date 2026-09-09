# Architecture Revision: DocumentStore Pattern for Compositions

**Date**: 2026-09-02
**Author**: Architect (Claude)
**Status**: Correction

---

## Issue Identified

The original technical architecture specified traditional PostgreSQL tables for composition storage. However, **BitBrat uses the DocumentStore pattern** throughout the platform, which provides:

- Vendor-neutral abstraction (Firestore or PostgreSQL backend)
- Document-oriented storage (JSONB in PostgreSQL)
- Collection-based organization
- Unified query interface

This revision corrects the architecture to align with platform patterns.

---

## Revised: Composition Storage (DocumentStore Pattern)

### Collection Schema

**Collection**: `compositions`

**Document Structure**:

```typescript
interface CompositionDocument {
  // Primary fields
  id: string;                        // UUID
  name: string;                      // Logical name (unique)
  version: number;                   // Version number
  status: 'draft' | 'active' | 'archived';

  // Source
  sourceYaml: string;                // Original YAML
  canonicalAst: CompositionSpec;     // Canonical JSON representation

  // Schemas
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  contextSchema?: JSONSchema;

  // Metadata
  description?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;

  // Compilation
  contentHash: string;               // SHA-256 of canonical AST
  compiledAt: string;                // ISO 8601 timestamp
  dependencies: ToolDependency[];    // Array of {toolId, schemaFingerprint}

  // Audit
  createdAt: string;                 // ISO 8601 timestamp
  updatedAt: string;                 // ISO 8601 timestamp
}
```

### Revised Registry Implementation

**File**: `src/common/composition/registry.ts`

```typescript
import { IDocumentStore, QueryOptions } from '../persistence/interfaces';
import { CompiledComposition, CompositionDefinition } from './types';
import { randomUUID } from 'crypto';

export interface CompositionRegistry {
  create(compiled: CompositionDefinition, sourceYaml: string): Promise<string>;
  get(id: string): Promise<CompiledComposition | null>;
  getByName(name: string): Promise<CompiledComposition | null>;
  listActive(): Promise<CompiledComposition[]>;
  updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * DocumentStore-based composition registry.
 * Works with both Firestore and PostgreSQL backends.
 */
export class DocumentStoreCompositionRegistry implements CompositionRegistry {
  private readonly collection = 'compositions';

  constructor(private documentStore: IDocumentStore) {}

  async create(compiled: CompiledComposition, sourceYaml: string): Promise<string> {
    const id = randomUUID();

    const doc: CompositionDocument = {
      id,
      name: compiled.metadata.name,
      version: compiled.metadata.version || 1,
      status: 'active',
      sourceYaml,
      canonicalAst: compiled.spec,
      inputSchema: compiled.spec.inputSchema,
      outputSchema: compiled.spec.outputSchema,
      contextSchema: compiled.spec.contextSchema,
      description: compiled.metadata.description,
      labels: compiled.metadata.labels,
      annotations: compiled.metadata.annotations,
      contentHash: compiled.contentHash,
      compiledAt: new Date().toISOString(),
      dependencies: compiled.dependencies,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.documentStore.set(this.collection, id, doc);

    return id;
  }

  async get(id: string): Promise<CompiledComposition | null> {
    const doc = await this.documentStore.get<CompositionDocument>(this.collection, id);

    if (!doc) {
      return null;
    }

    return this.docToCompiled(doc);
  }

  async getByName(name: string): Promise<CompiledComposition | null> {
    // Query for active composition with matching name
    const results = await this.documentStore.query<CompositionDocument>(
      this.collection,
      {
        filters: [
          { field: 'name', operator: '==', value: name },
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: { field: 'version', direction: 'desc' },
        limit: 1,
      }
    );

    if (results.length === 0) {
      return null;
    }

    return this.docToCompiled(results[0]);
  }

  async listActive(): Promise<CompiledComposition[]> {
    const results = await this.documentStore.query<CompositionDocument>(
      this.collection,
      {
        filters: [
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: { field: 'name', direction: 'asc' },
      }
    );

    return results.map(doc => this.docToCompiled(doc));
  }

  async updateStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<void> {
    const doc = await this.documentStore.get<CompositionDocument>(this.collection, id);

    if (!doc) {
      throw new Error(`Composition not found: ${id}`);
    }

    // Merge update using DocumentStore's merge capability
    await this.documentStore.set(
      this.collection,
      id,
      {
        status,
        updatedAt: new Date().toISOString(),
      },
      true  // merge = true (preserves other fields)
    );
  }

  async delete(id: string): Promise<void> {
    await this.documentStore.delete(this.collection, id);
  }

  private docToCompiled(doc: CompositionDocument): CompiledComposition {
    return {
      id: doc.id,
      metadata: {
        name: doc.name,
        version: doc.version,
        description: doc.description,
        labels: doc.labels,
        annotations: doc.annotations,
      },
      spec: doc.canonicalAst,
      compiledAt: new Date(doc.compiledAt),
      contentHash: doc.contentHash,
      dependencies: doc.dependencies,
      validationReport: {
        valid: true,
        errors: [],
        warnings: [],
      },
    };
  }
}
```

---

## Migration Strategy

### No Traditional SQL Migration Needed

**Key Insight**: The DocumentStore abstraction handles schema automatically.

**For PostgreSQL Backend**:
- Documents stored in a generic `documents` table with JSONB
- Collection name is a discriminator column
- Indexes created automatically via DocumentStore configuration

**For Firestore Backend**:
- Documents stored in `compositions` collection
- No schema required (schemaless)

### DocumentStore Backend Configuration

The DocumentStore already exists and is initialized by the platform. Compositions just use a new collection name.

**Existing PostgreSQL Schema** (already present):

```sql
-- Generic documents table (already exists in platform)
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_documents_data_gin ON documents USING GIN(data);

-- Specific index for compositions collection (optional optimization)
CREATE INDEX IF NOT EXISTS idx_compositions_name
  ON documents ((data->>'name'))
  WHERE collection = 'compositions';

CREATE INDEX IF NOT EXISTS idx_compositions_status
  ON documents ((data->>'status'))
  WHERE collection = 'compositions';
```

**Migration File** (minimal):

```sql
-- infrastructure/sql/migrations/001_composition_indexes.sql
-- Add optimized indexes for compositions collection

-- Index on name field for fast lookup
CREATE INDEX IF NOT EXISTS idx_compositions_name
  ON documents ((data->>'name'))
  WHERE collection = 'compositions';

-- Index on status field for filtering
CREATE INDEX IF NOT EXISTS idx_compositions_status
  ON documents ((data->>'status'))
  WHERE collection = 'compositions';

-- Index on contentHash for deduplication
CREATE INDEX IF NOT EXISTS idx_compositions_content_hash
  ON documents ((data->>'contentHash'))
  WHERE collection = 'compositions';

-- Composite index for active compositions by name
CREATE INDEX IF NOT EXISTS idx_compositions_active_name
  ON documents ((data->>'status'), (data->>'name'))
  WHERE collection = 'compositions' AND (data->>'status') = 'active';
```

---

## Revised Tool-Gateway Integration

**File**: `src/apps/tool-gateway.ts`

```typescript
export class ToolGatewayServer extends Bit {
  private compositionRegistry: CompositionRegistry;
  private compositionExecutor: CompositionExecutor;

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });

    // Get DocumentStore from resources (already initialized by Bit)
    const documentStore = this.getResource<IDocumentStore>('documentStore');

    if (!documentStore) {
      this.getLogger().warn('tool_gateway.composition.disabled', {
        reason: 'DocumentStore not available',
      });
      // Graceful degradation - compositions disabled
      return;
    }

    // Initialize composition subsystem using DocumentStore
    this.compositionRegistry = new DocumentStoreCompositionRegistry(documentStore);
    this.compositionExecutor = new CompositionExecutor(this.registry, this.getLogger());

    this.setupApp(this.getApp() as any);
    this.registerGatewayTools();
  }

  async setup(): Promise<void> {
    await super.setup();

    // Load compositions only if registry initialized
    if (this.compositionRegistry) {
      await this.loadCompositions();
    }
  }

  // ... rest of implementation unchanged
}
```

---

## Advantages of DocumentStore Pattern

### 1. **Vendor Neutrality**
- Same code works with Firestore or PostgreSQL
- Easy migration between backends
- No backend-specific SQL

### 2. **Schema Flexibility**
- Documents can evolve without migrations
- Adding fields is just adding properties
- No ALTER TABLE needed

### 3. **Platform Consistency**
- Matches existing patterns (event-router, scheduler, etc.)
- Familiar API for platform developers
- Reuses existing DocumentStore infrastructure

### 4. **Query Capabilities**
- Rich filtering via QueryOptions
- Field-based ordering
- Pagination support
- GIN indexes on JSONB for fast queries

### 5. **Simplified Testing**
- Mock DocumentStore easily
- In-memory implementation for tests
- No database setup required for unit tests

---

## Updated Task Breakdown

### Revised Tasks

**COMP-002** (was: Create PostgreSQL Schema):
- **New Title**: Create DocumentStore indexes for compositions
- **New Effort**: 0.5h (reduced from 1h)
- **New Files**:
  - `infrastructure/sql/migrations/001_composition_indexes.sql` (optional optimization)
- **New Subtasks**:
  - Create index on name field
  - Create index on status field
  - Create index on contentHash field
  - Create composite index for active compositions
  - Test index performance (optional)

**COMP-010** (was: Create PostgreSQL Migration):
- **New Title**: Verify DocumentStore collection setup
- **New Effort**: 0.5h (reduced from 1h)
- **New Subtasks**:
  - Verify `documentStore` resource available in tool-gateway
  - Test document creation in `compositions` collection
  - Test document retrieval
  - Test query operations
  - Optional: Add performance indexes

**COMP-011** (was: Implement PostgresCompositionRegistry):
- **New Title**: Implement DocumentStoreCompositionRegistry
- **New Effort**: 3h (reduced from 4h)
- **New Implementation**: Use IDocumentStore interface (see above)

**COMP-012** (Registry Tests):
- **New Setup**: Mock IDocumentStore instead of PostgreSQL
- **New Effort**: 2h (reduced from 3h)

---

## Example: DocumentStore Operations

### Create Composition

```typescript
const registry = new DocumentStoreCompositionRegistry(documentStore);

const id = await registry.create(compiled, sourceYaml);
// Internally: documentStore.set('compositions', id, doc)
```

### Get by Name

```typescript
const comp = await registry.getByName('viewer_greeting');
// Internally: documentStore.query('compositions', {
//   filters: [
//     { field: 'name', operator: '==', value: 'viewer_greeting' },
//     { field: 'status', operator: '==', value: 'active' }
//   ]
// })
```

### List Active

```typescript
const compositions = await registry.listActive();
// Internally: documentStore.query('compositions', {
//   filters: [{ field: 'status', operator: '==', value: 'active' }]
// })
```

### Update Status

```typescript
await registry.updateStatus(id, 'archived');
// Internally: documentStore.set('compositions', id,
//   { status: 'archived', updatedAt: ... },
//   true  // merge = true
// )
```

---

## Testing Strategy

### Unit Tests

```typescript
// Mock DocumentStore for isolated testing
const mockStore: IDocumentStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  query: jest.fn(),
  getAll: jest.fn(),
  watch: jest.fn(),
  batch: jest.fn(),
  health: jest.fn(),
};

const registry = new DocumentStoreCompositionRegistry(mockStore);

// Test create
await registry.create(compiled, sourceYaml);
expect(mockStore.set).toHaveBeenCalledWith(
  'compositions',
  expect.any(String),
  expect.objectContaining({ name: 'test-composition' })
);
```

### Integration Tests

```typescript
// Use real DocumentStore (PostgreSQL or in-memory)
const documentStore = new PostgresDocumentStore(config);
const registry = new DocumentStoreCompositionRegistry(documentStore);

// Full CRUD lifecycle
const id = await registry.create(compiled, sourceYaml);
const retrieved = await registry.get(id);
expect(retrieved?.metadata.name).toBe('test-composition');
```

---

## Migration from Original Architecture

### Files to Update

| Original | Revised |
|----------|---------|
| `infrastructure/sql/compositions.sql` | `infrastructure/sql/migrations/001_composition_indexes.sql` |
| `src/common/composition/registry.ts` (PostgreSQL) | `src/common/composition/registry.ts` (DocumentStore) |

### Changes Required

1. **Remove**: Traditional table definitions
2. **Add**: Optional GIN indexes for performance
3. **Update**: Registry implementation to use IDocumentStore
4. **Update**: Tests to mock IDocumentStore
5. **Update**: Tool-gateway integration to use documentStore resource

### Effort Impact

| Task | Original Effort | Revised Effort | Savings |
|------|----------------|----------------|---------|
| COMP-002 (Schema) | 1h | 0.5h | -0.5h |
| COMP-010 (Migration) | 1h | 0.5h | -0.5h |
| COMP-011 (Registry) | 4h | 3h | -1h |
| COMP-012 (Tests) | 3h | 2h | -1h |
| **Total** | **9h** | **6h** | **-3h** |

**Net benefit**: 3 hours saved, simpler implementation, better platform alignment.

---

## Summary

### Why This Matters

1. **Platform Consistency**: Matches existing persistence patterns
2. **Flexibility**: Works with both Firestore and PostgreSQL
3. **Simplicity**: No custom SQL schema needed
4. **Testing**: Easier to mock and test
5. **Performance**: GIN indexes provide fast JSONB queries

### What Changes

- ❌ No traditional PostgreSQL tables
- ❌ No custom SQL schema
- ✅ Use DocumentStore abstraction
- ✅ Documents in `compositions` collection
- ✅ Optional performance indexes
- ✅ Simplified implementation (3h saved)

### Action Items

1. Update `COMP-002`, `COMP-010`, `COMP-011`, `COMP-012` in backlog
2. Use DocumentStore implementation pattern
3. Create optional index migration (not required, just optimization)
4. Update technical architecture document with this revision

---

**End of Architecture Revision**
