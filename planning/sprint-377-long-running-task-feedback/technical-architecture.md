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
- **Preserves existing architecture** (no routing slip changes, minimal service modifications)

**Key Innovation:** A **Feedback Middleware** layer that intercepts `next()` calls and sends platform-appropriate progress updates without requiring service code changes.

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
| **NFR-2** | Zero service code changes | 100% | Services shouldn't need modifications |
| **NFR-3** | Platform rate limit compliance | 100% | Respect Twitch (20msg/30s), Slack (50req/min) |
| **NFR-4** | Backward compatibility | 100% | Existing flows work without feedback enabled |
| **NFR-5** | Failure isolation | 100% | Feedback failures don't block primary operations |

### 2.3. Platform-Specific Capabilities

| Platform | Typing Indicator | Message Editing | Rich Formatting | Thread Support | Rate Limits |
|----------|-----------------|-----------------|-----------------|----------------|-------------|
| **Slack** | ✅ Yes | ✅ Yes | ✅ Blocks | ✅ Yes | 50 req/min |
| **Discord** | ✅ Yes (10s) | ✅ Yes | ✅ Embeds | ✅ Yes | 5 req/s |
| **Twitch** | ❌ No (IRC) | ❌ No (IRC) | ❌ No | ❌ No | 20 msg/30s |
| **Twilio** | ❌ No (SMS) | ❌ No (SMS) | ❌ No | ❌ No | 1 msg/s |

**Strategy:**
- **Slack/Discord**: Use typing + message editing (optimal UX)
- **Twitch**: Use `/me` ACTION messages (italic, third-person)
- **Twilio**: Use sequential SMS (optional, carrier-dependent)

---

## 3. Proposed Architecture

### 3.1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Event Flow with Feedback                    │
└─────────────────────────────────────────────────────────────────────┘

   Ingress Event (user message)
        │
        ▼
   ┌─────────────────┐
   │  Event Router   │ Attach routing slip
   └────────┬────────┘
            │
            ▼
   ┌─────────────────────────────────────────────────────────────┐
   │              Feedback Middleware (NEW)                      │
   │  - Detects long-running operations                          │
   │  - Sends initial progress message (typing/placeholder)      │
   │  - Tracks operation state (correlationId → messageId map)   │
   └────────┬────────────────────────────────────────────────────┘
            │
            ▼
   ┌─────────────────┐     ┌──────────────────────┐
   │  Auth Service   │────▶│  Query Analyzer       │ (fast: <500ms)
   └─────────────────┘     └──────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │    LLM Bot          │ ⏱ LONG (2-10s)
                            │  - Middleware sends │
                            │    "Thinking..."    │
                            │  - LLM processes    │
                            │  - Middleware edits │
                            │    with result      │
                            └─────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │  Image Gen MCP      │ ⏱ VERY LONG (10-30s)
                            │  - Middleware sends │
                            │    "Generating..."  │
                            │  - Moderation check │
                            │  - Middleware edits │
                            │    "Still working..." (15s)
                            │  - Image generation │
                            │  - Middleware edits │
                            │    with image URL   │
                            └─────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │  State Engine       │ (fast: <200ms)
                            └─────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │  Ingress-Egress     │
                            │  - Final delivery   │
                            │  - Cleanup tracked  │
                            │    progress messages│
                            └─────────────────────┘
```

### 3.2. Core Components

#### 3.2.1. Feedback Middleware

**Location:** `src/common/feedback/feedback-middleware.ts` (NEW)

**Responsibilities:**
- Intercept `next()` calls from services
- Detect long-running operations via:
  - **Threshold-based:** Event processing time >2s
  - **Service annotation:** `event.qos.expectsLongRunning = true`
- Send initial progress message
- Track operation state (correlationId → progress message ID)
- Update progress at intervals (5s, 15s, 30s)
- Clean up progress messages on completion

**API:**
```typescript
interface FeedbackMiddleware {
  /**
   * Wrap a service's next() call with feedback logic
   */
  wrapNext(
    originalNext: (event: InternalEventV2) => Promise<void>,
    serviceName: string
  ): (event: InternalEventV2) => Promise<void>;

  /**
   * Manually send progress update (for services with internal checkpoints)
   */
  sendProgress(
    correlationId: string,
    message: string,
    options?: { replace?: boolean }
  ): Promise<void>;

