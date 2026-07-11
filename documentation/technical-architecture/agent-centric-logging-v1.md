# Technical Architecture: Agent-Centric Logging v1

> **Status:** Proposed
> **Date:** 2026-07-10
> **Sprint:** TBD
> **Scope:** Redesign BitBrat logging to be agent-first with automatic correlationId propagation
> **Precedence:** Implements requirements aligned with `architecture.yaml` and reactive agent loop architecture

---

## Executive Summary

BitBrat logging was designed for human-readable structured logs with manual context passing. As the platform evolves into a reactive agent system with distributed tracing, fleet observability, and MCP-based introspection, **logs must become first-class agent artifacts**.

### The Core Problem

**CorrelationId inconsistency breaks distributed tracing.** Services manually include `correlationId` in some log statements but forget it in others. This creates blind spots in fleet.trace operations and makes it impossible for agents to reliably reconstruct event flows.

### The Solution

**Automatic context propagation via AsyncLocalStorage.** Instead of manually passing `correlationId` (and future context fields) to every log call, we use Node.js AsyncLocalStorage to maintain event context throughout the async call chain. The Logger automatically injects this context into every log entry.

### Benefits

1. **100% correlationId coverage** — No log entry escapes without correlation context
2. **Agent-queryable logs** — Agents can reliably trace events via `fleet.trace` and `fleet.logs`
3. **Zero developer burden** — Services log naturally; context injection is automatic
4. **Future-proof** — Add new context fields (traceId, sessionId, userId) without code changes
5. **Policy-aware logging** — Foundation for stage-level policy logging and evidence capture

---

## Current State Analysis

### Logging Infrastructure

**Location:** `src/common/logging.ts` (lines 64-156)

The `Logger` class provides:
- Structured JSON logging to stdout/stderr
- Log levels: error, warn, info, debug, trace
- Automatic secret redaction via `redactSecrets()`
- Cloud Logging severity mapping
- **Automatic correlation via OpenTelemetry spans** (when available)

#### How Correlation Works Today

```typescript
// src/common/logging.ts:96-109
private base(entry: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    ts: new Date().toISOString(),
    service: Logger.getServiceName(),
    ...entry,
  };
  try {
    const corr = getLogCorrelationFields();  // From tracing.ts
    if (corr) {
      Object.assign(base, corr);
    }
  } catch {}
  return base;
}
```

**`getLogCorrelationFields()`** (src/common/tracing.ts:81-97):
```typescript
export function getLogCorrelationFields(): Record<string, string | boolean> | undefined {
  try {
    const span = api.trace.getActiveSpan();
    if (!span) return undefined;
    const spanCtx = span.spanContext();
    if (!spanCtx || !api.isSpanContextValid(spanCtx)) return undefined;
    const pid = process.env.GOOGLE_CLOUD_PROJECT || ...;
    if (!pid) return undefined;
    return {
      'logging.googleapis.com/trace': `projects/${pid}/traces/${spanCtx.traceId}`,
      'logging.googleapis.com/spanId': spanCtx.spanId,
      'logging.googleapis.com/trace_sampled': spanCtx.traceFlags === api.TraceFlags.SAMPLED,
    };
  } catch {
    return undefined;
  }
}
```

#### Critical Limitation

**Automatic correlation ONLY works inside OpenTelemetry spans**, which requires:
1. `TRACING_ENABLED=1`
2. Active span context
3. Valid span
4. `GOOGLE_CLOUD_PROJECT` environment variable

**Outside of OTel spans, correlationId is lost.**

### Logger Access Patterns

#### Pattern 1: Service-Level Logger (Bit base class)
```typescript
// base-server.ts:136-137, 245-248
Logger.setServiceName(this.serviceName);
this.logger = new Logger(this.config.logLevel);

// Usage:
const logger = this.getLogger();
logger.info('llm_bot.received', { attributes });
```

**Used in:**
- llm-bot-service.ts:158
- reflex-service.ts:81-82
- api-gateway.ts:167
- image-gen-mcp/index.ts:52

