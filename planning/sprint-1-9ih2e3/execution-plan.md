# Execution Plan: Fix Debug Trace Message Re-delivery Issue

**Sprint:** sprint-1-9ih2e3
**Owner:** Lead Implementor
**Created:** 2026-08-06

## Executive Summary

Debug trace responses are being re-sent after platform re-deploy due to a critical message acknowledgment timing issue combined with an in-memory deduplication cache. When services crash or restart before acknowledging NATS messages, the messages are redelivered, and the now-empty in-memory dedupe cache allows duplicate debug updates to be sent.

## Root Cause Analysis

### Problem Flow

1. **Normal Operation:**
   - Service receives event with `qos.tracer=true` from NATS
   - Service calls `next()` which:
     - Calls `sendDebugUpdate()` → publishes to `internal.egress.v1`
     - Publishes event to next routing topic
   - Service calls `ctx.ack()` → message acknowledged
   - ✅ Works correctly

2. **Failure Scenario (Current Bug):**
   - Service receives event with `qos.tracer=true` from NATS
   - Service calls `next()` which sends debug update ✅
   - **Service crashes/restarts BEFORE calling `ctx.ack()`** ❌
   - NATS redelivers message (not acknowledged)
   - Service restarts → `debugMessageCache` is empty (in-memory)
   - Service processes redelivered event
   - `sendDebugUpdate()` checks cache (empty) → sends duplicate ❌
   - **Result:** Duplicate debug messages accumulate

### Evidence

**File:** `src/common/base-server.ts`

1. **Line 128:** In-memory dedupe cache
   ```typescript
   private readonly debugMessageCache: Map<string, number> = new Map();
   ```

2. **Lines 987-1017:** Debug updates sent BEFORE message publish
   ```typescript
   // Sprint 371: Send debug progress update before publishing
   if (event.qos?.tracer && event.metadata?.debug?.enabled) {
     await this.sendDebugUpdate(debugChannel, connector, progressUpdate, ...);
   }

   // Then publish routing message
   await pub.publishJson(event, ...);
   ```

3. **Lines 1222-1241:** Dedupe logic
   ```typescript
   if (this.debugMessageCache.has(dedupeKey)) {
     return; // Skip duplicate
   }
   this.debugMessageCache.set(dedupeKey, Date.now());
   ```

**File:** `src/apps/auth-service.ts` (and similar services)

1. **Lines 162-176:** `next()` called before `ack()`
   ```typescript
   await this.next(enrichedV2, 'OK');  // Sends debug updates
   // ... other code ...
   await ctx.ack();  // Acknowledges ONLY if no error
   ```

### Why This Affects Debug Messages Specifically

- **Regular messages:** Have persistent routing slips, normal retry logic
- **Debug messages:** Rely on ephemeral in-memory cache for deduplication
- **Impact:** Debug messages are the ONLY messages with this vulnerability

## Solution Architecture

### Option 1: Persistent Dedupe Cache (RECOMMENDED)

**Approach:** Replace in-memory `Map` with persistent storage (PostgreSQL/Firestore)

**Pros:**
- Survives service restarts
- Works across multiple instances
- Simple conceptual model
- No behavioral changes to message flow

**Cons:**
- Adds database dependency for debug messages
- Slight latency increase (~10-50ms per debug update)
- Requires cache cleanup/TTL management

**Implementation:**
```typescript
// Use PostgreSQL or Firestore to store dedupe keys
interface DebugDedupeRecord {
  key: string;           // ${correlationId}:${service}:${type}
  createdAt: string;     // ISO timestamp
  expiresAt: string;     // TTL-based expiration
}

// Check/set atomically
const exists = await dedupeStore.checkAndSet(dedupeKey, ttl);
if (exists) return; // Skip duplicate
```

### Option 2: Idempotency via Message Attributes (ALTERNATIVE)

**Approach:** Add idempotency key to debug feedback events, let NATS/Pub/Sub dedupe

**Pros:**
- Leverages platform capabilities
- No additional persistence layer
- Minimal code changes

**Cons:**
- Not supported by NATS JetStream (no native message deduplication)
- Would only work for Pub/Sub deployments
- Doesn't solve cross-instance deduplication

