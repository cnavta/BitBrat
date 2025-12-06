# Messaging Configuration — Publishers

This document summarizes environment-tunable settings for the message bus publishers and recommended defaults. It applies to both Pub/Sub and NATS drivers where applicable. Architecture intent is defined in architecture.yaml.

## Common Attribute Conventions

- Attribute keys are normalized to lowerCamelCase across drivers.
- Always include: correlationId, type, traceparent (when available). Optional: stepId, idempotencyKey.

## Google Cloud Pub/Sub (Driver: pubsub)

Environment variables:

- PUBSUB_PUBLISH_TIMEOUT_MS
  - Bounds the time we wait for publish to complete. 0 disables (driver defaults apply).
  - Recommendation: 10000–20000 in fragile networks and local dev; 0 or 10000 in Cloud.
- PUBSUB_ENSURE_MODE
  - Controls topic ensure behavior. Values: always | on-publish-fail | off.
  - Default: on-publish-fail.
- PUBSUB_ENSURE_TIMEOUT_MS
  - Timeout for ensureTopic operations; default 2000.
- PUBSUB_BATCH_MAX_MESSAGES
  - Batching max messages per request. Default 100.
- PUBSUB_BATCH_MAX_MS
  - Batching max milliseconds to wait before sending a batch. Default 100.
- PUBSUB_API_ENDPOINT
  - Override endpoint (e.g., emulator http://localhost:8085). If set, also set PROJECT_ID.

Startup/Init
- The publisher initializes a Topic with the configured batching values and logs them once:
  - msg: pubsub.publisher.init; fields: { topic, batching: { maxMessages, maxMilliseconds } }

Behavioral Notes
- On publish error: if NotFound and ensure mode enabled, the driver will ensure then retry once.
- When PUBSUB_PUBLISH_TIMEOUT_MS is exceeded, the error is tagged with code=DEADLINE_EXCEEDED (4) and reason=publish_timeout for easier triage.

## NATS JetStream (Driver: nats)

Environment variables:

- NATS_URL: nats://host:4222
- BUS_PREFIX: optional subject prefix (e.g., dev.) applied to all subjects

Flush and Batching
- NATS client exposes flush(); our publisher implements flush() and logs start/ok/error around it.
- JetStream handles internal batching; no additional knobs are surfaced at this time.

## Idempotency Guidance

- For side-effecting operations, include an idempotencyKey attribute derived from business identifiers (e.g., correlationId + stepId + attempt).
- Dedupe store TTL should be at least 2x the maximum expected processing time for the step.

## Local Dev / CI Tips

- CI / tests should set MESSAGE_BUS_DRIVER=noop and MESSAGE_BUS_DISABLE_IO=1 to avoid real network calls.
- For Pub/Sub emulator: set PUBSUB_API_ENDPOINT and PROJECT_ID to skip ADC and speed up initialization.
