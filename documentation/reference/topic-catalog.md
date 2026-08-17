# Topic Catalog

Complete reference for all internal message bus topics in the BitBrat platform. Topics follow the naming convention `internal.<domain>.<verb>.v<version>` and use Envelope v1 schema unless otherwise specified.

## Quick Reference

| Topic | Purpose | Key Producers | Key Consumers | Stage |
|-------|---------|---------------|---------------|-------|
| `internal.ingress.v1` | Normalized inbound events | ingress-egress, scheduler, api-gateway | event-router, persistence | Ingest |
| `internal.enriched.v1` | Analysis/enrichment results | query-analyzer, llm-bot, auth | event-router | Analysis |
| `internal.egress.v1` | Final responses for delivery | event-router, scheduler | ingress-egress, api-gateway | Egress |
| `internal.query.analysis.v1` | Fast pre-analysis for routing hints | event-router | query-analyzer | Analysis |
| `internal.llmbot.v1` | LLM reaction requests | event-router | llm-bot | Analysis |
| `internal.auth.v1` | Authentication/authorization | event-router | auth | Contextualization |
| `internal.reflex.v1` | Deterministic event-driven behavior | event-router | reflex | Reaction |
| `internal.state.mutation.v1` | State-change commands | disposition-service | state-engine | Reaction |
| `internal.persistence.snapshot.v1` | Event snapshots for storage | ingress-egress, api-gateway | persistence | Persist |
| `internal.deadletter.v1` | Unrecoverable failures | any-service | persistence | Error Handling |

## Topic Naming Conventions

**Pattern**: `internal.<domain>.<verb>.v<version>`

**Versioning Rules**:
- Bump `v<N>` on breaking payload changes
- Never mutate an existing version (create v2, v3, etc.)
- All consumers must explicitly subscribe to specific versions

**Per-Instance Suffix**: `.{instanceId}`
- Targets a single running instance
- Used for egress topic routing: `internal.egress.v1.{instanceId}`
- Instance ID resolved via: `K_REVISION` || `EGRESS_INSTANCE_ID` || `SERVICE_INSTANCE_ID` || `HOSTNAME` || generated UUID

**Schema Reference**: All topics use `documentation/schemas/envelope.v1.json` unless otherwise specified.

---

## Core Platform Topics

### internal.ingress.v1

**Purpose**: Normalized inbound events from external platforms entering the pipeline.

**Description**: External events (Twitch chat, Discord messages, Twilio SMS, API Gateway requests, scheduled tasks) are normalized into Envelope v1 format and published to this topic. This is the primary entry point for all external stimuli.

**Producers**:
- `ingress-egress` - Chat platform events (Twitch, Discord, Twilio)
- `scheduler` - Scheduled/cron tasks
- `api-gateway` - HTTP API requests

**Consumers**:
- `event-router` - Attaches routing slips based on JsonLogic rules
- `persistence` - Durably captures all inbound events

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 1 - Ingest

**Example Payload**:
```json
{
  "v": "1",
  "source": "ingress-egress",
  "correlationId": "evt_abc123",
  "platform": "twitch",
  "user": {
    "id": "user123",
    "username": "viewer42",
    "roles": ["subscriber"]
  },
  "message": {
    "text": "!help",
    "timestamp": "2026-08-11T10:30:00Z"
  },
  "routingSlip": {
    "steps": []
  }
}
```

---

### internal.enriched.v1

**Purpose**: Analysis and enrichment results returned to the router to advance the routing slip.

**Description**: Services performing analysis, authentication, or enrichment publish their results to this topic. The event-router consumes these enriched events, updates the routing slip, and dispatches the next step.

**Producers**:
- `query-analyzer` - Routing hints and intent classification
- `llm-bot` - LLM response candidates
- `auth` - User identity and permissions
- `sentiment-analyzer` - Sentiment annotations
- `story-engine-mcp` - Story enrichment

**Consumers**:
- `event-router` - Advances routing slip and dispatches next step

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 3 - Analysis (return path)

