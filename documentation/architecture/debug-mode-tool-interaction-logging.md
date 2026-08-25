# Debug Mode Tool Interaction Logging - Technical Architecture

**Author:** Architect
**Date:** 2026-08-21
**Status:** Authoritative v1
**Scope:** Adding tool call/response logging to !debug mode trace messages

---

## Executive Summary

This document defines the technical architecture for adding **tool interaction logging** to the existing `!debug` mode trace messaging system. The current debug mode (Sprint 371) provides real-time event flow visibility via trace messages sent back to the user, but **does not capture tool calls and responses**. This creates a significant blind spot when debugging LLM agent behavior, as tool interactions are critical to understanding the agent's reasoning and decision-making process.

**Key Objectives:**
- ✅ **Capture all tool calls**: Log tool name, arguments, timestamp
- ✅ **Capture all tool responses**: Log results, errors, duration
- ✅ **Integrate with existing debug infrastructure**: Minimal changes to current debug flow
- ✅ **Real-time feedback**: Send tool interaction summaries as debug trace messages
- ✅ **Zero performance impact**: Only activate when debug mode is enabled

**Design Principles:**
- **Non-invasive**: Leverage existing middleware patterns (no core logic changes)
- **Incremental**: Integrate tool logging at existing hook points in processor
- **Observable**: Tool interactions visible in debug trace messages
- **Structured**: Machine-readable tool logs in prompt logging system

---

## 1. Current Debug Mode Implementation

### 1.1 Debug Mode Activation

**Source:** src/services/ingress/discord/discord-ingress-client.ts:365-400

**Flow:**
```
1. User sends: "!debug <message>"
2. Ingress client detects prefix and performs RBAC check
3. Generate correlationId for trace linking
4. Send activation confirmation to user:
   "🔍 Debug mode ON
   Correlation ID: <uuid>
   Watching event flow..."
5. Attach DebugMetadata to InternalEventV2
6. Publish event to routing flow
```

**DebugMetadata Structure** (src/types/events.ts:198-207):
```typescript
export interface DebugMetadata {
  enabled: true;
  initiatedBy: string;         // Platform user ID
  feedbackChannel: string;      // Where to send trace messages
  startedAt: string;            // ISO8601 timestamp
}
```

**Event Integration:**
```typescript
const envelope: InternalEventV2 = {
  // ... standard fields ...
  metadata: {
    debug: {
      enabled: true,
      initiatedBy: userId,
      feedbackChannel: channelId,
      startedAt: new Date().toISOString()
    }
  }
};
```

### 1.2 Current Debug Trace Messages

**Trace Message Types** (inferred from Sprint 371 implementation):

| Phase | Message | Example |
|-------|---------|---------|
| **Activation** | Debug mode confirmation | `🔍 Debug mode ON\nCorrelation ID: abc-123` |
| **Routing** | Step transitions | `📍 Stage: contextualization → analysis` |
| **Enrichment** | Auth/identity resolution | `🔐 User identified: username#1234` |
| **Analysis** | LLM request start | `🤖 Analyzing request...` |
| **Reaction** | State mutations | `⚡ Updating state...` |
| **Egress** | Response delivery | `📤 Sending response...` |
| **Errors** | Failures | `❌ Error in llm-bot: timeout` |

**Current Gap:**
- ❌ **No tool call visibility**: User cannot see which tools are invoked
- ❌ **No tool arguments**: Cannot debug incorrect tool parameter passing
- ❌ **No tool results**: Cannot see what data tools return
- ❌ **No tool errors**: Tool failures are silent in debug trace

---

## 2. Tool Interaction Architecture

### 2.1 Tool Call Lifecycle

**Tool Execution Flow** (src/services/llm-bot/processor.ts:740-878):

```
┌─────────────────┐
│ LLM Bot Service │
└────────┬────────┘
         │
         ├─ 1. Build Tool Registry (filtered by RBAC + behavioral policy)
         │
         ├─ 2. generateText() call with tools
         │     └─ Vercel AI SDK manages tool loop
         │
         ├─ 3. For each tool call:
         │     ├─ Tool wrapper intercepts
         │     ├─ Log: llm_bot.tool_call.<name> (debug level)
         │     ├─ Execute tool.execute(args, toolContext)
         │     │   └─ Tool Gateway (MCP tools)
         │     │       ├─ tool_gateway.mcp.call_tool.start
         │     │       ├─ Forward to MCP server via SSE/HTTP
         │     │       ├─ Wait for response (timeout: 5s)
         │     │       └─ tool_gateway.mcp.call_tool.success
         │     ├─ Log: llm_bot.tool_call.<name>.success
         │     └─ Return result to LLM
         │
         ├─ 4. Aggregate all tool calls and results
         │     └─ Store in (evt as any)._lastToolCalls
         │     └─ Store in (evt as any)._lastToolResults
         │
         └─ 5. Prompt logging captures tool interactions
               └─ Stored in prompt_logs table (PostgreSQL)
```

