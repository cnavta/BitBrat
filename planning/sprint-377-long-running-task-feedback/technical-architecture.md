# Sprint 377: Long-Running Task Feedback - Technical Architecture

**Sprint ID:** 377
**Title:** Long-Running Task Feedback System
**Author:** Architecture Team
**Date:** 2026-07-31
**Status:** DRAFT - Awaiting Approval

---

## Executive Summary

BitBrat currently provides **zero user feedback** during long-running operations (LLM calls: 2-10s, image generation: 10-30s). Users experience **radio silence** with only post-completion delivery, creating a poor UX and perceived unresponsiveness.

This sprint introduces a **Progressive Feedback System** that:
- **Detects** long-running operations (threshold-based or service-annotated)
- **Sends intermediate progress messages** during processing
- **Adapts to platform capabilities** (typing indicators, message editing, sequential messages)
- **Degrades gracefully** on limited platforms (Twitch IRC, Twilio SMS)
- **Preserves existing architecture** (reuses InternalEventV2 and routing pipeline)

**Key Innovation:** A **Feedback Middleware** layer that intercepts `next()` calls and publishes standard `InternalEventV2` events with `type: 'chat.progress.v1'` to generate contextual progress messages through the existing LLM pipeline.

---

## 1. Problem Statement

### 1.1. Current State

**Image Generation (10-30s):**
```
User: !image a sunset over mountains
[10-30 seconds of complete silence]
Bot: Image generated! https://storage.googleapis.com/...
```

**LLM with Multi-Tool Execution (5-15s):**
```
User: What's the weather in Paris and London?
[8 seconds pass - bot calls weather API twice, invisible to user]
Bot: Paris is 22°C and sunny. London is 18°C and cloudy.
```

**Timeout Failures (>75s):**
```
User: !image a very complex scene with many intricate details
[75 seconds pass]
Bot: Failed to generate image: The operation was aborted
```

### 1.2. Pain Points

| Issue | Impact | Frequency | User Experience |
|-------|--------|-----------|-----------------|
| **Silent processing** | HIGH | Every LLM/image request | User doesn't know if request succeeded |
| **No cancellation** | MEDIUM | When user changes mind | Can't abort expensive operations |
| **Cryptic timeouts** | HIGH | ~5% of image gen requests | "AbortError" instead of friendly message |
| **Tool execution opacity** | HIGH | Multi-tool LLM calls | User sees single response, not intermediate steps |
| **No streaming** | MEDIUM | Long LLM responses | Response appears all at once (no progressive reveal) |

### 1.3. User Feedback (Qualitative)

> "I thought the bot was broken because it didn't respond for like 30 seconds"
> — Twitch user after !image request

> "It would be nice to know the bot is actually doing something instead of just waiting"
> — Discord user during LLM tool execution

---

## 2. Requirements

### 2.1. Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| **FR-1** | Detect long-running operations (>2s) | MUST | Automatic detection prevents service changes |
| **FR-2** | Send progress updates during processing | MUST | Core UX improvement |
| **FR-3** | Support platform-specific feedback (typing, editing) | MUST | Leverage native platform features |
| **FR-4** | Gracefully degrade on limited platforms | MUST | Twitch/Twilio don't support typing indicators |
| **FR-5** | Allow user opt-out via preference | SHOULD | Respect user preferences |
| **FR-6** | Provide timeout transparency | MUST | User-friendly timeout messages |
| **FR-7** | Support cancellation (future sprint) | NICE | User-initiated abort |

### 2.2. Non-Functional Requirements

| ID | Requirement | Target | Measurement |
|----|-------------|--------|-------------|
| **NFR-1** | Progress message latency | <500ms | Time from operation start to first feedback |
| **NFR-2** | Zero service code changes | 100% | Services shouldn't need modifications (except opt-in annotation) |
| **NFR-3** | Platform rate limit compliance | 100% | Respect Twitch (20msg/30s), Slack (50req/min) |
| **NFR-4** | Backward compatibility | 100% | Existing flows work without feedback enabled |
| **NFR-5** | Failure isolation | 100% | Feedback failures don't block primary operations |

### 2.3. Platform-Specific Capabilities

| Platform | Typing Indicator | Message Editing | Rich Formatting | Thread Support | Rate Limits |
|----------|-----------------|-----------------|-----------------|----------------|-------------|
| **Slack** | ✅ Yes | ✅ Yes | ✅ Blocks | ✅ Yes | 50 req/min |
| **Discord** | ✅ Yes (10s) | ✅ Yes | ✅ Embeds | ✅ Yes | 5 req/s |
| **Twitch** | ❌ No | ❌ No | ❌ No | ❌ No | 20 msg/30s |
| **Twilio** | ❌ No | ❌ No | ❌ Plain text | ❌ No | 1 msg/s |

**Phase 1 Focus**: Template-based messages for all platforms (no editing, no typing indicators)
**Future Phases**: Platform-specific strategies (Slack editing, Discord embeds, etc.)

---

## 3. Solution Architecture

### 3.1. Core Concept

**Reuse Existing Pipeline**: Instead of creating new event types and operations, we publish standard `InternalEventV2` events with `type: 'chat.progress.v1'` that flow through the existing routing pipeline. Event-router rules detect this type and route to llm-bot for message generation.

