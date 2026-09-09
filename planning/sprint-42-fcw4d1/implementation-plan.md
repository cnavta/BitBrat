# Implementation Plan: Composition Tool Registration Fix

**Sprint**: 42 (sprint-42-fcw4d1)
**Goal**: Fix composition tool registration so database-stored compositions appear as MCP tools + enable hot-reloading
**Approach**: Compile definitions on load + add composition polling (Option 1 from root-cause-analysis.md + hot-reload enhancement)

---

## Overview

1. **Fix Initial Loading**: Modify `CompositionRegistry.list()` to compile raw `definition` fields from the database into `CompiledComposition` objects, ensuring all loaded compositions have the structure expected by `registerCompositionTool()`.

2. **Enable Hot-Reloading**: Add `CompositionWatcher` that polls the compositions table and automatically registers/unregisters/updates composition tools when database changes are detected (similar to existing `RegistryWatcher` for MCP servers).

---

## Implementation Steps

### Phase 1: Core Fix

#### 1.1 Modify CompositionRegistry.list()

**File**: `src/common/composition/registry.ts`
**Location**: Line 289-292

**Current Code**:
```typescript
async list(): Promise<CompositionRecord[]> {
  const results = await this.store.query(this.collection, {});
  return results as CompositionRecord[];  // Unsafe cast
}
```

**New Code**:
```typescript
async list(): Promise<CompositionRecord[]> {
  const results = await this.store.query(this.collection, {});

  // Transform database records to CompositionRecords with compiled definitions
  return results.map((row: any) => {
    // Database schema: {id, name, version, content_hash, definition, created_at, updated_at}
    // Parse definition (raw composition YAML as JSONB)
    const definition = row.definition as CompositionDefinition;

    // Compile definition to get executable composition
    const compiled = this.compiler.compile(definition);

    // Construct properly-typed CompositionRecord
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      contentHash: row.content_hash || row.contentHash,  // Handle both snake_case and camelCase
      compiled,
      createdAt: row.created_at ? new Date(row.created_at) : row.createdAt,
      updatedAt: row.updated_at ? new Date(row.updated_at) : row.updatedAt,
    };
  });
}
```

**Rationale**:
- Handles mismatch between database schema (snake_case) and TypeScript types (camelCase)
- Compiles each definition using existing `CompositionCompiler`
- Produces correctly-structured `CompositionRecord` objects
- Works for both MCP-registered and SQL-inserted compositions

#### 1.2 Add Error Handling

Wrap compilation in try/catch to gracefully handle invalid compositions:

```typescript
async list(): Promise<CompositionRecord[]> {
  const results = await this.store.query(this.collection, {});

  const records: CompositionRecord[] = [];

  for (const row of results) {
    try {
      const definition = row.definition as CompositionDefinition;
      const compiled = this.compiler.compile(definition);

      records.push({
        id: row.id,
        name: row.name,
        version: row.version,
        contentHash: row.content_hash || row.contentHash,
        compiled,
        createdAt: row.created_at ? new Date(row.created_at) : row.createdAt,
        updatedAt: row.updated_at ? new Date(row.updated_at) : row.updatedAt,
      });
    } catch (err) {
      // Log compilation error but continue loading other compositions
      console.error(`Failed to compile composition ${row.name}:${row.version}:`, err);
    }
  }

  return records;
}
```

**Decision**: Use logging utility from constructor context if available (this.logger if registry is Bit-aware).

#### 1.3 Add CompositionWatcher for Hot-Reloading

Create a watcher that polls the compositions table and dynamically updates registered tools.

**File**: `src/common/composition/composition-watcher.ts` (new file)

