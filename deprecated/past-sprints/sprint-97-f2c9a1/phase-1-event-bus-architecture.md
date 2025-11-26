DarBitBrat Event Bus - Phase 1 Architecture (Driver-Agnostic)

Author: Architect (Junie)
Date: 2025-11-20 14:49
Sprint: 97 (sprint-97-f2c9a1)
Status: Draft for approval
Prompt-ID: phase1-event-bus-arch-2025-11-20

llm_prompt: Define a minimal, driver-agnostic Event Bus abstraction aligned with architecture.yaml and the messaging reference docs. No driver code in this phase; specify contracts, topics, envelope/attributes, env selection, and compliance checklist. Prefer architecture.yaml as canonical.

1) Purpose & Scope

Phase 1 delivers documentation that specifies a simple Event Bus abstraction BitBrat services can depend on to publish and subscribe to internal events. It is transport-agnostic and maps to both GCP Pub/Sub (Cloud) and NATS JetStream (Local/Docker). No runtime code changes or drivers are included in this phase.

2) Message Bus Interfaces (Contracts)

Source for concrete code will be src/services/message-bus in a future sprint. Services should target these shapes:

- Publisher
  - Method: publishJson(data: unknown, attributes?: Record<string, string>): Promise<string | null>
  - Semantics: Publishes a JSON-serializable payload to a pre-bound subject or topic. Returns a message ID or null depending on driver.

- Subscriber
  - Method: subscribe(subject: string, handler: (data: unknown, attributes: Record<string, string>) => Promise<void>, options?: SubscriberOptions): Promise<() => Promise<void>>
  - Semantics: Subscribes to a subject or topic and invokes handler per message. Returns an async unsubscribe function. Handlers must be idempotent.

- AttributeMap
  - String-keyed map for cross-transport headers used for correlation, tracing, and type hints.

Drivers must normalize attribute keys to lowerCamelCase strings and provide consistent behavior across transports.

3) Driver Selection (Environment)

- MESSAGE_BUS_DRIVER or MESSAGE_BUS: "pubsub" or "nats" (default: "pubsub" in Cloud)
- BUS_PREFIX: optional subject prefix for local isolation (for example: "dev.")
- NATS_URL: required when MESSAGE_BUS_DRIVER=nats (for example: nats://nats:4222)

Driver selection occurs at runtime via a factory in src/services/message-bus (future). Callers depend only on the interfaces above.

4) Topics / Subjects (Initial Set)

Aligned with architecture.yaml:
- internal.ingress.v1 - produced by Ingress/Egress service after normalizing external events
- internal.finalize.v1 - consumed by Finalizer service to finalize/log outcomes
- internal.llmbot.v1 - produced by Event Router; consumed by LLM Bot

Forward-looking subjects (reference only for Phase 1):
- internal.routes.v1 - audit of routing decisions
- internal.bot.requests.v1 - Router to LLM Bot requests
- internal.bot.responses.v1 - LLM Bot to Router responses
- internal.egress.v1 - final messages destined to external sinks
- internal.deadletter.v1 - terminal failures with diagnostic context

Naming policy: dotted, versioned names; keep names identical across transports. Apply BUS_PREFIX consistently for local NATS subjects only.

5) Envelope v1 (Transport Metadata)

All internal events must include an envelope with:
- v: constant "1"
- source: producing component (for example: "ingress.twitch", "router", "llm-bot")
- correlationId: required string for correlating work across services
- traceId: optional string for distributed tracing
- replyTo: optional subject for direct response routing
- timeoutAt: optional ISO timestamp bounding end-to-end processing
- routingSlip: optional array of steps for decentralized orchestration

Event container fields:
- type: versioned event type (for example: chat.message.v1, llm.request.v1, llm.response.v1)
- payload: object with event-specific data

Schemas to validate in future sprints: documentation/schemas/envelope.v1.json and documentation/schemas/routing-slip.v1.json

6) Transport Attributes (Cross-Transport)

Always include on publish:
- correlationId
- type
- traceparent (or traceId when traceparent is unavailable)

Recommended with routing slip:
- stepId

Drivers must map attributes 1:1 between Pub/Sub attributes and NATS headers.

7) Operational Expectations (Phase 1)

Idempotency
- Delivery is at-least-once; consumers must be idempotent.
- Recommended dedupe key for slip-aware workers: sha256(correlationId + ":" + step.id + ":" + (attempt || 0)).

Retries and backoff
- Retryable failures should use exponential backoff: delay = baseDelayMs * 2^attempt +/- jitter.
- Defaults: maxAttempts about 3, baseDelayMs about 500.

Dead-letter (DLQ)
- Terminal errors (non-retryable or attempts exceeded) should publish to internal.deadletter.v1 with envelope, lastStep, error, and minimal payload context.

Timeouts
- If envelope.timeoutAt is present, workers and routers should abort remaining steps and DLQ as appropriate when time is exceeded.

8) Minimal Compliance Checklist (Phase 1)

- [ ] Uses versioned subjects consistent with architecture.yaml
- [ ] Publishes attributes: correlationId, type, traceparent
- [ ] Includes envelope v1 fields on all internal messages
- [ ] Treats consumers as idempotent and documents dedupe strategy
- [ ] Defines driver selection via MESSAGE_BUS_DRIVER or MESSAGE_BUS and optional BUS_PREFIX
- [ ] Documents initial topics used by the service and their roles

9) Alignment with architecture.yaml

This document aligns with declared services and topics:
- ingress-egress publishes internal.ingress.v1
- finalizer consumes internal.finalize.v1
- event-router publishes internal.llmbot.v1; llm-bot consumes internal.llmbot.v1

10) Next Steps (Future Sprints)

- Implement src/services/message-bus with factory and drivers (Pub/Sub and NATS JetStream)
- Introduce topic constants and types under src/types/events.ts
- Add schema validation, idempotency helpers, and retry/backoff utilities
- Provide Jest tests and Cloud Build integration
