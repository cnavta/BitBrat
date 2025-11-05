
## Routing Slip Implementation

Purpose
- Encode the end-to-end processing path of a message as data that travels with the message.
- Enable decentralized orchestration: each service performs its step, updates the slip, and republishes.
- Provide auditability, replay, idempotent retries, and clear termination semantics.

Core Concepts
- Envelope: Transport metadata that is immutable except for fields like trace propagation; contains routingSlip array.
- RoutingStep: One planned or completed hop in the pipeline.
- Next-hop resolution: Each step knows where it should be processed (topic or HTTP target). Router can also materialize steps dynamically.

Data Model (additions to the sketch in this doc)
```
interface RoutingStep {
    id: string;                 // logical step id: e.g., "router", "retrieval", "llm-bot", "formatter", "egress"
    v?: string;                 // optional version of the step contract, default "1"
    status: 'PENDING' | 'OK' | 'ERROR' | 'SKIP';
    attempt?: number;           // 0-based attempt counter
    maxAttempts?: number;       // default 3
    nextTopic?: string;         // Pub/Sub topic to send event for this step
    attributes?: Record<string, string>; // transport hints (e.g., traceparent, priority)
    startedAt?: string;         // ISO timestamp when work began
    endedAt?: string;           // ISO timestamp when work ended
    error?: { code: string; message?: string; retryable?: boolean } | null;
    notes?: string;             // freeform (JSON string recommended)
}

interface Envelope {
    v: '1';
    source: string;
    correlationId: string;
    traceId?: string;
    replyTo?: string;           // topic for direct reply (overrides defaults)
    timeoutAt?: string;         // optional absolute timeout for entire message
    routingSlip: RoutingStep[]; // at least one step is required post-routing
}
```

State Machine (per step)
- PENDING → OK: Work finished successfully.
- PENDING → ERROR: Terminal error (retryable=false) or attempts exceeded.
- PENDING → SKIP: Router or worker determines step is unnecessary.
- ERROR with retryable=true and attempt < maxAttempts: Worker republishes with attempt+1 and status remains PENDING.

End-of-Message Semantics
- A message is considered complete when all steps are in {OK, SKIP} OR a terminal ERROR step is encountered.
- If complete and a final user-visible artifact exists (e.g., a chat reply), the Router (or the responsible step) emits egress.deliver.v1.

How Steps Are Planned
- Static route table for common types.
- Optional dynamic planning: Router can inspect payload and insert steps (e.g., add retrieval only when memory.enabled && user present).

Example Route Table (conceptual)
- chat.message.v1 → [router, intent-detection?, retrieval?, llm-bot, formatter?, egress]
- chat.command.v1 → [router, guardrails, llm-bot?, formatter?, egress]
- system.timer.v1 → [router, job-enqueue]

Router Algorithm (advance the slip)
1) If routingSlip is absent, create it from route table: first step is router (OK once planned), then append the required steps with status PENDING.
2) Find the first step with status not in {OK, SKIP}.
3) If none, message is complete; if a reply exists, publish egress.deliver.v1; else drop/ack.
4) Publish the event to step.nextTopic (or default for that step), including envelope and slip.

Pseudo-code
```
function advance(event) {
const slip = ensureSlip(event);
const i = slip.findIndex(s => s.status !== 'OK' && s.status !== 'SKIP');
if (i < 0) return complete(event);
const step = slip[i];
step.startedAt = new Date().toISOString();
step.attempt = step.attempt ?? 0;
step.maxAttempts = step.maxAttempts ?? 3;
const topic = step.nextTopic || defaultTopicFor(step.id);
publish(topic, event, { attributes: { stepId: step.id, correlationId: event.envelope.correlationId } });
}
```

Worker Contract (for any step consumer)
- Receive event with envelope.routingSlip.
- Ensure idempotency: compute dedupeKey = sha256(correlationId + step.id + (step.attempt||0)). Drop if processed.
- Do work; set step.status to OK | ERROR | SKIP; set endedAt; optionally set notes/error; then republish to the Router’s topic for continuation, or directly to next step if fully decentralized.

