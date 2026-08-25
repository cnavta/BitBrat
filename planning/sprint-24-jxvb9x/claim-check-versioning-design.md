# Claim-Check Versioning & Out-of-Order Handling Design
## Sprint 24 - Event Lifecycle Tracking

**Created**: 2026-08-25
**Author**: Claude Code
**Status**: Design

---

## Executive Summary

**Problem**: Claim-check was designed to filter for only 'initial' (or 'final') snapshots, but this misses the real use case: tracking the **complete event lifecycle** as it flows through the system.

**Revised Approach**: Claim-check should:
1. Accept ALL snapshot kinds (`initial`, `update`, `final`, `deadletter`)
2. Track event evolution over time (store latest version)
3. Handle out-of-order delivery gracefully
4. Provide versioned access to event state

**Key Insight**: The claim-check is an **event cache** that mirrors the event's journey through the platform, not just a static snapshot store.

---

## Design Principles

### P1: Store Latest Version
- Claim-check maintains the **most recent** version of each event
- When multiple snapshots arrive, keep the one with the latest `capturedAt`
- Enables retrieving the "current state" of an in-flight event

### P2: Handle Out-of-Order Delivery
- Message bus provides **at-least-once** delivery with **no ordering guarantees**
- Snapshots may arrive out of order: 'update' before 'initial', 'final' before 'update'
- Use timestamps to determine which snapshot is newer

### P3: Fail-Open for Missing Metadata
- If snapshot lacks `capturedAt`, use `sequence` from idempotencyKey
- If no ordering metadata available, accept update (better stale data than no data)
- Log warnings for unusual ordering scenarios

### P4: Lifecycle-Aware Storage
- Track snapshot `kind` alongside event data
- Enables queries like "is this event complete?" (`kind === 'final'`)
- Enables debugging ("what stage is this event at?")

---

## Data Model

### Redis Keys Schema

```
┌─────────────────────────────────────────────────────────────┐
│                   Claim-Check Redis Keys                     │
└─────────────────────────────────────────────────────────────┘

Key Pattern: bitbrat:claim:event:{correlationId}
Value: JSON object with metadata + event
TTL: 300 seconds (5 minutes, refreshed on update)

Structure:
{
  "kind": "update",                      // Latest snapshot kind
  "capturedAt": "2026-08-25T10:30:15Z",  // Timestamp of this snapshot
  "sourceService": "llm-bot",            // Who published this snapshot
  "sourceTopic": "internal.analysis.v1", // Where it came from
  "sequence": 3,                         // Snapshot sequence number (if available)
  "updatedAt": "2026-08-25T10:30:15Z",   // When claim-check stored this
  "event": { /* Full InternalEventV2 */ }
}
```

### Example Lifecycle

```
T0: 'initial' snapshot arrives
    Redis: { kind: "initial", capturedAt: "T0", event: {...} }

T1: 'update' snapshot arrives (from router)
    Redis: { kind: "update", capturedAt: "T1", event: {...} }  ← Overwrites

T2: 'update' snapshot arrives (from auth)
    Redis: { kind: "update", capturedAt: "T2", event: {...} }  ← Overwrites

T3: 'final' snapshot arrives
    Redis: { kind: "final", capturedAt: "T3", event: {...} }   ← Overwrites

[5 minutes later]
    Redis: [key expired, deleted]
```

---

## Out-of-Order Handling Algorithm

### Algorithm: Timestamp-Based Versioning

