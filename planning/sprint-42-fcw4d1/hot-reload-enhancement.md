# Hot-Reload Enhancement Summary

**Sprint**: 42 (sprint-42-fcw4d1)
**Enhancement**: Added composition hot-reloading capability
**Date**: 2026-09-04

---

## What Was Added

### CompositionWatcher Class

A new `CompositionWatcher` class that mirrors the existing `RegistryWatcher` pattern used for MCP server discovery. This enables automatic detection and registration of composition changes without requiring service restarts.

**Location**: `src/common/composition/composition-watcher.ts` (new file)

**Key Features**:
- Polls `compositions` table every 30 seconds (configurable)
- Detects additions, updates (content hash changes), and deletions
- Automatically registers/unregisters/re-registers compositions as MCP tools
- Broadcasts tool list changes to connected clients (llm-bot, etc.)
- Graceful error handling with detailed logging

---

## How It Works

### Polling Cycle

```
T+0s:   CompositionWatcher starts, polls database
T+0s:   Snapshot received: 1 composition (grockle)
T+0s:   Baseline established

T+30s:  Poll again, detect new composition (test_composition)
T+30s:  Call onCompositionAdded(test_composition)
T+30s:  tool-gateway registers tool via registerCompositionTool()
T+30s:  Broadcast tools_list_changed to all MCP clients
T+30s:  llm-bot receives notification, refreshes tool registry
T+30s:  test_composition now available to LLM models

T+60s:  Poll again, detect content hash changed (test_composition updated)
T+60s:  Call onCompositionUpdated(test_composition)
T+60s:  tool-gateway re-registers tool (overwrites)
T+60s:  Broadcast tools_list_changed

T+90s:  Poll again, detect composition removed
T+90s:  Call onCompositionRemoved('test_composition', 1)
T+90s:  tool-gateway unregisters tool
T+90s:  Broadcast tools_list_changed
T+90s:  test_composition no longer available
```

### Change Detection Logic

**Additions**: Composition ID (`name:version`) not in `previousCompositions` map
**Updates**: Composition exists but `contentHash` differs from previous
**Deletions**: Previous composition ID not in current snapshot

---

## Integration Points

### Tool-Gateway Startup

```typescript
// After loadCompositions() in start() method
if (this.compositionsEnabled && this.compositionRegistry) {
  this.compositionWatcher = new CompositionWatcher(this, {
    registry: this.compositionRegistry,
    onCompositionAdded: async (composition) => { /* register */ },
    onCompositionRemoved: async (name, version) => { /* unregister */ },
    onCompositionUpdated: async (composition) => { /* re-register */ },
    pollInterval: parseInt(process.env.COMPOSITION_POLL_INTERVAL_MS || '30000', 10)
  });

  this.compositionWatcher.start();
}
```

### Tool-Gateway Shutdown

```typescript
if (this.compositionWatcher) {
  this.compositionWatcher.stop();
}
```

---

## Configuration

### Environment Variable

```bash
# Default: 30000 (30 seconds)
COMPOSITION_POLL_INTERVAL_MS=30000
```

**Tuning Guidelines**:
- **Development**: 10000 (10 seconds) - faster iteration
- **Staging**: 30000 (30 seconds) - balanced
- **Production**: 60000 (60 seconds) - lower overhead

**Note**: Shorter intervals increase database query load but provide faster hot-reload response.

---

## Benefits

### For Developers

✅ **No Restarts Required**: Add/update/delete compositions without restarting tool-gateway
✅ **Faster Iteration**: Test composition changes immediately (within poll interval)
✅ **Direct SQL Support**: Can use SQL INSERT/UPDATE/DELETE or `composition.register` MCP tool
✅ **Consistent Experience**: Same behavior whether compositions registered via MCP or SQL

### For Users (LLM Models)

✅ **Automatic Tool Discovery**: New compositions appear in tool list automatically
✅ **Updated Definitions**: Composition changes reflected without manual refresh
✅ **Clean Removal**: Deleted compositions removed from available tools

### For Operations

✅ **Zero-Downtime Updates**: Update compositions without service interruption
✅ **Rollback Support**: Delete bad composition, old version restored on next poll (if multi-version)
✅ **Observable**: Clear log messages for all watcher activity

---

## Testing

### Unit Tests

**File**: `src/common/composition/composition-watcher.test.ts`

Tests:
1. Detects new compositions
2. Detects removed compositions
3. Detects updated compositions (content hash changed)
4. Ignores unchanged compositions
5. Handles errors gracefully
6. Stops polling when stop() called

### Integration Test

**Script**: `planning/sprint-42-fcw4d1/test-hot-reload.sh`

