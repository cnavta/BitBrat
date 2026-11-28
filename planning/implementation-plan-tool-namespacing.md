# Implementation Plan: Hierarchical Tool Namespacing

**Author**: Lead Implementor
**Date**: 2026-11-27 (Updated)
**Status**: Ready for Execution
**Architecture Reference**: `planning/architecture-tool-segmentation-namespacing.md`
**Related Proposal**: `planning/proposal-documentstore-array-operators.md`

---

## Executive Summary

This implementation plan breaks down the hierarchical namespace system into **4 executable sprints** plus 1 ongoing monitoring phase. The system is currently **0% implemented** but leverages **~75-80% existing infrastructure** (PostgreSQL DocumentStore, JSONB arrays, GIN indexes, MCP patterns).

**Total Timeline**: 4-5 weeks (4 development sprints + ongoing monitoring)

**Key Success Metric**: llm-bot accesses all 510 tools (platform + domain) via dual-namespace connections, eliminating the 200-tool truncation issue.

**Architecture Decision**: Uses **DocumentStore interface** throughout (not direct SQL) to maintain BitBrat's persistence abstraction. Namespaces stored as JSONB arrays in existing `data` column. See `proposal-documentstore-array-operators.md` for operator design.

**New DocumentStore Operators**:
- `array-overlap`: Query tools in ANY of specified namespaces (e.g., platform OR domain)
- `array-prefix-match`: Query tools in namespace hierarchy (e.g., platform/*)

**Performance**: JSONB with GIN indexes sufficient for 505 tools (<50ms query time).

---

## Sprint Overview

| Sprint | Phase | Duration | Risk | Blockers | Validation |
|--------|-------|----------|------|----------|------------|
| **Sprint 1** | Schema Foundation | 1 week | LOW | None | 505 tools auto-categorized |
| **Sprint 2** | Dynamic Routing | 1 week | LOW | Sprint 1 | `/mcp/platform` returns 230 tools |
| **Sprint 3** | Client Integration | 1 week | LOW | Sprint 2 | llm-bot sees 510 tools |
| **Sprint 4** | Admin Tooling | 1 week | LOW | Sprint 3 | MCP admin tools functional |
| **Sprint 5** | Monitoring (ongoing) | Continuous | VERY LOW | Sprint 4 | Metrics dashboard live |

---

## Sprint 1: Schema Foundation & Auto-Categorization

### Sprint Goal

**Deliverable**: DocumentStore-compatible namespace system with all 505 existing tools auto-categorized into hierarchical namespaces using JSONB storage.

**Success Criteria**:
- ✅ DocumentStore interface extended with `array-overlap` and `array-prefix-match` operators
- ✅ PostgresDocumentStore implements new array operators
- ✅ Namespace metadata collection created (`platform_tool_namespaces`)
- ✅ All 505 tools have `namespaces` array populated (in JSONB `data` column)
- ✅ Platform tools: `['platform/admin', 'platform/config', ...]` (avg 2-3 namespaces)
- ✅ Domain tools: `['domain', 'domain/creative', ...]` (avg 1-2 namespaces)
- ✅ Array overlap queries execute < 50ms (validated via EXPLAIN ANALYZE)
- ✅ Zero tools in `uncategorized` namespace

### Prerequisites

- None (greenfield implementation)
- PostgreSQL DocumentStore initialized
- Existing `platform_tool_registry` collection with 505 tools
- **New**: DocumentStore array operators proposal approved

### Tasks

#### Task 1.1: Extend DocumentStore Interface (1 hour)

**File to modify**: `src/common/persistence/interfaces.ts`

**Implementation guidance**:

```typescript
/**
 * Query filter for document queries
 */
export interface QueryFilter {
  field: string;
  operator:
    | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
    | 'array-contains' | 'array-contains-any'
    | 'array-overlap'        // NEW: Array intersection (PostgreSQL: ?|)
    | 'array-prefix-match';  // NEW: Prefix matching within array elements
  value: any;
}
```

**Testing**:
```bash
# TypeScript compilation validates interface change
npm run build
```

**Risk**: VERY LOW (additive change, backward compatible)

---

#### Task 1.2: Implement Array Operators in PostgresDocumentStore (2-3 hours)

**File to modify**: `src/common/persistence/postgres-store.ts`

**Location**: Update `buildWhereClause()` method (around line 456-503)

**Implementation guidance**:

```typescript
private buildWhereClause(filter: QueryFilter, paramIndex: number): string {
  const field = filter.field;
  const operator = filter.operator;
  const isDateValue = this.isDateString(filter.value);
  const isBooleanValue = typeof filter.value === 'boolean';

  switch (operator) {
    // ... existing cases (==, !=, <, <=, >, >=, in, array-contains, array-contains-any) ...

    case 'array-overlap':
      // PostgreSQL ?| operator: Check if JSONB array overlaps with query array
      // Equivalent to native SQL: data->'namespaces' && ARRAY['ns1', 'ns2']
      // Returns true if ANY element in document array matches ANY element in query array
      return `data->'${field}' ?| $${paramIndex}`;

    case 'array-prefix-match':
      // Check if any array element starts with prefix
      // Supports hierarchical queries: 'platform' matches 'platform', 'platform/admin', etc.
      // Uses EXISTS subquery with jsonb_array_elements_text for element extraction
      return `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(data->'${field}') AS elem
        WHERE elem = $${paramIndex} OR elem LIKE $${paramIndex} || '/%'
      )`;

    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}
```

**GIN Index Optimization** (manual step, documented in migration guide):

```sql
-- Create GIN index on JSONB namespaces array for fast overlap queries
-- Note: This is on the JSONB data column, not a native TEXT[] column
CREATE INDEX IF NOT EXISTS idx_tool_registry_data_namespaces
ON platform_tool_registry USING GIN ((data->'namespaces'));
```

**Testing**:

Create unit test: `src/common/persistence/__tests__/array-operators.test.ts`

```typescript
import { createDocumentStore } from '../factory';
import { IDocumentStore } from '../interfaces';

describe('DocumentStore Array Operators', () => {
  let store: IDocumentStore;

  beforeAll(async () => {
    store = await createDocumentStore();

    // Seed test data
    await store.set('test_tools', 'tool1', {
      id: 'tool1',
      namespaces: ['platform/admin', 'platform/config'],
    });
    await store.set('test_tools', 'tool2', {
      id: 'tool2',
      namespaces: ['domain/creative', 'domain/image'],
    });
    await store.set('test_tools', 'tool3', {
      id: 'tool3',
      namespaces: ['platform', 'admin'],
    });
  });

  describe('array-overlap', () => {
    it('should return documents with any matching namespace', async () => {
      const results = await store.query('test_tools', {
        filters: [{
          field: 'namespaces',
          operator: 'array-overlap',
          value: ['platform/admin', 'domain/creative']
        }]
      });

      expect(results.length).toBe(2); // tool1 and tool2
      expect(results.map(r => r.id).sort()).toEqual(['tool1', 'tool2']);
    });

    it('should return empty when no overlap', async () => {
      const results = await store.query('test_tools', {
        filters: [{
          field: 'namespaces',
          operator: 'array-overlap',
          value: ['nonexistent']
        }]
      });

      expect(results.length).toBe(0);
    });
  });

  describe('array-prefix-match', () => {
    it('should match exact prefix', async () => {
      const results = await store.query('test_tools', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'platform'
        }]
      });

      // Should match tool1 (platform/admin, platform/config) and tool3 (platform)
      expect(results.length).toBe(2);
      expect(results.map(r => r.id).sort()).toEqual(['tool1', 'tool3']);
    });

    it('should match hierarchical paths', async () => {
      const results = await store.query('test_tools', {
        filters: [{
          field: 'namespaces',
          operator: 'array-prefix-match',
          value: 'platform/admin'
        }]
      });

      // Should match tool1 only (has platform/admin)
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('tool1');
    });
  });

  afterAll(async () => {
    await store.delete('test_tools', 'tool1');
    await store.delete('test_tools', 'tool2');
    await store.delete('test_tools', 'tool3');
  });
});
```

**Validation**:
```bash
npm test -- array-operators.test.ts
```

**Performance validation** (via PostgreSQL EXPLAIN):

```typescript
// Add to test suite
it('should execute array-overlap with GIN index', async () => {
  // This requires direct PostgreSQL access for EXPLAIN
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const result = await pool.query(
    `EXPLAIN ANALYZE
     SELECT * FROM platform_tool_registry
     WHERE data->'namespaces' ?| ARRAY['platform/admin', 'domain']`
  );

  // Verify GIN index is used
  const plan = result.rows.map(r => r['QUERY PLAN']).join('\n');
  expect(plan).toContain('Bitmap Index Scan');
  expect(plan).toContain('idx_tool_registry_data_namespaces');

  await pool.end();
});
```

**Risk**: LOW (read-only queries, GIN index ensures performance)

---

#### Task 1.3: Implement Namespace Assignment Logic (3-4 hours)

**File to modify**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Location**: Add new method after existing tool registration logic

**Implementation guidance**:

```typescript
/**
 * Auto-assign namespaces based on tool naming conventions and source metadata.
 *
 * Rules (priority order):
 * 1. Platform admin tools (bit.*, tool.*, model.*, composition.*) → platform namespaces
 * 2. Domain tools (MCP, composition source) → domain namespaces
 * 3. Semantic categorization (name patterns) → specialized namespaces
 * 4. Fallback: uncategorized (should be rare, log warning)
 */
private assignNamespaces(tool: ToolRegistryDocument): string[] {
  const namespaces: string[] = [];
  const name = tool.canonicalName;

  // Rule 1: Platform tools (bit.* prefix)
  if (name.startsWith('bit.')) {
    namespaces.push('platform/admin', 'platform'); // Always in platform hierarchy

    // Specialized sub-namespaces based on second segment
    if (name.startsWith('bit.config.')) {
      namespaces.push('platform/config', 'configuration');
    } else if (name.startsWith('bit.flags.')) {
      namespaces.push('platform/flags', 'feature-flags');
    } else if (name.startsWith('bit.log.')) {
      namespaces.push('platform/logging', 'logging');
    } else if (name === 'bit.info' || name === 'bit.health' || name === 'bit.readiness') {
      namespaces.push('platform/monitoring', 'monitoring');
    } else if (name === 'bit.drain' || name === 'bit.shutdown' || name === 'bit.restart') {
      namespaces.push('platform/lifecycle', 'admin');
    }
  }

  // Rule 2: Tool registry admin tools
  else if (name.startsWith('tool.')) {
    namespaces.push('platform/tools', 'platform/admin', 'tooling');
  }

  // Rule 3: Model registry admin tools
  else if (name.startsWith('model.')) {
    namespaces.push('platform/models', 'platform/admin', 'ai/models');
  }

  // Rule 4: Composition admin tools
  else if (name.startsWith('composition.')) {
    namespaces.push('platform/compositions', 'platform/admin', 'tooling');
  }

  // Rule 5: Domain tools (MCP or composition source)
  else if (tool.source === 'mcp' || tool.source === 'composition') {
    namespaces.push('domain'); // Top-level domain namespace

    // Semantic categorization based on tool name patterns
    const nameLower = name.toLowerCase();

    // Creative tools (image, video, audio generation)
    if (nameLower.includes('image') || nameLower.includes('generate') ||
        nameLower.includes('create') && (nameLower.includes('picture') || nameLower.includes('photo'))) {
      namespaces.push('domain/creative', 'domain/image', 'creative/image', 'ai/generation');
    }

    // Streaming tools (OBS, scene management)
    if (nameLower.includes('obs') || nameLower.includes('scene') || nameLower.includes('stream')) {
      namespaces.push('domain/streaming', 'platforms/obs', 'video/production');
    }

    // Video tools
    if (nameLower.includes('video')) {
      namespaces.push('domain/video', 'creative/video');
    }

    // Story/narrative tools
    if (nameLower.includes('story') || nameLower.includes('narrative') || nameLower.includes('plot')) {
      namespaces.push('domain/creative', 'domain/storytelling', 'creative/writing');
    }

    // Data/analytics tools
    if (nameLower.includes('data') || nameLower.includes('analytics') || nameLower.includes('query')) {
      namespaces.push('domain/data', 'domain/analytics');
    }
  }

  // Fallback: If no namespaces assigned, log warning and use uncategorized
  if (namespaces.length === 0) {
    this.logger.warn('tool_registry.namespace_assignment_failed', {
      toolId: tool.id,
      canonicalName: name,
      source: tool.source,
      fallback: 'uncategorized',
    });
    namespaces.push('uncategorized');
  }

  return namespaces;
}
```

**Testing**:

Create unit test: `src/apps/tool-orchestrator-service/modules/registry/__tests__/namespace-assignment.test.ts`

```typescript
import { ToolRegistry } from '../tool-registry';