**Key Principles**:
1. **No new event types**: Just `InternalEventV2` with `type: 'chat.progress.v1'`
2. **No new operations**: llm-bot processes this as a standard chat event with prompt annotation
3. **Annotations carry context**: Progress stage, operation details, original request all in annotations
4. **Event-router handles routing**: Standard JsonLogic rule detects type and routes to llm-bot
5. **User/channel/platform copied**: Progress events inherit targeting info from original event

---

### 3.2. Architecture Components

#### 3.2.1. Feedback Middleware

**Location**: `src/common/middleware/feedback-middleware.ts`

**Purpose**: Intercepts `Bit.next()` calls to detect long-running operations and publish progress events.

**Responsibilities**:
- Monitor time elapsed since event entered current service
- Detect when operation exceeds threshold (2s default, configurable via annotation)
- Publish `InternalEventV2` with `type: 'chat.progress.v1'` to `internal.ingress.v1`
- Track progress message state (initial sent, updates sent, completion sent)

**Integration**:
```typescript
// In Bit base class (src/common/base-server.ts)
export abstract class Bit {
  private feedbackMiddleware: FeedbackMiddleware;

  constructor(options: BitOptions) {
    // ... existing setup
    this.feedbackMiddleware = new FeedbackMiddleware({
      messageBus: this.messageBus,
      logger: this.logger,
      serviceName: this.name,
    });
  }

  protected async next(event: InternalEventV2): Promise<void> {
    // Before publishing to next step, check if feedback needed
    await this.feedbackMiddleware.beforeNext(event);

    // Existing next() logic
    await this.publishNext(event);
  }
}
```

**Threshold Detection**:
```typescript
class FeedbackMiddleware {
  async beforeNext(event: InternalEventV2): Promise<void> {
    // Check if progress feedback is enabled
    if (event.qos?.progress?.enabled === false) return;

    // Check if service annotated as long-running
    const expectsLongRunning = event.qos?.progress?.expectsLongRunning;

    // Calculate elapsed time
    const elapsedMs = Date.now() - new Date(event.timestamp).getTime();
    const threshold = this.getThreshold(event);

    // Determine stage
    const stage = this.determineStage(event, elapsedMs, threshold);

    if (stage) {
      await this.publishProgressEvent(event, stage, elapsedMs);
    }
  }

  private determineStage(
    event: InternalEventV2,
    elapsedMs: number,
    threshold: number
  ): 'initial' | 'update' | 'timeout' | null {
    const tracking = this.getTracking(event.correlationId);

    // Initial message (first time crossing threshold)
    if (elapsedMs >= threshold && !tracking.initialSent) {
      return 'initial';
    }

    // Update message (every 5s after initial)
    if (elapsedMs >= threshold + 5000 &&
        elapsedMs - tracking.lastUpdate >= 5000) {
      return 'update';
    }

    // Timeout message (approaching 75s limit)
    if (elapsedMs >= 60000 && !tracking.timeoutSent) {
      return 'timeout';
    }

    return null;
  }
}
```

#### 3.2.2. Derived Event Utility (Platform-Wide Pattern)

**New Utility**: `src/common/events/derived-event.ts`

Progress messages are a specific use case of a broader pattern: **derived events**. A derived event is a new event created from an existing event, preserving routing context and establishing correlation links.

**Why This Matters**:
- **Consistency**: All derived events follow the same pattern
- **Traceability**: `derived_from` annotation links to original event
- **Reusability**: Common logic for progress, errors, confirmations, timeouts
- **Maintainability**: One place to update derivation logic

**Core Function**:
```typescript
import { createDerivedEvent, createProgressEvent } from '../../common/events/derived-event';

// Generic derived event
const derivedEvent = createDerivedEvent(originalEvent, {
  type: 'chat.progress.v1',
  source: 'feedback-middleware',
  annotations: [
    { kind: 'progress_context', value: { ... }, ... },
    { kind: 'prompt', value: '...', ... },
  ],
});

// Convenience wrapper for progress events
const progressEvent = createProgressEvent(
  originalEvent,
  'initial',  // stage
  { operation: 'image_generation', parameters: { ... }, elapsedMs: 5000 },  // context
  'Generate brief progress message...',  // prompt
  'feedback-middleware'  // source
);
```

**What `createDerivedEvent()` Does**:
1. ✅ Generates new `correlationId`, `eventId`, `timestamp`
2. ✅ Copies routing context: `platform`, `channel`, `user`
3. ✅ Copies `message` from original (provides context for llm-bot)
4. ✅ Copies `qos` from original (unless overridden)
5. ✅ Adds `derived_from` annotation with correlation link
6. ✅ Sets `type` at root level (not in payload)
7. ✅ Sets `routing.stage` to `'initial'`
8. ✅ Includes custom annotations (progress_context, prompt, etc.)

**Traceability Helpers**:
```typescript
import {
  getOriginalCorrelationId,
  isDerivedEvent,
  getDerivationChain,
} from '../../common/events/derived-event';

// Extract original correlationId
const originalId = getOriginalCorrelationId(progressEvent);
// → 'abc123' (from original request)

// Check if event is derived
if (isDerivedEvent(event)) {
  logger.debug('Derived event', { originalId: getOriginalCorrelationId(event) });
}

// Get full derivation chain
const chain = getDerivationChain(progressEvent);
// → ['abc123', 'def456', 'ghi789']  // Original → Progress → Update
```