Full lifecycle test:
1. Baseline: Get initial tool count
2. **ADD**: Insert composition via SQL, wait 35s, verify registered
3. **UPDATE**: Modify composition, wait 35s, verify re-registered
4. **DELETE**: Remove composition, wait 35s, verify unregistered

**Duration**: ~2 minutes (3 poll cycles × 35s each)

---

## Log Messages

### Watcher Lifecycle

```json
{"msg": "composition_watcher.starting", "pollInterval": 30000}
{"msg": "composition_watcher.started"}
{"msg": "composition_watcher.stopping"}
```

### Change Detection

```json
// Addition
{"msg": "composition_watcher.added", "name": "grockle", "version": 1}
{"msg": "composition_watcher.registering_new", "name": "grockle", "version": 1}

// Update
{"msg": "composition_watcher.updated", "name": "grockle", "version": 1, "oldHash": "hash1", "newHash": "hash2"}
{"msg": "composition_watcher.re_registering", "name": "grockle", "version": 1}

// Deletion
{"msg": "composition_watcher.removed", "name": "grockle", "version": 1}
{"msg": "composition_watcher.unregistering", "name": "grockle", "version": 1}
```

### Poll Activity

```json
{"msg": "composition_watcher.snapshot_received", "count": 3}
```

### Errors

```json
{"msg": "composition_watcher.snapshot_error", "error": "...", "stack": "..."}
{"msg": "composition_watcher.add_handler_error", "name": "grockle", "version": 1, "error": "..."}
```

---

## Comparison to Existing Patterns

The `CompositionWatcher` follows the exact same pattern as `RegistryWatcher` (used for MCP server discovery):

| Feature | RegistryWatcher | CompositionWatcher |
|---------|-----------------|-------------------|
| **Purpose** | Watch MCP server configs | Watch composition definitions |
| **Store** | `service_registry` collection | `compositions` table |
| **Poll Interval** | 5000ms (default) | 30000ms (default) |
| **Callbacks** | onServerActive, onServerInactive | onCompositionAdded, onCompositionRemoved, onCompositionUpdated |
| **Change Detection** | Compare JSON stringify | Compare content hash |
| **Error Handling** | Graceful, logged | Graceful, logged |
| **Lifecycle** | start() / stop() | start() / stop() |

---

## Future Enhancements

### Possible Optimizations

1. **Caching**: Cache compiled compositions to avoid recompilation on every poll
2. **LISTEN/NOTIFY**: Use PostgreSQL LISTEN/NOTIFY for push-based updates instead of polling
3. **Batch Updates**: Queue multiple changes and apply in batches
4. **Versioning**: Track composition version history and support rollback

### Additional Features

1. **Selective Polling**: Watch only specific compositions (filter by tag, author)
2. **Rate Limiting**: Limit number of registrations per poll cycle
3. **Health Checks**: Validate composition before registration (compile test)
4. **Metrics**: Track registration success/failure rates, poll latency

---

## Migration Path

### Existing Deployments

No migration required! The watcher is **additive**:

- Existing compositions registered via `composition.register` MCP tool: ✅ Works
- New compositions inserted via SQL: ✅ Works
- Mixed registration methods: ✅ Works

The watcher simply ensures all compositions in the database are registered, regardless of how they got there.

### Rollback

If issues arise, disable the watcher:

```typescript
// In tool-gateway.ts start() method
const ENABLE_COMPOSITION_WATCHER = process.env.ENABLE_COMPOSITION_WATCHER !== 'false';

if (this.compositionsEnabled && this.compositionRegistry && ENABLE_COMPOSITION_WATCHER) {
  // Start watcher
}
```

Set `ENABLE_COMPOSITION_WATCHER=false` to disable without code changes.

---

## Documentation Updates

Updated implementation plan includes:

1. **Phase 1.3**: CompositionWatcher implementation details
2. **Phase 2.4**: Hot-reload validation test script
3. **Success Criteria**: Added hot-reload specific criteria
4. **Timeline**: Updated to 6.5-8.5 hours (from 4.5-6.5)

---

## Summary

The hot-reload enhancement transforms composition management from **static** (requires restart) to **dynamic** (automatic hot-reload), enabling:

- Faster development iteration
- Zero-downtime composition updates
- Consistent behavior across registration methods
- Better operational flexibility

**Implementation Effort**: +2 hours
**Value**: High - significantly improves developer experience and operational agility
**Risk**: Low - follows proven pattern (RegistryWatcher), fail-safe design

---

**Status**: Planned, ready for implementation
**Depends On**: Phase 1.1 (CompositionRegistry.list() fix)
**Sprint**: sprint-42-fcw4d1