describe('Namespace Assignment', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    // Initialize with mock dependencies
    registry = new ToolRegistry(mockDb, mockLogger);
  });

  it('should assign platform namespaces to bit.* tools', () => {
    const tool = {
      id: 'bit.config.get',
      canonicalName: 'bit.config.get',
      source: 'internal' as const,
      // ... other required fields
    };

    const namespaces = (registry as any).assignNamespaces(tool);

    expect(namespaces).toContain('platform/admin');
    expect(namespaces).toContain('platform/config');
    expect(namespaces).toContain('configuration');
    expect(namespaces).toContain('platform');
  });

  it('should assign domain namespaces to MCP tools', () => {
    const tool = {
      id: 'image.generate',
      canonicalName: 'image.generate',
      source: 'mcp' as const,
      // ... other required fields
    };

    const namespaces = (registry as any).assignNamespaces(tool);

    expect(namespaces).toContain('domain');
    expect(namespaces).toContain('domain/creative');
    expect(namespaces).toContain('domain/image');
  });

  it('should not use uncategorized for standard tools', () => {
    const platformTool = { canonicalName: 'bit.info', source: 'internal' as const };
    const domainTool = { canonicalName: 'custom.tool', source: 'mcp' as const };

    expect((registry as any).assignNamespaces(platformTool))
      .not.toContain('uncategorized');
    expect((registry as any).assignNamespaces(domainTool))
      .not.toContain('uncategorized');
  });
});
```

**Validation**:
```bash
npm test -- namespace-assignment.test.ts
```

**Risk**: LOW (pure function, no side effects, easy to test)

---

#### Task 1.4: Update Tool Registration to Populate Namespaces (2-3 hours)

**File to modify**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Location**: Modify `registerTool()` method (around line 41-64)

**Implementation guidance**:

```typescript
async registerTool(tool: ToolRegistryDocument): Promise<void> {
  // Auto-assign namespaces if not explicitly provided
  if (!tool.namespaces || tool.namespaces.length === 0) {
    tool.namespaces = this.assignNamespaces(tool);
    this.logger.debug('tool_registry.namespaces_auto_assigned', {
      toolId: tool.id,
      namespaces: tool.namespaces,
    });
  }

  // Validate namespace paths (format: lowercase alphanumeric + hyphen + slash)
  for (const ns of tool.namespaces) {
    if (!/^[a-z0-9\-\/]+$/.test(ns) || ns.startsWith('/') || ns.endsWith('/')) {
      throw new Error(`Invalid namespace path: ${ns} (must be lowercase alphanumeric with hyphens and slashes, no leading/trailing slashes)`);
    }
  }

  // Check for duplicates before registering
  const duplicates = await this.findDuplicates(tool);
  if (duplicates.length > 0) {
    this.logger.warn({
      toolId: tool.id,
      canonicalName: tool.canonicalName,
      existingTools: duplicates.map((t) => t.id),
    }, 'tool_registry.duplicate_detected');
    throw new Error(
      `Tool with canonical name "${tool.canonicalName}" already exists. Use resolveConflict() to merge.`
    );
  }

  // Insert/update tool using DocumentStore (namespaces stored in JSONB data column)
  await this.store.set('platform_tool_registry', tool.id, tool);

  // Update namespace metadata (tool counts)
  for (const ns of tool.namespaces) {
    await this.updateNamespaceToolCount(ns);
  }

  this.logger.info('tool_registry.tool_registered', {
    toolId: tool.id,
    canonicalName: tool.canonicalName,
    source: tool.source,
    namespaces: tool.namespaces,
  });
}

/**
 * Update tool count for a namespace (increment on tool registration).
 * Uses DocumentStore for namespace metadata persistence.
 */
private async updateNamespaceToolCount(namespacePath: string): Promise<void> {
  // Derive parent from path (e.g., 'platform/admin/config' → 'platform/admin')
  const parent = namespacePath.includes('/')
    ? namespacePath.substring(0, namespacePath.lastIndexOf('/'))
    : null;

  // Get current namespace metadata (if exists)
  const existing = await this.store.get<any>('platform_tool_namespaces', namespacePath);

  // Count tools in this namespace using array-overlap query
  const tools = await this.store.query<ToolRegistryDocument>('platform_tool_registry', {
    filters: [{
      field: 'namespaces',
      operator: 'array-overlap',
      value: [namespacePath]
    }]
  });

  // Upsert namespace metadata
  await this.store.set('platform_tool_namespaces', namespacePath, {
    path: namespacePath,
    displayName: existing?.displayName || this.generateDisplayName(namespacePath),
    description: existing?.description,
    icon: existing?.icon,
    owner: existing?.owner,
    tags: existing?.tags || [],
    parent,
    toolCount: tools.length,
    createdAt: existing?.createdAt || new Date(),
    lastUpdatedAt: new Date(),
  });
}

/**
 * Generate human-readable display name from namespace path
 */