```typescript
async function storeEventSnapshot(
  snapshot: PersistenceSnapshotEventV1
): Promise<'stored' | 'rejected_stale' | 'rejected_error'> {
  const key = `bitbrat:claim:event:${snapshot.correlationId}`;

  try {
    // 1. Fetch existing snapshot (if any)
    const existingJson = await redis.get(key);

    if (existingJson) {
      const existing = JSON.parse(existingJson);

      // 2. Compare timestamps to determine which is newer
      const existingTime = new Date(existing.capturedAt).getTime();
      const incomingTime = new Date(snapshot.capturedAt).getTime();

      if (incomingTime < existingTime) {
        // Incoming snapshot is OLDER than stored version
        logger.debug('claim_check.snapshot.rejected_stale', {
          correlationId: snapshot.correlationId,
          existingKind: existing.kind,
          existingTime: existing.capturedAt,
          incomingKind: snapshot.kind,
          incomingTime: snapshot.capturedAt,
        });
        return 'rejected_stale';
      }

      if (incomingTime === existingTime && existing.kind === snapshot.kind) {
        // Exact duplicate (same timestamp, same kind)
        logger.debug('claim_check.snapshot.duplicate', {
          correlationId: snapshot.correlationId,
          kind: snapshot.kind,
        });
        return 'rejected_stale';
      }
    }

    // 3. Store new snapshot (is newer or doesn't exist)
    const payload = {
      kind: snapshot.kind,
      capturedAt: snapshot.capturedAt,
      sourceService: snapshot.sourceService,
      sourceTopic: snapshot.sourceTopic,
      sequence: extractSequenceFromIdempotencyKey(snapshot.idempotencyKey),
      updatedAt: new Date().toISOString(),
      event: snapshot.event,
    };

    await redis.set(key, JSON.stringify(payload), { EX: ttl });

    logger.info('claim_check.snapshot.stored', {
      correlationId: snapshot.correlationId,
      kind: snapshot.kind,
      previousKind: existingJson ? JSON.parse(existingJson).kind : null,
      capturedAt: snapshot.capturedAt,
    });

    return 'stored';

  } catch (error: any) {
    logger.error('claim_check.snapshot.store_error', {
      correlationId: snapshot.correlationId,
      error: error.message,
    });
    return 'rejected_error';
  }
}
```

### Edge Cases

#### Case 1: Out-of-Order Arrival
```
Actual order: initial(T0) → update(T1) → final(T2)
Arrival order: update(T1) → initial(T0) → final(T2)

T1: update arrives → stored (no existing)
    Redis: { kind: "update", capturedAt: T1 }

T0: initial arrives → REJECTED (T0 < T1, stale)
    Redis: { kind: "update", capturedAt: T1 }  ← unchanged

T2: final arrives → stored (T2 > T1, newer)
    Redis: { kind: "final", capturedAt: T2 }
```

#### Case 2: Duplicate Delivery
```
Actual: initial(T0) published twice by message bus

T0: initial arrives → stored
    Redis: { kind: "initial", capturedAt: T0 }

T0: initial arrives again → REJECTED (duplicate timestamp+kind)
    Redis: { kind: "initial", capturedAt: T0 }  ← unchanged
```

#### Case 3: Simultaneous Updates
```
Actual: Two services publish 'update' at nearly same time
  - router publishes: update(T1 = "10:00:00.100Z")
  - auth publishes:   update(T1 = "10:00:00.150Z")

T1.100: router update arrives → stored
        Redis: { kind: "update", capturedAt: "10:00:00.100Z" }

T1.150: auth update arrives → stored (50ms newer)
        Redis: { kind: "update", capturedAt: "10:00:00.150Z" }
```

#### Case 4: Missing Timestamp (Fallback)
```
Snapshot arrives without capturedAt (shouldn't happen, but defensive)

Fallback strategy:
1. Try to parse sequence from idempotencyKey
2. If sequence available, compare sequence numbers
3. If no sequence, accept update (better stale than nothing)
4. Log warning for investigation
```

---

## Implementation

### ClaimCheckService Update