**Key Hook Points:**

| Hook | Location | Purpose |
|------|----------|---------|
| **Tool Wrapper** | processor.ts:786-806 | Intercepts tool.execute() |
| **generateText Result** | processor.ts:847-878 | Aggregates all tool calls |
| **Prompt Logging** | processor.ts:884-946 | Persists tool logs |

### 2.2 Tool Context and Metadata

**Tool Execution Context** (processor.ts:748-754):
```typescript
const toolContext = {
  userRoles: string[];
  userId: string | undefined;
  correlationId: string;
  signal: AbortSignal;  // Timeout control
};
```

**Tool Call Metadata** (Vercel AI SDK):
```typescript
interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: any;
  error?: Error;
}
```

### 2.3 Tool Gateway Integration

**MCP Tool Call Flow** (src/apps/tool-gateway.ts:812-854):

```typescript
// Tool Gateway receives tool call from llm-bot
logger.debug('tool_gateway.mcp.call_tool.start', {
  id: toolName,
  args,
  reqContext
});

try {
  // Forward to MCP server (SSE/HTTP)
  const result = await mcpClient.callTool({
    name: toolName,
    arguments: args
  });

  logger.debug('tool_gateway.mcp.call_tool.success', {
    id: toolName,
    duration
  });

  return result;
} catch (error) {
  logger.error('tool_gateway.mcp.call_tool.error', {
    id: toolName,
    error: normalized.message,
    duration
  });
  throw error;
}
```

**Tool Call Latency:**
- **Internal tools** (registry): <10ms (in-process)
- **MCP tools** (tool-gateway): 50-500ms (SSE round-trip)
- **External APIs** (via MCP): 200-5000ms (network latency)

---

## 3. Proposed Tool Interaction Logging

### 3.1 Enhanced DebugMetadata

**Extension to Existing Structure:**

```typescript
export interface DebugMetadata {
  enabled: true;
  initiatedBy: string;
  feedbackChannel: string;
  startedAt: string;

  // NEW: Tool interaction tracking
  toolInteractionLogging?: {
    /** Enable detailed tool call/response logging */
    enabled: boolean;
    /** Include tool arguments in trace messages */
    includeArguments: boolean;
    /** Include tool results in trace messages */
    includeResults: boolean;
    /** Max length for argument/result preview (chars) */
    previewMaxChars: number;
  };
}
```

**Default Configuration:**
```typescript
const DEFAULT_TOOL_LOGGING_CONFIG = {
  enabled: true,              // Auto-enable with debug mode
  includeArguments: true,     // Show what was passed to tool
  includeResults: true,       // Show what tool returned
  previewMaxChars: 200        // Truncate long payloads
};
```

### 3.2 Tool Interaction Events

**Event Structure (attached to InternalEventV2):**

```typescript
interface ToolInteractionLog {
  /** Unique ID for this tool call */
  id: string;
  /** Tool name (e.g., "tavily.search", "internal:get_bot_status") */
  toolName: string;
  /** Tool source (mcp, internal, external) */
  source: 'mcp' | 'internal' | 'external';
  /** MCP server name (if source === 'mcp') */
  mcpServer?: string;
  /** Tool call arguments (redacted) */
  args: Record<string, any>;
  /** ISO8601 timestamp when call started */
  startedAt: string;
  /** ISO8601 timestamp when call completed */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Tool execution result */
  result?: {
    success: boolean;
    data?: any;
    error?: {
      code: string;
      message: string;
      retryable: boolean;
    };
  };
  /** Step in multi-turn reasoning (1-indexed) */
  step?: number;
}
```

**Attachment Point:**
```typescript
export interface InternalEventV2 {
  // ... existing fields ...

  metadata?: {
    debug?: DebugMetadata;
    toolInteractions?: ToolInteractionLog[];  // NEW
    [key: string]: any;
  };
}
```

### 3.3 Tool Logging Middleware

**Implementation Pattern:**