private generateDisplayName(path: string): string {
  // 'platform/admin/config' → 'Platform Admin Config'
  return path
    .split('/')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
```

**Testing**:

Add integration test: `src/apps/tool-orchestrator-service/__tests__/tool-registration-with-namespaces.test.ts`

```typescript
it('should populate namespaces array on tool registration', async () => {
  const tool: ToolRegistryDocument = {
    id: 'test.tool.001',
    canonicalName: 'bit.config.get',
    source: 'internal',
    // ... other required fields
  };

  await registry.registerTool(tool);

  // Query back from database
  const result = await db.query(
    'SELECT namespaces FROM platform_tool_registry WHERE id = $1',
    ['test.tool.001']
  );

  expect(result.rows[0].namespaces).toContain('platform/admin');
  expect(result.rows[0].namespaces).toContain('platform/config');
});

it('should update namespace metadata tool counts', async () => {
  await registry.registerTool({ id: 'tool1', canonicalName: 'bit.config.get', source: 'internal' });
  await registry.registerTool({ id: 'tool2', canonicalName: 'bit.config.set', source: 'internal' });

  const result = await db.query(
    'SELECT tool_count FROM platform_tool_namespaces WHERE path = $1',
    ['platform/config']
  );

  expect(result.rows[0].tool_count).toBe(2);
});
```

**Validation**:
```bash
npm test -- tool-registration-with-namespaces.test.ts
```

**Risk**: MEDIUM (database writes, requires transaction safety, but backward compatible)

---

#### Task 1.5: Create Backfill Migration Script (2-3 hours)

**File to create**: `scripts/backfill-tool-namespaces.ts`

**Implementation guidance**:

```typescript
#!/usr/bin/env ts-node
/**
 * Backfill namespaces array for all existing tools in platform_tool_registry.
 * Uses DocumentStore interface for compatibility with BitBrat persistence layer.
 *
 * Usage:
 *   npm run backfill-namespaces -- [--dry-run]
 */

import { createDocumentStore } from '../src/common/persistence/factory';
import { IDocumentStore } from '../src/common/persistence/interfaces';
import { ToolRegistryDocument } from '../src/apps/tool-orchestrator-service/modules/types/tool-registry-document';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Initialize DocumentStore (uses DATABASE_URL from env)
  const store = await createDocumentStore();
  console.log('DocumentStore initialized');

  try {
    // Fetch all tools (DocumentStore interface)
    const allTools = await store.getAll<ToolRegistryDocument>('platform_tool_registry');
    console.log(`Found ${allTools.length} total tools`);

    // Filter tools without namespaces
    const toolsWithoutNamespaces = allTools.filter(t => !t.namespaces || t.namespaces.length === 0);
    console.log(`Found ${toolsWithoutNamespaces.length} tools without namespaces`);

    let updated = 0;
    const stats: Record<string, number> = {};

    for (const tool of toolsWithoutNamespaces) {
      const namespaces = assignNamespaces(tool);

      // Track stats
      for (const ns of namespaces) {
        stats[ns] = (stats[ns] || 0) + 1;
      }

      if (!dryRun) {
        // Update tool with namespaces using DocumentStore
        await store.set('platform_tool_registry', tool.id, {
          ...tool,
          namespaces,
          lastUpdatedAt: new Date(),
        });
      }

      console.log(`${dryRun ? '[DRY RUN] ' : ''}Updated ${tool.canonicalName}: ${namespaces.join(', ')}`);
      updated++;
    }

    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Updated ${updated} tools`);
    console.log('\nNamespace distribution:');
    Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .forEach(([ns, count]) => {
        console.log(`  ${ns}: ${count} tools`);
      });

    if (!dryRun) {
      // Rebuild namespace metadata
      console.log('\nRebuilding namespace metadata...');

      // Collect all unique namespaces from tools
      const updatedTools = await store.getAll<ToolRegistryDocument>('platform_tool_registry');
      const uniqueNamespaces = new Set<string>();
      updatedTools.forEach(t => {
        if (t.namespaces) {
          t.namespaces.forEach(ns => uniqueNamespaces.add(ns));
        }
      });

      console.log(`Creating metadata for ${uniqueNamespaces.size} namespaces...`);

      // Create metadata for each namespace
      for (const namespacePath of uniqueNamespaces) {
        // Derive parent from path
        const parent = namespacePath.includes('/')
          ? namespacePath.substring(0, namespacePath.lastIndexOf('/'))
          : null;

        // Count tools in this namespace using array-overlap
        const toolsInNamespace = await store.query<ToolRegistryDocument>('platform_tool_registry', {
          filters: [{
            field: 'namespaces',
            operator: 'array-overlap',
            value: [namespacePath]
          }]
        });

        // Generate display name (e.g., 'platform/admin' → 'Platform Admin')
        const displayName = namespacePath
          .split('/')
          .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(' ');

        // Store namespace metadata using DocumentStore
        await store.set('platform_tool_namespaces', namespacePath, {
          path: namespacePath,
          displayName,
          parent,
          toolCount: toolsInNamespace.length,
          createdAt: new Date(),
          lastUpdatedAt: new Date(),
          tags: [],
        });
      }

      console.log('Namespace metadata rebuilt');
    }

  } finally {
    console.log('Backfill complete');
  }
}

/**
 * Auto-assign namespaces based on tool naming conventions.
 * Copy of logic from ToolRegistry.assignNamespaces() (Task 1.3).
 */
function assignNamespaces(tool: ToolRegistryDocument): string[] {
  const namespaces: string[] = [];
  const name = tool.canonicalName;

  // Rule 1: Platform tools (bit.* prefix)
  if (name.startsWith('bit.')) {
    namespaces.push('platform/admin', 'platform');

    if (name.startsWith('bit.config.')) {
      namespaces.push('platform/config', 'configuration');
    } else if (name.startsWith('bit.flags.')) {
      namespaces.push('platform/flags', 'feature-flags');
    } else if (name.startsWith('bit.log.')) {
      namespaces.push('platform/logging', 'logging');
    } else if (name === 'bit.info' || name === 'bit.health' || name === 'bit.readiness') {
      namespaces.push('platform/monitoring', 'monitoring');
    } else if (name === 'bit.drain' || name === 'bit.shutdown' || name === 'bit.restart') {
      namespaces.push('platform/lifecycle', 'admin');
    }
  }

  // Rule 2: Tool registry admin
  else if (name.startsWith('tool.')) {
    namespaces.push('platform/tools', 'platform/admin', 'tooling');
  }

  // Rule 3: Model registry admin
  else if (name.startsWith('model.')) {
    namespaces.push('platform/models', 'platform/admin', 'ai/models');
  }

  // Rule 4: Composition admin
  else if (name.startsWith('composition.')) {
    namespaces.push('platform/compositions', 'platform/admin', 'tooling');
  }

  // Rule 5: Domain tools
  else if (tool.source === 'mcp' || tool.source === 'composition') {
    namespaces.push('domain');

    const nameLower = name.toLowerCase();

    // Creative tools
    if (nameLower.includes('image') || nameLower.includes('generate') ||
        nameLower.includes('create') && (nameLower.includes('picture') || nameLower.includes('photo'))) {
      namespaces.push('domain/creative', 'domain/image', 'creative/image', 'ai/generation');
    }

    // Streaming tools
    if (nameLower.includes('obs') || nameLower.includes('scene') || nameLower.includes('stream')) {
      namespaces.push('domain/streaming', 'platforms/obs', 'video/production');
    }

    // Video tools
    if (nameLower.includes('video')) {
      namespaces.push('domain/video', 'creative/video');
    }

    // Story/narrative tools
    if (nameLower.includes('story') || nameLower.includes('narrative') || nameLower.includes('plot')) {
      namespaces.push('domain/creative', 'domain/storytelling', 'creative/writing');
    }

    // Data/analytics tools
    if (nameLower.includes('data') || nameLower.includes('analytics') || nameLower.includes('query')) {
      namespaces.push('domain/data', 'domain/analytics');
    }
  }

  // Fallback
  if (namespaces.length === 0) {
    console.warn(`Warning: Tool ${name} could not be auto-categorized, using 'uncategorized'`);
    namespaces.push('uncategorized');
  }

  return namespaces;
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

**Usage**:
```bash
# Dry run first (preview changes)
npm run backfill-namespaces -- --dry-run

# Apply changes
npm run backfill-namespaces
```

**Validation**:
```bash
# Verify namespace distribution
psql $DATABASE_URL -c "
  SELECT unnest(namespaces) as namespace, COUNT(*) as tool_count
  FROM platform_tool_registry
  GROUP BY namespace
  ORDER BY tool_count DESC
  LIMIT 20
"

# Expected output:
# namespace         | tool_count
# ------------------|-----------
# platform/admin    | ~230
# platform          | ~230
# domain            | ~280
# admin             | ~230
# domain/creative   | ~80
# platform/config   | ~60
# ...
```

**Risk**: MEDIUM (bulk data modification, but reversible with rollback script)

---

### Sprint 1 Validation Checklist

Before marking Sprint 1 complete, verify:

- [ ] Schema migration applied successfully (no errors in PostgreSQL logs)
- [ ] GIN index exists: `\di idx_tool_registry_namespaces` returns index
- [ ] All 505 tools have non-empty `namespaces` array
- [ ] Zero tools in `uncategorized` namespace (or investigate exceptions)
- [ ] Platform tools avg 2-3 namespaces each (check with SQL query)
- [ ] Domain tools avg 1-2 namespaces each
- [ ] Namespace metadata table has ~30-50 entries (top-level + sub-namespaces)
- [ ] Parent relationships populated correctly (`platform/admin` → `platform`)
- [ ] Array contains query performance < 50ms (run EXPLAIN ANALYZE)
- [ ] Unit tests pass: `npm test -- namespace-assignment.test.ts`
- [ ] Integration tests pass: `npm test -- tool-registration-with-namespaces.test.ts`

**Performance validation SQL**:
```sql
EXPLAIN ANALYZE
SELECT * FROM platform_tool_registry
WHERE 'platform/admin' = ANY(namespaces);
```

Expected: `Bitmap Index Scan using idx_tool_registry_namespaces` with execution time < 50ms

---

### Sprint 1 Rollback Plan

If validation fails:

```bash
# Rollback database changes
psql $DATABASE_URL -c "
  ALTER TABLE platform_tool_registry DROP COLUMN IF EXISTS namespaces;
  DROP INDEX IF EXISTS idx_tool_registry_namespaces;
  DROP TABLE IF EXISTS platform_tool_namespaces;
"

# Revert code changes
git checkout HEAD -- src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts
git checkout HEAD -- scripts/backfill-tool-namespaces.ts

# Clean up test files
rm src/apps/tool-orchestrator-service/modules/registry/__tests__/namespace-assignment.test.ts
rm src/apps/tool-orchestrator-service/__tests__/tool-registration-with-namespaces.test.ts
```

---

## Sprint 2: Dynamic MCP Endpoint Routing

### Sprint Goal

**Deliverable**: Tool-orchestrator serves filtered tool lists via path-based MCP endpoints (`/mcp/platform`, `/mcp/domain`, `/mcp/domain/creative`) while preserving legacy `/mcp` behavior.

**Success Criteria**:
- ✅ Wildcard route `/mcp/*` implemented and functional
- ✅ `/mcp/platform` returns ~230 tools (all platform namespaces)
- ✅ `/mcp/domain` returns ~280 tools (all domain namespaces)
- ✅ `/mcp/domain/creative` returns ~80 tools (creative subset)
- ✅ `/mcp` (legacy endpoint) returns 200 tools with prioritization (unchanged behavior)
- ✅ No tool name collisions within namespaces
- ✅ MCP tools/list response < 500ms for all namespace endpoints
- ✅ Zero regressions in existing llm-bot connections

### Prerequisites

- ✅ Sprint 1 complete (schema + backfill)
- ✅ All 505 tools have `namespaces` array populated
- ✅ GIN index on `namespaces` column verified performant

### Tasks

#### Task 2.1: Implement Namespace Query Methods (2-3 hours)

**File to modify**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Location**: Add new methods after existing `queryTools()` method

**Implementation guidance**:

```typescript
/**
 * Query tools that exist in ANY of the specified namespaces (exact match).
 * Uses PostgreSQL array overlap operator (&&) for efficient querying.
 *
 * @param namespaces - Array of namespace paths (e.g., ['platform/admin', 'domain/creative'])
 * @returns Tools that belong to at least one of the specified namespaces
 */
async queryToolsByNamespaces(namespaces: string[]): Promise<ToolRegistryDocument[]> {
  if (!namespaces || namespaces.length === 0) {
    return this.queryTools({}); // Fall back to all tools
  }

  const result = await this.db.query<ToolRegistryDocument>(
    `SELECT * FROM platform_tool_registry
     WHERE namespaces && $1
     AND status = 'active'
     ORDER BY canonical_name`,
    [namespaces]  // PostgreSQL array overlap operator &&
  );

  this.logger.debug('tool_registry.query_by_namespaces', {
    namespaces,
    toolCount: result.rows.length,
  });

  return result.rows;
}

/**
 * Query tools in namespaces matching prefix (includes sub-namespaces).
 * Uses LIKE queries for hierarchical matching.
 *
 * @param prefixes - Array of namespace prefixes (e.g., ['platform', 'domain/creative'])
 * @returns Tools in matching namespaces and all sub-namespaces
 *
 * @example
 * queryToolsByNamespacePrefix(['platform']) returns tools in:
 * - 'platform'
 * - 'platform/admin'
 * - 'platform/admin/config'
 * - 'platform/config'
 * - etc.
 */
async queryToolsByNamespacePrefix(prefixes: string[]): Promise<ToolRegistryDocument[]> {
  if (!prefixes || prefixes.length === 0) {
    return this.queryTools({}); // Fall back to all tools
  }

  // Build LIKE conditions for each prefix
  const conditions = prefixes.map((_, i) =>
    `EXISTS (
      SELECT 1 FROM unnest(namespaces) AS ns
      WHERE ns = $${i + 1} OR ns LIKE $${i + 1} || '/%'
    )`
  ).join(' OR ');

  const result = await this.db.query<ToolRegistryDocument>(
    `SELECT * FROM platform_tool_registry
     WHERE (${conditions})
     AND status = 'active'
     ORDER BY canonical_name`,
    prefixes
  );

  this.logger.debug('tool_registry.query_by_namespace_prefix', {
    prefixes,
    toolCount: result.rows.length,
  });

  return result.rows;
}
```

**Testing**:

Add integration test: `src/apps/tool-orchestrator-service/__tests__/namespace-queries.test.ts`

```typescript
describe('Namespace Queries', () => {
  it('should query tools by exact namespaces (array overlap)', async () => {
    const tools = await registry.queryToolsByNamespaces(['platform/admin', 'domain/creative']);

    // Verify all returned tools have at least one matching namespace
    for (const tool of tools) {
      expect(
        tool.namespaces.includes('platform/admin') ||
        tool.namespaces.includes('domain/creative')
      ).toBe(true);
    }
  });

  it('should query tools by namespace prefix (hierarchical)', async () => {
    const tools = await registry.queryToolsByNamespacePrefix(['platform']);

    // Should include tools in 'platform', 'platform/admin', 'platform/config', etc.
    const namespaces = new Set(tools.flatMap(t => t.namespaces));

    expect(namespaces.has('platform')).toBe(true);
    expect(namespaces.has('platform/admin')).toBe(true);
    expect(namespaces.has('platform/config')).toBe(true);
  });

  it('should return all tools when namespaces array is empty', async () => {
    const allTools = await registry.queryTools({});
    const noNamespaceTools = await registry.queryToolsByNamespaces([]);

    expect(noNamespaceTools.length).toBe(allTools.length);
  });
});
```

**Validation**:
```bash
npm test -- namespace-queries.test.ts

# Manual SQL verification
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM platform_tool_registry
  WHERE namespaces && ARRAY['platform/admin', 'domain/creative']
"
```

**Risk**: LOW (read-only queries, GIN index ensures performance)

---

#### Task 2.2: Implement Wildcard MCP Route Handler (3-4 hours)

**File to modify**: `src/apps/tool-orchestrator-service.ts`

**Location**: In `setup()` method, before existing `/mcp` POST handler (around line 400-500)

**Implementation guidance**:

```typescript
async setup(): Promise<void> {
  await super.setup();

  // ... existing setup code ...

  // NEW: Wildcard route for namespace-based MCP endpoints
  // Pattern: /mcp/<namespace-path> → filtered tool list
  // Examples:
  //   /mcp/platform → tools in 'platform' and sub-namespaces
  //   /mcp/domain/creative → tools in 'domain/creative'
  //   /mcp/platform/admin/config → tools in deep hierarchy
  this.onHTTPRequest({ path: '/mcp/*', method: 'POST' }, async (req, res) => {
    const logger = this.getLogger();

    // Extract namespace from path: /mcp/platform/admin → 'platform/admin'
    const fullPath = req.path || req.url || '';
    const namespacePath = fullPath.replace(/^\/mcp\/?/, '').replace(/\/$/, '');

    logger.debug('mcp.namespace_request', {
      fullPath,
      namespacePath: namespacePath || '[empty - legacy endpoint]',
    });

    if (!namespacePath) {
      // No namespace specified → delegate to legacy /mcp endpoint
      logger.debug('mcp.namespace_fallback_to_legacy');
      return this.handleLegacyMcpRequest(req, res);
    }

    // Validate namespace path format (lowercase alphanumeric + hyphen + slash)
    if (!/^[a-z0-9\-\/]+$/.test(namespacePath)) {
      logger.warn('mcp.invalid_namespace_path', { namespacePath });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid namespace path (must be lowercase alphanumeric with hyphens and slashes)'
      }));
      return;
    }

    try {
      // Create namespace-filtered MCP server
      const server = await this.getMcpServerForNamespaces([namespacePath], {
        includeSubnamespaces: true,  // /mcp/platform includes platform/admin, platform/config, etc.
      });

      // Delegate to MCP SDK request handler
      await this.handleMcpRequest(server, req, res);

    } catch (err) {
      logger.error('mcp.namespace_request_failed', {
        namespacePath,
        error: err instanceof Error ? err.message : String(err),
      });

      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error',
        namespace: namespacePath,
      }));
    }
  });

  // EXISTING: Legacy /mcp endpoint (preserve existing behavior)
  this.onHTTPRequest({ path: '/mcp', method: 'POST' }, async (req, res) => {
    await this.handleLegacyMcpRequest(req, res);
  });
}