```typescript
export class ClaimCheckService {
  // ... existing code ...

  async storeEventClaim(
    correlationId: string,
    snapshot: PersistenceSnapshotEventV1,
    ttl?: number
  ): Promise<'stored' | 'rejected_stale' | 'rejected_error'> {
    const key = this.eventKey(correlationId);
    const effectiveTtl = this.normalizeTtl(ttl);

    try {
      // Fetch existing snapshot
      const existingJson = await this.redis.get(key);

      if (existingJson) {
        const existing = JSON.parse(existingJson);

        // Compare timestamps
        const existingTime = this.parseTimestamp(existing.capturedAt);
        const incomingTime = this.parseTimestamp(snapshot.capturedAt);

        if (incomingTime < existingTime) {
          this.logger.debug('claim_check.snapshot.rejected_stale', {
            correlationId,
            existingKind: existing.kind,
            existingTime: existing.capturedAt,
            incomingKind: snapshot.kind,
            incomingTime: snapshot.capturedAt,
          });
          return 'rejected_stale';
        }

        // Duplicate check (same timestamp + same kind)
        if (incomingTime === existingTime && existing.kind === snapshot.kind) {
          this.logger.debug('claim_check.snapshot.duplicate', {
            correlationId,
            kind: snapshot.kind,
          });
          return 'rejected_stale';
        }
      }

      // Build payload
      const payload = {
        kind: snapshot.kind,
        capturedAt: snapshot.capturedAt,
        sourceService: snapshot.sourceService,
        sourceTopic: snapshot.sourceTopic,
        sequence: this.extractSequence(snapshot.idempotencyKey),
        updatedAt: new Date().toISOString(),
        event: snapshot.event,
      };

      const json = JSON.stringify(payload);

      // Validate size
      if (Buffer.byteLength(json, 'utf8') > this.maxEventSize) {
        throw new Error(`Event exceeds max size (${this.maxEventSize} bytes)`);
      }

      // Store with TTL
      await this.redis.set(key, json, { EX: effectiveTtl });

      this.logger.info('claim_check.snapshot.stored', {
        correlationId,
        kind: snapshot.kind,
        previousKind: existingJson ? JSON.parse(existingJson).kind : null,
        capturedAt: snapshot.capturedAt,
        size: json.length,
      });

      return 'stored';

    } catch (error: any) {
      this.logger.error('claim_check.snapshot.store_error', {
        correlationId,
        error: error.message,
      });
      return 'rejected_error';
    }
  }

  async retrieveEventClaim(correlationId: string): Promise<{
    kind: SnapshotKind;
    capturedAt: string;
    event: InternalEventV2;
  } | null> {
    const key = this.eventKey(correlationId);
    const json = await this.redis.get(key);

    if (!json) {
      this.logger.debug('claim_check.event.not_found', { correlationId });
      return null;
    }

    try {
      const payload = JSON.parse(json);
      this.logger.debug('claim_check.event.retrieved', {
        correlationId,
        kind: payload.kind,
        capturedAt: payload.capturedAt,
      });
      return {
        kind: payload.kind,
        capturedAt: payload.capturedAt,
        event: payload.event,
      };
    } catch (error: any) {
      this.logger.error('claim_check.event.parse_error', {
        correlationId,
        error: error.message,
      });
      return null;
    }
  }

  private parseTimestamp(timestamp: string): number {
    try {
      return new Date(timestamp).getTime();
    } catch {
      this.logger.warn('claim_check.invalid_timestamp', { timestamp });
      return 0; // Fallback: treat as very old
    }
  }

  private extractSequence(idempotencyKey?: string): number | undefined {
    if (!idempotencyKey) return undefined;

    // Example idempotencyKey: "abc123:update:llm-bot:internal.analysis.v1:2026-08-25T10:30:15Z"
    // Try to extract sequence number if present in some standard format
    // This is best-effort, may not always be available

    // For now, return undefined (timestamp is primary ordering mechanism)
    return undefined;
  }

  // ... rest of existing code ...
}
```

### ClaimCheckBit Subscription Handler

```typescript
private async subscribeToSnapshotTopic(): Promise<void> {
  await this.onMessage<PersistenceSnapshotEventV1>(
    'internal.persistence.snapshot.v1',
    async (snapshot, attrs, ctx) => {
      try {
        const ttl = this.config.CLAIM_CHECK_DEFAULT_TTL_SECONDS || 300;

        // NEW: Accept ALL snapshot kinds, let service handle versioning
        const result = await this.claimService.storeEventClaim(
          snapshot.correlationId,
          snapshot,
          ttl
        );

        if (result === 'stored') {
          this.logger.debug('claim_check.snapshot.accepted', {
            correlationId: snapshot.correlationId,
            kind: snapshot.kind,
            sourceService: snapshot.sourceService,
          });
        } else if (result === 'rejected_stale') {
          this.logger.debug('claim_check.snapshot.rejected', {
            correlationId: snapshot.correlationId,
            kind: snapshot.kind,
            reason: 'stale',
          });
        }
        // Errors already logged in storeEventClaim

      } catch (error: any) {
        this.logger.error('claim_check.snapshot.handler_error', {
          correlationId: snapshot.correlationId,
          error: error.message,
        });
      } finally {
        // ALWAYS ack (fail-open)
        await ctx.ack();
      }
    }
  );
}
```

---

## MCP Tool Updates

### Updated Retrieval Response

The `claim.event.retrieve` tool now returns metadata about the snapshot:

```typescript
this.registerTool(
  'claim.event.retrieve',
  'Retrieve the latest snapshot of an event by correlationId',
  z.object({
    correlationId: z.string().describe('Correlation ID of the event to retrieve')
  }),
  async (args) => {
    const result = await this.claimService.retrieveEventClaim(args.correlationId);

    if (!result) {
      return {
        content: [{ type: 'text', text: 'Event not found or expired' }],
        isError: true
      };
    }

    // Return both event AND metadata about snapshot version
    const response = {
      correlationId: args.correlationId,
      kind: result.kind,              // What stage is this event at?
      capturedAt: result.capturedAt,  // When was this snapshot taken?
      isComplete: result.kind === 'final' || result.kind === 'deadletter',
      event: result.event,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
  }
);
```