  /**
   * Mark operation as complete (cleanup progress messages)
   */
  markComplete(correlationId: string): Promise<void>;
}
```

**Usage (in Bit base class):**
```typescript
// src/common/base-server.ts (automatic injection)
protected async next(event: InternalEventV2, status: MessageStatus = 'PROCESSED'): Promise<void> {
  // Feedback middleware intercepts here
  if (this.feedbackMiddleware && this.isLongRunningService()) {
    await this.feedbackMiddleware.wrapNext(() => this.publishNext(event, status), this.name);
  } else {
    await this.publishNext(event, status);
  }
}
```

#### 3.2.2. Progress Message Manager

**Location:** `src/common/feedback/progress-message-manager.ts` (NEW)

**Responsibilities:**
- Abstract platform-specific feedback mechanisms
- Negotiate platform capabilities (typing, editing, sequential)
- Manage message lifecycle (send, update, delete)
- Track progress message IDs (Redis or in-memory map)

**API:**
```typescript
interface ProgressMessageManager {
  /**
   * Send initial progress message
   * Returns message ID for future updates
   */
  sendInitial(
    platform: string,
    target: string,
    correlationId: string,
    message: string
  ): Promise<string>;

  /**
   * Update existing progress message (if platform supports editing)
   */
  update(
    platform: string,
    messageId: string,
    message: string
  ): Promise<void>;

  /**
   * Clean up progress message (delete or mark complete)
   */
  cleanup(
    platform: string,
    messageId: string
  ): Promise<void>;
}
```

**Platform Strategies:**

**Slack Strategy:**
```typescript
class SlackProgressStrategy implements ProgressStrategy {
  async sendInitial(channel: string, message: string): Promise<string> {
    // 1. Send typing indicator (instant)
    await this.client.chat.postMessage({ channel, text: '...' });

    // 2. Send editable placeholder
    const result = await this.client.chat.postMessage({
      channel,
      text: message,
      unfurl_links: false
    });

    return result.ts; // Message timestamp (ID)
  }

  async update(channel: string, ts: string, message: string): Promise<void> {
    await this.client.chat.update({ channel, ts, text: message });
  }

  async cleanup(channel: string, ts: string): Promise<void> {
    // Option 1: Delete message
    await this.client.chat.delete({ channel, ts });

    // Option 2: Replace with final response (preferred)
    // No-op - final response replaces progress message
  }
}
```

**Discord Strategy:**
```typescript
class DiscordProgressStrategy implements ProgressStrategy {
  async sendInitial(channelId: string, message: string): Promise<string> {
    const channel = this.client.channels.cache.get(channelId);

    // 1. Send typing indicator (10s duration)
    await channel.sendTyping();

    // 2. Send editable embed
    const msg = await channel.send({
      embeds: [{ description: message, color: 0x3498db }]
    });

    // 3. Retrigger typing every 8s (async loop)
    this.scheduleTypingRetrigger(channel);

    return msg.id;
  }

  async update(channelId: string, messageId: string, message: string): Promise<void> {
    const channel = this.client.channels.cache.get(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [{ description: message, color: 0x3498db }] });
  }

  async cleanup(channelId: string, messageId: string): Promise<void> {
    const channel = this.client.channels.cache.get(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.delete();
  }
}
```

**Twitch Strategy:**
```typescript
class TwitchProgressStrategy implements ProgressStrategy {
  async sendInitial(channel: string, message: string): Promise<string> {
    // Use ACTION message (italic, third-person)
    await this.chat.say(channel, `/me ${message}`);

    // No message ID (IRC doesn't support editing)
    return 'twitch-no-id';
  }

  async update(channel: string, messageId: string, message: string): Promise<void> {
    // Send new ACTION message (append-only)
    await this.chat.say(channel, `/me ${message}`);
  }

  async cleanup(channel: string, messageId: string): Promise<void> {
    // No-op (IRC messages can't be deleted)
  }
}
```

**Twilio Strategy:**
```typescript
class TwilioProgressStrategy implements ProgressStrategy {
  async sendInitial(conversationSid: string, message: string): Promise<string> {
    // Optional: Send progress SMS (may annoy users, use sparingly)
    const msg = await this.conversationService
      .conversations(conversationSid)
      .messages.create({ body: message });

    return msg.sid;
  }

  async update(conversationSid: string, messageSid: string, message: string): Promise<void> {
    // Send new SMS (append-only)
    await this.conversationService
      .conversations(conversationSid)
      .messages.create({ body: message });
  }

  async cleanup(conversationSid: string, messageSid: string): Promise<void> {
    // No-op (SMS can't be deleted)
  }
}
```

#### 3.2.3. Progress Message Templates

**Location:** `src/common/feedback/templates.ts` (NEW)

**Purpose:** Centralized, customizable progress messages

**API:**
```typescript
interface ProgressTemplates {
  initial: {
    llm: string;              // "🤔 Thinking..."
    imagegen: string;         // "🎨 Generating image..."
    tool: string;             // "🔧 Running {toolName}..."
    generic: string;          // "⏳ Processing..."
  };

  periodic: {
    still_working: string;    // "Still working on it..."
    almost_done: string;      // "Almost done..."
    taking_longer: string;    // "This is taking longer than usual..."
  };