**Standard Derived Event Types**:
```typescript
import { DerivedEventTypes } from '../../common/events/derived-event';

DerivedEventTypes.PROGRESS;        // 'chat.progress.v1'
DerivedEventTypes.ERROR;           // 'chat.error.v1'
DerivedEventTypes.STATUS;          // 'chat.status.v1'
DerivedEventTypes.CONFIRM;         // 'chat.confirm.v1'
DerivedEventTypes.TIMEOUT_WARNING; // 'chat.timeout.v1'
DerivedEventTypes.CANCELLED;       // 'chat.cancelled.v1'
```

#### 3.2.3. Progress Event Structure

**Using Derived Event Utility**:

```typescript
import { createProgressEvent } from '../../common/events/derived-event';

// In feedback-middleware.ts
async publishProgressEvent(
  originalEvent: InternalEventV2,
  stage: 'initial' | 'update' | 'timeout',
  elapsedMs: number
): Promise<void> {
  // Extract operation context from original event annotations
  const operationContext = originalEvent.annotations?.find(
    (a) => a.kind === 'operation_context'
  )?.value as any;

  const progressEvent = createProgressEvent(
    originalEvent,
    stage,
    {
      operation: operationContext?.operation || 'unknown',
      parameters: operationContext?.parameters || {},
      startedAt: originalEvent.timestamp,
      elapsedMs,
    },
    this.buildPrompt(stage, operationContext?.operation),
    'feedback-middleware'
  );

  // Publish to internal.ingress.v1 (event-router will attach routing slip)
  await this.messageBus.publish('internal.ingress.v1', progressEvent);
}
```

**Resulting Event Structure**:

```typescript
// Result from createProgressEvent()
{
  // New identifiers
  correlationId: 'def456',  // New correlation ID for progress message
  eventId: 'xyz789',
  timestamp: '2026-07-31T12:05:00.000Z',

  // Type at root level (event-router matches on this)
  type: 'chat.progress.v1',

  // Routing context (copied from original)
  platform: 'slack',
  channel: { id: 'C123', name: 'general' },
  user: { id: 'U123', username: 'testuser' },

  // Message (copied from original, provides context for llm-bot)
  message: { text: '!image a sunset over mountains' },

  // QoS (copied from original)
  qos: {
    routingTimeoutMs: 75000,
    tracer: true,
    progress: {
      enabled: true,
      useCustomMessage: true,
    },
  },

  // Routing (starts at initial stage)
  routing: { stage: 'initial' },
  routingSlip: undefined,  // Event-router will attach

  // Annotations (derived_from + progress_context + prompt)
  annotations: [
    // 1. Correlation link (added automatically by createDerivedEvent)
    {
      kind: 'derived_from',
      value: {
        correlationId: 'abc123',  // Original event's correlationId
        eventId: 'original-456',
        timestamp: '2026-07-31T12:00:00.000Z',
        type: 'chat.message.v1',
        source: 'feedback-middleware',
        derivedAt: '2026-07-31T12:05:00.000Z',
      },
      source: 'feedback-middleware',
      id: 'annotation-123',
      createdAt: '2026-07-31T12:05:00.000Z',
    },

    // 2. Progress context (added by createProgressEvent)
    {
      kind: 'progress_context',
      value: {
        originalCorrelationId: 'abc123',
        originalMessage: '!image a sunset over mountains',
        stage: 'initial',
        operation: 'image_generation',
        parameters: {
          prompt: 'a sunset over mountains',
          aspectRatio: '16:9',
        },
        startedAt: '2026-07-31T12:00:00.000Z',
        elapsedMs: 5000,
      },
      source: 'feedback-middleware',
      id: 'annotation-456',
      createdAt: '2026-07-31T12:05:00.000Z',
    },

    // 3. Prompt for llm-bot (added by createProgressEvent)
    {
      kind: 'prompt',
      value: 'Generate a brief, encouraging message (max 100 chars) that the user\'s image is being created. Reference the image subject from the prompt. Use an emoji. Be concise and friendly.',
      source: 'feedback-middleware',
      id: 'annotation-789',
      createdAt: '2026-07-31T12:05:00.000Z',
    },

    // 4. Personality (added by event-router rule)
    {
      kind: 'personality',
      value: 'helpful',
      source: 'event-router',
      id: 'annotation-abc',
      createdAt: '2026-07-31T12:05:01.000Z',
    },
  ],
}
```

#### 3.2.4. QoS Extensions (Progress Preferences Only)

**Updated QOSV1 Interface**:

```typescript
/**
 * QoS extensions for progress feedback (Sprint 377)
 *
 * IMPORTANT: Only user preferences belong in QoS.
 * Implementation details (stage, operation, timing) belong in annotations.
 */
interface QOSV1 {
  // Existing fields
  routingTimeoutMs?: number;
  tracer?: boolean;

  // NEW: Progress feedback preferences
  progress?: {
    /**
     * Whether user wants progress feedback (opt-out mechanism).
     * Default: true
     */
    enabled?: boolean;

    /**
     * Whether to use LLM-generated contextual messages vs template messages.
     * - true: Publish chat.progress.v1 event, route through llm-bot
     * - false: Use hardcoded template messages
     * Default: true
     */
    useCustomMessage?: boolean;
  };
}
```

