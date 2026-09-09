# Progress Messages Root Cause Analysis

**Sprint:** sprint-21-o1ihsj
**Date:** 2026-08-21
**Issue:** Progress messages not appearing despite `PROGRESS_ENABLED=true` and `PROGRESS_INITIAL_THRESHOLD_MS=1000`

---

## Critical Bug Identified ❌

### THE PROBLEM: Timing Starts Too Late

**Root Cause:** The FeedbackMiddleware starts its timer when the operation calls `next()`, NOT when the operation starts processing.

### Current Flow (BROKEN)

```
Time 0ms: llm-bot receives event
          └─> Adds operation_context annotation with startedAt: Date.now()

Time 0-3000ms: llm-bot processes event (LLM call takes 3 seconds)

Time 3000ms: llm-bot calls next(event)
             └─> FeedbackMiddleware.beforeNext() called
                 └─> getOrCreateState() called
                     └─> state.startedAt = new Date()  ← TIMER STARTS HERE!
                     └─> elapsedMs = 0ms (just started tracking!)
                     └─> 0ms < 1000ms threshold → NO PROGRESS MESSAGE

Time 3000ms: Event continues to next service
```

**Result:** No progress message is ever sent because the middleware thinks the operation just started!

### Why This Happens

**Code Location:** `src/common/middleware/feedback-middleware.ts:271`

```typescript
const state: OperationState = {
  correlationId: event.correlationId,
  startedAt: new Date(),  // ← BUG: Starts timer when state is created
  stage: 'initial',
  operationContext,
  originalMessage: event.message?.text || '',
};
```

**The middleware IGNORES the `startedAt` value in the `operation_context` annotation!**

llm-bot provides the correct start time:
```typescript
// src/apps/llm-bot-service.ts:204
{
  operation: 'llm_request',
  startedAt: Date.now(),  // ← Correct timestamp when event was received
}
```

But the middleware creates its own timestamp instead of using this value.

---

## Why Configuration Didn't Help

Setting `PROGRESS_INITIAL_THRESHOLD_MS=1000` didn't fix the issue because:

1. **Threshold is checked correctly** ✅
2. **But elapsed time is calculated incorrectly** ❌

Even if an operation takes 10 seconds:
- llm-bot processes for 10 seconds
- llm-bot calls `next()` at 10s
- FeedbackMiddleware starts timer at 10s
- Elapsed time = 0ms
- 0ms < 1000ms → No progress message

---

## The Fix

### Option 1: Use `startedAt` from Annotation (RECOMMENDED)

**Modify:** `src/common/middleware/feedback-middleware.ts:260-285`

```typescript
private getOrCreateState(
  event: InternalEventV2,
  operationContext: Record<string, any>
): OperationState {
  const existing = this.operationTracking.get(event.correlationId);
  if (existing) {
    return existing;
  }

  // Extract startedAt from operation_context annotation
  let startedAt: Date;
  if (operationContext.startedAt) {
    // If startedAt is a number (milliseconds), convert to Date
    if (typeof operationContext.startedAt === 'number') {
      startedAt = new Date(operationContext.startedAt);
    }
    // If startedAt is an ISO string, parse it
    else if (typeof operationContext.startedAt === 'string') {
      startedAt = new Date(operationContext.startedAt);
    }
    // Fallback to current time
    else {
      startedAt = new Date();
    }
  } else {
    // No startedAt in annotation, use current time
    startedAt = new Date();
  }

  const state: OperationState = {
    correlationId: event.correlationId,
    startedAt,  // ← Use extracted timestamp
    stage: 'initial',
    operationContext,
    originalMessage: event.message?.text || '',
  };

  this.operationTracking.set(event.correlationId, state);

  this.logger.debug('Operation tracking started', {
    correlationId: event.correlationId,
    operation: operationContext.operation,
    startedAt: startedAt.toISOString(),
    startedAtSource: operationContext.startedAt ? 'annotation' : 'current_time',
  });

  return state;
}
```

**Why This Works:**
- ✅ Uses the ACTUAL start time from when llm-bot received the event
- ✅ Handles both number (milliseconds) and string (ISO) formats
- ✅ Falls back gracefully if no startedAt in annotation
- ✅ Logs the source of the timestamp for debugging

### Option 2: Track on Event Ingress (ALTERNATIVE)

Instead of relying on services to add `operation_context`, track ALL events from the moment they enter the system.

**Pros:**
- Works for all services automatically
- No need for services to add annotations

**Cons:**
- More memory overhead (tracks all events)
- Harder to determine which operations are "long-running"
- Would require refactoring

---

## Verification Plan

### 1. Apply the Fix

Modify `feedback-middleware.ts` as shown above.

### 2. Test Locally

Create a test that simulates the real scenario:

```typescript
// Test: Progress message appears for operation that takes 3s
const event = createMockEvent();

// Add operation_context with startedAt 3 seconds ago
event.annotations.push({
  kind: 'operation_context',
  value: JSON.stringify({
    operation: 'llm_request',
    startedAt: Date.now() - 3000,  // 3 seconds ago
  }),
  source: 'llm-bot',
  id: randomUUID(),
  createdAt: new Date().toISOString(),
});

// Middleware should detect 3000ms elapsed
await middleware.beforeNext(event);

// Verify progress message was sent
expect(publishedEvents).toHaveLength(1);
expect(publishedEvents[0].topic).toBe('internal.egress.v1');
```