```typescript
// src/services/llm-bot/debug-tool-logger.ts

import { InternalEventV2, ToolInteractionLog } from '../../types/events';
import { logger } from '../../common/logging';
import { randomUUID } from 'crypto';

export class DebugToolLogger {
  constructor(
    private readonly event: InternalEventV2,
    private readonly sendDebugTrace: (message: string) => Promise<void>
  ) {}

  /** Check if tool logging is enabled for this event */
  isEnabled(): boolean {
    return this.event.metadata?.debug?.enabled === true &&
           this.event.metadata?.debug?.toolInteractionLogging?.enabled !== false;
  }

  /** Log tool call start */
  async logToolCallStart(toolName: string, args: Record<string, any>, source: 'mcp' | 'internal' | 'external'): Promise<string> {
    if (!this.isEnabled()) return '';

    const id = randomUUID();
    const log: ToolInteractionLog = {
      id,
      toolName,
      source,
      args: this.redactArgs(args),
      startedAt: new Date().toISOString(),
    };

    // Attach to event
    if (!this.event.metadata) this.event.metadata = {};
    if (!this.event.metadata.toolInteractions) this.event.metadata.toolInteractions = [];
    this.event.metadata.toolInteractions.push(log);

    // Send real-time trace message
    const config = this.event.metadata.debug?.toolInteractionLogging;
    const argsPreview = config?.includeArguments !== false
      ? this.preview(JSON.stringify(args), config?.previewMaxChars || 200)
      : '(hidden)';

    await this.sendDebugTrace(
      `🛠️ **Tool Call**: \`${toolName}\`\n` +
      `📥 Args: \`${argsPreview}\`\n` +
      `⏱️ Started: ${new Date().toISOString()}`
    );

    return id;
  }

  /** Log tool call completion */
  async logToolCallComplete(id: string, result: any, error?: Error): Promise<void> {
    if (!this.isEnabled()) return;

    const log = this.event.metadata?.toolInteractions?.find(l => l.id === id);
    if (!log) return;

    const completedAt = new Date().toISOString();
    const durationMs = Date.parse(completedAt) - Date.parse(log.startedAt);

    log.completedAt = completedAt;
    log.durationMs = durationMs;
    log.result = {
      success: !error,
      data: error ? undefined : result,
      error: error ? {
        code: (error as any).code || 'TOOL_ERROR',
        message: error.message,
        retryable: false
      } : undefined
    };

    // Send real-time trace message
    const config = this.event.metadata.debug?.toolInteractionLogging;
    const resultPreview = config?.includeResults !== false && !error
      ? this.preview(JSON.stringify(result), config?.previewMaxChars || 200)
      : error ? `❌ ${error.message}` : '(hidden)';

    const icon = error ? '❌' : '✅';
    await this.sendDebugTrace(
      `${icon} **Tool Result**: \`${log.toolName}\`\n` +
      `📤 Result: \`${resultPreview}\`\n` +
      `⏱️ Duration: ${durationMs}ms`
    );
  }

  private preview(text: string, maxChars: number): string {
    const redacted = this.redactSensitive(text);
    if (redacted.length <= maxChars) return redacted;
    return redacted.slice(0, maxChars) + `... (+${redacted.length - maxChars} chars)`;
  }

  private redactArgs(args: Record<string, any>): Record<string, any> {
    // Redact sensitive keys
    const sensitive = ['password', 'token', 'apiKey', 'secret', 'credential'];
    const redacted = { ...args };
    for (const key of Object.keys(redacted)) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        redacted[key] = '[REDACTED]';
      }
    }
    return redacted;
  }

  private redactSensitive(text: string): string {
    // Simple pattern-based redaction for common secrets
    return text
      .replace(/Bearer [A-Za-z0-9_-]+/g, 'Bearer [REDACTED]')
      .replace(/"(api_?key|token|password)":\s*"[^"]+"/gi, '"$1": "[REDACTED]"')
      .replace(/sk-[A-Za-z0-9]{32,}/g, 'sk-[REDACTED]');
  }
}
```

### 3.4 Integration with LLM Bot Processor

**Modification to Tool Wrapper** (processor.ts:786-806):

```typescript
// BEFORE
execute: tool.execute ? async (args: any) => {
  try {
    logger.debug(`llm_bot.tool_call.${name}`, { tool: tool.id});
    const resp = await tool.execute!(args, toolContext);
    logger?.debug(`llm_bot.tool_call.${name}.success`, { tool: tool.id });
    return resp;
  } catch (e: any) {
    logger.error('llm_bot.tool_error', { tool: tool.id, error: e.message });
    // ... error handling ...
    throw e;
  }
} : undefined

// AFTER
execute: tool.execute ? async (args: any) => {
  // Debug tool logging
  const debugLogger = new DebugToolLogger(evt, async (msg) => {
    await sendDebugTraceMessage(evt, msg);
  });
  const logId = await debugLogger.logToolCallStart(
    tool.id,
    args,
    tool.source === 'mcp' ? 'mcp' : 'internal'
  );

  try {
    logger.debug(`llm_bot.tool_call.${name}`, { tool: tool.id});
    const resp = await tool.execute!(args, toolContext);
    logger?.debug(`llm_bot.tool_call.${name}.success`, { tool: tool.id });

    // Debug tool logging
    await debugLogger.logToolCallComplete(logId, resp);

    return resp;
  } catch (e: any) {
    logger.error('llm_bot.tool_error', { tool: tool.id, error: e.message });

    // Debug tool logging
    await debugLogger.logToolCallComplete(logId, undefined, e);

    // ... error handling ...
    throw e;
  }
} : undefined
```

### 3.5 Debug Trace Message Delivery

**New Helper Function** (src/common/base-server.ts):

```typescript
/**
 * Send a debug trace message to the user who initiated debug mode.
 *
 * @param event - InternalEventV2 with debug metadata
 * @param message - Markdown-formatted trace message
 */
