# Progress Middleware Architectural Issue

**Sprint 35 Analysis - Prepared for Next Sprint**
**Date**: 2026-08-31
**Correlation ID Reference**: `254c7245-b14b-4eb9-ae21-e4581056d7b1` (staging)

## Problem Observed

Progress messages arrive **after** or **with** the final response instead of **during** long-running operations.

**Example from Twitch (staging):**
```
Moderatorbitbrat_the_ai: Behold: the most perfectly square cheese geometry can legally tolerate.
Moderatorbitbrat_the_ai: https://storage.googleapis.com/bitbrat-media-gen/50eedfb5-bc0d-4c22-ad50-eedf5ab90ba4.png
Moderatorbitbrat_the_ai: ⌛ This is taking longer than expected, please wait...
Moderatorbitbrat_the_ai: A dairy monolith. Humanity's greatest cube-based achievement, somehow.
```

The progress message ("⌛ This is taking longer than expected...") arrived **between** the two final response messages instead of 30 seconds into the operation.

## Root Cause: Middleware Invoked at Wrong Time

### Current (Broken) Architecture

```
Timeline for Event 254c7245-b14b-4eb9-ae21-e4581056d7b1:

20:00:25.867 - llm-bot receives message
20:00:25.870 - operation_context annotation added (startedAt recorded)
20:00:25.870 - processEvent() begins (LLM generation + image tool call)
              ⏱️  Timers SHOULD start here - BUT DON'T!
  ... 41 seconds of processing ...
20:01:07.308 - processEvent() completes
20:01:07.311 - await this.next(event) called
20:01:07.311 - FeedbackMiddleware.beforeNext() invoked ❌ FIRST TIME MIDDLEWARE SEES IT!
20:01:07.312 - Middleware sees 41s elapsed, tries to send progress (too late)
20:01:07.316 - Progress message published
20:01:07.323 - Final response published
20:01:10.940 - Both arrive at Twitch in unpredictable order
```

### Why This Happens

**Integration Point**: `FeedbackMiddleware.beforeNext()` is called from `base-server.ts:1014`:

```typescript
async next(event: InternalEventV2): Promise<void> {
  // ... routing logic ...

  // Sprint 377: Check for long-running operations
  if (this.feedbackMiddleware) {
    await this.feedbackMiddleware.beforeNext(event);  // ❌ Called at END of processing
  }

  // Publish response to next topic/egress
  await this.publish(...);
}
```

**The Problem**: `beforeNext()` is called when the operation is **completing**, not when it **starts**. The middleware only sees the operation when it's already done.

## Sprint 35 Changes (Symptom Suppression)

Sprint 35 added timer-based tracking with case logic:

- **Case 1** (< 2s elapsed): Schedule timers normally
- **Case 2** (2-30s elapsed): Send immediate update via `setImmediate()`
- **Case 3** (> 30s elapsed): Send immediate timeout via `setImmediate()`

**My fix in commit `0cea97c2`** changed Cases 2 & 3 to skip sending messages:

```typescript
} else if (alreadyElapsedMs < this.config.timeoutThresholdMs) {
  // Case 2: Operation is now completing - DO NOT send progress message
  this.logger.debug('Operation detected in progress (now completing), skipping progress');
  // Skip sending any progress message - operation is finishing
}
```

**This suppresses the symptom** (late messages) but **doesn't fix the root cause** (middleware invoked at wrong time).

## Correct Architecture

The middleware needs **two integration points**:

### 1. Start Tracking (when operation begins)

**Where**: Immediately after `operation_context` annotation is added

```typescript
// src/apps/llm-bot-service.ts:214 (right after annotation added)
if (this.feedbackMiddleware && !isProgressEvent) {
  // 🟢 START TIMERS IMMEDIATELY
  await this.feedbackMiddleware.startTracking(data);
}

// Then begin processing
await processEvent(this, data, ...);
```

### 2. Complete Tracking (when operation ends)

**Where**: Before publishing response (existing location is fine)

```typescript
// src/common/base-server.ts:1014 (keep this call, rename method)
if (this.feedbackMiddleware) {
  // 🛑 STOP TIMERS AND CLEANUP
  this.feedbackMiddleware.completeOperation(event.correlationId);
}
```

### Expected Timeline (After Fix)

```
20:00:25.867 - llm-bot receives message
20:00:25.870 - operation_context annotation added
20:00:25.870 - feedbackMiddleware.startTracking(event) 🟢 TIMERS START
  ... 30 seconds pass ...
20:00:55.870 - ⏰ Timeout timer fires → Send "⌛ This is taking longer than expected..."
20:00:55.870 - Progress message published to egress
20:00:55.873 - Progress arrives at Twitch ✅
  ... 11 more seconds ...
20:01:07.308 - processEvent() completes
20:01:07.311 - feedbackMiddleware.completeOperation(correlationId) 🛑 TIMERS STOP
20:01:07.323 - Final response published
20:01:10.940 - Final response arrives at Twitch ✅
```