**Service Annotation (Opt-In)**:

Services that expect long-running operations can annotate events BEFORE calling `next()`:

```typescript
// In image-gen-mcp/index.ts
async generateImage(event: InternalEventV2): Promise<void> {
  // Annotate as long-running operation BEFORE processing
  event.annotations.push({
    kind: 'operation_context',
    value: {
      operation: 'image_generation',
      parameters: {
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio,
      },
      expectedDurationMs: 15000,  // Hint for feedback middleware
    },
    source: this.name,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  // Set QoS preference (optional - defaults to enabled)
  if (!event.qos) event.qos = {};
  event.qos.progress = {
    enabled: true,
    useCustomMessage: true,
  };

  // Start processing (feedback middleware watches elapsed time)
  const result = await this.performImageGeneration(args);

  // Add result annotation
  event.annotations.push({
    kind: 'image_result',
    value: { url: result.publicUrl },
    source: this.name,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  // Advance to next step (feedback middleware triggers here)
  await this.next(event);
}
```

#### 3.2.5. Event-Router Rule (Seed Data)

**New Routing Rule** to detect `chat.progress.v1` and route to llm-bot:

```json
{
  "id": "progress-message-generation",
  "command": "generate_progress_message",
  "description": "Route progress message requests through llm-bot for contextual message generation",
  "conditions": {
    "and": [
      { "==": [{ "var": "payload.type" }, "chat.progress.v1"] },
      { "==": [{ "var": "routing.stage" }, "initial"] }
    ]
  },
  "actions": {
    "attachRoutingSlip": {
      "steps": [
        {
          "service": "llm-bot",
          "operation": "chat",
          "timeout": 3000
        },
        {
          "service": "ingress-egress",
          "operation": "deliver"
        }
      ]
    },
    "addAnnotations": [
      {
        "kind": "personality",
        "value": "helpful",
        "source": "event-router"
      }
    ]
  },
  "priority": 100,
  "active": true
}
```

**Key Points**:
- Matches on `payload.type === 'chat.progress.v1'` and `routing.stage === 'initial'`
- Routes to `llm-bot` with standard `chat` operation (NO new operation needed)
- Optionally adds `personality` annotation
- Uses short timeout (3s) since progress messages need low latency

#### 3.2.6. LLM-Bot Processing (Zero Changes Needed)

**Existing llm-bot behavior** already handles this:

1. Receives `InternalEventV2` with `payload.type: 'chat.progress.v1'`
2. Finds `prompt` annotation (instructions on how to generate message)
3. Finds `progress_context` annotation (operation details, parameters, timing)
4. Generates message using existing LLM call logic
5. Sets `event.message.text` to generated message
6. Calls `next()` to advance to ingress-egress

**No code changes required** - llm-bot already processes events with prompt annotations.

**Example LLM Call**:
```typescript
// Existing llm-bot code (no changes)
const promptAnnotation = event.annotations.find(a => a.kind === 'prompt');
const contextAnnotation = event.annotations.find(a => a.kind === 'progress_context');

const systemPrompt = promptAnnotation?.value || 'Generate a helpful response.';
const userContext = JSON.stringify(contextAnnotation?.value || {});

const response = await this.callLLM({
  model: 'gpt-4o-mini',  // Fast, cheap model for progress messages
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContext }
  ],
  max_tokens: 50,
  temperature: 0.7,
});

event.message = {
  text: response.content,
  // ... other message fields
};

await this.next(event);  // Send to ingress-egress
```

#### 3.2.7. Ingress-Egress Delivery (Zero Changes Needed)

**Existing ingress-egress behavior** already handles this:

1. Receives event with `message.text` set by llm-bot
2. Uses `platform`, `channel`, `user` fields to determine delivery target
3. Sends message to platform via appropriate connector
4. Returns (no further routing)

**No code changes required** - ingress-egress already delivers events with populated message fields.

**Future Enhancement (Out of Scope for Sprint 377)**:
- Message editing support (requires tracking platform messageId)
- Typing indicators (platform-specific)

---

### 3.3. Data Flow

#### 3.3.1. Happy Path (Template Messages - Phase 1)