async function sendDebugTraceMessage(event: InternalEventV2, message: string): Promise<void> {
  const debugMeta = event.metadata?.debug;
  if (!debugMeta?.enabled) return;

  const traceEvent: InternalEventV2 = {
    v: '2',
    correlationId: event.correlationId,
    traceId: event.traceId,
    type: 'chat.trace.v1',  // NEW event type for debug traces
    ingress: event.ingress,
    identity: event.identity,
    egress: {
      destination: debugMeta.feedbackChannel,
      type: 'chat',
      connector: event.ingress.connector,
      channel: debugMeta.feedbackChannel,
    },
    message: {
      id: randomUUID(),
      role: 'system',
      text: message,
    },
    routing: {
      stage: 'response',
      slip: [{
        id: 'egress',
        status: 'PENDING',
        nextTopic: 'internal.egress.v1'
      }],
      history: []
    },
    qos: {
      persistenceTtlSec: 300,  // 5 minutes
      tracer: false             // Don't trace the trace message itself
    }
  };

  // Publish directly to egress (bypass routing)
  const publisher = createMessagePublisher('internal.egress.v1');
  await publisher.publishJson(traceEvent, {
    correlationId: event.correlationId,
    type: 'chat.trace.v1',
    source: 'debug-trace'
  });
}
```

---

## 4. Example Debug Session with Tool Logging

### 4.1 User Experience

**User Input:**
```
!debug search for the weather in San Francisco
```

**Debug Trace Messages:**

```
🔍 **Debug mode ON**
Correlation ID: c9f2a3b1-4e5f-6a7b-8c9d-0e1f2a3b4c5d
Watching event flow...

---

📍 **Stage**: initial → contextualization
⏱️ 14:32:01.123

---

🔐 **User identified**
Username: alice#1234
Roles: user, verified
⏱️ 14:32:01.245

---

📍 **Stage**: contextualization → analysis
⏱️ 14:32:01.367

---

🤖 **LLM Request**
Model: gpt-4o-mini
Tools: 12 available (3 internal, 9 MCP)
⏱️ 14:32:01.489

---

🛠️ **Tool Call**: `tavily.search`
📥 Args: `{"query": "weather San Francisco", "max_results": 3}`
⏱️ Started: 2026-08-21T14:32:01.612Z

---

✅ **Tool Result**: `tavily.search`
📤 Result: `[{"title": "Weather in SF", "snippet": "Sunny, 72°F", ...}]`
⏱️ Duration: 342ms

---

🛠️ **Tool Call**: `internal:get_current_time`
📥 Args: `{}`
⏱️ Started: 2026-08-21T14:32:01.954Z

---

✅ **Tool Result**: `internal:get_current_time`
📤 Result: `{"time": "2026-08-21T14:32:01.956Z", "timezone": "UTC"}`
⏱️ Duration: 2ms

---

📍 **Stage**: analysis → reaction
⏱️ 14:32:02.112

---

📍 **Stage**: reaction → response
⏱️ 14:32:02.234

---

📤 **Sending response**
Candidate: llm-bot (priority: 10)
Text preview: "The weather in San Francisco is currently sunny with a temperature of 72°F..."
⏱️ 14:32:02.356

---

✅ **Debug session complete**
Correlation ID: c9f2a3b1-4e5f-6a7b-8c9d-0e1f2a3b4c5d
Total duration: 1.233s
Tools called: 2
⏱️ 14:32:02.478
```

### 4.2 Tool Error Scenario

**User Input:**
```
!debug generate an image of a cat
```

**Debug Trace Messages:**

```
🔍 **Debug mode ON**
Correlation ID: a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d
Watching event flow...

---

[... context and analysis stages ...]

---

🛠️ **Tool Call**: `image_gen.generate`
📥 Args: `{"prompt": "a cat", "size": "1024x1024"}`
⏱️ Started: 2026-08-21T14:35:12.123Z

---

❌ **Tool Result**: `image_gen.generate`
📤 Result: `❌ Rate limit exceeded (code: RATE_LIMIT_EXCEEDED)`
⏱️ Duration: 1234ms

---

❌ **Error in llm-bot**
Source: mcp:image_gen.generate
Message: Rate limit exceeded
Retryable: false
⏱️ 14:35:13.357

---

📍 **Stage**: analysis → error
⏱️ 14:35:13.478

---

