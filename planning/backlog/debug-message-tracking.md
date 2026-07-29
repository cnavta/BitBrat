# Backlog: Debug Message Tracking and Monitoring Improvements

**Created**: 2026-07-28
**Status**: Ready for Implementation
**Priority**: P2 - Medium
**Theme**: Observability & Debugging

## Context

Following investigation of debug message redelivery (2026-07-28), we identified opportunities to improve debug message tracking, deduplication, and observability. While no bugs were found in the acknowledgment logic, these enhancements will help distinguish between legitimate multiple updates, NATS redeliveries, and service restart reprocessing.

**Related Investigation**: `/tmp/debug_redelivery_analysis.md`

## Epic: Debug Message Correlation and Deduplication

Enhance debug mode to provide better correlation tracking, prevent duplicate updates, and improve observability of debug message flow.

---

## Story 1: Add Original CorrelationId Tracking to Debug Messages

**As a** platform engineer
**I want** debug messages to include the original user request correlationId
**So that** I can trace which debug updates belong to which user interaction

### Acceptance Criteria
- [ ] Debug messages include `metadata.originalCorrelationId` field
- [ ] Debug messages include `metadata.debugMessageType` field (`'progress'` or `'completion'`)
- [ ] Logs clearly show relationship between user request and debug updates
- [ ] No breaking changes to existing debug message consumers

### Implementation Details

**File**: `src/common/base-server.ts`

**Current Code** (line 1122-1195):
```typescript
protected async sendDebugUpdate(
  channel: string,
  connector: 'slack' | 'twitch' | 'discord' | string,
  updateText: string,
  correlationId?: string
): Promise<void> {
  const debugFeedbackEvent: InternalEventV2 = {
    v: '2',
    correlationId: randomUUID(), // Unique ID for feedback event
    type: 'egress.deliver.v1',
    // ...
  };
}
```

**Proposed Change**:
```typescript
protected async sendDebugUpdate(
  channel: string,
  connector: 'slack' | 'twitch' | 'discord' | string,
  updateText: string,
  correlationId?: string,
  messageType: 'progress' | 'completion' = 'progress'
): Promise<void> {
  const debugFeedbackEvent: InternalEventV2 = {
    v: '2',
    correlationId: randomUUID(),
    type: 'egress.deliver.v1',
    metadata: {
      originalCorrelationId: correlationId,
      debugMessageType: messageType,
      debugSource: this.serviceName,
    },
    // ...
  };
}
```

**Callers to Update**:
- `src/common/base-server.ts:945` - `next()` method (progress updates)
- `src/common/base-server.ts:1061` - `complete()` method (completion updates)

**Effort**: 2 story points
**Risk**: Low - Additive change, backward compatible

---

## Story 2: Implement Debug Message Deduplication

**As a** BitBrat user
**I want** duplicate debug updates to be filtered out
**So that** I don't see the same progress message multiple times

### Acceptance Criteria
- [ ] Debug messages are deduplicated based on `originalCorrelationId + service + messageType`
- [ ] Deduplication cache has configurable TTL (default: 5 minutes)
- [ ] Duplicate debug messages are logged but not delivered
- [ ] Deduplication can be disabled via feature flag
- [ ] Metrics track dedupe hit rate

### Implementation Details

**File**: `src/common/base-server.ts`

**Add Class-Level Cache**:
```typescript
export class Bit {
  // Existing fields...
  private debugMessageCache: Map<string, number> = new Map();
  private debugCacheCleanupInterval?: NodeJS.Timeout;

  constructor(options: BitOptions) {
    // Existing code...

    // Start cleanup interval for debug message cache
    const cleanupIntervalMs = 60000; // 1 minute
    this.debugCacheCleanupInterval = setInterval(() => {
      this.cleanupDebugMessageCache();
    }, cleanupIntervalMs);
  }

  private cleanupDebugMessageCache(): void {
    const now = Date.now();
    const ttlMs = this.getConfig('DEBUG_MESSAGE_DEDUPE_TTL_MS', { default: 300000 }); // 5 min

    for (const [key, timestamp] of this.debugMessageCache.entries()) {
      if (now - timestamp > ttlMs) {
        this.debugMessageCache.delete(key);
      }
    }
  }
}
```