```
User: !image a sunset over mountains
   │
   ▼
[Ingress-Egress] Normalize to InternalEventV2
   │             payload: { type: 'chat.message.v1' }
   │
   ▼
[Event Router] Match command: !image
   │           Attach routing slip: [query-analyzer, image-gen-mcp, ingress-egress]
   │
   ▼
[Query Analyzer] Extract: { prompt: "a sunset over mountains" }
   │             Call next()
   │
   ▼
[Feedback Middleware] Check elapsed time: 150ms (< 2s threshold)
   │                   No action needed
   │
   ▼
[Image Gen MCP] Annotate as long-running operation
   │             Add operation_context annotation
   │             Set qos.progress.enabled = true
   │             Start image generation (OpenAI DALL-E)
   │
   │ [5 seconds elapse - still generating]
   │
   ▼
[Image Gen MCP] Still processing... (15s elapsed)
   │             Call next() to advance routing slip
   │
   ▼
[Feedback Middleware] Detect: 15s elapsed (> 2s threshold)
   │                   Create InternalEventV2:
   │                   - type: 'chat.progress.v1'
   │                   - platform/channel/user: copied from original
   │                   - annotations: [progress_context, prompt]
   │                   Publish to internal.ingress.v1
   │
   ├─────────────────────────────────────────────┐
   │                                             │
   ▼ (original continues)                        ▼ (progress message flow)
[Image Gen MCP]                            [Event Router] Match: type == 'chat.progress.v1'
Continue processing                             │  Attach slip: [llm-bot, ingress-egress]
   │                                             │
   │                                             ▼
   │                                        [LLM Bot] Read prompt annotation
   │                                             │  Read progress_context annotation
   │                                             │  Generate: "🎨 Creating your sunset over mountains image..."
   │                                             │  Set event.message.text
   │                                             │  Call next()
   │                                             │
   │                                             ▼
   │                                        [Ingress-Egress] Deliver to user
   │                                             │
   │◄────────────────────────────────────────────┘
   │ (user sees: "🎨 Creating your sunset over mountains image...")
   │
   ▼ (20 seconds elapse)
[Feedback Middleware] Detect: 20s elapsed (5s since last update)
   │                   Create chat.progress.v1 event (stage: 'update')
   │                   Publish to internal.ingress.v1
   │
   ├─────────────────────────────────────────────┐
   │                                             │
   ▼ (original continues)                        ▼ (update message flow)
[Image Gen MCP]                            [Event Router] → [LLM Bot]
Still processing (25s total)                    │  Generate: "🎨 Your sunset image is almost ready..."
   │                                             │
   │                                             ▼
   │                                        [Ingress-Egress] Deliver
   │                                             │
   │◄────────────────────────────────────────────┘
   │ (user sees: "🎨 Your sunset image is almost ready...")
   │
   ▼ (27s total)
[Image Gen MCP] Complete!
   │             Add image_result annotation
   │             Call next()
   │
   ▼
[Feedback Middleware] Detect completion (no more routing steps)
   │                   Mark correlationId as complete
   │                   No further progress messages
   │
   ▼
[Ingress-Egress] Deliver final result
   │
   ▼
User: "Image generated! https://storage.googleapis.com/..."
```

#### 3.3.2. Timeout Path

```
User: !image an incredibly complex scene with thousands of details
   │
   ▼
[Event Router] Attach routing slip
   │
   ▼
[Image Gen MCP] Start generation (OpenAI API)
   │
   │ [5s] → Feedback: "🎨 Creating your complex scene image..."
   │ [10s] → Still processing
   │ [15s] → Feedback: "🎨 Still working on your image..."
   │ [20s] → Still processing
   │ [25s] → Feedback: "🎨 Almost done..."
   │ [30s] → Still processing
   │ ...
   │ [60s] → Detect approaching timeout
   │
   ▼
[Feedback Middleware] Detect: 60s elapsed (approaching 75s timeout)
   │                   Create chat.progress.v1 event (stage: 'timeout')
   │                   Prompt: "This is taking longer than expected, apologize"
   │
   ▼
[LLM Bot] Generate: "⏳ This is taking longer than usual, but still processing..."
   │
   ▼
[Ingress-Egress] Deliver timeout warning
   │
   ▼ [75s] → Timeout!
[Image Gen MCP] AbortSignal.timeout() triggers
   │             Throw AbortError
   │
   ▼
[Error Handler] Catch error, send friendly message
   │
   ▼
User: "⏳ Image generation timed out after 75s. This prompt may be too complex. Try simplifying it."
```

#### 3.3.3. Template-Based Progress (Phase 1 Fallback)

If `qos.progress.useCustomMessage === false`, feedback middleware sends hardcoded messages directly:

```typescript
// In feedback-middleware.ts
async publishProgressEvent(event: InternalEventV2, stage: string, elapsedMs: number): Promise<void> {
  const useCustomMessage = event.qos?.progress?.useCustomMessage !== false;  // Default true

  if (useCustomMessage) {
    // Create chat.progress.v1 event (flows through llm-bot)
    await this.publishLLMProgressEvent(event, stage, elapsedMs);
  } else {
    // Send template message directly (no LLM call)
    await this.sendTemplateMessage(event, stage);
  }
}

private async sendTemplateMessage(event: InternalEventV2, stage: string): Promise<void> {
  const templates = {
    initial: '⏳ Processing your request...',
    update: '⏳ Still working on it...',
    timeout: '⏳ This is taking longer than expected, but still processing...',
  };

  const message = templates[stage] || templates.initial;

  // Publish directly to internal.egress.v1 (bypass routing)
  const egressEvent: InternalEventV2 = {
    ...event,  // Copy platform/channel/user
    correlationId: randomUUID(),
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { text: message },
    routingSlip: undefined,
  };

  await this.messageBus.publish('internal.egress.v1', egressEvent);
}
```

---

### 3.4. Implementation Phases

#### Phase 1: Foundation (Days 1-3)
**Goal**: Basic progress feedback with template messages