**Implementation**:
```typescript
import { Bit } from '../base-server';
import { CompositionRegistry } from './registry';
import { CompiledComposition } from './types';

export interface CompositionWatcherOptions {
  registry: CompositionRegistry;
  onCompositionAdded: (composition: CompiledComposition) => Promise<void>;
  onCompositionRemoved: (name: string, version: number) => Promise<void>;
  onCompositionUpdated: (composition: CompiledComposition) => Promise<void>;
  pollInterval?: number; // Default: 30000 (30 seconds)
}

export class CompositionWatcher {
  private unsubscribe?: () => void;
  private logger: any;
  private previousCompositions: Map<string, CompiledComposition> = new Map();

  constructor(
    private server: Bit,
    private options: CompositionWatcherOptions
  ) {
    this.logger = (server as any).getLogger();
  }

  start() {
    this.logger.info('composition_watcher.starting', {
      pollInterval: this.options.pollInterval || 30000
    });

    // Use DocumentStore.watch() to poll compositions table
    this.unsubscribe = this.options.registry['store'].watch(
      'compositions',
      async (rows: any[]) => {
        this.logger.debug('composition_watcher.snapshot_received', {
          count: rows.length,
        });

        try {
          // Transform and compile all compositions
          const current = await this.options.registry.list();

          // Track current composition IDs
          const currentIds = new Set(current.map(c => `${c.name}:${c.version}`));
          const previousIds = new Set(this.previousCompositions.keys());

          // Detect removals
          for (const id of previousIds) {
            if (!currentIds.has(id)) {
              const [name, versionStr] = id.split(':');
              const version = parseInt(versionStr, 10);
              this.logger.info('composition_watcher.removed', { name, version });

              await this.options.onCompositionRemoved(name, version)
                .catch(error => {
                  this.logger.error('composition_watcher.remove_handler_error', {
                    name,
                    version,
                    error
                  });
                });

              this.previousCompositions.delete(id);
            }
          }

          // Detect additions and updates
          for (const record of current) {
            const id = `${record.name}:${record.version}`;
            const previous = this.previousCompositions.get(id);

            if (!previous) {
              // New composition
              this.logger.info('composition_watcher.added', {
                name: record.name,
                version: record.version
              });

              await this.options.onCompositionAdded(record.compiled)
                .catch(error => {
                  this.logger.error('composition_watcher.add_handler_error', {
                    name: record.name,
                    version: record.version,
                    error
                  });
                });

              this.previousCompositions.set(id, record.compiled);
            } else {
              // Check if updated (compare content hash)
              const contentChanged = record.contentHash !== previous.contentHash;

              if (contentChanged) {
                this.logger.info('composition_watcher.updated', {
                  name: record.name,
                  version: record.version,
                  oldHash: previous.contentHash,
                  newHash: record.contentHash
                });

                await this.options.onCompositionUpdated(record.compiled)
                  .catch(error => {
                    this.logger.error('composition_watcher.update_handler_error', {
                      name: record.name,
                      version: record.version,
                      error
                    });
                  });

                this.previousCompositions.set(id, record.compiled);
              }
            }
          }
        } catch (err) {
          this.logger.error('composition_watcher.snapshot_error', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
          });
        }
      },
      this.options.pollInterval || 30000 // Poll every 30 seconds by default
    );

    this.logger.info('composition_watcher.started');
  }

  stop() {
    this.logger.info('composition_watcher.stopping');
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}
```

**Integration in tool-gateway.ts**:

After `loadCompositions()` in the `start()` method, add:

```typescript
// Start composition watcher for hot-reloading (Sprint 42)
if (this.compositionsEnabled && this.compositionRegistry) {
  this.compositionWatcher = new CompositionWatcher(this, {
    registry: this.compositionRegistry,
    onCompositionAdded: async (composition) => {
      this.getLogger().info('composition_watcher.registering_new', {
        name: composition.metadata.name,
        version: composition.metadata.version
      });
      await this.registerCompositionTool(composition);

      // Broadcast tool list changed notification
      await this.broadcastListChangedNotifications();
    },
    onCompositionRemoved: async (name, version) => {
      this.getLogger().info('composition_watcher.unregistering', { name, version });

      // Unregister from ToolRegistry
      this.registry.unregisterTool(name);

      // Unregister from MCP
      // Note: Bit MCP doesn't have unregisterTool yet, may need to track and exclude

      // Broadcast tool list changed notification
      await this.broadcastListChangedNotifications();
    },
    onCompositionUpdated: async (composition) => {
      this.getLogger().info('composition_watcher.re_registering', {
        name: composition.metadata.name,
        version: composition.metadata.version
      });

      // Re-register (overwrites existing)
      await this.registerCompositionTool(composition);

      // Broadcast tool list changed notification
      await this.broadcastListChangedNotifications();
    },
    pollInterval: 30000 // Poll every 30 seconds
  });

  this.compositionWatcher.start();
}
```

**Add cleanup in shutdown()**:
```typescript
if (this.compositionWatcher) {
  this.compositionWatcher.stop();
}
```

**Benefits**:
- ✅ Compositions can be added/updated/removed without restarting tool-gateway
- ✅ Uses existing polling infrastructure (DocumentStore.watch)
- ✅ Broadcasts list changes to connected clients (llm-bot gets notified)
- ✅ Follows same pattern as RegistryWatcher for consistency

**Configuration**:
Poll interval can be configured via environment variable:
```yaml
# architecture.yaml
tool-gateway:
  env:
    - COMPOSITION_POLL_INTERVAL_MS=30000  # 30 seconds (default)
```

---

### Phase 2: Validation & Testing

#### 2.1 Unit Tests

**File**: `src/common/composition/registry.test.ts`

**Test Cases** (registry.test.ts):
1. `list() compiles definitions from database records`
2. `list() handles snake_case database columns`
3. `list() returns empty array for empty database`
4. `list() skips invalid compositions with error logging`
5. `list() preserves all CompositionRecord fields`

**Test Cases** (composition-watcher.test.ts):
1. `CompositionWatcher detects new compositions`
2. `CompositionWatcher detects removed compositions`
3. `CompositionWatcher detects updated compositions (content hash changed)`
4. `CompositionWatcher ignores unchanged compositions`
5. `CompositionWatcher handles errors gracefully`
6. `CompositionWatcher stops polling when stop() called`

**Example Test**:
```typescript
describe('CompositionRegistry.list', () => {
  it('should compile definitions from database records', async () => {
    const mockStore = {
      query: jest.fn().mockResolvedValue([
        {
          id: 'test:1',
          name: 'test',
          version: 1,
          content_hash: 'hash123',
          definition: {
            apiVersion: 'mcp-compose/v1',
            kind: 'Composition',
            metadata: { name: 'test', description: 'Test composition', version: 1 },
            spec: { inputSchema: {}, steps: [], return: {} }
          },
          created_at: '2026-09-04T10:00:00Z',
          updated_at: '2026-09-04T10:00:00Z'
        }
      ])
    };

    const mockRegistry = { /* mock ToolRegistry */ };
    const registry = new CompositionRegistry(mockStore as any, mockRegistry as any);

    const results = await registry.list();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('test');
    expect(results[0].compiled).toBeDefined();
    expect(results[0].compiled.metadata).toBeDefined();
    expect(results[0].compiled.spec).toBeDefined();
  });
});
```

#### 2.2 Integration Test: Load grockle from Staging

**Validation Script**: `planning/sprint-42-fcw4d1/validate-grockle-loading.sh`