/**
 * Handle legacy /mcp endpoint (all tools with 200-tool limit + prioritization).
 * Preserves existing behavior for backward compatibility.
 */
private async handleLegacyMcpRequest(req: any, res: any): Promise<void> {
  const server = await this.getMcpServerForNamespaces([], {
    includeSubnamespaces: false,  // Empty namespaces = all tools
  });

  await this.handleMcpRequest(server, req, res);
}

/**
 * Generic MCP request handler (delegates to MCP SDK).
 * Reusable for both legacy and namespace endpoints.
 */
private async handleMcpRequest(server: any, req: any, res: any): Promise<void> {
  // Existing MCP SDK request handling logic
  // (copy from existing getMcpServer() POST handler around line 1500-1600)
  // ... request parsing, server.handleRequest(), response streaming ...
}
```

**Risk**: LOW (additive route, existing `/mcp` unchanged)

---

#### Task 2.3: Implement Namespace-Filtered MCP Server Creation (4-5 hours)

**File to modify**: `src/apps/tool-orchestrator-service.ts`

**Location**: Add new method after existing `getMcpServer()` method (around line 1700)

**Implementation guidance**:

```typescript
/**
 * Create MCP server filtered by namespace(s).
 *
 * @param namespaces - Array of namespace paths to include (empty = all tools)
 * @param options.includeSubnamespaces - If true, use prefix matching (default: true)
 * @returns MCP server with filtered tool list
 */
protected async getMcpServerForNamespaces(
  namespaces: string[],
  options: { includeSubnamespaces?: boolean } = {}
): Promise<any> {  // Returns McpServer (import from @modelcontextprotocol/server)
  const logger = this.getLogger();
  const includeSubnamespaces = options.includeSubnamespaces ?? true;

  // Query tools by namespace(s)
  let tools: ToolRegistryDocument[];

  if (namespaces.length === 0) {
    // No namespaces = all tools (legacy /mcp endpoint)
    tools = await this.toolRegistry!.queryTools({});

    // Apply MCP_MAX_TOOLS_LIST limit for legacy endpoint only
    const maxTools = parseInt(process.env.MCP_MAX_TOOLS_LIST || '200', 10);
    if (tools.length > maxTools) {
      logger.warn('mcp_server.tools_truncated', {
        total: tools.length,
        limit: maxTools,
        endpoint: 'legacy /mcp',
      });

      // Apply existing prioritization logic (admin → platform → domain)
      tools = this.prioritizeTools(tools).slice(0, maxTools);
    }

  } else if (includeSubnamespaces) {
    // Prefix matching (include sub-namespaces)
    tools = await this.toolRegistry!.queryToolsByNamespacePrefix(namespaces);

  } else {
    // Exact matching (specific namespaces only)
    tools = await this.toolRegistry!.queryToolsByNamespaces(namespaces);
  }

  logger.info('mcp_server.namespace_filter', {
    namespaces: namespaces.length > 0 ? namespaces : ['[all]'],
    toolCount: tools.length,
    includeSubnamespaces,
    maxToolsLimit: namespaces.length === 0 ? parseInt(process.env.MCP_MAX_TOOLS_LIST || '200', 10) : 'none',
  });

  // Create MCP server with filtered tools
  const { McpServer, ServerContext } = await import('@modelcontextprotocol/server');

  const serverName = namespaces.length > 0
    ? `tool-orchestrator-${namespaces.join(',')}`
    : 'tool-orchestrator';

  const server = new McpServer(
    { name: serverName, version: '1.0.0' },
    { capabilities: { tools: tools.length > 0 ? {} : undefined } }
  );

  // Register filtered tools
  for (const tool of tools) {
    server.registerTool(tool.id, {
      description: tool.description || 'No description',
      inputSchema: tool.inputSchema,
    }, async (args: any, ctx: ServerContext) => {
      return await this.executeToolById(tool.id, args, ctx);
    });
  }

  return server;
}

/**
 * Prioritize tools for legacy /mcp endpoint (preserve existing Sprint 66 logic).
 *
 * Priority order:
 * 1. Admin tools (tool.*, model.*, composition.*)
 * 2. Platform tools (bit.*)
 * 3. Domain tools (everything else)
 */
private prioritizeTools(tools: ToolRegistryDocument[]): ToolRegistryDocument[] {
  const adminTools = tools.filter(t =>
    t.canonicalName?.startsWith('tool.') ||
    t.canonicalName?.startsWith('model.') ||
    t.canonicalName?.startsWith('composition.')
  );

  const platformTools = tools.filter(t =>
    t.canonicalName === 'bit' || t.canonicalName?.startsWith('bit.')
  );

  const domainTools = tools.filter(t =>
    !adminTools.includes(t) && !platformTools.includes(t)
  );

  return [...adminTools, ...platformTools, ...domainTools];
}
```

**Testing**:

Add integration test: `src/apps/tool-orchestrator-service/__tests__/mcp-namespace-routing.test.ts`

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/client';

describe('MCP Namespace Routing', () => {
  let orchestratorUrl: string;

  beforeAll(async () => {
    // Deploy tool-orchestrator to agent-dev context
    await agent_dev.provision({ name: 'agent-dev-namespace-test' });
    await deployService('tool-orchestrator', 'agent-dev-namespace-test');

    orchestratorUrl = 'http://tool-orchestrator:3000';
  });

  afterAll(async () => {
    await agent_dev.destroy({ name: 'agent-dev-namespace-test', confirm: true });
  });

  it('should return platform tools via /mcp/platform', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport({ url: `${orchestratorUrl}/mcp/platform` });

    await client.connect(transport);
    const result = await client.listTools();

    // Verify we see platform tools (~230)
    expect(result.tools.length).toBeGreaterThan(200);
    expect(result.tools.length).toBeLessThan(250);

    // Verify all tools are platform-related
    const hasPlatformTools = result.tools.every(t =>
      t.name.startsWith('bit.') ||
      t.name.startsWith('tool.') ||
      t.name.startsWith('model.') ||
      t.name.startsWith('composition.')
    );
    expect(hasPlatformTools).toBe(true);

    await client.close();
  });

  it('should return domain tools via /mcp/domain', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport({ url: `${orchestratorUrl}/mcp/domain` });

    await client.connect(transport);
    const result = await client.listTools();

    // Verify we see domain tools (~280)
    expect(result.tools.length).toBeGreaterThan(250);

    // Verify tools are NOT platform tools
    const hasNonPlatformTools = result.tools.some(t =>
      !t.name.startsWith('bit.') &&
      !t.name.startsWith('tool.') &&
      !t.name.startsWith('model.') &&
      !t.name.startsWith('composition.')
    );
    expect(hasNonPlatformTools).toBe(true);

    await client.close();
  });

  it('should return creative subset via /mcp/domain/creative', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport({ url: `${orchestratorUrl}/mcp/domain/creative` });

    await client.connect(transport);
    const result = await client.listTools();

    // Verify we see creative tools (~80)
    expect(result.tools.length).toBeGreaterThan(60);
    expect(result.tools.length).toBeLessThan(100);

    await client.close();
  });

  it('should preserve legacy /mcp behavior (200-tool limit)', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport({ url: `${orchestratorUrl}/mcp` });

    await client.connect(transport);
    const result = await client.listTools();

    // Verify 200-tool limit applied
    expect(result.tools.length).toBeLessThanOrEqual(200);

    // Verify prioritization (admin tools first)
    const firstTool = result.tools[0];
    expect(
      firstTool.name.startsWith('tool.') ||
      firstTool.name.startsWith('model.') ||
      firstTool.name.startsWith('composition.')
    ).toBe(true);

    await client.close();
  });

  it('should handle invalid namespace paths gracefully', async () => {
    const response = await fetch(`${orchestratorUrl}/mcp/INVALID/PATH`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid namespace path');
  });
});
```

**Validation**:
```bash
# Deploy to agent-dev context
agent_dev.provision({ name: 'agent-dev-sprint2-test' })
bit deploy tool-orchestrator --context agent-dev-sprint2-test

# Run integration tests
npm test -- mcp-namespace-routing.test.ts

# Manual verification with curl
curl -X POST http://tool-orchestrator:3000/mcp/platform \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length'
# Expected: ~230

curl -X POST http://tool-orchestrator:3000/mcp/domain \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length'
# Expected: ~280

# Clean up
agent_dev.destroy({ name: 'agent-dev-sprint2-test', confirm: true })
```

**Risk**: MEDIUM (HTTP routing changes, but backward compatible via `/mcp` preservation)

---

### Sprint 2 Validation Checklist

Before marking Sprint 2 complete, verify:

- [ ] Wildcard route `/mcp/*` handles all namespace paths
- [ ] `/mcp/platform` returns 220-240 tools (all platform namespaces)
- [ ] `/mcp/domain` returns 270-290 tools (all domain namespaces)
- [ ] `/mcp/domain/creative` returns 70-90 tools (creative subset)
- [ ] `/mcp` (legacy) returns exactly 200 tools (prioritized)
- [ ] Invalid namespace paths return 400 Bad Request
- [ ] MCP tools/list response < 500ms for all endpoints (measure with curl + time)
- [ ] Integration tests pass: `npm test -- mcp-namespace-routing.test.ts`
- [ ] Existing llm-bot connections still work (no regressions)
- [ ] No duplicate tools returned within same namespace endpoint
- [ ] Parent namespace includes child namespace tools (e.g., `/mcp/platform` includes `/mcp/platform/admin` tools)

**Performance validation**:
```bash
# Measure response time
time curl -X POST http://tool-orchestrator:3000/mcp/platform \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' > /dev/null

# Expected: < 500ms
```

---

### Sprint 2 Rollback Plan

If validation fails:

```bash
# Revert code changes
git checkout HEAD -- src/apps/tool-orchestrator-service.ts
git checkout HEAD -- src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

# Clean up test files
rm src/apps/tool-orchestrator-service/__tests__/namespace-queries.test.ts
rm src/apps/tool-orchestrator-service/__tests__/mcp-namespace-routing.test.ts

# Restart service
brat bit deploy tool-orchestrator
```

---

## Sprint 3: Client Integration & Configuration

### Sprint Goal

**Deliverable**: llm-bot configured to connect to multiple namespace endpoints, accessing all 510 tools (platform + domain) via dual connections, eliminating the 200-tool truncation issue.

**Success Criteria**:
- ✅ `MCP_TOOL_NAMESPACES` parsing implemented in mcp-client-profile.ts
- ✅ llm-bot creates dual connections: `tool-orchestrator-platform` + `tool-orchestrator-domain`
- ✅ llm-bot sees 510 total tools (230 platform + 280 domain)
- ✅ No duplicate tools between namespace connections
- ✅ Both platform (`bit.config.get`) and domain (`image.generate`) tools executable
- ✅ Backward compatibility: Services without `MCP_TOOL_NAMESPACES` still work (connect to `/mcp`)
- ✅ Documentation created: namespace configuration guide + troubleshooting

### Prerequisites

- ✅ Sprint 2 complete (dynamic routing functional)
- ✅ `/mcp/platform` and `/mcp/domain` endpoints validated
- ✅ Integration tests passing

### Tasks

#### Task 3.1: Implement MCP_TOOL_NAMESPACES Parsing (2-3 hours)

**File to modify**: `src/common/profiles/mcp-client-profile.ts`

**Location**: Replace existing `connect()` method (lines 57-150)

**Implementation guidance**:

```typescript
const connect = async (): Promise<void> => {
  // Check ENABLE_TOOL_ORCHESTRATOR to determine which service to connect to
  const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
  const toolProvider = useToolOrchestrator ? 'tool-orchestrator' : 'tool-gateway';

  // Derive base URL (strip /mcp suffix if present)
  let baseUrl: string;
  if (useToolOrchestrator) {
    baseUrl = (
      process.env.TOOL_ORCHESTRATOR_URL ||
      bit.getConfig<string>('TOOL_ORCHESTRATOR_URL', { required: false }) ||
      'http://tool-orchestrator:3000'
    ).replace(/\/mcp.*$/, ''); // Strip /mcp suffix
  } else {
    baseUrl = (
      process.env.MCP_GATEWAY_URL ||
      bit.getConfig<string>('MCP_GATEWAY_URL', { required: false }) ||
      'http://tool-gateway:3000'
    ).replace(/\/mcp.*$/, '');
  }

  // Parse namespace configuration (comma-separated list)
  const namespacesConfig = (
    process.env.MCP_TOOL_NAMESPACES ||
    bit.getConfig<string>('MCP_TOOL_NAMESPACES', { required: false }) ||
    ''
  ).trim();

  if (namespacesConfig) {
    // NEW BEHAVIOR: Multiple namespace connections
    const namespaces = namespacesConfig
      .split(',')
      .map(ns => ns.trim())
      .filter(Boolean);

    bit.getLogger().info('bit.mcp_client.connecting_multiple_namespaces', {
      provider: toolProvider,
      namespaces,
      namespaceCount: namespaces.length,
    });

    for (const namespace of namespaces) {
      // Validate namespace path format
      if (!/^[a-z0-9\-\/]+$/.test(namespace)) {
        bit.getLogger().warn('bit.mcp_client.invalid_namespace_path', {
          namespace,
          reason: 'Must be lowercase alphanumeric with hyphens and slashes',
        });
        continue; // Skip invalid namespaces
      }

      const cfg: McpServerConfig = {
        name: `${toolProvider}-${namespace.replace(/\//g, '-')}`, // Sanitize connection name
        transport: 'sse',
        url: `${baseUrl}/mcp/${namespace}`,
        env: {
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || ''}`,
          'x-agent-name': (bit as any).serviceName,
        },
      };

      bit.getLogger().info('bit.mcp_client.connecting_namespace', {
        namespace,
        url: cfg.url,
        connectionName: cfg.name,
      });

      // Retry loop to handle race conditions
      const maxAttempts = parseInt(process.env.MCP_GATEWAY_CONNECT_RETRIES || '10', 10);
      const initialBackoffMs = parseInt(process.env.MCP_GATEWAY_CONNECT_BACKOFF_MS || '1000', 10);
      let backoff = isFinite(initialBackoffMs) ? Math.max(100, initialBackoffMs) : 1000;

      for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
        await manager.connectServer(cfg);
        const status = manager.getStats().getServerStats(cfg.name)?.status;

        if (status === 'connected') {
          bit.getLogger().info('bit.mcp_client.namespace_connected', {
            namespace,
            attempt,
          });
          break;
        }

        if (attempt === maxAttempts) {
          bit.getLogger().error('bit.mcp_client.namespace_connect_failed', {
            namespace,
            attempts: maxAttempts,
            url: cfg.url,
          });
          break;
        }

        bit.getLogger().warn('bit.mcp_client.namespace_connect_retry', {
          namespace,
          attempt,
          backoffMs: backoff,
        });

        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15000);
      }
    }

  } else {
    // LEGACY BEHAVIOR: Single connection to /mcp (backward compatible)
    bit.getLogger().info('bit.mcp_client.connecting_legacy', {
      provider: toolProvider,
      url: `${baseUrl}/mcp`,
    });

    const cfg: McpServerConfig = {
      name: toolProvider,
      transport: 'sse',
      url: `${baseUrl}/mcp`,
      env: {
        'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || ''}`,
        'x-agent-name': (bit as any).serviceName,
      },
    };

    // Retry loop (same as above)
    const maxAttempts = parseInt(process.env.MCP_GATEWAY_CONNECT_RETRIES || '10', 10);
    const initialBackoffMs = parseInt(process.env.MCP_GATEWAY_CONNECT_BACKOFF_MS || '1000', 10);
    let backoff = isFinite(initialBackoffMs) ? Math.max(100, initialBackoffMs) : 1000;

    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
      await manager.connectServer(cfg);
      const status = manager.getStats().getServerStats(toolProvider)?.status;

      if (status === 'connected') {
        bit.getLogger().info('bit.mcp_client.legacy_connected', { attempt });
        break;
      }

      if (attempt === maxAttempts) {
        bit.getLogger().error('bit.mcp_client.legacy_connect_failed', {
          attempts: maxAttempts,
          url: cfg.url,
        });
        break;
      }

      bit.getLogger().warn('bit.mcp_client.legacy_connect_retry', {
        attempt,
        backoffMs: backoff,
      });

      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }
};
```

**Testing**:

Add integration test: `src/common/profiles/__tests__/mcp-client-profile-namespaces.test.ts`

```typescript
describe('MCP Client Profile - Namespace Support', () => {
  it('should create multiple connections when MCP_TOOL_NAMESPACES is set', async () => {
    process.env.MCP_TOOL_NAMESPACES = 'platform,domain';
    process.env.TOOL_ORCHESTRATOR_URL = 'http://tool-orchestrator:3000';

    // Create test Bit with McpClientProfile
    const bit = new TestBit();
    const profile = McpClientProfile({ createRegistry: () => new ToolRegistry() });
    profile.install(bit);

    await bit.startup();

    // Verify dual connections created
    const stats = (bit as any).mcpClient.manager.getStats();
    expect(stats.getServerStats('tool-orchestrator-platform')).toBeDefined();
    expect(stats.getServerStats('tool-orchestrator-domain')).toBeDefined();

    await bit.shutdown();
  });

  it('should fall back to legacy /mcp when MCP_TOOL_NAMESPACES is unset', async () => {
    delete process.env.MCP_TOOL_NAMESPACES;
    process.env.TOOL_ORCHESTRATOR_URL = 'http://tool-orchestrator:3000';

    const bit = new TestBit();
    const profile = McpClientProfile({ createRegistry: () => new ToolRegistry() });
    profile.install(bit);

    await bit.startup();

    // Verify single legacy connection
    const stats = (bit as any).mcpClient.manager.getStats();
    expect(stats.getServerStats('tool-orchestrator')).toBeDefined();
    expect(stats.getServerStats('tool-orchestrator-platform')).toBeUndefined();

    await bit.shutdown();
  });

  it('should skip invalid namespace paths', async () => {
    process.env.MCP_TOOL_NAMESPACES = 'platform,INVALID/PATH,domain'; // Mixed valid/invalid

    const bit = new TestBit();
    const profile = McpClientProfile({ createRegistry: () => new ToolRegistry() });
    profile.install(bit);

    await bit.startup();

    // Verify only valid connections created
    const stats = (bit as any).mcpClient.manager.getStats();
    expect(stats.getServerStats('tool-orchestrator-platform')).toBeDefined();
    expect(stats.getServerStats('tool-orchestrator-domain')).toBeDefined();
    expect(stats.getServerStats('tool-orchestrator-INVALID-PATH')).toBeUndefined();

    await bit.shutdown();
  });
});
```

**Validation**:
```bash
npm test -- mcp-client-profile-namespaces.test.ts
```

**Risk**: LOW (opt-in via config, backward compatible)

---

#### Task 3.2: Update llm-bot Configuration (1 hour)

**File to modify**: `architecture.yaml`

**Location**: Find `llm-bot` service definition (search for `llm-bot:`)

**Implementation guidance**:

```yaml
llm-bot:
  category: domain
  kind: pipeline-service
  profile: llm
  stage: analyze
  exposure: platform-only

  topics:
    consumes:
      - internal.analysis.v1
    publishes:
      - internal.reaction.v1

  env:
    # ... existing env vars ...

    # NEW: Enable tool-orchestrator and dual-namespace connections
    - ENABLE_TOOL_ORCHESTRATOR=true
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000  # Base URL (no /mcp suffix)
    - MCP_TOOL_NAMESPACES=platform,domain  # Dual connections for full tool access

    # Retry configuration (optional, defaults shown)
    - MCP_GATEWAY_CONNECT_RETRIES=10
    - MCP_GATEWAY_CONNECT_BACKOFF_MS=1000

  # ... rest of service definition ...
```

**Alternative configurations** (for future reference, comment out in architecture.yaml):

```yaml
# Example 2: Admin-focused bot (platform tools only)
# - MCP_TOOL_NAMESPACES=platform/admin,platform/config

# Example 3: Creative bot (domain tools only, specialized subset)
# - MCP_TOOL_NAMESPACES=domain/creative,domain/image,domain/video

# Example 4: Legacy behavior (all tools, 200-tool limit)
# - ENABLE_TOOL_ORCHESTRATOR=true
# - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000/mcp
# # MCP_TOOL_NAMESPACES not set → uses /mcp endpoint

# Example 5: Streaming bot (deep hierarchies)
# - MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch,platforms/obs
```

**Validation**:
```bash
# Deploy llm-bot with new configuration
brat bit deploy llm-bot

# Verify connections in logs
fleet.logs({ bit: 'llm-bot', limit: 50 }) | grep 'namespace_connected'
# Expected output:
# bit.mcp_client.namespace_connected: { namespace: 'platform', attempt: 1 }
# bit.mcp_client.namespace_connected: { namespace: 'domain', attempt: 1 }

# Verify tool count
fleet.info({ bit: 'llm-bot' })
# Expected: MCP client stats show ~510 total tools across both connections
```

**Risk**: VERY LOW (configuration change only, rollback via re-deploy)

---

#### Task 3.3: Create Namespace Configuration Guide (3-4 hours)

**File to create**: `documentation/guides/tool-orchestrator-namespaces.md`

**Implementation guidance**:

```markdown
# Tool Namespace Configuration Guide

**Last Updated**: 2026-11-27
**Status**: Active (Sprint 3+)

---

## Overview

Tool-orchestrator supports **hierarchical namespace filtering** to segment tools into semantic categories. This allows services to connect to specific tool subsets (e.g., platform administration tools only, creative domain tools only) rather than receiving all 505+ tools at once.

**Key Benefits**:
- **Noise reduction**: Services only see relevant tools
- **Eliminate truncation**: Bypass 200-tool MCP limit by splitting namespaces
- **Flexible organization**: Tools can exist in multiple namespaces simultaneously
- **Configuration-driven**: Zero code changes to adjust tool exposure

---

## Quick Start

### Step 1: Configure Service to Use Namespaces

Add `MCP_TOOL_NAMESPACES` env var to your service in `architecture.yaml`:

\`\`\`yaml
my-service:
  env:
    - ENABLE_TOOL_ORCHESTRATOR=true
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000
    - MCP_TOOL_NAMESPACES=platform,domain  # Dual connections
\`\`\`

### Step 2: Deploy Service

\`\`\`bash
brat bit deploy my-service
\`\`\`

### Step 3: Verify Connections

\`\`\`bash
fleet.logs({ bit: 'my-service', limit: 50 }) | grep 'namespace_connected'
# Expected output:
# bit.mcp_client.namespace_connected: { namespace: 'platform', ... }
# bit.mcp_client.namespace_connected: { namespace: 'domain', ... }
\`\`\`

---

## Namespace Hierarchy

**Current namespace taxonomy** (auto-assigned based on tool naming conventions):

\`\`\`
platform/                      (~230 tools)
├── admin/                     (~220 tools)
│   ├── config/                (~60 tools) - bit.config.*
│   ├── flags/                 (~40 tools) - bit.flags.*
│   └── logging/               (~20 tools) - bit.log.*
├── tools/                     (~8 tools) - tool.*
├── models/                    (~3 tools) - model.*
└── compositions/              (~6 tools) - composition.*

domain/                        (~280 tools)
├── creative/                  (~80 tools)
│   ├── image/                 (~30 tools) - image generation
│   ├── video/                 (~20 tools) - video processing
│   └── storytelling/          (~30 tools) - narrative tools
├── streaming/                 (~40 tools) - OBS, scene management
├── data/                      (~30 tools) - analytics, queries
└── [other domain namespaces]  (~130 tools)
\`\`\`

**Many-to-Many Relationships**: Tools can exist in multiple namespaces. For example:
- `bit.config.get` → `['platform/admin', 'platform/config', 'admin', 'configuration']`
- `image.generate` → `['domain', 'domain/creative', 'domain/image', 'creative/image']`

---

## Configuration Patterns

### Pattern 1: General-Purpose Agent (All Tools)

**Use case**: llm-bot, general chat agents

\`\`\`yaml
env:
  - MCP_TOOL_NAMESPACES=platform,domain  # ~510 total tools
\`\`\`

**Result**: Dual connections, full tool access, no truncation

---

### Pattern 2: Admin-Focused Bot (Platform Tools Only)

**Use case**: Fleet management, infrastructure monitoring

\`\`\`yaml
env:
  - MCP_TOOL_NAMESPACES=platform/admin,platform/config  # ~180 tools
\`\`\`

**Result**: Only platform administration and configuration tools

---

### Pattern 3: Creative Assistant (Domain Creative Tools)

**Use case**: Image generation, video editing, storytelling

\`\`\`yaml
env:
  - MCP_TOOL_NAMESPACES=domain/creative,domain/image,domain/video  # ~80 tools
\`\`\`

**Result**: Only creative domain tools, no platform noise

---

### Pattern 4: Streaming Bot (Platform-Specific)

**Use case**: Twitch/OBS automation

\`\`\`yaml
env:
  - MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch,platforms/obs  # ~60 tools
\`\`\`

**Result**: Streaming and platform-specific tools only

---

### Pattern 5: Legacy Behavior (All Tools, 200-Tool Limit)

**Use case**: Backward compatibility, testing

\`\`\`yaml
env:
  - ENABLE_TOOL_ORCHESTRATOR=true
  - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000/mcp
  # MCP_TOOL_NAMESPACES not set → uses /mcp endpoint
\`\`\`

**Result**: Single connection, 200-tool limit with prioritization

---

## Troubleshooting

### Issue: Service sees 0 tools after namespace configuration

**Cause**: Invalid namespace path or typo in `MCP_TOOL_NAMESPACES`

**Solution**:
1. Check logs for warning: `bit.mcp_client.invalid_namespace_path`
2. Verify namespace format: lowercase alphanumeric with hyphens and slashes
3. Example valid paths: `platform`, `domain/creative`, `platform/admin/config`
4. Example invalid paths: `Platform` (uppercase), `/platform/` (leading/trailing slashes)

---

### Issue: Duplicate tools across namespaces

**Cause**: Expected behavior! Tools can exist in multiple namespaces simultaneously.

**Solution**: This is intentional. MCP client merges tools from all namespace connections.

---

### Issue: Connection timeout or failed to connect

**Cause**: Tool-orchestrator not ready or network issues

**Solution**:
1. Check tool-orchestrator is running: `fleet.info({ bit: 'tool-orchestrator' })`
2. Increase retry attempts: `MCP_GATEWAY_CONNECT_RETRIES=20`
3. Increase backoff: `MCP_GATEWAY_CONNECT_BACKOFF_MS=2000`

---

### Issue: Tools executable but not visible in tools/list

**Cause**: Namespace assignment missing or incorrect

**Solution**:
1. Query tool namespaces: `tool.get({ toolId: '<tool-id>' })` → check `namespaces` array
2. If empty, tool not auto-categorized (check assignNamespaces logic)
3. Manually assign: `tool_orchestrator.namespace.assign({ toolId: '<id>', namespaces: ['domain'] })`

---

## Advanced: Custom Namespace Assignment

**Admin tools** (Sprint 4+):

\`\`\`typescript
// Add tool to namespace(s)
tool_orchestrator.namespace.assign({
  toolId: 'custom.tool.001',
  namespaces: ['domain/custom', 'custom/workflows']
})

// List tool's namespaces
tool_orchestrator.namespace.list_for_tool({ toolId: 'custom.tool.001' })
// Returns: ['domain/custom', 'custom/workflows']

// List all tools in namespace
tool_orchestrator.namespace.list_tools({
  namespace: 'domain/custom',
  includeSubnamespaces: true
})
\`\`\`

---

## Migration Checklist

Migrating from legacy `/mcp` to namespace-based connections:

- [ ] Add `MCP_TOOL_NAMESPACES` to architecture.yaml
- [ ] Remove `/mcp` suffix from `TOOL_ORCHESTRATOR_URL` (use base URL only)
- [ ] Deploy service: `brat bit deploy <service>`
- [ ] Verify connections in logs: `fleet.logs({ bit: '<service>' })`
- [ ] Test tool execution: Send test message and verify tools work
- [ ] Monitor for 1 week, check for errors or missing tools
- [ ] Document service-specific namespace selections in architecture.yaml comments

---

## References

- **Architecture Document**: `planning/architecture-tool-segmentation-namespacing.md`
- **Tool Registry Types**: `src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts`
- **MCP Client Profile**: `src/common/profiles/mcp-client-profile.ts`
- **Namespace Assignment Logic**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

---

**End of Guide**
\`\`\`

**Validation**:
```bash
# Preview rendered markdown
npx markdown-preview documentation/guides/tool-orchestrator-namespaces.md
```

**Risk**: NONE (documentation only)

---

#### Task 3.4: Update CLAUDE.md with Namespace Pattern (1 hour)

**File to modify**: `CLAUDE.md`

**Location**: Add new section after "Agent-Dev Contexts" pattern (around line 150-200)

**Implementation guidance**:

```markdown
---

### 12. Configuring Tool Namespaces for MCP Clients

**Pattern for services that consume tools from tool-orchestrator via MCP.**

Tool-orchestrator supports hierarchical namespace filtering to reduce tool noise and eliminate the 200-tool MCP transmission limit. Services can subscribe to specific namespace paths (e.g., `platform`, `domain/creative`) to receive filtered tool lists.

**Configuration (architecture.yaml)**:

\`\`\`yaml
my-service:
  env:
    - ENABLE_TOOL_ORCHESTRATOR=true
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000  # Base URL (no /mcp suffix)
    - MCP_TOOL_NAMESPACES=platform,domain  # Comma-separated namespace paths
\`\`\`

**How It Works**:
1. **Parse config**: Split `MCP_TOOL_NAMESPACES` on commas → `['platform', 'domain']`
2. **Create dual connections**:
   - `tool-orchestrator-platform` → `http://tool-orchestrator:3000/mcp/platform` (~230 tools)
   - `tool-orchestrator-domain` → `http://tool-orchestrator:3000/mcp/domain` (~280 tools)
3. **McpClientManager merges tools** from both connections into single registry
4. **Service sees all 510 tools** without hitting 200-tool limit per connection

**Common Configurations**:

\`\`\`yaml
# General-purpose agent (all tools)
- MCP_TOOL_NAMESPACES=platform,domain

# Admin bot (platform administration only)
- MCP_TOOL_NAMESPACES=platform/admin,platform/config

# Creative bot (domain creative tools only)
- MCP_TOOL_NAMESPACES=domain/creative,domain/image,domain/video

# Streaming bot (deep hierarchy)
- MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch,platforms/obs

# Legacy behavior (all tools, 200-tool limit)
# MCP_TOOL_NAMESPACES not set → connects to /mcp
\`\`\`

**Namespace Hierarchy**:

\`\`\`
platform/              (~230 tools: bit.*, tool.*, model.*, composition.*)
  admin/               (platform administration)
  config/              (configuration management)
  flags/               (feature flags)
  logging/             (log level control)
  tools/               (tool registry admin)
  models/              (model registry admin)
  compositions/        (composition admin)

domain/                (~280 tools: MCP servers, compositions)
  creative/            (image, video, storytelling)
  streaming/           (OBS, scene management)
  data/                (analytics, queries)
  [other domains]
\`\`\`

**Validation**:

\`\`\`bash
# Deploy service with namespace config
brat bit deploy my-service

# Verify dual connections created
fleet.logs({ bit: 'my-service', limit: 50 }) | grep 'namespace_connected'
# Expected output:
# bit.mcp_client.namespace_connected: { namespace: 'platform', ... }
# bit.mcp_client.namespace_connected: { namespace: 'domain', ... }

# Verify tool count
fleet.info({ bit: 'my-service' })
# Expected: MCP client stats show ~510 total tools
\`\`\`

**Examples**: llm-bot (src/common/profiles/mcp-client-profile.ts:57-150)

**Documentation**: [Tool Namespace Configuration Guide](./documentation/guides/tool-orchestrator-namespaces.md)

---
\`\`\`

**Validation**:
```bash
# Verify CLAUDE.md parses correctly
npx markdown-lint CLAUDE.md
```

**Risk**: NONE (documentation only)

---

### Sprint 3 Validation Checklist

Before marking Sprint 3 complete, verify:

- [ ] `MCP_TOOL_NAMESPACES` parsing implemented in mcp-client-profile.ts
- [ ] llm-bot configuration updated in architecture.yaml
- [ ] llm-bot deployed with dual-namespace configuration
- [ ] llm-bot creates 2 connections: `tool-orchestrator-platform` + `tool-orchestrator-domain`
- [ ] llm-bot sees ~510 total tools (verify with `fleet.info`)
- [ ] No duplicate tools between connections (verify with SQL query)
- [ ] Platform tool execution works: `bit.config.get` callable
- [ ] Domain tool execution works: test with domain-specific tool (e.g., image generation)
- [ ] Backward compatibility: Service without `MCP_TOOL_NAMESPACES` connects to `/mcp` (200-tool limit)
- [ ] Integration tests pass: `npm test -- mcp-client-profile-namespaces.test.ts`
- [ ] Documentation created: `documentation/guides/tool-orchestrator-namespaces.md`
- [ ] CLAUDE.md updated with namespace pattern
- [ ] Agent behavior improved: LLM selects more relevant tools, reduced platform tool noise

**Tool count validation SQL**:
```sql
-- Verify no duplicate tools across namespace connections
SELECT canonical_name, COUNT(*) as connection_count
FROM (
  SELECT DISTINCT canonical_name, unnest(namespaces) as ns
  FROM platform_tool_registry
  WHERE namespaces && ARRAY['platform', 'domain']
) t
GROUP BY canonical_name
HAVING COUNT(*) > 2  -- Tools should appear in max 2 connections (platform OR domain)
-- Expected: 0 rows (no tools in both top-level namespaces)
```

---

### Sprint 3 Rollback Plan

If validation fails:

```bash
# Revert code changes
git checkout HEAD -- src/common/profiles/mcp-client-profile.ts
git checkout HEAD -- architecture.yaml
git checkout HEAD -- CLAUDE.md

# Remove documentation
rm documentation/guides/tool-orchestrator-namespaces.md

# Clean up test files
rm src/common/profiles/__tests__/mcp-client-profile-namespaces.test.ts