### 3. Deploy to Agent-Dev

```bash
# Provision agent-dev
agent_dev.provision({ name: "agent-dev-progress-fix" })

# Deploy llm-bot with fix
bit deploy llm-bot --context agent-dev-progress-fix

# Test with real LLM call
# Send a message that will take >1s to process
# Observe logs for progress message
```

### 4. Verify in Staging

Once confirmed in agent-dev:
- Deploy to staging
- Monitor logs for `FeedbackMiddleware` entries
- Verify progress messages appear for slow operations
- Check timing accuracy

---

## Expected Behavior After Fix

### Scenario: LLM Request Takes 3 Seconds

```
Time 0ms: llm-bot receives event
          └─> Adds operation_context: { startedAt: Date.now() }  // T=0

Time 0-3000ms: llm-bot processes event (LLM call)

Time 3000ms: llm-bot calls next(event)
             └─> FeedbackMiddleware.beforeNext() called
                 └─> getOrCreateState() extracts startedAt from annotation
                     └─> startedAt = new Date(0)  // T=0
                     └─> elapsedMs = 3000ms - 0ms = 3000ms
                     └─> 3000ms > 1000ms threshold → SEND PROGRESS MESSAGE ✅

Time 3000ms: Progress message sent to user
             "🤔 Thinking about your request..."
```

### Expected Logs

```
[DEBUG] llm_bot.operation_context.added { operation: 'llm_request', startedAt: 1724256000000 }
[DEBUG] FeedbackMiddleware.beforeNext called { correlationId: 'abc123', enabled: true }
[DEBUG] Operation tracking started {
  correlationId: 'abc123',
  operation: 'llm_request',
  startedAt: '2026-08-21T12:00:00.000Z',
  startedAtSource: 'annotation'
}
[INFO] Sending template progress message {
  correlationId: 'abc123',
  stage: 'initial',
  elapsedMs: 3000,
  message: '🤔 Thinking about your request...'
}
```

---

## Why Unit Tests Didn't Catch This

The unit tests in `feedback-middleware.test.ts` create events with `operation_context` but **mock the elapsed time** by manipulating timestamps on the event object itself.

**Example from tests:**

```typescript
// Test creates event with timestamp 3 seconds ago
const event = createMockEvent();
event.timestamp = new Date(Date.now() - 3000).toISOString();
```

But in the real system:
- Event timestamp is when the event was CREATED (e.g., when user sent message)
- Operation startedAt is when the SERVICE started processing
- These are NOT the same!

**The bug was hidden because:**
1. Tests mocked timestamps to simulate elapsed time
2. Tests didn't actually create state and measure elapsed time correctly
3. Integration tests used mock publish functions, not real timing

---

## Additional Findings

### Finding 1: Multiple `next()` Calls Create Multiple Timers

If an event goes through multiple services:
1. Event → llm-bot → next() → (middleware starts timer T1)
2. Event → query-analyzer → next() → (middleware starts timer T2)
3. Event → image-gen → next() → (middleware starts timer T3)

Each service that calls `next()` will trigger the middleware, and since the state is keyed by `correlationId`, it's shared across all services.

**Problem:** The timer gets reset on each `next()` call!

**Fix:** The middleware should check `existing` state first (line 264), which it does, so this is actually OK. The bug is only in the initial state creation.

### Finding 2: `operation_context` Annotation Format Inconsistency

llm-bot uses:
```typescript
{
  operation: 'llm_request',
  startedAt: Date.now(),  // Number
}
```

But other services might use different formats. The fix should handle multiple formats.

---

## Impact Assessment

### Severity: **HIGH**

**User Impact:**
- Users get NO feedback during slow operations
- Perceived system unresponsiveness
- Poor UX for 10-30s operations (image generation, complex queries)

**Business Impact:**
- Feature is completely non-functional
- Configuration changes have no effect
- Staging deployment wasted effort

### Scope: **ALL SERVICES**

Any service that calls `next()` after a long operation will have this issue:
- llm-bot (LLM processing)
- image-gen-mcp (image generation)
- Any future long-running services

---

## Testing Strategy

### Unit Tests (Add Missing Coverage)

Add test cases for:
1. ✅ Annotation with `startedAt` as number (milliseconds)
2. ✅ Annotation with `startedAt` as ISO string
3. ✅ Annotation without `startedAt` (fallback)
4. ✅ Progress message sent when elapsed time > threshold
5. ✅ No progress message when elapsed time < threshold

### Integration Tests

Create end-to-end test:
1. Send event to llm-bot
2. Mock LLM call to take 3 seconds
3. Verify progress message appears after 1 second
4. Verify final response after 3 seconds

### Manual Testing (Agent-Dev)

1. Deploy fixed version to agent-dev
2. Send chat message that triggers LLM call
3. Observe progress message appears within 1-2 seconds
4. Verify final response appears after LLM completes

---

## Next Steps

### Immediate (This Sprint)

1. ✅ Document root cause (this document)
2. ⏳ Apply fix to `feedback-middleware.ts`
3. ⏳ Add unit tests for annotation extraction
4. ⏳ Test in agent-dev environment
5. ⏳ Deploy to staging if validated

### Follow-Up (Future Sprint)

1. Add integration tests with real timing
2. Add monitoring/metrics for progress message delivery
3. Consider adding `operation_duration_estimate` to annotations
4. Review other services that should add `operation_context`

---

**End of Root Cause Analysis**