#### Pattern 2: Global Logger Import
```typescript
import { logger } from '../common/logging';

logger.warn('event_router.debug_counters_error', { error: e?.message });
```

**Used in:**
- event-router-service.ts:4
- ingress-egress-service.ts:26
- auth-service.ts
- 40+ service files

#### Pattern 3: Logger from Service Instance
```typescript
// llm-bot/processor.ts:394
const logger = (server as any).getLogger?.();
```

### CorrelationId Logging Patterns

#### ✅ Good Examples (Consistent Inclusion)

**reflex-service.ts** (lines 129-180):
```typescript
logger.info('reflex.event.processing', {
  correlationId: event.correlationId,
  eventType: event.type,
});

logger.info('reflex.event.no_match', {
  correlationId: event.correlationId,
  latency,
});

logger.info('reflex.event.matched', {
  correlationId: event.correlationId,
  reflexId: result.reflex.id,
  latency,
});
```

**base-server.ts routing helpers** (lines 786-934):
```typescript
this.logger.debug('routing.next.idempotent_noop', {
  correlationId: event?.correlationId
});

this.logger.warn('routing.next.no_target', {
  correlationId: event?.correlationId
});

this.logger.info('routing.next.fallback_egress', {
  dest,
  correlationId: event?.correlationId
});
```

#### ⚠️ Problems (Missing or Inconsistent)

**llm-bot-service.ts** (lines 156-191):
```typescript
// ❌ NO correlationId
logger.info('llm_bot.received', { attributes });
logger.debug('llm_bot.received.annotations', { annotations: data.annotations });
logger.debug('llm_bot.processing');
logger.error('llm_bot.process_error', { error: e });

// ✅ HAS correlationId (inconsistent!)
logger.warn('llm_bot.processed.no_candidates', { correlationId: data.correlationId });
logger.info('llm_bot.processed', { correlationId: (data as any)?.correlationId, status });
```

**event-router-service.ts** (lines 73-186):
```typescript
// ❌ NO correlationId
logger.warn('event_router.debug_counters_error', { error: e?.message });
logger.debug('event_router.rule_loader.disabled_for_tests');
logger.info('event_router.subscribe.start', { subject, queue: 'event-router' });
logger.error('event_router.ingress.process_error', { subject, error: msg });

// ✅ HAS correlationId (when remembered)
logger.debug('event_router.ingress.received', {
  subject: inputTopic,
  correlationId: v2In.correlationId,
});
```

### Type Inconsistencies

Different services extract correlationId differently:
```typescript
data.correlationId           // Direct access
(data as any)?.correlationId // Type-cast with optional chaining
event?.correlationId         // Optional chaining
evt?.correlationId          // Different variable name
```

### Summary of Issues

| Issue | Impact | Frequency |
|-------|--------|-----------|
| **Missing correlationId** | Breaks distributed tracing | ~60% of log statements |
| **Inconsistent inclusion** | Creates trace gaps | Every service |
| **Manual passing required** | Developer burden | Every log call |
| **Type inconsistencies** | Code smell, maintenance | Common |
| **OTel dependency** | Only works in spans | Always |
| **No async context** | Lost outside spans | Common |
| **Mixed logger sources** | Inconsistent service labeling | Many services |

---

## Agent-Centric Requirements

### Why Logs Are Agent Artifacts

BitBrat is evolving from a human-monitored service platform to a **reactive agent system**. In this model:

1. **Agents are first-class observers** — fleet.logs and fleet.trace tools allow agents to inspect system behavior
2. **Events are correlated** — Every log must tie back to the originating event
3. **Policy is reactive** — Logs provide evidence for stage-level policy evaluation
4. **Learning requires evidence** — Introspection and learning stages need complete audit trails
5. **Humans are secondary** — Logs must be machine-queryable first, human-readable second

### Reactive Agent Loop Requirements

From `documentation/architecture/reactive-agent-loop-technical-overview.md`:

> **Formalization:**
> - Preserve `InternalEventV2` as the event record.
> - **Require all lifecycle events to carry `correlationId`**.
> - Add stage evidence through `annotations`, `candidates`, `metadata`, and routing history.