  timeout: {
    approaching: string;      // "This is taking a while, but still processing..."
    exceeded: string;         // "Request timed out after {duration}s. Please try again."
  };
}
```

**Customization:**
- **Per-service templates:** `LLM_BOT_PROGRESS_INITIAL="Consulting my neural networks..."`
- **Per-platform templates:** `TWITCH_PROGRESS_INITIAL="is thinking..."` (for `/me` messages)
- **User preferences:** Store in user profile (`user.preferences.progressMessages = false`)

#### 3.2.4. QoS Extensions

**Location:** `src/types/events.ts` (EXTEND existing QOSV1)

**New Fields:**
```typescript
interface QOSV1 {
  // Existing fields...
  routingTimeoutMs?: number;
  tracer?: boolean;

  // NEW: Progress feedback fields
  expectsLongRunning?: boolean;        // Service annotates known long operations
  progressFeedbackEnabled?: boolean;   // User preference (opt-out)
  progressMessageId?: string;          // Track progress message for updates
  progressLastUpdate?: string;         // ISO timestamp of last progress message
  progressStage?: string;              // Current stage (e.g., "moderation", "generation", "upload")
}
```

**Usage (service annotation):**
```typescript
// image-gen-mcp/index.ts (line 120)
this.registerTool(
  'generate_image',
  'Generate an image using AI',
  generateImageSchema,
  async (args, correlationId) => {
    // Annotate event as long-running
    const event = this.getCurrentEvent(correlationId);
    if (event?.qos) {
      event.qos.expectsLongRunning = true;
      event.qos.progressStage = 'moderation';
    }

    // Moderation check (500ms)
    const moderationResult = await this.moderatePrompt(args.prompt);

    // Update progress stage
    if (event?.qos) {
      event.qos.progressStage = 'generation';
    }

    // Image generation (10-30s)
    const imageResult = await generateImage({ ... });

    // Update progress stage
    if (event?.qos) {
      event.qos.progressStage = 'upload';
    }

    // Storage upload (500ms-2s)
    const uploadResult = await storageDriver.upload(...);

    return { ... };
  }
);
```

### 3.3. Data Flow

#### 3.3.1. Happy Path (Slack - Optimal UX)

```
User: !image a sunset
   │
   ▼
[Event Router] Attach routing slip
   │
   ▼
[Feedback Middleware] Detect image-gen-mcp in routing slip
   │                   Check platform: Slack (supports editing)
   │                   Send initial: "🎨 Generating image..."
   │                   Store: correlationId → messageTs
   │
   ▼
[Image Gen MCP] Stage: moderation (500ms)
   │
   ▼ (5s elapsed)
[Feedback Middleware] Update: "🎨 Still generating..."
   │
   ▼
[Image Gen MCP] Stage: generation (25s total)
   │
   ▼ (15s elapsed)
[Feedback Middleware] Update: "🎨 Almost done..."
   │
   ▼
[Image Gen MCP] Stage: upload (27s total)
   │           Complete → publishNext()
   │
   ▼
[Feedback Middleware] Detect completion
   │                   Update: "Image generated! https://..."
   │                   Cleanup: Delete messageTs from tracking
   │
   ▼
[Ingress-Egress] Final delivery (no-op, already sent)
```

#### 3.3.2. Degraded Path (Twitch - Limited Platform)

```
User: !image a sunset
   │
   ▼
[Event Router] Attach routing slip
   │
   ▼
[Feedback Middleware] Detect image-gen-mcp in routing slip
   │                   Check platform: Twitch (no editing, rate limits)
   │                   Send initial: "/me is generating an image..."
   │
   ▼
[Image Gen MCP] Stage: moderation (500ms)
   │
   ▼ (10s elapsed - skip 5s update due to rate limits)
[Feedback Middleware] Update: "/me still working on your image..."
   │
   ▼
[Image Gen MCP] Stage: generation (25s total)
   │
   ▼ (25s elapsed - skip 15s update due to rate limits)
[Feedback Middleware] Update: "/me almost done..."
   │
   ▼
[Image Gen MCP] Stage: upload (27s total)
   │           Complete → publishNext()
   │
   ▼
