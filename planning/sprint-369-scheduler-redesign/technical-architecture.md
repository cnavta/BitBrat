# Technical Architecture — Scheduler Redesign (Sprint 369)

**Architect**: Claude Code
**Date**: 2026-07-26
**Sprint**: 369

## Executive Summary

The current scheduler implementation (Sprint 186) relies on external Google Cloud Scheduler infrastructure to provide a "tick" mechanism, making it GCP-dependent and unsuitable for self-hosted, Docker-based, or non-GCP cloud deployments. This redesign proposes a **platform-agnostic, self-contained scheduler** using internal `setInterval` timers with graceful lifecycle management, aligning with BitBrat's platform-agnostic architecture principles.

**Core Requirement Preserved**: Schedule `InternalEventV2` messages to specific destinations at specific times with optional repeat schedules, manageable via MCP tools.

**Key Change**: Replace GCP Cloud Scheduler dependency with internal Node.js timer-based tick mechanism.

---

## Current State Analysis

### What Works

1. **Data Model** (`src/services/scheduler/repository.ts`):
   - Clean abstraction with `IScheduleRepository` interface
   - Dual backend support: PostgreSQL (primary) + Firestore (legacy)
   - Well-defined `ScheduleDoc` schema with cron parsing via `cron-parser`
   - Proper `nextRun` calculation for both `once` and `cron` schedules