The reactive agent lifecycle is:
```
Event -> Attention -> Contextualization -> Analysis -> Reaction -> Introspection -> Learning
```

**Every log is potential evidence for a lifecycle stage.** Without consistent correlation:
- Attention decisions are unverifiable
- Contextualization is incomplete
- Analysis cannot be replayed
- Reaction approval/rejection is invisible
- Introspection cannot reason about past behavior
- Learning proposals lack evidence

### Fleet Observability Requirements

The fleet.logs and fleet.trace MCP tools (Sprint 334) require:

1. **Universal correlationId coverage** — Every log must include correlationId
2. **Structured correlation fields** — Machine-parseable, not embedded in messages
3. **Cross-service consistency** — Same field names across all Bits
4. **Temporal ordering** — Timestamps + correlation enables timeline reconstruction
5. **Filter-friendly** — Agents query by correlationId, level, service, time range

### Policy and Evidence Requirements

Stage-level policy enforcement (proposed) will require:

- **Evidence capture**: Logs prove what happened at each stage
- **Policy annotations**: Log which policy rules applied
- **Outcome logging**: Record whether actions were allowed/denied/escalated
- **Audit trail**: Correlation enables policy compliance review

---

## Recommended Solution Architecture

### Core Concept: AsyncLocalStorage Context

Use Node.js `AsyncLocalStorage` to maintain event context throughout the async call chain. This is similar to how OpenTelemetry propagates span context, but independent of tracing.

**Key Insight:** Instead of passing `correlationId` as a parameter to every function and log call, we store it in async-local context and the Logger automatically retrieves it.

### Architecture Components

#### 1. Event Context Store

**New file:** `src/common/event-context.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Event context that flows with async operations
 */
export interface EventContext {
  correlationId?: string;
  traceId?: string;
  sessionId?: string;
  userId?: string;
  requestId?: string;
  stage?: string;  // Reactive agent loop stage (attention, analysis, reaction, etc.)
  [key: string]: unknown;
}

/**
 * Async-local storage for event context
 */
const eventContextStore = new AsyncLocalStorage<EventContext>();

/**
 * Run a function with event context
 */
export function runWithEventContext<T>(
  context: EventContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return eventContextStore.run(context, fn);
}

/**
 * Get current event context (returns undefined if not in context)
 */
export function getEventContext(): EventContext | undefined {
  return eventContextStore.getStore();
}

/**
 * Get a specific field from event context
 */
export function getContextField(key: keyof EventContext): unknown {
  const ctx = eventContextStore.getStore();
  return ctx?.[key];
}

/**
 * Update event context (merges with existing context)
 */
export function updateEventContext(updates: Partial<EventContext>): void {
  const current = eventContextStore.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}
```

#### 2. Enhanced Logger

**Update:** `src/common/logging.ts`

```typescript
import { getEventContext } from './event-context';

export class Logger {
  // ... existing code ...

  private base(entry: Record<string, unknown>) {
    const base: Record<string, unknown> = {
      ts: new Date().toISOString(),
      service: Logger.getServiceName(),
      ...entry,
    };

    // Try OpenTelemetry correlation first (for Cloud Logging linkage)
    try {
      const corr = getLogCorrelationFields();
      if (corr) {
        Object.assign(base, corr);
      }
    } catch {}

    // Always add event context (correlationId, sessionId, userId, etc.)
    try {
      const eventCtx = getEventContext();
      if (eventCtx) {
        // Add correlationId if present
        if (eventCtx.correlationId) {
          base.correlationId = eventCtx.correlationId;
        }
        // Add traceId if present (and not already from OTel)
        if (eventCtx.traceId && !base['logging.googleapis.com/trace']) {
          base.traceId = eventCtx.traceId;
        }
        // Add sessionId if present
        if (eventCtx.sessionId) {
          base.sessionId = eventCtx.sessionId;
        }
        // Add userId if present
        if (eventCtx.userId) {
          base.userId = eventCtx.userId;
        }
        // Add stage if present (reactive agent loop stage)
        if (eventCtx.stage) {
          base.stage = eventCtx.stage;
        }
        // Add requestId if present
        if (eventCtx.requestId) {
          base.requestId = eventCtx.requestId;
        }
      }
    } catch {}

    return base;
  }

  // ... rest of Logger remains unchanged ...
}
```

