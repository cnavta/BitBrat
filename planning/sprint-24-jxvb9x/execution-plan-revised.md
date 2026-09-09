# Execution Plan: Claim Check + Unified Persistence (Revised)
## Sprint 24 (sprint-24-jxvb9x)

**Role**: Lead Implementor
**Owner**: claude
**Created**: 2026-08-25 (Revised from original plan)
**Status**: Planning → Implementation

---

## Executive Summary

This execution plan has been **significantly revised** from the original to address critical architectural issues discovered during planning:

**Original Scope**: Implement claim-check Bit for temporary event storage

**Revised Scope**:
1. Fix persistence split-brain architecture (P0 - Critical)
2. Implement unified snapshot publishing model (P0 - Critical)
3. Implement claim-check with versioning and out-of-order handling (P0 - Critical)

**Why the Change**: Discovery that persistence service consumes from TWO topics created race condition preventing claim-check from working during event processing. Must fix foundation before building on top.

**Estimated Effort**: 24-30 hours total (was 16-20 hours)
- Phase 1 (Type System): 2 hours
- Phase 2 (Persistence Refactor): 6-8 hours
- Phase 3 (Ingress Snapshot Publishing): 4-5 hours
- Phase 4 (Claim-Check Core): 6-8 hours
- Phase 5 (Integration & Validation): 6-8 hours

**Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 (all sequential, deployment order critical)

---

## Table of Contents