Retries & Backoff
- On retryable failure, increment attempt and republish to the same step topic with exponential backoff: baseDelayMs * 2^attempt + jitter.
- If attempt ≥ maxAttempts: set status=ERROR; include error.retryable=false; republish for Router to decide DLQ or partial completion.

Idempotency & Exactly-Once Semantics
- Pub/Sub is at-least-once; consumers must be idempotent.
- Use dedupe store (Redis/Firestore) keyed by dedupeKey with TTL.
- Side effects (e.g., sending a chat message) must be guarded by idempotency keys to prevent duplicates.

Dead-Letter & Timeouts
- If a step reaches terminal ERROR, Router publishes to internal.deadletter.v1 with context: lastStep, error, envelope.
- If envelope.timeoutAt < now, Router aborts remaining steps, marks them SKIP, and emits a timeout DLQ entry.

Streaming & Partial Results (optional)
- LLM Bot may emit llm.chunk.v1 with payload.chunkIndex and totalChunks. Slip may include a temporary step "aggregator" that collects chunks and then marks OK when final chunk arrives, creating a single egress message.

Observability & Tracing
- Propagate W3C traceparent in Pub/Sub attributes and envelope.traceId.
- Metrics to emit per step: step_duration_ms, step_attempts_total, step_errors_total, messages_inflight.
- Logs include correlationId, stepId, attempt, status transitions; sample payloads per privacy policy.

Security/IAM
- Each step’s nextTopic must be authorized to the worker service account only. Router’s account can publish to planning topics but not to egress delivery credentials.

Testing Strategy
- Unit tests: route planning, advance logic, retry thresholds, timeout behavior.
- Contract tests: JSON schema validation for envelope and slip.
- Integration tests: happy path chat.message.v1 through llm-bot to egress, with mocked providers.

Concrete Example (end-to-end)
Ingress creates event:
```
{
"envelope": { "v": "1", "source": "ingress.twitch", "correlationId": "c-123", "traceId": "t-abc" },
"type": "chat.message.v1",
"payload": { "channel": "#bitbrat", "text": "!hello", "userId": "u-77" }
}
```

Router plans slip and advances to retrieval (if enabled):
```
"routingSlip": [
{ "id": "router", "status": "OK", "startedAt": "...", "endedAt": "..." },
{ "id": "retrieval", "status": "PENDING", "nextTopic": "internal.retrieval.v1" },
{ "id": "llm-bot", "status": "PENDING", "nextTopic": "internal.bot.requests.v1" },
{ "id": "formatter", "status": "PENDING", "nextTopic": "internal.formatter.v1" },
{ "id": "egress", "status": "PENDING", "nextTopic": "internal.egress.v1" }
]
```

JSON Schema Sketch (abridged)
```
{
"$id": "https://bitbrat.dev/schemas/envelope.v1.json",
"type": "object",
"required": ["v", "source", "correlationId", "routingSlip"],
"properties": {
"v": { "const": "1" },
"source": { "type": "string" },
"correlationId": { "type": "string" },
"traceId": { "type": "string" },
"replyTo": { "type": "string" },
"timeoutAt": { "type": "string", "format": "date-time" },
"routingSlip": {
"type": "array",
"items": {
"type": "object",
"required": ["id", "status"],
"properties": {
"id": { "type": "string" },
"v": { "type": "string" },
"status": { "enum": ["PENDING", "OK", "ERROR", "SKIP"] },
"attempt": { "type": "integer", "minimum": 0 },
"maxAttempts": { "type": "integer", "minimum": 1 },
"nextTopic": { "type": "string" },
"attributes": { "type": "object", "additionalProperties": { "type": "string" } },
"startedAt": { "type": "string", "format": "date-time" },
"endedAt": { "type": "string", "format": "date-time" },
"error": {
"type": ["object", "null"],
"properties": {
"code": { "type": "string" },
"message": { "type": "string" },
"retryable": { "type": "boolean" }
},
"required": ["code"]
},
"notes": { "type": "string" }
}
}
}
}
}
```