**Example Payload**:
```json
{
  "v": "1",
  "source": "llm-bot",
  "correlationId": "evt_abc123",
  "annotations": [
    {
      "kind": "llm_response",
      "value": "Here's how to use the help command...",
      "source": "llm-bot",
      "id": "ann_xyz789",
      "createdAt": "2026-08-11T10:30:05Z"
    }
  ],
  "routingSlip": {
    "steps": [
      { "service": "llm-bot", "topic": "internal.llmbot.v1", "status": "completed" },
      { "service": "disposition-service", "topic": "internal.user.disposition.observation.v1", "status": "pending" }
    ]
  }
}
```

---

### internal.egress.v1

**Purpose**: Final responses for delivery back to the originating platform.

**Description**: After all routing slip steps complete, the event-router publishes the final enriched event to this topic. Ingress-egress or api-gateway consumes it and translates the response back into platform-native format (Twitch chat message, Discord embed, Twilio SMS, HTTP response).

**Per-Instance Variant**: `internal.egress.v1.{instanceId}` - Targets the specific instance that owns the connection to the external platform.

**Producers**:
- `event-router` - Completes routing slip and publishes egress event
- `scheduler` - Scheduled task results

**Consumers**:
- `ingress-egress` - Delivers to chat platforms (Twitch, Discord, Twilio)
- `api-gateway` - Delivers to HTTP API clients

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 5 - Egress

**Instance ID Resolution** (priority order):
1. `K_REVISION` (Cloud Run auto-injected)
2. `EGRESS_INSTANCE_ID` (explicit override)
3. `SERVICE_INSTANCE_ID` (generic instance identifier)
4. `HOSTNAME` (container hostname)
5. Generated UUID (fallback)

---

## Analysis & Enrichment Topics

### internal.query.analysis.v1

**Purpose**: Fast pre-analysis requests dispatched by the router for routing and response hints.

**Description**: The event-router sends events here for lightweight analysis that informs routing decisions. Query-analyzer performs intent classification, keyword extraction, and determines whether LLM processing is needed.

**Producers**:
- `event-router`

**Consumers**:
- `query-analyzer`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 3 - Analysis

**Typical Latency**: <100ms (fast path)

---

### internal.llmbot.v1

**Purpose**: LLM reaction requests dispatched by the router to the headless LLM worker.

**Description**: Events requiring LLM processing (conversational queries, creative generation, complex reasoning) are routed to this topic. The llm-bot service invokes OpenAI/Ollama/vLLM and enriches the event with response candidates.

**Producers**:
- `event-router`

**Consumers**:
- `llm-bot`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 3 - Analysis

**Typical Latency**: 1-5 seconds (LLM API call)

**Configuration**:
- `OPENAI_MODEL` - Model to use (gpt-4o-mini, gpt-4o, gpt-3.5-turbo)
- `OPENAI_TIMEOUT_MS` - Request timeout (default: 30000)
- `OPENAI_MAX_RETRIES` - Retry attempts (default: 3)

---

### internal.auth.v1

**Purpose**: Authentication and authorization requests routed to the auth service.

**Description**: Events requiring user identity resolution, permission checks, or role enrichment are sent to this topic. The auth service validates platform-specific user tokens, resolves BitBrat user IDs, and attaches permissions.

**Producers**:
- `event-router`

**Consumers**:
- `auth`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 2 - Contextualization

**Enriches**:
- `user.id` - BitBrat user ID
- `user.roles` - Platform roles (moderator, subscriber, vip)
- `user.permissions` - BitBrat permissions (admin, operator, user)

---

## Reaction & State Topics

### internal.reflex.v1

**Purpose**: Deterministic event-driven behavior execution (Sprint 332).

**Description**: Reflexes are pattern-matched rules that execute MCP tools in <150ms, bypassing LLM analysis when triggered. Examples: "!uptime" → call uptime tool, "!dice" → call random number generator.

**Producers**:
- `event-router`

**Consumers**:
- `reflex`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 4 - Reaction

**Design Goals**:
- Sub-150ms latency (no LLM roundtrip)
- Deterministic execution (pattern → tool)
- Observable (publishes success/failure events)

**Related Topics**:
- `internal.reflex.executed.v1` - Success events
- `internal.reflex.failed.v1` - Failure events

---

### internal.reflex.executed.v1

**Purpose**: Execution success events published by reflex service.

**Description**: Contains tool results, latency metrics, and triggeredBy context for observability and future reactive systems. Consumed by monitoring and analytics services.

