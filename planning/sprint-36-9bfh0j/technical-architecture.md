# Technical Architecture: Progress Middleware Lifecycle Redesign

**Sprint 36 - Architectural Analysis**
**Prepared by**: System Architect
**Date**: 2026-08-31
**Status**: DRAFT FOR REVIEW

---

## Executive Summary

The current FeedbackMiddleware architecture has a fundamental timing flaw: it is invoked when operations **complete** rather than when they **begin**. This results in progress messages arriving after or simultaneously with final responses, defeating the purpose of user feedback during long-running operations.

**Core Issue**: Integration point occurs at `Bit.next()` (operation completion) instead of operation initialization.

**Proposed Solution**: Dual-phase lifecycle with explicit `startTracking()` and `completeOperation()` hooks, eliminating reactive "late detection" logic in favor of proactive timer-based tracking from operation inception.

**Impact**: Minimal breaking changes (single method rename), high architectural clarity, significant UX improvement for long-running operations (30+ seconds).

---

## 1. Current Architecture Analysis

### 1.1 Integration Points

**Single Hook: `beforeNext()`**

```typescript
// src/common/base-server.ts:1014
async next(event: InternalEventV2): Promise<void> {
  // ... routing logic ...

  if (this.feedbackMiddleware) {
    await this.feedbackMiddleware.beforeNext(event);  // ❌ Called at END
  }

  await this.publish(...);  // Publish final response
}
```

**Called from**: `Bit.next()` → invoked when service completes processing and publishes response
**Timing**: After `processEvent()` completes, before publishing to next topic/egress
**Problem**: Operation already finished; timers start 30+ seconds too late

### 1.2 Current Execution Flow

```
Timeline for 41-second image generation operation:

T+0.000s  llm-bot receives message
T+0.003s  operation_context annotation added (startedAt: T+0.003s)
T+0.003s  processEvent() begins (LLM + tool invocation)
          ⏱️  NO TIMERS STARTED - middleware not invoked yet

... 41 seconds of LLM processing + image generation ...

T+41.308s processEvent() completes
T+41.311s await this.next(event) called
T+41.311s feedbackMiddleware.beforeNext() invoked ❌ FIRST CONTACT
T+41.312s startTracking() detects 41s elapsed → Case 3 → Skip message
T+41.316s Final response published
T+41.940s Messages arrive at platform (race condition)
```

**Observed behavior**: Progress message arrives **after** final response due to race between:
1. Skipped progress message (setImmediate)
2. Final response (immediate publish)

### 1.3 Reactive Compensation Logic

The middleware attempts to compensate with "late detection" cases:

```typescript
// src/common/middleware/feedback-middleware.ts:382
private startTracking(state: OperationState): void {
  const alreadyElapsedMs = Date.now() - state.startedAt.getTime();

  if (alreadyElapsedMs < 2000) {
    // Case 1: Fresh operation - schedule timers normally ✅
  } else if (alreadyElapsedMs < 30000) {
    // Case 2: Detected late (2-30s) - skip message ⚠️
    this.logger.debug('Operation detected in progress (now completing), skipping progress');
  } else {
    // Case 3: Very late (>30s) - skip message ⚠️
    this.logger.debug('Operation detected very late (already completing), skipping progress');
  }
}
```

**Analysis**:
- **Case 1**: Never executes for long operations (middleware invoked after completion)
- **Case 2 & 3**: Symptom suppression added in Sprint 35 commit `0cea97c2`
- **Fundamental flaw**: Trying to fix timing issue with more timing logic

### 1.4 Architectural Debt

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Single integration point | No proactive tracking | Middleware invoked at wrong lifecycle phase |
| Reactive elapsed-time logic | Complexity, unreliable | Compensating for late invocation |
| Race conditions | Unpredictable message ordering | Progress and final response published concurrently |
| Timer inefficiency | Timers start then immediately cancel | No lifecycle awareness |

---

## 2. Root Cause Analysis

### 2.1 Semantic Mismatch

**Method Name**: `beforeNext()` suggests "before advancing routing slip"
**Actual Timing**: Called when operation is **completing**, not **beginning**
**Consequence**: Name implies proactive behavior, implementation is reactive

### 2.2 Missing Lifecycle Hook

BitBrat's event-driven architecture has well-defined lifecycle phases:

```
┌─────────────┐
│   Receive   │ ← onMessage() handler
└──────┬──────┘
       │
┌──────▼──────────────┐
│  Add Annotations    │ ← operation_context added here
└──────┬──────────────┘
       │
┌──────▼──────────────┐
│  Process Event      │ ← Long-running work happens here
└──────┬──────────────┘     ⏱️  TIMERS SHOULD START BEFORE THIS
       │
┌──────▼──────────────┐
│  Publish Response   │ ← beforeNext() called here ❌
└─────────────────────┘
```

**Missing Hook**: After annotation, before processing
**Current Hook**: After processing, before publishing

### 2.3 Annotation-Driven Design Pattern

The platform uses **annotation-driven** operation tracking:

```typescript
// llm-bot-service.ts:200-214
const operationContextAnnotation: AnnotationV1 = {
  kind: 'operation_context',
  value: JSON.stringify({
    operation: 'llm_request',
    startedAt: Date.now(),  // ✅ Accurate start time
    // ...
  }),
  // ...
};
data.annotations.push(operationContextAnnotation);

// ❌ MISSING: Start middleware tracking here
// feedbackMiddleware.startTracking(data);

// Then begin processing (timers should already be running)
await processEvent(this, data, ...);
```

**Pattern**: Annotations declare intent **before** execution
**Break**: Middleware consumes annotation **after** execution

---

## 3. Proposed Architecture

### 3.1 Dual-Phase Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Operation Lifecycle                      │
└─────────────────────────────────────────────────────────────┘

Phase 1: START TRACKING
─────────────────────────
When:     Immediately after operation_context annotation added
Where:    Service-specific (llm-bot, tool-gateway, etc.)
Method:   feedbackMiddleware.startTracking(event)
Action:   Create state, schedule all timers (2s, 5s, 30s)
Result:   Timers running proactively

         ⏱️  T+2s  → Send initial progress
         ⏱️  T+5s  → Send update (repeating)
         ⏱️  T+30s → Send timeout warning