# Redeploy llm-bot with legacy config
brat bit deploy llm-bot
```

---

## Sprint 4: Admin Tools & Namespace Management

### Sprint Goal

**Deliverable**: MCP admin tools for runtime namespace management, allowing dynamic tool-to-namespace assignments without code changes.

**Success Criteria**:
- ✅ 6 MCP admin tools implemented: `namespace.assign`, `namespace.unassign`, `namespace.list_for_tool`, `namespace.list_tools`, `namespace.create`, `namespace.list_all`
- ✅ Namespace metadata persists and displays correctly (display name, icon, description, owner)
- ✅ Tool counts auto-update on tool registration/unregistration
- ✅ Admin tools accessible via llm-bot or Claude Code
- ✅ Many-to-many relationships work: tool can be added to multiple namespaces dynamically
- ✅ Parent/child namespace relationships functional
- ✅ Integration tests cover all admin tool workflows

### Prerequisites

- ✅ Sprint 3 complete (client integration functional)
- ✅ llm-bot connected to tool-orchestrator with dual namespaces
- ✅ Namespace metadata table populated

### Tasks

#### Task 4.1: Implement Namespace Assignment Admin Tools (4-5 hours)

**File to modify**: `src/apps/tool-orchestrator-service.ts`

**Location**: Add new methods in `setup()` method after existing MCP tool registrations (around line 300-400)

**Implementation guidance**:

```typescript
async setup(): Promise<void> {
  await super.setup();

  // ... existing MCP tool registrations (tool.*, model.*, composition.*) ...

  // NEW: Namespace management admin tools (Sprint 4)

  /**
   * Add tool to namespace(s).
   *
   * @example
   * tool_orchestrator.namespace.assign({
   *   toolId: 'custom.tool.001',
   *   namespaces: ['domain/custom', 'workflows']
   * })
   */
  this.registerTool(
    'tool_orchestrator.namespace.assign',
    'Add tool to one or more namespaces',
    z.object({
      toolId: z.string().describe('Tool ID to assign'),
      namespaces: z.array(z.string()).describe('Namespace paths to add tool to'),
    }),
    async (args) => {
      const { toolId, namespaces } = args;

      // Validate namespace paths
      for (const ns of namespaces) {
        if (!/^[a-z0-9\-\/]+$/.test(ns) || ns.startsWith('/') || ns.endsWith('/')) {
          throw new Error(`Invalid namespace path: ${ns}`);
        }
      }

      // Fetch current tool
      const tool = await this.toolRegistry!.getTool(toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`);
      }

      // Merge namespaces (add new, preserve existing)
      const updatedNamespaces = Array.from(new Set([...tool.namespaces, ...namespaces]));

      // Update tool in database
      await this.db.query(
        `UPDATE platform_tool_registry
         SET namespaces = $1, last_updated_at = NOW()
         WHERE id = $2`,
        [updatedNamespaces, toolId]
      );

      // Update namespace metadata (tool counts)
      for (const ns of namespaces) {
        await this.updateNamespaceToolCount(ns);
      }

      this.logger.info('tool_orchestrator.namespace_assigned', {
        toolId,
        addedNamespaces: namespaces,
        totalNamespaces: updatedNamespaces.length,
      });

      return {
        success: true,
        toolId,
        namespaces: updatedNamespaces,
      };
    }
  );

  /**
   * Remove tool from namespace.
   */
  this.registerTool(
    'tool_orchestrator.namespace.unassign',
    'Remove tool from a namespace',
    z.object({
      toolId: z.string().describe('Tool ID to unassign'),
      namespace: z.string().describe('Namespace path to remove tool from'),
    }),
    async (args) => {
      const { toolId, namespace } = args;

      const tool = await this.toolRegistry!.getTool(toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`);
      }

      // Remove namespace from array
      const updatedNamespaces = tool.namespaces.filter(ns => ns !== namespace);

      if (updatedNamespaces.length === 0) {
        throw new Error('Cannot remove last namespace (tool must belong to at least one namespace)');
      }

      await this.db.query(
        `UPDATE platform_tool_registry
         SET namespaces = $1, last_updated_at = NOW()
         WHERE id = $2`,
        [updatedNamespaces, toolId]
      );

      // Update namespace metadata
      await this.updateNamespaceToolCount(namespace);

      this.logger.info('tool_orchestrator.namespace_unassigned', {
        toolId,
        removedNamespace: namespace,
        remainingNamespaces: updatedNamespaces,
      });

      return {
        success: true,
        toolId,
        removedNamespace: namespace,
        namespaces: updatedNamespaces,
      };
    }
  );

  /**
   * List all namespaces for a tool.
   */
  this.registerTool(
    'tool_orchestrator.namespace.list_for_tool',
    'List all namespaces a tool belongs to',
    z.object({
      toolId: z.string().describe('Tool ID to query'),
    }),
    async (args) => {
      const tool = await this.toolRegistry!.getTool(args.toolId);
      if (!tool) {
        throw new Error(`Tool not found: ${args.toolId}`);
      }

      return {
        toolId: args.toolId,
        canonicalName: tool.canonicalName,
        namespaces: tool.namespaces,
      };
    }
  );

  /**
   * List all tools in a namespace.
   */
  this.registerTool(
    'tool_orchestrator.namespace.list_tools',
    'List all tools in a namespace (optionally including sub-namespaces)',
    z.object({
      namespace: z.string().describe('Namespace path to query'),
      includeSubnamespaces: z.boolean().optional().describe('Include tools in sub-namespaces (default: false)'),
    }),
    async (args) => {
      const { namespace, includeSubnamespaces = false } = args;

      let tools: ToolRegistryDocument[];

      if (includeSubnamespaces) {
        tools = await this.toolRegistry!.queryToolsByNamespacePrefix([namespace]);
      } else {
        tools = await this.toolRegistry!.queryToolsByNamespaces([namespace]);
      }

      return {
        namespace,
        includeSubnamespaces,
        toolCount: tools.length,
        tools: tools.map(t => ({
          id: t.id,
          canonicalName: t.canonicalName,
          description: t.description,
          source: t.source,
          namespaces: t.namespaces,
        })),
      };
    }
  );

  /**
   * Create namespace metadata.
   */
  this.registerTool(
    'tool_orchestrator.namespace.create',
    'Create or update namespace metadata',
    z.object({
      path: z.string().describe('Namespace path (e.g., "domain/custom")'),
      displayName: z.string().describe('Human-readable name'),
      description: z.string().optional().describe('Rich description'),
      icon: z.string().optional().describe('Emoji or icon identifier'),
      owner: z.string().optional().describe('Service or team owning this namespace'),
      tags: z.array(z.string()).optional().describe('Semantic tags for search'),
    }),
    async (args) => {
      const { path, displayName, description, icon, owner, tags } = args;

      // Validate path
      if (!/^[a-z0-9\-\/]+$/.test(path) || path.startsWith('/') || path.endsWith('/')) {
        throw new Error(`Invalid namespace path: ${path}`);
      }

      // Derive parent from path
      const parent = path.includes('/')
        ? path.substring(0, path.lastIndexOf('/'))
        : null;

      await this.db.query(
        `INSERT INTO platform_tool_namespaces (
          path, display_name, description, icon, owner, tags, parent,
          tool_count, created_at, last_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, (
          SELECT COUNT(*) FROM platform_tool_registry WHERE $1 = ANY(namespaces)
        ), NOW(), NOW())
        ON CONFLICT (path) DO UPDATE SET
          display_name = $2,
          description = $3,
          icon = $4,
          owner = $5,
          tags = $6,
          parent = $7,
          last_updated_at = NOW()`,
        [path, displayName, description || null, icon || null, owner || null, tags || [], parent]
      );

      this.logger.info('tool_orchestrator.namespace_created', { path, displayName });

      return {
        success: true,
        path,
        displayName,
        parent,
      };
    }
  );

  /**
   * List all namespaces with metadata.
   */
  this.registerTool(
    'tool_orchestrator.namespace.list_all',
    'List all namespaces with metadata and tool counts',
    z.object({}),
    async () => {
      const result = await this.db.query<{
        path: string;
        display_name: string;
        description: string | null;
        icon: string | null;
        owner: string | null;
        tags: string[];
        parent: string | null;
        tool_count: number;
      }>(
        `SELECT * FROM platform_tool_namespaces ORDER BY path`
      );

      return {
        namespaceCount: result.rows.length,
        namespaces: result.rows.map(row => ({
          path: row.path,
          displayName: row.display_name,
          description: row.description,
          icon: row.icon,
          owner: row.owner,
          tags: row.tags,
          parent: row.parent,
          toolCount: row.tool_count,
        })),
      };
    }
  );
}

/**
 * Update tool count for a namespace (called after tool assignment/unassignment).
 */
private async updateNamespaceToolCount(namespacePath: string): Promise<void> {
  // Derive parent from path
  const parent = namespacePath.includes('/')
    ? namespacePath.substring(0, namespacePath.lastIndexOf('/'))
    : null;

  // Upsert namespace metadata (create if doesn't exist)
  await this.db.query(
    `INSERT INTO platform_tool_namespaces (
      path, display_name, parent, tool_count, created_at, last_updated_at
    )
    VALUES ($1, $2, $3, (
      SELECT COUNT(*) FROM platform_tool_registry WHERE $1 = ANY(namespaces)
    ), NOW(), NOW())
    ON CONFLICT (path) DO UPDATE SET
      tool_count = (
        SELECT COUNT(*) FROM platform_tool_registry WHERE $1 = ANY(namespaces)
      ),
      last_updated_at = NOW()`,
    [
      namespacePath,
      this.generateDisplayName(namespacePath),
      parent,
    ]
  );
}

/**
 * Generate human-readable display name from namespace path.
 */