**Producers**:
- `reflex`

**Consumers**:
- (none currently - observability topic)

**Schema**: `documentation/schemas/reflex-executed-event.v1.json`

**Flow Stage**: Observability

**Example Payload**:
```json
{
  "reflexId": "reflex_uptime",
  "toolName": "system.uptime",
  "result": { "uptime_seconds": 86400 },
  "latencyMs": 23,
  "triggeredBy": {
    "correlationId": "evt_abc123",
    "pattern": "!uptime"
  },
  "timestamp": "2026-08-11T10:30:00Z"
}
```

---

### internal.reflex.failed.v1

**Purpose**: Execution failure events published by reflex service.

**Description**: Contains error details, latency, and triggeredBy context for observability and alerting. Used to monitor reflex health and identify broken tool integrations.

**Producers**:
- `reflex`

**Consumers**:
- (none currently - alerting topic)

**Schema**: `documentation/schemas/reflex-failed-event.v1.json`

**Flow Stage**: Observability

**Example Payload**:
```json
{
  "reflexId": "reflex_weather",
  "toolName": "weather.current",
  "error": {
    "message": "Weather API timeout",
    "code": "TIMEOUT"
  },
  "latencyMs": 5000,
  "triggeredBy": {
    "correlationId": "evt_abc123",
    "pattern": "!weather"
  },
  "timestamp": "2026-08-11T10:30:00Z"
}
```

---

### internal.state.mutation.v1

**Purpose**: State-change commands applied by the state engine to global/user state.

**Description**: Disposition service and other reactive services publish state mutation commands to this topic. The state-engine service applies mutations atomically to the global state store (PostgreSQL or Firestore).

**Producers**:
- `disposition-service`
- `state-engine` (self-mutations for complex workflows)

**Consumers**:
- `state-engine`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 4 - Reaction

**Mutation Types**:
- `set` - Set a key-value pair
- `increment` - Increment a numeric value
- `append` - Append to an array
- `delete` - Remove a key

**Example Payload**:
```json
{
  "v": "1",
  "source": "disposition-service",
  "correlationId": "evt_abc123",
  "mutations": [
    {
      "type": "set",
      "key": "user.user123.lastSeen",
      "value": "2026-08-11T10:30:00Z"
    },
    {
      "type": "increment",
      "key": "user.user123.messageCount",
      "amount": 1
    }
  ]
}
```

---

## Domain-Specific Topics

### internal.story.enrich.v1

**Purpose**: Collaborative-storytelling enrichment requests for the story-engine MCP server.

**Description**: Events related to collaborative storytelling (world-building, character development, plot progression) are routed to the story-engine-mcp service for specialized processing.

**Producers**:
- `event-router`

**Consumers**:
- `story-engine-mcp`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 3 - Analysis

**Domain**: Storytelling, creative writing, world-building

---

### internal.user.disposition.observation.v1

**Purpose**: Per-event user-behavior observations feeding short-term disposition analysis.

**Description**: Each user interaction generates an observation event consumed by the disposition-service. The service aggregates observations to compute short-term user disposition (mood, engagement, sentiment trend).

**Producers**:
- `event-router`

**Consumers**:
- `disposition-service`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 3 - Analysis

**Observation Dimensions**:
- Sentiment (positive, negative, neutral)
- Engagement (active, passive, lurking)
- Intent (question, statement, command)
- Tone (friendly, hostile, neutral)

---

### internal.user.disposition.updated.v1

**Purpose**: Emitted when a user's computed disposition snapshot changes.

**Description**: Published by disposition-service when a user's aggregated disposition crosses a threshold or changes significantly. Other services can subscribe to react to disposition changes (e.g., adjust LLM tone, trigger moderation).

**Producers**:
- `disposition-service`

**Consumers**:
- (none currently - reactive services can subscribe)

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: Observability / Reactive

**Configuration**:
- `DISPOSITION_PUBLISH_UPDATES` - Enable/disable update events (default: true)
- `DISPOSITION_UPDATE_THRESHOLD` - Minimum change to trigger update (default: 0.2)