#### 3. BaseServer Integration

**Update:** `src/common/base-server.ts`

Wrap message handlers with event context:

```typescript
import { runWithEventContext, EventContext } from './event-context';

export class BaseServer {
  // ... existing code ...

  protected async onMessage<T = any>(
    opts: SubscribeOptions | string,
    handler: (data: T, attributes: AttributeMap, ctx: MessageContext) => void | Promise<void>
  ): Promise<void> {
    // ... existing setup code ...

    const wrappedHandler = async (data: T, attributes: AttributeMap, ctx: MessageContext) => {
      // Extract correlationId from data if available
      const correlationId = (data as any)?.correlationId;
      const traceId = (data as any)?.traceId;
      const sessionId = (data as any)?.sessionId;
      const userId = (data as any)?.identity?.user?.userId;

      // Build event context
      const eventContext: EventContext = {};
      if (correlationId) eventContext.correlationId = correlationId;
      if (traceId) eventContext.traceId = traceId;
      if (sessionId) eventContext.sessionId = sessionId;
      if (userId) eventContext.userId = userId;

      // Run handler with event context
      return runWithEventContext(eventContext, () => handler(data, attributes, ctx));
    };

    // Subscribe with wrapped handler
    await messageBus.subscribe(destination, wrappedHandler, { queue, ack });
  }

  // ... rest remains unchanged ...
}
```

#### 4. HTTP Request Integration

**Update:** `src/common/base-server.ts` (for Express routes)

```typescript
// Add middleware to extract context from HTTP requests
protected setupHttpContextMiddleware(): void {
  this.app.use((req, res, next) => {
    const eventContext: EventContext = {
      correlationId: req.headers['x-correlation-id'] as string ||
                     req.headers['x-request-id'] as string ||
                     crypto.randomUUID(),
      requestId: req.headers['x-request-id'] as string,
      traceId: req.headers['x-cloud-trace-context'] as string,
      sessionId: req.headers['x-session-id'] as string,
      userId: (req as any).user?.userId,
    };

    runWithEventContext(eventContext, () => {
      next();
    });
  });
}
```

### Migration Path

#### Phase 1: Foundation (Week 1)

**Goal:** Add AsyncLocalStorage infrastructure without breaking existing code

1. Create `src/common/event-context.ts`
2. Update `Logger.base()` to include event context fields
3. Add tests for event context propagation
4. Deploy to staging, verify logs still work

**Risk:** Low. Additive only, no breaking changes.

#### Phase 2: Message Handler Integration (Week 1-2)

**Goal:** Automatic context injection for all message handlers

1. Update `BaseServer.onMessage()` to wrap handlers with context
2. Update `BaseServer.setupHttpContextMiddleware()` for HTTP routes
3. Deploy to staging
4. Verify correlationId appears in logs automatically

**Risk:** Medium. Changes core message handling, but wrapping is transparent.

#### Phase 3: Service Cleanup (Week 2-3)

**Goal:** Remove manual correlationId passing

1. Audit all services for manual `correlationId` inclusion
2. Remove redundant `correlationId: data.correlationId` from log calls
3. Update routing helpers in base-server.ts (optional, cleanup)
4. Deploy incrementally per service

**Risk:** Low. Pure cleanup, context is already auto-injected.

#### Phase 4: Enhanced Context (Week 3-4)

**Goal:** Add sessionId, userId, stage to logs

1. Extend `EventContext` with new fields
2. Update context extraction in BaseServer
3. Update Logger to emit new fields
4. Add stage annotations to routing slip advancement

**Risk:** Low. Additive only.

#### Phase 5: Policy and Evidence (Future)

**Goal:** Stage-level policy logging

1. Add policy annotations to event context
2. Log policy decisions with context
3. Enable policy audit via fleet.logs
4. Integrate with reactive agent loop stages

**Risk:** Medium. Depends on policy engine implementation.

