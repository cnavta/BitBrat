# Technical Architecture: Reflex Bit - Deterministic Event Orchestration
**Sprint ID**: sprint-332-reflex
**Author**: Architect
**Date**: 2026-07-03
**Status**: Draft for Review

---

## Executive Summary

This document presents the technical architecture for developing the **Reflex** bit, a specialized service designed to handle simple, deterministic event-driven behaviors with minimal latency and cost. The Reflex bit will intercept events in the analysis stage (immediately after auth), match them against predefined patterns, and orchestrate MCP tool invocations without requiring expensive LLM inference.

**Core Value Proposition**:
- **Performance**: Sub-millisecond pattern matching vs. seconds for LLM inference
- **Cost**: Zero LLM API costs for deterministic behaviors
- **Simplicity**: Direct pattern → action mapping without complex reasoning
- **Scalability**: In-memory rule caching, O(n) pattern matching

**Target Use Case** (Phase 1): Chat message `!fail` → OBS source visibility toggle via `obs.set_source_visibility`

**Positioning**: Analysis stage, between `auth` and `query-analyzer`, ensuring authorization context but avoiding expensive analysis when unnecessary.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Goals and Non-Goals](#goals-and-non-goals)
3. [System Architecture](#system-architecture)
4. [Data Model](#data-model)
5. [Matching Engine Design](#matching-engine-design)
6. [Orchestration Engine Design](#orchestration-engine-design)
7. [Integration with Event Flow](#integration-with-event-flow)
8. [MCP Tool Interface](#mcp-tool-interface)
9. [Storage and Persistence](#storage-and-persistence)
10. [Performance Considerations](#performance-considerations)
11. [Error Handling and Observability](#error-handling-and-observability)
12. [Security Considerations](#security-considerations)
13. [Future Extensibility](#future-extensibility)
14. [Implementation Phases](#implementation-phases)
15. [Testing Strategy](#testing-strategy)
16. [Success Criteria](#success-criteria)
17. [Decision Log](#decision-log)
18. [Appendices](#appendices)

---

## Current State Analysis

### Existing Reflex Bit

**Location**: `src/apps/reflex-service.ts`
**Registration**: `architecture.yaml` (services.reflex)
**Current State**: Skeleton MCP server with example `echo` tool

```yaml
reflex:
  profile: mcp-domain
  mcp:
    exposure: platform+domain
  active: false  # Not yet deployed
  kind: mcp-server
  stage: analyze
  entry: src/apps/reflex-service.ts
  port: 3000
```

**Current Capabilities**: None (template only)

### Event Flow Context

**Current Analysis Stage Flow**:
1. `internal.ingress.v1` → event-router
2. event-router → `internal.auth.v1` → auth service
3. event-router → `internal.query.analysis.v1` → query-analyzer (fast LLM)
4. event-router → `internal.llmbot.v1` → llm-bot (full LLM)
5. Analysis services → `internal.enriched.v1` → event-router
6. event-router → react/egress stages

**Proposed Reflex Position**:
```
internal.ingress.v1 → event-router
                   ↓
                auth (internal.auth.v1)
                   ↓
         **→ reflex (internal.reflex.v1)** ← NEW
                   ↓
         query-analyzer (internal.query.analysis.v1)
                   ↓
         llm-bot (internal.llmbot.v1)
```

### Related Systems

**Event Router**:
- Stores JsonLogic rules in Firestore (`commands` collection)
- Matches events and attaches routing slips
- Orchestrates multi-step processing

**Tool Gateway**:
- Proxies MCP tool calls
- Handles authentication via `MCP_AUTH_TOKEN`
- Routes to appropriate MCP servers

**Auth Service**:
- Validates user permissions
- Enriches events with authorization context
- Returns on `internal.enriched.v1`

---

## Goals and Non-Goals

### Goals

1. **Pattern Matching**: Fast, accurate matching of event properties against reflex rules
2. **MCP Orchestration**: Template-based invocation of single MCP tool per matched reflex
3. **Low Latency**: <10ms p99 latency for match + orchestrate (excluding MCP tool execution)
4. **Management Interface**: MCP tools for CRUD operations on reflex rules (LLM-driven)
5. **Firestore Persistence**: Durable storage with real-time updates
6. **Authorization Aware**: Respect auth context from upstream auth service
7. **Observable**: Comprehensive logging and metrics for matches, executions, failures

### Non-Goals (Phase 1)

1. ❌ **Multi-tool chains**: Single tool invocation only (defer to Phase 2)
2. ❌ **Scripting/DSL**: No embedded scripting language (consider for Phase 3)
3. ❌ **Complex conditionals**: Basic field matching only (no JsonLogic)
4. ❌ **State management**: Reflexes are stateless (no counters, cooldowns, etc.)
5. ❌ **A/B testing**: No variant testing for reflexes
6. ❌ **ML-based matching**: No fuzzy/semantic matching (LLM's job)

---

## System Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Reflex Bit                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐        ┌──────────────┐                 │
│  │   Message    │───────>│   Matching   │                 │
│  │  Subscriber  │        │    Engine    │                 │
│  │ (internal.   │        │              │                 │
│  │ reflex.v1)   │        └───────┬──────┘                 │
│  └──────────────┘                │                         │
│                                   │ Match Result           │
│  ┌──────────────┐                │                         │
│  │   Reflex     │<───────────────┘                         │
│  │    Rule      │                                          │
│  │   Manager    │        ┌──────────────┐                 │
│  │  (Firestore  │───────>│Orchestration │                 │
│  │  + Cache)    │        │   Engine     │                 │
│  └──────────────┘        └───────┬──────┘                 │
│         ↕                         │                         │
│  ┌──────────────┐                │ MCP Tool Call          │
│  │  Management  │                │                         │
│  │  MCP Tools   │                ↓                         │
│  │ (reflex.*)   │        ┌──────────────┐                 │
│  └──────────────┘        │ Tool Gateway │                 │
│                          │    Client    │                 │
│                          └───────┬──────┘                 │
│                                  │                         │
│  ┌──────────────┐                │ Publish Result         │
│  │   Publisher  │<───────────────┘                         │
│  │ (internal.   │                                          │
│  │ enriched.v1) │                                          │
│  └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘

         │                                    ↑
         │ Load Rules                         │ Save Rules
         ↓                                    │
┌─────────────────┐                  ┌────────────────┐
│   Firestore     │                  │  Tool Gateway  │
│  (reflexes      │                  │  (MCP Proxy)   │
│  collection)    │                  └────────────────┘
└─────────────────┘
```

### Sequence Diagram: Reflex Execution

```
Event Router → Reflex: publish(internal.reflex.v1, event)
Reflex → Matching Engine: match(event, rules)
Matching Engine → Reflex: matched rule
Reflex → Orchestration: execute(rule.action, event)
Orchestration → Tool Gateway: call_tool(name, params)
Tool Gateway → OBS MCP: obs.set_source_visibility({...})
OBS MCP → Tool Gateway: result
Tool Gateway → Orchestration: result
Orchestration → Reflex: success
Reflex → Event Router: publish(internal.enriched.v1, enriched_event)
Event Router → Next Step: route(event)
```

---

## Data Model

### Reflex Rule Schema

**Firestore Collection**: `reflexes`
**Document ID**: Auto-generated or user-specified slug

```typescript
interface Reflex {
  // Identity
  id: string;                    // Firestore document ID
  name: string;                  // Human-readable name
  description?: string;          // Optional description

  // State
  active: boolean;               // Enable/disable without deletion
  priority: number;              // Execution order (lower = higher priority)

  // Matching Configuration
  match: {
    type: 'exact' | 'contains' | 'regex' | 'prefix' | 'suffix';
    pattern: string;             // Pattern to match
    field: string;               // JSONPath to event field (e.g., 'message.text')
    flags?: string;              // Regex flags (i, m, s, etc.)
    caseSensitive?: boolean;     // For exact/contains/prefix/suffix
  };

  // Optional Conditions (AND logic)
  conditions?: {
    eventTypes?: string[];       // Filter by event.type (e.g., ['chat'])
    channels?: string[];         // Filter by channel (e.g., ['#my-channel'])
    platforms?: string[];        // Filter by platform (e.g., ['twitch', 'discord'])
    userRoles?: string[];        // Require auth roles (e.g., ['moderator', 'broadcaster'])
    minAuthLevel?: number;       // Minimum auth level from auth service
  };

  // Action Configuration
  action: {
    tool: string;                // Fully qualified MCP tool name (e.g., 'obs.set_source_visibility')
    parameters: Record<string, any>;  // Parameter template with {{field.path}} interpolation
    timeout?: number;            // Max execution time in ms (default: 5000)
  };

  // Response Configuration (optional)
  candidateTemplate?: string;    // Template for candidate response (access to {{event.field}} and {{result.field}})

  // Metadata
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  createdBy?: string;            // User ID (for LLM-created reflexes)
  tags?: string[];               // Searchable tags

  // Statistics (updated by reflex bit)
  stats?: {
    matchCount: number;          // Total matches
    successCount: number;        // Successful executions
    errorCount: number;          // Failed executions
    lastMatchedAt?: string;      // Last match timestamp
    lastExecutedAt?: string;     // Last execution timestamp
  };
}
```

### Example: !fail Reflex

```json
{
  "id": "obs-fail-toggle",
  "name": "OBS Fail Source Toggle",
  "description": "Shows OBS fail source when !fail is typed in chat",
  "active": true,
  "priority": 10,

  "match": {
    "type": "exact",
    "pattern": "!fail",
    "field": "message.text",
    "caseSensitive": false
  },

  "conditions": {
    "eventTypes": ["chat"],
    "platforms": ["twitch"]
  },

  "action": {
    "tool": "obs.set_source_visibility",
    "parameters": {
      "sourceName": "FailOverlay",
      "visible": true,
      "sceneName": "{{scene}}"
    },
    "timeout": 3000
  },

  "candidateTemplate": "Fail overlay activated! Visibility set to {{result.visible}}.",

  "createdAt": "2026-07-03T00:00:00Z",
  "updatedAt": "2026-07-03T00:00:00Z",
  "createdBy": "llm-bot",
  "tags": ["obs", "overlay", "chat-command"]
}
```

---

## Matching Engine Design

### Requirements

- **Speed**: <1ms per rule evaluation (100 rules → <100ms worst case)
- **Accuracy**: 100% correct matches (no false positives/negatives)
- **Flexibility**: Support multiple match types
- **Safety**: Protect against ReDoS (Regular Expression Denial of Service)

### Match Types

#### 1. Exact Match
```typescript
type: 'exact'
pattern: '!fail'
field: 'message.text'
caseSensitive: false
→ message.text.toLowerCase() === '!fail'
```

#### 2. Contains Match
```typescript
type: 'contains'
pattern: 'subscribe'
field: 'message.text'
caseSensitive: true
→ message.text.includes('subscribe')
```

#### 3. Prefix Match
```typescript
type: 'prefix'
pattern: '!'
field: 'message.text'
→ message.text.startsWith('!')
```

#### 4. Suffix Match
```typescript
type: 'suffix'
pattern: '?'
field: 'message.text'
→ message.text.endsWith('?')
```

#### 5. Regex Match
```typescript
type: 'regex'
pattern: '^!\\w+\\s+\\d+$'
field: 'message.text'
flags: 'i'
→ new RegExp(pattern, flags).test(message.text)
```

**ReDoS Protection**:
- Validate regex patterns at rule creation time
- Use `safe-regex` library to detect catastrophic backtracking
- Enforce timeout on regex execution (100ms max)
- Fallback to error if timeout exceeded

### Field Path Resolution

Use JSONPath-like syntax to access nested event properties:

```typescript
// Examples:
'message.text'           → event.message?.text
'identity.user.id'       → event.identity?.user?.id
'event.type'             → event.event?.type
'annotations[0].key'     → event.annotations?.[0]?.key
```

**Implementation**: Use `lodash.get()` or custom safe property accessor.

### Condition Evaluation

All conditions use AND logic (all must pass):

```typescript
function evaluateConditions(event: InternalEventV2, conditions?: Conditions): boolean {
  if (!conditions) return true;

  // Event type filter
  if (conditions.eventTypes?.length) {
    if (!conditions.eventTypes.includes(event.event?.type)) return false;
  }

  // Channel filter
  if (conditions.channels?.length) {
    const channel = event.identity?.channel || event.message?.channel;
    if (!channel || !conditions.channels.includes(channel)) return false;
  }

  // Platform filter
  if (conditions.platforms?.length) {
    const platform = event.identity?.external?.platform;
    if (!platform || !conditions.platforms.includes(platform)) return false;
  }

  // User role filter (requires auth context)
  if (conditions.userRoles?.length) {
    const userRoles = event.identity?.user?.roles || [];
    const hasRequiredRole = conditions.userRoles.some(role => userRoles.includes(role));
    if (!hasRequiredRole) return false;
  }

  // Min auth level
  if (conditions.minAuthLevel !== undefined) {
    const authLevel = event.identity?.authLevel || 0;
    if (authLevel < conditions.minAuthLevel) return false;
  }

  return true;
}
```

### Matching Algorithm

```typescript
async function matchReflexes(event: InternalEventV2, rules: Reflex[]): Promise<Reflex[]> {
  const matches: Reflex[] = [];

  // Sort by priority (lower number = higher priority)
  const sorted = rules
    .filter(r => r.active)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    // Check conditions first (cheap)
    if (!evaluateConditions(event, rule.conditions)) {
      continue;
    }

    // Extract field value
    const fieldValue = getFieldValue(event, rule.match.field);
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    // Convert to string for matching
    const textValue = String(fieldValue);

    // Perform match based on type
    const isMatch = performMatch(textValue, rule.match);

    if (isMatch) {
      matches.push(rule);
      // Phase 1: Execute first match only (early exit)
      break;
    }
  }

  return matches;
}
```

---

## Orchestration Engine Design

### Template Parameter Interpolation

Support `{{field.path}}` syntax in action parameters:

```typescript
// Example action:
{
  "tool": "obs.set_source_visibility",
  "parameters": {
    "sourceName": "FailOverlay",
    "visible": true,
    "sceneName": "{{scene}}",
    "metadata": {
      "triggeredBy": "{{identity.user.displayName}}",
      "channel": "{{identity.channel}}"
    }
  }
}

// After interpolation with event:
{
  "sourceName": "FailOverlay",
  "visible": true,
  "sceneName": "MainScene",
  "metadata": {
    "triggeredBy": "JohnDoe",
    "channel": "#mychannel"
  }
}
```

**Implementation**:
```typescript
function interpolateParameters(
  template: Record<string, any>,
  event: InternalEventV2
): Record<string, any> {
  return JSON.parse(
    JSON.stringify(template).replace(
      /\{\{([^}]+)\}\}/g,
      (match, path) => {
        const value = getFieldValue(event, path.trim());
        return value !== undefined ? JSON.stringify(value) : match;
      }
    )
  );
}
```

### Candidate Template Building

**Purpose**: Allow reflexes to generate candidate responses that will be sent to the user after successful execution.

**Template Syntax**: The `candidateTemplate` field supports interpolation from two sources:
- `{{event.field.path}}` - Access event data (same as action parameters)
- `{{result.field.path}}` - Access MCP tool call results

**Example**:
```json
{
  "candidateTemplate": "Fail overlay activated by {{event.identity.user.displayName}}! Status: {{result.status}}"
}
```

**Implementation**:
```typescript
function buildCandidate(
  template: string,
  event: InternalEventV2,
  toolResult: any
): InternalCandidate {
  // Replace {{event.path}} placeholders
  let text = template.replace(
    /\{\{event\.([^}]+)\}\}/g,
    (match, path) => {
      const value = getFieldValue(event, path.trim());
      return value !== undefined ? String(value) : match;
    }
  );

  // Replace {{result.path}} placeholders
  text = text.replace(
    /\{\{result\.([^}]+)\}\}/g,
    (match, path) => {
      const value = getFieldValue(toolResult, path.trim());
      return value !== undefined ? String(value) : match;
    }
  );

  // Build candidate object
  return {
    source: 'reflex',
    text,
    confidence: 1.0,
    metadata: {
      reflexId: reflex.id,
      reflexName: reflex.name,
      timestamp: new Date().toISOString()
    }
  };
}
```

**When to Use**:
- Provide user feedback for successful actions (e.g., "Timer set for 60 seconds")
- Confirm command execution (e.g., "Overlay activated")
- Return data from tool results (e.g., "Current viewer count: {{result.count}}")

**When NOT to Use**:
- Silent actions that don't require user feedback
- Actions where tool result doesn't contain useful user-facing data

**Integration with Event Flow**:
If `candidateTemplate` is defined:
1. Execute MCP tool
2. Build candidate from template + event + tool result
3. Add candidate to event's `candidates` array
4. Call `complete(enrichedEvent)` to send to egress

If `candidateTemplate` is not defined:
1. Execute MCP tool
2. Call `complete(enrichedEvent)` without adding candidate

### MCP Tool Invocation

**Via Tool Gateway**:
```typescript
async function invokeMcpTool(
  toolName: string,
  parameters: Record<string, any>,
  timeout: number
): Promise<any> {
  const toolGatewayUrl = process.env.TOOL_GATEWAY_URL || 'http://tool-gateway:3000';
  const authToken = process.env.MCP_AUTH_TOKEN;

  const response = await fetch(`${toolGatewayUrl}/mcp/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      tool: toolName,
      arguments: parameters
    }),
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    throw new Error(`Tool invocation failed: ${response.statusText}`);
  }

  return response.json();
}
```

### Execution Flow

```typescript
async function executeReflex(
  reflex: Reflex,
  event: InternalEventV2
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // 1. Interpolate parameters
    const params = interpolateParameters(reflex.action.parameters, event);

    // 2. Invoke MCP tool
    const timeout = reflex.action.timeout || 5000;
    const result = await invokeMcpTool(reflex.action.tool, params, timeout);

    // 3. Build candidate (if template provided)
    let candidate: InternalCandidate | undefined;
    if (reflex.candidateTemplate) {
      candidate = buildCandidate(reflex.candidateTemplate, event, result);
    }

    // 4. Update statistics
    await updateReflexStats(reflex.id, 'success');

    // 5. Log execution
    logger.info('reflex.execution.success', {
      reflexId: reflex.id,
      reflexName: reflex.name,
      tool: reflex.action.tool,
      latency: Date.now() - startTime,
      correlationId: event.correlationId,
      candidateGenerated: !!candidate
    });

    return {
      status: 'success',
      result,
      candidate,
      latency: Date.now() - startTime
    };
  } catch (error) {
    // Update error statistics
    await updateReflexStats(reflex.id, 'error');

    // Log failure
    logger.error('reflex.execution.error', {
      reflexId: reflex.id,
      error: error.message,
      correlationId: event.correlationId
    });

    return {
      status: 'error',
      error: error.message,
      latency: Date.now() - startTime
    };
  }
}
```

---

## Integration with Event Flow

### Message Subscription

**Topic**: `internal.reflex.v1`
**Producer**: event-router
**Consumer**: reflex

**architecture.yaml additions**:
```yaml
topics:
  internal.reflex.v1:
    description: Fast pattern-matching and deterministic orchestration step before expensive analysis
    producers:
      - event-router
    consumers:
      - reflex
    schema: documentation/schemas/envelope.v1.json

  internal.reflex.executed.v1:
    description: Published when a reflex successfully executes (for follow-up actions, analytics, etc.)
    producers:
      - reflex
    consumers: []  # Phase 1: no consumers, just publish for future use
    schema: documentation/schemas/reflex-executed.v1.json

  internal.reflex.failed.v1:
    description: Published when a reflex execution fails (for error tracking, alerting, etc.)
    producers:
      - reflex
    consumers: []  # Phase 1: no consumers, just publish for future use
    schema: documentation/schemas/reflex-failed.v1.json
```

### Event Router Integration

**Routing Slip Insertion**:

The event-router must be updated to insert a reflex step after auth:

```typescript
// In event-router rule matching logic:
const defaultAnalysisSlip = [
  { topic: 'internal.auth.v1', service: 'auth' },
  { topic: 'internal.reflex.v1', service: 'reflex' },      // NEW
  { topic: 'internal.query.analysis.v1', service: 'query-analyzer' },
  { topic: 'internal.llmbot.v1', service: 'llm-bot' }
];
```

### Response Flow

**When Reflex Matches**: Call `complete()` to skip remaining analysis steps (query-analyzer, llm-bot)

**When No Match**: Publish to `internal.enriched.v1` to continue normal flow

```typescript
// In reflex bit:
async function handleReflexMessage(event: InternalEventV2) {
  const matches = await matchReflexes(event, cachedRules);

  if (matches.length === 0) {
    // No match: pass through to next analysis step
    await this.next(event);
    return;
  }

  const reflex = matches[0]; // Execute first match only
  const result = await executeReflex(reflex, event);

  // Enrich event with reflex metadata
  const enriched = {
    ...event,
    annotations: [
      ...(event.annotations || []),
      {
        key: 'reflex.matched',
        value: reflex.id,
        timestamp: new Date().toISOString()
      },
      {
        key: 'reflex.action',
        value: reflex.action.tool,
        timestamp: new Date().toISOString()
      },
      {
        key: 'reflex.status',
        value: result.status,
        timestamp: new Date().toISOString()
      }
    ]
  };

  // Add candidate to event if template generated one
  if (result.candidate) {
    enriched.candidates = [
      ...(event.candidates || []),
      result.candidate
    ];
  }

  // **IMPORTANT**: Call complete() to skip remaining analysis (query-analyzer, llm-bot)
  // Reflex handled the event deterministically, no LLM analysis needed
  await this.complete(enriched);

  // Publish reflex execution event for other systems to react
  await publishReflexExecutionEvent(reflex, event, result);
}
```

### Reflex Execution Events

**Purpose**: Allow other systems to react to reflex executions (e.g., schedule follow-up actions)

**Topics**:
- `internal.reflex.executed.v1` - Published on successful reflex execution
- `internal.reflex.failed.v1` - Published on reflex execution error

**Schema** (`internal.reflex.executed.v1`):
```typescript
interface ReflexExecutedEvent {
  v: '1';
  reflexId: string;               // ID of executed reflex
  reflexName: string;             // Name of reflex
  tool: string;                   // MCP tool that was called
  parameters: Record<string, any>; // Resolved parameters (after interpolation)
  result: any;                    // Tool execution result
  latency: number;                // Execution time in ms
  triggeredBy: {
    correlationId: string;        // Original event correlationId
    eventType: string;            // Original event type
    user?: {
      id: string;
      displayName: string;
    };
    channel?: string;
    platform?: string;
  };
  timestamp: string;              // ISO 8601 execution timestamp
}
```

**Schema** (`internal.reflex.failed.v1`):
```typescript
interface ReflexFailedEvent {
  v: '1';
  reflexId: string;
  reflexName: string;
  tool: string;
  parameters: Record<string, any>;
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  latency: number;
  triggeredBy: {
    correlationId: string;
    eventType: string;
    user?: { id: string; displayName: string };
    channel?: string;
    platform?: string;
  };
  timestamp: string;
}
```

**Publishing Logic**:
```typescript
async function publishReflexExecutionEvent(
  reflex: Reflex,
  originalEvent: InternalEventV2,
  result: ExecutionResult
) {
  const topic = result.status === 'success'
    ? 'internal.reflex.executed.v1'
    : 'internal.reflex.failed.v1';

  const executionEvent = {
    v: '1',
    reflexId: reflex.id,
    reflexName: reflex.name,
    tool: reflex.action.tool,
    parameters: result.resolvedParameters, // Store what was actually sent
    ...(result.status === 'success'
      ? { result: result.result }
      : { error: { message: result.error } }
    ),
    latency: result.latency,
    triggeredBy: {
      correlationId: originalEvent.correlationId,
      eventType: originalEvent.event?.type || 'unknown',
      user: originalEvent.identity?.user
        ? {
            id: originalEvent.identity.user.id,
            displayName: originalEvent.identity.user.displayName
          }
        : undefined,
      channel: originalEvent.identity?.channel,
      platform: originalEvent.identity?.external?.platform
    },
    timestamp: new Date().toISOString()
  };

  await this.publish(topic, executionEvent, {
    correlationId: originalEvent.correlationId,
    type: topic
  });

  this.getLogger().info('reflex.execution_event.published', {
    topic,
    reflexId: reflex.id,
    correlationId: originalEvent.correlationId
  });
}
```

**Use Cases** (Future):
1. **Scheduled Follow-up**: After showing fail overlay, hide it after 5 seconds
2. **Chained Reactions**: One reflex triggers another via execution event
3. **Analytics**: Track reflex usage patterns
4. **Audit Trail**: Record all deterministic actions for compliance

**Phase 1 Scope**: Define schemas and publish events only. No consumers yet.

---

## MCP Tool Interface

### Management Tools

The reflex bit will expose MCP tools for managing reflex rules:

#### 1. `reflex.create`

```typescript
this.registerTool(
  'reflex.create',
  'Create a new reflex rule for pattern-based event orchestration',
  z.object({
    name: z.string().describe('Human-readable name'),
    description: z.string().optional(),
    active: z.boolean().default(true),
    priority: z.number().default(100),
    match: z.object({
      type: z.enum(['exact', 'contains', 'regex', 'prefix', 'suffix']),
      pattern: z.string(),
      field: z.string().describe('JSONPath to event field (e.g., message.text)'),
      flags: z.string().optional(),
      caseSensitive: z.boolean().optional()
    }),
    conditions: z.object({
      eventTypes: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
      platforms: z.array(z.string()).optional(),
      userRoles: z.array(z.string()).optional(),
      minAuthLevel: z.number().optional()
    }).optional(),
    action: z.object({
      tool: z.string().describe('MCP tool name (e.g., obs.set_source_visibility)'),
      parameters: z.record(z.any()).describe('Parameters with {{field}} interpolation'),
      timeout: z.number().optional()
    }),
    tags: z.array(z.string()).optional()
  }),
  async (args) => {
    const reflex = await createReflex(args);
    return {
      content: [{
        type: 'text',
        text: `Created reflex: ${reflex.id}`
      }]
    };
  }
);
```

#### 2. `reflex.list`

```typescript
this.registerTool(
  'reflex.list',
  'List all reflex rules with optional filtering',
  z.object({
    active: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().default(50),
    orderBy: z.enum(['priority', 'name', 'createdAt']).default('priority')
  }),
  async (args) => {
    const reflexes = await listReflexes(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(reflexes, null, 2)
      }]
    };
  }
);
```

#### 3. `reflex.update`

```typescript
this.registerTool(
  'reflex.update',
  'Update an existing reflex rule',
  z.object({
    id: z.string(),
    updates: z.object({
      name: z.string().optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
      // ... other fields ...
    })
  }),
  async (args) => {
    await updateReflex(args.id, args.updates);
    return {
      content: [{
        type: 'text',
        text: `Updated reflex: ${args.id}`
      }]
    };
  }
);
```

#### 4. `reflex.delete`

```typescript
this.registerTool(
  'reflex.delete',
  'Delete a reflex rule',
  z.object({
    id: z.string()
  }),
  async (args) => {
    await deleteReflex(args.id);
    return {
      content: [{
        type: 'text',
        text: `Deleted reflex: ${args.id}`
      }]
    };
  }
);
```

#### 5. `reflex.test`

```typescript
this.registerTool(
  'reflex.test',
  'Test a reflex pattern against sample input',
  z.object({
    pattern: z.string(),
    type: z.enum(['exact', 'contains', 'regex', 'prefix', 'suffix']),
    sampleInput: z.string(),
    flags: z.string().optional()
  }),
  async (args) => {
    const isMatch = testPattern(args);
    return {
      content: [{
        type: 'text',
        text: isMatch ? 'Match!' : 'No match'
      }]
    };
  }
);
```

---

## Storage and Persistence

### Firestore Collection: `reflexes`

**Schema**: See [Data Model](#data-model) section

**Indexes**:
```javascript
// firestore.indexes.json additions:
{
  "collectionGroup": "reflexes",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "active", "order": "ASCENDING" },
    { "fieldPath": "priority", "order": "ASCENDING" }
  ]
}
```

### Real-time Synchronization

**Pattern**: Use Firestore listener for cache updates

```typescript
class ReflexManager {
  private cachedRules: Map<string, Reflex> = new Map();
  private unsubscribe?: () => void;

  async initialize() {
    const db = this.getResource<FirestoreResource>('firestore').getDb();
    const reflexesRef = db.collection('reflexes');

    // Initial load
    const snapshot = await reflexesRef.get();
    snapshot.forEach(doc => {
      this.cachedRules.set(doc.id, doc.data() as Reflex);
    });

    // Real-time updates
    this.unsubscribe = reflexesRef.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' || change.type === 'modified') {
          this.cachedRules.set(change.doc.id, change.doc.data() as Reflex);
        } else if (change.type === 'removed') {
          this.cachedRules.delete(change.doc.id);
        }
      });

      this.logger.info('reflex.cache.updated', {
        totalRules: this.cachedRules.size
      });
    });
  }

  getRules(): Reflex[] {
    return Array.from(this.cachedRules.values());
  }

  async close() {
    this.unsubscribe?.();
  }
}
```

---

## Performance Considerations

### Latency Targets

| Operation | Target | Worst Case |
|-----------|--------|------------|
| Pattern matching (per rule) | <1ms | <5ms |
| Full rule evaluation (100 rules) | <100ms | <500ms |
| MCP tool call | <50ms | <5s |
| End-to-end (match + execute) | <150ms | <6s |

### Optimization Strategies

1. **In-Memory Rule Cache**: All rules loaded at startup + real-time sync
2. **Early Exit**: Stop at first match (Phase 1)
3. **Condition Pre-filtering**: Cheap checks before expensive pattern matching
4. **Compiled Regex**: Pre-compile regex patterns, cache compiled instances
5. **Field Path Memoization**: Cache frequently accessed event paths
6. **Async I/O**: Non-blocking Firestore and MCP calls

### Scalability

- **Horizontal**: Stateless design allows multiple reflex instances
- **Rule Limit**: Target 1000 active rules without degradation
- **Throughput**: >1000 events/second per instance

---

## Error Handling and Observability

### Error Categories

1. **Match Errors**: Field not found, invalid regex, timeout
2. **Execution Errors**: MCP tool failure, network timeout, auth failure
3. **System Errors**: Firestore unavailable, cache corruption

### Error Handling Strategy

```typescript
try {
  const matches = await matchReflexes(event, rules);
  if (matches.length > 0) {
    await executeReflex(matches[0], event);
  }
  await publishEnriched(event);
} catch (error) {
  // Log but don't block event flow
  logger.error('reflex.critical_error', { error, correlationId: event.correlationId });

  // Publish event anyway (degraded mode)
  await publishEnriched(event, { reflexError: error.message });
}
```

**Principle**: Reflex failures should NEVER block event processing. Always pass through.

### Logging

**Structured Logs**:
```typescript
// Match
logger.debug('reflex.match.evaluated', {
  reflexId, reflexName, matched: true/false, latency
});

// Execution
logger.info('reflex.execution.started', {
  reflexId, tool, correlationId
});

logger.info('reflex.execution.success', {
  reflexId, tool, latency, result
});

logger.error('reflex.execution.error', {
  reflexId, tool, error, correlationId
});
```

### Metrics

**Key Metrics**:
- `reflex_match_total{reflex_id}` - Total matches per reflex
- `reflex_execution_total{reflex_id, status}` - Executions by status
- `reflex_latency_ms{operation}` - Latency distribution
- `reflex_cache_size` - Number of cached rules

---

## Security Considerations

### Authorization

1. **MCP Tool Management**: Require `bit:operate` scope for reflex CRUD operations
2. **Rule Conditions**: Respect `userRoles` and `minAuthLevel` from auth service
3. **Template Injection**: Sanitize field paths to prevent injection attacks

### Input Validation

1. **Regex Safety**: Use `safe-regex` to detect ReDoS patterns at creation time
2. **Field Path Validation**: Whitelist allowed field paths or validate syntax
3. **Parameter Validation**: Validate MCP tool parameters against tool schema

### Secrets Management

- **MCP_AUTH_TOKEN**: Required for tool-gateway communication (from Secret Manager)
- **No User Secrets**: Reflex rules should not contain API keys or tokens

---

## Future Extensibility

### Phase 2: Multi-Tool Chains

Allow reflexes to invoke multiple MCP tools in sequence:

```typescript
action: {
  chain: [
    {
      tool: 'obs.set_source_visibility',
      parameters: { sourceName: 'FailOverlay', visible: true }
    },
    {
      tool: 'twitch.send_chat_message',
      parameters: { message: 'Fail triggered by {{identity.user.displayName}}!' }
    }
  ]
}
```

### Phase 3: Scripting/DSL

Embed lightweight scripting for complex logic:

```typescript
action: {
  script: `
    if (event.message.text.includes('epic')) {
      await tools.obs.set_source_visibility({ sourceName: 'EpicOverlay', visible: true });
      await tools.wait(5000);
      await tools.obs.set_source_visibility({ sourceName: 'EpicOverlay', visible: false });
    }
  `
}
```

**Candidates**: QuickJS, Deno isolated runtime, or custom DSL

### Phase 4: State Management

Add simple state tracking for cooldowns, counters:

```typescript
state: {
  cooldown: 5000,      // 5s cooldown between triggers
  maxPerUser: 3,       // Max 3 triggers per user per session
  resetOn: 'stream-end'
}
```

---

## Implementation Phases

### Phase 1: Core Functionality (This Sprint)

**Scope**:
1. Reflex rule data model + Firestore schema (with candidateTemplate field)
2. Matching engine (all 5 match types + conditions)
3. Orchestration engine:
   - Single tool invocation
   - Template interpolation for action parameters
   - Candidate template building (access to {{event.field}} and {{result.field}})
4. Event flow integration:
   - Subscribe to `internal.reflex.v1`
   - Call `complete()` on match (skip remaining analysis)
   - Call `next()` on no match (continue to query-analyzer)
   - Add generated candidate to event before complete()
5. Execution event publishing:
   - Define schemas for `internal.reflex.executed.v1` and `internal.reflex.failed.v1`
   - Publish on success/failure (no consumers yet, just publish)
6. MCP management tools (create, list, update, delete, test)
7. In-memory cache with Firestore listener
8. Comprehensive logging and error handling

**Deliverables**:
- `src/apps/reflex-service.ts` (complete implementation)
- `src/services/reflex/` (matching, orchestration, storage modules)
- `documentation/schemas/reflex-executed.v1.json` (execution event schema)
- `documentation/schemas/reflex-failed.v1.json` (failure event schema)
- Firestore indexes for `reflexes` collection
- architecture.yaml updates (3 new topics: internal.reflex.v1, executed, failed)
- Unit tests (>80% coverage)
- Integration tests (e2e flow with complete()/next() verification)
- Documentation updates

**Estimated Effort**: 3-4 days

### Phase 2: Advanced Orchestration (Future Sprint)

- Multi-tool chains
- Conditional tool execution
- Result-based branching

### Phase 3: Scripting Support (Future Sprint)

- Embedded scripting runtime
- Custom DSL design
- Sandbox security

### Phase 4: State Management (Future Sprint)

- Cooldowns
- Rate limiting
- Per-user/per-channel state

---

## Testing Strategy

### Unit Tests

**Modules to Test**:
1. **Matching Engine**:
   - All match types (exact, contains, regex, prefix, suffix)
   - Condition evaluation
   - Field path resolution
   - ReDoS protection

2. **Orchestration Engine**:
   - Template interpolation
   - MCP tool invocation (mocked)
   - Timeout handling

3. **Reflex Manager**:
   - CRUD operations
   - Cache synchronization
   - Firestore listener

**Target Coverage**: >80%

### Integration Tests

**Scenarios**:
1. **E2E Flow - Match and Complete**:
   - Publish event to internal.reflex.v1
   - Match reflex rule
   - Execute MCP tool (mocked tool-gateway)
   - Verify `internal.reflex.executed.v1` published with execution details
   - Verify `complete()` called (event goes to egress, skips query-analyzer)

2. **No Match - Next Flow**:
   - Event with no matching reflex
   - Verify `next()` called (event continues to query-analyzer)
   - Verify no execution events published

3. **Multiple Rules**:
   - First match executes (priority ordering)
   - Lower priority rules ignored

4. **Error Handling - Degraded Mode**:
   - MCP tool failure
   - Verify `internal.reflex.failed.v1` published with error details
   - Verify `complete()` still called (doesn't block event flow)
   - Verify error logged but event processed

5. **Execution Event Schemas**:
   - Verify `internal.reflex.executed.v1` contains all required fields
   - Verify `internal.reflex.failed.v1` contains error details
   - Verify events can be consumed by future services

### Manual Testing

**Test Cases**:
1. Create `!fail` reflex via MCP tool
2. Send chat message `!fail` through platform
3. Verify OBS source visibility toggled
4. Check logs for execution trace

**Tools**:
- `brat chat` for sending test events
- Firestore console for inspecting rules
- OBS WebSocket logs

---

## Success Criteria

### Functional

- ✅ Reflex rules can be created via MCP tools
- ✅ Chat message `!fail` triggers OBS source visibility
- ✅ Reflex executes in <150ms p99 (excluding MCP tool time)
- ✅ Matched reflexes call `complete()` to skip remaining analysis (query-analyzer, llm-bot)
- ✅ Unmatched events call `next()` to continue normal flow
- ✅ Failed reflexes don't block event flow (degraded mode)
- ✅ All 5 match types work correctly
- ✅ Condition filtering works (eventTypes, roles, etc.)
- ✅ Candidate template generates response from {{event.field}} and {{result.field}}
- ✅ Generated candidate added to event before complete()
- ✅ Execution events published to `internal.reflex.executed.v1` (success)
- ✅ Failure events published to `internal.reflex.failed.v1` (errors)

### Non-Functional

- ✅ >80% unit test coverage
- ✅ Integration tests pass
- ✅ Firestore listener updates cache in real-time
- ✅ Comprehensive structured logging
- ✅ Documentation complete (architecture, API, user guide)

### Operational

- ✅ Deployed to staging environment
- ✅ LLM can create/manage reflexes via MCP tools
- ✅ Observable via logs and metrics
- ✅ No performance degradation to event pipeline

---

## Decision Log

### Decision 1: Single Tool vs. Multi-Tool Chains

**Options**:
1. Support multi-tool chains in Phase 1
2. Single tool only, defer chains to Phase 2

**Decision**: Single tool only (Phase 1)

**Rationale**:
- Reduces complexity for initial implementation
- Allows learning from real usage before designing chain orchestration
- Most use cases (like `!fail`) require only one tool
- Can be added backward-compatibly in Phase 2

**Trade-offs**: Some advanced use cases will need to wait

---

### Decision 2: Regex vs. Glob vs. Both

**Options**:
1. Regex only (maximum flexibility)
2. Glob only (user-friendly)
3. Both regex and glob

**Decision**: Regex + 4 simple types (exact, contains, prefix, suffix)

**Rationale**:
- Regex covers 100% of cases
- Simple types handle 80% of cases without regex complexity
- Users can choose based on comfort level
- ReDoS protection makes regex safe

**Trade-offs**: Slightly more implementation work

---

### Decision 3: Firestore Listener vs. Polling

**Options**:
1. Firestore real-time listener (onSnapshot)
2. Periodic polling (every 60s)
3. Manual cache refresh via MCP tool

**Decision**: Firestore real-time listener

**Rationale**:
- Instant updates when rules change
- No polling overhead
- Consistent with other BitBrat services
- Firestore listeners are reliable and efficient

**Trade-offs**: Persistent connection overhead (minimal)

---

### Decision 4: Pass-Through on Error vs. Block

**Options**:
1. Block event processing on reflex error
2. Pass through event anyway (degraded mode)

**Decision**: Pass through event (degraded mode)

**Rationale**:
- Reflexes are optional optimizations, not critical path
- Blocking would create cascading failures
- Better user experience (slight delay vs. total failure)
- Consistent with resilience principles

**Trade-offs**: Silent failures possible (mitigated by logging)

---

## Appendices

### Appendix A: Example Reflex Rules

#### 1. !fail Command
```json
{
  "name": "OBS Fail Toggle",
  "match": { "type": "exact", "pattern": "!fail", "field": "message.text" },
  "action": {
    "tool": "obs.set_source_visibility",
    "parameters": { "sourceName": "FailOverlay", "visible": true }
  }
}
```

#### 2. !lurk Command
```json
{
  "name": "Lurk Response",
  "match": { "type": "exact", "pattern": "!lurk", "field": "message.text" },
  "action": {
    "tool": "twitch.send_chat_message",
    "parameters": { "message": "Thanks for lurking, {{identity.user.displayName}}!" }
  }
}
```

#### 3. Subscriber Alert
```json
{
  "name": "New Subscriber Celebration",
  "match": { "type": "exact", "pattern": "subscription", "field": "event.type" },
  "conditions": { "platforms": ["twitch"] },
  "action": {
    "tool": "obs.set_source_visibility",
    "parameters": { "sourceName": "SubAlert", "visible": true }
  }
}
```

### Appendix B: MCP Tool Call Example

**Request to tool-gateway**:
```http
POST /mcp/call HTTP/1.1
Host: tool-gateway:3000
Authorization: Bearer <MCP_AUTH_TOKEN>
Content-Type: application/json

{
  "tool": "obs.set_source_visibility",
  "arguments": {
    "sourceName": "FailOverlay",
    "visible": true,
    "sceneName": "MainScene"
  }
}
```

**Response**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Source 'FailOverlay' visibility set to true in scene 'MainScene'"
    }
  ]
}
```

### Appendix C: Event Flow Diagram (With Reflex)

**Scenario 1: Reflex Match (e.g., "!fail")**
```
1. Twitch Chat: "!fail"
   ↓
2. ingress-egress → internal.ingress.v1
   ↓
3. event-router (attach routing slip with reflex step)
   ↓
4. event-router → internal.auth.v1 → auth service
   ↓
5. auth → internal.enriched.v1 (with auth context)
   ↓
6. event-router → internal.reflex.v1 → **reflex service** ← NEW
   ↓
7. reflex: pattern match "!fail" → MATCH FOUND
   ↓
8. reflex: execute obs.set_source_visibility (via tool-gateway)
   ↓
9. reflex → internal.reflex.executed.v1 (execution event for future use) ← NEW
   ↓
10. reflex: call complete() with enriched event ← CRITICAL CHANGE
    (Skips query-analyzer, llm-bot - no LLM needed!)
   ↓
11. event-router → internal.egress.v1 (route to egress stage)
   ↓
12. ingress-egress: send response to Twitch
```

**Scenario 2: No Reflex Match (continue to LLM analysis)**
```
1. Twitch Chat: "What's the weather?"
   ↓
2-6. [Same as Scenario 1]
   ↓
7. reflex: pattern match → NO MATCH
   ↓
8. reflex: call next() to continue routing slip
   ↓
9. event-router → internal.query.analysis.v1 → query-analyzer
   ↓
10. [Continue with normal LLM flow...]
```

**Scenario 3: Reflex Execution Failure**
```
1. Twitch Chat: "!fail"
   ↓
2-7. [Same as Scenario 1]
   ↓
8. reflex: execute obs.set_source_visibility → MCP TOOL FAILS
   ↓
9. reflex → internal.reflex.failed.v1 (failure event with error details) ← NEW
   ↓
10. reflex: call complete() anyway (degraded mode - don't block event)
   ↓
11. event-router → internal.egress.v1
   ↓
12. User sees fallback response (or silent failure with logging)
```

---

## End of Document

**Next Steps**:
1. Review and approve this Technical Architecture document
2. Create Implementation Plan with detailed task breakdown
3. Update architecture.yaml with new topic and service configuration
4. Begin Phase 1 implementation

**Questions for Review**:
1. Is single-tool limitation acceptable for Phase 1?
2. Should reflexes support OR logic for conditions (in addition to AND)?
3. Do we need explicit support for "command prefix" pattern (e.g., all !commands)?
4. Should reflex execution be synchronous (wait for result) or async (fire and forget)?

**Approval Required**: Lead Implementor / Product Owner