---

## Swappable Messaging Layer (Pub/Sub <-> NATS)

Goal
- Enable running the BitBrat Platform locally via Docker Compose using NATS while keeping Cloud deployments on GCP Pub/Sub, without changing application logic.
- Standardize on a message-bus abstraction (Publisher/Subscriber) selectable by configuration.

Abstraction & Drivers
- Interface: MessagePublisher, MessageSubscriber in src/services/message-bus (driver-agnostic).
- Driver selection via env: MESSAGE_BUS_DRIVER=pubsub|nats. Default: pubsub in Cloud Run, nats for local compose.
- Drivers:
    - Pub/Sub: uses @google-cloud/pubsub with batching enabled.
    - NATS: uses nats client with JetStream for at-least-once delivery (recommended).

Configuration
- Common:
    - MESSAGE_BUS_DRIVER: pubsub | nats
    - BUS_PREFIX: optional subject/topic prefix for environment (e.g., dev., stage.)
- Pub/Sub:
    - Uses Application Default Credentials; topics created via IaC/Cloud Build.
- NATS:
    - NATS_URL: nats://nats:4222 (compose default) or any valid URL
    - NATS_CREDS_PATH or NATS_NKEY_SEED: optional credentials
    - NATS_JETSTREAM=true to enable persistence and at-least-once semantics

Naming & Mapping
- Keep event names identical across providers; map Pub/Sub topics to NATS subjects 1:1, preserving dots:
    - internal.ingress.v1 → internal.ingress.v1
    - internal.bot.requests.v1 → internal.bot.requests.v1
- Competing consumers:
    - Pub/Sub: multiple subscribers on the same subscription
    - NATS: use queue groups (e.g., queue="router") so one consumer in the group processes each message

QoS & Semantics
- Target semantic: at-least-once delivery across both providers.
- Pub/Sub: at-least-once by default; require idempotent consumers.
- NATS:
    - Core NATS is at-most-once; for parity, enable JetStream
    - Use durable consumers with ack policy=explicit and backoff
    - Configure maxDeliver and DLQ (e.g., subjects ending .DLQ) for terminal failures

Attributes/Headers & Tracing
- Normalize attributes to a string map on publish.
- Pub/Sub attributes ↔ NATS headers mapping is 1:1.
- Always publish traceparent and correlationId attributes; services propagate envelope.traceId and transport attributes.

Local Development (Docker Compose)
- Add a NATS service in compose with JetStream:
    - image: nats:2
    - command: ["-js", "-sd", "/data", "-m", "8222"]
    - ports: 4222, 8222
- Run services with MESSAGE_BUS_DRIVER=nats; use BUS_PREFIX=dev. to isolate local subjects.
- Optional: add a lightweight “tap” service to subscribe to internal.* for debugging.

Cloud Mode (Cloud Run + Pub/Sub)
- Keep existing topics and subscriptions managed by Cloud Build.
- Services run with MESSAGE_BUS_DRIVER=pubsub; BUS_PREFIX may reflect project/environment if desired.

Testing Strategy
- Unit tests mock src/services/message-bus to avoid provider dependencies.
- Integration tests can spin up ephemeral NATS (Docker) and run against the nats driver to validate end-to-end flows and idempotency.
- Contract tests validate schema consistency independent of the transport.

Operational Considerations
- Backpressure:
    - Pub/Sub: configure max outstanding and flow control on subscribers
    - NATS: use JetStream consumer limits and queue group size to apply backpressure
- Monitoring:
    - Expose driver label in metrics (driver="pubsub"|"nats"); break down messages_total, publish_latency_ms, consumer_lag
- Security:
    - Cloud: least-privileged Pub/Sub roles per service account
    - Local: secure NATS with creds/NKey for shared dev environments; restrict accounts and enable authorization rules


---
