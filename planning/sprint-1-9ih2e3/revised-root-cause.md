# REVISED ROOT CAUSE ANALYSIS

## Summary

Debug messages are re-sent after deploy because:
1. **Durable NATS consumers** persist unacknowledged messages across restarts
2. **No deduplication at egress consumption** - only at publish
3. **Graceful shutdown may not complete** before container termination

## Evidence from Staging Test

**Timeline:**
- 12:41 PM: `!debug !ping` sent
- 12:41 PM: Progress messages + "Pong!" delivered ✓
- 12:43 PM: Deploy → Progress messages RE-APPEAR + completion arrives late
- 12:50 PM: Another deploy → Messages RE-APPEAR again

**Key Observation:** Messages appear AFTER deploy completes, not during original processing.

## Root Cause Chain

### 1. Durable Consumers Persist Unacked Messages

**File:** `src/services/message-bus/nats-driver.ts:162-173`

```typescript
const durable = `${subj.replace(/\./g, '-')}-${queue.replace(/\./g, '-')}-durable`;
opts.durable(durable);      // Consumer state persists!
opts.manualAck();
opts.ackExplicit();
opts.ackWait(ackWaitSeconds * 1000); // Redelivery timeout
```

**Impact:**
- Messages received but not ack'd before shutdown remain in NATS
- New service instance reconnects to same durable consumer
- NATS redelivers un-ack'd messages

### 2. No Deduplication at Egress Layer

**File:** `src/apps/ingress-egress-service.ts:590-800` (processEgress)

**Current flow:**
```typescript
const text = extractEgressTextFromEvent(evtForDelivery);
// ... platform detection ...
await this.slackClient.sendText(text, targetChannel);
// ❌ NO DEDUPE CHECK ANYWHERE
```

**Contrast with publish-side dedupe:**

**File:** `src/common/base-server.ts:1222-1241`

```typescript
// Dedupe cache exists at PUBLISH side
if (this.debugMessageCache.has(dedupeKey)) {
  return; // Skip duplicate
}
this.debugMessageCache.set(dedupeKey, Date.now());
```

**The Gap:**
- ✅ Dedupe prevents **same service** from **publishing** same debug message twice
- ❌ NO dedupe prevents **egress service** from **consuming/delivering** same message twice

### 3. Graceful Shutdown Race Condition

**File:** `src/common/base-server.ts:314-355` (close method)

```typescript
for (const fn of this.unsubscribers.splice(0)) {
  await fn(); // Calls sub.drain()
}
```

**File:** `src/services/message-bus/nats-driver.ts:256-258`

```typescript
return async () => {
  try { await sub.drain(); } catch {}
};
```

**Problem:**
- Docker's SIGTERM timeout is 10 seconds
- If `sub.drain()` takes > 10s, container is SIGKILL'd
- Pending acks never reach NATS
- Messages redelivered on restart

## Why User Workaround Works

**User's Fix:** Delete NATS data before deploy

**Why it works:**
- Deleting NATS data removes durable consumer state
- No un-ack'd messages persist
- Fresh start on each deploy

**Why it's not acceptable:**
- Loses ALL inflight messages (not just debug)
- Manual intervention required
- Not production-viable

## Correct Solution

### Option 1: Egress-Side Deduplication (RECOMMENDED)

Add persistent dedupe cache at egress consumption:

```typescript
// In ingress-egress-service.ts::processEgress()
const dedupeKey = `egress:${evt.correlationId}:${evt.ingress?.source || 'unknown'}`;
const isDuplicate = await this.egressDedupeStore.checkAndSet(dedupeKey, 300); // 5min TTL

if (isDuplicate) {
  logger.info('ingress-egress.egress.deduplicated', {
    correlationId: evt.correlationId,
    source: evt.ingress?.source,
  });
  return 'IGNORED'; // Skip duplicate delivery
}

// ... proceed with delivery ...
```

**Pros:**
- Prevents duplicates at source (egress delivery)
- Works for ALL egress messages, not just debug
- Survives restarts (PostgreSQL-backed)
- Simple, focused fix

**Cons:**
- Adds database dependency to egress path
- Slight latency increase (~10-50ms)

### Option 2: Increase Shutdown Timeout (COMPLEMENTARY)

Ensure graceful shutdown completes:

```yaml
# docker-compose.yml
services:
  ingress-egress:
    stop_grace_period: 30s  # Increase from default 10s
```

**Pros:**
- Gives sub.drain() more time to complete
- May reduce (but not eliminate) redeliveries

**Cons:**
- Doesn't solve the root cause
- Slower deployments
- Still vulnerable to crashes

### Option 3: Idempotent Egress Delivery (ALTERNATIVE)

Use message attributes to detect duplicates:

```typescript
const messageId = evt.correlationId + ':' + evt.metadata?.debugMessageType;
// Store messageId in Slack message metadata
// Check on delivery if already sent
```

**Pros:**
- Platform-native deduplication

**Cons:**
- Platform-specific (Slack API doesn't support this well)
- Not portable to Twitch/Discord
- More complex

## Recommended Approach

**Hybrid: Option 1 + Option 2**

1. **Add egress-side dedupe cache (Option 1)** - Core fix
   - Use PostgreSQL (platform-agnostic, already deployed)
   - 5-minute TTL (matches user's deletion interval)
   - Apply to ALL egress deliveries (not just debug)

2. **Increase shutdown timeout (Option 2)** - Defense in depth
   - 30s grace period for drain to complete
   - Reduces redeliveries during normal deployments

3. **Remove publish-side dedupe for debug** - Simplification
   - No longer needed if egress dedupes
   - Reduces code complexity

## Updated Task List

### Phase 1: Egress Dedupe (Core Fix)

1. **DD-001:** Create `EgressDedupeStore` interface
2. **DD-002:** PostgreSQL implementation
3. **DD-003:** Integrate into `ingress-egress-service.ts::processEgress()`
4. **DD-004:** Add cleanup job (TTL-based)

### Phase 2: Graceful Shutdown

5. **DD-005:** Increase `stop_grace_period` to 30s
6. **DD-006:** Add shutdown metrics/logging

### Phase 3: Testing

7. **DD-007:** Integration test (restart + redelivery)
8. **DD-008:** Manual testing (staging deploy cycle)

## Migration Strategy

1. **Deploy with egress dedupe** - Prevents future duplicates
2. **Clear NATS data** - One-time cleanup of existing duplicates
3. **Monitor** - Verify no duplicates after deploy cycles
4. **Remove publish-side dedupe** - Cleanup in future sprint

## Timeline

- **Phase 1:** 4-6 hours (egress dedupe)
- **Phase 2:** 1-2 hours (shutdown timeout)
- **Phase 3:** 2-3 hours (testing)
- **Total:** 7-11 hours

## Success Criteria

**Functional:**
- ✅ No duplicate debug messages after deploy
- ✅ Dedupe persists across restarts
- ✅ Works on ALL platforms (Slack, Twitch, Discord)

**Non-Functional:**
- ✅ Egress latency < 100ms (p95)
- ✅ No manual NATS data deletion required
- ✅ Graceful shutdown completes within 30s

**Validation:**
1. Send `!debug !ping` in staging
2. Deploy with `brat bit deploy --all`
3. Verify NO duplicate messages in Slack
4. Check logs for `egress.deduplicated` entries
