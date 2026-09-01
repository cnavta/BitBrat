# Feedback Middleware Lifecycle

**Purpose**: Provide proactive progress updates for long-running operations (>5 seconds) using a dual-phase lifecycle pattern.

**Key Innovation (Sprint 36)**: Operations explicitly declare start (`startTracking()`) and completion (`completeOperation()`) hooks, enabling progress messages DURING execution instead of AFTER.

**Quick Start**: Services add `operation_context` annotation, call `feedbackMiddleware.startTracking(event)` before processing, then proceed normally. Middleware automatically sends timed progress messages and cleans up when `next()`/`complete()` is called.

**Use Cases**: LLM inference (10-60s), image generation (20-120s), video processing (30-300s), complex queries (5-30s).

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Dual-Phase Lifecycle](#dual-phase-lifecycle)
4. [Integration Points](#integration-points)
5. [Timer Behavior](#timer-behavior)
6. [Configuration](#configuration)
7. [Error Handling](#error-handling)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)
10. [References](#references)

---

## Problem Statement

### Before Sprint 36: Late Detection

**Issue**: Progress tracking initialized at operation completion, not start.

```
T+0s:   Service begins 41-second operation
T+41s:  Operation completes
T+41s:  Service calls next(event)
T+41s:  Middleware detects operation_context (too late!)
T+41s:  User receives final response
```

**Root Cause**: Single integration point (`beforeNext()`) called at completion in `base-server.next()`.

**Impact**: No progress messages during long operations. Users left wondering if system is working.

### After Sprint 36: Proactive Tracking

**Solution**: Dual-phase lifecycle with explicit start/completion hooks.

```
T+0s:   Service adds operation_context annotation
T+0s:   Service calls feedbackMiddleware.startTracking(event)
T+0s:   Service begins 41-second operation
T+5s:   Middleware: "Still working on this..."
T+15s:  Middleware: "This is taking longer than usual..."
T+30s:  Middleware: "Still processing, almost there..."
T+41s:  Operation completes
T+41s:  Service calls next(event)
T+41s:  Middleware auto-calls completeOperation(), stops timers
T+41s:  User receives final response
```

**Result**: Users receive updates every 5-10 seconds during long operations.

---

## Architecture Overview

### Components

| Component | Responsibility | Location |
|-----------|---------------|----------|
| **FeedbackMiddleware** | Timer scheduling, progress message generation | src/common/middleware/feedback-middleware.ts:1 |
| **Service** | Add annotation, call startTracking(), perform operation | src/apps/llm-bot-service.ts:216 |
| **BaseServer** | Auto-call completeOperation() during next() | src/common/base-server.ts:1009 |
| **ClaimCheck** | Store source event for progress message routing | src/services/claim-check/claim-check-service.ts:1 |

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Service adds operation_context annotation                      │
│    - operation: string                                             │
│    - estimatedDurationMs: number (optional)                        │
│    - startedAt: ISO 8601 timestamp                                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 2. Service calls feedbackMiddleware.startTracking(event)          │
│    - Validates operation_context exists                            │
│    - Creates OperationState tracking record                        │
│    - Schedules timers (initial, update, timeout, max-lifetime)     │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 3. Service performs long-running operation                         │
│    - LLM inference, image generation, etc.                         │
│    - Middleware timers run in background                           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 4. Timers fire at configured intervals                             │
│    - T+5s: Initial progress message                                │
│    - T+15s, T+25s: Update messages (every 10s)                     │
│    - T+30s: Timeout escalation message                             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 5. Progress messages retrieve source event context                 │
│    - claim.event.retrieve(correlationId)                           │
│    - Copy ingress/egress/identity from source event                │
│    - Publish to internal.egress.v1                                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ 6. Operation completes, service calls next(event)                  │
│    - BaseServer.next() calls completeOperation(correlationId)      │
│    - Clears all timers (initial, update, timeout, max-lifetime)    │
│    - Deletes tracking state                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Dual-Phase Lifecycle

### Phase 1: Start Tracking (Explicit)

**When**: After adding `operation_context` annotation, BEFORE starting long operation.

**Location**: Service code (src/apps/llm-bot-service.ts:216)

**Code**:
```typescript
// 1. Add annotation
event.annotations.push({
  kind: 'operation_context',
  value: {
    operation: 'llm_inference',
    estimatedDurationMs: 30000,
    startedAt: new Date().toISOString(),
  },
  source: this.name,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
});

// 2. Start tracking
const feedbackMiddleware = this.getResource<any>('feedbackMiddleware');
if (feedbackMiddleware?.startTracking) {
  try {
    await feedbackMiddleware.startTracking(event);
    logger.debug('progress_tracking_started', { correlationId: event.correlationId });
  } catch (err) {
    logger.warn('progress_tracking_failed', { error: err.message });
  }
}

// 3. Perform operation (timers now active)
const response = await this.callLLM(event.message.text);
```

**What Happens**:
1. Validates `operation_context` annotation exists
2. Checks for duplicate (idempotent - multiple calls ignored)
3. Creates `OperationState` tracking record
4. Schedules 4 timers: initial (5s), update (10s interval), timeout (30s), max-lifetime (120s)

**Error Handling**: Fail-open. If `startTracking()` throws, operation continues normally (no progress messages sent).

### Phase 2: Complete Operation (Automatic)

**When**: Service calls `next(event)` or `complete(event)` after operation finishes.

**Location**: BaseServer.next() (src/common/base-server.ts:1009)

**Code**:
```typescript
// In BaseServer.next() - automatic cleanup
if (this.feedbackMiddleware) {
  try {
    this.feedbackMiddleware.completeOperation(event.correlationId);
  } catch (feedbackError: any) {
    this.logger.warn('routing.next.feedback_cleanup_failed', {
      error: feedbackError.message,
      correlationId: event.correlationId,
    });
  }
}

await this.publish(nextTopic, event);
```

**What Happens**:
1. Looks up tracking state by `correlationId`
2. Clears all 4 timers (initial, update, timeout, max-lifetime)
3. Deletes tracking state from memory
4. Logs completion with operation duration

**Error Handling**: Fail-open. If `completeOperation()` throws, message still publishes to next topic.

**IMPORTANT**: Services should NEVER call `completeOperation()` manually. It's automatic.

---

## Integration Points

### 1. Service Integration (Explicit)

**Files**: src/apps/llm-bot-service.ts:216, src/apps/image-gen-mcp.ts (hypothetical)

**Pattern**:
```typescript
export class LLMBotService extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      async (event, attrs, ctx) => {
        // STEP 1: Add annotation
        event.annotations.push({
          kind: 'operation_context',
          value: {
            operation: 'llm_inference',
            estimatedDurationMs: 30000,
            startedAt: new Date().toISOString(),
          },
          source: this.name,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });

        // STEP 2: Start tracking
        const feedbackMiddleware = this.getResource<any>('feedbackMiddleware');
        if (feedbackMiddleware?.startTracking) {
          try {
            await feedbackMiddleware.startTracking(event);
          } catch (err) {
            this.logger.warn('progress_tracking_failed', { error: err.message });
          }
        }

        // STEP 3: Perform operation
        const response = await this.llmClient.generateCompletion(event);
        event.candidates = [{ text: response }];

        // STEP 4: Complete (automatic in next())
        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

**Key Points**:
- ALWAYS add annotation before calling `startTracking()`
- ALWAYS wrap `startTracking()` in try/catch (fail-open)
- NEVER call `completeOperation()` manually
- Optional: Set `estimatedDurationMs` for timer tuning (future enhancement)

### 2. BaseServer Integration (Automatic)

**File**: src/common/base-server.ts:1009

**Pattern**:
```typescript
async next(event: InternalEventV2): Promise<void> {
  // ... routing slip logic ...

  // Sprint 36: Clean up progress tracking before publishing response
  if (this.feedbackMiddleware) {
    try {
      this.feedbackMiddleware.completeOperation(event.correlationId);
    } catch (feedbackError: any) {
      this.logger.warn('routing.next.feedback_cleanup_failed', {
        error: feedbackError.message,
        correlationId: event.correlationId,
      });
    }
  }

  await this.publish(nextTopic, event);
}
```

**Key Points**:
- Cleanup happens BEFORE publishing to next topic
- Fail-open: Errors logged but don't block message flow
- Same cleanup in `complete()` method

### 3. ClaimCheck Integration (Dependency)

**File**: src/services/claim-check/claim-check-service.ts

**Purpose**: Progress messages need source event's `ingress`/`egress`/`identity` for routing.

**Flow**:
1. ClaimCheck stores all snapshots on `internal.persistence.snapshot.v1`
2. FeedbackMiddleware calls `claim.event.retrieve(correlationId)`
3. Copies `ingress`, `egress`, `identity` from source event
4. Publishes progress message to `internal.egress.v1`

**Failure Mode**: If ClaimCheck unavailable or event expired (TTL=300s), progress messages fail silently (logged at warn level).

---

## Timer Behavior

### Timer Schedule

| Timer | Delay | Purpose | Repeat? |
|-------|-------|---------|---------|
| **Initial** | 5s | First progress message | No (one-shot) |
| **Update** | 10s | Subsequent progress messages | Yes (interval) |
| **Timeout** | 30s | Escalation message ("taking longer") | No (one-shot) |
| **Max Lifetime** | 120s | Force cleanup (safety) | No (one-shot) |

### Timer Scheduling (Simplified in Sprint 36)

**Before Sprint 36**: Conditional logic for "fresh" vs "late detected" operations.

**After Sprint 36**: Simplified. Always schedule from "now" since `startTracking()` is called at operation inception.

**Code** (src/common/middleware/feedback-middleware.ts:389):
```typescript
private scheduleTimers(state: OperationState): void {
  // Sprint 36: Simplified timer scheduling (no late detection needed)
  // Operations are always fresh when startTracking() is called

  // Schedule initial progress timer
  state.initialTimer = setTimeout(async () => {
    await this.sendTimedProgressMessage(state, 'initial');

    // Start update interval after initial
    state.updateTimer = setInterval(async () => {
      await this.sendTimedProgressMessage(state, 'update');
    }, this.config.updateIntervalMs);
  }, this.config.initialThresholdMs);

  // Schedule timeout timer
  state.timeoutTimer = setTimeout(async () => {
    await this.sendTimedProgressMessage(state, 'timeout');

    // Clear update interval after timeout
    if (state.updateTimer) {
      clearInterval(state.updateTimer);
    }
  }, this.config.timeoutThresholdMs);

  // Schedule max lifetime cleanup
  state.maxLifetimeTimer = setTimeout(() => {
    this.logger.info('feedback.operation.max_lifetime_reached', {
      correlationId: state.correlationId,
    });
    this.completeOperation(state.correlationId);
  }, this.config.maxOperationLifetimeMs);
}
```

### Example Timeline (35-second operation)

```
T+0s:   startTracking() called, timers scheduled
T+5s:   Initial timer fires → "Still working on this..."
T+5s:   Update interval starts (every 10s)
T+15s:  Update timer fires → "This is taking longer than usual..."
T+25s:  Update timer fires → "Still processing, almost there..."
T+30s:  Timeout timer fires → "Taking longer than expected..."
T+30s:  Update interval stops
T+35s:  Operation completes, next() called
T+35s:  completeOperation() clears all timers
```

### Configuration Tuning

**Default Values** (src/common/middleware/feedback-middleware.ts:30):
```typescript
const DEFAULT_CONFIG: FeedbackConfig = {
  enabled: true,
  initialThresholdMs: 5000,      // 5 seconds
  updateIntervalMs: 10000,        // 10 seconds
  timeoutThresholdMs: 30000,      // 30 seconds
  maxOperationLifetimeMs: 120000, // 2 minutes
};
```

**Environment Variables** (architecture.yaml):
```yaml
feedback-middleware:
  env:
    - FEEDBACK_ENABLED=true
    - FEEDBACK_INITIAL_THRESHOLD_MS=5000
    - FEEDBACK_UPDATE_INTERVAL_MS=10000
    - FEEDBACK_TIMEOUT_THRESHOLD_MS=30000
    - FEEDBACK_MAX_OPERATION_LIFETIME_MS=120000
```

**Tuning Guidelines**:
- **Short operations (5-15s)**: `initialThreshold=5s`, `updateInterval=10s` (may only send 1 message)
- **Medium operations (15-60s)**: `initialThreshold=5s`, `updateInterval=10s` (default)
- **Long operations (60-300s)**: `initialThreshold=10s`, `updateInterval=15s`, `timeout=60s`

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEEDBACK_ENABLED` | `true` | Master enable/disable flag |
| `FEEDBACK_INITIAL_THRESHOLD_MS` | `5000` | First progress message delay |
| `FEEDBACK_UPDATE_INTERVAL_MS` | `10000` | Subsequent message interval |
| `FEEDBACK_TIMEOUT_THRESHOLD_MS` | `30000` | Escalation message delay |
| `FEEDBACK_MAX_OPERATION_LIFETIME_MS` | `120000` | Force cleanup after 2 minutes |

### architecture.yaml

```yaml
services:
  feedback-middleware:
    profile: core
    category: platform
    stage: orchestration
    kind: middleware
    mcp:
      exposure: none
    env:
      - FEEDBACK_ENABLED
      - FEEDBACK_INITIAL_THRESHOLD_MS
      - FEEDBACK_UPDATE_INTERVAL_MS
      - FEEDBACK_TIMEOUT_THRESHOLD_MS
      - FEEDBACK_MAX_OPERATION_LIFETIME_MS
      - REDIS_URL  # For claim-check dependency
    resources:
      - claim-check  # Required for source event retrieval
```

### Runtime Configuration

**Loading** (src/common/middleware/feedback-middleware.ts:52):
```typescript
private loadConfig(): FeedbackConfig {
  const env = process.env;
  return {
    enabled: env.FEEDBACK_ENABLED !== 'false',
    initialThresholdMs: parseInt(env.FEEDBACK_INITIAL_THRESHOLD_MS || '5000', 10),
    updateIntervalMs: parseInt(env.FEEDBACK_UPDATE_INTERVAL_MS || '10000', 10),
    timeoutThresholdMs: parseInt(env.FEEDBACK_TIMEOUT_THRESHOLD_MS || '30000', 10),
    maxOperationLifetimeMs: parseInt(env.FEEDBACK_MAX_OPERATION_LIFETIME_MS || '120000', 10),
  };
}
```

**Validation**: No validation errors throw during init. Invalid values fall back to defaults.

---

## Error Handling

### Fail-Open Philosophy

**Principle**: Progress tracking failures NEVER block operation success.

**Implementation**: Every integration point wrapped in try/catch with warn-level logging.

### Error Scenarios

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| No `operation_context` annotation | Skip tracking, return early | Debug |
| Duplicate `startTracking()` call | Ignore, log, return early | Debug |
| ClaimCheck unavailable | Progress messages fail silently | Warn |
| Source event expired (TTL) | Progress messages fail silently | Warn |
| `completeOperation()` throws | Log error, continue message publish | Warn |
| Timer callback throws | Log error, timer continues | Error |

### Example Error Logs

**Missing annotation**:
```json
{
  "level": "debug",
  "msg": "No operation_context annotation, skipping tracking",
  "correlationId": "abc123"
}
```

**Duplicate tracking**:
```json
{
  "level": "debug",
  "msg": "Operation already tracked, ignoring duplicate",
  "correlationId": "abc123"
}
```

**ClaimCheck failure**:
```json
{
  "level": "warn",
  "msg": "Failed to retrieve source event from claim check",
  "correlationId": "abc123",
  "error": "Event expired (TTL=300s)"
}
```

**Cleanup failure**:
```json
{
  "level": "warn",
  "msg": "routing.next.feedback_cleanup_failed",
  "correlationId": "abc123",
  "error": "Cannot read property 'initialTimer' of undefined"
}
```

---

## Testing

### Unit Tests

**File**: src/common/middleware/feedback-middleware.test.ts

**Coverage**: 51 tests, 100% pass rate

**Test Suites**:
1. **Basic functionality** (12 tests) - Initialization, config loading
2. **Sprint 36: startTracking()** (7 tests) - Fresh operations, idempotency, edge cases
3. **Sprint 36: completeOperation()** (4 tests) - Timer cleanup, state deletion
4. **Sprint 36: Timer behavior** (6 tests) - Initial, update, timeout, max-lifetime
5. **Sprint 36: Edge cases** (6 tests) - Missing annotation, duplicate calls, cleanup
6. **Old tests (updated)** (16 tests) - Legacy tests migrated to new API

**Key Test Patterns**:

**Testing startTracking()**:
```typescript
it('should create tracking state for fresh operation', async () => {
  const event = createMockEvent({
    annotations: [{
      kind: 'operation_context',
      value: {
        operation: 'test_operation',
        startedAt: new Date().toISOString(),
      },
    }],
  });

  await middleware.startTracking(event);

  expect(middleware['operationTracking'].has(event.correlationId)).toBe(true);
  const state = middleware['operationTracking'].get(event.correlationId);
  expect(state?.operationContext.operation).toBe('test_operation');
});
```

**Testing timer behavior**:
```typescript
it('should send initial progress message at threshold', async () => {
  jest.useFakeTimers();
  const publishSpy = jest.spyOn(mockBit, 'publish');

  await middleware.startTracking(event);

  // Advance to initial threshold (5s)
  jest.advanceTimersByTime(5000);

  expect(publishSpy).toHaveBeenCalledWith(
    'internal.egress.v1',
    expect.objectContaining({
      message: expect.objectContaining({
        text: expect.stringContaining('Still working'),
      }),
    })
  );

  jest.useRealTimers();
});
```

**Testing idempotency**:
```typescript
it('should be idempotent (duplicate calls ignored)', async () => {
  await middleware.startTracking(event);
  await middleware.startTracking(event); // Duplicate

  expect(middleware['operationTracking'].size).toBe(1);
});
```

### Integration Tests

**Skipped**: Agent-dev validation not performed in Sprint 36 (MCP tools unavailable).

**Recommended Tests** (for future sprints):
1. Deploy llm-bot to agent-dev
2. Trigger 35-second LLM operation
3. Verify progress messages arrive at T+5s, T+15s, T+25s
4. Verify final response arrives at T+35s
5. Verify no duplicate messages after completion

---

## Troubleshooting

### No Progress Messages Sent

**Symptoms**: Long operation completes but no progress messages during execution.

**Diagnosis**:
1. Check if `operation_context` annotation exists:
   ```typescript
   event.annotations.find(a => a.kind === 'operation_context')
   ```
2. Check if `startTracking()` was called:
   ```
   grep "progress_tracking_started" logs/llm-bot.log
   ```
3. Check if timers scheduled:
   ```typescript
   // In middleware code
   this.logger.debug('timers_scheduled', {
     initialMs: this.config.initialThresholdMs,
     updateMs: this.config.updateIntervalMs,
   });
   ```
4. Check ClaimCheck availability:
   ```bash
   npm run brat -- fleet health claim-check
   ```

**Solutions**:
- Missing annotation → Add `operation_context` before `startTracking()`
- `startTracking()` not called → Add call after annotation
- ClaimCheck down → Check Redis connection, restart claim-check service

### Progress Messages After Completion

**Symptoms**: Progress messages continue after final response sent.

**Diagnosis**:
1. Check if `completeOperation()` called:
   ```
   grep "feedback.operation.completed" logs/llm-bot.log
   ```
2. Check if timers cleared:
   ```typescript
   // Should see: clearTimeout(initialTimer), clearInterval(updateTimer), etc.
   ```

**Solutions**:
- Missing `completeOperation()` → Verify BaseServer.next() integration (should be automatic)
- Timer not cleared → Check middleware version (Sprint 36+)

### Duplicate Progress Messages

**Symptoms**: Multiple identical progress messages sent in quick succession.

**Diagnosis**:
1. Check if `startTracking()` called multiple times:
   ```
   grep "progress_tracking_started" logs/llm-bot.log | wc -l
   ```
2. Check if idempotency working:
   ```
   grep "Operation already tracked" logs/llm-bot.log
   ```

**Solutions**:
- Multiple `startTracking()` calls → Verify service code (should only call once)
- Idempotency broken → Check middleware version (Sprint 36+)

### Performance Impact

**Symptoms**: High CPU/memory usage from feedback middleware.

**Diagnosis**:
1. Check number of tracked operations:
   ```typescript
   this.logger.info('tracked_operations', {
     count: this.operationTracking.size,
   });
   ```
2. Check timer counts:
   ```bash
   # Should be ~4 timers per tracked operation
   ```

**Solutions**:
- Too many tracked operations → Check for completion leaks (timers not cleared)
- Memory leak → Verify `completeOperation()` deletes state
- High volume → Tune `maxOperationLifetimeMs` (force cleanup sooner)

---

## References

### Source Files

| File | Lines | Description |
|------|-------|-------------|
| **feedback-middleware.ts** | 1-550 | Core middleware implementation |
| **feedback-middleware.test.ts** | 1-1500 | Unit tests (51 tests) |
| **llm-bot-service.ts** | 216-231 | Integration example (startTracking) |
| **base-server.ts** | 1009-1022 | Integration example (completeOperation) |
| **claim-check-service.ts** | 1-300 | Dependency (event retrieval) |

### Sprint Artifacts

| Document | Purpose |
|----------|---------|
| **progress-middleware-architectural-issue.md** | Original problem statement (Sprint 35) |
| **technical-architecture.md** | Solution design (Sprint 36) |
| **execution-plan.md** | Implementation roadmap (Sprint 36) |
| **backlog.yaml** | Task breakdown (Sprint 36) |
| **implementation-validation.md** | Validation report (Sprint 36) |

### Related Documentation

| Document | Topic |
|----------|-------|
| **CLAUDE.md** | Development pattern (Pattern #2) |
| **documentation/concepts/agent-flow-patterns.md** | Agent orchestration patterns |
| **documentation/guides/claim-check.md** | Event retrieval pattern |
| **architecture.yaml** | Service configuration |

### External References

- Node.js Timer API: https://nodejs.org/api/timers.html
- Jest Fake Timers: https://jestjs.io/docs/timer-mocks
- BitBrat Sprint Protocol: AGENTS.md

---

## Revision History

| Sprint | Date | Changes |
|--------|------|---------|
| Sprint 36 | 2026-08-31 | Initial version - Dual-phase lifecycle pattern |

---

**Document Status**: Complete
**Last Updated**: 2026-08-31
**Author**: Claude (Sprint 36)
**Reviewers**: Pending