Phase 2: COMPLETE TRACKING
───────────────────────────
When:     Before publishing final response
Where:    base-server.ts:next() (existing location)
Method:   feedbackMiddleware.completeOperation(correlationId)
Action:   Clear all timers, remove tracking state
Result:   No more progress messages sent
```

### 3.2 Interface Design

```typescript
/**
 * FeedbackMiddleware - Dual-phase lifecycle interface
 */
export class FeedbackMiddleware {
  /**
   * Phase 1: Start tracking operation immediately.
   *
   * Call this when operation_context annotation is added, BEFORE processing.
   * Schedules all timers based on configured thresholds.
   *
   * @param event - Event with operation_context annotation
   */
  async startTracking(event: InternalEventV2): Promise<void>;

  /**
   * Phase 2: Complete operation and cleanup.
   *
   * Call this when operation finishes (before publishing response).
   * Clears all active timers and removes tracking state.
   *
   * @param correlationId - Operation to complete
   */
  completeOperation(correlationId: string): void;

  /**
   * @deprecated Use startTracking() + completeOperation() lifecycle.
   * Kept for backward compatibility. Will be removed in next major version.
   */
  async beforeNext(event: InternalEventV2): Promise<void>;
}
```

### 3.3 Expected Execution Flow

```
Timeline for 41-second operation (AFTER FIX):

T+0.000s  llm-bot receives message
T+0.003s  operation_context annotation added
T+0.003s  feedbackMiddleware.startTracking(event) ✅ TIMERS START
          ├─ Schedule initial timer (fires at T+2s)
          ├─ Schedule timeout timer (fires at T+30s)
          └─ Schedule max lifetime cleanup (fires at T+300s)

T+2.003s  ⏰ Initial timer fires
          └─ Send "🤔 Thinking about your request..."
          └─ Schedule update interval (every 5s)

T+7.003s  ⏰ Update timer fires
          └─ Send "⏳ Still working on it..."

T+12.003s ⏰ Update timer fires
          └─ Send "⏳ Still working on it..."

... updates continue every 5s ...

T+30.003s ⏰ Timeout timer fires
          └─ Send "⌛ This is taking longer than expected, please wait..."
          └─ Clear update interval (no more regular updates)

... processing continues ...

T+41.308s processEvent() completes
T+41.311s feedbackMiddleware.completeOperation(correlationId) ✅ CLEANUP
          ├─ Clear all timers
          └─ Remove tracking state
T+41.316s Final response published
T+41.940s Final response arrives at platform ✅ NO RACE CONDITION
```

**Key improvements**:
1. Progress messages sent **during** operation (T+2s, T+7s, T+12s, T+30s)
2. Final response arrives **after** last progress message
3. Deterministic ordering (no race conditions)

---

## 4. Integration Points

### 4.1 Phase 1: startTracking()

**Location**: Service-specific, after operation_context annotation

```typescript
// src/apps/llm-bot-service.ts:214
if (!isProgressEvent) {
  const operationContextAnnotation: AnnotationV1 = {
    kind: 'operation_context',
    value: JSON.stringify({
      operation: 'llm_request',
      startedAt: Date.now(),
      // ...
    }),
    // ...
  };
  data.annotations.push(operationContextAnnotation);

  // NEW: Start progress tracking immediately
  const feedbackMiddleware = this.getResource<FeedbackMiddleware>('feedbackMiddleware');
  if (feedbackMiddleware) {
    await feedbackMiddleware.startTracking(data);  // ✅ PROACTIVE
  }
}

// Timers now running, proceed with processing
await processEvent(this, data, ...);
```

**Services requiring integration**:
- `llm-bot` (primary use case, 30+ second operations)
- `tool-gateway` (potential future use for long-running tools)
- Any service adding `operation_context` annotations

### 4.2 Phase 2: completeOperation()

**Location**: base-server.ts:next() (existing integration point)

```typescript
// src/common/base-server.ts:1014
async next(event: InternalEventV2): Promise<void> {
  // ... routing logic ...

  // Clean up progress tracking before publishing response
  if (this.feedbackMiddleware) {
    this.feedbackMiddleware.completeOperation(event.correlationId);  // ✅ CLEANUP
  }

  // Publish response
  await this.publish(...);
}
```

**Changes**:
- Rename call from `beforeNext()` → `completeOperation()`
- Semantic clarity: "complete operation" vs "before next"
- No functional change (same location, same timing)

### 4.3 Backward Compatibility

**Deprecation strategy**:

```typescript
// src/common/middleware/feedback-middleware.ts
async beforeNext(event: InternalEventV2): Promise<void> {
  this.logger.warn('FeedbackMiddleware.beforeNext() called - deprecated', {
    correlationId: event.correlationId,
    message: 'Use startTracking() at operation start instead. beforeNext() will be removed in v1.0.0',
    stack: new Error().stack?.split('\n')[2], // Show caller
  });

  // Graceful fallback: just cleanup if already tracked
  this.completeOperation(event.correlationId);
}
```

**Migration timeline**:
- **Phase 1** (this sprint): Add startTracking(), deprecate beforeNext()
- **Phase 2** (next sprint): Update all services to use new lifecycle
- **Phase 3** (v1.0.0): Remove beforeNext() entirely

---

## 5. Design Patterns and Principles

### 5.1 Lifecycle Hook Pattern

**Pattern**: Dual-phase resource management (acquire/release, start/stop, begin/end)

**Examples in BitBrat**:
- `Bit.setup()` / `Bit.shutdown()`
- `IdempotencyMiddleware.beforeNext()` / (implicit cleanup via TTL)
- Database connections: `connect()` / `disconnect()`

**Application**: `startTracking()` / `completeOperation()`

### 5.2 Annotation-Driven Metadata

**Pattern**: Services declare intent via annotations, middleware consumes declaratively

**Existing usage**:
- `operation_context` → FeedbackMiddleware (this sprint)
- `routing_context` → event-router
- `authentication` → auth-service

**Best practice**: Middleware reacts to annotations at **earliest lifecycle opportunity** (not latest)

### 5.3 Fail-Open Resilience

**Principle**: Progress feedback failures MUST NOT block operation success

**Implementation**:
```typescript
// Phase 1: Non-blocking start
if (feedbackMiddleware) {
  try {
    await feedbackMiddleware.startTracking(data);
  } catch (err) {
    logger.warn('Failed to start progress tracking, continuing anyway', { error: err });
    // Operation continues normally
  }
}