**Deliverables**:
1. ✅ Feedback Middleware implementation
   - Threshold detection (2s default)
   - Progress tracking (initial/update/timeout stages)
   - Template message generation
2. ✅ QoS extensions (`qos.progress.enabled`, `qos.progress.useCustomMessage`)
3. ✅ Unit tests for middleware (threshold detection, stage determination)
4. ✅ Integration test: image-gen-mcp with template messages

**Validation**:
```bash
# Local test
User: !image a sunset
[2s] Bot: ⏳ Processing your request...
[7s] Bot: ⏳ Still working on it...
[15s] Bot: Image generated! https://...
```

#### Phase 2: LLM-Generated Progress (Days 4-6)
**Goal**: Contextual progress messages via existing pipeline

**Deliverables**:
1. ✅ Event-router rule for `chat.progress.v1`
2. ✅ Prompt annotation generation in feedback middleware
3. ✅ Seed data update (add routing rule to `commands` collection)
4. ✅ Integration test: chat.progress.v1 → llm-bot → ingress-egress
5. ✅ Service opt-in: image-gen-mcp adds operation_context annotation

**Validation**:
```bash
# Local test
User: !image a sunset over ocean waves
[2s] Bot: 🎨 Creating your sunset over ocean waves image...
[7s] Bot: 🎨 Your sunset image is almost ready...
[15s] Bot: Image generated! https://...
```

#### Phase 3: Service Integration (Days 7-8)
**Goal**: Enable progress feedback for llm-bot and image-gen-mcp

**Deliverables**:
1. ✅ image-gen-mcp: Add operation_context annotation before generation
2. ✅ llm-bot: Add operation_context annotation for tool execution
3. ✅ Configuration flags: `PROGRESS_ENABLED`, `PROGRESS_USE_CUSTOM`
4. ✅ Staging deployment and smoke tests

**Validation**:
```bash
# Staging test (Slack)
User: !image a dragon
[2s] Bot: 🐉 Creating your dragon image...
[7s] Bot: 🐉 Your dragon is taking shape...
[12s] Bot: Image generated! https://...

User: What's the weather in Paris?
[2s] Bot: 🌤️ Checking the weather in Paris...
[4s] Bot: Paris is 22°C and sunny.
```

#### Phase 4: User Preferences (Days 9-10)
**Goal**: Allow users to opt-out of progress messages

**Deliverables**:
1. ✅ User preference storage (Firestore or PostgreSQL)
2. ✅ Preference enforcement in feedback middleware
3. ✅ Chat command: `!settings progress off`
4. ✅ Documentation update

**Validation**:
```bash
User: !settings progress off
Bot: Progress messages disabled.

User: !image a sunset
[10s of silence]
Bot: Image generated! https://...

User: !settings progress on
Bot: Progress messages enabled.
```

#### Phase 5: Monitoring & Refinement (Day 10)
**Goal**: Production readiness

**Deliverables**:
1. ✅ Logging: Progress message published, delivered, failed
2. ✅ Metrics: Progress message latency, LLM call duration
3. ✅ Error handling: LLM timeout → fallback to template
4. ✅ Documentation: Architecture, user guide, troubleshooting

---

## 4. Technical Decisions

### 4.1. Why Not New Event Types?

**Decision**: Reuse `InternalEventV2` with `type: 'chat.progress.v1'` instead of creating `ChatProgressV1` interface.

**Rationale**:
1. **Simplicity**: No new TypeScript types, no schema changes
2. **Compatibility**: Existing services already handle `InternalEventV2`
3. **Routing**: Event-router already matches on `payload.type`
4. **Consistency**: Same pattern as `chat.message.v1`, `chat.command.v1`, etc.

### 4.2. Why Not New LLM Operations?

**Decision**: Use existing `chat` operation in llm-bot instead of `generate_progress_message` operation.

**Rationale**:
1. **Zero code changes**: llm-bot already processes events with prompt annotations
2. **Reuse existing logic**: Personality, LLM provider selection, error handling
3. **No special cases**: Progress messages are just short chat responses

### 4.3. Why Annotations Instead of QoS?

**Decision**: Store implementation details (stage, operation, timing) in annotations, not QoS.

**Rationale**:
1. **QoS is for preferences**: User wants progress feedback (yes/no), not implementation details
2. **Annotations are for context**: Progress stage, operation type, parameters are context
3. **Separation of concerns**: QoS = "what user wants", Annotations = "what system knows"

### 4.4. Why Feedback Middleware Instead of Service Code?

**Decision**: Intercept `next()` calls in Bit base class instead of modifying each service.

**Rationale**:
1. **Zero service changes**: Services don't need to call feedback APIs
2. **Automatic detection**: Threshold-based triggering requires no opt-in
3. **Consistent UX**: All long-running operations get feedback automatically
4. **Opt-in available**: Services can annotate events for better context

---

## 5. Testing Strategy

### 5.1. Unit Tests

