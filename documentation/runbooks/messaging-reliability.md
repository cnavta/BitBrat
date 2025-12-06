# Messaging Reliability Defaults and Operations

## Defaults
- PUBSUB_BATCH_MAX_MS: 20 (low-latency). Warning emitted at ≥1000ms.
- PUBSUB_PUBLISH_TIMEOUT_MS: 0 (disabled). Set only if idempotency + filtered retries are enabled.
- PUBLISH_MAX_RETRIES: 3 (retry only gRPC transient errors: 14, 13, 8, 10).
- PUBSUB_ENSURE_MODE: on-publish-fail (default).
- MESSAGE_DEDUP_DISABLE: 0 (enabled). MESSAGE_DEDUP_TTL_MS: 600000. MESSAGE_DEDUP_MAX: 5000.

## Duplicate mitigation
- Publishers attach idempotencyKey (defaults to correlationId) via busAttrsFromEvent().
- Subscribers drop duplicates seen within TTL and ack them (`message_consumer.dedupe.drop`).

## Telemetry
- message_publisher.publish.start/ok/error with durationMs on ok.
- ingress.publish.attempt includes attempt count.
- Counters incremented:
  - message_publisher.publish.ok
  - message_publisher.publish.error
  - message_consumer.dedupe.drop

## Troubleshooting
- Long publish times:
  - Check logs `message_publisher.publish.ok` durationMs.
  - Verify `PUBSUB_BATCH_MAX_MS` is not high.
  - Avoid routing Pub/Sub through VPC connectors for public egress (prefer direct).
- Duplicate explosion:
  - Ensure `PUBSUB_PUBLISH_TIMEOUT_MS=0` (default-off).
  - Verify retry filters are in place (no retry on local publish_timeout; retry only transient gRPC codes).
  - Confirm dedupe is enabled and TTL/max are reasonable.

## Recommended values
- Latency-sensitive services: PUBSUB_BATCH_MAX_MS=20; retries=3 filtered; timeout=0.
- Throughput-heavy publishers: consider 50ms batch window; keep timeout=0 unless strong idempotency is in place.
