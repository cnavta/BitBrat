# Technical Architecture — Routing Slip in BaseServer (Architect)

## Objective
- Incorporate routing slip behavior (currently implemented within the command-processor) into `BaseServer` so all services can advance or complete routing uniformly.
- Provide protected helper methods on `BaseServer` for use by all services:
  - `protected async next(event: InternalEventV2): Promise<void>`
    - Advances the event to the next destination on the routing slip; if no next step, delivers to `egressDestination` (if present) per existing command-processor behavior.
  - `protected async complete(event: InternalEventV2): Promise<void>`
    - Bypasses the remaining routing slip and delivers the event directly to `egressDestination` (if present).

This document scopes the design only. No implementation is included.

## Current State (as-is)
- Routing slip semantics are used in the command-processor to manage multi-hop processing of an `InternalEventV2`.
- The shared event shape and constants live in `src/types/events.ts`:
  - `InternalEventV2` includes `routingSlip?: RoutingStep[]` and `egressDestination?: string`.
  - Topic constants like `INTERNAL_*` define well-known subjects.
- Message bus publishing and subscribing is abstracted by `src/services/message-bus/` with driver selection (`pubsub`, `nats`, or `noop`).
- `BaseServer` centralizes server setup, config, logging, tracing, and resource managers but does not expose routing slip helpers.

## Target State (to-be)
- `BaseServer` exposes two protected methods that service implementations can call from within their request or subscription handlers:
  - `next(event)` implements the standard “advance routing slip” behavior.
  - `complete(event)` shortcuts directly to the `egressDestination`.
- Publishing is performed via `createMessagePublisher(subject).publishJson(evt, attrs)` with consistent attributes:
  - `correlationId`, `type`, `traceparent`/`traceId`, and `source`.
- Tracing and logging are consistently applied at this layer.
- Command-processor (and any other service) stops re-implementing this logic and instead calls these helpers.

## Event and Routing Models
- `InternalEventV2` (see `src/types/events.ts`) embeds envelope fields and message/candidates, etc. Relevant fields for routing:
  - `routingSlip?: RoutingStep[]` — ordered list of steps.
  - `egressDestination?: string` — where final output should be sent (e.g., to ingress-egress bridge).
  - `correlationId: string` — cross-hop correlation.
  - `traceId?: string` — w3c trace id. We will prefer W3C traceparent propagation.
- `RoutingStep` (from `events.ts`) simplified view:
  - `to: string` (subject/topic), `status?: 'PENDING'|'OK'|'SKIP'|'ERROR'`, attempts, `nextTopic?`, `attributes?`, `error?`.
  - A step is considered “pending” if `status` is absent or not in `OK|SKIP`.

## Behavior Definitions

### next(event)
- Input: a mutable `InternalEventV2` instance.
- Algorithm (high-level):
  1. Find the first step in `event.routingSlip` with a status not in `OK|SKIP` (i.e., pending). If none found:
     - If `event.egressDestination` exists, publish the event to that subject. Done.
     - Otherwise, no-op (optionally log a warning) — nowhere to send.
  2. For the pending step:
     - Mark `startedAt` if unset; increment `attempts`.
     - Compute the target subject:
       - `subject = step.nextTopic || step.to` (support `nextTopic` override if a step rewrites target).
     - Emit tracing span `routing.next` with tags: serviceName, subject, correlationId, step index, attempts, status.
     - Publish `event` to `subject` with attributes derived from the envelope and step (see Attributes section).
     - Do not mark the step `OK` on the sender side; the consumer of the step is responsible for updating `status` to `OK`/`SKIP`/`ERROR` based on processing outcome, then calling `next()` as appropriate.

- Idempotency considerations:
  - Method-level idempotency: Repeated calls to `next(event)` with the same in-memory event instance MUST be no-ops. The helper will:
    - Detect a prior successful dispatch for `next()` using an in-memory marker (non-serializable) set on the event object (e.g., a `Symbol` or WeakMap entry).
    - If the marker is present, log at `debug` level and return without publishing.
    - Set the marker immediately before attempting publish; if publish fails (throws), the marker is cleared so a retry can proceed.
  - Transport-level semantics remain at-least-once; downstream consumers must still be idempotent.
  - The helper will not mutate semantic payload beyond timestamps/attempts on the selected step.