**Feedback Middleware** (`feedback-middleware.test.ts`):
```typescript
describe('FeedbackMiddleware', () => {
  it('should not send progress for fast operations (<2s)', async () => {
    const event = createMockEvent();
    event.timestamp = new Date(Date.now() - 1500).toISOString();

    await middleware.beforeNext(event);

    expect(messageBus.publish).not.toHaveBeenCalled();
  });

  it('should send initial progress at 2s threshold', async () => {
    const event = createMockEvent();
    event.timestamp = new Date(Date.now() - 2100).toISOString();

    await middleware.beforeNext(event);

    expect(messageBus.publish).toHaveBeenCalledWith(
      'internal.ingress.v1',
      expect.objectContaining({
        payload: { type: 'chat.progress.v1' },
        annotations: expect.arrayContaining([
          expect.objectContaining({ kind: 'progress_context' }),
          expect.objectContaining({ kind: 'prompt' }),
        ]),
      })
    );
  });

  it('should send update at 7s (5s after initial)', async () => {
    const event = createMockEvent();
    event.timestamp = new Date(Date.now() - 7100).toISOString();

    // Simulate initial already sent
    middleware.tracking.set(event.correlationId, {
      initialSent: true,
      lastUpdate: Date.now() - 5100,
      timeoutSent: false,
    });

    await middleware.beforeNext(event);

    expect(messageBus.publish).toHaveBeenCalledWith(
      'internal.ingress.v1',
      expect.objectContaining({
        annotations: expect.arrayContaining([
          expect.objectContaining({
            kind: 'progress_context',
            value: expect.objectContaining({ stage: 'update' }),
          }),
        ]),
      })
    );
  });

  it('should respect user opt-out', async () => {
    const event = createMockEvent();
    event.qos = { progress: { enabled: false } };
    event.timestamp = new Date(Date.now() - 5000).toISOString();

    await middleware.beforeNext(event);

    expect(messageBus.publish).not.toHaveBeenCalled();
  });
});
```

### 5.2. Integration Tests

**End-to-End Progress Flow** (`progress-flow.integration.test.ts`):
```typescript
describe('Progress Message Flow', () => {
  it('should generate contextual progress message via LLM', async () => {
    // 1. Create original image request
    const originalEvent: InternalEventV2 = {
      correlationId: randomUUID(),
      eventId: randomUUID(),
      timestamp: new Date(Date.now() - 5000).toISOString(),  // 5s ago
      platform: 'slack',
      channel: { id: 'C123', name: 'general' },
      user: { id: 'U123', username: 'testuser' },
      payload: { type: 'chat.message.v1' },
      message: { text: '!image a sunset' },
      qos: { progress: { enabled: true, useCustomMessage: true } },
      annotations: [
        {
          kind: 'operation_context',
          value: {
            operation: 'image_generation',
            parameters: { prompt: 'a sunset' },
          },
          source: 'image-gen-mcp',
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        },
      ],
    };

    // 2. Feedback middleware triggers
    const middleware = new FeedbackMiddleware({ messageBus, logger });
    await middleware.beforeNext(originalEvent);

    // 3. Verify chat.progress.v1 event published
    expect(messageBus.publish).toHaveBeenCalledWith(
      'internal.ingress.v1',
      expect.objectContaining({
        payload: { type: 'chat.progress.v1' },
        platform: 'slack',
        channel: { id: 'C123' },
        user: { id: 'U123' },
      })
    );

    // 4. Simulate event-router attaching routing slip
    const progressEvent = messageBus.publish.mock.calls[0][1];
    progressEvent.routingSlip = {
      steps: [
        { service: 'llm-bot', operation: 'chat' },
        { service: 'ingress-egress', operation: 'deliver' },
      ],
      currentStep: 0,
    };

    // 5. Simulate llm-bot processing
    const llmBot = new LLMBotService();
    await llmBot.handleMessage(progressEvent);

    // 6. Verify message generated
    expect(progressEvent.message?.text).toMatch(/sunset/i);
    expect(progressEvent.message?.text).toMatch(/🎨/);
    expect(progressEvent.message?.text.length).toBeLessThan(100);

    // 7. Verify next() called (sends to ingress-egress)
    expect(messageBus.publish).toHaveBeenCalledWith(
      'internal.contextualization.v1',  // Or next topic in routing slip
      expect.objectContaining({
        message: expect.objectContaining({
          text: expect.stringContaining('sunset'),
        }),
      })
    );
  });
});
```

### 5.3. Manual Testing Plan

**Test Case 1: Image Generation Progress**
```bash
# Setup
npm run local
npm run brat -- chat

# Test
User: !image a sunset over ocean waves
Expected:
  [2s] Bot: 🎨 Creating your sunset over ocean waves image...
  [7s] Bot: 🎨 Your sunset image is almost ready...
  [15s] Bot: Image generated! https://storage.googleapis.com/...
```

**Test Case 2: LLM Tool Execution Progress**
```bash
User: What's the weather in Paris and London?
Expected:
  [2s] Bot: 🌤️ Checking the weather...
  [5s] Bot: Paris is 22°C and sunny. London is 18°C and cloudy.
```

**Test Case 3: Timeout Warning**
```bash
User: !image an incredibly detailed fantasy landscape with thousands of intricate details
Expected:
  [2s] Bot: 🎨 Creating your detailed fantasy landscape...
  [7s] Bot: 🎨 Still working on your landscape...
  [60s] Bot: ⏳ This is taking longer than usual, but still processing...
  [75s] Bot: ⏳ Image generation timed out. Try simplifying your prompt.
```