```bash
#!/bin/bash
# Validate that grockle composition loads and registers correctly

set -e

echo "=== Grockle Composition Loading Validation ==="

# 1. Check database
echo "1. Verifying grockle in database..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-postgres-1 \
  psql -U bitbrat -d bitbrat -t -c \
  \"SELECT COUNT(*) FROM compositions WHERE name = 'grockle'\"" | tr -d ' '

# Expected: 1

# 2. Restart tool-gateway
echo "2. Restarting tool-gateway..."
ssh root@bitbrat.lan "docker restart bitbrat-staging-tool-gateway-1"
sleep 10

# 3. Check logs for successful registration
echo "3. Checking registration logs..."
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1" | \
  grep -E "compositions.loaded|compositions.registered|composition.registered.*grockle" | \
  tail -5

# Expected:
# - "compositions.loaded","count":1
# - "composition.registered","toolId":"grockle"

# 4. Verify tool is available via MCP
echo "4. Verifying grockle tool available..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 \
  curl -s http://localhost:3000/mcp/tools" | \
  jq '.tools[] | select(.name == "grockle")'

# Expected: Tool definition with name="grockle"

echo "=== Validation Complete ==="
```

#### 2.3 End-to-End Test: Invoke grockle

**Test Script**: `planning/sprint-42-fcw4d1/test-grockle-invocation.sh`

```bash
#!/bin/bash
# Test grockle composition invocation

set -e

echo "=== Grockle Invocation Test ==="

# Invoke grockle via tool-gateway REST API
curl -X POST http://staging-tool-gateway/v1/tools/grockle \
  -H "Content-Type: application/json" \
  -d '{"description": "test description"}' | jq '.'

# Expected: Response with imageUrl field
# {
#   "imageUrl": "https://..."
# }

echo "=== Test Complete ==="
```

#### 2.4 Hot-Reload Validation Test

**Test Script**: `planning/sprint-42-fcw4d1/test-hot-reload.sh`

```bash
#!/bin/bash
# Test composition hot-reloading without service restart

set -e

echo "=== Composition Hot-Reload Test ==="

# 1. Get current tool list
echo "1. Getting baseline tool list..."
BEFORE_COUNT=$(ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 \
  curl -s http://localhost:3000/mcp/tools" | jq '.tools | length')
echo "   Tools before: $BEFORE_COUNT"

# 2. Insert a new test composition
echo "2. Inserting test composition..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-postgres-1 psql -U bitbrat -d bitbrat" <<'EOSQL'
INSERT INTO compositions (id, name, version, content_hash, definition, created_at, updated_at)
VALUES (
  'test_hotreload:1',
  'test_hotreload',
  1,
  'test-hash-' || extract(epoch from now()),
  '{"apiVersion": "mcp-compose/v1", "kind": "Composition", "metadata": {"name": "test_hotreload", "description": "Test hot reload", "version": 1}, "spec": {"inputSchema": {"type": "object", "properties": {"msg": {"type": "string"}}, "required": ["msg"]}, "steps": [{"id": "echo", "call": "noop", "with": {"value": {"$ref": {"namespace": "input", "pointer": "/msg"}}}}], "return": {"result": {"$ref": {"namespace": "steps", "pointer": "/echo/value"}}}}}'::jsonb,
  NOW(),
  NOW()
);
EOSQL

# 3. Wait for poll interval (30 seconds + 5 second buffer)
echo "3. Waiting 35 seconds for composition watcher to poll..."
sleep 35

# 4. Check logs for watcher activity
echo "4. Checking watcher logs..."
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1" | \
  grep -E "composition_watcher\.(added|registering_new).*test_hotreload" | tail -3

# 5. Verify tool is available (without restart!)
echo "5. Verifying test_hotreload tool available..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 \
  curl -s http://localhost:3000/mcp/tools" | \
  jq '.tools[] | select(.name == "test_hotreload")'

# Expected: Tool definition with name="test_hotreload"

# 6. Test UPDATE - change description
echo "6. Testing composition update..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-postgres-1 psql -U bitbrat -d bitbrat" <<'EOSQL'
UPDATE compositions
SET
  definition = jsonb_set(definition, '{metadata,description}', '"Updated description"'),
  content_hash = 'test-hash-updated-' || extract(epoch from now()),
  updated_at = NOW()
WHERE name = 'test_hotreload';
EOSQL

echo "7. Waiting 35 seconds for update detection..."
sleep 35

echo "8. Checking update logs..."
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1" | \
  grep -E "composition_watcher\.updated.*test_hotreload" | tail -3

# 9. Test DELETE - remove composition
echo "9. Testing composition removal..."
ssh root@bitbrat.lan "docker exec bitbrat-staging-postgres-1 \
  psql -U bitbrat -d bitbrat -c \
  \"DELETE FROM compositions WHERE name = 'test_hotreload'\""

echo "10. Waiting 35 seconds for removal detection..."
sleep 35

echo "11. Checking removal logs..."
ssh root@bitbrat.lan "docker logs bitbrat-staging-tool-gateway-1 2>&1" | \
  grep -E "composition_watcher\.(removed|unregistering).*test_hotreload" | tail -3

# 12. Verify tool is gone
echo "12. Verifying test_hotreload tool removed..."
TOOL_EXISTS=$(ssh root@bitbrat.lan "docker exec bitbrat-staging-tool-gateway-1 \
  curl -s http://localhost:3000/mcp/tools" | \
  jq '.tools[] | select(.name == "test_hotreload")' || echo "")

if [ -z "$TOOL_EXISTS" ]; then
  echo "   ✅ Tool successfully removed"
else
  echo "   ❌ Tool still exists!"
  exit 1
fi

echo "=== Hot-Reload Test Complete ==="
```