### complete(event)
- Input: a mutable `InternalEventV2` instance.
- Behavior:
  - Immediately publish the event to `event.egressDestination` if present.
  - If no `egressDestination`, log a warning; no-op.
  - Does not modify `routingSlip` statuses; this is an explicit bypass.

- Idempotency considerations:
  - Method-level idempotency: Repeated calls to `complete(event)` with the same in-memory event instance MUST be no-ops. The helper will:
    - Use a separate in-memory marker from `next()` to track `complete()` dispatch on the object.
    - If already marked as completed, log at `debug` and return without publishing.
    - Set the marker before publish; on publish error, clear the marker to allow retry.

## Attributes and Metadata
- When publishing, set attributes via the message bus abstraction (`AttributeMap`):
  - `correlationId`: `event.correlationId`
  - `type`: `event.type` (stringified enum if necessary)
  - `traceparent`: current active span context serialized; fallback to `event.traceId` if present
  - `source`: `this.serviceName` (from `BaseServer`)
  - Optional: propagate `replyTo` if set in the event
  - Optional: include step-local attributes `step.attributes` (merged, last-writer-wins with global keys)

## Tracing
- Use `BaseServer.getTracer()` and tracing helpers to wrap publish actions:
  - Span name: `routing.next` for `next()`; `routing.complete` for `complete()`.
  - Attributes: `subject`, `egressDestination`, `correlationId`, `stepIndex`, `attempts`, `serviceName`.
  - Ensure trace propagation by injecting `traceparent` into message attributes.

## Logging
- Level `info` for successful publish with context.
- Level `warn` when no `egressDestination` and we cannot deliver.
- Level `error` only for unexpected exceptions in helper code (publish throwing, etc.).
- Include `correlationId`, `subject`, `egressDestination`, and step index where applicable.

## Errors & Retries
- `next()` will surface publish errors by throwing; callers can decide whether to mark step `ERROR` and/or nack the message.
- `complete()` similarly throws on publish failure.
- Step-level retry policy remains the responsibility of the consumer service, not the helper. The helper merely forwards.

## Configuration
- No new mandatory config keys for the initial extraction.
- Optional tuning (future-compatible, not required for this sprint):
  - `ROUTING_MAX_ATTEMPTS_DEFAULT` to guide step default attempts (read by services that set/validate steps, not by the helper itself).
  - `ROUTING_DISABLE_EGRESS_FALLBACK=1` to force no egress fallback in `next()` when slip is exhausted. Default remains: fallback allowed.

## Access Modifiers and Usage
- Methods are `protected` on `BaseServer` so that service classes extending `BaseServer` can call them in their handlers.
- Example usage (pseudo-code):
  ```ts
  class CommandProcessorServer extends BaseServer {
    constructor() { super({ serviceName: 'command-processor' }); }
    async handle(evt: InternalEventV2) {
      // after processing current step and updating its status
      await this.next(evt);
    }
  }
  ```

## Pseudocode
- next(event):
  ```ts
  protected async next(event: InternalEventV2): Promise<void> {
    // Idempotency: event-local, non-serializable guard
    const NEXT_MARK = Symbol.for('bb.routing.next.dispatched');
    if ((event as any)[NEXT_MARK]) { this.getLogger().debug('routing.next.idempotent_noop', { correlationId: event.correlationId }); return; }
    (event as any)[NEXT_MARK] = true;
    const slip = event.routingSlip || [];
    const idx = slip.findIndex(s => s.status !== 'OK' && s.status !== 'SKIP');
    if (idx < 0) {
      const dest = event.egressDestination;
      if (!dest) { this.getLogger().warn('routing.next.no_target', { correlationId: event.correlationId }); return; }
      const pub = createMessagePublisher(dest);
      await startActiveSpan('routing.complete-fallback', async () => {
        await pub.publishJson(event, buildAttrs(event));
      });
      this.getLogger().info('routing.next.fallback_egress', { dest, correlationId: event.correlationId });
      return;
    }
    const step = slip[idx];
    step.startedAt = step.startedAt || new Date().toISOString();
    step.attempts = (step.attempts || 0) + 1;
    const subject = step.nextTopic || step.to;
    const pub = createMessagePublisher(subject);
    try {
      await startActiveSpan('routing.next', async () => {
        await pub.publishJson(event, buildAttrs(event, step));
      });
    } catch (e) {
      // Clear idempotency mark on failure to allow caller retry
      delete (event as any)[NEXT_MARK];
      throw e;
    }
    this.getLogger().info('routing.next.published', { subject, stepIndex: idx, attempts: step.attempts, correlationId: event.correlationId });
  }
  ```