### New Tool: Check Event Status

```typescript
this.registerTool(
  'claim.event.status',
  'Check the lifecycle status of an event without retrieving full data',
  z.object({
    correlationId: z.string().describe('Correlation ID to check')
  }),
  async (args) => {
    const result = await this.claimService.retrieveEventClaim(args.correlationId);

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            exists: false,
            correlationId: args.correlationId
          })
        }]
      };
    }

    const status = {
      exists: true,
      correlationId: args.correlationId,
      kind: result.kind,
      capturedAt: result.capturedAt,
      isComplete: result.kind === 'final' || result.kind === 'deadletter',
      stage: result.event.routing?.stage,
      currentStep: result.event.routing?.slip?.find(s => s.status === 'PENDING')?.id,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
    };
  }
);
```

---

## Usage Examples

### Example 1: Tool-Gateway Progress Messages

```typescript
// In tool-gateway-service.ts
async handleToolCall(toolName: string, args: any, context: ToolCallContext): Promise<CallToolResult> {
  if (toolName === 'agent.sendProgressUpdate') {
    // Retrieve latest snapshot
    const claimed = await this.getClaimedEvent(context.correlationId);

    if (!claimed) {
      return {
        content: [{ type: 'text', text: 'Source event not found - cannot send progress' }],
        isError: true
      };
    }

    // Check if event is still in progress
    if (claimed.kind === 'final') {
      logger.warn('tool_gateway.progress.event_already_complete', {
        correlationId: context.correlationId,
      });
      // Could still send progress, but log as unusual
    }

    // Use latest event state for ingress/egress metadata
    const progressEvent = createDerivedEvent(claimed.event, {
      type: 'internal.egress.v1',
      message: { role: 'assistant', text: args.message },
      annotations: [{
        kind: 'progress_update',
        value: { parentCorrelationId: context.correlationId },
        source: 'tool-gateway',
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      }],
    });

    await this.publish('internal.egress.v1', progressEvent);

    return {
      content: [{ type: 'text', text: 'Progress message sent' }]
    };
  }
}
```

### Example 2: Debugging Event Lifecycle

```typescript
// In admin MCP tool
this.registerTool(
  'admin.debug.event_timeline',
  'Show event lifecycle timeline (requires claim-check logs)',
  z.object({
    correlationId: z.string()
  }),
  async (args) => {
    // Note: This would require claim-check to maintain a timeline
    // For MVP, just show current state
    const claimed = await claimCheck.retrieve(args.correlationId);

    if (!claimed) {
      return { content: [{ type: 'text', text: 'Event not found' }], isError: true };
    }

    const timeline = {
      correlationId: args.correlationId,
      currentState: {
        kind: claimed.kind,
        stage: claimed.event.routing?.stage,
        capturedAt: claimed.capturedAt,
      },
      isComplete: claimed.kind === 'final' || claimed.kind === 'deadletter',
      routingSlip: claimed.event.routing?.slip,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(timeline, null, 2) }]
    };
  }
);
```

---

## Monitoring & Observability

### Metrics to Track

```typescript
// Claim-check metrics
{
  'claim_check.snapshot.received': { kind, correlationId },
  'claim_check.snapshot.stored': { kind, previousKind, correlationId },
  'claim_check.snapshot.rejected_stale': { kind, incomingTime, existingTime },
  'claim_check.snapshot.duplicate': { kind, correlationId },
  'claim_check.snapshot.out_of_order': { kind, correlationId },
  'claim_check.event.retrieved': { kind, correlationId, age_ms },
}
```

### Dashboard Queries