**Update sendDebugUpdate()**:
```typescript
protected async sendDebugUpdate(
  channel: string,
  connector: 'slack' | 'twitch' | 'discord' | string,
  updateText: string,
  correlationId?: string,
  messageType: 'progress' | 'completion' = 'progress'
): Promise<void> {
  // Check if deduplication is enabled
  const dedupeEnabled = this.getConfig('DEBUG_MESSAGE_DEDUPE_ENABLED', {
    default: 'true'
  }).toLowerCase() === 'true';

  if (dedupeEnabled && correlationId) {
    const dedupeKey = `${correlationId}:${this.serviceName}:${messageType}`;

    if (this.debugMessageCache.has(dedupeKey)) {
      this.logger.debug('debug.feedback.deduplicated', {
        originalCorrelationId: correlationId,
        service: this.serviceName,
        messageType,
      });
      return; // Skip duplicate
    }

    this.debugMessageCache.set(dedupeKey, Date.now());
  }

  // Existing message creation and publishing...
}
```

**Configuration**:
- Add to `architecture.yaml` global env:
  ```yaml
  env:
    DEBUG_MESSAGE_DEDUPE_ENABLED: "true"
    DEBUG_MESSAGE_DEDUPE_TTL_MS: "300000"  # 5 minutes
  ```

**Cleanup on Shutdown**:
```typescript
async close(reason: string): Promise<void> {
  // Clear debug cache cleanup interval
  if (this.debugCacheCleanupInterval) {
    clearInterval(this.debugCacheCleanupInterval);
  }

  // Existing shutdown logic...
}
```

**Effort**: 5 story points
**Risk**: Medium - Requires careful cache management and cleanup

---

## Story 3: Add Debug Message Redelivery Metrics

**As a** platform engineer
**I want** metrics on debug message delivery and redelivery
**So that** I can monitor system health and identify issues

### Acceptance Criteria
- [ ] Log debug message processing with enhanced context
- [ ] Track NATS redelivery count in logs
- [ ] Distinguish between first delivery and redelivery
- [ ] Include timing metrics (delivery latency)
- [ ] Add correlation to original user request

### Implementation Details

**File**: `src/apps/ingress-egress-service.ts`

**Update Generic Egress Handler** (line 428-467):
```typescript
await this.onMessage<InternalEventV2>(
  { destination: genericEgressTopic, queue: genericQueue, ack: 'explicit' },
  async (evt: InternalEventV2, attributes: AttributeMap, ctx: MessageContext) => {
    const startTime = Date.now();

    try {
      const source = (evt?.ingress?.source || '').toLowerCase();
      const isDebugMessage = source.startsWith('debug.');

      // Extract NATS redelivery info from attributes
      const redelivered = attributes?.['Nats-Msg-Redelivered'] === 'true';
      const redeliveryCount = parseInt(attributes?.['Nats-Delivery-Count'] || '1', 10);

      if (isDebugMessage) {
        const deliveryLatency = Date.now() - startTime;

        logger.info('ingress-egress.egress.debug_message', {
          correlationId: evt.correlationId,
          originalCorrelationId: evt.metadata?.originalCorrelationId,
          source: evt.ingress?.source,
          debugMessageType: evt.metadata?.debugMessageType,
          debugSource: evt.metadata?.debugSource,
          connector: evt.egress?.connector,
          redelivered,
          redeliveryCount,
          deliveryLatency,
          stage: evt.routing?.stage,
        });
      }

      // Existing platform detection and processing...

    } catch (e: any) {
      // Existing error handling...
    }
  }
);
```

**Add MessageContext Type**:
```typescript
interface MessageContext {
  ack: () => Promise<void>;
  nack: (requeue?: boolean) => Promise<void>;
}
```

**Update NATS Driver to Expose Redelivery Info**:

**File**: `src/services/message-bus/nats-driver.ts` (line 190-210)

Add redelivery attributes to the attributes map:
```typescript
// Extract redelivery metadata from NATS message info
const info = (m as any)?.info;
if (info) {
  attrs['Nats-Msg-Redelivered'] = String(info.redelivered || false);
  attrs['Nats-Delivery-Count'] = String(info.deliveryCount || 1);
  attrs['Nats-Stream-Sequence'] = String(info.streamSequence || 0);
}
```

**Effort**: 3 story points
**Risk**: Low - Logging enhancements only

---

## Story 4: Verify and Monitor Instance ID Uniqueness

**As a** platform engineer
**I want** to verify ingress-egress instance IDs are unique
**So that** NATS queue semantics work correctly

