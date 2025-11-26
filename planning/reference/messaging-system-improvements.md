BitBrat Messaging System — Standardization and Improvement Proposals

Author: Architect (Junie)
Date: 2025-11-20 14:30
Sprint: 96
Prompt-ID: messaging-system-improvements-2025-11-20
Status: Proposal v1 (Companion to messaging-system.md)

llm_prompt: This companion document proposes concrete standards and incremental improvements to BitBrat’s messaging system. It builds on the authoritative guide in ./planning/messaging-system.md and must align with architecture.yaml. Treat all MUST/SHOULD/COULD items as guidance for Coding Agents and CI policy authors. Prefer the interfaces and schemas in src/types/events.ts and documentation/schemas/*.json where applicable.

---

Executive Summary

This proposal codifies consistent conventions across topics/subjects, the v1 message envelope, routing-slip usage, retries/backoff, idempotency, observability, and security. It also defines a minimal compliance checklist for services and a phased migration plan to adopt these standards without breaking existing deployments. The goal is to reduce drift across services, ease onboarding, and create testable, enforceable norms that are transport-agnostic (Pub/Sub | NATS JetStream).

References
- Canonical “how-to”: ./planning/messaging-system.md
- Architecture intent: ./architecture.yaml (source of truth)
- Types & contracts: ./src/types/events.ts
- Message bus: ./src/services/message-bus/*
- Schemas: ./documentation/schemas/*.json
- Cloud Build: ./cloudbuild.*.yaml

---

1) Standards Overview and Principles

- Transport-agnostic by design; behavior parity across Pub/Sub and NATS JetStream.
- At-least-once delivery is assumed; services MUST be idempotent.
- Version everything that crosses service boundaries (topics, event types, schemas).
- Prefer explicitness over magic: attributes/headers, step IDs, error codes.
- Architecture.yaml is canonical; this document interprets and operationalizes it.

---

2) Topic/Subject Naming & Versioning Policy

MUST
- Use dotted, versioned subjects: namespace.domain.action.v1 (e.g., internal.bot.requests.v1).
- Keep names identical across Pub/Sub and NATS subjects; optional BUS_PREFIX only for local isolation (e.g., dev.).
- Declare constants in src/types/events.ts for all internal subjects.
- Deprecation window: retain N-1 versions for at least one full release cycle; publish a removal date in planning docs.

SHOULD
- Emit an audit topic (internal.routes.v1) for routing decisions where cost allows.
- Maintain a topic registry section in architecture.yaml summarizing current/legacy subjects.

COULD
- Use environment-scoped prefixes beyond local (e.g., stage.) for non-prod isolation in NATS-only environments.

---

3) Envelope v1 Baseline and Forward Compatibility

MUST
- envelope.v: "1"; envelope.source, envelope.correlationId required.
- Propagate trace via envelope.traceId and transport attributes (traceparent where supported).
- Honor envelope.replyTo if present; otherwise, use service/topic defaults.
- Optional envelope.timeoutAt bounds end-to-end processing; Router respects it for abort/DLQ.

SHOULD
- Validate envelope against documentation/schemas/envelope.v1.json in handlers (Ajv) with tests.
- Add envelope.routingSlip on first routing decision; keep immutable other than slip step updates.

COULD
- Introduce envelope.meta as namespaced extension bag for non-critical hints (e.g., meta.priority) to avoid schema churn; keep off the critical path.

---

4) Transport Attributes/Headers Standard

MUST
- Always publish attributes: correlationId, type, traceparent (if available).
- Normalize attribute keys as lowerCamelCase strings across drivers.

SHOULD
- Include stepId when routing slip is in play.
- Map attributes 1:1 between Pub/Sub attributes and NATS headers in drivers.

COULD
- Add attr driver: pubsub|nats for easier metrics breakdowns.

---

5) Routing Slip Conventions

MUST
- Allowed status values: PENDING | OK | ERROR | SKIP.
- Default retry policy per step: maxAttempts=3; backoff baseDelayMs=500 with jitter; see §6.
- Step IDs: router, retrieval, llm-bot, formatter, egress (extend vocabulary via architecture.yaml updates).
- Workers must update startedAt/endedAt and either status=OK|ERROR|SKIP and include error when applicable.
- On terminal ERROR (retryable=false or attempts exceeded), publish to internal.deadletter.v1 with context.

SHOULD
- Provide nextTopic on steps that override the default target subject.
- Keep notes as JSON string for structured hints (e.g., {"truncated":true}).

COULD
- Use a temporary aggregator step for streaming/chunked LLM outputs.

---

6) Retries, Backoff, and Timeouts

MUST
- Retryable errors increment attempt and republish the same step with exponential backoff: delay=baseDelayMs * 2^attempt ± jitter.
- When attempt >= maxAttempts, set status=ERROR with retryable=false and hand off to DLQ decision.
- Respect envelope.timeoutAt in Router and workers; abort remaining steps and mark SKIP where appropriate.

SHOULD
- Centralize backoff defaults in a shared constants module (src/types/events.ts or src/common/constants.ts).

COULD
- Emit retry telemetry: step_attempts_total and last_retry_delay_ms.

---

7) Idempotency & Side-Effect Control

MUST
- Dedupe key formula for slip-aware workers: sha256(correlationId + ':' + step.id + ':' + (step.attempt||0)).
- Guard external side effects (e.g., Twitch send) with idempotency keys; ensure at-least once semantics do not duplicate user-visible actions.

SHOULD
- Maintain a dedupe store (Firestore or Redis) with TTL >= 2x max processing time.
- Implement outbox/inbox patterns for at-least-once publishing where side effects are involved.

COULD
- Use probabilistic filters (Bloom) for hot paths when cache pressure is high, backed by authoritative store checks.

---

8) Error Taxonomy and DLQ Contract

MUST
- error.code naming: domain.category.reason (e.g., llm.provider.timeout, router.plan.unsupported_type).
- DLQ event on internal.deadletter.v1 MUST include: envelope, lastStep, error, service, and minimal payload snippet for debugging.
- Retryable flag governs reprocessing behavior.

SHOULD
- Provide a replay runbook and tooling pointer in README or scripts/infra.

COULD
- Add DLQ partitioning by cause (e.g., internal.deadletter.timeout.v1) if volume warrants.

---

9) Observability Baseline

MUST
- Metrics: messages_total{service,type}, step_duration_ms histogram, step_errors_total, step_attempts_total, in_flight, driver label.
- Logs: structure fields { correlationId, stepId, attempt, status, error.code? }.
- Tracing: propagate W3C traceparent; set envelope.traceId where feasible.

SHOULD
- Provide service dashboards under monitoring/dashboards aligned to topics.

COULD
- Emit sampling hints in attributes for high-volume flows.

---

10) Security & IAM (Cloud)

MUST
- Least-privilege IAM per service account: only the topics required for publish/subscribe.
- Isolate egress delivery credentials from Router/LLM service accounts.

SHOULD
- For local NATS in shared environments, require creds or NKey; do not expose open ports to untrusted networks.

COULD
- Add automated IAM validation in Cloud Build to fail deployments if bindings drift from policy.

---

11) Testing & CI Standards (Jest)

MUST
- Co-locate tests with code (src/**/*.test.ts). Mock external dependencies and drivers.
- Schema tests using Ajv for envelope and routing slip.
- Router advancement tests: route planning, completion detection, timeout handling.
- Retry/backoff tests including terminal error conversion at maxAttempts.
- Idempotency tests demonstrating duplicate deliveries do not repeat side effects.

