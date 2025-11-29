Title: Technical Architecture – Ingress-Egress Egress Path (Per-Instance Topics)
Status: Draft (v1)
Sprint: sprint-106-7c9e12
Branch: feature/sprint-106-7c9e12-egress-path

Objective
- Implement a bootstrap egress path for the ingress-egress service so it can:
  1) Publish events with envelope.egressDestination set to the service’s own egress topic
  2) Subscribe to a per-instance egress topic internal.egress.v1.{instanceId}
  3) On receiving messages on its egress topic, send payload.chat.text via the Twitch IRC connection as the bot user

Motivation & Context
- Persisted ingress connections (e.g., Twitch IRC, future WebSockets) need symmetric egress back to the same connection they arrived on.
- Per-instance topics isolate egress streams to the correct runtime instance, avoiding cross-instance leakage and reducing routing complexity.

Contracts & Message Shape
- Internal Event Contract: src/types/events.ts → InternalEventV1 with EnvelopeV1
  - envelope.egressDestination?: string — Destination to route external responses for a message, generally the ingress-egress instance the message arrived on.
- Topic constants (current):
  - INTERNAL_EGRESS_V1 = "internal.egress.v1" (base)
- New per-instance convention:
  - EGRESS_TOPIC(instanceId) := `${BUS_PREFIX}internal.egress.v1.${instanceId}`
  - In all messages published by ingress-egress (e.g., ingress Twitch chat → internal.ingress.v1), set envelope.egressDestination = `internal.egress.v1.${instanceId}` (without BUS_PREFIX inside the envelope; BUS_PREFIX is applied by the bus driver when publishing/consuming).

Instance Identity
- A stable instance identifier is required to derive the per-instance egress topic.
- Resolution order:
  1) EGRESS_INSTANCE_ID (env, recommended)
  2) SERVICE_INSTANCE_ID (env, optional)
  3) HOSTNAME (env, provided by Cloud Run)
  4) Random UUID generated at process start (logged)

Service Behavior (Ingress-Egress)
1) Startup
   - Determine instanceId via the resolution order above.
   - Compute egressTopic = `internal.egress.v1.${instanceId}`.
   - Initialize TwitchIrcClient with existing configuration.
   - Subscribe to `${BUS_PREFIX}${egressTopic}` using the message bus abstraction.

2) Publishing (Ingress → Internal)
   - For all internally published events (e.g., Twitch chat ingress):
     - Ensure envelope.egressDestination is set to egressTopic (without BUS_PREFIX inside the value).
     - Publish to `${BUS_PREFIX}${INTERNAL_INGRESS_V1}` as today.

3) Consuming (Internal → Egress/Twitch)
   - On messages received on `${BUS_PREFIX}${egressTopic}`:
     - Validate payload.chat?.text is a non-empty string.
     - Send text via TwitchIrcClient to the appropriate channel(s):
       - Default: primary configured channel from cfg.twitchChannels[0]
       - Future: derive channel/user from payload or routing attributes.
     - Log correlationId and outcome.
   - Errors:
     - If payload missing or invalid, log at warn and ack (bootstrap behavior: do not retry poison messages).
     - If Twitch send fails transiently, log error and consider nack/retry based on bus semantics (v1: log and ack to keep pipeline simple).

Environment Variables
- EGRESS_INSTANCE_ID: explicit instance identity for per-instance egress topic.
- SERVICE_INSTANCE_ID: fallback identity.
- HOSTNAME: Cloud Run-provided fallback identity.
- BUS_PREFIX: subject prefix (e.g., "dev.").
- Existing ingress-egress env already defined in architecture.yaml (TWITCH_BOT_USERNAME, TWITCH_CHANNELS, etc.).

Observability
- Logs (via common logger):
  - info: startup, resolved instanceId, computed egress topic, subscription established
  - debug: publish events with egressDestination set; egress deliveries attempted and results
  - error: subscription or Twitch send failures (include correlationId, traceId)
- Metrics (future): counters for egress.received, egress.sent.ok, egress.sent.error
- Debug endpoint remains at /_debug/twitch to inspect IRC state

Error Handling
- JSON parsing errors: ack (do not retry)
- Twitch transient errors: v1 log+ack (bootstrap); future work may add exponential backoff with DLQ
- Unexpected payload shape: warn+ack

Security & IAM
- Same service account as ingress-egress; no additional external privileges required for v1.
- Message bus permissions must allow subscribe to internal.egress.v1.* and publish to internal.ingress.v1.

Deployment & Scaling
- Cloud Run single-instance default (min=1, max=1) already configured in architecture.yaml for ingress-egress; this aligns with per-instance topics.
- If future scaling >1 is required, a unique instanceId per replica is recommended (e.g., injected env from deploy pipeline) to avoid contention.

architecture.yaml Adjustments (Proposed)
- services.ingress-egress.topics:
  publishes:
    - internal.ingress.v1
  consumes:
    - internal.egress.v1.{instanceId}   # document the pattern; actual subscription uses resolved instanceId
- services.ingress-egress.env add:
  - EGRESS_INSTANCE_ID (optional)
  - SERVICE_INSTANCE_ID (optional)

Testing Strategy (Summary)
- Unit tests:
  - Envelope builder/publisher sets envelope.egressDestination = `internal.egress.v1.{instanceId}`
  - Egress consumer extracts payload.chat.text and calls TwitchIrcClient.send
- Integration (local): in-memory bus mock publishes to computed topic and verifies side effects

Risks & Future Work
- Risk: multiple replicas with same instanceId could duplicate send; mitigated by single instance scaling for now.
- Future: richer egress routing (channel selection, platforms), retries/DLQ, authorization/policy checks, and correlation across request/response flows.

Acceptance Criteria (Recap)
- ingress-egress subscribes to internal.egress.v1.{instanceId}
- All publications from ingress-egress have envelope.egressDestination set appropriately
- payload.chat.text on egress messages is emitted via Twitch IRC from the bot account