**Example Payload**:
```json
{
  "userId": "user123",
  "disposition": {
    "sentiment": "positive",
    "engagement": "active",
    "mood": 0.8,
    "recentInteractions": 15
  },
  "previousDisposition": {
    "sentiment": "neutral",
    "engagement": "active",
    "mood": 0.5,
    "recentInteractions": 10
  },
  "timestamp": "2026-08-11T10:30:00Z"
}
```

---

## Persistence Topics

### internal.persistence.snapshot.v1

**Purpose**: Event snapshots for durable persistence and indexing.

**Description**: Ingress-egress and api-gateway publish event snapshots to this topic for durable storage. The persistence service captures events in PostgreSQL/Firestore for later retrieval, search, and analytics.

**Producers**:
- `ingress-egress`
- `api-gateway`

**Consumers**:
- `persistence`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 6 - Persist

**Configuration**:
- `PERSISTENCE_SNAPSHOT_MODE` - Snapshot timing (immediate, batched, async)
- `PERSISTENCE_DRIVER` - Backend (postgres, firestore)

**Storage Backends**:
- **PostgreSQL** (default): JSONB columns, full-text search, ACID transactions
- **Firestore** (legacy): Document storage, real-time subscriptions

---

### internal.persistence.finalize.v1

**Purpose**: Finalize signal instructing persistence to close out a stored event record.

**Description**: After all processing completes, the event-router publishes a finalize signal. The persistence service marks the event as complete, runs any post-processing (indexing, analytics aggregation), and closes the record.

**Producers**:
- `event-router`

**Consumers**:
- `persistence`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 6 - Persist

**Post-Processing Actions**:
- Update full-text search index
- Aggregate analytics counters
- Archive to cold storage (if configured)
- Trigger webhooks (if configured)

---

## Scheduler Topics

### internal.scheduler.tick

**Purpose**: Periodic timer tick that drives the scheduler's cron-style tasks.

**Description**: The scheduler service publishes a tick event to itself at regular intervals (configured via `SCHEDULER_TICK_INTERVAL_MS`). On each tick, the scheduler evaluates all active schedules and publishes events for tasks that are due.

**Producers**:
- `scheduler`

**Consumers**:
- `scheduler` (self-consumption)

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: Internal (scheduler loop)

**Configuration**:
- `SCHEDULER_TICK_INTERVAL_MS` - Tick interval (default: 60000ms = 1 minute)
- Range: 1000ms (1 second) to 3600000ms (1 hour)

**Design**:
- Internal timer using `setInterval()` (no external cron dependency)
- Platform-agnostic (works on Docker, GCP, AWS, Azure)
- Manual trigger available via `POST /tick` endpoint

**See Also**: [Scheduler Guide](../guides/scheduler.md)

---

## Dead Letter Topics

### internal.deadletter.v1

**Purpose**: Generic dead-letter topic for unrecoverable failures.

**Description**: When a service encounters an unrecoverable error (invalid payload, missing dependency, permanent API failure), it publishes the failed event to this topic. The persistence service captures dead-letter events for later inspection and debugging.

**Producers**:
- `any-service` (any service can dead-letter)

**Consumers**:
- `persistence`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: Error Handling

**Common Failure Scenarios**:
- Malformed event payload (schema validation failure)
- Missing required environment variable
- Permanent external API failure (4xx errors)
- Timeout after max retries

**Debugging**:
```bash
# Query dead-letter events (PostgreSQL)
docker exec bitbrat-postgres-1 psql -U bitbrat -d bitbrat -c \
  "SELECT id, correlation_id, source, error_message, created_at
   FROM events
   WHERE topic = 'internal.deadletter.v1'
   ORDER BY created_at DESC
   LIMIT 10;"
```

---

### internal.router.dlq.v1

**Purpose**: Event-router-specific dead-letter topic for unroutable/failed events.

**Description**: When the event-router cannot process an event (no matching rules, routing slip exhausted, circular routing detected), it publishes the event to this dead-letter queue. This is distinct from the generic dead-letter topic to enable router-specific monitoring.

**Producers**:
- `event-router`

**Consumers**:
- `persistence`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: Error Handling

**Common Router Failures**:
- No matching JsonLogic rules (event unroutable)
- Circular routing detected (service A → B → A)
- Routing slip exhausted (max steps reached)
- Invalid routing slip format