// Phase 2: Non-blocking cleanup
if (this.feedbackMiddleware) {
  try {
    this.feedbackMiddleware.completeOperation(event.correlationId);
  } catch (err) {
    this.logger.warn('Failed to complete progress tracking', { error: err });
    // Response still published
  }
}
```

**Guarantees**:
- Timer failures don't crash operations
- Missing middleware doesn't break services
- Network failures sending progress don't stop final response

### 5.4 Idempotency

**Requirement**: Multiple `startTracking()` calls must be safe

```typescript
async startTracking(event: InternalEventV2): Promise<void> {
  const existing = this.operationTracking.get(event.correlationId);
  if (existing) {
    this.logger.debug('Operation already tracked, ignoring duplicate startTracking', {
      correlationId: event.correlationId,
    });
    return;  // ✅ Idempotent
  }

  // Create state and start timers...
}
```

**Rationale**: Services might retry, middleware should handle gracefully

---

## 6. Implementation Strategy

### 6.1 Phase 1: Add startTracking() Method

**File**: `src/common/middleware/feedback-middleware.ts`

**Implementation**:
```typescript
/**
 * Start tracking an operation immediately when it begins.
 *
 * Call this when operation_context annotation is added, BEFORE processing starts.
 * Creates tracking state and schedules all progress timers.
 *
 * Idempotent: Multiple calls for same correlationId are ignored.
 * Fail-open: Errors logged but don't throw.
 *
 * @param event - Event with operation_context annotation
 */
async startTracking(event: InternalEventV2): Promise<void> {
  if (!this.config.enabled) {
    return;
  }

  // Extract operation context
  const operationContext = this.extractOperationContext(event);
  if (!operationContext) {
    this.logger.debug('No operation_context annotation, skipping tracking', {
      correlationId: event.correlationId,
    });
    return;
  }

  // Check for duplicate (idempotency)
  if (this.operationTracking.has(event.correlationId)) {
    this.logger.debug('Operation already tracked, ignoring duplicate', {
      correlationId: event.correlationId,
    });
    return;
  }

  // Create tracking state
  const state: OperationState = {
    correlationId: event.correlationId,
    startedAt: new Date(operationContext.startedAt || Date.now()),
    stage: 'initial',
    operationContext,
    originalMessage: event.message?.text || '',
    sourceEvent: event,
  };

  this.operationTracking.set(event.correlationId, state);

  this.logger.debug('Operation tracking started proactively', {
    correlationId: event.correlationId,
    operation: operationContext.operation,
    startedAt: state.startedAt.toISOString(),
  });

  // Schedule all timers immediately (no elapsed time checks needed)
  this.scheduleTimers(state);
}
```

### 6.2 Phase 2: Refactor Timer Scheduling

**Extract timer logic** from `startTracking()` to dedicated method:

```typescript
/**
 * Schedule progress timers for fresh operation.
 *
 * Assumes operation just started (no elapsed time compensation).
 *
 * @param state - Operation state (must not have existing timers)
 */
private scheduleTimers(state: OperationState): void {
  // Initial progress (e.g., 2 seconds)
  state.initialTimer = setTimeout(async () => {
    try {
      await this.sendTimedProgressMessage(state, 'initial');

      // Start periodic updates after initial message
      if (this.operationTracking.has(state.correlationId)) {
        state.updateTimer = setInterval(async () => {
          try {
            await this.sendTimedProgressMessage(state, 'update');
          } catch (err) {
            this.logger.error('Update progress failed', { error: err });
            if (state.updateTimer) {
              clearInterval(state.updateTimer);
              state.updateTimer = undefined;
            }
          }
        }, this.config.updateIntervalMs);
      }
    } catch (err) {
      this.logger.error('Initial progress failed', { error: err });
    }
  }, this.config.initialThresholdMs);

  // Timeout warning (e.g., 30 seconds)
  state.timeoutTimer = setTimeout(async () => {
    try {
      await this.sendTimedProgressMessage(state, 'timeout');
    } catch (err) {
      this.logger.error('Timeout progress failed', { error: err });
    } finally {
      // Stop regular updates after timeout
      if (state.updateTimer) {
        clearInterval(state.updateTimer);
        state.updateTimer = undefined;
      }
    }
  }, this.config.timeoutThresholdMs);

  // Max lifetime failsafe (e.g., 5 minutes)
  state.maxLifetimeTimer = setTimeout(() => {
    this.logger.warn('Operation exceeded max lifetime, forcing cleanup', {
      correlationId: state.correlationId,
      maxLifetimeMs: this.config.maxOperationLifetimeMs,
    });
    this.completeOperation(state.correlationId);
  }, this.config.maxOperationLifetimeMs);

  this.logger.debug('Progress timers scheduled', {
    correlationId: state.correlationId,
    initialMs: this.config.initialThresholdMs,
    timeoutMs: this.config.timeoutThresholdMs,
    maxLifetimeMs: this.config.maxOperationLifetimeMs,
  });
}
```

**Key changes**:
- No `alreadyElapsedMs` calculation (operation always fresh)
- Remove Case 2 & 3 logic (no late detection needed)
- Simplified, predictable behavior

### 6.3 Phase 3: Deprecate beforeNext()

```typescript
/**
 * @deprecated Use startTracking() + completeOperation() lifecycle instead.
 *
 * This method is called too late (at operation completion) to be effective.
 * Will be removed in v1.0.0.
 *
 * For now, acts as a graceful fallback by cleaning up any existing tracking.
 */
async beforeNext(event: InternalEventV2): Promise<void> {
  this.logger.warn('FeedbackMiddleware.beforeNext() deprecated', {
    correlationId: event.correlationId,
    message: 'Use startTracking() at operation start. beforeNext() will be removed in v1.0.0',
  });

  // Just cleanup (operation is completing anyway)
  this.completeOperation(event.correlationId);
}
```

### 6.4 Phase 4: Integrate in llm-bot

**File**: `src/apps/llm-bot-service.ts:214`

**Before**:
```typescript
data.annotations.push(operationContextAnnotation);

// Immediately start processing (no middleware invoked)
await tracer.startActiveSpan('process-llm-request', async (span) => {
  await processEvent(this, data, ...);
});
```

**After**:
```typescript
data.annotations.push(operationContextAnnotation);