📤 **Sending error response**
⏱️ 14:35:13.601
```

---

## 5. Implementation Roadmap

### Phase 1: Foundation (Sprint 1)

**Tasks:**
1. ✅ Extend `DebugMetadata` with `toolInteractionLogging` config
2. ✅ Create `DebugToolLogger` class
3. ✅ Implement `sendDebugTraceMessage()` helper
4. ✅ Add unit tests for tool logger

**Deliverables:**
- `src/services/llm-bot/debug-tool-logger.ts`
- `src/services/llm-bot/debug-tool-logger.test.ts`
- `src/common/base-server.ts` (sendDebugTraceMessage helper)

**Success Criteria:**
- Tool logger can attach/retrieve logs from event
- Trace messages are correctly formatted
- Redaction works for sensitive data

### Phase 2: LLM Bot Integration (Sprint 2)

**Tasks:**
1. ✅ Integrate tool logger into tool wrapper
2. ✅ Test with internal tools (get_bot_status, list_tools)
3. ✅ Test with MCP tools (tavily.search, image_gen)
4. ✅ Add integration tests

**Deliverables:**
- Updated `src/services/llm-bot/processor.ts`
- Integration test suite
- Debug mode documentation update

**Success Criteria:**
- Tool calls logged in debug mode
- No performance impact when debug disabled
- All tool types (internal, MCP) supported

### Phase 3: Enhanced Observability (Sprint 3)

**Tasks:**
1. ✅ Add tool interaction summary to final trace message
2. ✅ Include tool logs in prompt logging (PostgreSQL)
3. ✅ Create debug session dashboard query
4. ✅ Add tool call metrics

**Deliverables:**
- Enhanced trace message format
- PostgreSQL query templates
- Grafana dashboard (optional)

**Success Criteria:**
- Tool interactions visible in prompt_logs table
- Analysts can query tool usage patterns
- Debug sessions fully reconstructable

### Phase 4: Tool Gateway Integration (Sprint 4 - Optional)

**Tasks:**
1. ✅ Add debug trace support in tool-gateway
2. ✅ Forward MCP server details to trace messages
3. ✅ Include MCP request/response timing
4. ✅ Test with multiple MCP servers

**Deliverables:**
- Updated `src/apps/tool-gateway.ts`
- MCP-aware trace messages
- Multi-server test suite

**Success Criteria:**
- MCP tool calls show server name
- SSE/HTTP transport visible in traces
- Timeout failures clearly indicated

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Test Cases:**

```typescript
// src/services/llm-bot/debug-tool-logger.test.ts

describe('DebugToolLogger', () => {
  it('should not log when debug mode disabled', async () => {
    const event: InternalEventV2 = {
      // ... no debug metadata ...
    };
    const logger = new DebugToolLogger(event, jest.fn());

    const id = await logger.logToolCallStart('test', {}, 'internal');
    expect(id).toBe('');
  });

  it('should log tool call start with args', async () => {
    const sendTrace = jest.fn();
    const event: InternalEventV2 = {
      metadata: {
        debug: {
          enabled: true,
          initiatedBy: 'user123',
          feedbackChannel: 'ch123',
          startedAt: '2026-08-21T14:00:00Z'
        }
      }
    };
    const logger = new DebugToolLogger(event, sendTrace);

    const id = await logger.logToolCallStart('tavily.search', { query: 'test' }, 'mcp');

    expect(id).toBeTruthy();
    expect(event.metadata.toolInteractions).toHaveLength(1);
    expect(sendTrace).toHaveBeenCalledWith(expect.stringContaining('tavily.search'));
  });

  it('should redact sensitive arguments', async () => {
    const sendTrace = jest.fn();
    const event: InternalEventV2 = {
      metadata: {
        debug: {
          enabled: true,
          initiatedBy: 'user123',
          feedbackChannel: 'ch123',
          startedAt: '2026-08-21T14:00:00Z'
        }
      }
    };
    const logger = new DebugToolLogger(event, sendTrace);

    await logger.logToolCallStart('auth.login', {
      username: 'alice',
      password: 'secret123'
    }, 'internal');

    const log = event.metadata.toolInteractions![0];
    expect(log.args.password).toBe('[REDACTED]');
  });

  it('should log tool call completion', async () => {
    const sendTrace = jest.fn();
    const event: InternalEventV2 = {
      metadata: {
        debug: {
          enabled: true,
          initiatedBy: 'user123',
          feedbackChannel: 'ch123',
          startedAt: '2026-08-21T14:00:00Z'
        },
        toolInteractions: [{
          id: 'tool-123',
          toolName: 'test',
          source: 'internal',
          args: {},
          startedAt: '2026-08-21T14:00:00.000Z'
        }]
      }
    };
    const logger = new DebugToolLogger(event, sendTrace);

    await logger.logToolCallComplete('tool-123', { result: 'success' });

    const log = event.metadata.toolInteractions![0];
    expect(log.completedAt).toBeTruthy();
    expect(log.durationMs).toBeGreaterThan(0);
    expect(log.result?.success).toBe(true);
  });

  it('should log tool call error', async () => {
    const sendTrace = jest.fn();
    const event: InternalEventV2 = {
      metadata: {
        debug: {
          enabled: true,
          initiatedBy: 'user123',
          feedbackChannel: 'ch123',
          startedAt: '2026-08-21T14:00:00Z'
        },
        toolInteractions: [{
          id: 'tool-123',
          toolName: 'test',
          source: 'internal',
          args: {},
          startedAt: '2026-08-21T14:00:00.000Z'
        }]
      }
    };
    const logger = new DebugToolLogger(event, sendTrace);

    await logger.logToolCallComplete('tool-123', undefined, new Error('Timeout'));

    const log = event.metadata.toolInteractions![0];
    expect(log.result?.success).toBe(false);
    expect(log.result?.error?.message).toBe('Timeout');
  });
});
```

### 6.2 Integration Tests

**Test Cases:**

```typescript
// src/services/llm-bot/__tests__/debug-tool-integration.test.ts