**Note**: This test validates the full hot-reload lifecycle (add → update → delete) without any service restarts.

---

### Phase 3: Deployment & Verification

#### 3.1 Local Validation

```bash
# Build
npm run build

# Run tests
npm test -- registry.test.ts

# Verify no TypeScript errors
npx tsc --noEmit
```

#### 3.2 Agent-Dev Validation

```bash
# Provision agent-dev context
npm run brat -- mcp agent-dev.provision '{"name": "agent-dev-sprint-42-test"}'

# Deploy tool-gateway
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint-42-test

# Insert test composition
cat > /tmp/test-composition.yaml << 'EOF'
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: test_sprint_42
  description: Test composition for Sprint 42
  version: 1
spec:
  inputSchema:
    type: object
    properties:
      message:
        type: string
    required: [message]
  steps:
    - id: echo
      call: noop
      with:
        value:
          $ref: {namespace: input, pointer: /message}
  return:
    result:
      $ref: {namespace: steps, pointer: /echo/value}
EOF

# Register via composition.register tool or direct SQL
# Then verify it loads correctly

# Cleanup
npm run brat -- mcp agent-dev.destroy '{"name": "agent-dev-sprint-42-test", "confirm": true}'
```

#### 3.3 Staging Deployment

```bash
# Deploy to staging
npm run brat -- bit deploy tool-gateway --context staging

# Run validation script
bash planning/sprint-42-fcw4d1/validate-grockle-loading.sh

# Run invocation test
bash planning/sprint-42-fcw4d1/test-grockle-invocation.sh
```

---

### Phase 4: Documentation

#### 4.1 Update Composition Documentation

**File**: `documentation/guides/compositions.md` (or create if missing)

Add section:

```markdown
## Database Storage

Compositions are stored in PostgreSQL with the following schema:

- `id`: Unique identifier (UUID)
- `name`: Composition name (used as MCP tool ID)
- `version`: Version number (auto-incremented)
- `content_hash`: SHA-256 hash for deduplication
- `definition`: Full composition definition (JSONB)
- `created_at`: Creation timestamp
- `updated_at`: Last modification timestamp

### Direct SQL Insertion

You can insert compositions directly via SQL:

```sql
INSERT INTO compositions (id, name, version, content_hash, definition, created_at, updated_at)
VALUES (
  'my-comp:1',
  'my-comp',
  1,
  'hash-value',
  '{"apiVersion": "mcp-compose/v1", ...}'::jsonb,
  NOW(),
  NOW()
);
```

**Note**: Compositions are automatically compiled when loaded by the `CompositionRegistry`. No manual compilation step is required.
```