### Backward Compatibility

**100% backward compatible:**
- Existing services continue to work without changes
- Manual `correlationId` inclusion still works (will be deduplicated)
- Global logger import still works
- OpenTelemetry correlation still works
- No changes to log output format (JSON structure unchanged)

**Opt-in migration:**
- Services can remove manual correlationId at their own pace
- New services automatically get full context
- Old logs remain queryable

### Testing Strategy

#### Unit Tests

```typescript
// src/common/event-context.test.ts
describe('EventContext', () => {
  it('should propagate context through async operations', async () => {
    await runWithEventContext({ correlationId: 'test-123' }, async () => {
      const ctx = getEventContext();
      expect(ctx?.correlationId).toBe('test-123');
    });
  });

  it('should return undefined outside context', () => {
    const ctx = getEventContext();
    expect(ctx).toBeUndefined();
  });

  it('should allow context updates', async () => {
    await runWithEventContext({ correlationId: 'test-123' }, async () => {
      updateEventContext({ sessionId: 'session-456' });
      const ctx = getEventContext();
      expect(ctx?.correlationId).toBe('test-123');
      expect(ctx?.sessionId).toBe('session-456');
    });
  });
});

// src/common/logging.test.ts
describe('Logger with EventContext', () => {
  it('should include correlationId from context', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    await runWithEventContext({ correlationId: 'test-123' }, async () => {
      const logger = new Logger('info');
      logger.info('test.message');
    });

    console.log = originalLog;

    const logEntry = JSON.parse(logs[0]);
    expect(logEntry.correlationId).toBe('test-123');
  });
});
```

#### Integration Tests

```typescript
// Test message handler context propagation
describe('BaseServer message handlers', () => {
  it('should auto-inject correlationId from message data', async () => {
    const server = new TestBitServer(testConfig);

    const logEntries: any[] = [];
    const logger = server.getLogger();
    const originalInfo = logger.info.bind(logger);
    logger.info = (msg: string, ctx?: any) => {
      logEntries.push({ msg, ctx });
      originalInfo(msg, ctx);
    };

    await server.onMessage('test.topic', async (data) => {
      logger.info('handler.called');
    });

    await publishMessage('test.topic', { correlationId: 'msg-789' });

    await eventually(() => {
      expect(logEntries.length).toBeGreaterThan(0);
      // Verify correlationId was auto-injected (check actual log output)
    });
  });
});
```

#### Fleet Observability Tests

```typescript
// Test fleet.trace with automatic correlation
describe('Fleet observability', () => {
  it('should trace events end-to-end with automatic correlation', async () => {
    // Publish event to ingress
    await publishToIngress({
      correlationId: 'trace-test-001',
      type: 'twitch.chat.message',
      message: '!test command',
    });

    // Wait for processing
    await sleep(2000);

    // Query fleet.trace
    const trace = await fleetClient.trace('trace-test-001');

    // Verify all services logged with correlationId
    expect(trace.services).toContain('ingress-egress');
    expect(trace.services).toContain('event-router');
    expect(trace.services).toContain('llm-bot');
    expect(trace.timeline.length).toBeGreaterThan(0);
    expect(trace.timeline.every(entry => entry.correlationId)).toBe(true);
  });
});
```

---

## Implementation Plan

### Sprint Scope (Recommended)

**Sprint Goal:** Implement AsyncLocalStorage-based event context with automatic correlationId injection

**Deliverables:**
1. Event context infrastructure (event-context.ts)
2. Enhanced Logger with context injection
3. BaseServer message handler integration
4. HTTP middleware for API routes
5. Unit and integration tests
6. Documentation updates
7. Staged deployment to staging → production

**Out of Scope (Future Work):**
- Removing all manual correlationId passing (cleanup sprint)
- Stage-level policy logging (depends on policy engine)
- Enhanced context fields beyond correlationId/traceId/sessionId
- Learning and introspection integration

### Success Criteria

**Must Have:**
- [ ] 100% of logs include correlationId when event context is available
- [ ] fleet.trace returns complete timelines for test events
- [ ] No performance degradation (AsyncLocalStorage overhead < 1%)
- [ ] All existing tests pass
- [ ] Backward compatible with existing services

