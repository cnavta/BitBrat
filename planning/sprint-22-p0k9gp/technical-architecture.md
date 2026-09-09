# Technical Architecture: Agent Progress Update MCP Tool
## Sprint 22 (sprint-22-p0k9gp)

**Architect**: Claude Code (Architect Role)
**Owner**: claude
**Created**: 2026-08-21
**Status**: Planning

---

## Executive Summary

This document provides a comprehensive technical architecture for implementing an internal MCP tool that enables agents (like llm-bot) to proactively send progress updates to requestors before initiating long-running operations. The goal is to improve user experience by providing immediate feedback when operations will take time, reducing perceived latency and setting expectations.

**Current State**: FeedbackMiddleware (Sprint 377/21) provides automatic progress messages based on elapsed time thresholds after operations start, but agents cannot proactively signal intent before starting work.

**Target State**: Internal MCP tool (`agent.sendProgressUpdate`) available to all platform Bits, enabling explicit progress communication before long-running tasks.

**Key Deliverables**:
1. New internal MCP tool `agent.sendProgressUpdate` on tool-gateway Bit
2. Tool registered as platform-internal tool (alongside domain tool proxying)
3. Comprehensive test coverage (unit + integration)
4. Documentation and usage examples

**Out of Scope** (deferred to future sprints):
- Agent integration (llm-bot, reflex, etc.)
- Time estimation heuristics
- Egress enhancements (annotation handling, urgency-based delivery)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current State Analysis](#2-current-state-analysis)
3. [Requirements](#3-requirements)
4. [Architecture Principles](#4-architecture-principles)
5. [Proposed Architecture](#5-proposed-architecture)
6. [Detailed Design](#6-detailed-design)
7. [Implementation Plan](#7-implementation-plan)
8. [Testing Strategy](#8-testing-strategy)
9. [Deployment Strategy](#9-deployment-strategy)
10. [Success Metrics](#10-success-metrics)
11. [Future Enhancements](#11-future-enhancements)

---

## 1. Problem Statement

### 1.1 User Experience Gap

When an agent receives a request that requires significant processing time (e.g., LLM inference, tool execution, data retrieval), the user experiences a period of silence before receiving any feedback. This creates:

- **Perceived abandonment**: User doesn't know if their request was received
- **Uncertainty**: User doesn't know if processing is happening or if there's an error
- **Poor UX**: No indication of expected wait time or what's happening

### 1.2 Current Mitigation (Sprint 377/21)

The platform has FeedbackMiddleware that **automatically** sends progress messages based on elapsed time thresholds:

```typescript
// Automatic thresholds
initialThresholdMs: 2000,      // First message after 2s
updateIntervalMs: 5000,        // Updates every 5s
timeoutThresholdMs: 30000,     // Timeout warning at 30s
```

**Limitations**:
1. **Reactive, not proactive**: Messages only appear after time has elapsed
2. **No agent control**: Agent cannot signal "about to start expensive work"
3. **Generic messages**: Templates like "🤔 Thinking about your request..." don't convey specific intent
4. **Timing mismatch**: For operations that take <2s but feel long (network calls), no feedback is sent

### 1.3 The Gap

Agents need a way to **proactively** communicate progress **before** starting long-running work:

```typescript
// Agent knows this will take time - tell user immediately
await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: 'Analyzing your code across 3 repositories...',
});
// Now start the expensive operation
const result = await expensiveMultiRepoAnalysis();
```

---

## 2. Current State Analysis

### 2.1 Existing Progress Mechanisms

#### A. FeedbackMiddleware (Sprint 377/21)

**Location**: `src/common/middleware/feedback-middleware.ts` (518 lines)

**Mechanism**:
- Intercepts events in `Bit.next()` before publication
- Detects `operation_context` annotation with `startedAt` timestamp
- Tracks elapsed time and emits progress at thresholds
- Publishes template messages directly to `internal.egress.v1`

**Activation Pattern**:
```typescript
// Service adds operation_context annotation
event.annotations.push({
  kind: 'operation_context',
  value: JSON.stringify({
    operation: 'llm_inference',
    startedAt: Date.now(),
    parameters: { model: 'gpt-4' }
  }),
  source: 'llm-bot',
  id: randomUUID(),
  createdAt: new Date().toISOString()
});

// Middleware detects annotation and tracks operation
await this.next(event);
```

**Output**: Creates egress event with template message:
```typescript
{
  v: '2',
  type: 'internal.egress.v1',
  message: { role: 'assistant', text: '🤔 Thinking about your request...' },
  annotations: [{
    kind: 'progress_feedback',
    value: JSON.stringify({ originalCorrelationId, stage, elapsedMs })
  }]
}
```

#### B. Debug Mode Updates (Sprint 371)

**Location**: `src/common/base-server.ts:1088-1126`

**Mechanism**:
- When `metadata.debug.enabled` is true on event
- Sends routing progress updates via `sendDebugUpdate()`
- Shows step transitions: `Step: router → llm-bot`

**Purpose**: Developer observability, not user-facing progress

#### C. Egress Direct Publishing

**Location**: `src/common/base-server.ts:1174-1230` (`complete()` method)

**Mechanism**:
- Services can bypass routing slip and publish directly to egress
- Used for final responses, error messages, completion notifications

**Pattern**:
```typescript
const responseEvent: InternalEventV2 = {
  v: '2',
  type: 'internal.egress.v1',
  correlationId: randomUUID(),
  message: { role: 'assistant', text: 'Response text' },
  ingress: originalEvent.ingress,
  egress: originalEvent.egress,
  // ... routing, identity, etc.
};
await this.publish('internal.egress.v1', responseEvent);
```

### 2.2 MCP Tool Infrastructure

#### A. Bit Model MCP Control Plane (Sprint 324)

**Location**: `src/common/base-server.ts:119-142`

Every Bit exposes MCP control plane via:
- `mcpExposure: 'platform-only'` - Universal `bit.*` control tools only
- `mcpExposure: 'platform+domain'` - Control tools + domain-specific tools

**Tool Registration**:
```typescript
protected registerTool(
  name: string,
  description: string,
  schema: z.ZodType,
  handler: (args: any) => Promise<CallToolResult>
): void
```

**Discovery**: Tools registered on `internal.mcp.registration.v1` topic

#### B. Tool Gateway (tool-gateway.ts)

**Role**: MCP proxy/router for all platform tools

- Discovers Bits via `internal.mcp.registration.v1` subscription
- Maintains `ToolRegistry` with all available tools
- Enforces RBAC on tool execution
- Routes tool calls to appropriate Bit MCP servers

#### C. McpClientProfile (Capability Profile)

**Location**: `src/common/profiles/mcp-client-profile.ts`

**Provides**:
- `this.mcpClient.callTool(name, args)` - Call any registered MCP tool
- `this.mcpClient.manager` - McpClientManager for server connections
- `this.mcpClient.registry` - Shared ToolRegistry

**Used By**: llm-bot, tool-gateway, any Bit needing to call MCP tools

### 2.3 Tool-Gateway Architecture

**Location**: `src/apps/tool-gateway.ts`

**Role**: MCP proxy/orchestrator for the platform:
1. **Domain Tools**: Proxies MCP tools from registered Bits (obs-mcp, scheduler, etc.)
2. **RBAC**: Enforces role-based access control on tool execution
3. **Session Management**: Maintains session context for connected agents
4. **Registry**: Discovers and tracks all available tools via `internal.mcp.registration.v1`

**Current MCP Exposure**: `platform+domain` (serves both control plane and domain tools)

**Session Context** (Existing):
```typescript
// tool-gateway.ts
private sessionContexts: Map<string, SessionContext> = new Map();

// When agent connects via MCP
this.sessionContexts.set(sessionId, {
  bitName: 'llm-bot',
  currentEvent: event,  // ← Event being processed
  roles: event.identity.user?.roles || [],
  timestamp: Date.now()
});
```

**Key Insight**: tool-gateway already maintains session context with the current event for each connected agent, making it the natural location for platform-internal tools that need event context.

---

## 3. Requirements

### 3.1 Functional Requirements

**FR1**: Agent Bits MUST be able to send progress updates before starting long-running operations

**FR2**: Progress updates MUST be delivered to the original requestor (same channel/user)

**FR3**: Progress updates MUST support custom messages (not just templates)

**FR4**: Progress updates MUST NOT require annotation/middleware scaffolding

**FR5**: Tool MUST be callable from any Bit with McpClientProfile capability

**FR6**: Tool MUST extract egress context from the calling event automatically

**FR7**: Tool MUST be non-blocking (fire-and-forget semantics acceptable)

**FR8**: Tool MUST handle missing/malformed egress gracefully (log warning, don't throw)

### 3.2 Non-Functional Requirements

**NFR1**: Progress update delivery MUST complete within 500ms (not block agent processing)

**NFR2**: Tool MUST be idempotent (safe to call multiple times)

**NFR3**: Tool MUST follow platform MCP tool conventions (Zod schema, error handling)

**NFR4**: Tool MUST integrate with existing observability (structured logging, correlationId)

**NFR5**: Tool MUST NOT create circular dependencies between services

**NFR6**: Tool MUST be backward compatible (existing code unaffected)

### 3.3 Constraints

**C1**: Tool MUST be internal-only (not exposed to external LLM agents via tool-gateway)

**C2**: Tool MUST NOT bypass platform security/RBAC mechanisms

**C3**: Tool MUST use existing egress infrastructure (no new delivery paths)

**C4**: Tool MUST NOT introduce new persistence requirements

**C5**: Implementation MUST fit within Sprint 22 scope (2-3 days)

---

## 4. Architecture Principles

### 4.1 Leverage Existing Infrastructure

- Reuse MCP tool registration and discovery patterns
- Reuse connector infrastructure for message delivery
- Reuse `Bit.next()` routing logic (not direct egress publish)
- Minimize new abstractions

### 4.2 Respect Platform Safeguards

**CRITICAL DESIGN DECISION**: Progress events MUST flow through `Bit.next()` rather than direct egress publishing.

**Rationale**:
- ✅ Applies FeedbackMiddleware (prevents duplicate progress messages)
- ✅ Applies debug logging (qos.tracer support)
- ✅ Applies candidate selection (marks selected candidate)
- ✅ Applies persistence snapshots (observability)
- ✅ Respects platform routing conventions
- ❌ Direct egress publish bypasses all safeguards

**Implementation**:
```typescript
// CORRECT: Use next() with empty slip
const event = { ...progressEvent, routing: { slip: [], ... } };
await this.next(event); // Routes through safeguards → egress

// WRONG: Direct publish bypasses safeguards
await this.publish('internal.egress.v1', event); // ❌ NEVER DO THIS
```

### 4.3 Platform-Internal Tool Pattern

- Tool registered directly on tool-gateway (not proxied from another Bit)
- Distinct from domain tools (which are proxied from other Bits)
- Available to all platform Bits via tool-gateway MCP server
- NOT exposed to external LLM agents (tool-gateway filters by tool source)
- Pattern enables future platform-internal tools (approval, escalation, etc.)

### 4.4 Event-Driven Design

- Tool creates new event (not mutation of original)
- Follows envelope v2 schema contracts
- Progress text goes in `candidates` (standard pattern)
- Empty `routing.slip` signals "route to egress"
- Preserves correlationId for observability
- Uses distinct correlationId for progress event (not duplicate)

### 4.5 Graceful Degradation

- Missing egress context logs warning but doesn't throw
- Connector delivery failures don't crash caller
- Invalid parameters return descriptive errors
- next() failures caught and returned as tool errors

### 4.6 Developer Ergonomics

- Simple call signature: `{ message: string, context?: object }`
- Automatic extraction of egress from event context
- Clear, actionable error messages

---

## 5. Proposed Architecture

### 5.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       LLM-BOT (Agent Bit)                       │
│  - Receives user request on internal.bot.requests.v1           │
│  - Knows operation will take time (LLM inference, tool calls)  │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ 1. Call MCP tool
             │    this.mcpClient.callTool('agent.sendProgressUpdate', {
             │      message: 'Analyzing your request...'
             │    })
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│              TOOL-GATEWAY (MCP Orchestrator)                    │
│                                                                 │
│  Platform-Internal Tools (direct handlers):                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Tool: agent.sendProgressUpdate                            │ │
│  │                                                           │ │
│  │ Handler:                                                  │ │
│  │   1. Get session context (already available!)            │ │
│  │      session = this.sessionContexts.get(sessionId)       │ │
│  │      event = session.currentEvent                        │ │
│  │   2. Build InternalEventV2 with progress as candidate    │ │
│  │   3. Set routing.slip = [] (no routing needed)           │ │
│  │   4. Call this.next(progressEvent)                       │ │
│  │      → Bit.next() sees empty slip, routes to egress      │ │
│  │   5. Return success                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Domain Tools (proxied):                                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ obs.*, scheduler.*, etc. → Proxied to respective Bits    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  │                                                              │
│  │ 2. this.next(progressEvent)                                 │
│  │    ↓ Bit base class routing logic                           │
│  │    ↓ Empty slip detected → route to egress destination     │
│  ▼                                                              │
│                                                                 │
│  Routing Logic (Bit.next()):                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ - Check routing.slip (empty = go to egress)              │ │
│  │ - Apply FeedbackMiddleware (if configured)               │ │
│  │ - Apply debug logging (if qos.tracer)                    │ │
│  │ - Publish to egress.destination                          │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ 3. Publish to egress destination
             │    Topic: internal.egress.v1
             │    (via standard Bit.next() path)
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NATS MESSAGE BUS                             │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ 4. Deliver event
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│              INGRESS-EGRESS (Egress Handler)                    │
│                                                                 │
│  - Receives egress event                                       │
│  - Detects progress_update candidate annotation                │
│  - Extracts connector (twitch/discord/slack)                   │
│  - Extracts channel/destination                                │
│  - Calls connector.sendMessage()                               │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ 5. Deliver to platform
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│           EXTERNAL PLATFORM (Twitch/Discord/Slack)              │
│                                                                 │
│  User sees: "🔄 Analyzing your request..."                     │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Component Responsibilities

#### A. Agent Bit (llm-bot, reflex, etc.)

**Responsibility**: Detect long-running operation intent, call tool

**Code Location**: Service-specific (e.g., `src/apps/llm-bot-service.ts`)

**Pattern**:
```typescript
// Before starting expensive operation
await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: '🔄 Analyzing your request with GPT-4...',
  context: {
    operation: 'llm_inference',
    model: 'gpt-4',
    estimatedSeconds: 5
  }
});

// Now proceed with operation
const llmResponse = await processLlmRequest(event);
```

#### B. Tool-Gateway (New Platform-Internal Tool)

**Responsibility**: Register platform-internal tool, extract session context, route progress event

**Code Location**: `src/apps/tool-gateway.ts` (new methods)

**Implementation**:
```typescript
// In setup() or constructor
private registerPlatformTools() {
  // Platform-internal tool: Progress updates
  this.registerTool(
    'agent.sendProgressUpdate',
    'Send progress update to user before long-running operation',
    z.object({
      message: z.string().describe('Progress message to show user'),
      context: z.record(z.any()).optional().describe('Optional metadata')
    }),
    async (args, extra) => {
      return await this.handleSendProgressUpdate(args, extra);
    }
  );

  // Future: agent.requestApproval, agent.escalate, etc.
}

private async handleSendProgressUpdate(
  args: { message: string; context?: Record<string, any> },
  extra?: { sessionId?: string }
): Promise<CallToolResult> {
  // Session context already available!
  const session = this.sessionContexts.get(extra?.sessionId || '');
  const originalEvent = session?.currentEvent;

  // Build progress event and route via this.next()
  // Implementation in Section 6
}
```

**Why tool-gateway**:
- Already has session context with current event
- Natural home for platform-internal tools
- No extra MCP hop (direct handler)
- Separates platform tools from domain tool proxying

#### C. Ingress-Egress (Egress Handler)

**Responsibility**: Detect progress_update annotation, deliver message to platform

**Code Location**: `src/apps/ingress-egress-service.ts:handleEgressEvent`

**Enhancement**: Add annotation-based priority/styling for progress messages (optional)

---

## 6. Detailed Design

### 6.1 Tool Schema

```typescript
import { z } from 'zod';

const SendProgressUpdateSchema = z.object({
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message too long (max 500 chars)')
    .describe('Progress message to display to user'),

  context: z.record(z.any())
    .optional()
    .describe('Optional metadata for logging/observability'),

  emoji: z.string()
    .optional()
    .describe('Optional emoji override (default: 🔄)'),

  urgency: z.enum(['low', 'normal', 'high'])
    .optional()
    .default('normal')
    .describe('Message urgency level')
});

type SendProgressUpdateArgs = z.infer<typeof SendProgressUpdateSchema>;
```

### 6.2 Tool Handler Implementation

```typescript
/**
 * MCP Tool: agent.sendProgressUpdate
 *
 * Allows agent Bits to send progress updates to the requestor before
 * starting long-running operations.
 *
 * Context Extraction:
 * - Tool handler receives 'extra' parameter with session context
 * - Session context includes original event that triggered agent
 * - Extract ingress/egress/identity from original event
 *
 * @param args - Tool arguments (message, context, emoji, urgency)
 * @param extra - MCP session context with original event
 */
private async handleSendProgressUpdate(
  args: SendProgressUpdateArgs,
  extra?: { event?: InternalEventV2; sessionId?: string }
): Promise<CallToolResult> {
  const logger = this.getLogger();

  logger.info('agent.sendProgressUpdate.called', {
    message: args.message,
    contextKeys: Object.keys(args.context || {}),
    sessionId: extra?.sessionId
  });

  // 1. Validate that we have event context
  const originalEvent = extra?.event;
  if (!originalEvent) {
    logger.warn('agent.sendProgressUpdate.missing_event_context', {
      message: args.message,
      sessionId: extra?.sessionId
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: No event context available. Progress update not sent.'
      }],
      isError: false // Not a hard error - graceful degradation
    };
  }

  // 2. Validate egress destination exists
  if (!originalEvent.egress?.destination) {
    logger.warn('agent.sendProgressUpdate.missing_egress', {
      correlationId: originalEvent.correlationId,
      message: args.message
    });
    return {
      content: [{
        type: 'text',
        text: 'Warning: No egress destination. Progress update not sent.'
      }],
      isError: false
    };
  }

  // 3. Build progress event with message as candidate
  const progressText = args.emoji
    ? `${args.emoji} ${args.message}`
    : `🔄 ${args.message}`;

  const progressEvent: InternalEventV2 = {
    v: '2',
    correlationId: randomUUID(), // New correlation for progress message
    type: 'chat.message.v1', // Internal event type

    // Preserve original ingress context
    ingress: {
      ...originalEvent.ingress,
      ingressAt: new Date().toISOString() // Progress event timestamp
    },

    // Preserve original identity
    identity: originalEvent.identity,

    // Preserve original egress destination
    egress: originalEvent.egress,

    // NO message field - progress goes in candidate

    // Routing: Empty slip = next() routes to egress
    routing: {
      stage: 'response',
      slip: [],  // CRITICAL: Empty slip signals "route to egress"
      history: []
    },

    // Progress message as candidate (standard platform pattern)
    candidates: [
      {
        id: randomUUID(),
        kind: 'text',
        source: 'ingress-egress',
        createdAt: new Date().toISOString(),
        status: 'proposed', // Will be marked 'selected' by next()
        priority: 1,
        text: progressText,
        format: 'plain',
        reason: 'agent.sendProgressUpdate tool'
      }
    ],

    // Annotations for observability + delivery hints
    annotations: [
      {
        kind: 'progress_update',
        value: JSON.stringify({
          originalCorrelationId: originalEvent.correlationId,
          urgency: args.urgency || 'normal',
          source: 'agent.sendProgressUpdate',
          ...args.context
        }),
        source: 'ingress-egress',
        id: randomUUID(),
        createdAt: new Date().toISOString()
      }
    ],

    // Metadata linking to original request
    metadata: {
      originalCorrelationId: originalEvent.correlationId,
      progressUpdate: true
    }
  };

  // 4. Use next() to route through standard platform flow
  // This applies all safeguards: FeedbackMiddleware, debug logging,
  // candidate selection, egress routing
  try {
    await this.next(progressEvent);

    logger.info('agent.sendProgressUpdate.routed', {
      progressCorrelationId: progressEvent.correlationId,
      originalCorrelationId: originalEvent.correlationId,
      destination: originalEvent.egress.destination,
      connector: originalEvent.egress.connector,
      message: progressText
    });

    return {
      content: [{
        type: 'text',
        text: `Progress update sent: "${args.message}"`
      }]
    };
  } catch (error: any) {
    logger.error('agent.sendProgressUpdate.next_failed', {
      error: error.message,
      stack: error.stack,
      correlationId: originalEvent.correlationId
    });

    return {
      content: [{
        type: 'text',
        text: `Error sending progress update: ${error.message}`
      }],
      isError: true
    };
  }
}
```

### 6.3 Event Context Propagation

**Challenge**: How does the tool handler access the original event?

**Solution**: Tool-gateway's existing session context map (simpler than MCP extra passing!)

#### A. Tool Call Flow

When llm-bot calls the tool:

```typescript
// llm-bot makes MCP tool call
const result = await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: 'Processing your request...'
});
```

This translates to HTTP POST to tool-gateway's MCP endpoint.

#### B. Session Context (tool-gateway.ts: ALREADY EXISTS)

Tool-gateway maintains session context for each connected agent:

```typescript
// tool-gateway.ts (existing)
private sessionContexts: Map<string, SessionContext> = new Map();

// When llm-bot connects via MCP (existing code)
this.sessionContexts.set(sessionId, {
  bitName: 'llm-bot',
  currentEvent: event,  // ← The event llm-bot is processing!
  roles: event.identity.user?.roles || [],
  timestamp: Date.now()
});
```

#### C. Direct Access in Handler (tool-gateway.ts: NEW)

```typescript
// tool-gateway.ts (new platform-internal tool handler)
private async handleSendProgressUpdate(
  args: { message: string; context?: Record<string, any> },
  extra?: { sessionId?: string }
): Promise<CallToolResult> {
  // Direct access to session context - no MCP extra passing needed!
  const session = this.sessionContexts.get(extra?.sessionId || '');
  const originalEvent = session?.currentEvent;

  if (!originalEvent) {
    this.logger.warn('agent.sendProgressUpdate.missing_session', {
      sessionId: extra?.sessionId
    });
    return {
      content: [{ type: 'text', text: 'Warning: No session context' }],
      isError: false
    };
  }

  // Build progress event from originalEvent
  const progressEvent = buildProgressEvent(originalEvent, args);

  // Route through platform safeguards
  await this.next(progressEvent);

  return {
    content: [{ type: 'text', text: `Progress update sent: "${args.message}"` }]
  };
}
```

**Key Insight**: Since the tool lives on tool-gateway, we have **direct access** to session context. No need to pass event through MCP extra parameter - it's already in `this.sessionContexts`!

### 6.4 Ingress-Egress Egress Handler (Optional Enhancement)

**Location**: `src/apps/ingress-egress-service.ts:handleEgressEvent`

**Current Behavior**: Delivers all egress messages uniformly (no changes required)

**Optional Enhancement**: Detect progress_update annotation for priority/styling

```typescript
// OPTIONAL: Add in Phase 3 if needed
private async handleEgressEvent(event: InternalEventV2, attrs: any, ctx: any) {
  try {
    const connector = this.connectorManager.getConnector(event.egress.connector);
    const message = event.message?.text || this.selectCandidateText(event);

    // OPTIONAL: Detect progress update annotation
    const progressAnnotation = event.annotations?.find(a => a.kind === 'progress_update');
    const isProgressUpdate = !!progressAnnotation;

    // OPTIONAL: Apply urgency-based styling/priority
    let deliveryOptions = {};
    if (isProgressUpdate && progressAnnotation?.value) {
      try {
        const metadata = JSON.parse(progressAnnotation.value as string);
        deliveryOptions = {
          priority: metadata.urgency === 'high' ? 'high' : 'normal',
          ephemeral: metadata.urgency === 'low', // Low urgency = ephemeral
        };
      } catch (e) {
        // Ignore malformed annotation
      }
    }

    // Deliver message (existing code)
    await connector.sendMessage(
      event.egress.channel || event.egress.destination,
      message,
      deliveryOptions
    );

    this.logger.info('egress.delivered', {
      correlationId: event.correlationId,
      connector: event.egress.connector,
      isProgressUpdate,
      messageLength: message?.length || 0
    });

    await ctx.ack();
  } catch (error: any) {
    this.logger.error('egress.delivery_failed', {
      correlationId: event.correlationId,
      error: error.message
    });
    await ctx.ack();
  }
}
```

**Note**: This enhancement is **optional**. Progress messages work fine without it - the annotation is primarily for observability.

### 6.5 Integration Pattern (llm-bot Example)

**Location**: `src/apps/llm-bot-service.ts`

**Pattern**: Call tool before starting LLM inference

```typescript
private async handleBotRequest(event: InternalEventV2) {
  const prompt = this.extractPrompt(event);

  // Estimate if this will take time
  const willTakeTime = this.estimateProcessingTime(prompt) > 1000; // >1s

  if (willTakeTime) {
    try {
      // Send progress update immediately
      await this.mcpClient.callTool('agent.sendProgressUpdate', {
        message: 'Analyzing your request...',
        context: {
          operation: 'llm_inference',
          promptLength: prompt.length,
          model: this.config.openaiModel
        }
      });
    } catch (error: any) {
      // Don't let progress update failure block processing
      this.logger.warn('llm_bot.progress_update_failed', {
        error: error.message,
        correlationId: event.correlationId
      });
    }
  }

  // Proceed with LLM processing
  const response = await this.processLlmRequest(event, prompt);

  // Send final response
  await this.next(response);
}

private estimateProcessingTime(prompt: string): number {
  // Heuristic: character count, tool calls, complexity
  const baseTime = 500; // 500ms baseline
  const charTime = prompt.length * 2; // 2ms per character
  const toolTime = this.willUseTools(prompt) ? 3000 : 0;
  return baseTime + charTime + toolTime;
}
```

### 6.6 Error Handling

**Philosophy**: Graceful degradation - progress update failures should never block agent processing

**Error Categories**:

| Error | Handling | Log Level | User Impact |
|-------|----------|-----------|-------------|
| Missing event context | Return warning, don't publish | `warn` | No progress message |
| Missing egress | Return warning, don't publish | `warn` | No progress message |
| Publish failed | Log error, return error result | `error` | No progress message |
| Invalid schema | Throw validation error | `error` | Tool call fails |
| Connector delivery failed | Log error, ack message | `error` | No progress message |

**Agent-Side Handling**:
```typescript
try {
  await this.mcpClient.callTool('agent.sendProgressUpdate', { message: '...' });
} catch (error) {
  // Log but don't rethrow - never block on progress updates
  this.logger.warn('progress_update_failed', { error: error.message });
}
// Continue with actual work
```

---

## 7. Implementation Plan

### Phase 1: Core Tool Implementation (Day 1)

**Tasks**:
1. Add `registerPlatformTools()` method to `tool-gateway.ts`
2. Implement tool schema with Zod validation
3. Implement `handleSendProgressUpdate()` handler method
4. Add session context extraction logic
5. Build progress event with candidate pattern
6. Add structured logging throughout

**Deliverables**:
- Tool registered on tool-gateway
- Platform-internal tool pattern established
- Basic unit tests for schema validation
- Handler logs structured events

### Phase 2: Event Building & Routing (Day 1-2)

**Tasks**:
1. Implement progress event builder (with candidates, empty slip)
2. Verify `this.next()` routing with empty slip works correctly
3. Add session context validation and error handling
4. Add integration test for full flow (llm-bot → tool-gateway → egress)
5. Verify FeedbackMiddleware doesn't interfere with progress messages

**Deliverables**:
- Progress events correctly routed to egress
- Session context extraction works
- Integration test validates end-to-end
- Error cases handled gracefully

### Phase 3: Egress Enhancement (Optional - Day 2)

**Tasks**:
1. Add progress_update annotation detection in egress handler (optional)
2. Implement optional urgency-based delivery options (optional)
3. Add telemetry for progress message delivery
4. Test with all connectors (Twitch, Discord, Slack)

**Deliverables**:
- Progress messages delivered to all platforms
- Observability shows delivery success/failure
- Connector-specific tests pass

### Phase 4: Agent Integration (Day 2)

**Tasks**:
1. Add `mcpClient.callTool()` calls to llm-bot before LLM inference
2. Add heuristic for when to send progress updates
3. Add try/catch to prevent progress failures from blocking
4. Test with real user scenarios (chat, DM, commands)

**Deliverables**:
- llm-bot sends progress for long operations
- No regressions in existing flows
- User sees progress messages in <500ms

### Phase 5: Testing & Documentation (Day 3)

**Tasks**:
1. Unit tests for tool handler (schema, context, edge cases)
2. Integration tests for full flow (agent → tool → egress → platform)
3. Update documentation (CLAUDE.md, guides)
4. Add examples for other agent Bits

**Deliverables**:
- 90%+ test coverage
- Documentation updated
- Usage examples provided

---

## 8. Testing Strategy

### 8.1 Unit Tests

**File**: `src/apps/__tests__/tool-gateway-progress-tool.test.ts`

**Coverage**:
```typescript
describe('agent.sendProgressUpdate Tool', () => {
  describe('Schema Validation', () => {
    it('should accept valid message', () => {});
    it('should reject empty message', () => {});
    it('should reject message >500 chars', () => {});
    it('should accept optional context', () => {});
    it('should accept optional emoji', () => {});
    it('should default urgency to normal', () => {});
  });

  describe('Handler Logic', () => {
    it('should publish egress event with progress annotation', () => {});
    it('should preserve original ingress/egress/identity', () => {});
    it('should use new correlationId for progress event', () => {});
    it('should include originalCorrelationId in metadata', () => {});
    it('should prepend emoji to message', () => {});
    it('should use custom emoji if provided', () => {});
  });

  describe('Error Handling', () => {
    it('should warn if event context missing', () => {});
    it('should warn if egress missing', () => {});
    it('should return error if publish fails', () => {});
    it('should not throw on graceful failures', () => {});
  });

  describe('Observability', () => {
    it('should log tool invocation', () => {});
    it('should log successful publish', () => {});
    it('should log warnings for missing context', () => {});
    it('should log errors for publish failures', () => {});
  });
});
```

### 8.2 Integration Tests

**File**: `src/apps/__tests__/progress-update-integration.test.ts`

**Coverage**:
```typescript
describe('Progress Update Integration', () => {
  it('should send progress from llm-bot to user', async () => {
    // 1. Simulate user message
    // 2. llm-bot receives event
    // 3. llm-bot calls agent.sendProgressUpdate
    // 4. Verify egress event published
    // 5. Verify message delivered to connector
  });

  it('should handle multiple progress updates', async () => {});
  it('should work across all connectors (twitch/discord/slack)', async () => {});
  it('should preserve correlationId chain for observability', async () => {});
  it('should not block on progress failures', async () => {});
});
```

### 8.3 Manual Testing (agent-dev)

**Scenarios**:
1. Chat message → llm-bot → progress → LLM response
2. DM → llm-bot → progress → LLM response
3. Command → llm-bot → progress → LLM response
4. Multiple progress updates in single flow
5. Progress update with custom emoji
6. Progress update failure (missing egress)

**Validation**:
- User sees progress message within 500ms
- Progress message appears before final response
- Message formatting correct (emoji, text)
- Logs show correlationId chain

---

## 9. Deployment Strategy

### 9.1 Deployment Phases

**Phase 1: Deploy tool-gateway**
- New platform-internal tool registered
- Backward compatible (no breaking changes)
- Tool available to all agents immediately

**Phase 2: Deploy llm-bot**
- Calls new tool before LLM inference
- Graceful fallback if tool-gateway unavailable
- Monitor progress message delivery

**Phase 3: Rollout to Other Agents**
- reflex, query-analyzer, stream-analyst
- Same integration pattern
- Monitor across all agents

### 9.2 Rollout Plan

**Week 1**: agent-dev validation
- Deploy to agent-dev-sprint-22
- Test all scenarios
- Verify observability

**Week 2**: Staging deployment
- Deploy ingress-egress to staging
- Deploy llm-bot to staging
- Monitor for 48h

**Week 3**: Production rollout
- Deploy ingress-egress to production
- Deploy llm-bot to production (10% traffic)
- Ramp to 100% over 3 days
- Monitor error rates, latency

### 9.3 Rollback Plan

**Trigger**: Error rate >1% OR latency regression >200ms

**Rollback Steps**:
1. Disable progress calls in llm-bot (env var `ENABLE_PROGRESS_UPDATES=false`)
2. Redeploy llm-bot without tool calls (tool-gateway unchanged)
3. Investigate root cause
4. Fix and re-deploy

**Rollback Time**: <10 minutes (config change + redeploy llm-bot only)

**Note**: No tool-gateway rollback needed - platform-internal tools are additive

### 9.4 Monitoring

**Metrics**:
- `agent.sendProgressUpdate.calls` (counter)
- `agent.sendProgressUpdate.success` (counter)
- `agent.sendProgressUpdate.errors` (counter)
- `agent.sendProgressUpdate.duration_ms` (histogram)
- `egress.progress_update.delivered` (counter)

**Alerts**:
- Error rate >5% over 5 minutes
- p99 latency >1000ms
- Tool unavailable (0 calls for 10 minutes)

**Dashboards**:
- Progress update funnel (calls → publishes → deliveries)
- Error breakdown (missing context, publish failures, delivery failures)
- Latency distribution
- Per-connector delivery rates

---

## 10. Success Metrics

### 10.1 Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tool call latency (p50) | <100ms | CloudWatch/logs |
| Tool call latency (p99) | <500ms | CloudWatch/logs |
| Egress publish latency | <50ms | Logs |
| End-to-end delivery | <500ms | Integration tests |
| Error rate | <1% | Logs/metrics |

### 10.2 Adoption Metrics

| Metric | Target | Timeline |
|--------|--------|----------|
| llm-bot integration | 100% | Week 2 |
| Other agent Bits | 50% | Week 4 |
| Progress messages/day | >100 | Week 3 |
| User-facing delivery | >95% | Week 3 |

### 10.3 Quality Metrics

| Metric | Target | Verification |
|--------|--------|--------------|
| Test coverage | >90% | Jest reports |
| Integration tests | >5 scenarios | CI/CD |
| Documentation | Complete | Code review |
| Zero regressions | 100% | Existing tests |

### 10.4 User Experience Metrics

| Metric | Target | Method |
|--------|--------|--------|
| Perceived responsiveness | Improved | User feedback |
| Timeout complaints | -50% | Support tickets |
| "Is it working?" questions | -75% | Chat logs |

---

## 11. Future Enhancements

### 11.0 Platform-Internal Tool Pattern (Sprint 23+)

**Pattern Established**: Tool-gateway now hosts two categories of tools:

```typescript
// tool-gateway.ts
export class ToolGatewayServer extends Bit {
  // Platform-Internal Tools (direct handlers, not proxied)
  private registerPlatformTools() {
    this.registerTool('agent.sendProgressUpdate', ...);
    this.registerTool('agent.requestApproval', ...);      // Future
    this.registerTool('agent.escalateToHuman', ...);      // Future
    this.registerTool('platform.rateLimit.check', ...);   // Future
  }

  // Domain Tools (proxied from other Bits)
  private async setupRegistryWatcher() {
    // Discovers obs.*, scheduler.*, etc. from other Bits
  }
}
```

**When to Extract to platform-mcp Bit**:
- When platform-internal tools exceed ~5 tools
- When tool complexity requires dedicated testing/deployment
- When tool logic needs isolation from gateway concerns

**Migration Path** (Sprint 25+):
```yaml
# architecture.yaml
services:
  platform-mcp:
    category: platform
    profile: core
    mcp:
      exposure: platform-only
    description: Platform-internal MCP tools for agent orchestration
```

Tool-gateway would then proxy platform-internal tools from platform-mcp, just like it proxies domain tools from obs-mcp.

### 11.1 Phase 2: Rich Progress Messages (Sprint 23+)

**Feature**: Support rich formatting, progress bars, estimated completion

```typescript
await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: 'Analyzing repositories...',
  progress: { current: 1, total: 3 },
  estimatedSeconds: 15,
  format: 'rich' // Enables platform-specific rich messages
});
```

**Output**:
```
🔄 Analyzing repositories... [█░░] 33% (~15s remaining)
```

### 11.2 Phase 3: Progress Streams (Sprint 24+)

**Feature**: Multiple progress updates in sequence

```typescript
const progress = this.createProgressStream();
await progress.update('Fetching data from API...');
await doApiCall();
await progress.update('Processing results...');
await processData();
await progress.complete('Analysis complete!');
```

### 11.3 Phase 4: LLM-Generated Progress (Sprint 25+)

**Integration**: Connect to FeedbackMiddleware for LLM-enhanced messages

```typescript
await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: 'Analyzing your request...',
  useLLM: true, // Generate contextual message via LLM
  context: { originalQuery: event.message.text }
});
```

**Output**: Personalized progress based on user's original request

### 11.4 Phase 5: Client-Side Progress (Sprint 26+)

**Feature**: Platform-native progress indicators (Discord embeds, Slack attachments)

```typescript
await this.mcpClient.callTool('agent.sendProgressUpdate', {
  message: 'Analyzing...',
  clientHints: {
    discord: { type: 'embed', color: 'blue' },
    slack: { type: 'attachment', updateMessage: true }
  }
});
```

---

## Appendix A: Alternative Architectures Considered

### Alt 1: Direct Egress Publish from Agent

**Approach**: Agent directly publishes to `internal.egress.v1`

**Pros**:
- No MCP tool needed
- Lower latency (no tool-gateway hop)
- Simpler call signature

**Cons**:
- Violates separation of concerns (agent shouldn't know egress internals)
- Requires every agent to understand egress schema
- No centralized control/observability
- Hard to enforce policies (rate limiting, RBAC)

**Verdict**: Rejected - breaks architectural boundaries

### Alt 2: Annotation-Only Pattern

**Approach**: Agent adds `progress_hint` annotation, middleware sends message

**Pros**:
- No new MCP tool
- Reuses existing middleware pattern
- Minimal code changes

**Cons**:
- Still reactive (requires next() call to trigger)
- Agent can't send progress before event mutation
- Complex annotation schema
- Harder to test in isolation

**Verdict**: Rejected - doesn't solve proactive signaling problem

### Alt 3: New Progress Topic

**Approach**: Create `internal.progress.v1` topic with dedicated service

**Pros**:
- Clean separation of concerns
- Scalable (dedicated progress service)
- Could handle batching, rate limiting

**Cons**:
- Overkill for simple use case
- New service to maintain
- Adds complexity (routing, persistence)
- Higher latency (extra hop)

**Verdict**: Rejected - over-engineered for Sprint 22 scope

---

## Appendix B: Schema Reference

### SendProgressUpdateArgs Schema

```typescript
{
  message: string,           // Required, 1-500 chars
  context?: {                // Optional metadata
    operation?: string,
    estimatedSeconds?: number,
    [key: string]: any
  },
  emoji?: string,            // Optional, default: 🔄
  urgency?: 'low' | 'normal' | 'high'  // Default: normal
}
```

### Progress Event Schema (via next())

```typescript
{
  v: '2',
  correlationId: string,     // New UUID for progress event
  type: 'chat.message.v1',   // Internal event type
  ingress: {
    ingressAt: string,       // Progress event timestamp
    source: string,          // Original source
    connector: string,       // Original connector
    channel?: string         // Original channel
  },
  identity: Identity,        // Original identity
  egress: Egress,            // Original egress

  // NO message field - progress goes in candidate

  routing: {
    stage: 'response',
    slip: [],                // EMPTY = route to egress
    history: []
  },

  // Progress message as candidate (standard platform pattern)
  candidates: [{
    id: string,
    kind: 'text',
    source: 'ingress-egress',
    createdAt: string,
    status: 'proposed',      // Will be marked 'selected' by next()
    priority: 1,
    text: string,            // Progress message with emoji
    format: 'plain',
    reason: 'agent.sendProgressUpdate tool'
  }],

  // Annotations for observability
  annotations: [{
    kind: 'progress_update',
    value: JSON.stringify({
      originalCorrelationId: string,
      urgency: string,
      source: 'agent.sendProgressUpdate',
      ...context
    }),
    source: 'ingress-egress',
    id: string,
    createdAt: string
  }],

  metadata: {
    originalCorrelationId: string,
    progressUpdate: true
  }
}
```

**Why Candidates, Not Message**:
- Follows platform convention: candidate selection via `markSelectedCandidate()`
- Enables potential future enhancement: multiple progress alternatives
- Respects event flow: `next()` handles candidate → message transformation

---

## Appendix C: Code Locations

### Files to Create

- `src/apps/__tests__/tool-gateway-progress-tool.test.ts` - Unit tests (new)
- `src/apps/__tests__/progress-update-integration.test.ts` - Integration tests (new)

### Files to Modify

- `src/apps/tool-gateway.ts` - Add platform-internal tool registration and handler
- `src/apps/llm-bot-service.ts` - Add tool calls before LLM inference
- `src/apps/ingress-egress-service.ts` - Optional: enhance egress handler (Phase 3)
- `documentation/reference/bit-control-plane.md` - Document new platform tool (if exists)

### Files to Reference

- `src/common/base-server.ts` - Bit MCP infrastructure, next() routing
- `src/common/middleware/feedback-middleware.ts` - Existing progress pattern
- `src/apps/tool-gateway.ts` - Session context management (existing)
- `src/types/events.ts` - Event schemas (InternalEventV2, CandidateV1, AnnotationV1)

---

## Conclusion

This architecture provides a clean, maintainable solution for agent progress updates that:

1. **Leverages existing infrastructure** (MCP tools, `next()` routing, connectors)
2. **Respects platform safeguards** (FeedbackMiddleware, debug logging, candidate selection)
3. **Follows platform conventions** (Bit model, event-driven, candidates pattern)
4. **Minimal complexity** (single new tool, no new services/topics)
5. **High reliability** (fail-open, idempotent, observable)
6. **Good DX** (simple call signature, automatic context extraction)

### Key Architectural Decisions

**1. Tool Location: tool-gateway (not ingress-egress)**

Tool-gateway is the natural home because:
- ✅ Already maintains session context with current event
- ✅ No extra MCP hop (direct handler, not proxy)
- ✅ Establishes pattern for future platform-internal tools
- ✅ Clean separation: platform tools vs. domain tool proxying

**2. Event Flow: `next()` with empty slip (not direct publish)**

```typescript
// Tool creates event with candidate
const event = {
  ...progressEvent,
  routing: { slip: [], ... },  // Empty slip
  candidates: [{ text: progressMessage, ... }]
};

// Route through platform safeguards
await this.next(event);
// → FeedbackMiddleware applied
// → Debug logging applied
// → Candidate marked selected
// → Routed to egress destination
```

This ensures progress messages respect all platform safeguards and conventions, preventing bypasses of critical middleware like duplicate message prevention.

### Implementation Scope

Scoped appropriately for Sprint 22 (2-3 days):
- **Phase 1**: Core tool implementation (handler + schema)
- **Phase 2**: Context propagation validation
- **Phase 3**: Egress enhancement (optional urgency handling)
- **Phase 4**: Agent integration (llm-bot)
- **Phase 5**: Testing & documentation

Future enhancements (rich formatting, progress streams, LLM generation) provide a roadmap without requiring architectural changes.

**Ready for implementation approval.**