**Debugging**:
```bash
# Query router dead-letter events
docker exec bitbrat-postgres-1 psql -U bitbrat -d bitbrat -c \
  "SELECT id, correlation_id, platform, user_id, error_message, created_at
   FROM events
   WHERE topic = 'internal.router.dlq.v1'
   ORDER BY created_at DESC
   LIMIT 10;"
```

---

## Utility Topics

### internal.finalize.v1

**Purpose**: Generic finalize signal that any service may publish to close out a message.

**Description**: Services can publish to this topic to signal completion of processing. This is a catch-all topic for services that need to emit completion events but don't have a specialized topic.

**Producers**:
- `any-service`

**Consumers**:
- (none currently - optional subscriptions)

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: Utility

**Use Cases**:
- Signal long-running task completion
- Trigger cleanup workflows
- Cascade finalization to dependent services

---

### internal.api.egress.v1

**Purpose**: Egress responses destined for the API gateway's WebSocket clients.

**Description**: Similar to `internal.egress.v1` but specifically for HTTP API clients connected via WebSocket. The per-instance variant `internal.api.egress.v1.{instanceId}` targets the specific api-gateway instance that owns the WebSocket connection.

**Producers**:
- `event-router`

**Consumers**:
- `api-gateway`

**Schema**: `documentation/schemas/envelope.v1.json`

**Flow Stage**: 5 - Egress

**Connection Ownership**:
- Each api-gateway instance manages its own WebSocket connections
- Responses must be routed to the correct instance via `{instanceId}` suffix
- Instance ID resolution: `K_REVISION` || `SERVICE_INSTANCE_ID` || `HOSTNAME`

---

## Topic Lifecycle & Management

### Creating a New Topic

When adding a new domain or workflow, follow these steps:

1. **Define Topic Name**: Follow convention `internal.<domain>.<verb>.v1`
2. **Create Schema**: Document payload structure in `documentation/schemas/<topic>.v1.json`
3. **Register in architecture.yaml**: Add to `messaging.topics` section
4. **Document Here**: Add detailed entry to this catalog
5. **Update Producers**: Configure services to publish to new topic
6. **Update Consumers**: Configure services to subscribe to new topic

**Example**:
```yaml
# architecture.yaml
messaging:
  topics:
    internal.moderation.action.v1:
      description: Moderation actions (ban, timeout, delete)
      producers: [moderation-service]
      consumers: [ingress-egress, audit-logger]
      schema: documentation/schemas/moderation-action.v1.json
```

### Versioning Strategy

**When to bump version**:
- ✅ Add required field to schema
- ✅ Remove existing field
- ✅ Change field type or constraints
- ✅ Rename field

**When NOT to bump version**:
- ❌ Add optional field (backward compatible)
- ❌ Add new annotation kind (annotations are extensible)
- ❌ Add new producer/consumer (infrastructure change, not schema change)

**Migration Path** (v1 → v2):
1. Create new schema: `documentation/schemas/<topic>.v2.json`
2. Update all producers to publish to both v1 and v2 (dual-write period)
3. Update all consumers to subscribe to v2
4. Verify v2 traffic in production for 1 sprint
5. Stop publishing to v1
6. Remove v1 topic after 3-sprint deprecation period

### Monitoring Topics

**View topic activity** (NATS):
```bash
# List all streams
docker exec bitbrat-nats-1 nats stream list

# View stream info
docker exec bitbrat-nats-1 nats stream info internal.ingress.v1

# View consumer lag
docker exec bitbrat-nats-1 nats consumer list internal.ingress.v1
```

**View topic activity** (Pub/Sub):
```bash
# List all topics
gcloud pubsub topics list

# View topic metrics
gcloud pubsub topics describe internal.ingress.v1

# View subscription backlog
gcloud pubsub subscriptions list
gcloud pubsub subscriptions describe internal.ingress.v1-event-router
```

---

## See Also

- [Messaging System Architecture](../concepts/messaging-system.md) - Deep dive into message bus design
- [Event Flow Stages](../concepts/agent-flow-stages.md) - 5-stage event processing model
- [Envelope v1 Schema](../schemas/envelope.v1.json) - Primary message schema
- [Routing Slip Schema](../schemas/routing-slip.v1.json) - Routing slip structure
- [Platform Flow](../concepts/platform-flow.md) - End-to-end event lifecycle