#### 4.2 Add Comment in registry.ts

```typescript
/**
 * List all compositions
 *
 * Loads compositions from database and compiles them into executable format.
 * Handles both compositions registered via MCP tools and those inserted directly via SQL.
 *
 * Database records contain raw `definition` field (JSONB composition YAML).
 * This method compiles each definition using CompositionCompiler to produce
 * executable CompiledComposition objects.
 *
 * @returns Array of all composition records with compiled definitions
 */
async list(): Promise<CompositionRecord[]> {
  // ...
}
```

---

## Testing Strategy

### Unit Tests (MUST PASS)

- `CompositionRegistry.list()` compilation
- Error handling for invalid compositions
- Snake_case to camelCase field mapping
- Date parsing from database timestamps

### Integration Tests (MUST PASS)

- Load grockle from staging database
- Verify tool appears in MCP tool list
- Restart tool-gateway and verify persistence

### End-to-End Tests (MUST PASS)

- Invoke grockle composition via REST API
- Verify composition execution completes
- Check response has expected structure

---

## Rollback Plan

If the fix causes issues:

1. **Revert Change**:
   ```bash
   git revert <commit-hash>
   npm run build
   npm run brat -- bit deploy tool-gateway --context staging
   ```

2. **Temporary Workaround**:
   - Remove SQL-inserted compositions from database
   - Use only `composition.register` MCP tool for registration

3. **Fallback**:
   - Disable composition subsystem via feature flag if available
   - Restart tool-gateway without compositions enabled

---

## Success Criteria

### Core Fix
✅ **Code**: `CompositionRegistry.list()` compiles definitions from database records

✅ **Tests**: All unit tests pass (registry + watcher)

✅ **Integration**: grockle loads successfully on tool-gateway startup

✅ **Registration**: grockle appears in MCP tool list

✅ **Execution**: grockle can be invoked and returns expected response

✅ **Logs**: No errors during composition loading

### Hot-Reload Feature
✅ **Watcher**: CompositionWatcher polls database every 30 seconds

✅ **Add Detection**: New compositions automatically registered without restart

✅ **Update Detection**: Modified compositions (content hash changed) automatically re-registered

✅ **Remove Detection**: Deleted compositions automatically unregistered

✅ **Notification**: llm-bot and other clients notified of tool list changes via `broadcastListChangedNotifications()`

✅ **Logs**: Clear watcher activity in logs (added/updated/removed events)

### Documentation
✅ **Documentation**: Updated to explain database storage, direct SQL insertion, and hot-reload behavior

---

## Timeline Estimate

- **Phase 1 (Core Fix)**: 2-3 hours (includes watcher implementation)
- **Phase 2 (Testing)**: 3-4 hours (includes hot-reload tests)
- **Phase 3 (Deployment)**: 1 hour
- **Phase 4 (Documentation)**: 30 minutes

**Total**: 6.5-8.5 hours

---

## Dependencies

- `CompositionCompiler` (src/common/composition/compiler.ts)
- `CompositionDefinition` type (src/common/composition/types.ts)
- PostgreSQL `compositions` table schema
- DocumentStore interface

---

## Risks

1. **Compilation Failures**: Invalid compositions in database could crash loading
   - **Mitigation**: Error handling catches and logs compilation errors

2. **Performance**: Compilation on every load could be slow with many compositions
   - **Mitigation**: Can add caching layer in future if needed

3. **Schema Changes**: Future migrations might change field names
   - **Mitigation**: Defensive field access handles both snake_case and camelCase

---

## Next Steps

1. Implement Phase 1 (core fix)
2. Run unit tests
3. Validate in agent-dev
4. Deploy to staging
5. Run validation scripts
6. Update documentation
7. Create verification report
8. Complete sprint

---

**Status**: Ready for implementation
**Owner**: Lead Implementor (Claude)
**Sprint**: sprint-42-fcw4d1