1. [Scope Changes](#1-scope-changes)
2. [Phase Breakdown](#2-phase-breakdown)
3. [Task Dependencies](#3-task-dependencies)
4. [Risk Assessment](#4-risk-assessment)
5. [Testing Strategy](#5-testing-strategy)
6. [Deployment Plan](#6-deployment-plan)
7. [Acceptance Criteria](#7-acceptance-criteria)

---

## 1. Scope Changes

### 1.1 Original Scope (From Initial Planning)

**Phase 1**: Core ClaimCheckService (Redis operations)
**Phase 2**: Event claim check (subscribe to snapshots, store 'final' only)
**Phase 3**: Blob storage
**Phase 4**: Integration & validation

**Total**: 18 tasks, 4 phases

### 1.2 Revised Scope (After Architecture Analysis)

**NEW Phase 1**: Type system updates (enable 'initial' snapshots)
**NEW Phase 2**: Persistence refactor (remove dual subscription)
**NEW Phase 3**: Ingress snapshot publishing ('initial' snapshots)
**Phase 4**: Claim-check with versioning (accept ALL snapshots)
**Phase 5**: Integration & validation

**Total**: 26 tasks, 5 phases

### 1.3 Key Additions

| Addition | Reason | Estimated Time |
|----------|--------|----------------|
| Type system updates | Enable 'initial' in PersistenceSnapshotEventV1 | 2 hours |
| Persistence dual-subscription removal | Fix split-brain architecture | 4 hours |
| Ingress 'initial' snapshot publishing | Ensure events available immediately | 4 hours |
| Claim-check versioning logic | Handle out-of-order delivery | 3 hours |
| Extended testing | Cover new persistence flow | 3 hours |

**Additional Effort**: +8 hours (50% increase)

---

## 2. Phase Breakdown

### Phase 1: Type System & Snapshot Policy Updates (P0 - Critical)

**Goal**: Enable 'initial' snapshots in type system and snapshot publishing infrastructure

**Duration**: 2 hours

**Why This Comes First**: All other work depends on type system allowing 'initial' snapshots

**Tasks**:

#### T1.1: Update PersistenceSnapshotEventV1 Type Definition
**File**: `src/types/events.ts:331`

**Change**:
```typescript
// BEFORE
export interface PersistenceSnapshotEventV1 {
  v: '1';
  correlationId: string;
  kind: Exclude<SnapshotKind, 'initial'>;  // ❌ Excludes 'initial'
  // ...
}

// AFTER
export interface PersistenceSnapshotEventV1 {
  v: '1';
  correlationId: string;
  kind: SnapshotKind;  // ✅ 'initial' | 'update' | 'final' | 'deadletter'
  // ...
}
```

**Validation**: TypeScript compilation succeeds, no errors in codebase

**Time**: 15 minutes

---

#### T1.2: Update Base Server publishPersistenceSnapshot Signature
**File**: `src/common/base-server.ts:1429`

**Change**:
```typescript
// BEFORE
protected async publishPersistenceSnapshot(params: {
  kind: 'update' | 'final' | 'deadletter';  // ❌ Excludes 'initial'
  // ...
})

// AFTER
protected async publishPersistenceSnapshot(params: {
  kind: 'initial' | 'update' | 'final' | 'deadletter';  // ✅ All kinds
  // ...
})
```

**Time**: 10 minutes

---

#### T1.3: Update Snapshot Policy Logic
**File**: `src/common/events/persistence-snapshots.ts:112`

**Change**:
```typescript
export function shouldPublishSnapshot(
  policy: PersistenceSnapshotPolicy,
  kind: SnapshotKind
): boolean {
  if (policy.mode === 'off') return false;

  // ALWAYS publish initial, final, and deadletter
  if (kind === 'initial' || kind === 'final' || kind === 'deadletter') {
    return true;
  }

  // 'update' requires 'significant' or 'all' mode
  return policy.mode === 'all' || policy.mode === 'significant';
}
```

**Validation**: Unit tests pass for all snapshot kinds

**Time**: 30 minutes (including tests)

---

#### T1.4: Unit Tests for Type Changes
**File**: `src/common/events/persistence-snapshots.test.ts`

**New Tests**:
```typescript
describe('shouldPublishSnapshot with initial', () => {
  test('publishes initial snapshot even in final-only mode', () => {
    const policy = { mode: 'final-only', /* ... */ };
    expect(shouldPublishSnapshot(policy, 'initial')).toBe(true);
  });

  test('publishes initial snapshot in all modes except off', () => {
    expect(shouldPublishSnapshot({ mode: 'off' }, 'initial')).toBe(false);
    expect(shouldPublishSnapshot({ mode: 'final-only' }, 'initial')).toBe(true);
    expect(shouldPublishSnapshot({ mode: 'significant' }, 'initial')).toBe(true);
    expect(shouldPublishSnapshot({ mode: 'all' }, 'initial')).toBe(true);
  });
});
```

**Time**: 45 minutes

---

**Phase 1 Acceptance Criteria**:
- [ ] TypeScript compiles without errors
- [ ] `PersistenceSnapshotEventV1` accepts `kind: 'initial'`
- [ ] `publishPersistenceSnapshot()` accepts `kind: 'initial'`
- [ ] `shouldPublishSnapshot()` returns true for 'initial' in all modes except 'off'
- [ ] All existing unit tests pass
- [ ] New unit tests for 'initial' handling pass

---

### Phase 2: Persistence Service Refactoring (P0 - Critical)

**Goal**: Remove dual topic consumption, make persistence consume ONLY from snapshot topic

**Duration**: 6-8 hours

**Why Critical**: Eliminates split-brain architecture, enables unified snapshot flow

**Tasks**:

#### T2.1: Remove internal.ingress.v1 Subscription
**File**: `src/apps/persistence-service.ts:38-74`

**Change**:
```typescript
// DELETE THIS ENTIRE SUBSCRIPTION BLOCK
{ // subscription for internal.ingress.v1
  await this.onMessage<InternalEventV2>(
    { destination: "internal.ingress.v1", ... },
    async (msg: InternalEventV2, ...) => {
      await store.upsertIngressEvent(msg);  // ❌ REMOVE
    }
  );
}
```

**Risk**: HIGH - If ingress doesn't publish 'initial' snapshots yet, events will be lost!

**Mitigation**: Deploy ingress changes (Phase 3) BEFORE this change

**Time**: 15 minutes

---

#### T2.2: Update RAW_CONSUMED_TOPICS
**File**: `src/apps/persistence-service.ts:11-16`

**Change**:
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

**Time**: 5 minutes

---

#### T2.3: Verify applySnapshotEvent Handles 'initial'
**File**: `src/services/persistence/store.ts:85-165`

**Action**: Review and test existing code

**Finding**: Code already supports 'initial' snapshots! (Line 96 comment: "Build initial aggregate for race condition case where snapshot arrives before ingress")

**Validation**:
- Read through `applySnapshotEvent()` logic
- Verify it creates aggregate from 'initial' snapshot
- Test with 'initial' snapshot in unit tests

**Time**: 1 hour (code review + testing)

---

#### T2.4: Unit Tests for 'initial' Snapshot Handling
**File**: `src/services/persistence/store.test.ts`

**New Tests**:
```typescript
describe('applySnapshotEvent with initial kind', () => {
  test('creates aggregate from initial snapshot', async () => {
    const snapshot: PersistenceSnapshotEventV1 = {
      v: '1',
      kind: 'initial',
      correlationId: 'test-123',
      capturedAt: '2026-01-01T10:00:00Z',
      sourceService: 'ingress-egress',
      sourceTopic: 'internal.ingress.v1',
      idempotencyKey: 'test-123:initial:ingress-egress:...',
      event: testEvent,
    };

    const result = await store.applySnapshotEvent(snapshot);

    expect(result.aggregate.status).toBe('INGESTED');
    expect(result.aggregate.correlationId).toBe('test-123');
    expect(result.snapshot.kind).toBe('initial');
    expect(result.duplicate).toBe(false);
  });

  test('handles initial snapshot arriving after update', async () => {
    // First, store an 'update' snapshot
    await store.applySnapshotEvent({
      kind: 'update',
      capturedAt: '2026-01-01T10:01:00Z',
      // ...
    });

    // Then, 'initial' snapshot arrives (out of order)
    const result = await store.applySnapshotEvent({
      kind: 'initial',
      capturedAt: '2026-01-01T10:00:00Z',
      // ...
    });

    // Should still process it (persistence tracks all snapshots)
    expect(result.duplicate).toBe(false);
  });
});
```

**Time**: 2 hours

---

#### T2.5: Integration Test for Snapshot-Only Flow
**File**: `src/services/persistence/integration.spec.ts`

**New Test**:
```typescript
test('persistence stores event via initial snapshot (no direct ingress)', async () => {
  const correlationId = 'snapshot-only-test-123';

  // Publish 'initial' snapshot (NOT to internal.ingress.v1)
  await publishToSnapshotTopic({
    kind: 'initial',
    correlationId,
    sourceService: 'ingress-egress',
    sourceTopic: 'internal.ingress.v1',
    event: testEvent,
  });

  await waitFor(() =>
    db.__state.rootSets[correlationId] !== undefined
  );

  const aggregate = db.__state.rootSets[correlationId];
  expect(aggregate.status).toBe('INGESTED');
  expect(aggregate.correlationId).toBe(correlationId);
});
```

**Time**: 2 hours

---

#### T2.6: Update architecture.yaml
**File**: `architecture.yaml`

**Change**:
```yaml
services:
  persistence:
    topics:
      consumes:
        # REMOVED: internal.ingress.v1
        - internal.persistence.snapshot.v1
        - internal.persistence.finalize.v1
        - internal.deadletter.v1
        - internal.router.dlq.v1
      produces: []
```

**Time**: 10 minutes

---

**Phase 2 Acceptance Criteria**:
- [ ] Persistence service NO LONGER subscribes to `internal.ingress.v1`
- [ ] Persistence service subscribes ONLY to snapshot-related topics
- [ ] `applySnapshotEvent()` correctly handles 'initial' snapshots
- [ ] Unit tests pass with 'initial' snapshots
- [ ] Integration test confirms snapshot-only flow works
- [ ] architecture.yaml updated
- [ ] **CRITICAL**: NOT deployed to production until Phase 3 is deployed!

---

### Phase 3: Ingress 'initial' Snapshot Publishing (P0 - Critical)

**Goal**: Ingress-egress publishes 'initial' snapshots immediately after ingesting events

**Duration**: 4-5 hours

**Why Critical**: Must deploy BEFORE Phase 2 to avoid data loss

**Tasks**:

#### T3.1: Add publishInitialSnapshot to IntegrationBit
**File**: `src/common/integration-bit.ts`

**Add Method**:
```typescript
export class IntegrationBit extends Bit {
  // ... existing code ...

  /**
   * Publish 'initial' snapshot after ingesting event
   * Called by platform connectors after successful ingress publish
   */
  protected async publishInitialSnapshot(event: InternalEventV2): Promise<void> {
    try {
      await this.publishPersistenceSnapshot({
        kind: 'initial',
        sourceService: this.serviceName,
        sourceTopic: 'internal.ingress.v1',
        event,
        changeSummary: `Event ingested from ${event.ingress?.platform || 'unknown'}`,
      });

      this.logger.debug('integration_bit.initial_snapshot.published', {
        correlationId: event.correlationId,
        platform: event.ingress?.platform,
      });
    } catch (error: any) {
      // Fail-open: don't fail ingress if snapshot publishing fails
      this.logger.warn('integration_bit.initial_snapshot.publish_failed', {
        correlationId: event.correlationId,
        error: error.message,
      });
    }
  }
}
```

**Time**: 1 hour

---

#### T3.2: Call publishInitialSnapshot from Platform Publishers
**Files**:
- `src/services/ingress/twitch/publisher.ts`
- `src/services/ingress/discord/publisher.ts`
- `src/services/ingress/slack/publisher.ts`
- `src/services/ingress/twilio/publisher.ts`

**Change** (Example for Twitch):
```typescript
export class TwitchIngressPublisher implements ITwitchIngressPublisher {
  constructor(
    private options: TwitchIngressPublisherOptions = {},
    private snapshotPublisher?: (event: InternalEventV2) => Promise<void>  // NEW
  ) {
    // ... existing code ...
  }

  async publish(evt: InternalEventV2): Promise<string | null> {
    // Publish to internal.ingress.v1 (existing)
    const res = await retryAsync(async () => {
      return await this.pub.publishJson(evt, attrs);
    }, { /* retry config */ });

    // NEW: Publish 'initial' snapshot
    if (res && this.snapshotPublisher) {
      await this.snapshotPublisher(evt);
    }

    return res;
  }
}
```

**Alternative**: Call from IntegrationBit after connector publishes (cleaner)

**Time**: 2 hours (all 4 platforms)

---

#### T3.3: Unit Tests for Snapshot Publishing
**File**: `src/services/ingress/twitch/publisher.test.ts` (and others)

**New Tests**:
```typescript
describe('TwitchIngressPublisher - Initial Snapshots', () => {
  test('publishes initial snapshot after successful ingress', async () => {
    const mockSnapshotPublisher = jest.fn();
    const publisher = new TwitchIngressPublisher(
      { /* options */ },
      mockSnapshotPublisher
    );

    await publisher.publish(testEvent);

    expect(mockSnapshotPublisher).toHaveBeenCalledWith(testEvent);
  });

  test('does not publish snapshot if ingress fails', async () => {
    const mockSnapshotPublisher = jest.fn();
    const publisher = new TwitchIngressPublisher(
      { publisherFactory: () => ({ publishJson: jest.fn().mockRejectedValue(new Error('NATS error')) }) },
      mockSnapshotPublisher
    );

    await expect(publisher.publish(testEvent)).rejects.toThrow();

    expect(mockSnapshotPublisher).not.toHaveBeenCalled();
  });
});
```

**Time**: 1.5 hours

---

#### T3.4: Update architecture.yaml
**File**: `architecture.yaml`

**Change**:
```yaml
services:
  ingress-egress:
    topics:
      consumes:
        - internal.egress.v1.{instanceId}
      produces:
        - internal.ingress.v1
        - internal.persistence.snapshot.v1  # NEW: publishes 'initial' snapshots
```

**Time**: 5 minutes

---

**Phase 3 Acceptance Criteria**:
- [ ] IntegrationBit has `publishInitialSnapshot()` method
- [ ] All platform publishers call snapshot publishing after successful ingress
- [ ] Unit tests confirm snapshots published
- [ ] Unit tests confirm snapshots NOT published if ingress fails
- [ ] architecture.yaml documents snapshot publishing
- [ ] **CRITICAL**: Deployed to production BEFORE Phase 2!

---

### Phase 4: Claim-Check Implementation with Versioning (P0 - Critical)

**Goal**: Implement claim-check with out-of-order handling and lifecycle tracking

**Duration**: 6-8 hours

**Tasks**:

#### T4.1: Create ClaimCheckService with Versioning Logic
**File**: `src/services/claim-check/claim-check-service.ts`

**Implementation**: See `claim-check-versioning-design.md` for complete algorithm

**Key Methods**:
```typescript
export class ClaimCheckService {
  async storeEventClaim(
    correlationId: string,
    snapshot: PersistenceSnapshotEventV1,
    ttl?: number
  ): Promise<'stored' | 'rejected_stale' | 'rejected_error'> {
    // Fetch existing
    // Compare timestamps
    // Store if newer
    // Return result
  }

  async retrieveEventClaim(correlationId: string): Promise<{
    kind: SnapshotKind;
    capturedAt: string;
    event: InternalEventV2;
  } | null> {
    // Retrieve from Redis
    // Parse JSON
    // Return event + metadata
  }
}
```

**Time**: 3 hours

---

#### T4.2: Create ClaimCheckBit with Snapshot Subscription
**File**: `src/apps/claim-check-service.ts`

**Use**: `npm run brat -- bit create claim-check --profile core --kind pipeline-service --exposure platform-only --register --active`

**Customize**:
```typescript
export class ClaimCheckBit extends Bit {
  private claimService!: ClaimCheckService;

  async setup(): Promise<void> {
    const redis = this.resources.redis as RedisClientType;
    this.claimService = new ClaimCheckService(redis, this.config, this.logger);

    this.registerEventClaimTools();
    this.registerBlobClaimTools();
    await this.subscribeToSnapshotTopic();
  }

  private async subscribeToSnapshotTopic(): Promise<void> {
    await this.onMessage<PersistenceSnapshotEventV1>(
      'internal.persistence.snapshot.v1',
      async (snapshot, attrs, ctx) => {
        const ttl = this.config.CLAIM_CHECK_DEFAULT_TTL_SECONDS || 300;
        await this.claimService.storeEventClaim(
          snapshot.correlationId,
          snapshot,
          ttl
        );
        await ctx.ack();
      }
    );
  }
}
```

**Time**: 2 hours

---

#### T4.3: Register MCP Tools
**File**: `src/apps/claim-check-service.ts`

**Tools**:
- `claim.event.retrieve` - Returns event + metadata (kind, capturedAt)
- `claim.event.status` - Returns lifecycle status without full event
- `claim.event.exists` - Boolean check
- `claim.blob.store` - Store blob (existing design)
- `claim.blob.retrieve` - Retrieve blob (existing design)
- `claim.blob.exists` - Check blob (existing design)

**Time**: 2 hours

---

#### T4.4: Unit Tests for ClaimCheckService
**File**: `src/services/claim-check/claim-check-service.test.ts`

**Coverage**:
- Stores initial snapshot when none exists
- Rejects stale update when newer exists
- Accepts newer update
- Rejects duplicate (same timestamp + kind)
- Handles out-of-order delivery correctly

**Time**: 3 hours

---

#### T4.5: Unit Tests for ClaimCheckBit
**File**: `src/apps/claim-check-service.test.ts`

**Coverage**:
- Snapshot subscription registered
- All snapshot kinds processed
- MCP tools registered correctly
- Error handling (Redis down, parse errors)

**Time**: 2 hours

---

**Phase 4 Acceptance Criteria**:
- [ ] ClaimCheckService implements versioning logic
- [ ] ClaimCheckBit subscribes to snapshot topic
- [ ] Accepts ALL snapshot kinds (no filtering)
- [ ] Out-of-order delivery handled correctly
- [ ] MCP tools registered and functional
- [ ] Unit tests pass (>90% coverage)
- [ ] Fail-open behavior on Redis errors

---

### Phase 5: Integration, Validation & Documentation (P1 - High)

**Goal**: End-to-end testing, agent-dev deployment, documentation

**Duration**: 6-8 hours

**Tasks**:

#### T5.1: Integration Tests
**File**: `src/apps/__tests__/claim-check.integration.test.ts`

**Scenarios**:
1. Full lifecycle: initial → update → final
2. Out-of-order delivery
3. Tool-gateway retrieves event during processing
4. Redis TTL expiration
5. Duplicate snapshot handling

**Time**: 3 hours

---

#### T5.2: Agent-Dev Deployment & Validation
**Context**: `agent-dev-claim-check-unified`

**Validation Steps**:
1. Deploy full stack (persistence, ingress-egress, claim-check)
2. Send message via Discord
3. Verify 'initial' snapshot published within 100ms
4. Verify persistence stores event (snapshot-only path)
5. Verify claim-check stores event
6. Trigger LLM tool call → verify tool-gateway retrieves event
7. Monitor Redis memory
8. Wait 5 minutes, verify TTL cleanup

**Time**: 2 hours

---

#### T5.3: Update Technical Architecture Document
**File**: `planning/sprint-24-jxvb9x/technical-architecture.md`

**Changes**:
- Update snapshot flow diagrams
- Change `kind: 'final'` to `kind: 'initial'` (or remove filter)
- Add versioning algorithm description
- Update acceptance criteria

**Time**: 1 hour

---

#### T5.4: Update Execution Plan (This Document)
**File**: `planning/sprint-24-jxvb9x/execution-plan-revised.md`

**Action**: Mark as final, archive original execution-plan.md

**Time**: 15 minutes

---

#### T5.5: Create User Documentation
**File**: `documentation/guides/claim-check.md`

**Sections**:
- Overview
- Architecture (unified snapshot flow)
- MCP tools reference
- Usage examples (tool-gateway, blob storage)
- Versioning behavior
- Configuration
- Troubleshooting

**Time**: 2 hours

---

#### T5.6: Update CLAUDE.md
**File**: `CLAUDE.md`

**Add Section**:
```markdown
### 8. Using Claim Check for Event Retrieval

**Pattern for retrieving events during processing.**

Claim check stores the latest snapshot of every event with automatic versioning.

...
```

**Time**: 30 minutes

---

**Phase 5 Acceptance Criteria**:
- [ ] Integration tests pass (all scenarios)
- [ ] Agent-dev deployment successful
- [ ] Tool-gateway integration validated
- [ ] Documentation complete
- [ ] CLAUDE.md updated
- [ ] All tests passing (unit + integration)
- [ ] Ready for production deployment

---

## 3. Task Dependencies

### Dependency Graph

```
Phase 1: Type System (Sequential)
──────────────────────────────
T1.1 (Update types)
  └─▶ T1.2 (Update base-server)
      └─▶ T1.3 (Update snapshot policy)
          └─▶ T1.4 (Unit tests)

Phase 2: Persistence (Sequential, depends on Phase 1)
────────────────────────────────────────────────────
T1.4 complete
  └─▶ T2.1 (Remove ingress subscription)
  └─▶ T2.2 (Update consumed topics)
      └─▶ T2.3 (Verify applySnapshotEvent)
          └─▶ T2.4 (Unit tests)
          └─▶ T2.5 (Integration tests)
              └─▶ T2.6 (Update architecture.yaml)

Phase 3: Ingress (Parallel with Phase 2 dev, depends on Phase 1)
───────────────────────────────────────────────────────────────
T1.4 complete
  └─▶ T3.1 (Add publishInitialSnapshot)
      └─▶ T3.2 (Update platform publishers)
          └─▶ T3.3 (Unit tests)
              └─▶ T3.4 (Update architecture.yaml)

Phase 4: Claim-Check (Depends on Phase 1)
─────────────────────────────────────────
T1.4 complete
  └─▶ T4.1 (ClaimCheckService)
      └─▶ T4.2 (ClaimCheckBit)
      └─▶ T4.3 (MCP tools)
          └─▶ T4.4 (Service unit tests)
          └─▶ T4.5 (Bit unit tests)

Phase 5: Integration (Depends on ALL previous phases)
─────────────────────────────────────────────────────
T2.6, T3.4, T4.5 complete
  └─▶ T5.1 (Integration tests)
  └─▶ T5.2 (Agent-dev deployment)
  └─▶ T5.3 (Update tech architecture)
  └─▶ T5.4 (Finalize execution plan)
  └─▶ T5.5 (User documentation)
  └─▶ T5.6 (Update CLAUDE.md)
```

### Critical Path

**Longest sequential chain** (must complete in order):

```
T1.1 → T1.2 → T1.3 → T1.4 →
T3.1 → T3.2 → T3.3 → T3.4 → [DEPLOY INGRESS] →
T2.1 → T2.2 → T2.6 → [DEPLOY PERSISTENCE] →
T4.1 → T4.2 → T4.3 → T4.5 → [DEPLOY CLAIM-CHECK] →
T5.1 → T5.2
```

**Estimated Critical Path Duration**: 20-24 hours

---

## 4. Risk Assessment

### High-Risk Items

#### R1: Event Loss During Persistence Migration ⚠️ CRITICAL

**Risk**: If persistence deployed without ingress.v1 subscription BEFORE ingress publishes 'initial' snapshots, events will be lost

**Probability**: High (if deployment order wrong)
**Impact**: Critical (data loss)

**Mitigation**:
1. **DEPLOYMENT ORDER IS MANDATORY**: Ingress (Phase 3) → Persistence (Phase 2)
2. Canary deployment: Test on single instance first
3. Monitor event counts: Compare before/after deployment
4. Immediate rollback if event loss detected

**Detection**:
```bash
# Before deployment: Count events/hour
SELECT COUNT(*) FROM events WHERE ingressAt > NOW() - INTERVAL '1 hour';

# After deployment: Compare counts
# If count drops >10%, ROLLBACK IMMEDIATELY
```

---

#### R2: Out-of-Order Delivery Not Handled Correctly ⚠️ HIGH

**Risk**: Claim-check versioning logic has bugs, stores stale data

**Probability**: Medium
**Impact**: High (incorrect event state cached)

**Mitigation**:
1. Comprehensive unit tests for all edge cases
2. Integration tests with real message bus reordering
3. Extensive logging of rejected/accepted snapshots
4. Monitor rejection rate in production

**Detection**: High rate of `claim_check.snapshot.rejected_stale` logs

---

#### R3: Redis Memory Exhaustion 🔶 MEDIUM

**Risk**: Claim-check stores too much data, Redis OOM

**Probability**: Low (with TTL enforcement)
**Impact**: High (Redis crashes, all services affected)

**Mitigation**:
1. Enforce size limits (1MB events, 10MB blobs)
2. Aggressive TTL (5 minutes default)
3. allkeys-lru eviction policy
4. Monitor Redis memory usage
5. Alert at 80% capacity

---

### Medium-Risk Items

#### R4: Performance Degradation from Dual Publishing 🔷 MEDIUM

**Risk**: Publishing both ingress event AND snapshot adds latency

**Probability**: Medium
**Impact**: Medium (slower ingress, but acceptable if <100ms)

**Mitigation**:
1. Benchmark in agent-dev before production
2. Snapshot publishing is async (fail-open)
3. Monitor p95 latency
4. Target: <50ms additional latency

---

## 5. Testing Strategy

### 5.1 Unit Test Coverage

**Target**: 95%+ line coverage

**Files**:
- `src/common/events/persistence-snapshots.test.ts` (T1.4)
- `src/services/persistence/store.test.ts` (T2.4)
- `src/services/ingress/*/publisher.test.ts` (T3.3)
- `src/services/claim-check/claim-check-service.test.ts` (T4.4)
- `src/apps/claim-check-service.test.ts` (T4.5)

**Total**: ~15 new test files/additions, ~100 new test cases

---

### 5.2 Integration Test Coverage

**File**: `src/apps/__tests__/claim-check.integration.test.ts` (T5.1)

**Scenarios**:
1. **Unified snapshot flow**: ingress → initial snapshot → persistence stores
2. **Out-of-order delivery**: update → initial → final (claim-check stores final)
3. **Tool-gateway retrieval**: Event available during LLM processing
4. **Lifecycle tracking**: Can query event status (initial → update → final)
5. **TTL expiration**: Events removed after 5 minutes
6. **Duplicate handling**: Same snapshot published twice, stored once

---

### 5.3 Agent-Dev Validation (T5.2)

**Full Stack Test**:
```bash
# 1. Provision
agent_dev.provision({ name: "agent-dev-claim-check-unified" })

# 2. Deploy services in order (CRITICAL!)
bit deploy ingress-egress --context agent-dev-claim-check-unified
# Wait 2 minutes, verify 'initial' snapshots published
bit deploy persistence --context agent-dev-claim-check-unified
# Wait 2 minutes, verify events stored via snapshots only
bit deploy claim-check --context agent-dev-claim-check-unified

# 3. Send test message
# (Use Discord bot in test channel)

# 4. Verify snapshots
redis-cli -h localhost -p 6379
GET bitbrat:claim:event:<correlationId>

# 5. Test tool-gateway
# Trigger LLM tool call, verify event retrieved

# 6. Monitor logs
fleet.logs({ bit: "claim-check", context: "agent-dev-claim-check-unified" })
fleet.logs({ bit: "persistence", context: "agent-dev-claim-check-unified" })

# 7. Clean up
agent_dev.destroy({ name: "agent-dev-claim-check-unified", confirm: true })
```

---

## 6. Deployment Plan

### 6.1 Deployment Phases

```
┌────────────────────────────────────────────────────────────────┐
│          DEPLOYMENT PHASES (STRICT ORDER REQUIRED!)             │
└────────────────────────────────────────────────────────────────┘

STAGE 1: Deploy Ingress Changes
────────────────────────────────
Deploy: ingress-egress with 'initial' snapshot publishing (Phase 3)
Result: Events now published to BOTH paths:
  - internal.ingress.v1 (consumed by persistence - OLD)
  - internal.persistence.snapshot.v1 ('initial' - NEW)

Validation:
  ✓ 'initial' snapshots appearing in topic
  ✓ Persistence still processing via ingress.v1 (dual path)
  ✓ No errors in ingress-egress logs
  ✓ Event throughput unchanged

Duration: 1 hour

STAGE 2: Deploy Claim-Check
────────────────────────────
Deploy: claim-check service (Phase 4)
Result: Claim-check starts caching events

Validation:
  ✓ Redis keys created: GET bitbrat:claim:event:*
  ✓ MCP tools registered
  ✓ Can retrieve events via claim.event.retrieve
  ✓ No errors in claim-check logs

Duration: 1 hour

STAGE 3: Deploy Persistence Changes
────────────────────────────────────
Deploy: persistence WITHOUT internal.ingress.v1 subscription (Phase 2)
Result: Single-path snapshot processing

⚠️  POINT OF NO RETURN - Events only flow via snapshots now!

Validation:
  ✓ Persistence still creating aggregates
  ✓ All snapshots processed correctly
  ✓ No increase in error rate
  ✓ Event counts match pre-deployment levels

Duration: 2 hours (careful monitoring)

STAGE 4: Validation & Cleanup
──────────────────────────────
Actions:
  - Monitor for 24 hours
  - Verify no data loss
  - Update documentation
  - Archive old code

Duration: Ongoing
```

### 6.2 Rollback Procedures

**Stage 1 Rollback** (Ingress):
```bash
# Redeploy previous ingress-egress
kubectl rollout undo deployment ingress-egress
# Duration: 10 minutes
# Risk: None (persistence still works via ingress.v1)
```

**Stage 2 Rollback** (Claim-Check):
```bash
# Mark claim-check as inactive
kubectl scale deployment claim-check --replicas=0
# Duration: 5 minutes
# Risk: None (optional service)
```

**Stage 3 Rollback** (Persistence) ⚠️ CRITICAL:
```bash
# EMERGENCY: Redeploy persistence WITH ingress.v1 subscription
# Requires code change to re-add subscription!
# Duration: 30 minutes
# Risk: Events lost during gap if ingress also rolled back
```

---

## 7. Acceptance Criteria

### Sprint 24 Complete When:

#### Phase 1: Type System
- [ ] `PersistenceSnapshotEventV1` accepts `kind: 'initial'`
- [ ] `publishPersistenceSnapshot()` accepts `kind: 'initial'`
- [ ] Snapshot policy handles 'initial' correctly
- [ ] All unit tests pass

#### Phase 2: Persistence
- [ ] Persistence service removes `internal.ingress.v1` subscription
- [ ] Persistence processes 'initial' snapshots correctly
- [ ] Unit and integration tests pass
- [ ] architecture.yaml updated

#### Phase 3: Ingress
- [ ] Ingress-egress publishes 'initial' snapshots after successful ingress
- [ ] All platform connectors (Twitch, Discord, Slack, Twilio) publish snapshots
- [ ] Unit tests confirm snapshot publishing
- [ ] architecture.yaml updated

#### Phase 4: Claim-Check
- [ ] ClaimCheckService implements versioning logic
- [ ] ClaimCheckBit accepts all snapshot kinds
- [ ] Out-of-order delivery handled correctly
- [ ] MCP tools registered and functional
- [ ] Unit tests pass (>95% coverage)

#### Phase 5: Integration
- [ ] Integration tests pass (all scenarios)
- [ ] Agent-dev deployment successful
- [ ] Tool-gateway can retrieve events during processing
- [ ] Progress messages work end-to-end
- [ ] Documentation complete
- [ ] CLAUDE.md updated

#### Production Validation
- [ ] Deployed in correct order (Ingress → Claim-Check → Persistence)
- [ ] No event loss during migration
- [ ] Redis memory usage acceptable (<50MB for 10k events)
- [ ] Tool-gateway progress messages 100% success rate
- [ ] No errors in any service logs for 24 hours

---

## Appendix A: Task Checklist

### Phase 1: Type System & Snapshot Policy (2 hours)
- [ ] T1.1: Update PersistenceSnapshotEventV1 type
- [ ] T1.2: Update publishPersistenceSnapshot signature
- [ ] T1.3: Update snapshot policy logic
- [ ] T1.4: Unit tests for type changes

### Phase 2: Persistence Refactor (6-8 hours)
- [ ] T2.1: Remove internal.ingress.v1 subscription
- [ ] T2.2: Update RAW_CONSUMED_TOPICS
- [ ] T2.3: Verify applySnapshotEvent handles 'initial'
- [ ] T2.4: Unit tests for 'initial' handling
- [ ] T2.5: Integration test for snapshot-only flow
- [ ] T2.6: Update architecture.yaml

### Phase 3: Ingress Snapshot Publishing (4-5 hours)
- [ ] T3.1: Add publishInitialSnapshot to IntegrationBit
- [ ] T3.2: Update platform publishers (Twitch, Discord, Slack, Twilio)
- [ ] T3.3: Unit tests for snapshot publishing
- [ ] T3.4: Update architecture.yaml

### Phase 4: Claim-Check Implementation (6-8 hours)
- [ ] T4.1: Create ClaimCheckService with versioning
- [ ] T4.2: Create ClaimCheckBit with snapshot subscription
- [ ] T4.3: Register MCP tools
- [ ] T4.4: Unit tests for ClaimCheckService
- [ ] T4.5: Unit tests for ClaimCheckBit

### Phase 5: Integration & Validation (6-8 hours)
- [ ] T5.1: Integration tests
- [ ] T5.2: Agent-dev deployment & validation
- [ ] T5.3: Update technical architecture document
- [ ] T5.4: Finalize execution plan
- [ ] T5.5: Create user documentation
- [ ] T5.6: Update CLAUDE.md

**Total Tasks**: 26
**Estimated Total Time**: 24-30 hours

---

**End of Revised Execution Plan**

**Next Steps**:
1. User review and approval
2. Create prioritized YAML backlog
3. Begin Phase 1 implementation