private generateDisplayName(path: string): string {
  // 'platform/admin/config' → 'Platform Admin Config'
  return path
    .split('/')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
```

**Testing**:

Add integration test: `src/apps/tool-orchestrator-service/__tests__/namespace-admin-tools.test.ts`

```typescript
describe('Namespace Admin Tools', () => {
  it('should assign tool to new namespaces', async () => {
    const result = await executeTool('tool_orchestrator.namespace.assign', {
      toolId: 'test.tool.001',
      namespaces: ['domain/test', 'testing'],
    });

    expect(result.success).toBe(true);
    expect(result.namespaces).toContain('domain/test');
    expect(result.namespaces).toContain('testing');
  });

  it('should unassign tool from namespace', async () => {
    // Setup: Assign to multiple namespaces
    await executeTool('tool_orchestrator.namespace.assign', {
      toolId: 'test.tool.001',
      namespaces: ['ns1', 'ns2', 'ns3'],
    });

    // Unassign from one namespace
    const result = await executeTool('tool_orchestrator.namespace.unassign', {
      toolId: 'test.tool.001',
      namespace: 'ns2',
    });

    expect(result.success).toBe(true);
    expect(result.namespaces).toContain('ns1');
    expect(result.namespaces).toContain('ns3');
    expect(result.namespaces).not.toContain('ns2');
  });

  it('should prevent removing last namespace', async () => {
    // Setup: Tool with single namespace
    await db.query(
      `UPDATE platform_tool_registry SET namespaces = $1 WHERE id = $2`,
      [['only-namespace'], 'test.tool.001']
    );

    // Try to remove last namespace
    await expect(
      executeTool('tool_orchestrator.namespace.unassign', {
        toolId: 'test.tool.001',
        namespace: 'only-namespace',
      })
    ).rejects.toThrow('Cannot remove last namespace');
  });

  it('should list namespaces for tool', async () => {
    const result = await executeTool('tool_orchestrator.namespace.list_for_tool', {
      toolId: 'bit.config.get',
    });

    expect(result.namespaces).toContain('platform/admin');
    expect(result.namespaces).toContain('platform/config');
  });

  it('should list tools in namespace (exact match)', async () => {
    const result = await executeTool('tool_orchestrator.namespace.list_tools', {
      namespace: 'platform/admin',
      includeSubnamespaces: false,
    });

    expect(result.toolCount).toBeGreaterThan(200);
    expect(result.tools.some(t => t.canonicalName === 'bit.config.get')).toBe(true);
  });

  it('should list tools in namespace (prefix match)', async () => {
    const result = await executeTool('tool_orchestrator.namespace.list_tools', {
      namespace: 'platform',
      includeSubnamespaces: true,
    });

    // Should include tools in 'platform', 'platform/admin', 'platform/config', etc.
    expect(result.toolCount).toBeGreaterThan(220);
  });

  it('should create namespace metadata', async () => {
    const result = await executeTool('tool_orchestrator.namespace.create', {
      path: 'custom/test',
      displayName: 'Custom Test Namespace',
      description: 'For testing purposes',
      icon: '🧪',
      owner: 'test-team',
      tags: ['testing', 'custom'],
    });

    expect(result.success).toBe(true);
    expect(result.parent).toBe('custom');

    // Verify persisted
    const metadata = await db.query(
      'SELECT * FROM platform_tool_namespaces WHERE path = $1',
      ['custom/test']
    );
    expect(metadata.rows[0].display_name).toBe('Custom Test Namespace');
    expect(metadata.rows[0].icon).toBe('🧪');
  });

  it('should list all namespaces', async () => {
    const result = await executeTool('tool_orchestrator.namespace.list_all', {});

    expect(result.namespaceCount).toBeGreaterThan(30); // At least 30 namespaces
    expect(result.namespaces.some(ns => ns.path === 'platform/admin')).toBe(true);
    expect(result.namespaces.some(ns => ns.path === 'domain/creative')).toBe(true);
  });

  it('should auto-update tool counts on assignment', async () => {
    // Get initial tool count
    const before = await executeTool('tool_orchestrator.namespace.list_all', {});
    const customNs = before.namespaces.find(ns => ns.path === 'custom/test');
    const initialCount = customNs?.toolCount || 0;

    // Assign tool to namespace
    await executeTool('tool_orchestrator.namespace.assign', {
      toolId: 'test.tool.002',
      namespaces: ['custom/test'],
    });

    // Verify tool count incremented
    const after = await executeTool('tool_orchestrator.namespace.list_all', {});
    const customNsAfter = after.namespaces.find(ns => ns.path === 'custom/test');
    expect(customNsAfter!.toolCount).toBe(initialCount + 1);
  });
});
```

**Validation**:
```bash
# Deploy to agent-dev context
agent_dev.provision({ name: 'agent-dev-sprint4-test' })
bit deploy tool-orchestrator --context agent-dev-sprint4-test

# Run integration tests
npm test -- namespace-admin-tools.test.ts

# Manual verification via llm-bot or Claude Code
tool_orchestrator.namespace.list_all()
# Should return ~30-50 namespaces with metadata

tool_orchestrator.namespace.assign({
  toolId: 'custom.test.tool',
  namespaces: ['domain/test', 'testing']
})

tool_orchestrator.namespace.list_for_tool({ toolId: 'custom.test.tool' })
# Returns: { namespaces: ['domain/test', 'testing'] }

# Clean up
agent_dev.destroy({ name: 'agent-dev-sprint4-test', confirm: true })
```

**Risk**: LOW (admin-only tools, no impact on existing functionality)

---

### Sprint 4 Validation Checklist

Before marking Sprint 4 complete, verify:

- [ ] 6 MCP admin tools registered and accessible
- [ ] `namespace.assign` adds tool to namespaces (verify with SQL query)
- [ ] `namespace.unassign` removes tool from namespace (verify with SQL query)
- [ ] Cannot remove last namespace from tool (error thrown)
- [ ] `namespace.list_for_tool` returns correct namespaces
- [ ] `namespace.list_tools` returns correct tools (exact + prefix matching)
- [ ] `namespace.create` persists metadata (display name, icon, description, owner, tags)
- [ ] `namespace.list_all` returns all namespaces with tool counts
- [ ] Tool counts auto-update on assignment/unassignment
- [ ] Parent/child relationships derived from path correctly
- [ ] Admin tools accessible via llm-bot (test with chat message)
- [ ] Admin tools accessible via Claude Code (test with MCP client)
- [ ] Integration tests pass: `npm test -- namespace-admin-tools.test.ts`

**Manual verification SQL**:
```sql
-- Verify tool assignment
SELECT namespaces FROM platform_tool_registry WHERE id = 'custom.test.tool';
-- Expected: ['domain/test', 'testing']

-- Verify namespace metadata
SELECT * FROM platform_tool_namespaces WHERE path = 'domain/test';
-- Expected: tool_count > 0, parent = 'domain'

-- Verify parent/child relationships
SELECT path, parent, tool_count
FROM platform_tool_namespaces
WHERE path LIKE 'platform/%'
ORDER BY path;
```

---

### Sprint 4 Rollback Plan

If validation fails:

```bash
# Revert code changes
git checkout HEAD -- src/apps/tool-orchestrator-service.ts

# Clean up test files
rm src/apps/tool-orchestrator-service/__tests__/namespace-admin-tools.test.ts

# Redeploy service
brat bit deploy tool-orchestrator
```

---

## Sprint 5: Monitoring & Optimization (Ongoing)

### Sprint Goal

**Deliverable**: Observability dashboard tracking namespace usage, tool execution distribution, and performance metrics. Continuous tuning of auto-assignment rules and query optimization.

**Success Criteria**:
- ✅ Metrics dashboard shows namespace usage split (endpoint hit counts, tool execution distribution)
- ✅ Performance metrics stable (< 500ms for tools/list across all namespaces)
- ✅ Zero namespace assignment errors reported in logs
- ✅ Developer feedback survey: >80% positive sentiment (reduced tool fatigue)
- ✅ Auto-assignment rules tuned based on real-world usage patterns
- ✅ GIN index performance optimized (query times < 50ms)
- ✅ Namespace metadata cached for faster lookups

### Prerequisites

- ✅ Sprint 4 complete (admin tools functional)
- ✅ llm-bot and other services using namespace connections in production
- ✅ Namespace system deployed to staging/production

### Tasks

#### Task 5.1: Add Namespace Usage Metrics (3-4 hours)

**File to modify**: `src/apps/tool-orchestrator-service.ts`

**Location**: In `getMcpServerForNamespaces()` method (add metrics tracking)

**Implementation guidance**:

```typescript
protected async getMcpServerForNamespaces(
  namespaces: string[],
  options: { includeSubnamespaces?: boolean } = {}
): Promise<any> {
  const logger = this.getLogger();
  const startTime = Date.now();

  // ... existing query logic ...

  // NEW: Track metrics
  const duration = Date.now() - startTime;
  const metricLabels = {
    namespaces: namespaces.join(',') || 'all',
    includeSubnamespaces: String(options.includeSubnamespaces ?? true),
    toolCount: tools.length,
  };

  // Log performance metrics
  logger.info('mcp.namespace_query_metrics', {
    ...metricLabels,
    durationMs: duration,
  });

  // Track in time-series metrics (if metrics service available)
  const metricsService = this.getResource<any>('metrics');
  if (metricsService) {
    metricsService.recordHistogram('tool_orchestrator.namespace_query_duration_ms', duration, metricLabels);
    metricsService.incrementCounter('tool_orchestrator.namespace_query_count', metricLabels);
    metricsService.recordGauge('tool_orchestrator.namespace_tool_count', tools.length, metricLabels);
  }

  // ... rest of method ...
}
```

**Dashboard queries** (for Grafana/Cloud Monitoring):

```promql
# Average namespace query duration
avg(tool_orchestrator_namespace_query_duration_ms) by (namespaces)

# Namespace endpoint hit count (last 1 hour)
sum(increase(tool_orchestrator_namespace_query_count[1h])) by (namespaces)

# Tool execution distribution by namespace
sum(tool_orchestrator_tool_execution_count) by (namespace)
```

---

#### Task 5.2: Tune Auto-Assignment Rules (Ongoing)

**File to monitor**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Strategy**:
1. **Collect data**: Monitor logs for `tool_registry.namespaces_auto_assigned` events
2. **Identify patterns**: Find tools frequently miscategorized (e.g., domain tools in platform namespaces)
3. **Refine rules**: Update `assignNamespaces()` method with new patterns
4. **Measure impact**: Track developer feedback and tool execution distribution

**Example refinement**:

```typescript
// Before: Generic "data" tools
if (nameLower.includes('data')) {
  namespaces.push('domain/data');
}

// After: More granular categorization
if (nameLower.includes('analytics') || nameLower.includes('dashboard')) {
  namespaces.push('domain/analytics', 'domain/data', 'business-intelligence');
} else if (nameLower.includes('query') || nameLower.includes('search')) {
  namespaces.push('domain/data', 'domain/search');
} else if (nameLower.includes('export') || nameLower.includes('report')) {
  namespaces.push('domain/data', 'domain/reporting', 'business-intelligence');
}
```

---

#### Task 5.3: Optimize GIN Index Performance (1-2 hours)

**Validation queries** (run monthly):

```sql
-- Measure query performance
EXPLAIN ANALYZE
SELECT * FROM platform_tool_registry
WHERE 'platform/admin' = ANY(namespaces);
-- Target: < 50ms execution time

-- Check index bloat
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan as scans,
  idx_tup_read as tuples_read
FROM pg_stat_user_indexes
WHERE indexname = 'idx_tool_registry_namespaces';

-- Reindex if bloated (run during low-traffic window)
REINDEX INDEX CONCURRENTLY idx_tool_registry_namespaces;
```

---

#### Task 5.4: Cache Namespace Metadata (2-3 hours)

**File to modify**: `src/apps/tool-orchestrator-service.ts`

**Implementation guidance**:

```typescript
export class ToolOrchestratorServer extends Bit {
  private namespaceMetadataCache: Map<string, any> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastCacheRefresh: number = 0;

  async setup(): Promise<void> {
    // ... existing setup ...

    // Warm cache on startup
    await this.refreshNamespaceMetadataCache();

    // Refresh cache every 5 minutes
    setInterval(async () => {
      await this.refreshNamespaceMetadataCache();
    }, this.cacheExpiry);
  }

  private async refreshNamespaceMetadataCache(): Promise<void> {
    try {
      const result = await this.db.query<any>(
        'SELECT * FROM platform_tool_namespaces'
      );

      this.namespaceMetadataCache.clear();
      for (const row of result.rows) {
        this.namespaceMetadataCache.set(row.path, row);
      }

      this.lastCacheRefresh = Date.now();

      this.logger.debug('namespace_metadata_cache_refreshed', {
        namespaceCount: this.namespaceMetadataCache.size,
      });
    } catch (err) {
      this.logger.error('namespace_metadata_cache_refresh_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getNamespaceMetadata(path: string): any | undefined {
    return this.namespaceMetadataCache.get(path);
  }
}
```

---

### Sprint 5 Validation Checklist

Ongoing monitoring (monthly):

- [ ] Metrics dashboard shows namespace usage distribution
- [ ] MCP tools/list response time < 500ms for all namespaces (99th percentile)
- [ ] Array contains query time < 50ms (95th percentile)
- [ ] Zero `uncategorized` namespace assignments in logs (last 30 days)
- [ ] Developer survey: >80% positive feedback on tool discoverability
- [ ] GIN index bloat < 20% (check with SQL query)
- [ ] Namespace metadata cache hit rate > 95%
- [ ] No namespace assignment errors in logs (last 30 days)

---

## Success Metrics Summary

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| **Tool coverage** | 100% (505 tools auto-categorized) | SQL query: `SELECT COUNT(*) FROM platform_tool_registry WHERE namespaces != '{}'` |
| **Platform namespace tools** | 220-240 tools | Endpoint: `/mcp/platform` → tools/list count |
| **Domain namespace tools** | 270-290 tools | Endpoint: `/mcp/domain` → tools/list count |
| **llm-bot tool access** | 510 total tools (no truncation) | `fleet.info({ bit: 'llm-bot' })` → MCP stats |
| **Namespace query performance** | < 50ms (95th percentile) | EXPLAIN ANALYZE on array contains queries |
| **MCP tools/list latency** | < 500ms (99th percentile) | Performance monitoring dashboard |
| **Developer satisfaction** | >80% positive | Quarterly survey |
| **Zero regressions** | 0 breaking changes | Integration test suite + rollback plan |

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| **Schema migration failure** | VERY LOW | HIGH | Test in agent-dev first, have rollback SQL ready | Sprint 1 |
| **Performance degradation** | VERY LOW | MEDIUM | GIN indexes proven performant, monitor query times | Sprint 2 |
| **Client breaking changes** | VERY LOW | MEDIUM | Backward compatibility via empty MCP_TOOL_NAMESPACES | Sprint 3 |
| **Namespace miscategorization** | MEDIUM | LOW | Manual override via admin tools, monitor logs | Sprint 4 |
| **GIN index bloat** | LOW | LOW | Monthly REINDEX CONCURRENTLY during low traffic | Sprint 5 |
| **Cache inconsistency** | LOW | VERY LOW | 5-minute TTL, fail-open to database query | Sprint 5 |

---

## Post-Implementation Checklist

After all sprints complete:

- [ ] Update architecture.yaml with namespace configuration examples (commented out)
- [ ] Document namespace taxonomy in `documentation/reference/tool-namespaces.md`
- [ ] Add namespace troubleshooting section to CLAUDE.md
- [ ] Create video walkthrough of namespace configuration (optional)
- [ ] Present namespace system to team (demo session)
- [ ] Collect developer feedback (survey or retro)
- [ ] Plan future enhancements (semantic auto-assignment, namespace bundles)

---

## References

- **Architecture Document**: `planning/architecture-tool-segmentation-namespacing.md`
- **Database Schema**: `migrations/024-create-platform-tool-registry.sql`
- **Tool Registry Types**: `src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts`
- **MCP Client Profile**: `src/common/profiles/mcp-client-profile.ts`
- **Tool-Orchestrator Service**: `src/apps/tool-orchestrator-service.ts`

---

**End of Implementation Plan**