```sql
-- Out-of-order delivery rate
SELECT COUNT(*)
FROM logs
WHERE message = 'claim_check.snapshot.rejected_stale'
  AND timestamp > NOW() - INTERVAL '1 hour';

-- Snapshot kind distribution
SELECT kind, COUNT(*)
FROM logs
WHERE message = 'claim_check.snapshot.stored'
  AND timestamp > NOW() - INTERVAL '1 hour'
GROUP BY kind;

-- Average event lifetime (initial → final)
-- (Requires tracking both timestamps in a future enhancement)
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('ClaimCheckService - Out-of-Order Handling', () => {
  test('accepts initial snapshot when none exists', async () => {
    const result = await service.storeEventClaim(correlationId, {
      kind: 'initial',
      capturedAt: '2026-01-01T10:00:00Z',
      event: testEvent,
    });

    expect(result).toBe('stored');
    expect(redis.get).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"kind":"initial"'),
      { EX: 300 }
    );
  });

  test('rejects stale update when newer snapshot exists', async () => {
    // Store initial snapshot at T1
    redis.get.mockResolvedValueOnce(JSON.stringify({
      kind: 'update',
      capturedAt: '2026-01-01T10:01:00Z',
      event: testEvent,
    }));

    // Try to store initial snapshot at T0 (older)
    const result = await service.storeEventClaim(correlationId, {
      kind: 'initial',
      capturedAt: '2026-01-01T10:00:00Z',
      event: testEvent,
    });

    expect(result).toBe('rejected_stale');
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('accepts newer update when older snapshot exists', async () => {
    // Store initial snapshot at T0
    redis.get.mockResolvedValueOnce(JSON.stringify({
      kind: 'initial',
      capturedAt: '2026-01-01T10:00:00Z',
      event: testEvent,
    }));

    // Store update snapshot at T1 (newer)
    const result = await service.storeEventClaim(correlationId, {
      kind: 'update',
      capturedAt: '2026-01-01T10:01:00Z',
      event: testEvent,
    });

    expect(result).toBe('stored');
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"kind":"update"'),
      { EX: 300 }
    );
  });

  test('rejects duplicate snapshot (same timestamp + kind)', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({
      kind: 'update',
      capturedAt: '2026-01-01T10:00:00Z',
      event: testEvent,
    }));

    const result = await service.storeEventClaim(correlationId, {
      kind: 'update',
      capturedAt: '2026-01-01T10:00:00Z',
      event: testEvent,
    });

    expect(result).toBe('rejected_stale');
  });

  test('accepts update with same timestamp but different kind', async () => {
    // Two services publish at same millisecond (unlikely but possible)
    redis.get.mockResolvedValueOnce(JSON.stringify({
      kind: 'update',
      capturedAt: '2026-01-01T10:00:00.000Z',
      sourceService: 'router',
      event: testEvent,
    }));

    const result = await service.storeEventClaim(correlationId, {
      kind: 'update',
      capturedAt: '2026-01-01T10:00:00.000Z',
      sourceService: 'auth',
      event: testEvent,
    });

    // Should accept (different service, might have different enrichments)
    expect(result).toBe('stored');
  });
});
```

### Integration Tests

```typescript
test('handles full event lifecycle with out-of-order delivery', async () => {
  const correlationId = 'test-lifecycle-123';

  // Simulate out-of-order arrival
  const snapshots = [
    { kind: 'update', capturedAt: '2026-01-01T10:01:00Z', sourceService: 'router' },
    { kind: 'initial', capturedAt: '2026-01-01T10:00:00Z', sourceService: 'ingress-egress' },
    { kind: 'update', capturedAt: '2026-01-01T10:02:00Z', sourceService: 'auth' },
    { kind: 'final', capturedAt: '2026-01-01T10:03:00Z', sourceService: 'ingress-egress' },
  ];

  for (const snapshot of snapshots) {
    await publishToSnapshotTopic({ ...snapshot, correlationId, event: testEvent });
    await sleep(50); // Allow processing
  }

  // Retrieve final state
  const claimed = await claimCheck.retrieve(correlationId);

  expect(claimed).not.toBeNull();
  expect(claimed.kind).toBe('final'); // Latest kind
  expect(claimed.capturedAt).toBe('2026-01-01T10:03:00Z'); // Latest timestamp
});
```

---

## Future Enhancements

### Enhancement 1: Timeline Storage
Store ALL snapshots (not just latest) to enable complete timeline reconstruction:

```redis
bitbrat:claim:event:{correlationId}:timeline -> Sorted Set
  Score: timestamp, Value: { kind, event }

ZADD bitbrat:claim:event:abc123:timeline 1735725600000 '{"kind":"initial",...}'
ZADD bitbrat:claim:event:abc123:timeline 1735725660000 '{"kind":"update",...}'
```

### Enhancement 2: Sequence-Based Ordering
If timestamp precision is insufficient, use sequence numbers:

```typescript
// Extract from idempotencyKey or add to snapshot
sequence: number;  // 1, 2, 3, ...

// Ordering: sequence > timestamp
if (incoming.sequence > existing.sequence) {
  store();
}
```

### Enhancement 3: Event Expiry Notification
Publish event when claim expires:

```typescript
// On TTL expiration, publish to:
internal.claim.expired.v1 { correlationId, finalKind: 'final' }

// Enables cleanup/alerting for incomplete events
```

---

**End of Claim-Check Versioning Design**

This design ensures claim-check is a robust event cache that handles the real-world complexities of distributed message delivery.