SHOULD
- Provide reusable test helpers for creating InternalEventV1 and slip steps.
- Add minimal smoke tests to CI in Cloud Build before deploy steps.

COULD
- Spin up ephemeral NATS (Docker) in integration tests gated by env flag.

---

12) Deployment Standardization (Cloud Build)

MUST
- Each deployable service includes Dockerfile and cloudbuild.<service>.yaml that: install deps → run tests → build → containerize → push to Artifact Registry → deploy to Cloud Run.
- Provision topics and IAM in Cloud Build or IaC prior to deployment; fail early if missing.

SHOULD
- Reference shared steps from cloudbuild.shared.yaml where possible.
- Include environment examples under ./env (e.g., INTERNAL_INGRESS_TOPIC: internal.ingress.v1; MESSAGE_BUS_DRIVER: pubsub|nats).

COULD
- Add a canary step that publishes a test message to verify subscriptions post-deploy.

---

13) Transport Normalization (Pub/Sub ↔ NATS)

MUST
- MESSAGE_BUS_DRIVER selects driver; keep interfaces in src/services/message-bus/index.ts driver-agnostic.
- NATS local development MUST enable JetStream for persistence and parity with Pub/Sub’s at-least-once delivery.

SHOULD
- Expose queue group (NATS) or subscription concurrency (Pub/Sub) via config to tune backpressure.

COULD
- Provide a debug “tap” service subscribing to internal.* to aid local troubleshooting.

---

14) Migration Plan (Incremental, Backwards Compatible)

Phase A (Adopt Standards in New Code)
- New services and features comply with all MUST items in this document.

Phase B (Retrofit Existing Services)
- Add envelope schema validation, attribute propagation, and slip defaults where missing.
- Align topic constants and rename local subjects if BUS_PREFIX differs from policy.

Phase C (CI Enforcement)
- Introduce lint/validation steps: schema lint, subject registry check, IAM policy checks.
- Fail builds if MUST criteria aren’t met.

Rollback Strategy
- Keep feature flags to revert to in-process or old routing where prudent.
- Maintain N-1 event/topic versions until consumers have rolled forward.

---

15) Templates & Boilerplate

- Worker skeleton: subscribe → validate → idempotency guard → do work → update slip → publish continuation.
- Provide generator templates (future) for a new step/service with placeholders for subjects and step IDs.
- Add sample env files for each service type under ./env with MESSAGE_BUS_DRIVER and topics declared.

---

16) Compliance Checklist (for PRs)

MUST
- [ ] Uses versioned topics and declared constants from src/types/events.ts
- [ ] Publishes attributes: correlationId, type, traceparent
- [ ] Validates envelope/routing-slip schemas in code paths
- [ ] Implements idempotency guard with dedupe key formula
- [ ] Handles retries/backoff and terminal ERROR → DLQ
- [ ] Emits required metrics/log fields and propagates traceparent
- [ ] Includes Jest tests (schema, router advance, retry, idempotency)
- [ ] Cloud Build runs tests before build/deploy; topics/IAM provisioned

SHOULD
- [ ] Documents route planning in code or planning docs
- [ ] Audits routing decisions to internal.routes.v1

COULD
- [ ] Adds aggregator for streaming responses
- [ ] Provides integration test with NATS JetStream locally

---

17) Notes on Alignment with architecture.yaml

All recommendations in this document must remain consistent with architecture.yaml. If conflicts arise, architecture.yaml prevails; propose an update to this document (and architecture.yaml if appropriate) via PR with justification and links to impacted code and tests.

---

Traceability
- Sprint: 96
- Prompt-ID: messaging-system-improvements-2025-11-20
- Related: ./planning/messaging-system.md; sprint-76 messaging refactor docs; messaging-architecture-as-is.md