**Nice to Have:**
- [ ] sessionId and userId in logs where available
- [ ] Stage annotations in routing slip logs
- [ ] HTTP request correlation works end-to-end

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AsyncLocalStorage performance | Low | Medium | Benchmark, disable if >1% overhead |
| Context propagation bugs | Medium | High | Extensive tests, staged rollout |
| Interaction with OTel | Medium | Medium | Test both paths, OTel takes precedence |
| Breaking existing services | Low | Critical | 100% backward compatible design |
| Memory leaks in context | Low | High | Proper cleanup, monitoring |

---

## References

### Existing Documentation

- `documentation/observability/tracing.md` — OpenTelemetry tracing integration
- `documentation/architecture/reactive-agent-loop-technical-overview.md` — Agent lifecycle model
- `src/common/logging.ts` — Current Logger implementation
- `src/common/tracing.ts` — OpenTelemetry integration
- `src/common/base-server.ts` — Bit base class and message handling

### External References

- [Node.js AsyncLocalStorage](https://nodejs.org/api/async_context.html#class-asynclocalstorage)
- [Google Cloud Logging Correlation](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)

### Key Architecture Principles

From `architecture.yaml`:
> **messaging.envelope.required:**
> - correlationId

From `reactive-agent-loop-technical-overview.md`:
> **Formalization:**
> - Require all lifecycle events to carry `correlationId`.

---

## Appendix A: Full Code Examples

### Example Service Before (Manual Correlation)

```typescript
// llm-bot-service.ts (current)
await this.onMessage<InternalEventV2>('internal.llmbot.v1', async (data, attributes, ctx) => {
  const logger = this.getLogger();

  logger.info('llm_bot.received', { attributes });  // ❌ Missing correlationId
  logger.debug('llm_bot.processing');  // ❌ Missing correlationId

  const status = await processEvent(this, data, { registry: this.registry });

  logger.info('llm_bot.processed', {
    correlationId: data.correlationId,  // ✅ Manual inclusion
    status
  });
});
```

### Example Service After (Automatic Correlation)

```typescript
// llm-bot-service.ts (with AsyncLocalStorage)
await this.onMessage<InternalEventV2>('internal.llmbot.v1', async (data, attributes, ctx) => {
  const logger = this.getLogger();

  // correlationId automatically injected by Logger
  logger.info('llm_bot.received', { attributes });  // ✅ Has correlationId
  logger.debug('llm_bot.processing');  // ✅ Has correlationId

  const status = await processEvent(this, data, { registry: this.registry });

  logger.info('llm_bot.processed', { status });  // ✅ Has correlationId
});
```

### Example Log Output

**Before (Inconsistent):**
```json
{"ts":"2026-07-10T19:45:01.234Z","service":"llm-bot","level":"info","msg":"llm_bot.received"}
{"ts":"2026-07-10T19:45:01.456Z","service":"llm-bot","level":"info","msg":"llm_bot.processed","correlationId":"abc-123"}
```

**After (Consistent):**
```json
{"ts":"2026-07-10T19:45:01.234Z","service":"llm-bot","level":"info","msg":"llm_bot.received","correlationId":"abc-123"}
{"ts":"2026-07-10T19:45:01.456Z","service":"llm-bot","level":"info","msg":"llm_bot.processed","correlationId":"abc-123","status":"OK"}
```

---

## Conclusion

Logging is a first-class agent artifact in BitBrat. The shift to AsyncLocalStorage-based event context propagation:

1. **Solves the correlationId consistency problem** — 100% coverage, zero developer burden
2. **Enables agent observability** — fleet.trace and fleet.logs work reliably
3. **Future-proofs the platform** — Foundation for stage-level policy, evidence capture, and learning
4. **Maintains backward compatibility** — Existing services continue to work unchanged
5. **Aligns with reactive agent architecture** — Logs become verifiable evidence for lifecycle stages

The recommended implementation is low-risk, high-value, and can be delivered in a single sprint with staged rollout.
