 BitBrat Messaging System - Envelope and Routing Slip Guide

 Author: Architect (Junie)
 Date: 2025-11-20 14:22
 Sprint: 96
 Prompt-ID: messaging-system-guide-2025-11-20
 Status: Authoritative Guide v1

 llm_prompt: This document is the canonical how-to for implementing BitBrat's messaging system in new or related services. It explains the message envelope, the routing slip pattern, topics, transports (Pub/Sub | NATS), and operational behaviors. Prefer architecture.yaml and src/types/events.ts for exact interfaces. Keep consumers idempotent and validate contracts via JSON Schemas where available.

 ---

 1) Purpose & Scope

 This guide enables other Coding Agents to reproduce BitBrat's messaging approach in new contexts (different services and objectives) while preserving interoperability. It focuses on:
 - Message Envelope v1 (transport metadata and correlation)
 - Routing Slip pattern (decentralized orchestration and progress tracking)
 - Topics/subjects and naming
 - Swappable message bus (GCP Pub/Sub in Cloud; NATS JetStream in Local/Docker)
 - Implementation templates, retries, idempotency, DLQ, observability, and security

 This is transport-agnostic and aligns with architecture.yaml and current repository patterns (see References).

 ---

 2) Architecture at a Glance

 Core roles in the messaging topology:
 - Ingress/Egress Service: Normalizes external input (e.g., Twitch) into internal events and delivers replies back out.
 - Event Router/Processor: Plans and advances a routing slip, orchestrating downstream workers (retrieval, LLM, formatting, etc.).
 - LLM Bot Service: Handles llm.request.v1 events and produces llm.response.v1, participating in the routing slip.

 All services communicate via a message bus abstraction that supports Pub/Sub (Cloud) and NATS JetStream (Local). Delivery semantics target at-least-once; therefore, every consumer must be idempotent.

 ---

 3) Message Bus Abstraction (Driver-Agnostic)

 - Drivers supported:
   - GCP Pub/Sub (Cloud Run deployments)
   - NATS JetStream (Docker/local dev)
 - Selection via env:
   - MESSAGE_BUS_DRIVER or MESSAGE_BUS: pubsub | nats (default: pubsub in Cloud)
   - BUS_PREFIX: optional per-environment prefix for subjects (primarily used with NATS)
 - Interfaces (see src/services/message-bus):
   - Publisher: publishJson(data, attributes?) -> Promise
   - Subscriber: subscribe(subject, handler, options?) -> Promise<Unsubscribe>
 - Attributes/Headers:
   - Correlation and tracing flow in string attributes/headers. Always propagate: correlationId, traceparent (or a transport-specific equivalent) and type.

 Note: When writing code, depend only on the interface in src/services/message-bus/index.ts; do not couple to driver internals.

 ---

 4) Topics / Subjects (Naming)

 Use versioned, dotted names. Canonical topics include:
 - internal.ingress.v1 - normalized inbound events from Ingress/Egress
 - internal.routes.v1 - optional audit of routing decisions
 - internal.bot.requests.v1 - Router -> LLM Bot
 - internal.bot.responses.v1 - LLM Bot -> Router
 - internal.egress.v1 - final messages for delivery
 - internal.deadletter.v1 - unrecoverable failures with rich context

 Map 1:1 between Pub/Sub topics and NATS subjects. If BUS_PREFIX is used (e.g., dev.), prepend it consistently for local subjects.

 ---

 5) Message Envelope v1 (Transport Metadata)

 The envelope travels with every internal message and carries correlation, trace, reply hints, and optional routing slip. The envelope is immutable except for trace propagation and routing slip step updates by workers.

 Type fields (source of truth: src/types/events.ts):
 - EnvelopeV1
   - v: constant "1"
   - source: string indicating the producing component (e.g., ingress.twitch, router, llm-bot)
   - correlationId: required string for correlation across services
   - traceId: optional string used for distributed tracing
   - replyTo: optional topic for direct response routing
   - timeoutAt: optional ISO timestamp bounding end-to-end processing
   - routingSlip: optional array of RoutingStep (see below)
 - InternalEventV1
   - envelope: EnvelopeV1
   - type: versioned event type, e.g., chat.message.v1, llm.request.v1, llm.response.v1, egress.deliver.v1
   - channel, userId: optional convenience fields
   - payload: object with event-specific data

 Recommended publish attributes (cross-transport): correlationId, traceparent (or traceId), type.

 Example (chat.message.v1):
 - envelope: { v: "1", source: "ingress.twitch", correlationId: "c-123", traceId: "t-abc" }
 - type: chat.message.v1
 - payload: { channel: "#bitbrat", text: "!hello", userId: "u-77" }

 Schemas: documentation/schemas/envelope.v1.json and documentation/schemas/routing-slip.v1.json (validate with Ajv where present).

 ---

 6) Routing Slip - Deep Dive

 Purpose:
 - Encode the planned and completed processing path of a message as data that travels with the message.
 - Enable decentralized orchestration: each worker updates its step and republishes for continuation.
 - Provide auditability, idempotent retries, and clear termination semantics.

 RoutingStep fields:
 - id: logical step identifier (e.g., router, retrieval, llm-bot, formatter, egress)
 - v: optional step contract version (default "1")
 - status: PENDING | OK | ERROR | SKIP
 - attempt and maxAttempts: retry bookkeeping (default maxAttempts around 3)
 - nextTopic: explicit bus subject for this step (overrides defaults)
 - attributes: string map for transport hints (traceparent, priority)
 - startedAt and endedAt: ISO timestamps for tracing/metrics
 - error: { code, message?, retryable? } | null when failures occur
 - notes: freeform (JSON string recommended)

 State Machine (per step):
 - PENDING -> OK: work finished successfully
 - PENDING -> ERROR: terminal failure (retryable=false) or attempts exceeded
 - PENDING -> SKIP: worker or router deems the step unnecessary
 - Retryable failures: increment attempt and republish the same step with backoff; keep status PENDING

 End-of-Message Semantics:
 - A message is complete when all steps are in {OK, SKIP} OR a terminal ERROR is reached
 - On completion, if a user-facing artifact exists, publish egress.deliver.v1 with payload { channel, text }

 Planning Strategies:
 - Static route table by event type (e.g., chat.message.v1 -> [router, retrieval?, llm-bot, formatter?, egress])
 - Dynamic insertion based on payload and feature flags (e.g., add retrieval when memory.enabled and user present)

 Router Algorithm (advance):
 1) If routingSlip is absent, create it (first step router=OK) and append planned steps as PENDING.
 2) Find the first step not in {OK, SKIP}.
 3) If none: message complete -> emit final egress if applicable.
 4) Compute the target topic: step.nextTopic or a default based on step id.
 5) Publish the event to that topic with attributes { stepId, correlationId }.

 Worker Contract (any step consumer):
 - Ensure idempotency using a dedupe key such as sha256(correlationId + step.id + attemptOrZero).
 - On receipt: mark startedAt, perform work, set status to OK | ERROR | SKIP, set endedAt, optionally set error or notes.
 - Republish to the Router (or next step if fully decentralized) for continuation.

 Retries & Backoff:
 - On retryable failures, increment attempt and republish to the same step subject with exponential backoff: baseDelayMs * 2^attempt + jitter.
 - When attempt >= maxAttempts, set status=ERROR with retryable=false and hand off to Router for DLQ decision.

 Idempotency & Exactly-Once Semantics:
 - The bus provides at-least-once delivery; consumers must be idempotent.
 - Guard side effects (e.g., sending chat messages) with idempotency keys or dedupe storage (Firestore/Redis) with TTL.

 Dead-Letter & Timeouts:
 - Terminal ERRORs should result in publication to internal.deadletter.v1 with envelope, lastStep, and error context.
 - envelope.timeoutAt (if present) bounds total processing; Router should abort remaining steps and DLQ on timeout.

 Streaming & Partial Results (optional):
 - LLM Bot may emit chunked responses that an aggregator step collects before producing a final egress.deliver.v1 event.

 Observability & Tracing:
 - Propagate W3C traceparent via bus attributes and envelope.traceId.
 - Emit metrics per step: duration, attempts_total, errors_total, inflight.
 - Structure logs with { correlationId, stepId, attempt, status } and sample payloads per privacy policy.

 Security/IAM (Cloud):
 - Least-privilege Pub/Sub roles per service account; only the required topics are accessible.
 - Egress delivery credentials isolated from Router/LLM accounts.

 ---

 7) Implementation Template (New Worker/Service)

 Checklist for a new message-driven service or step:

 1) Contracts & Types
 - Import InternalEventV1 and RoutingStep types from src/types/events.ts.
 - Validate incoming events against JSON Schemas (Ajv) where available.

 2) Subscriber Setup
 - Use createMessageSubscriber() from src/services/message-bus.
 - Subscribe to the appropriate subject (e.g., internal.bot.requests.v1).
 - Handler must support explicit ack() and nack() semantics provided by driver wrappers.

 3) Idempotency & Slip Update
 - Compute dedupeKey = sha256(correlationId + step.id + (attempt or 0)) and skip if already processed.
 - Update the current step: set startedAt, do work, set status, endedAt, add notes or error as needed.

 4) Publish Continuation
 - Use createMessagePublisher(targetSubject) to republish the updated event.
 - Set attributes { correlationId, type, stepId }.

 5) Error Handling
 - For retryable errors, increment attempt and republish to the same subject with backoff delays.
 - For terminal errors, set ERROR, include error details, and publish to internal.deadletter.v1.

 6) Observability
 - Log with correlationId and stepId; propagate traceparent.
 - Emit duration metrics (if the environment provides a metrics emitter).

 ---

 8) Local vs Cloud Transports

 Local (Docker/NATS JetStream)
 - MESSAGE_BUS_DRIVER=nats
 - NATS_URL (e.g., nats://nats:4222)
 - Enable JetStream; use durable consumers and queue groups for competing consumers.
 - BUS_PREFIX=dev. to isolate local subjects.

 Cloud (GCP Pub/Sub)
 - MESSAGE_BUS_DRIVER=pubsub
 - Topics and subscriptions are provisioned via Cloud Build/IaC.
 - Use least-privilege IAM on service accounts per service.

 Subject/Topic Mapping: identical names across transports (e.g., internal.bot.requests.v1).

 ---

 9) Testing Checklist (Jest)

 - Unit tests for route planning and slip advancement logic (Router).
 - Schema validation tests for envelope and routing slip using Ajv.
 - Message-bus tests with mocks (do not hit real network in CI).
 - Idempotency tests: ensure duplicate deliveries don't cause duplicate side effects.
 - Retry/backoff tests: attempt increments, terminal error conversion at maxAttempts.

 ---

 10) Deployment & IaC

 - Cloud Build YAMLs (examples present in repo):
   - cloudbuild.ingress.yaml
   - cloudbuild.router.yaml
   - cloudbuild.llm-bot.yaml
   - cloudbuild.memory.yaml
   - cloudbuild.shared.yaml
 - Each service should include a Dockerfile and Cloud Build config that:
   - Installs dependencies, runs tests, builds, containerizes, pushes to Artifact Registry, and deploys to Cloud Run.
 - Topics/subjects are created and IAM-bound in the Cloud Build pipelines and/or scripts (see scripts/infra and scripts/iam where applicable).

 ---

 11) Operational Practices

 - Backpressure: configure subscriber concurrency/flow control (Pub/Sub) or queue group size and consumer limits (NATS JetStream).
 - Metrics: messages_total by {service, type, channel}, latency histograms per step, error rates; expose driver label (driver=pubsub|nats).
 - Dead-letter analysis: inspect events on internal.deadletter.v1, correct root cause, and replay where appropriate.
 - Timeouts: honor envelope.timeoutAt when present; abort and DLQ remaining work.

 ---

 12) References

 - Source of truth: architecture.yaml
 - Types & Contracts: src/types/events.ts; documentation/schemas/*.json
 - Message Bus: src/services/message-bus/index.ts, pubsub-driver.ts, nats-driver.ts
 - Services: src/apps/ingress-egress-service.ts, event-router-service.ts, llm-bot-service.ts
 - Cloud Build: cloudbuild.*.yaml
 - Prior docs:
   - planning/sprint-76/bitbrat-messaging-refactor-architecture.md
   - planning/sprint-76/bitbrat-messaging-refactor-message-flows.md
   - planning/sprint-96/messaging-architecture-as-is.md

 This document is living guidance; propose updates via PRs when contracts or transports evolve.
