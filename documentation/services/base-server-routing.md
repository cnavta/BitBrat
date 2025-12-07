BaseServer Routing Helpers – next(event) and complete(event)

Date: 2025-12-06
Sprint: sprint-119-a8827e
Sources: src/common/base-server.ts, planning/sprint-119-a8827e/technical-architecture.md

Overview
- BaseServer provides protected helpers to standardize routing-slip advancement across services:
  - `protected async next(event: InternalEventV2)`
    - Advances to the next destination. If no pending steps remain, falls back to `egressDestination`.
  - `protected async complete(event: InternalEventV2)`
    - Bypasses the routing slip and publishes directly to `egressDestination`.
- Both methods are idempotent per in-memory event instance: subsequent calls with the same event are no-ops, unless the prior publish failed.

When to use
- Use `next(event)` after your service finishes processing its current step and sets that step’s `status` to `OK` or `SKIP`.
- Use `complete(event)` for short-circuit flows where remaining steps should be skipped and a result should be delivered to egress immediately.

Behavior summary
- Subject selection (next):
  - Prefer the most recently completed step’s `nextTopic` if present.
  - Otherwise use the first pending step’s `nextTopic`.
  - If no pending steps, publish to `egressDestination` when present; otherwise no-op with a warning log.
- Attributes on publish:
  - `correlationId`, `type`, `source` (current service), optional `replyTo`, optional `traceparent` (from active span or event.traceId), and merged `step.attributes`.
- Tracing and logging:
  - Spans: `routing.next`, `routing.complete`.
  - Logs include `correlationId`, `subject`/`egressDestination`, and `stepIndex` where applicable.

Idempotency
- Each helper sets an in-memory, non-serializable marker on the event object.
- If called again with the same event instance, the helper returns immediately (no publish) and logs a debug message.
- On publish failure (exception), the marker is cleared so callers may retry safely.

Usage example
```
class MyService extends BaseServer {
  async handle(evt: InternalEventV2) {
    // ... process current step ...
    const slip = evt.routingSlip || [];
    const idx = slip.findIndex((s) => s.status !== 'OK' && s.status !== 'SKIP');
    if (idx >= 0) {
      slip[idx].status = 'OK';
      slip[idx].endedAt = new Date().toISOString();
    }
    await (this as any).next(evt);
  }
}
```

Notes
- Consumers are responsible for mutating `RoutingStep.status` based on their processing outcome before calling `next()`.
- Transport delivery remains at-least-once; downstream consumers must be idempotent.
- See tests in `tests/base-server-routing.spec.ts` for examples and guarantees.