**Test Case 4: User Opt-Out**
```bash
User: !settings progress off
Bot: Progress messages disabled.

User: !image a sunset
[10s of silence]
Bot: Image generated! https://...
```

---

## 6. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **LLM latency degrades UX** | HIGH | MEDIUM | Use fast model (gpt-4o-mini), 3s timeout, fallback to templates |
| **Progress message spam** | MEDIUM | MEDIUM | Rate limiting (5s between updates), platform-aware throttling |
| **Event-router rule mismatch** | HIGH | LOW | Comprehensive seed data tests, rule validation in setup |
| **Feedback failures block operations** | CRITICAL | LOW | Isolate feedback in try-catch, log errors, continue operation |
| **User preference conflicts** | LOW | LOW | Default to enabled, clear opt-out command |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **User satisfaction** | >80% positive feedback | Post-sprint user survey |
| **Progress message latency** | <500ms | p95 from logs |
| **LLM call duration** | <2s | p95 from logs |
| **Feedback failure rate** | <1% | Error logs / total operations |
| **Opt-out rate** | <10% | User preferences count |

---

## 8. Future Enhancements (Out of Scope)

### Sprint 378+: Platform-Specific Strategies
- **Slack**: Message editing (update same message instead of new ones)
- **Discord**: Typing indicators (3-dot animation)
- **Twitch**: Rate-limited sequential messages (respect 20msg/30s limit)

### Sprint 379+: Advanced Features
- **User cancellation**: `!cancel` command to abort long operations
- **Progress percentage**: "🎨 Creating image... 45% complete"
- **Streaming responses**: Progressive reveal for LLM text (token-by-token)
- **Multi-step progress**: "Step 1/3: Moderation check ✅"

---

## 9. Appendix

### A. Annotation Schemas

**progress_context**:
```typescript
{
  kind: 'progress_context',
  value: {
    originalCorrelationId: string;      // Link to original request
    originalMessage: string;            // User's original message
    stage: 'initial' | 'update' | 'timeout' | 'completion';
    operation: string;                  // 'image_generation', 'llm_call', 'tool_execution'
    parameters: Record<string, any>;    // Request-specific context
    startedAt: string;                  // ISO timestamp
    elapsedMs: number;                  // Milliseconds elapsed
  },
  source: 'feedback-middleware',
  id: string;
  createdAt: string;
}
```

**operation_context** (added by services):
```typescript
{
  kind: 'operation_context',
  value: {
    operation: string;                  // 'image_generation', 'llm_call', etc.
    parameters: Record<string, any>;    // Request details
    expectedDurationMs?: number;        // Hint for feedback middleware
  },
  source: string;                       // Service name
  id: string;
  createdAt: string;
}
```

**prompt** (added by feedback middleware):
```typescript
{
  kind: 'prompt',
  value: string;  // Instructions for llm-bot on how to generate message
  source: 'feedback-middleware',
  id: string;
  createdAt: string;
}
```

### B. Configuration Reference

**Environment Variables**:
```yaml
# Global (env/staging/global.yaml)
PROGRESS_ENABLED: "true"                    # Enable progress feedback system
PROGRESS_USE_CUSTOM_MESSAGES: "true"        # Use LLM vs templates
PROGRESS_THRESHOLD_MS: "2000"               # Minimum elapsed time to trigger (ms)
PROGRESS_UPDATE_INTERVAL_MS: "5000"         # Time between updates (ms)
PROGRESS_LLM_MODEL: "gpt-4o-mini"           # Model for progress message generation
PROGRESS_LLM_TIMEOUT_MS: "3000"             # Timeout for LLM calls
```

**Service-Specific** (optional):
```yaml
# env/staging/image-gen-mcp.yaml
IMAGE_GEN_PROGRESS_ENABLED: "true"
IMAGE_GEN_PROGRESS_CUSTOM: "true"
```

### C. Example Prompts (by Operation Type)

**image_generation**:
```
Stage: initial
Prompt: "Generate a brief, encouraging message (max 100 chars) that the user's image is being created. Reference the image subject from the prompt. Use an emoji. Be concise and friendly."

Stage: update
Prompt: "Generate a brief progress update (max 100 chars) that the image is still being generated. Be patient but positive. Don't repeat the exact same message as before."

Stage: timeout
Prompt: "Generate a brief message (max 100 chars) that the image is taking longer than expected but still processing. Be apologetic but reassuring."
```

**llm_call**:
```
Stage: initial
Prompt: "Generate a brief message (max 100 chars) that you're thinking about the user's question. Use an emoji. Be friendly."

Stage: update
Prompt: "Generate a brief update (max 100 chars) that you're still processing. Be patient."

Stage: timeout
Prompt: "Generate a brief message (max 100 chars) that this is taking longer than usual. Apologize for the wait."
```

**tool_execution**:
```
Stage: initial
Prompt: "Generate a brief message (max 100 chars) that you're executing the requested tool. Reference the tool name if available. Use an emoji."

Stage: update
Prompt: "Generate a brief update (max 100 chars) that the tool is still running. Be patient."

Stage: timeout
Prompt: "Generate a brief message (max 100 chars) that the tool is taking longer than expected. Apologize."
```

---

**End of Technical Architecture**