**Verdict:** ❌ Not viable for NATS-based deployments

### Option 3: Ack-Before-Send Pattern (ALTERNATIVE)

**Approach:** Acknowledge message BEFORE sending debug updates

**Pros:**
- Simple implementation
- No persistence needed
- Eliminates redelivery

**Cons:**
- **Violates at-least-once delivery guarantee** ❌
- If debug send fails, message is lost
- Creates new failure mode (message ack'd but debug not sent)

**Verdict:** ❌ Breaks delivery guarantees

### Option 4: Hybrid - Persistent Cache + Ack Ordering (BEST)

**Approach:** Combine Option 1 with improved error handling

**Implementation:**
1. Use persistent dedupe cache (PostgreSQL preferred)
2. Ensure `ctx.ack()` is called even on debug send failures
3. Add retry logic for debug update publish failures
4. Clean up expired cache entries periodically

**Pros:**
- Best of both worlds
- Maintains delivery guarantees
- Survives restarts
- Handles edge cases (debug send failures)

**Cons:**
- Most complex implementation
- Requires careful error handling

**Verdict:** ✅ **RECOMMENDED** - Most robust solution

## Implementation Plan

### Phase 1: Persistent Dedupe Cache (Core Fix)

**Goal:** Replace in-memory cache with PostgreSQL-backed persistence

**Tasks:**
1. Create `debug_message_dedupe` table schema
2. Implement `DebugDedupeStore` interface
3. Add PostgreSQL implementation
4. Add Firestore fallback (legacy)
5. Integrate into `base-server.ts::sendDebugUpdate()`
6. Add TTL-based cleanup job

**Deliverables:**
- Database migration: `migrations/XXX-debug-dedupe-cache.sql`
- Interface: `src/common/persistence/debug-dedupe-store.ts`
- PostgreSQL impl: `src/common/persistence/postgres-debug-dedupe.ts`
- Firestore impl: `src/common/persistence/firestore-debug-dedupe.ts`
- Integration: Updated `base-server.ts`

### Phase 2: Error Handling & Resilience

**Goal:** Ensure services ack messages even if debug send fails

**Tasks:**
1. Wrap `sendDebugUpdate()` in try/catch (already done, verify)
2. Add retry logic for transient failures
3. Log failures without breaking routing
4. Add metrics for debug send failures

**Deliverables:**
- Updated `base-server.ts::sendDebugUpdate()` with retry
- Metrics instrumentation
- Error logging enhancements

### Phase 3: Validation & Testing

**Goal:** Verify fix works across restart scenarios

**Tasks:**
1. Unit tests: `DebugDedupeStore` implementations
2. Integration tests: Restart scenarios
3. Manual testing: Deploy → restart → verify no duplicates
4. Performance testing: Latency impact of persistent cache

**Deliverables:**
- Unit tests: `debug-dedupe-store.spec.ts`
- Integration tests: `debug-restart-resilience.spec.ts`
- Performance benchmarks

### Phase 4: Documentation & Cleanup

**Goal:** Document changes and migration path

**Tasks:**
1. Update CLAUDE.md with new dedupe behavior
2. Add troubleshooting guide
3. Create database cleanup documentation
4. Deprecate `DEBUG_MESSAGE_DEDUPE_TTL_MS` (now DB-managed)

**Deliverables:**
- Updated CLAUDE.md
- `documentation/guides/debug-dedupe-troubleshooting.md`
- Migration notes in CHANGELOG.md

## Database Schema

### PostgreSQL

```sql
CREATE TABLE IF NOT EXISTS debug_message_dedupe (
  dedupe_key VARCHAR(255) PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  correlation_id VARCHAR(100) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_debug_dedupe_expires
  ON debug_message_dedupe(expires_at);

-- Cleanup job (run periodically)
DELETE FROM debug_message_dedupe
WHERE expires_at < NOW();
```

### Firestore (Legacy Fallback)

```typescript
// Collection: debug_dedupe
// Document ID: ${dedupeKey}
interface DebugDedupeDoc {
  serviceName: string;
  correlationId: string;
  messageType: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
```

## Configuration

### New Environment Variables

```yaml
# env/local/global.yaml
DEBUG_DEDUPE_DRIVER: "postgres"  # postgres | firestore | memory (fallback)
DEBUG_DEDUPE_TTL_SECONDS: "300"  # 5 minutes (database TTL)
DEBUG_DEDUPE_CLEANUP_INTERVAL_MS: "60000"  # 1 minute (cleanup job)
```

### Backwards Compatibility

- `DEBUG_MESSAGE_DEDUPE_ENABLED`: Still respected
- `DEBUG_MESSAGE_DEDUPE_TTL_MS`: Converted to seconds for DB storage
- In-memory cache: Falls back if database unavailable

## Risk Mitigation

### Risk 1: Database Unavailability

**Mitigation:** Graceful fallback to in-memory cache with warning log

```typescript
let dedupeStore: DebugDedupeStore;
try {
  dedupeStore = new PostgresDebugDedupeStore(db);
} catch (error) {
  logger.warn('debug.dedupe.fallback_to_memory', { error });
  dedupeStore = new InMemoryDebugDedupeStore();
}
```

### Risk 2: Performance Impact

**Mitigation:**
- Use indexed queries (`expires_at` index)
- Batch cleanup (delete expired every 60s)
- Monitor latency, set alert threshold (>100ms)

### Risk 3: Migration Complexity

**Mitigation:**
- Feature flag: `DEBUG_DEDUPE_DRIVER=memory` to revert
- Gradual rollout: staging → production
- Documented rollback procedure

## Testing Strategy

### Unit Tests

1. `DebugDedupeStore` interface compliance
2. PostgreSQL CRUD operations
3. Firestore CRUD operations
4. TTL expiration logic
5. Fallback behavior

### Integration Tests

1. Service restart scenario:
   - Send !debug command
   - Restart service mid-processing
   - Verify NO duplicate debug messages
2. Cross-instance deduplication:
   - Two instances processing same event
   - Verify only ONE debug message sent
3. Database failure scenario:
   - Disconnect database
   - Verify fallback to in-memory cache

### Manual Testing

1. Deploy platform with fix
2. Send `!debug @bot test`
3. Restart all services
4. Verify no duplicate debug responses
5. Check logs for `debug.dedupe.hit` entries

## Success Criteria

**Functional:**
- ✅ No duplicate debug messages after service restart
- ✅ Dedupe cache survives across restarts
- ✅ Cross-instance deduplication works correctly

**Non-Functional:**
- ✅ Debug update latency < 100ms (p95)
- ✅ Database cleanup runs without errors
- ✅ Graceful fallback to in-memory cache on DB failure

**Documentation:**
- ✅ Updated CLAUDE.md with new behavior
- ✅ Troubleshooting guide for operators
- ✅ Migration notes in CHANGELOG.md

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Persistent Cache | 4-6 hours | Database access |
| Phase 2: Error Handling | 2-3 hours | Phase 1 complete |
| Phase 3: Testing | 3-4 hours | Phase 1, 2 complete |
| Phase 4: Documentation | 1-2 hours | Phase 1, 2, 3 complete |
| **Total** | **10-15 hours** | |

## Rollback Plan

If issues arise in production:

1. **Immediate:** Set `DEBUG_DEDUPE_DRIVER=memory` in environment
2. **Short-term:** Redeploy previous version
3. **Data cleanup:** Delete `debug_message_dedupe` table if needed
4. **Logs:** Review `debug.dedupe.*` logs for failure patterns

## Open Questions

1. **Q:** Should we backfill existing in-memory cache to database on startup?
   **A:** No - TTL is short (5 min), not worth complexity

2. **Q:** Should we support Redis as dedupe backend?
   **A:** Future enhancement - PostgreSQL sufficient for now

3. **Q:** Should we add metrics for dedupe hit rate?
   **A:** Yes - add to Phase 2

## References

- **Sprint 371:** Original debug mode implementation
- **File:** `src/common/base-server.ts` (lines 128, 987-1017, 1222-1241)
- **File:** `src/apps/auth-service.ts` (lines 84-190)
- **NATS Docs:** [At-Least-Once Delivery](https://docs.nats.io/nats-concepts/jetstream/consumers)