describe('Debug Mode Tool Integration', () => {
  it('should send trace messages for tool calls', async () => {
    const publishedEvents: any[] = [];
    const mockPublisher = {
      publishJson: async (event: any) => {
        publishedEvents.push(event);
        return 'msg-123';
      }
    };

    // Mock event with debug mode enabled
    const event: InternalEventV2 = {
      v: '2',
      correlationId: 'test-123',
      type: 'chat.message.v1',
      metadata: {
        debug: {
          enabled: true,
          initiatedBy: 'alice#1234',
          feedbackChannel: 'ch-123',
          startedAt: '2026-08-21T14:00:00Z'
        }
      },
      // ... other required fields ...
    };

    // Process event (will call internal tool)
    await processEvent(mockBit, event, {
      registry: mockRegistry,
      callLLM: async () => 'Use get_current_time tool'
    });

    // Verify trace messages were sent
    const traceMessages = publishedEvents.filter(e => e.type === 'chat.trace.v1');
    expect(traceMessages.length).toBeGreaterThan(0);
    expect(traceMessages.some(m => m.message?.text.includes('Tool Call'))).toBe(true);
  });
});
```

### 6.3 End-to-End Tests

**Manual Test Script:**

```bash
# Prerequisites
export DEBUG_USERS_DISCORD="your_discord_id"
export DISCORD_ENABLED=true
export DISCORD_BOT_TOKEN="your_token"

# Test 1: Internal tool
# Send in Discord: !debug what is the current time?
# Expected: See trace messages for internal:get_current_time tool

# Test 2: MCP tool
# Send in Discord: !debug search for weather in SF
# Expected: See trace messages for tavily.search tool with args/result

# Test 3: Tool error
# Send in Discord: !debug generate an image (with rate limit exceeded)
# Expected: See trace message with error details

# Test 4: Multi-tool
# Send in Discord: !debug complex query requiring multiple tools
# Expected: See trace messages for all tool calls in order
```

---

## 7. Performance Impact Analysis

### 7.1 Overhead When Debug Disabled

**Impact:** **Zero overhead**

**Rationale:**
- Tool logger checks `event.metadata?.debug?.enabled` before any work
- Early return if false (1 boolean check)
- No message bus publishes
- No additional allocations

**Benchmark:**
```typescript
// Without debug mode
for (let i = 0; i < 1000; i++) {
  const logger = new DebugToolLogger(normalEvent, sendTrace);
  logger.isEnabled();  // Returns false immediately
}
// Average: <0.001ms per check
```

### 7.2 Overhead When Debug Enabled

**Impact:** **Minimal (5-10ms per tool call)**

**Breakdown:**
- Create tool log object: ~0.5ms
- Attach to event.metadata: ~0.1ms
- Format trace message: ~1ms
- Publish to egress topic: ~3-8ms (NATS async)
- **Total**: ~5-10ms per tool call

**Mitigation:**
- Trace message publishing is async (non-blocking)
- Tool execution continues while trace message delivers
- Only affects debug sessions (authorized users only)

**Worst Case:**
- Event with 5 tool calls = 25-50ms overhead
- Still acceptable for debug scenarios
- User expects slower execution when debugging

---

## 8. Security and Privacy Considerations

### 8.1 RBAC Enforcement

**Authorization Model:**

```typescript
// Debug mode activation requires explicit user authorization
const debugUsersStr = cfg.debugUsersDiscord || '';
const debugAuthorizedUsers = new Set(
  debugUsersStr.split(',').map((u) => u.trim()).filter(Boolean)
);