// NEW: Start progress tracking before processing
const feedbackMiddleware = this.getResource<FeedbackMiddleware>('feedbackMiddleware');
if (feedbackMiddleware) {
  try {
    await feedbackMiddleware.startTracking(data);
  } catch (err) {
    logger.warn('Failed to start progress tracking', { error: err });
  }
}

// Now start processing (timers already running)
await tracer.startActiveSpan('process-llm-request', async (span) => {
  await processEvent(this, data, ...);
});
```

### 6.5 Phase 5: Update base-server Integration

**File**: `src/common/base-server.ts:1014`

**Before**:
```typescript
if (this.feedbackMiddleware) {
  await this.feedbackMiddleware.beforeNext(event);
}
```

**After**:
```typescript
if (this.feedbackMiddleware) {
  try {
    this.feedbackMiddleware.completeOperation(event.correlationId);
  } catch (err) {
    this.logger.warn('Failed to complete progress tracking', { error: err });
  }
}
```

**Note**: Change from `await` to synchronous (no I/O in cleanup, just timer clearing)

---

## 7. Testing Strategy

### 7.1 Unit Tests

**File**: `src/common/middleware/feedback-middleware.test.ts`

**New test cases**:

```typescript
describe('FeedbackMiddleware - Dual-phase lifecycle', () => {
  describe('startTracking()', () => {
    it('schedules initial timer for fresh operation', async () => {
      const event = createTestEvent({ startedAt: Date.now() });
      await middleware.startTracking(event);

      // Verify state created
      const stats = middleware.getStats();
      expect(stats.activeOperations).toBe(1);

      // Advance timers and verify initial progress sent
      jest.advanceTimersByTime(2000);
      await flushPromises();

      expect(mockPublish).toHaveBeenCalledWith(
        'internal.egress.v1',
        expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({ text: '🤔 Thinking about your request...' })
          ])
        })
      );
    });

    it('is idempotent (multiple calls ignored)', async () => {
      const event = createTestEvent({ startedAt: Date.now() });

      await middleware.startTracking(event);
      await middleware.startTracking(event); // Duplicate
      await middleware.startTracking(event); // Duplicate

      const stats = middleware.getStats();
      expect(stats.activeOperations).toBe(1); // Only one tracking state
    });

    it('schedules timeout timer at 30 seconds', async () => {
      const event = createTestEvent({ startedAt: Date.now() });
      await middleware.startTracking(event);

      // Advance to just before timeout
      jest.advanceTimersByTime(29000);
      await flushPromises();
      expect(mockPublish).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({ text: expect.stringContaining('longer than expected') })
          ])
        })
      );

      // Advance past timeout threshold
      jest.advanceTimersByTime(1000);
      await flushPromises();
      expect(mockPublish).toHaveBeenCalledWith(
        'internal.egress.v1',
        expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({ text: '⌛ This is taking longer than expected, please wait...' })
          ])
        })
      );
    });

    it('does not send messages if completeOperation called before timer fires', async () => {
      const event = createTestEvent({ startedAt: Date.now() });
      await middleware.startTracking(event);

      // Complete operation before initial timer (2s)
      jest.advanceTimersByTime(1000);
      middleware.completeOperation(event.correlationId);

      // Advance past initial timer
      jest.advanceTimersByTime(2000);
      await flushPromises();

      // No progress messages sent
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('completeOperation()', () => {
    it('clears all active timers', async () => {
      const event = createTestEvent({ startedAt: Date.now() });
      await middleware.startTracking(event);

      // Verify tracking active
      expect(middleware.getStats().activeOperations).toBe(1);

      middleware.completeOperation(event.correlationId);

      // Verify tracking removed
      expect(middleware.getStats().activeOperations).toBe(0);

      // Verify no messages sent after cleanup
      jest.advanceTimersByTime(60000);
      await flushPromises();
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('is safe to call when no tracking exists (idempotent)', () => {
      expect(() => {
        middleware.completeOperation('non-existent-correlation-id');
      }).not.toThrow();
    });
  });

  describe('beforeNext() - deprecated', () => {
    it('logs deprecation warning', async () => {
      const event = createTestEvent({ startedAt: Date.now() });
      await middleware.beforeNext(event);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
        expect.objectContaining({
          correlationId: event.correlationId,
        })
      );
    });

    it('gracefully cleans up if tracking exists', async () => {
      const event = createTestEvent({ startedAt: Date.now() });

      // Start tracking first
      await middleware.startTracking(event);
      expect(middleware.getStats().activeOperations).toBe(1);

      // Call deprecated method
      await middleware.beforeNext(event);

      // Should cleanup
      expect(middleware.getStats().activeOperations).toBe(0);
    });
  });
});
```

### 7.2 Integration Tests

**File**: `src/common/middleware/feedback-middleware.integration.test.ts`

**Test scenario**: End-to-end long-running operation

```typescript
describe('FeedbackMiddleware - Integration', () => {
  it('sends progress during 35-second operation', async () => {
    const publishedMessages: InternalEventV2[] = [];
    const mockPublish = jest.fn(async (topic, event) => {
      publishedMessages.push(event);
    });

    const middleware = new FeedbackMiddleware(
      { getLogger: () => mockLogger, publish: mockPublish },
      {
        initialThresholdMs: 2000,
        updateIntervalMs: 5000,
        timeoutThresholdMs: 30000,
      }
    );

    // Simulate operation lifecycle
    const event = createTestEvent({ startedAt: Date.now() });

    // Phase 1: Start tracking (operation begins)
    await middleware.startTracking(event);

    // Simulate 35 seconds of processing
    for (let elapsed = 0; elapsed < 35000; elapsed += 1000) {
      jest.advanceTimersByTime(1000);
      await flushPromises();
    }

    // Phase 2: Complete operation
    middleware.completeOperation(event.correlationId);

    // Verify message ordering
    const progressMessages = publishedMessages.filter(msg =>
      msg.annotations?.some(a => a.kind === 'progress_feedback')
    );

    expect(progressMessages).toHaveLength(7); // Initial + 5 updates + timeout
    expect(progressMessages[0].candidates[0].text).toContain('Thinking');        // T+2s
    expect(progressMessages[1].candidates[0].text).toContain('Still working');   // T+7s
    expect(progressMessages[2].candidates[0].text).toContain('Still working');   // T+12s
    expect(progressMessages[3].candidates[0].text).toContain('Still working');   // T+17s
    expect(progressMessages[4].candidates[0].text).toContain('Still working');   // T+22s
    expect(progressMessages[5].candidates[0].text).toContain('Still working');   // T+27s
    expect(progressMessages[6].candidates[0].text).toContain('longer than expected'); // T+30s
  });

  it('handles fast operation (< 2s) without sending progress', async () => {
    const publishedMessages: InternalEventV2[] = [];
    const mockPublish = jest.fn(async (topic, event) => {
      publishedMessages.push(event);
    });

    const middleware = new FeedbackMiddleware(
      { getLogger: () => mockLogger, publish: mockPublish },
      { initialThresholdMs: 2000 }
    );

    const event = createTestEvent({ startedAt: Date.now() });

    // Start tracking
    await middleware.startTracking(event);

    // Complete after 1 second (before initial timer)
    jest.advanceTimersByTime(1000);
    middleware.completeOperation(event.correlationId);

    // Advance past initial threshold
    jest.advanceTimersByTime(5000);
    await flushPromises();

    // No progress messages sent
    expect(publishedMessages).toHaveLength(0);
  });
});
```

### 7.3 Agent-Dev Validation

**Manual testing in isolated environment**:

```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-progress-test" })

# 2. Deploy llm-bot with changes
bit deploy llm-bot --context agent-dev-progress-test

# 3. Trigger image generation (30+ second operation)
# Send message: "Generate an image of a cube made of cheese"

# 4. Monitor logs
fleet.logs({ bit: "llm-bot", context: "agent-dev-progress-test", follow: true })

# 5. Verify timing in Twitch chat:
# - T+0s:  Message received
# - T+2s:  "🤔 Thinking about your request..."
# - T+7s:  "⏳ Still working on it..."
# - T+12s: "⏳ Still working on it..."
# - T+30s: "⌛ This is taking longer than expected, please wait..."
# - T+40s: [Image URL]
# - T+40s: [LLM response]

# 6. Cleanup
agent_dev.destroy({ name: "agent-dev-progress-test", confirm: true })
```

**Success criteria**:
- Progress messages arrive BEFORE final response
- Timestamps show incremental delivery (T+2s, T+7s, T+12s, T+30s)
- No race conditions (progress never after final)

---

## 8. Migration Path

### 8.1 Option A: Breaking Change (Recommended)

**Timeline**: Single sprint

**Steps**:
1. Add `startTracking()` method
2. Integrate in all services with `operation_context` (currently: llm-bot only)
3. Replace `beforeNext()` with `completeOperation()` in base-server
4. Remove `beforeNext()` method entirely
5. Remove Case 2 & 3 logic from timer scheduling

**Pros**:
- Clean architecture immediately
- No deprecated code paths
- Simpler codebase

**Cons**:
- Breaking change for any custom services (unlikely, feedback middleware is new)
- No gradual rollout

**Risk assessment**: **LOW**
- FeedbackMiddleware introduced in Sprint 377 (recent)
- Only llm-bot uses `operation_context` annotations
- No known external/custom services using this feature

### 8.2 Option B: Graceful Deprecation

**Timeline**: Two sprints

**Sprint 1**:
1. Add `startTracking()` method
2. Integrate in llm-bot
3. Keep `beforeNext()` with deprecation warning
4. Track which method was called (avoid double-cleanup)

**Sprint 2** (after validation):
1. Remove `beforeNext()` method
2. Remove Case 2 & 3 logic
3. Simplify timer scheduling

**Pros**:
- Backward compatible
- Time to validate in production
- Easier rollback if issues

**Cons**:
- Two-sprint timeline
- Temporary complexity (dual code paths)
- Deprecation warnings in logs

**Risk assessment**: **VERY LOW**
- Zero breaking changes during transition
- More conservative approach

### 8.3 Recommendation: **Option A** (Breaking Change)

**Rationale**:
1. **Recent feature** (Sprint 377): Limited adoption, low risk
2. **Internal API**: FeedbackMiddleware not exposed to external services
3. **Single consumer**: Only llm-bot uses operation_context
4. **Better UX**: Users see improvement immediately
5. **Cleaner codebase**: No deprecated paths, simpler maintenance

**Mitigation**:
- Comprehensive testing before merge
- Agent-dev validation with real Twitch traffic
- Monitor staging for 24h before production deployment
- Rollback plan: Revert single commit (all changes in one PR)

---

## 9. Performance Considerations

### 9.1 Memory Footprint

**Current**: Operation state + 4 timers per tracked operation

```typescript
interface OperationState {
  // Fixed-size fields
  correlationId: string;           // ~36 bytes (UUID)
  startedAt: Date;                 // 8 bytes
  lastProgressAt?: Date;           // 8 bytes
  stage: ProgressStage;            // ~8 bytes
  originalMessage: string;         // Variable (typically < 500 bytes)

  // Timers
  initialTimer?: NodeJS.Timeout;   // ~64 bytes (native handle)
  updateTimer?: NodeJS.Timeout;    // ~64 bytes
  timeoutTimer?: NodeJS.Timeout;   // ~64 bytes
  maxLifetimeTimer?: NodeJS.Timeout; // ~64 bytes

  // Event reference
  sourceEvent: InternalEventV2;    // ~2-5 KB (full event)

  // Total per operation: ~3-6 KB
}
```

**Estimate**: ~5 KB per tracked operation

**Scaling**:
- 1 operation: 5 KB
- 10 concurrent operations: 50 KB
- 100 concurrent operations: 500 KB

**Max lifetime failsafe**: 5 minutes → Automatic cleanup prevents memory leaks

**Assessment**: **NEGLIGIBLE** impact (even 100 concurrent operations < 1 MB)

### 9.2 Timer Overhead

**Per operation**: 4 timers (initial, update interval, timeout, max lifetime)

**Node.js timer performance**:
- Timers implemented as min-heap (O(log n) insertion/deletion)
- Efficient for hundreds/thousands of timers
- No significant CPU overhead

**Comparison to existing platform**:
- Scheduler service: Manages cron-based timers per scheduled task
- IdempotencyMiddleware: Redis TTL-based expiration (external)
- FeedbackMiddleware: In-memory timers (lightweight)

**Assessment**: **NEGLIGIBLE** overhead for expected load (< 100 concurrent operations)

### 9.3 Network Impact

**Progress messages per operation**:
- Initial: 1 message (T+2s)
- Updates: N messages (every 5s until timeout)
- Timeout: 1 message (T+30s)

**Example: 40-second operation**:
- T+2s: Initial
- T+7s, T+12s, T+17s, T+22s, T+27s: 5 updates
- T+30s: Timeout
- **Total**: 7 progress messages

**Message size**: ~500 bytes (candidate + annotations)

**Network cost**: 7 messages × 500 bytes = **3.5 KB per operation**

**Comparison**:
- Final LLM response: ~5-50 KB (including candidates, reasoning)
- Image generation: ~500 KB (image URL + response)

**Assessment**: **NEGLIGIBLE** network impact (< 1% of total operation traffic)

### 9.4 Optimization: Early Termination

**Pattern**: Cancel update interval after timeout warning

```typescript
// After sending timeout warning at T+30s
if (state.updateTimer) {
  clearInterval(state.updateTimer);  // ✅ Stop sending "Still working" messages
  state.updateTimer = undefined;
}
```

**Benefit**: Reduces message spam for very long operations (> 30s)

**Tradeoff**: No updates between T+30s and completion (acceptable UX)

---

## 10. Failure Modes and Recovery

### 10.1 Failure Mode: Timers Fire After Operation Completes

**Scenario**: Race between timer callback and `completeOperation()`

**Example**:
```
T+29.9s: Operation completes, completeOperation() called
T+30.0s: Timeout timer fires (already cleared)
```

**Mitigation**:
```typescript
async sendTimedProgressMessage(state: OperationState, stage: ProgressStage): Promise<void> {
  // Check if operation still tracked (might have completed)
  if (!this.operationTracking.has(state.correlationId)) {
    this.logger.debug('Operation no longer tracked, skipping progress', {
      correlationId: state.correlationId,
      stage,
    });
    return;  // ✅ Graceful no-op
  }

  // Send progress...
}
```

**Result**: No-op, no error, no duplicate messages

### 10.2 Failure Mode: completeOperation() Never Called

**Scenario**: Service crashes, exception thrown before `next()`, etc.

**Example**:
```typescript
await processEvent(this, data, ...);  // Throws exception
await this.next(data);  // ❌ Never reached → completeOperation() not called
```

**Mitigation**: Max lifetime failsafe timer

```typescript
// Always scheduled, even if operation completes normally
state.maxLifetimeTimer = setTimeout(() => {
  this.logger.warn('Operation exceeded max lifetime, forcing cleanup', {
    correlationId: state.correlationId,
  });
  this.completeOperation(state.correlationId);  // ✅ Force cleanup
}, this.config.maxOperationLifetimeMs);  // Default: 5 minutes
```

**Result**: Automatic cleanup after 5 minutes, prevents memory leaks

### 10.3 Failure Mode: Redis Unavailable (Claim Check Failure)

**Scenario**: Progress message needs ingress/egress context from claim check, Redis down

**Impact**: Cannot retrieve source event context for routing

**Mitigation**: Source event stored in `OperationState`

```typescript
interface OperationState {
  sourceEvent: InternalEventV2;  // ✅ Stored at startTracking() time
}

// No dependency on external storage
const progressEvent = {
  ingress: state.sourceEvent.ingress,  // From in-memory state
  egress: state.sourceEvent.egress,
  identity: state.sourceEvent.identity,
};
```

**Result**: Progress messages work even if Redis unavailable (fail-open)

### 10.4 Failure Mode: Progress Message Publish Fails

**Scenario**: NATS unavailable, topic misconfigured, network partition

**Mitigation**: Try/catch in timer callbacks, don't throw

```typescript
state.initialTimer = setTimeout(async () => {
  try {
    await this.sendTimedProgressMessage(state, 'initial');
  } catch (err) {
    this.logger.error('Failed to send initial progress', {
      correlationId: state.correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    // ✅ Don't throw → timer continues, next callback will retry
  }
}, this.config.initialThresholdMs);
```

**Result**: Failure logged, operation continues, final response still delivered

### 10.5 Failure Mode: Service Restart During Operation

**Scenario**: Service restarts while operation in progress (Kubernetes rolling update, crash)

**Impact**:
1. In-flight operations lost (no persistence)
2. Timers cleared (process termination)
3. User sees no progress messages

**Mitigation**: Graceful shutdown

```typescript
// src/apps/llm-bot-service.ts
async shutdown(): Promise<void> {
  const feedbackMiddleware = this.getResource<FeedbackMiddleware>('feedbackMiddleware');
  if (feedbackMiddleware) {
    feedbackMiddleware.shutdown();  // ✅ Clear all timers, log active operations
  }

  await super.shutdown();
}
```

**Tradeoff**: Progress tracking is ephemeral (by design, not persisted)

**Acceptable**: Operations typically < 5 minutes, restarts infrequent

---

## 11. Success Criteria

### 11.1 Functional Requirements

| Requirement | Validation Method | Pass Criteria |
|-------------|-------------------|---------------|
| Progress messages arrive DURING operations | Agent-dev testing | T+2s, T+7s, T+12s, T+30s < T(final) |
| No progress for fast operations (< 2s) | Unit tests | 0 progress messages sent |
| Timeout warning at 30s threshold | Integration tests | Message at T+30s ± 100ms |
| Message ordering preserved | Agent-dev testing | Progress → Final (never reversed) |
| No race conditions | Integration tests | 100% deterministic ordering |
| Timers cleared on completion | Unit tests | getStats().activeOperations === 0 |
| Memory leaks prevented | Unit tests | Max lifetime cleanup verified |

### 11.2 Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Memory per operation | < 10 KB | Unit test memory profiling |
| Timer overhead | < 1% CPU | Benchmark 100 concurrent ops |
| Progress message latency | < 100ms from timer fire | Integration tests |
| Network overhead | < 5 KB per operation | Message size validation |

### 11.3 Reliability Requirements

| Scenario | Expected Behavior | Validation |
|----------|------------------|------------|
| completeOperation() never called | Auto-cleanup after 5 min | Unit test with max lifetime timer |
| Redis unavailable | Progress messages use in-memory state | Integration test (mock Redis failure) |
| NATS unavailable | Error logged, operation continues | Integration test (mock publish failure) |
| Service restart | Graceful shutdown, timers cleared | Shutdown test |
| Multiple startTracking() calls | Idempotent (no duplicate timers) | Unit test |

### 11.4 User Experience Validation

**Staging deployment** (24-hour observation):

1. **Deploy to staging** with FeedbackMiddleware changes
2. **Monitor Twitch chat** for image generation requests
3. **Validate**:
   - Progress messages appear during generation (not after)
   - User feedback positive ("system feels responsive")
   - No complaints about message spam or delay
4. **Metrics**:
   - % operations with progress messages sent
   - Average time to first progress message
   - User engagement during long operations (replies, acknowledgment)

**Production deployment** (after staging validation):

1. Deploy to production
2. Monitor for 7 days
3. Collect feedback from active users
4. Track support tickets related to progress messaging

---

## 12. Documentation Updates

### 12.1 Code Documentation

**Files to update**:
- `src/common/middleware/feedback-middleware.ts` - JSDoc for new methods
- `src/apps/llm-bot-service.ts` - Inline comments explaining integration
- `src/common/base-server.ts` - Update comment at integration point

**Example JSDoc**:
```typescript
/**
 * Start tracking an operation immediately when it begins.
 *
 * **When to call**: Immediately after adding operation_context annotation, BEFORE processing.
 *
 * **Effect**: Schedules all progress timers (initial, update, timeout, max lifetime).
 *
 * **Idempotency**: Multiple calls for same correlationId are ignored.
 *
 * **Fail-open**: Errors logged but don't throw (progress failures don't block operations).
 *
 * @example
 * ```typescript
 * // In service after adding operation_context annotation
 * data.annotations.push(operationContextAnnotation);
 *
 * const feedbackMiddleware = this.getResource<FeedbackMiddleware>('feedbackMiddleware');
 * if (feedbackMiddleware) {
 *   await feedbackMiddleware.startTracking(data);
 * }
 *
 * // Now process event (timers already running)
 * await processEvent(this, data);
 * ```
 *
 * @param event - Event with operation_context annotation
 */
async startTracking(event: InternalEventV2): Promise<void>;
```

### 12.2 Architecture Documentation

**New document**: `documentation/concepts/feedback-middleware-lifecycle.md`

**Contents**:
- Overview of dual-phase lifecycle
- Integration guide for new services
- Timer scheduling details
- Failure modes and recovery
- Configuration options

**Update**: `documentation/concepts/platform-flow.md`
- Add feedback middleware to event lifecycle diagram
- Explain when progress messages are sent

### 12.3 CLAUDE.md Updates

**Add to "Common Development Patterns"**:

```markdown
### X. Implementing Long-Running Operation Feedback

**Pattern for services with operations > 2 seconds (LLM, image gen, batch processing).**

```typescript
// 1. Add operation_context annotation
const operationContextAnnotation: AnnotationV1 = {
  kind: 'operation_context',
  value: JSON.stringify({
    operation: 'your_operation_name',
    startedAt: Date.now(),
    parameters: { /* operation params */ },
  }),
  source: this.name,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
};
data.annotations.push(operationContextAnnotation);

// 2. Start progress tracking BEFORE processing
const feedbackMiddleware = this.getResource<FeedbackMiddleware>('feedbackMiddleware');
if (feedbackMiddleware) {
  await feedbackMiddleware.startTracking(data);
}

// 3. Process event (timers running in background)
await yourLongRunningOperation(data);

// 4. Publish response (base-server automatically calls completeOperation)
await this.next(data);
```

**Automatic progress messages**:
- T+2s: "🤔 Thinking about your request..."
- T+7s, T+12s, ...: "⏳ Still working on it..."
- T+30s: "⌛ This is taking longer than expected, please wait..."
```

---

## 13. Rollback Plan

### 13.1 Indicators for Rollback

**Trigger rollback if**:

| Symptom | Severity | Action |
|---------|----------|--------|
| Progress messages still arrive after final response | HIGH | Immediate rollback |
| Service crashes/restarts frequently | CRITICAL | Immediate rollback |
| Memory leaks detected (heap growth) | HIGH | Rollback within 1 hour |
| Excessive progress message spam (> 10/op) | MEDIUM | Investigate, rollback if unfixable |
| User complaints about message timing | LOW | Monitor, investigate before rollback |

### 13.2 Rollback Procedure

**Git-based rollback** (single commit):

```bash
# 1. Identify deploy commit
git log --oneline -5

# 2. Revert commit
git revert <commit-hash> --no-edit

# 3. Push revert
git push origin main

# 4. Deploy reverted version
bit deploy llm-bot --all-contexts

# 5. Monitor logs for stability
fleet.logs({ bit: "llm-bot", context: "staging" })
```

**Expected outcome**: Progress messages revert to Sprint 35 behavior (suppressed if detected late)

### 13.3 Post-Rollback Analysis

1. **Review logs** from failed deployment
2. **Identify root cause** (timing issue, memory leak, logic error)
3. **Fix in feature branch** (don't merge to main)
4. **Re-test in agent-dev** (extended validation)
5. **Redeploy when confident** (with additional monitoring)

---

## 14. Summary and Recommendations

### 14.1 Architectural Decision

**Recommendation**: Implement **dual-phase lifecycle** with `startTracking()` + `completeOperation()`

**Justification**:
1. **Semantic correctness**: Tracking begins when operation begins (not when it ends)
2. **Simplicity**: No reactive compensation logic, predictable timer behavior
3. **Reliability**: Fail-open design, automatic cleanup, idempotent operations
4. **Performance**: Negligible overhead (< 1% CPU, < 1 MB memory for 100 concurrent ops)
5. **UX improvement**: Progress messages arrive during operations, better user experience

### 14.2 Migration Strategy

**Recommendation**: **Option A** (Breaking change in single sprint)

**Justification**:
1. Low risk (recent feature, single consumer)
2. Cleaner codebase (no deprecated paths)
3. Faster delivery (one sprint vs two)
4. Easier testing (single code path)

### 14.3 Implementation Sequence

**Recommended order**:

1. ✅ **Phase 1**: Add `startTracking()` method with timer scheduling
2. ✅ **Phase 2**: Add `completeOperation()` method (cleanup)
3. ✅ **Phase 3**: Integrate in `llm-bot-service.ts` (call `startTracking()`)
4. ✅ **Phase 4**: Update `base-server.ts` (call `completeOperation()`)
5. ✅ **Phase 5**: Remove deprecated `beforeNext()` method
6. ✅ **Phase 6**: Remove Case 2 & 3 logic from timer scheduling
7. ✅ **Phase 7**: Update tests (unit + integration)
8. ✅ **Phase 8**: Validate in agent-dev (manual testing)
9. ✅ **Phase 9**: Deploy to staging, monitor 24h
10. ✅ **Phase 10**: Deploy to production

### 14.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Progress messages still arrive late | LOW | HIGH | Comprehensive testing, agent-dev validation |
| Memory leaks from timer failures | LOW | MEDIUM | Max lifetime failsafe, shutdown cleanup |
| Service crashes from middleware errors | VERY LOW | CRITICAL | Fail-open design, try/catch everywhere |
| Breaking changes affect custom services | VERY LOW | LOW | Only llm-bot uses feature, good test coverage |
| Performance degradation | VERY LOW | MEDIUM | Benchmarking, memory profiling |

**Overall risk**: **LOW** (well-tested, fail-open design, isolated feature)

### 14.5 Success Metrics

**Target outcomes**:
- ✅ 100% of progress messages arrive BEFORE final response (no race conditions)
- ✅ 0% increase in service error rate
- ✅ < 1% increase in memory usage
- ✅ < 1% increase in CPU usage
- ✅ Positive user feedback ("system feels more responsive")

**Measurement**:
- Agent-dev testing: Manual validation of timing
- Staging monitoring: 24h observation of Twitch chat
- Production metrics: Error rate, memory, CPU over 7 days
- User feedback: Support tickets, chat sentiment analysis

---

## 15. Next Steps

### 15.1 Immediate Actions

1. **Review this architecture document** with team/stakeholders
2. **Get approval** for breaking change approach (Option A)
3. **Create implementation plan** (detailed task breakdown)
4. **Set up test infrastructure** (agent-dev context, test fixtures)

### 15.2 Implementation Sprint

**Sprint goal**: Implement dual-phase lifecycle and validate in agent-dev

**Deliverables**:
- [ ] `startTracking()` method implemented
- [ ] `completeOperation()` method implemented
- [ ] `llm-bot` integration complete
- [ ] `base-server` integration updated
- [ ] Unit tests passing (100% coverage on new methods)
- [ ] Integration tests passing
- [ ] Agent-dev validation successful
- [ ] Documentation updated

**Estimated effort**: 3-5 days (including testing + validation)

### 15.3 Follow-up Sprints

**Sprint +1**: Staging deployment and monitoring
- Deploy to staging
- Monitor for 24 hours
- Collect metrics and user feedback
- Address any issues discovered

**Sprint +2**: Production deployment
- Deploy to production
- Monitor for 7 days
- Validate success criteria
- Consider LLM-based messages (Phase 2, Sprint 377 original plan)

---

## Appendix A: File Change Summary

### Core Implementation

| File | Lines Changed | Type | Description |
|------|--------------|------|-------------|
| `src/common/middleware/feedback-middleware.ts` | +80, -50 | Modified | Add `startTracking()`, refactor timer logic, deprecate `beforeNext()` |
| `src/apps/llm-bot-service.ts` | +8 | Modified | Call `startTracking()` after annotation |
| `src/common/base-server.ts` | +1, -1 | Modified | Change `beforeNext()` → `completeOperation()` |

### Testing

| File | Lines Changed | Type | Description |
|------|--------------|------|-------------|
| `src/common/middleware/feedback-middleware.test.ts` | +200 | Modified | Add tests for dual-phase lifecycle |
| `src/common/middleware/feedback-middleware.integration.test.ts` | +100 | Modified | End-to-end timing validation |

### Documentation

| File | Lines Changed | Type | Description |
|------|--------------|------|-------------|
| `documentation/concepts/feedback-middleware-lifecycle.md` | +150 | New | Lifecycle guide |
| `CLAUDE.md` | +30 | Modified | Add development pattern |

**Total**: ~470 lines changed across 7 files

---

## Appendix B: Configuration Reference

### Default Configuration

```typescript
const DEFAULT_CONFIG: Required<FeedbackMiddlewareConfig> = {
  initialThresholdMs: 2000,       // 2 seconds - send first progress
  updateIntervalMs: 5000,         // 5 seconds - repeat progress updates
  timeoutThresholdMs: 30000,      // 30 seconds - timeout warning
  maxOperationLifetimeMs: 300000, // 5 minutes - force cleanup (failsafe)
  enabled: true,                  // Feature flag
  useCustomMessages: false,       // Phase 1: templates, Phase 2: LLM
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
};
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEEDBACK_MIDDLEWARE_ENABLED` | `true` | Enable/disable progress feedback |
| `FEEDBACK_INITIAL_THRESHOLD_MS` | `2000` | Initial progress delay |
| `FEEDBACK_UPDATE_INTERVAL_MS` | `5000` | Update interval |
| `FEEDBACK_TIMEOUT_THRESHOLD_MS` | `30000` | Timeout warning threshold |
| `FEEDBACK_MAX_LIFETIME_MS` | `300000` | Max operation lifetime |

### Per-Service Overrides

```yaml
# architecture.yaml
services:
  llm-bot:
    env:
      - FEEDBACK_MIDDLEWARE_ENABLED=true
      - FEEDBACK_INITIAL_THRESHOLD_MS=2000
      - FEEDBACK_TIMEOUT_THRESHOLD_MS=30000

  tool-gateway:
    env:
      - FEEDBACK_MIDDLEWARE_ENABLED=true
      - FEEDBACK_INITIAL_THRESHOLD_MS=5000  # Longer initial delay
      - FEEDBACK_TIMEOUT_THRESHOLD_MS=60000 # 1 minute timeout
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Annotation** | Metadata attached to events (e.g., `operation_context`) |
| **Dual-phase lifecycle** | Start tracking → Complete tracking (acquire/release pattern) |
| **Fail-open** | System continues operating gracefully on component failure |
| **Idempotent** | Multiple identical calls have same effect as single call |
| **Late detection** | Middleware detects operation after it started (reactive) |
| **Max lifetime failsafe** | Timer that forces cleanup to prevent memory leaks |
| **Progress stage** | Phase of operation: initial, update, timeout, completion |
| **Proactive tracking** | Middleware starts timers when operation begins (not when it ends) |
| **Routing slip** | Ordered list of services that will process an event |
| **Template message** | Pre-written progress message (vs LLM-generated) |

---

**End of Technical Architecture Document**

**Status**: DRAFT FOR REVIEW
**Next**: Approval → Implementation Planning → Development
**Questions**: See Section 15 (Next Steps)