### Acceptance Criteria
- [ ] Log instance ID on startup with full context
- [ ] Add health check endpoint that returns instance ID
- [ ] Document how instance IDs are generated in each deployment mode
- [ ] Add alert if multiple instances share same ID (if detectable)
- [ ] Validate K_REVISION in Cloud Run deployments

### Implementation Details

**File**: `src/apps/ingress-egress-service.ts`

**Enhanced Instance ID Logging** (line 84-97):
```typescript
// Resolve instance identity → used to compute per-instance egress topic
const kRevision = process.env.K_REVISION;
const hostname = process.env.HOSTNAME;
const manualId = process.env.EGRESS_INSTANCE_ID || process.env.SERVICE_INSTANCE_ID;

if (kRevision) {
  process.env.EGRESS_INSTANCE_ID = kRevision;
  process.env.SERVICE_INSTANCE_ID = kRevision;
}

const instanceId =
  process.env.EGRESS_INSTANCE_ID ||
  process.env.SERVICE_INSTANCE_ID ||
  hostname ||
  `proc-${Math.random().toString(36).slice(2, 10)}`;

const egressTopic = `${INTERNAL_EGRESS_V1}.${instanceId}`;
const egressSubject = `${cfg.busPrefix || ''}${egressTopic}`;

// Enhanced logging with instance ID sources
logger.info('ingress-egress.instance_id.resolved', {
  instanceId,
  sources: {
    K_REVISION: kRevision || null,
    HOSTNAME: hostname || null,
    EGRESS_INSTANCE_ID: manualId || null,
    fallback: !kRevision && !hostname && !manualId,
  },
  egressTopic,
  egressSubject,
  queueName: `ingress-egress.${instanceId}`,
});
```

**Add Instance ID to Health Check**:
```typescript
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE_NAME,
    instanceId,
    egressTopic,
    timestamp: new Date().toISOString(),
  });
});
```

**Documentation Update**:

**File**: `documentation/guides/instance-id-generation.md` (NEW)
```markdown
# Instance ID Generation

## Overview
Each ingress-egress instance requires a unique instance ID for NATS queue semantics.

## ID Resolution Priority
1. `K_REVISION` (Cloud Run) - Unique per revision
2. `EGRESS_INSTANCE_ID` / `SERVICE_INSTANCE_ID` (manual override)
3. `HOSTNAME` (Docker container hostname)
4. Random fallback: `proc-{random}`

## Deployment Modes

### Cloud Run
- Uses `K_REVISION` from environment
- Format: `{service}-{revision-id}`
- Guaranteed unique per revision

### Docker Compose
- Uses container `HOSTNAME`
- Format: `{compose-project}_{service}_{instance-number}`
- Example: `bitbrat-staging-ingress-egress-1`

### Kubernetes
- Uses pod `HOSTNAME`
- Format: `{deployment}-{replica-hash}`
- Example: `ingress-egress-7d8f9b5c4-x9k2m`

## Verification
```bash
# Check instance ID in logs
docker logs <container> 2>&1 | grep "ingress-egress.instance_id.resolved"

# Check via health endpoint
curl http://localhost:3000/health | jq .instanceId
```
```

**Effort**: 3 story points
**Risk**: Low - Observability improvements

---

## Story 5: Add Debug Mode E2E Test with Correlation Tracking

**As a** developer
**I want** automated tests for debug mode correlation tracking
**So that** I can verify debug messages are properly linked to user requests

### Acceptance Criteria
- [ ] E2E test sends user request with `!debug` prefix
- [ ] Test captures all debug messages for that request
- [ ] Test verifies `originalCorrelationId` matches user request
- [ ] Test verifies progress and completion messages are received
- [ ] Test runs in CI pipeline

### Implementation Details

**File**: `src/common/base-server.test.ts` (NEW section)