if (!debugAuthorizedUsers.has(userId)) {
  // Silently ignore debug prefix for unauthorized users
  logger.warn('discord.debug.unauthorized', { userId });
  return;  // Process as normal message
}
```

**Security Properties:**
- ✅ Explicit opt-in via `DEBUG_USERS_*` environment variables
- ✅ Platform-specific (Discord, Slack, Twitch have separate lists)
- ✅ No privilege escalation (debug users see their own events only)
- ✅ Audit log for debug mode activation

### 8.2 Sensitive Data Redaction

**Redaction Strategy:**

| Data Type | Redaction Method |
|-----------|------------------|
| **Passwords** | Replace with `[REDACTED]` if key matches `password`, `pass`, `pwd` |
| **API Keys** | Replace with `[REDACTED]` if key matches `apiKey`, `api_key`, `token` |
| **Bearer Tokens** | Pattern-based: `Bearer [A-Za-z0-9_-]+` → `Bearer [REDACTED]` |
| **OpenAI Keys** | Pattern-based: `sk-[A-Za-z0-9]{32,}` → `sk-[REDACTED]` |
| **PII** | Preserve (trace messages only sent to debug session initiator) |

**Implementation:**

```typescript
private redactArgs(args: Record<string, any>): Record<string, any> {
  const sensitive = ['password', 'token', 'apiKey', 'secret', 'credential', 'key'];
  const redacted = JSON.parse(JSON.stringify(args));  // Deep clone

  const redactRecursive = (obj: any) => {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        redactRecursive(obj[key]);
      } else if (sensitive.some(s => key.toLowerCase().includes(s))) {
        obj[key] = '[REDACTED]';
      }
    }
  };

  redactRecursive(redacted);
  return redacted;
}
```

### 8.3 Trace Message Scope

**Isolation Properties:**
- ✅ Trace messages only sent to debug session initiator
- ✅ No cross-user leakage (feedbackChannel is user-specific)
- ✅ Short TTL on trace messages (5 minutes)
- ✅ Not persisted in long-term storage (persistence TTL: 300s)

---

## 9. Monitoring and Observability

### 9.1 Metrics

**Debug Mode Metrics:**

```typescript
// Existing metrics
metrics.increment('debug_mode.activated', { platform: 'discord' });
metrics.increment('debug_mode.unauthorized_attempt', { userId });

// NEW: Tool logging metrics
metrics.increment('debug_mode.tool_logged', { tool: toolName, source });
metrics.histogram('debug_mode.tool_duration_ms', durationMs, { tool: toolName });
metrics.increment('debug_mode.tool_error', { tool: toolName, errorCode });
metrics.increment('debug_mode.trace_message_sent', { messageType: 'tool_call' });
```

**Dashboard Queries:**

```promql
# Debug mode activation rate
rate(debug_mode_activated_total[5m])

# Most frequently debugged tools
topk(10, sum by (tool) (debug_mode_tool_logged_total))

# Tool error rate in debug sessions
sum by (tool) (debug_mode_tool_error_total)
  / sum by (tool) (debug_mode_tool_logged_total)

# Average tool duration
histogram_quantile(0.95, debug_mode_tool_duration_ms)
```

### 9.2 Structured Logging

**Log Entries:**

```typescript
// Tool call start
logger.debug('debug_mode.tool_call.start', {
  correlationId,
  debugInitiatedBy: event.metadata.debug.initiatedBy,
  tool: toolName,
  source,
  argsPreview: preview(args)
});

// Tool call complete
logger.debug('debug_mode.tool_call.complete', {
  correlationId,
  tool: toolName,
  durationMs,
  success: !error,
  resultPreview: error ? undefined : preview(result)
});

// Trace message sent
logger.debug('debug_mode.trace_message.sent', {
  correlationId,
  messageType: 'tool_call',
  channel: event.metadata.debug.feedbackChannel
});
```

---

## 10. Alternative Approaches Considered

### 10.1 Approach A: Centralized Tool Event Bus

**Design:**
- Create dedicated `internal.tool.invocation.v1` topic
- Tool Gateway publishes all tool calls to this topic
- Debug trace service subscribes and sends trace messages

**Pros:**
- ✅ Decoupled from llm-bot processor
- ✅ Works for all tool sources (not just LLM bot)
- ✅ Easier to add new debug subscribers

**Cons:**
- ❌ Adds message bus overhead for every tool call
- ❌ Requires new service (debug-trace-service)
- ❌ More complex failure modes (what if topic unavailable?)

**Verdict:** ❌ **Rejected** - Too much overhead for a debug-only feature

### 10.2 Approach B: Passive Log Tailing

**Design:**
- No code changes to llm-bot or tool-gateway
- Debug mode enables log tailing at `debug` level
- External service parses logs and sends trace messages

**Pros:**
- ✅ Zero code changes to core services
- ✅ Works with existing log infrastructure

**Cons:**
- ❌ Brittle (depends on log format stability)
- ❌ High latency (log aggregation delay)
- ❌ Cannot correlate tool calls to events easily

**Verdict:** ❌ **Rejected** - Too indirect, poor UX

### 10.3 Approach C: Vercel AI SDK Middleware (Selected)

**Design:**
- Leverage existing tool wrapper in processor
- Add debug logger inline at tool execution points
- Directly publish trace messages from llm-bot

**Pros:**
- ✅ Minimal code changes
- ✅ Zero overhead when debug disabled
- ✅ Real-time trace messages (no buffering)
- ✅ Direct access to event context

**Cons:**
- ⚠️ Couples debug logic to processor (acceptable trade-off)
- ⚠️ Only captures LLM bot tool calls (not direct MCP calls)

**Verdict:** ✅ **Selected** - Best balance of simplicity and effectiveness

---

## 11. Future Enhancements

### 11.1 Interactive Debugging

**Concept:** Allow user to inspect tool calls mid-execution

**Flow:**
```
🛠️ Tool Call: tavily.search
📥 Args: {"query": "weather SF"}
❓ Continue? (reply "yes" to proceed, "no" to skip, "edit" to modify args)