2. **MCP Tool Interface** (`src/apps/scheduler-service.ts:216-355`):
   - Complete CRUD operations: `create_schedule`, `list_schedules`, `get_schedule`, `update_schedule`, `delete_schedule`
   - Rich Zod schemas with validation
   - Just-in-Time Context Provisioning (scheduler guide + InternalEventV2 schema packs)
   - Event authoring validates against `ALLOWED_PUBLISH_TOPICS` (governance Law #2)

3. **Event Construction** (`executeSchedule()` at line 409):
   - Correctly constructs `InternalEventV2` envelope
   - Server-owned fields (v, correlationId, traceId, ingress, routing) properly set
   - Honors author-supplied egress/identity/payload/message/annotations/candidates/qos/externalEvent
   - Publishes to configurable topic (default: `internal.ingress.v1`)

### What Doesn't Work

1. **GCP Cloud Scheduler Dependency** (lines 193-213):
   - Requires external GCP infrastructure to publish to `internal.scheduler.tick` or POST to `/tick`
   - **Breaks platform-agnostic principle**: Cannot run on AWS, Azure, self-hosted Docker, or local development without manual workarounds
   - **Configuration complexity**: Requires GCP project setup, IAM permissions, Pub/Sub topic creation
   - **No local development story**: Developers must manually trigger `/tick` endpoint or set up mock Cloud Scheduler

2. **Passive Execution Model**:
   - Service waits for external tick events instead of being self-contained
   - No built-in tick generation mechanism
   - Subject to GCP Cloud Scheduler limits (min interval: 1 minute in practice, though theoretically supports per-second)

3. **No Graceful Shutdown**:
   - If internal timers were used, current implementation lacks cleanup logic
   - No `stop()` or `destroy()` hook to clear timers on service shutdown

4. **Test Coverage**:
   - Only basic healthcheck tests (`scheduler-service.test.ts:1-13`)
   - No unit tests for `handleTick()`, `executeSchedule()`, or `calculateNextRun()`
   - No integration tests for schedule execution

---

## Design Principles

### Platform-Agnostic First

BitBrat is designed to run **anywhere Docker runs**:
- **Local development**: Docker Compose on macOS/Linux/Windows
- **Self-hosted production**: Docker Compose on bare metal or VMs
- **Cloud platforms**: GCP Cloud Run, AWS ECS, Azure Container Instances

**Constraint**: Scheduler must work in all these environments without external dependencies beyond PostgreSQL/NATS (already platform-agnostic).

### Self-Contained Bit

The scheduler should be a **fully autonomous Bit** that:
- Starts its own tick mechanism on `start()`
- Stops gracefully on `SIGTERM`/`SIGINT`
- Requires zero external infrastructure beyond the message bus and persistence layer
- Works identically in local dev, staging, and production

### Reliability Over Precision

**Tradeoff Accepted**:
- **Precision**: Schedules may drift by seconds in the face of service restarts
- **Reliability**: Schedules are durable (persisted in PostgreSQL), survive restarts, and eventually execute
- **Idempotency**: Downstream consumers must handle duplicate events (already required by at-least-once message bus semantics)

**Rationale**: For BitBrat's use cases (periodic LLM prompts, scheduled announcements, weekly summaries), **minute-level precision is sufficient**. Sub-second precision is not a requirement.

---

## Proposed Architecture

### 1. Internal Tick Mechanism

Replace `internal.scheduler.tick` Pub/Sub subscription with **internal `setInterval` timer**:

```typescript
class SchedulerServer extends Bit {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly TICK_INTERVAL_MS = 60_000; // 60 seconds (configurable via env)

  async setup(): Promise<void> {
    // Start internal tick on service startup
    this.startTicker();
  }

  private startTicker(): void {
    this.getLogger().info('scheduler.ticker.starting', {
      intervalMs: this.TICK_INTERVAL_MS
    });

    this.tickInterval = setInterval(async () => {
      try {
        await this.handleTick();
      } catch (e: any) {
        this.getLogger().error('scheduler.tick.error', { error: e.message, stack: e.stack });
      }
    }, this.TICK_INTERVAL_MS);
  }

  private stopTicker(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      this.getLogger().info('scheduler.ticker.stopped');
    }
  }

  async stop(): Promise<void> {
    this.stopTicker();
    await super.stop();
  }
}
```

**Key Design Decisions**:

1. **Tick Interval**: Default 60 seconds (1 minute), configurable via `SCHEDULER_TICK_INTERVAL_MS` environment variable
   - Balances responsiveness vs. database query load
   - Sufficient for typical use cases (hourly/daily schedules)
   - Can be reduced to 10-30s for more responsive scheduling

2. **Error Handling**: Tick errors are logged but do not crash the service
   - Failed tick does not stop the timer
   - Next tick will retry due schedules

3. **Graceful Shutdown**: `stop()` hook clears the interval
   - Prevents timer from firing during shutdown
   - Ensures clean service lifecycle

### 2. Tick Execution Logic (Minimal Changes)

The existing `handleTick()` implementation (lines 372-407) is **sound and requires minimal changes**:

```typescript
private async handleTick() {
  const now = new Date();
  const dueSchedules = await this.scheduleRepo.getDueSchedules(now);

  this.getLogger().info('scheduler.tick.executing', {
    count: dueSchedules.length,
    timestamp: now.toISOString()
  });

  // Execute schedules in parallel (with concurrency limit)
  const CONCURRENCY_LIMIT = 10;
  for (let i = 0; i < dueSchedules.length; i += CONCURRENCY_LIMIT) {
    const batch = dueSchedules.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.allSettled(batch.map(schedule => this.processSingleSchedule(schedule, now)));
  }
}

private async processSingleSchedule(schedule: ScheduleDoc, now: Date) {
  try {
    const topic = schedule.topic ?? DEFAULT_PUBLISH_TOPIC;
    const publisher = this.getPublisher(topic); // Cache publishers by topic

    await this.executeSchedule(schedule, publisher);

    // Update nextRun
    const nextRun = this.calculateNextRun(schedule.schedule.type, schedule.schedule.value);
    await this.scheduleRepo.update(schedule.id, {
      lastRun: now,
      nextRun: nextRun ?? null,
      enabled: schedule.schedule.type === 'once' ? false : schedule.enabled,
      updatedAt: now,
    });
  } catch (e: any) {
    this.getLogger().error('scheduler.execute.error', {
      id: schedule.id,
      error: e.message,
      stack: e.stack
    });
  }
}
```

**Improvements**:

1. **Publisher Caching**: Store publishers by topic in instance variable instead of local Map
   ```typescript
   private publishers: Map<string, ReturnType<typeof createMessagePublisher>> = new Map();

   private getPublisher(topic: string) {
     if (!this.publishers.has(topic)) {
       this.publishers.set(topic, createMessagePublisher(topic));
     }
     return this.publishers.get(topic)!;
   }
   ```

2. **Batch Processing**: Process schedules in batches of 10 to prevent overwhelming the database/message bus with large schedule sets

3. **Error Isolation**: Use `Promise.allSettled()` so one failing schedule doesn't block others

### 3. HTTP `/tick` Endpoint (Optional Manual Trigger)

**Keep the HTTP endpoint** for manual triggering (useful for testing, debugging, emergency execution):

```typescript
this.onHTTPRequest({ path: '/tick', method: 'POST' }, async (req: Request, res: Response) => {
  this.getLogger().info('scheduler.tick.manual_trigger');

  try {
    await this.handleTick();
    res.status(200).json({ success: true, message: 'Tick executed successfully' });
  } catch (e: any) {
    this.getLogger().error('scheduler.tick.manual_trigger_failed', { error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});
```

**Remove the Pub/Sub subscription** to `internal.scheduler.tick` (lines 204-213) — no longer needed.

### 4. Configuration

**Environment Variables**:

```yaml
# env/local/scheduler.yaml
SCHEDULER_TICK_INTERVAL_MS: "60000"  # Default: 60 seconds
LOG_LEVEL: "debug"
```

**Defaults**:
- `SCHEDULER_TICK_INTERVAL_MS`: 60,000 ms (1 minute)
- Can be overridden per execution context

**Rationale**: Allows tuning tick frequency without code changes (e.g., 10s for responsive local dev, 60s for production).

### 5. Testing Strategy

#### Unit Tests

```typescript
// src/apps/scheduler-service.test.ts

describe('SchedulerServer', () => {
  let server: SchedulerServer;
  let mockRepo: jest.Mocked<IScheduleRepository>;

  beforeEach(() => {
    mockRepo = {
      getDueSchedules: jest.fn(),
      update: jest.fn(),
      // ... other methods
    };
    server = new SchedulerServer(mockRepo);
  });

  describe('calculateNextRun', () => {
    it('calculates next run for once schedules', () => {
      const future = new Date(Date.now() + 10000);
      const result = server['calculateNextRun']('once', future.toISOString());
      expect(result).toEqual(future);
    });

    it('returns null for past once schedules', () => {
      const past = new Date(Date.now() - 10000);
      const result = server['calculateNextRun']('once', past.toISOString());
      expect(result).toBeNull();
    });

    it('calculates next run for cron schedules', () => {
      const result = server['calculateNextRun']('cron', '0 * * * *'); // Every hour
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('handleTick', () => {
    it('executes due schedules', async () => {
      const dueSchedule: ScheduleDoc = {
        id: 'test-1',
        title: 'Test Schedule',
        schedule: { type: 'once', value: new Date().toISOString() },
        event: { type: 'llm.request.v1', payload: {} },
        enabled: true,
        nextRun: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([dueSchedule]);

      await server['handleTick']();

      expect(mockRepo.getDueSchedules).toHaveBeenCalledWith(expect.any(Date));
      expect(mockRepo.update).toHaveBeenCalledWith('test-1', expect.objectContaining({
        lastRun: expect.any(Date),
        enabled: false, // once schedules auto-disable
      }));
    });

    it('handles errors in individual schedules', async () => {
      mockRepo.getDueSchedules.mockResolvedValue([
        { id: '1', /* ... */ },
        { id: '2', /* ... */ },
      ]);
      mockRepo.update.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw, logs error
      await expect(server['handleTick']()).resolves.not.toThrow();
    });
  });

  describe('ticker lifecycle', () => {
    it('starts ticker on setup', async () => {
      jest.useFakeTimers();
      await server.setup();

      expect(server['tickInterval']).not.toBeNull();

      jest.advanceTimersByTime(60000);
      expect(mockRepo.getDueSchedules).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('stops ticker on stop', async () => {
      jest.useFakeTimers();
      await server.setup();
      await server.stop();

      expect(server['tickInterval']).toBeNull();
      jest.useRealTimers();
    });
  });
});
```

#### Integration Tests

```typescript
// src/apps/scheduler-service.integration.test.ts

describe('Scheduler Integration', () => {
  let server: SchedulerServer;
  let repo: IScheduleRepository;

  beforeEach(async () => {
    // Use in-memory PostgreSQL or Firestore emulator
    repo = createScheduleRepository(/* ... */);
    server = new SchedulerServer(repo);
    await server.setup();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('executes a once schedule', async () => {
    const scheduleId = await repo.create({
      id: 'test-once',
      title: 'Test Once',
      schedule: {
        type: 'once',
        value: new Date(Date.now() + 100).toISOString()
      },
      event: {
        type: 'llm.request.v1',
        message: { role: 'system', text: 'Test prompt' },
      },
      enabled: true,
      nextRun: new Date(Date.now() + 100),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Wait for tick + execution
    await new Promise(resolve => setTimeout(resolve, 200));

    const updated = await repo.get(scheduleId);
    expect(updated?.enabled).toBe(false);
    expect(updated?.lastRun).toBeDefined();
  });

  it('executes cron schedule multiple times', async () => {
    // Test with very short interval for speed
    const scheduleId = await repo.create({
      id: 'test-cron',
      title: 'Test Cron',
      schedule: {
        type: 'cron',
        value: '*/1 * * * * *' // Every second (for testing only)
      },
      event: { type: 'llm.request.v1', payload: {} },
      enabled: true,
      nextRun: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const updated = await repo.get(scheduleId);
    expect(updated?.enabled).toBe(true); // Still enabled
    expect(updated?.lastRun).toBeDefined();
  });
});
```

### 6. Migration Path

**No breaking changes to MCP interface or data model**:
- Existing schedules in PostgreSQL/Firestore remain compatible
- MCP tool signatures unchanged
- Event publishing behavior unchanged

**Deployment**:
1. Deploy updated scheduler service (new timer logic)
2. **Remove GCP Cloud Scheduler job** (if exists)
3. **Remove Pub/Sub topic** `internal.scheduler.tick` (if exists)
4. Service becomes self-contained

**Rollback**:
- Redeploy old version
- Recreate GCP Cloud Scheduler job
- No data migration required

---

## Architecture Comparison

### Before (Sprint 186)

```
┌─────────────────────┐
│ GCP Cloud Scheduler │  (External dependency)
│  Job: "tick"        │
│  Cron: * * * * *    │
└──────────┬──────────┘
           │
           │ HTTP POST /tick
           │ OR Pub/Sub to internal.scheduler.tick
           ▼
┌─────────────────────┐
│  scheduler-service  │
│  - Listens for tick │
│  - Queries DB       │
│  - Publishes events │
└─────────────────────┘
```

**Problems**:
- ❌ GCP-only (breaks platform-agnostic principle)
- ❌ Requires external infrastructure setup
- ❌ No local development story
- ❌ Configuration complexity

### After (Sprint 369)

```
┌─────────────────────┐
│  scheduler-service  │  (Self-contained)
│  - setInterval()    │
│  - Queries DB       │
│  - Publishes events │
│  - Graceful stop()  │
└─────────────────────┘
```

**Benefits**:
- ✅ Platform-agnostic (works on Docker, GCP, AWS, Azure, self-hosted)
- ✅ Zero external dependencies (beyond PostgreSQL/NATS)
- ✅ Works identically in local dev, staging, production
- ✅ Simpler configuration
- ✅ Graceful lifecycle management

---

## Implementation Checklist

### Phase 1: Core Scheduler Logic (P0)

- [ ] Add internal tick mechanism with `setInterval()`
- [ ] Add `SCHEDULER_TICK_INTERVAL_MS` environment variable
- [ ] Implement graceful `stop()` with timer cleanup
- [ ] Add publisher caching (instance variable)
- [ ] Add batch processing for large schedule sets
- [ ] Keep HTTP `/tick` endpoint for manual trigger
- [ ] Remove Pub/Sub `internal.scheduler.tick` subscription
- [ ] Update `architecture.yaml` to remove `internal.scheduler.tick` from `consumes`

### Phase 2: Testing (P0)

- [ ] Unit tests for `calculateNextRun()`
- [ ] Unit tests for `handleTick()` with mock repository
- [ ] Unit tests for `executeSchedule()`
- [ ] Unit tests for ticker lifecycle (start/stop)
- [ ] Integration tests with real PostgreSQL
- [ ] Integration tests for once vs cron schedules
- [ ] Test graceful shutdown behavior

### Phase 3: Documentation (P1)

- [ ] Update `CLAUDE.md` with new scheduler architecture
- [ ] Add scheduler guide to `documentation/guides/`
- [ ] Document `SCHEDULER_TICK_INTERVAL_MS` configuration
- [ ] Add troubleshooting guide (missed schedules, drift, etc.)

### Phase 4: Observability (P1)

- [ ] Add `scheduler.tick.started` log event
- [ ] Add `scheduler.tick.completed` log event with execution stats
- [ ] Add `scheduler.schedule.executed` log event per schedule
- [ ] Add `scheduler.schedule.skipped` log event (if nextRun too far in past)
- [ ] Expose MCP tool `get_scheduler_stats()` for diagnostics
- [ ] Add Prometheus metrics (if metrics system exists)

### Phase 5: Enhancements (P2 - Future)

- [ ] Add `scheduler.pause()` / `scheduler.resume()` MCP tools
- [ ] Add schedule execution history (last 10 runs) to `ScheduleDoc`
- [ ] Support timezone-aware cron expressions
- [ ] Add schedule dry-run mode (preview next 5 executions)
- [ ] Add schedule conflict detection (warn if 100+ schedules within 1 minute)

---

## Risks & Mitigations

### Risk 1: Timer Drift After Service Restart

**Risk**: If scheduler service restarts, schedules may miss their exact execution time.

**Example**: Schedule set for 10:00:00 AM, service restarts at 9:59:58 AM, next tick at 10:01:00 AM → 1 minute drift.

**Mitigation**:
1. `getDueSchedules(beforeOrAt)` query uses `<=`, so schedules due in the past are still executed
2. Cron schedules auto-recalculate `nextRun`, so drift is corrected on next execution
3. For critical schedules, use `once` with idempotency checks downstream

**Acceptance**: Minute-level drift is acceptable for BitBrat's use cases.

### Risk 2: Clock Skew in Distributed Deployments

**Risk**: If scheduler scales to multiple instances (future), clock skew could cause duplicate execution.

**Mitigation**:
1. **Current design**: Scheduler is **not designed for horizontal scaling** (single instance only)
2. Docker Compose and Cloud Run deployments default to single instance (min=1, max=1)
3. If future horizontal scaling needed, add distributed locking (e.g., PostgreSQL advisory locks or Redis)

**Acceptance**: Single-instance scheduler is sufficient for current requirements.

### Risk 3: Memory Leak from Timer

**Risk**: If `setInterval` is not cleared on shutdown, timer could leak.

**Mitigation**:
1. Implement `stop()` hook with `clearInterval()`
2. Add unit tests verifying timer is cleared
3. Monitor memory usage in production

### Risk 4: Message Bus Backpressure

**Risk**: If 1000 schedules are due simultaneously, message bus could be overwhelmed.

**Mitigation**:
1. Batch processing (10 schedules at a time via `Promise.allSettled()`)
2. NATS/Pub/Sub handle backpressure gracefully (consumers pull at their own rate)
3. Add `SCHEDULER_MAX_CONCURRENT_EXECUTIONS` env var (future enhancement)

---

## Performance Characteristics

### Database Queries

**Per Tick** (every 60 seconds):
- 1 query: `SELECT * FROM schedules WHERE enabled = true AND nextRun <= $1`
- N updates: `UPDATE schedules SET lastRun = $2, nextRun = $3 WHERE id = $1` (one per executed schedule)

**Query Optimization**:
- Index on `(enabled, nextRun)` for efficient due schedule lookup
- PostgreSQL migration should add: `CREATE INDEX idx_schedules_due ON schedules(enabled, nextRun) WHERE enabled = true;`

**Typical Load**:
- 100 schedules: 1 query + ~1 update/minute (if evenly distributed) = negligible load
- 1000 schedules: 1 query + ~10 updates/minute = still negligible
- 10,000 schedules: Consider increasing tick interval or partitioning

### Message Bus Load

**Per Executed Schedule**:
- 1 message published to `internal.ingress.v1` (or configured topic)

**Typical Load**:
- 100 schedules, 1/hour each: 100 messages/hour = 1.67 messages/minute
- 1000 schedules, 1/day each: 1000 messages/day = 0.69 messages/minute

**Conclusion**: Message bus load is trivial compared to user-generated chat traffic.

---

## Success Criteria

1. **Platform-Agnostic**: Scheduler works identically on local Docker, self-hosted, GCP, AWS, Azure
2. **Zero External Dependencies**: No GCP Cloud Scheduler, no external cron services
3. **Test Coverage**: >80% coverage on scheduler logic (tick, execute, calculate)
4. **Reliability**: Schedules execute within 1 minute of `nextRun` (99% of the time)
5. **Graceful Shutdown**: No leaked timers, no orphaned database connections
6. **Backward Compatibility**: Existing schedules continue to work without modification

---

## Open Questions

1. **Tick Interval Default**: 60 seconds vs 30 seconds vs 10 seconds?
   - **Recommendation**: 60 seconds for production, 10 seconds for local dev (via env var)

2. **Missed Schedule Handling**: If service is down for 2 hours, should all missed cron schedules execute once, or skip?
   - **Recommendation**: Execute once (current behavior) — prevents "catch-up storms"

3. **Schedule Execution Ordering**: If 100 schedules are due, should they execute in priority order?
   - **Recommendation**: No priority (current behavior) — keeps implementation simple

4. **Concurrency Limit**: Hardcode 10 or make configurable?
   - **Recommendation**: Hardcode 10 for MVP, make configurable in P2 enhancement

---

## References

- **Sprint 186 (Original Implementation)**: `planning/sprint-186-a7b8c9/technical-architecture.md`
- **Current Implementation**: `src/apps/scheduler-service.ts`
- **Repository Abstraction**: `src/services/scheduler/repository.ts`
- **Platform Design Principles**: `CLAUDE.md` (platform-agnostic, Docker-first)
- **Message Bus Patterns**: `src/services/message-bus/` (NATS, Pub/Sub, SQS)
- **Timer Safety**: `src/common/safe-timers.ts`

---

## Appendix A: Example Schedule Definitions

### Once Schedule (One-time LLM Prompt)

```json
{
  "title": "Morning Standup Reminder",
  "description": "Remind team of standup at 9 AM tomorrow",
  "schedule": {
    "type": "once",
    "value": "2026-07-27T09:00:00Z"
  },
  "event": {
    "type": "llm.request.v1",
    "egress": {
      "connector": "twitch",
      "destination": "twitch",
      "channel": "#bitbrat",
      "type": "chat"
    },
    "message": {
      "role": "system",
      "text": "Generate a motivational standup reminder"
    },
    "annotations": [
      {
        "id": "prompt-1",
        "kind": "prompt",
        "source": "scheduler",
        "createdAt": "2026-07-26T22:00:00Z",
        "value": "Create a fun, energetic reminder for the team's daily standup meeting"
      }
    ]
  },
  "enabled": true
}
```

### Cron Schedule (Daily Summary)

```json
{
  "title": "Daily Activity Summary",
  "description": "Post daily community activity summary at 11 PM UTC",
  "schedule": {
    "type": "cron",
    "value": "0 23 * * *"
  },
  "event": {
    "type": "llm.request.v1",
    "egress": {
      "connector": "discord",
      "destination": "discord",
      "channel": "#general",
      "type": "chat"
    },
    "message": {
      "role": "system",
      "text": "Analyze today's activity and create a summary"
    },
    "annotations": [
      {
        "id": "prompt-summary",
        "kind": "prompt",
        "source": "scheduler",
        "createdAt": "2026-07-26T22:00:00Z",
        "value": "Review today's chat logs and create a friendly summary of key topics, funny moments, and notable events"
      }
    ],
    "metadata": {
      "summaryType": "daily",
      "includeMetrics": true
    }
  },
  "topic": "internal.ingress.v1",
  "enabled": true
}
```

### Hourly Keep-Alive (System Maintenance)

```json
{
  "title": "Hourly Health Check",
  "description": "Publish system health event every hour",
  "schedule": {
    "type": "cron",
    "value": "0 * * * *"
  },
  "event": {
    "type": "system.health.v1",
    "payload": {
      "checkType": "scheduled"
    },
    "metadata": {
      "source": "scheduler",
      "purpose": "keep-alive"
    }
  },
  "topic": "internal.system.events.v1",
  "enabled": true
}
```

---

## Appendix B: PostgreSQL Index for Performance

```sql
-- Migration: Add index for efficient due schedule lookups
-- File: infrastructure/postgres/migrations/XXX_add_schedules_due_index.sql

CREATE INDEX IF NOT EXISTS idx_schedules_due
ON schedules (
  (data->>'enabled')::boolean,
  (data->>'nextRun')::timestamp
)
WHERE (data->>'enabled')::boolean = true;

-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM schedules
WHERE (data->>'enabled')::boolean = true
  AND (data->>'nextRun')::timestamp <= NOW();
```

---

**End of Technical Architecture**