[Feedback Middleware] Detect completion
   │                   No cleanup needed (Twitch doesn't support deletion)
   │
   ▼
[Ingress-Egress] Final delivery: "Image generated! https://..."
```

#### 3.3.3. Timeout Path

```
User: !image an incredibly complex scene with thousands of details
   │
   ▼
[Feedback Middleware] Send initial: "🎨 Generating image..."
   │
   ▼
[Image Gen MCP] Stage: generation (45s... 60s... 75s...)
   │
   ▼ (60s elapsed)
[Feedback Middleware] Detect approaching timeout (75s limit)
   │                   Update: "⏳ This is taking longer than usual, but still processing..."
   │
   ▼ (75s elapsed)
[Image Gen MCP] AbortSignal.timeout() triggers
   │           Throw AbortError
   │
   ▼
[Feedback Middleware] Catch timeout error
   │                   Update: "⏱ Request timed out after 75s. The image was too complex. Try a simpler prompt."
   │                   markComplete(correlationId)
   │
   ▼
[Ingress-Egress] Final delivery: (error already sent, skip)
```

---

## 4. Implementation Strategy

### 4.1. Phase 1: Foundation (Days 1-2)

**Goal:** Build core feedback infrastructure without platform integration

**Deliverables:**
1. **Progress Message Manager** (`progress-message-manager.ts`)
   - Interface definitions
   - In-memory message ID tracking (Map<correlationId, messageId>)
   - No-op strategy (for testing without platforms)

2. **Progress Templates** (`templates.ts`)
   - Default templates for common operations
   - Environment variable overrides
   - User preference placeholders

3. **QoS Extensions** (`types/events.ts`)
   - Add `expectsLongRunning`, `progressFeedbackEnabled`, `progressMessageId`, `progressStage` fields
   - Update schema validation

4. **Unit Tests**
   - Template rendering
   - Message ID tracking (add, get, delete)
   - QoS field validation

### 4.2. Phase 2: Feedback Middleware (Days 3-4)

**Goal:** Implement core middleware logic with threshold detection

**Deliverables:**
1. **Feedback Middleware** (`feedback-middleware.ts`)
   - `wrapNext()` implementation
   - Threshold-based detection (>2s)
   - Service annotation detection (`event.qos.expectsLongRunning`)
   - Periodic update scheduling (5s, 15s, 30s)
   - Timeout detection (approaching, exceeded)

2. **Bit Integration** (`common/base-server.ts`)
   - Inject feedback middleware into `next()` method
   - Opt-out logic (check `event.qos.progressFeedbackEnabled`)
   - Error handling (feedback failures don't block primary flow)

3. **Integration Tests**
   - Middleware wraps `next()` correctly
   - Threshold detection triggers at 2s
   - Service annotations are respected
   - Opt-out works (no progress messages sent)

### 4.3. Phase 3: Platform Strategies (Days 5-7)

**Goal:** Implement platform-specific feedback mechanisms

**Deliverables:**
1. **Slack Strategy** (`feedback/strategies/slack-strategy.ts`)
   - Typing indicator + editable message
   - Message update via `chat.update`
   - Cleanup via message deletion

2. **Discord Strategy** (`feedback/strategies/discord-strategy.ts`)
   - Typing indicator (10s retriggerable)
   - Editable embeds
   - Progress bar in embed description (optional)

3. **Twitch Strategy** (`feedback/strategies/twitch-strategy.ts`)
   - `/me` ACTION messages
   - Rate limit throttling (max 3 progress messages per operation)
   - No cleanup (IRC limitation)

4. **Twilio Strategy** (`feedback/strategies/twilio-strategy.ts`)
   - Optional progress SMS (disabled by default)
   - Sequential messages
   - No cleanup (SMS limitation)

5. **Platform Integration Tests**
   - Mock Slack Web API (`chat.postMessage`, `chat.update`, `chat.delete`)
   - Mock Discord Gateway (`sendTyping`, `message.edit`, `message.delete`)
   - Mock Twitch IRC (`chat.say`)
   - Mock Twilio Conversations API (`messages.create`)

### 4.4. Phase 4: Service Integration (Days 8-9)

**Goal:** Enable feedback in high-impact services (llm-bot, image-gen-mcp)

**Deliverables:**
1. **Image Gen MCP** (`services/image-gen-mcp/index.ts`)
   - Annotate `generate_image` tool with `expectsLongRunning = true`
   - Add stage annotations (`moderation`, `generation`, `upload`)
   - No other code changes (middleware handles feedback)

2. **LLM Bot** (`services/llm-bot/processor.ts`)
   - Annotate events with `expectsLongRunning = true` when tools are involved
   - Add stage annotations (`enrichment`, `llm_call`, `tool_execution`)
   - No other code changes

3. **End-to-End Tests**
   - Generate image in Slack (verify typing + editable message)
   - Generate image in Twitch (verify ACTION messages)
   - LLM call with tools (verify progress during tool execution)
   - Timeout scenario (verify user-friendly timeout message)

### 4.5. Phase 5: User Preferences (Day 10)

**Goal:** Allow users to opt-in/opt-out of progress feedback

**Deliverables:**
1. **User Preference Storage**
   - Add `progressMessages` field to user profile (PostgreSQL or Firestore)
   - Default: `true` (enabled for all users)

2. **Preference Commands**
   - `!settings progress on` - Enable progress messages
   - `!settings progress off` - Disable progress messages
   - `!settings` - Show current settings

3. **Ingress Integration**
   - Load user preferences during auth enrichment
   - Set `event.qos.progressFeedbackEnabled` based on preference

4. **Preference Tests**
   - User disables progress → no progress messages sent
   - User enables progress → progress messages sent
   - Default behavior (new users) → progress enabled

---

## 5. Configuration

### 5.1. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEEDBACK_ENABLED` | `true` | Global feature flag (kill switch) |
| `FEEDBACK_THRESHOLD_MS` | `2000` | Threshold for long-running detection |
| `FEEDBACK_UPDATE_INTERVALS` | `5000,15000,30000` | Comma-separated update intervals (ms) |
| `FEEDBACK_TIMEOUT_WARNING_MS` | `60000` | Warn user when approaching timeout (75s - 15s) |
| `FEEDBACK_PLATFORM_SLACK_ENABLED` | `true` | Enable Slack-specific feedback |
| `FEEDBACK_PLATFORM_DISCORD_ENABLED` | `true` | Enable Discord-specific feedback |
| `FEEDBACK_PLATFORM_TWITCH_ENABLED` | `true` | Enable Twitch-specific feedback (ACTION msgs) |
| `FEEDBACK_PLATFORM_TWILIO_ENABLED` | `false` | Enable Twilio-specific feedback (SMS) |
| `FEEDBACK_TEMPLATE_LLM_INITIAL` | `🤔 Thinking...` | LLM initial progress message |
| `FEEDBACK_TEMPLATE_IMAGEGEN_INITIAL` | `🎨 Generating image...` | Image gen initial message |
| `FEEDBACK_TEMPLATE_TIMEOUT` | `⏱ Request timed out after {duration}s. Please try again.` | Timeout message |

### 5.2. Feature Flags

**Flag:** `feedback.progressMessages.enabled`

**Scope:** Global (platform-wide)

**Values:**
- `true` (default): Progress feedback enabled for all users
- `false`: Progress feedback disabled (fallback to silent processing)

**Override:** User preference (`user.preferences.progressMessages`)

### 5.3. Service Configuration

**llm-bot:**
```yaml
# env/local/llm-bot.yaml
FEEDBACK_ENABLED: true
FEEDBACK_THRESHOLD_MS: 3000  # LLM calls often >3s
FEEDBACK_TEMPLATE_LLM_INITIAL: "🤔 Thinking..."
```

**image-gen-mcp:**
```yaml
# env/local/image-gen-mcp.yaml
FEEDBACK_ENABLED: true
FEEDBACK_THRESHOLD_MS: 5000  # Image gen always >5s
FEEDBACK_TEMPLATE_IMAGEGEN_INITIAL: "🎨 Generating your image..."
FEEDBACK_UPDATE_INTERVALS: "10000,20000,40000"  # Longer intervals for image gen
```

---

## 6. Error Handling

### 6.1. Failure Modes

| Failure | Impact | Handling |
|---------|--------|----------|
| **Progress message send fails** | LOW | Log warning, continue primary operation |
| **Message editing fails (platform API error)** | LOW | Log warning, skip future edits |
| **Rate limit exceeded** | MEDIUM | Throttle updates, skip intermediate messages |
| **Feedback middleware crashes** | MEDIUM | Catch error, disable feedback for this event |
| **User preference lookup fails** | LOW | Default to `enabled = true` |

### 6.2. Circuit Breaker

**Pattern:** If progress message failures exceed **10% over 1 minute**, disable feedback for **5 minutes**

**Implementation:**
```typescript
class FeedbackCircuitBreaker {
  private failureCount = 0;
  private totalAttempts = 0;
  private resetTime?: number;

  checkCircuit(): boolean {
    if (this.resetTime && Date.now() < this.resetTime) {
      return false; // Circuit open (disabled)
    }

    const failureRate = this.failureCount / this.totalAttempts;
    if (failureRate > 0.1 && this.totalAttempts >= 10) {
      this.resetTime = Date.now() + 300000; // 5 minutes
      logger.warn('feedback.circuit_breaker.open', { failureRate, totalAttempts: this.totalAttempts });
      return false;
    }

    return true; // Circuit closed (enabled)
  }

  recordSuccess(): void {
    this.totalAttempts++;
  }

  recordFailure(): void {
    this.totalAttempts++;
    this.failureCount++;
  }
}
```

### 6.3. Graceful Degradation

| Scenario | Degradation Strategy |
|----------|---------------------|
| **Slack API unavailable** | Skip typing indicator, send single final message |
| **Discord typing fails** | Skip typing, use embed-only approach |
| **Twitch rate limit hit** | Skip intermediate updates, send only final message |
| **Twilio carrier blocks SMS** | Disable Twilio feedback, send only final SMS |

---

## 7. Testing Strategy

### 7.1. Unit Tests

**Target:** 90% coverage on feedback components

**Key Test Cases:**
- Template rendering with placeholders
- Message ID tracking (add, get, delete)
- Threshold detection (2s, 5s, 10s)
- Service annotation detection
- User preference parsing
- Timeout detection (approaching, exceeded)

### 7.2. Integration Tests

**Target:** Platform-specific feedback mechanisms

**Key Test Cases:**
- **Slack:** Mock `chat.postMessage`, `chat.update`, `chat.delete`
- **Discord:** Mock `sendTyping`, `message.edit`, `message.delete`
- **Twitch:** Mock `chat.say` (ACTION messages)
- **Twilio:** Mock `messages.create`

**Assertions:**
- Initial progress message sent within 500ms
- Updates sent at configured intervals
- Final message replaces/deletes progress message
- Rate limits are respected

### 7.3. End-to-End Tests

**Target:** Real user flows with feedback

**Key Scenarios:**
1. **Image Generation (Slack):**
   - User sends `!image a sunset`
   - Assert: Typing indicator appears within 500ms
   - Assert: "🎨 Generating image..." appears within 1s
   - Assert: Message updates to "🎨 Still generating..." after 10s
   - Assert: Final message shows image URL after 25s

2. **LLM with Tools (Discord):**
   - User sends `What's the weather in Paris?`
   - Assert: Typing indicator triggered
   - Assert: Embed shows "🤔 Thinking..."
   - Assert: Typing retriggered every 8s
   - Assert: Embed updates to "🔧 Checking weather..."
   - Assert: Final embed shows weather result

3. **Timeout (Twitch):**
   - User sends `!image an impossibly complex scene`
   - Assert: ACTION message "/me is generating an image..." sent
   - Assert: ACTION message "/me still working..." sent after 30s
   - Assert: ACTION message "/me this is taking longer..." sent after 60s
   - Assert: Final message shows timeout error after 75s

4. **User Opt-Out (all platforms):**
   - User sends `!settings progress off`
   - User sends `!image a sunset`
   - Assert: No progress messages sent
   - Assert: Only final message delivered

### 7.4. Performance Tests

**Target:** Feedback overhead <100ms

**Metrics:**
- Time from operation start to first progress message
- Message ID lookup latency (in-memory map or Redis)
- Platform API call latency (Slack, Discord)
- End-to-end latency with vs without feedback

**Assertions:**
- P50 feedback latency <50ms
- P99 feedback latency <500ms
- Primary operation latency increase <5%

---

## 8. Rollout Plan

### 8.1. Alpha (Local Dev Only)

**Duration:** 2 days
**Scope:** Local development environment
**Features:** Basic feedback with no-op strategy (logs only, no platform integration)

**Validation:**
- Unit tests pass
- Middleware wraps `next()` correctly
- Logs show progress messages without sending to platforms

### 8.2. Beta (Staging - Internal Users)

**Duration:** 3 days
**Scope:** Staging environment (Slack only)
**Features:** Full Slack integration with typing + editable messages

**Validation:**
- Slack typing indicators appear
- Messages update correctly
- No rate limit issues
- Circuit breaker doesn't trigger

### 8.3. Gamma (Production - Opt-In)

**Duration:** 1 week
**Scope:** Production (all platforms), opt-in via command
**Features:** Full platform support, default disabled, opt-in via `!settings progress on`

**Validation:**
- <1% error rate on progress messages
- User feedback is positive
- No performance degradation (P99 latency <5% increase)

### 8.4. General Availability

**Duration:** Ongoing
**Scope:** Production (all platforms), default enabled
**Features:** All users get progress feedback by default, opt-out via `!settings progress off`

**Monitoring:**
- Progress message success rate >99%
- User opt-out rate <10%
- Circuit breaker trigger rate <1%

---

## 9. Monitoring & Observability

### 9.1. Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `feedback.message.sent` | Counter | Progress messages sent (by platform) | N/A |
| `feedback.message.updated` | Counter | Progress messages updated (by platform) | N/A |
| `feedback.message.failed` | Counter | Progress message failures (by platform, reason) | >1% failure rate |
| `feedback.latency.initial` | Histogram | Time from operation start to first message | P99 >500ms |
| `feedback.latency.update` | Histogram | Time to update progress message | P99 >1s |
| `feedback.circuit_breaker.open` | Counter | Circuit breaker activations | >1 per hour |
| `feedback.user.opt_out` | Gauge | Users with progress disabled | >10% |

### 9.2. Logs

**Structured Logging:**
```typescript
logger.info('feedback.message.sent', {
  platform: 'slack',
  correlationId: '7f3a1b2c...',
  messageId: '1234567890.123456',
  template: 'llm_initial',
  latencyMs: 45
});

logger.warn('feedback.message.failed', {
  platform: 'discord',
  correlationId: '8a4b2c3d...',
  error: 'Rate limit exceeded',
  retryable: false
});

logger.debug('feedback.circuit_breaker.open', {
  failureRate: 0.12,
  totalAttempts: 50,
  resetTime: '2026-07-31T12:00:00Z'
});
```

### 9.3. Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **High Failure Rate** | `feedback.message.failed >1% over 5min` | WARNING | Investigate platform API issues |
| **Circuit Breaker Open** | `feedback.circuit_breaker.open` event | WARNING | Disable feedback globally if sustained |
| **Latency Spike** | `feedback.latency.initial P99 >500ms` | INFO | Check platform API latency |
| **Mass Opt-Out** | `feedback.user.opt_out >20%` | CRITICAL | Investigate UX complaints, disable feature |

---

## 10. Security & Privacy

### 10.1. Data Exposure

**Risk:** Progress messages may reveal internal system state (service names, stages)

**Mitigation:**
- **User-facing templates only:** No internal service names in messages
- **Generic stage names:** "Thinking" instead of "llm-bot.enrichment"
- **No sensitive metadata:** Correlation IDs not shown to users

### 10.2. Rate Limit Abuse

**Risk:** Malicious users trigger expensive operations to spam progress messages

**Mitigation:**
- **Existing rate limits apply:** Image gen has 5-minute cooldown per user
- **Progress message throttling:** Max 5 progress messages per operation
- **Circuit breaker:** Disables feedback if platform APIs fail

### 10.3. Message Injection

**Risk:** User input in progress messages could inject malicious content

**Mitigation:**
- **Static templates:** No user input in progress messages
- **Platform escaping:** Use platform-native APIs (e.g., Slack Blocks, Discord Embeds)
- **No eval/exec:** Templates are static strings, not code

---

## 11. Future Enhancements (Out of Scope)

### 11.1. Streaming LLM Responses

**Goal:** Stream LLM token-by-token to user (like ChatGPT)

**Complexity:** HIGH (requires Vercel AI SDK streaming + platform WebSocket support)

**Dependencies:**
- Slack: Requires WebSocket updates (not supported via Web API)
- Discord: Requires message editing on every token (rate limits)
- Twitch: Not supported (IRC is append-only)

**Sprint:** 380+ (dedicated streaming sprint)

### 11.2. User-Initiated Cancellation

**Goal:** Allow users to abort in-flight operations (e.g., `!cancel`)

**Complexity:** MEDIUM (requires AbortSignal propagation across services)

**Dependencies:**
- Track in-flight operations (correlationId → AbortController map)
- Propagate cancellation across routing slip
- Handle partial completions (e.g., image moderated but not generated)

**Sprint:** 378 (follow-up to this sprint)

### 11.3. Progress Bars / Visual Indicators

**Goal:** Show visual progress (e.g., "Image generation: 60% complete")

**Complexity:** MEDIUM (requires stage-level progress reporting from services)

**Dependencies:**
- Discord Embeds (supports progress bar emoji)
- Slack Blocks (supports progress bar layout)
- Twitch: Not supported (IRC is text-only)

**Sprint:** 379 (UI/UX enhancement sprint)

---

## 12. Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| **User Satisfaction** | >80% positive feedback | Post-sprint user survey |
| **Adoption Rate** | <10% opt-out rate | User preference analytics |
| **Performance Impact** | <5% latency increase | P99 latency comparison (before/after) |
| **Reliability** | >99% progress message success | `feedback.message.failed` metric |
| **Platform Coverage** | 4/4 platforms (Slack, Discord, Twitch, Twilio) | Platform-specific tests pass |
| **Code Quality** | >90% test coverage | Jest coverage report |

---

## 13. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Platform API changes** | MEDIUM | HIGH | Abstract platform logic, version API calls |
| **Rate limit issues** | LOW | MEDIUM | Implement throttling, circuit breaker |
| **User annoyance (too many messages)** | MEDIUM | MEDIUM | Allow opt-out, tune update intervals |
| **Performance degradation** | LOW | HIGH | Async feedback (fire-and-forget), measure latency |
| **Increased complexity** | HIGH | MEDIUM | Comprehensive testing, staged rollout |

---

## 14. References

- **Sprint 371:** Debug Mode (proves multi-message feedback is possible)
- **Vercel AI SDK:** https://sdk.vercel.ai/docs (streaming LLM support)
- **Slack Web API:** https://api.slack.com/methods (chat.postMessage, chat.update)
- **Discord.js:** https://discord.js.org (sendTyping, message.edit)
- **Twitch IRC:** https://dev.twitch.tv/docs/irc (ACTION messages, rate limits)
- **Twilio Conversations API:** https://www.twilio.com/docs/conversations (messages.create)

---

## Appendix A: Example User Flows

### A.1. Image Generation (Optimal - Slack)

**Before (Silent):**
```
User: !image a sunset over mountains
[10 seconds pass]
[20 seconds pass]
[30 seconds pass]
Bot: Image generated! https://storage.googleapis.com/bitbrat-media-gen/abc123.png
```

**After (With Feedback):**
```
User: !image a sunset over mountains
[500ms] Bot: 🎨 Generating your image...
[10s] Bot: 🎨 Still generating... (message edits in place)
[20s] Bot: 🎨 Almost done... (message edits in place)
[30s] Bot: Image generated! https://storage.googleapis.com/bitbrat-media-gen/abc123.png
        (replaces progress message)
```

### A.2. LLM with Multi-Tool (Discord)

**Before (Silent):**
```
User: What's the weather in Paris and London?
[8 seconds pass]
Bot: Paris is 22°C and sunny. London is 18°C and cloudy.
```

**After (With Feedback):**
```
User: What's the weather in Paris and London?
[typing indicator appears]
[1s] Bot: 🤔 Thinking... (embed)
[typing indicator retriggered]
[3s] Bot: 🔧 Checking weather in Paris... (embed updates)
[typing indicator retriggered]
[6s] Bot: 🔧 Checking weather in London... (embed updates)
[8s] Bot: Paris is 22°C and sunny. London is 18°C and cloudy.
      (embed updates with final result)
```

### A.3. Timeout (Twitch)

**Before (Silent):**
```
User: !image an impossibly complex scene with thousands of intricate details
[75 seconds pass]
Bot: Failed to generate image: The operation was aborted
```

**After (With Feedback):**
```
User: !image an impossibly complex scene with thousands of intricate details
[1s] BitBrat: /me is generating an image...
[30s] BitBrat: /me still working on your image...
[60s] BitBrat: /me this is taking longer than usual, but still processing...
[75s] BitBrat: ⏱ Request timed out after 75 seconds. The image was too complex. Try a simpler prompt.
```

---

## Appendix B: Architecture Diagrams

### B.1. Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Feedback System Components                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ Feedback Middleware  │◄─────┐
│  - wrapNext()        │      │
│  - detectLongRunning()│     │
│  - scheduleUpdates() │      │ Injects into Bit.next()
└──────────┬───────────┘      │
           │                   │
           ▼                   │
┌──────────────────────┐      │
│ Progress Message Mgr │      │
│  - sendInitial()     │      │
│  - update()          │      │
│  - cleanup()         │      │
└──────────┬───────────┘      │
           │                   │
           ├──────────────┬────┴───────┬────────────┐
           ▼              ▼            ▼            ▼
    ┌─────────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐
    │   Slack     │ │ Discord  │ │ Twitch  │ │ Twilio   │
    │  Strategy   │ │ Strategy │ │Strategy │ │ Strategy │
    └─────────────┘ └──────────┘ └─────────┘ └──────────┘
           │              │            │            │
           ▼              ▼            ▼            ▼
    ┌─────────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐
    │ Slack Web   │ │ Discord  │ │ Twitch  │ │ Twilio   │
    │    API      │ │ Gateway  │ │   IRC   │ │ Conv API │
    └─────────────┘ └──────────┘ └─────────┘ └──────────┘
```

### B.2. Sequence Diagram (Image Generation with Feedback)

```
User    Event    Feedback    Image     Progress    Slack
        Router   Middleware  Gen MCP   Msg Mgr     API
 │        │          │          │          │          │
 │─!image─▶          │          │          │          │
 │        │──route──▶│          │          │          │
 │        │          │──detect──▶          │          │
 │        │          │          │          │          │
 │        │          │─────send initial─────▶         │
 │        │          │          │          │──typing──▶
 │        │          │          │          │─message──▶
 │        │          │          │          │◀─────ts──┘
 │        │          │          │          │          │
 │        │          │──process─▶          │          │
 │        │          │          │(10s...)  │          │
 │        │          │          │          │          │
 │        │          │─────update (10s)────▶          │
 │        │          │          │          │─update───▶
 │        │          │          │(20s...)  │          │
 │        │          │          │          │          │
 │        │          │─────update (20s)────▶          │
 │        │          │          │          │─update───▶
 │        │          │          │◀complete─┤          │
 │        │          │          │          │          │
 │        │          │─────final update────▶          │
 │        │          │          │          │─update───▶
 │◀───────────────────────────────────────────────────┘
```

---

**END OF TECHNICAL ARCHITECTURE**