User: edit
📝 Enter new args (JSON):
User: {"query": "weather San Francisco, CA"}

✅ Tool Call Updated
⏱️ Executing...
```

**Implementation:**
- Pause tool execution after debug trace sent
- Subscribe to user responses on `internal.debug.control.v1`
- Resume/skip/modify based on user input
- Timeout after 30s (default to continue)

### 11.2 Tool Call Replay

**Concept:** Re-execute failed tool calls with modified arguments

**Flow:**
```
❌ Tool Result: image_gen.generate
📤 Error: Rate limit exceeded

🔄 Retry with delay? (reply "retry:30s" to retry in 30 seconds)
```

**Implementation:**
- Store tool call context in Redis
- Schedule retry via scheduler service
- Send trace message when retry executes

### 11.3 Multi-User Debug Sessions

**Concept:** Share debug session with team members

**Flow:**
```
!debug --share=alice,bob search for...

🔍 Debug mode ON (shared with alice, bob)
Correlation ID: abc-123
```

**Implementation:**
- Extend `DebugMetadata.feedbackChannel` to array
- Broadcast trace messages to all recipients
- Add RBAC for shared debug permissions

### 11.4 Debug Session Persistence

**Concept:** Save debug sessions for later analysis

**Flow:**
```
!debug --save search for...

🔍 Debug mode ON
Session ID: session-abc-123
View later: https://bitbrat.dev/debug/session-abc-123
```

**Implementation:**
- Store all trace messages in PostgreSQL
- Create web UI for session playback
- Add search/filter by tool name, error type

---

## 12. Summary and Recommendations

### 12.1 Key Takeaways

1. **Non-Invasive Integration**: Tool logging integrates cleanly via existing tool wrapper pattern
2. **Zero Performance Impact**: Early return when debug disabled ensures no overhead
3. **Real-Time Feedback**: Users see tool interactions immediately in trace messages
4. **Security First**: RBAC + redaction prevent unauthorized access and data leaks
5. **Observable**: Tool interactions captured in both trace messages and prompt logs

### 12.2 Implementation Priority

**Priority 1 (Must Have):**
- ✅ DebugToolLogger class
- ✅ LLM bot processor integration
- ✅ Basic trace message format
- ✅ Redaction for sensitive data

**Priority 2 (Should Have):**
- ✅ Enhanced trace message formatting
- ✅ Prompt logging integration
- ✅ Integration tests
- ✅ Documentation

**Priority 3 (Nice to Have):**
- ⚠️ Tool Gateway debug trace integration
- ⚠️ Multi-tool summary in final trace
- ⚠️ Grafana dashboard
- ⚠️ Debug session replay UI

### 12.3 Success Metrics

**Adoption:**
- Target: 80% of debug sessions use tool logging
- Measure: `debug_mode.tool_logged_total` / `debug_mode.activated_total`

**Performance:**
- Target: <10ms overhead per tool call
- Measure: `histogram_quantile(0.95, debug_mode.tool_duration_ms)`

**Reliability:**
- Target: 99.9% trace message delivery
- Measure: `debug_mode.trace_message_sent_total` / `debug_mode.tool_logged_total`

**User Satisfaction:**
- Target: Reduced debug session duration by 30%
- Measure: `debug_mode.session_duration_seconds` (before/after)

---

## References

- **Sprint 371**: Debug mode activation and trace messages
- **src/services/ingress/discord/discord-ingress-client.ts**: Debug mode activation flow
- **src/types/events.ts**: DebugMetadata and InternalEventV2 schemas
- **src/services/llm-bot/processor.ts**: Tool execution and logging
- **src/apps/tool-gateway.ts**: MCP tool call forwarding
- **Vercel AI SDK**: generateText() and tool execution model
- **NATS Technical Architecture**: documentation/architecture/nats-technical-architecture.md

---

**Document Status:** ✅ Complete
**Next Review:** Sprint 400 (after implementation)
**Owner:** Platform Architecture Team