- complete(event):
  ```ts
  protected async complete(event: InternalEventV2): Promise<void> {
    // Idempotency: event-local, non-serializable guard
    const COMPLETE_MARK = Symbol.for('bb.routing.complete.dispatched');
    if ((event as any)[COMPLETE_MARK]) { this.getLogger().debug('routing.complete.idempotent_noop', { correlationId: event.correlationId }); return; }
    (event as any)[COMPLETE_MARK] = true;
    const dest = event.egressDestination;
    if (!dest) { this.getLogger().warn('routing.complete.no_egress', { correlationId: event.correlationId }); return; }
    const pub = createMessagePublisher(dest);
    try {
      await startActiveSpan('routing.complete', async () => {
        await pub.publishJson(event, buildAttrs(event));
      });
    } catch (e) {
      // Clear idempotency mark on failure to allow caller retry
      delete (event as any)[COMPLETE_MARK];
      throw e;
    }
    this.getLogger().info('routing.complete.published', { dest, correlationId: event.correlationId });
  }
  ```

- `buildAttrs(event, step?)` merges envelope attributes and step.attributes:
  ```ts
  function buildAttrs(event: InternalEventV2, step?: RoutingStep): AttributeMap {
    const base: AttributeMap = {
      correlationId: event.correlationId,
      type: String(event.type),
      source: this.serviceName,
      traceparent: currentTraceparent()
    };
    if (event.replyTo) base.replyTo = event.replyTo;
    const extra = (step?.attributes || {});
    return { ...extra, ...base };
  }
  ```

## Backward Compatibility
- No changes to `InternalEventV2` are required for this extraction.
- Existing services can adopt the helpers incrementally. Command-processor becomes the first adopter.

## Security & Validation
- Validate subject strings are internal (`internal.*`) before publishing.
- Avoid leaking PII in logs; rely on correlationId instead of raw payload in log context.
- Preserve `correlationId` end-to-end. Do not generate new ids in the helper.

## Testing Strategy
- Unit tests for `BaseServer` protected helpers via a thin test subclass that exposes wrappers:
  - `next()` publishes to the first pending step’s subject.
  - If no pending steps: publishes to `egressDestination`.
  - `complete()` publishes to `egressDestination`.
  - Repeated calls to `next(event)` or `complete(event)` with the same event instance do not publish again (idempotent no-ops); verify markers are set and cleared on failure.
  - All methods include required attributes and tracing hooks (assert attribute injection via spy).
- Use message-bus `noop` driver in tests; spy on `publishJson` calls.
- Negative tests: missing `egressDestination` warns without throwing; publish failure surfaces error.

## Acceptance Criteria
- Technical architecture reviewed and approved.
- `BaseServer` design surfaces `protected next(event)` and `protected complete(event)` helpers with defined semantics.
- Clear guidance for attributes, tracing, logging, and error behavior.
- Backward compatible with existing `InternalEventV2` and message-bus abstraction.

## Risks & Mitigations
- Risk: Ambiguity around who updates `RoutingStep.status` and when.
  - Mitigation: Consumer of a step updates status to `OK/SKIP/ERROR`; helpers do not set success statuses.
- Risk: Duplicate deliveries due to at-least-once semantics.
  - Mitigation: Consumers must be idempotent; document as requirement.
- Risk: Missing `egressDestination` leading to sinks.
  - Mitigation: Warn and no-op; encourage router/ingress to set egress destination.

## Migration Plan (Incremental)
1. Approve this design.
2. Implement helpers in `BaseServer` (no behavior change to services yet).
3. Migrate command-processor to call `this.next(evt)` and `this.complete(evt)`.
4. Rollout to other services (router, auth, bot) as needed.

## Traceability
- Sprint: `sprint-119-a8827e`
- Related files:
  - `src/common/base-server.ts`
  - `src/services/message-bus/*`
  - `src/types/events.ts`
