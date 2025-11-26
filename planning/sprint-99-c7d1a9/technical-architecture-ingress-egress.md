# Ingress-Egress Service — Technical Architecture (Twitch IRC Ingestion)

llm_prompt: "Architect; produce technical architecture aligned with architecture.yaml and platform-overview; scope: Twitch IRC → internal.ingress.v1"

## 1. Objective & Scope
- Establish a resilient Twitch IRC listener that connects to the broadcaster’s channel and ingests chat messages.
- Normalize incoming messages into the platform Envelope and publish to `internal.ingress.v1` via the message-bus abstraction.
- Prepare operational hooks: health/readiness endpoints and a debug status endpoint at `/_debug/twitch`.
- Conform strictly to architecture.yaml and platform-overview guidelines.

Out of scope for this sprint:
- EventSub webhooks and non-chat Twitch events (future ingress sources).
- Egress features and round-trip responses.
- Authorization/role attribution beyond what is present in the raw message; formal Auth service will enrich later.

## 2. Architectural Context
- Per architecture.yaml
  - Service: `ingress-egress`
    - entry: `src/apps/ingress-egress-service.ts`
    - topics publishes: `internal.ingress.v1`
    - topics consumes: `internal.egress.v1` (not exercised in this feature)
    - paths: `/_debug/twitch`
    - env: `TWITCH_BOT_USERNAME`, `TWITCH_CHANNELS`
    - secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
  - Global defaults: health endpoints `/healthz`, `/readyz`, `/livez`; `MESSAGE_BUS_DRIVER`, `NATS_URL`, `BUS_PREFIX`.
- Messaging: Event-first design. Every external event is validated, normalized into a standard Envelope, then published to the internal ingress topic for downstream processing by Auth → Router → … → Finalizer (see platform-overview).