```typescript
describe('Debug Mode Correlation Tracking', () => {
  let capturedDebugMessages: InternalEventV2[] = [];
  let userRequestCorrelationId: string;

  beforeEach(() => {
    capturedDebugMessages = [];
    userRequestCorrelationId = randomUUID();
  });

  it('should include originalCorrelationId in debug messages', async () => {
    const bit = new TestBit();

    // Mock publisher to capture debug messages
    const mockPublisher = {
      publishJson: jest.fn(async (event: InternalEventV2) => {
        if (event.ingress?.source?.startsWith('debug.')) {
          capturedDebugMessages.push(event);
        }
      }),
    };

    // Send debug-enabled event through bit
    const event: InternalEventV2 = {
      correlationId: userRequestCorrelationId,
      debug: {
        enabled: true,
        initiatedBy: 'test-user',
        feedbackChannel: 'test-channel',
        startedAt: new Date().toISOString(),
      },
      // ... rest of event
    };

    await bit.next(event);

    // Verify debug messages
    expect(capturedDebugMessages.length).toBeGreaterThan(0);

    for (const debugMsg of capturedDebugMessages) {
      expect(debugMsg.metadata?.originalCorrelationId).toBe(userRequestCorrelationId);
      expect(debugMsg.metadata?.debugMessageType).toMatch(/progress|completion/);
      expect(debugMsg.qos?.tracer).toBe(false);
    }
  });

  it('should deduplicate identical debug messages', async () => {
    const bit = new TestBit();

    // Send same debug update twice
    await bit.sendDebugUpdate('channel', 'slack', 'Test message', 'corr-123', 'progress');
    await bit.sendDebugUpdate('channel', 'slack', 'Test message', 'corr-123', 'progress');

    // Only first should be sent
    expect(capturedDebugMessages.length).toBe(1);
  });

  it('should not deduplicate different message types', async () => {
    const bit = new TestBit();

    // Send progress and completion with same correlationId
    await bit.sendDebugUpdate('channel', 'slack', 'Progress', 'corr-123', 'progress');
    await bit.sendDebugUpdate('channel', 'slack', 'Complete', 'corr-123', 'completion');

    // Both should be sent (different messageType)
    expect(capturedDebugMessages.length).toBe(2);
  });
});
```

**Effort**: 5 story points
**Risk**: Medium - Requires test infrastructure setup

---

## Implementation Plan

### Phase 1: Foundation (Sprint N)
- **Story 1**: Add Original CorrelationId Tracking (2 pts)
- **Story 3**: Add Debug Message Redelivery Metrics (3 pts)
- **Story 4**: Verify Instance ID Uniqueness (3 pts)

**Total**: 8 story points
**Goal**: Improve observability and debugging without changing behavior

### Phase 2: Deduplication (Sprint N+1)
- **Story 2**: Implement Debug Message Deduplication (5 pts)
- **Story 5**: Add Debug Mode E2E Tests (5 pts)

**Total**: 10 story points
**Goal**: Prevent duplicate debug messages and validate with tests

---

## Success Metrics

### Observability Improvements
- [ ] 100% of debug messages include `originalCorrelationId`
- [ ] Logs clearly show debug message type (progress vs completion)
- [ ] Redelivery count tracked in logs when >1

### Deduplication Effectiveness
- [ ] <1% of debug messages are duplicates (measured over 1 week)
- [ ] Dedupe cache hit rate >0% (indicates duplicates being caught)
- [ ] No user reports of duplicate debug updates

### System Health
- [ ] Zero instance ID collisions in staging/production
- [ ] Average debug message delivery latency <100ms
- [ ] Zero ack failures for debug messages

---

## Technical Debt Notes

### Future Enhancements
1. **Distributed Dedupe Cache**: Current in-memory cache is per-instance. For multi-instance deployments, consider Redis-backed dedupe cache.

2. **Debug Message Rate Limiting**: Prevent debug spam if a service generates excessive updates.

3. **Debug Message Compression**: Bundle multiple progress updates into single message to reduce Slack API calls.

4. **Structured Debug Context**: Replace plain text updates with structured JSON for better parsing/filtering.

### Deprecation Path
If debug mode is replaced with distributed tracing (OpenTelemetry), this backlog provides:
- Correlation tracking (maps to trace spans)
- Deduplication (maps to span deduplication)
- Metrics (maps to trace metrics)

---

## Related Work
- **Sprint 371**: Debug Mode Implementation (DBG-001 to DBG-012)
- **Investigation**: Debug Message Redelivery Analysis (2026-07-28)
- **Future**: OpenTelemetry Integration (TBD)

---

## Questions for Product/Engineering

1. **Deduplication TTL**: Is 5 minutes the right default, or should we match event TTL (7 days)?

2. **Deduplication Scope**: Should deduplication be per-channel (same user in different channels gets separate updates) or global?

3. **Metrics Dashboard**: Do we want Grafana dashboard for debug message metrics, or are logs sufficient?

4. **Feature Flag Rollout**: Should debug deduplication be opt-in initially, or enabled by default?

5. **Performance Impact**: What's acceptable memory footprint for dedupe cache? (Current estimate: ~100 bytes per entry, ~10K entries max = 1MB)