## Implementation Plan

### Phase 1: Add startTracking() Method

**File**: `src/common/middleware/feedback-middleware.ts`

```typescript
/**
 * Start tracking an operation immediately when it begins.
 *
 * Call this when operation_context annotation is added, BEFORE processing starts.
 *
 * @param event - Event with operation_context annotation
 */
async startTracking(event: InternalEventV2): Promise<void> {
  if (!this.config.enabled) {
    return;
  }

  const operationContext = this.extractOperationContext(event);
  if (!operationContext) {
    return;
  }

  // Create state and start timers
  const state = this.getOrCreateState(event, operationContext);

  // Store source event for routing context (needed for progress messages)
  state.sourceEvent = event;

  this.logger.debug('Operation tracking started proactively', {
    correlationId: event.correlationId,
    operation: operationContext.operation,
  });
}
```

### Phase 2: Deprecate beforeNext()

**Keep for backward compatibility**, but log deprecation warning:

```typescript
async beforeNext(event: InternalEventV2): Promise<void> {
  this.logger.warn('FeedbackMiddleware.beforeNext() called - deprecated', {
    correlationId: event.correlationId,
    message: 'Use startTracking() at operation start instead',
  });

  // Just complete tracking if it exists
  this.completeOperation(event.correlationId);
}
```

### Phase 3: Integrate in llm-bot

**File**: `src/apps/llm-bot-service.ts:214`

```typescript
// Sprint 377: Add operation_context annotation
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
    await feedbackMiddleware.startTracking(data);
  }
}

// Then process event (timers are now running)
await processEvent(this, data, ...);
```

### Phase 4: Update base-server Integration

**File**: `src/common/base-server.ts:1014`

Change from:
```typescript
await this.feedbackMiddleware.beforeNext(event);
```

To:
```typescript
this.feedbackMiddleware.completeOperation(event.correlationId);
```

### Phase 5: Remove Case 2 & Case 3 Logic

Once `startTracking()` is called at the correct time:

1. **Case 1** logic becomes the ONLY path (always fresh operations)
2. Remove Case 2 & 3 (late detection) entirely
3. Simplify `startTracking()` to just schedule timers without elapsed time checks

## Testing Considerations

### Unit Tests

1. Test `startTracking()` schedules timers correctly
2. Test timers fire at correct thresholds (2s, 5s, 30s)
3. Test `completeOperation()` clears all timers
4. Test no messages sent after `completeOperation()` called

### Integration Tests

1. Mock long-running operation (30+ seconds)
2. Verify progress message arrives **during** operation (not after)
3. Verify final response arrives **after** operation completes
4. Verify message ordering: progress → final response

### Agent-Dev Validation

Deploy to agent-dev and test with actual image generation:

```bash
agent_dev.provision({ name: "agent-dev-progress-fix-test" })
bit deploy llm-bot --context agent-dev-progress-fix-test

# Send image generation request
# Verify progress arrives at ~30s mark
# Verify final response arrives after completion
```

## Files to Modify

### Core Changes
- `src/common/middleware/feedback-middleware.ts` - Add `startTracking()` method
- `src/common/middleware/feedback-middleware.test.ts` - Add tests for new flow
- `src/apps/llm-bot-service.ts:214` - Call `startTracking()` after annotation
- `src/common/base-server.ts:1014` - Change to `completeOperation()`

### Cleanup (Optional)
- Remove Case 2 & 3 logic once startTracking() working
- Remove `beforeNext()` method (breaking change - consider deprecation cycle)

## Migration Path

### Option A: Breaking Change (Recommended)

1. Add `startTracking()` method
2. Update all services that add `operation_context` to call `startTracking()`
3. Remove `beforeNext()` entirely
4. Update base-server to call `completeOperation()` directly

**Pro**: Clean architecture
**Con**: Breaking change for any custom services

### Option B: Graceful Deprecation

1. Add `startTracking()` method
2. Keep `beforeNext()` with deprecation warning
3. Auto-detect which method was called (track in operation state)
4. Remove `beforeNext()` in next major version

**Pro**: Backward compatible
**Con**: Temporary complexity

## References

- **Staging Event**: `254c7245-b14b-4eb9-ae21-e4581056d7b1`
- **Sprint 35 Commit**: `0cea97c2` (symptom suppression)
- **Original Issue**: Progress messages arrive after/with final response
- **Sprint 377**: Original long-running task feedback implementation

## Questions for Next Sprint

1. Should we do breaking change (Option A) or graceful deprecation (Option B)?
2. Which other services add `operation_context` annotations? (Need to update all)
3. Should `startTracking()` be automatic (via base-server hook) or explicit (each service)?
4. Do we want different thresholds for different operation types?

## Success Criteria

✅ Progress messages arrive **during** operations (not after)
✅ Message ordering preserved: progress → final response
✅ No race conditions between progress and final messages
✅ All existing tests pass
✅ Agent-dev validation with image generation succeeds