## 3. Components & Responsibilities
1) TwitchCredentialsProvider
- Purpose: Resolve and refresh Twitch tokens used for IRC (bot and/or broadcaster context).
- Source of truth: Firestore documents persisted by the `oauth-flow` service’s OAuth2 flow for the relevant Twitch account(s).
- Responsibilities:
  - Load account credentials (access_token, refresh_token, expiry, scopes).
  - Refresh tokens as needed via Twitch OAuth using `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
  - Expose minimal interface: `getChatAuth(channelId|login): Promise<{ accessToken, userId, login }>`.
  - Never log secrets; emit structured logs with correlation IDs.

2) TwitchIrcClient (Twurple Chat)
- Uses Twurple’s Chat client to connect as the bot identity to channel(s).
- Connection policy:
  - Channels to join are configured by `TWITCH_CHANNELS` (comma-separated) and may be augmented by Firestore lookups (future enhancement).
  - Auto-reconnect with exponential backoff (Twurple supports reconnect; implement backoff wrapper if needed).
  - Heartbeat/keepalive monitoring; expose status to debug handler.
- Events handled:
  - `onMessage(channel, user, text, msg)` → normalize to Envelope → publish to `internal.ingress.v1`.
  - Optional: `onJoin`, `onPart`, `onReconnect`, `onDisconnect` → update status.

3) EnvelopeBuilder
- Input: Parsed IRC message metadata (channel, user login, display name, tags, emotes where available, message id, timestamp, room/user ids if present).
- Output: Envelope aligned with platform-overview Example Envelope:
  - v: "1"
  - id/correlationId/traceId: generated UUIDs; trace may be reused across related IRC events if available.
  - timestamp: ISO string when received.
  - type: "external.chat.message.v1" (platform is encoded separately)
  - source: { platform: "twitch", channel: <channel name>, channelId: <room id if known> }
  - user: minimal fields from IRC message if available; deep enrichment deferred to Auth service.
  - routingSlip: initially empty or set to first downstream step later by Router; here, set to [] and rely on Router.
  - finalizationDestination: "internal.finalizer.v1" (platform default as per overview)
  - payload: core message content + raw tags, e.g.: `{ text, messageId, badges, isMod, isSubscriber, color, emotes, raw }`.

4) MessagePublisher
- Uses existing `src/services/message-bus` abstraction (supports NATS/Google Pub/Sub behind an interface).
- Publishes Envelope to `${BUS_PREFIX}internal.ingress.v1`.
- Attributes/headers include minimal transport hints (traceparent if available).
- Implements retry with bounded backoff; on repeated failure, logs and optionally emits to finalize/DLQ per defaults.

5) HttpServer Handlers
- `/healthz`, `/readyz`, `/livez`: reflect server and IRC client readiness.
- `/_debug/twitch`: returns JSON snapshot: connection status, joined channels, last reconnect time, recent message counters, and simplified last error.

## 4. Data & Configuration
Environment variables (architecture.yaml + proposed)
- Required (already defined):
  - MESSAGE_BUS_DRIVER, NATS_URL, BUS_PREFIX
  - TWITCH_BOT_USERNAME
  - TWITCH_CHANNELS (csv of channel logins, e.g., "mychannel,anotherchan")
  - TWITCH_CLIENT_ID (secret)
  - TWITCH_CLIENT_SECRET (secret)
- Optional (proposed; reasonable defaults):
  - IRC_RECONNECT_INITIAL_MS (default 1000)
  - IRC_RECONNECT_MAX_MS (default 30000)
  - PUBLISH_MAX_RETRIES (default 5)

Firestore schema (contract-level, not path-prescriptive)
- Document contains at least: `{ userId, login, accessToken, refreshToken, expiresAt, scopes[] }` for the bot/broadcaster.
- Provider is configurable to locate the correct doc by login or channel id. Exact collection path is an implementation detail of oauth-flow; provider will accept a lookup strategy function to remain decoupled.

## 5. Control Flows
Sequence: IRC message → Envelope → Publish
1. Chat client receives a message event.
2. Build Envelope using EnvelopeBuilder.
3. Publish to internal.ingress.v1 via MessagePublisher.
4. Log structured event with event.id and minimal PII.
5. Downstream services Auth → Router continue processing.

Reconnect & readiness
- On disconnect: mark readiness false; attempt reconnect with capped exponential backoff; update debug snapshot.
- On successful connect and channels joined: mark readiness true.

## 6. Error Handling & Resilience
- Token expiry: refresh via OAuth; if refresh fails, surface degraded status in debug endpoint and retry periodically.
- Publish failures: retry with backoff; after exhaustion, emit to `internal.finalize.v1` with failure status when available, else log at error with full context and increment a metric.
- Message parsing anomalies: include raw payload in Envelope.payload.raw; never crash the process; protect against unbounded data growth.
- Backpressure: if bus backpressure is signaled, slow consumption by temporarily pausing message handler or buffering within configured bounds.

## 7. Observability
- Structured logs: service, component, eventId, channel, userLogin, severity, errorCode.
- Metrics: counters for received, published, failed, reconnects; gauges for connected, channels joined.
- Tracing: generate traceId per message; propagate via attributes if the bus driver supports it.

## 8. Security & Compliance
- Secrets via platform secret manager (Cloud Run secrets env). Never log tokens or personally sensitive data.
- Principle of least privilege for Firestore token reads.
- Validate and sanitize user-generated text when rendering; here we only transport.

## 9. Testing Strategy
- Unit tests
  - EnvelopeBuilder: mapping from IRC message → Envelope; edge cases (missing tags, unicode, emotes).
  - Publisher: retries and topic prefixing.
- Integration tests
  - Mock Twurple ChatClient to emit message events; assert publish invocations.
  - Message-bus driver integration with local NATS JetStream.
- Operational tests
  - Health and debug endpoints return expected status transitions when simulating disconnect/reconnect.

## 10. Deployment & Runtime
- Containerized service deployed to Cloud Run.
- Scaling for ingress-egress per architecture.yaml for this service: min=1, max=1 to ensure a single IRC connection instance (avoid duplicate joins) initially.
- Cloud Build steps (existing patterns) will: install, build, test, containerize, and deploy.

## 11. Open Questions / Decisions Needed
- Firestore credential document path and lookup key standardization (by channel login, broadcaster userId, or both?).
- Whether Auth should enrich user role/display metadata synchronously or asynchronously after ingress (current plan: asynchronously on `internal.ingress.v1`).
- Multi-channel scaling strategy: keep single process joining multiple channels vs. shard by channel in the future.

## 12. Implementation Outline (for next phase)
- Define interfaces in `src/services/ingress/twitch/`:
  - credentials-provider.ts
  - twitch-irc-client.ts
  - envelope-builder.ts
- Wire to existing `src/services/message-bus` publisher.
- Add Express handlers for health and debug.
- Guard with feature flags and comprehensive unit tests.

## 13. Envelope Example (Twitch IRC → internal.ingress.v1)
{
  "v": "1",
  "id": "<uuid>",
  "correlationId": "<uuid>",
  "traceId": "<uuid>",
  "timestamp": "2025-11-21T17:02:00.000Z",
  "type": "external.chat.message.v1",
  "source": {
    "platform": "twitch",
    "channel": "my_channel",
    "channelId": "<roomId>"
  },
  "user": {
    "id": "<userId>",
    "name": "<login>",
    "displayName": "<displayName>",
    "profileImageUrl": "",
    "role": ""
  },
  "routingSlip": [],
  "finalizationDestination": "internal.finalizer.v1",
  "payload": {
    "text": "Hello World!",
    "messageId": "<msgId>",
    "badges": ["subscriber"],
    "isMod": false,
    "isSubscriber": true,
    "color": "#AABBCC",
    "emotes": [],
    "raw": { "tags": {"badge-info": ""} }
  }
}

status: draft
version: 0.1.0
alignment: architecture.yaml v0.1.0
