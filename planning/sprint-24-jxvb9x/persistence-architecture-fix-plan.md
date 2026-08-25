# Persistence Architecture Fix Plan
## Sprint 24 - Unified Snapshot Publishing

**Created**: 2026-08-25
**Author**: Claude Code
**Status**: Planning

---

## Executive Summary

**Problem Statement**: The current persistence architecture has a split-brain design where:
1. The persistence service consumes events from TWO topics (`internal.ingress.v1` AND `internal.persistence.snapshot.v1`)
2. The 'initial' snapshot is created by persistence service internally and NEVER published to the snapshot topic
3. This prevents claim-check from accessing events during processing (race condition)
4. This violates the principle that all snapshots should flow through a single topic

**Proposed Solution**: Refactor to a unified snapshot publishing model where:
1. ALL snapshots (including 'initial') are published to `internal.persistence.snapshot.v1`
2. Persistence service consumes ONLY from `internal.persistence.snapshot.v1` (not `internal.ingress.v1`)
3. Ingress-egress publishes 'initial' snapshots immediately after ingesting events
4. Claim-check can consume 'initial' snapshots for immediate availability

**Impact**: Breaking architectural change requiring coordinated updates across multiple services

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Problems Identified](#2-problems-identified)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Implementation Plan](#4-implementation-plan)
5. [Migration Strategy](#5-migration-strategy)
6. [Testing Strategy](#6-testing-strategy)
7. [Rollback Plan](#7-rollback-plan)
8. [Success Criteria](#8-success-criteria)

---

## 1. Current Architecture Analysis

### 1.1 Current Snapshot Flow (Broken)

```
┌────────────────────────────────────────────────────────────────┐
│                    CURRENT (SPLIT-BRAIN)                        │
└────────────────────────────────────────────────────────────────┘

PATH 1: Direct Ingress (creates 'initial' snapshot)
──────────────────────────────────────────────────

1. Twitch/Discord/etc publishes to: internal.ingress.v1

2. persistence service subscribes to: internal.ingress.v1
   └─▶ Receives InternalEventV2
   └─▶ Calls: store.upsertIngressEvent()
       └─▶ Creates 'initial' snapshot
       └─▶ Writes DIRECTLY to database

3. ❌ 'initial' snapshot NEVER published to topic
   ❌ claim-check CANNOT access it


PATH 2: Published Snapshots (update/final/deadletter)
────────────────────────────────────────────────────

1. Services call: publishPersistenceSnapshot({ kind: 'update' })
   └─▶ Publishes to: internal.persistence.snapshot.v1

2. persistence service subscribes to: internal.persistence.snapshot.v1
   └─▶ Receives PersistenceSnapshotEventV1
   └─▶ Calls: store.applySnapshotEvent()
       └─▶ Writes snapshot to database

3. ✅ Other services (claim-check) can consume from topic
```

### 1.2 Race Condition Timeline

```
T0: User sends message "What's my balance?"
T1: Discord publishes to internal.ingress.v1
T2: persistence consumes, creates 'initial' snapshot in DB only
T3: event-router processes, publishes 'update' snapshot
T4: auth-service enriches, publishes 'update' snapshot
T5: llm-bot processes message
T6: llm-bot calls tool: agent.sendProgressUpdate()
    └─▶ tool-gateway tries: claim.event.retrieve(correlationId)
        └─▶ claim-check: GET bitbrat:claim:event:{id}
            └─▶ ❌ KEY NOT FOUND! (no 'update' snapshot stored yet)
            └─▶ Returns null
            └─▶ Tool fails!

T7: llm-bot publishes 'update' snapshot (too late!)
T8: claim-check stores event (but tool already failed!)
```

### 1.3 Current Persistence Service Topics

**File**: `src/apps/persistence-service.ts:11-16`

```typescript
const RAW_CONSUMED_TOPICS: string[] = [
  "internal.ingress.v1",              // ← Creates 'initial' snapshot
  INTERNAL_PERSISTENCE_SNAPSHOT_V1,   // ← Processes published snapshots
  "internal.persistence.finalize.v1", // ← Legacy finalization
  "internal.deadletter.v1",           // ← Deadletter events
  "internal.router.dlq.v1"            // ← Router deadletter
];
```

---

## 2. Problems Identified

### P1: Split-Brain Snapshot Creation ⚠️ CRITICAL

**Issue**: Two different code paths create snapshots:
- `upsertIngressEvent()` creates 'initial' snapshot (database only)
- `applySnapshotEvent()` processes published snapshots

**Impact**:
- Inconsistent snapshot handling
- Duplicated snapshot creation logic
- 'initial' snapshots invisible to other services

**Root Cause**: Historical design where persistence service was the first consumer

### P2: Claim-Check Race Condition ⚠️ CRITICAL

**Issue**: Claim-check cannot access events during processing

**Timeline**:
- Event published to ingress.v1 at T0
- First 'update' snapshot published at T3+
- But tools may be called at T2 (before any snapshots published!)

**Impact**: Sprint 22 progress messages feature cannot work

**Root Cause**: 'initial' snapshots not published to topic

### P3: Dual Topic Consumption 🔶 HIGH

**Issue**: Persistence service subscribes to TWO topics for same purpose

**Impact**:
- Increased complexity
- Harder to reason about ordering
- Potential for race conditions between topics

**Root Cause**: Incremental feature additions without refactoring

### P4: Type System Lie 🔶 HIGH

**Issue**: `PersistenceSnapshotEventV1` explicitly excludes 'initial':

```typescript
// src/types/events.ts:331
kind: Exclude<SnapshotKind, 'initial'>;
```

But architecture documents show 'initial' as a valid snapshot kind!

**Impact**: Type system doesn't match reality, confusing developers

### P5: Testing Complexity 🔷 MEDIUM

**Issue**: Tests must simulate two different ingestion paths

**Impact**: More complex test setup, harder to catch race conditions

---

## 3. Proposed Architecture

### 3.1 Unified Snapshot Flow (Fixed)

```
┌────────────────────────────────────────────────────────────────┐
│                 UNIFIED SNAPSHOT PUBLISHING                     │
└────────────────────────────────────────────────────────────────┘

ALL SNAPSHOTS flow through: internal.persistence.snapshot.v1

PATH: Unified Snapshot Publishing
──────────────────────────────────

1. Ingress (Twitch/Discord/etc) receives external event
   └─▶ Normalizes to InternalEventV2
   └─▶ Publishes to: internal.ingress.v1
   └─▶ Immediately publishes 'initial' snapshot:
       publishPersistenceSnapshot({
         kind: 'initial',
         sourceTopic: 'internal.ingress.v1',
         event: normalizedEvent
       })
       └─▶ Publishes to: internal.persistence.snapshot.v1

2. persistence service subscribes ONLY to: internal.persistence.snapshot.v1
   └─▶ Receives ALL snapshots (initial, update, final, deadletter)
   └─▶ Calls: store.applySnapshotEvent() for ALL kinds
   └─▶ Writes to database

3. claim-check service subscribes to: internal.persistence.snapshot.v1
   └─▶ Filters for: kind === 'initial'
   └─▶ Stores FIRST snapshot in Redis
   └─▶ Available IMMEDIATELY for tool calls!

4. Other services publish 'update'/'final' snapshots as before
   └─▶ persistence service processes them
   └─▶ claim-check ignores them (already has 'initial')
```

### 3.2 New Timeline (Fixed)

```
T0: User sends message "What's my balance?"
T1: Discord publishes to internal.ingress.v1
T2: Discord publishes 'initial' snapshot to internal.persistence.snapshot.v1
    └─▶ persistence consumes, writes to DB
    └─▶ claim-check consumes, stores in Redis ✅
T3: event-router processes, publishes 'update' snapshot
T4: auth-service enriches, publishes 'update' snapshot
T5: llm-bot processes message
T6: llm-bot calls tool: agent.sendProgressUpdate()
    └─▶ tool-gateway calls: claim.event.retrieve(correlationId)
        └─▶ claim-check: GET bitbrat:claim:event:{id}
            └─▶ ✅ KEY FOUND! (stored at T2)
            └─▶ Returns full event with ingress/egress metadata
            └─▶ Tool succeeds! ✅
```

### 3.3 Updated Type System

**Remove the `Exclude<SnapshotKind, 'initial'>` constraint**:

```typescript
// src/types/events.ts:331 (BEFORE)
export interface PersistenceSnapshotEventV1 {
  v: '1';
  correlationId: string;
  kind: Exclude<SnapshotKind, 'initial'>;  // ❌ WRONG!
  // ...
}

// src/types/events.ts:331 (AFTER)
export interface PersistenceSnapshotEventV1 {
  v: '1';
  correlationId: string;
  kind: SnapshotKind;  // ✅ 'initial' | 'update' | 'final' | 'deadletter'
  // ...
}
```

---

## 4. Implementation Plan

### Phase 1: Type System & Core Infrastructure (P0)

#### Task 1.1: Update Type Definitions
**File**: `src/types/events.ts`

```typescript
// Change line 331 from:
kind: Exclude<SnapshotKind, 'initial'>;

// To:
kind: SnapshotKind;  // 'initial' | 'update' | 'final' | 'deadletter'
```

**Estimated Time**: 5 minutes
**Risk**: Low (just removes artificial constraint)

#### Task 1.2: Update Base Server Helper
**File**: `src/common/base-server.ts:1429`

```typescript
// Change signature from:
protected async publishPersistenceSnapshot(params: {
  kind: 'update' | 'final' | 'deadletter';  // ❌ Excludes 'initial'
  // ...
})

// To:
protected async publishPersistenceSnapshot(params: {
  kind: 'initial' | 'update' | 'final' | 'deadletter';  // ✅ Includes all
  // ...
})
```

**Estimated Time**: 10 minutes
**Risk**: Low (expands allowed values)

#### Task 1.3: Update Snapshot Publishing Helper
**File**: `src/common/events/persistence-snapshots.ts`

Ensure `shouldPublishSnapshot()` and `buildPersistenceSnapshotEvent()` handle 'initial':

```typescript
export function shouldPublishSnapshot(policy: PersistenceSnapshotPolicy, kind: SnapshotKind): boolean {
  if (policy.mode === 'off') return false;

  // ALWAYS publish initial, final, and deadletter
  if (kind === 'initial' || kind === 'final' || kind === 'deadletter') return true;

  // 'update' requires 'significant' or 'all' mode
  return policy.mode === 'all' || policy.mode === 'significant';
}
```

**Estimated Time**: 15 minutes
**Risk**: Medium (changes snapshot policy logic)

---

### Phase 2: Ingress-Egress 'initial' Snapshot Publishing (P0)

#### Task 2.1: Add 'initial' Snapshot Publishing to Publisher
**File**: `src/services/ingress/twitch/publisher.ts` (and Discord, Slack, Twilio equivalents)

```typescript
export class TwitchIngressPublisher implements ITwitchIngressPublisher {
  // ... existing code ...

  async publish(evt: InternalEventV2): Promise<string | null> {
    const attrs: AttributeMap = busAttrsFromEvent(evt);

    // Publish to internal.ingress.v1 (existing behavior)
    const res = await retryAsync(async () => {
      return await this.pub.publishJson(evt, attrs);
    }, { /* retry config */ });

    // NEW: Publish 'initial' snapshot
    if (res) {
      await this.publishInitialSnapshot(evt);
    }

    return res;
  }

  private async publishInitialSnapshot(evt: InternalEventV2): Promise<void> {
    try {
      // Import from base-server or create inline
      await publishPersistenceSnapshot({
        config: process.env as any,
        createPublisher: (subject: string) => createMessagePublisher(subject),
        logger: logger as any,
        kind: 'initial',
        sourceService: 'ingress-egress',  // Or specific platform
        sourceTopic: INTERNAL_INGRESS_V1,
        event: evt,
        changeSummary: 'Event ingested from external platform',
      });

      logger.debug('ingress.initial_snapshot.published', {
        correlationId: evt.correlationId,
        platform: evt.ingress?.platform,
      });
    } catch (error: any) {
      // Fail-open: don't fail ingress if snapshot publishing fails
      logger.warn('ingress.initial_snapshot.publish_failed', {
        correlationId: evt.correlationId,
        error: error.message,
      });
    }
  }
}
```

**Estimated Time**: 2 hours (4 publishers: Twitch, Discord, Slack, Twilio)
**Risk**: Medium (new code path, must not break existing ingress)

**Alternative Approach**: Add to IntegrationBit base class instead of individual publishers

```typescript
// src/common/integration-bit.ts
export class IntegrationBit extends Bit {
  protected async onIngressEvent(event: InternalEventV2): Promise<void> {
    // Existing: publish to internal.ingress.v1
    await this.publishIngressEvent(event);

    // NEW: publish 'initial' snapshot
    await this.publishPersistenceSnapshot({
      kind: 'initial',
      sourceTopic: 'internal.ingress.v1',
      event,
      changeSummary: `Event ingested from ${event.ingress?.platform}`,
    });
  }
}
```

**Estimated Time**: 1 hour (centralized in one place)
**Risk**: Lower (single point of change)
**Recommendation**: Use IntegrationBit approach

#### Task 2.2: Test 'initial' Snapshot Publishing
**File**: `src/services/ingress/*/publisher.test.ts`

```typescript
test('publishes initial snapshot after successful ingress', async () => {
  const mockSnapshotPublisher = jest.fn();
  const publisher = new TwitchIngressPublisher({
    publisherFactory: (subject) => {
      if (subject.includes('persistence.snapshot')) {
        return { publishJson: mockSnapshotPublisher };
      }
      return mockIngressPublisher;
    }
  });

  await publisher.publish(testEvent);

  expect(mockSnapshotPublisher).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'initial',
      correlationId: testEvent.correlationId,
      event: testEvent,
    }),
    expect.any(Object)
  );
});
```

**Estimated Time**: 1 hour
**Risk**: Low (pure test code)

---

### Phase 3: Persistence Service Refactoring (P0)

#### Task 3.1: Remove `internal.ingress.v1` Subscription
**File**: `src/apps/persistence-service.ts:38-74`

```typescript
// BEFORE: Subscribes to internal.ingress.v1
{ // subscription for internal.ingress.v1
  await this.onMessage<InternalEventV2>(
    { destination: "internal.ingress.v1", queue: SERVICE_NAME, ack: 'explicit' },
    async (msg: InternalEventV2, _attributes, ctx) => {
      // ... creates 'initial' snapshot ...
      await store.upsertIngressEvent(msg);
    }
  );
}

// AFTER: REMOVE THIS ENTIRE SUBSCRIPTION BLOCK
// (Persistence will only consume from snapshot topic)
```

**Estimated Time**: 10 minutes
**Risk**: HIGH (breaks persistence if ingress doesn't publish 'initial' snapshots)

**Deployment Order**: CRITICAL - Must deploy ingress-egress changes FIRST!

#### Task 3.2: Update RAW_CONSUMED_TOPICS
**File**: `src/apps/persistence-service.ts:11-16`

```typescript
// BEFORE
const RAW_CONSUMED_TOPICS: string[] = [
  "internal.ingress.v1",              // ❌ REMOVE
  INTERNAL_PERSISTENCE_SNAPSHOT_V1,
  "internal.persistence.finalize.v1",
  "internal.deadletter.v1",
  "internal.router.dlq.v1"
];

// AFTER
const RAW_CONSUMED_TOPICS: string[] = [
  INTERNAL_PERSISTENCE_SNAPSHOT_V1,   // ✅ ONLY snapshot topic
  "internal.persistence.finalize.v1",
  "internal.deadletter.v1",
  "internal.router.dlq.v1"
];
```

**Estimated Time**: 5 minutes
**Risk**: Low (declarative config)

#### Task 3.3: Ensure `applySnapshotEvent()` Handles 'initial'
**File**: `src/services/persistence/store.ts:85-165`

The existing `applySnapshotEvent()` already has fallback logic for missing aggregates (lines 96-123).
Verify it works correctly for 'initial' kind:

```typescript
// Line 96 comment already says:
// "Build initial aggregate (for race condition case where snapshot arrives before ingress)"

// This means applySnapshotEvent() ALREADY supports receiving 'initial' snapshots!
// Just needs testing to confirm.
```

**Estimated Time**: 30 minutes (testing existing code)
**Risk**: Low (code already exists)

---

### Phase 4: Claim-Check Update (P0)

#### Task 4.1: Update Claim-Check to Consume 'initial' Snapshots
**File**: `src/apps/claim-check-service.ts` (from technical architecture)

```typescript
private async subscribeToSnapshotTopic(): Promise<void> {
  await this.onMessage<PersistenceSnapshotEventV1>(
    'internal.persistence.snapshot.v1',
    async (snapshot, attrs, ctx) => {
      try {
        // CHANGE: Accept 'initial' instead of 'final'
        if (snapshot.kind !== 'initial') {
          await ctx.ack();
          return;
        }

        const ttl = this.config.CLAIM_CHECK_DEFAULT_TTL_SECONDS || 300;

        // Store with NX flag (only if not exists)
        // This ensures we store FIRST snapshot only (idempotency)
        const key = this.eventKey(snapshot.correlationId);
        const stored = await this.redis.set(
          key,
          JSON.stringify(snapshot.event),
          { NX: true, EX: ttl }
        );

        if (stored === 'OK') {
          this.logger.info('claim_check.event.stored', {
            correlationId: snapshot.correlationId,
            sourceService: snapshot.sourceService,
            kind: snapshot.kind,
            ttl
          });
        } else {
          this.logger.debug('claim_check.event.already_exists', {
            correlationId: snapshot.correlationId,
          });
        }
      } catch (error: any) {
        this.logger.error('claim_check.snapshot.error', {
          correlationId: snapshot.correlationId,
          error: error.message
        });
      } finally {
        await ctx.ack();
      }
    }
  );
}
```

**Estimated Time**: 30 minutes
**Risk**: Low (straightforward change)

#### Task 4.2: Update Technical Architecture Documentation
**File**: `planning/sprint-24-jxvb9x/technical-architecture.md`

Update all references from `kind: 'final'` to `kind: 'initial'`:

- Line 295: "Store events with `kind: 'final'`" → "Store events with `kind: 'initial'`"
- Line 576: "ingress-egress published final snapshot" → "ingress-egress published initial snapshot"
- Line 755: "Only 'final' snapshots stored" → "Only 'initial' snapshots stored"

**Estimated Time**: 30 minutes
**Risk**: None (documentation only)

---

### Phase 5: Architecture.yaml Updates (P1)

#### Task 5.1: Update Persistence Service Topics
**File**: `architecture.yaml`

```yaml
services:
  persistence:
    topics:
      consumes:
        # REMOVE: internal.ingress.v1
        - internal.persistence.snapshot.v1
        - internal.persistence.finalize.v1
        - internal.deadletter.v1
        - internal.router.dlq.v1
      produces: []
```

**Estimated Time**: 5 minutes
**Risk**: Low (declarative config)

#### Task 5.2: Document Ingress-Egress Snapshot Publishing
**File**: `architecture.yaml`

```yaml
services:
  ingress-egress:
    topics:
      consumes:
        - internal.egress.v1.{instanceId}
      produces:
        - internal.ingress.v1
        - internal.persistence.snapshot.v1  # NEW: 'initial' snapshots
```

**Estimated Time**: 5 minutes
**Risk**: None (documentation)

---

## 5. Migration Strategy

### 5.1 Deployment Order (CRITICAL!)

```
┌────────────────────────────────────────────────────────────────┐
│              DEPLOYMENT ORDER (DO NOT REORDER!)                 │
└────────────────────────────────────────────────────────────────┘

STAGE 1: Enable 'initial' Snapshot Publishing
──────────────────────────────────────────────
Deploy: ingress-egress with 'initial' snapshot publishing
Result: Events now published to BOTH paths:
  - internal.ingress.v1 (existing)
  - internal.persistence.snapshot.v1 ('initial' snapshot - NEW)

Validation:
  - Check logs for "ingress.initial_snapshot.published"
  - Verify persistence.snapshot.v1 topic receives 'initial' events
  - Confirm persistence service still processes events (dual path)

Duration: 1 hour (deploy + validate)

STAGE 2: Update Claim-Check
───────────────────────────
Deploy: claim-check with 'initial' filter
Result: Claim-check now stores events immediately

Validation:
  - Send test message
  - Verify Redis key created: GET bitbrat:claim:event:{correlationId}
  - Call claim.event.retrieve, confirm event returned
  - Test tool-gateway progress messages work

Duration: 1 hour (deploy + validate)

STAGE 3: Remove Persistence Dual Subscription
──────────────────────────────────────────────
Deploy: persistence service WITHOUT internal.ingress.v1 subscription
Result: Single-path snapshot processing

Validation:
  - Send test message
  - Verify persistence service still creates 'initial' snapshot in DB
  - Check applySnapshotEvent() handles 'initial' correctly
  - Monitor for errors or missing events

Duration: 2 hours (deploy + careful monitoring)

STAGE 4: Cleanup
────────────────
Deploy: Remove legacy code, update docs
Result: Clean architecture

Duration: 30 minutes
```

### 5.2 Rollback Triggers

**Abort deployment if**:
- Stage 1: 'initial' snapshots not appearing in topic
- Stage 2: Claim-check fails to store events
- Stage 3: Persistence service errors increase >10%
- Any stage: Message loss detected

**Rollback procedure**:
1. Redeploy previous version
2. Monitor for 10 minutes
3. Investigate logs
4. Fix issue before retrying

### 5.3 Backward Compatibility

**During Migration** (Stage 1-2):
- ✅ Persistence consumes from BOTH topics (safe redundancy)
- ✅ Old claim-check still works (ignores 'initial', waits for 'final')
- ✅ New claim-check works (gets 'initial' immediately)

**After Migration** (Stage 3+):
- ⚠️ Persistence ONLY consumes from snapshot topic
- ⚠️ Ingress MUST publish 'initial' snapshots (or events lost!)
- ⚠️ Cannot rollback to pre-Stage-1 without data loss

---

## 6. Testing Strategy

### 6.1 Unit Tests

#### Test: Ingress publishes 'initial' snapshot
```typescript
test('TwitchIngressPublisher publishes initial snapshot after successful publish', async () => {
  const mockSnapshotPub = jest.fn();
  const publisher = new TwitchIngressPublisher({
    publisherFactory: (subject) =>
      subject.includes('snapshot')
        ? { publishJson: mockSnapshotPub }
        : mockIngressPub
  });

  await publisher.publish(testEvent);

  expect(mockSnapshotPub).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'initial' }),
    expect.any(Object)
  );
});
```

#### Test: Persistence handles 'initial' snapshots
```typescript
test('applySnapshotEvent creates aggregate from initial snapshot', async () => {
  const store = new PersistenceStore({ documentStore });

  const snapshot: PersistenceSnapshotEventV1 = {
    v: '1',
    kind: 'initial',  // Previously excluded!
    correlationId: 'test-123',
    event: testEvent,
    // ...
  };

  const result = await store.applySnapshotEvent(snapshot);

  expect(result.aggregate.status).toBe('INGESTED');
  expect(result.snapshot.kind).toBe('initial');
});
```

#### Test: Claim-check stores 'initial' only
```typescript
test('claim-check stores only initial snapshot', async () => {
  const claimCheck = new ClaimCheckBit();
  const redis = getMockRedis();

  // Send 'initial' snapshot
  await claimCheck.handleSnapshot({ kind: 'initial', event: testEvent });
  expect(redis.set).toHaveBeenCalledWith(key, data, { NX: true, EX: 300 });

  // Send 'update' snapshot
  redis.set.mockClear();
  await claimCheck.handleSnapshot({ kind: 'update', event: testEvent });
  expect(redis.set).not.toHaveBeenCalled();  // Filtered out
});
```

### 6.2 Integration Tests

#### Test: End-to-end snapshot flow
```typescript
test('event flows through unified snapshot pipeline', async () => {
  // 1. Publish event to ingress
  await ingressPublisher.publish(testEvent);

  // 2. Wait for snapshot publication
  await waitFor(() =>
    snapshotTopic.has({ kind: 'initial', correlationId: testEvent.correlationId })
  );

  // 3. Verify persistence stored it
  const aggregate = await persistence.getAggregate(testEvent.correlationId);
  expect(aggregate.status).toBe('INGESTED');

  // 4. Verify claim-check stored it
  const claimed = await claimCheck.retrieve(testEvent.correlationId);
  expect(claimed).toEqual(testEvent);
});
```

#### Test: Tool-gateway retrieves event during processing
```typescript
test('tool-gateway can retrieve event before completion', async () => {
  // Simulate event ingestion
  await ingressPublisher.publish(testEvent);

  // Wait for claim-check to store (should be immediate)
  await sleep(100);

  // Tool-gateway tries to retrieve (simulates tool call during LLM processing)
  const retrieved = await toolGateway.getClaimedEvent(testEvent.correlationId);

  expect(retrieved).not.toBeNull();
  expect(retrieved.ingress.platform).toBe('discord');
  expect(retrieved.egress).toBeDefined();
});
```

### 6.3 Agent-Dev Validation

**Test Plan**:
1. Deploy full stack in agent-dev context
2. Send message via Discord
3. Verify 'initial' snapshot published within 100ms
4. Verify persistence stores event
5. Verify claim-check stores event
6. Trigger LLM tool call
7. Verify tool-gateway retrieves event successfully
8. Monitor Redis memory usage
9. Wait 5 minutes, verify TTL expiration
10. Check for errors in all service logs

**Success Criteria**:
- All snapshots published within 100ms of ingress
- No errors in persistence service
- Claim-check 100% hit rate for retrievals
- Tool-gateway progress messages work
- Redis memory < 10MB for 1000 events

---

## 7. Rollback Plan

### 7.1 Rollback Scenarios

#### Scenario A: Stage 1 Failure (Ingress not publishing)
**Symptom**: No 'initial' snapshots in persistence.snapshot.v1 topic

**Rollback**:
1. Redeploy previous ingress-egress version
2. Monitor persistence service (still works via internal.ingress.v1)
3. No data loss

**Duration**: 15 minutes

#### Scenario B: Stage 2 Failure (Claim-check broken)
**Symptom**: Claim-check errors, Redis not populated

**Rollback**:
1. Redeploy previous claim-check version
2. Falls back to waiting for 'final' snapshots (slower but works)
3. No data loss

**Duration**: 10 minutes

#### Scenario C: Stage 3 Failure (Persistence broken)
**Symptom**: Persistence service errors, missing aggregates

**Rollback**:
1. ⚠️ CRITICAL: Redeploy persistence with BOTH topic subscriptions
2. Add back internal.ingress.v1 subscription
3. Monitor for recovery
4. Investigate why snapshot-only path failed

**Duration**: 30 minutes

**Risk**: If ingress stopped publishing 'initial' AND persistence stopped consuming ingress.v1, events are LOST during the gap!

### 7.2 Mitigation: Canary Deployment

**Strategy**: Deploy to single instance first

```bash
# Stage 1: Deploy ingress to 1 of N instances
kubectl scale deployment ingress-egress --replicas=3
kubectl patch deployment ingress-egress -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'

# Monitor that one instance, if OK, continue rollout
kubectl rollout status deployment ingress-egress

# If errors, rollback immediately
kubectl rollout undo deployment ingress-egress
```

---

## 8. Success Criteria

### 8.1 Functional Criteria

- ✅ All events published to internal.ingress.v1 have corresponding 'initial' snapshot published
- ✅ Persistence service stores events via snapshot topic only
- ✅ Claim-check stores events immediately (within 100ms of ingress)
- ✅ Tool-gateway can retrieve events during processing (no race condition)
- ✅ Progress messages work end-to-end
- ✅ No event loss during migration
- ✅ No duplicate events in persistence database

### 8.2 Performance Criteria

- ✅ Snapshot publishing adds <50ms to ingress latency (p95)
- ✅ Claim-check retrieval <10ms (p95)
- ✅ Persistence throughput unchanged (100 events/sec)
- ✅ Redis memory usage <50MB for 10,000 events with 5-min TTL

### 8.3 Reliability Criteria

- ✅ Zero errors in persistence service after migration
- ✅ Zero event loss during migration
- ✅ Claim-check hit rate >99% for events <5 minutes old
- ✅ Tool-gateway progress messages 100% success rate

---

## Appendix A: File Change Checklist

### Code Changes
- [ ] `src/types/events.ts` - Remove Exclude<SnapshotKind, 'initial'>
- [ ] `src/common/base-server.ts` - Add 'initial' to publishPersistenceSnapshot signature
- [ ] `src/common/events/persistence-snapshots.ts` - Update shouldPublishSnapshot logic
- [ ] `src/common/integration-bit.ts` - Add publishInitialSnapshot() method
- [ ] `src/apps/persistence-service.ts` - Remove internal.ingress.v1 subscription
- [ ] `src/apps/persistence-service.ts` - Update RAW_CONSUMED_TOPICS
- [ ] `src/apps/claim-check-service.ts` - Filter for kind === 'initial'

### Test Changes
- [ ] `src/services/ingress/*/publisher.test.ts` - Test 'initial' snapshot publishing
- [ ] `src/services/persistence/store.test.ts` - Test 'initial' snapshot handling
- [ ] `src/apps/claim-check-service.test.ts` - Test 'initial' filtering
- [ ] `src/apps/__tests__/claim-check.integration.test.ts` - End-to-end test

### Documentation Changes
- [ ] `planning/sprint-24-jxvb9x/technical-architecture.md` - Update snapshot kind references
- [ ] `planning/sprint-24-jxvb9x/execution-plan.md` - Update implementation tasks
- [ ] `documentation/guides/claim-check.md` - Update usage examples
- [ ] `architecture.yaml` - Update persistence topics
- [ ] `CLAUDE.md` - Update claim check pattern section

---

## Appendix B: Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|---------|------------|
| Event loss during Stage 3 | Low | Critical | Canary deployment, careful monitoring |
| 'initial' snapshots not published | Medium | High | Unit tests, integration tests, agent-dev validation |
| Persistence breaks on 'initial' | Low | High | Code already supports it (line 96 comment) |
| Claim-check race condition | Low | Medium | NX flag prevents duplicates |
| Performance degradation | Low | Medium | Benchmark in agent-dev first |
| Redis OOM | Very Low | Medium | TTL enforcement, monitoring |

---

**End of Persistence Architecture Fix Plan**

**Next Steps**:
1. User review and approval
2. Begin Phase 1 implementation (type system updates)
3. Agent-dev validation before production deployment
