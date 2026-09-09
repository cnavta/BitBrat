# NATS Technical Architecture for BitBrat Platform

**Author:** Architect
**Date:** 2026-08-21
**Status:** Authoritative v1
**Scope:** Comprehensive analysis of NATS usage, patterns, limitations, and opportunities

---

## Executive Summary

This document provides a comprehensive technical analysis of NATS usage within the BitBrat platform. NATS JetStream serves as the **local/development message bus**, providing durable streaming, at-least-once delivery, and sub-millisecond latency for event-driven orchestration. The platform implements a **driver-agnostic abstraction** that allows seamless switching between NATS (local/Docker) and Cloud Pub/Sub (production) without code changes.

**Key Findings:**
- ✅ **Solid Foundation**: Robust NATS JetStream implementation with durable consumers, ack-wait mechanisms, and idempotency
- ⚠️ **Underutilized**: Advanced NATS features (KV, Object Store, request-reply) not currently leveraged
- 🎯 **Opportunities**: Significant potential for enhanced capabilities using NATS-native features
- 🔧 **Consistency**: Driver abstraction successfully isolates transport-specific logic

---

## 1. Current NATS Implementation

### 1.1 Infrastructure Configuration

**Source:** architecture.yaml:199-234

```yaml
infrastructure:
  docker:
    messaging:
      service: nats
      image: nats:2.10-alpine
      ports:
        client: '4222:4222'   # NATS client connections
        http: '8222:8222'     # HTTP monitoring API
        routing: '6222:6222'  # Cluster routing (unused in current setup)
      volumes:
        - type: named
          name: nats-data
          target: /data
      env:
        NATS_JETSTREAM_MAX_MEM: '-1'        # Unlimited memory
        NATS_JETSTREAM_MAX_FILE: 10Gi       # 10GB file storage
      config:
        jetstream: true                     # JetStream enabled
        persistence: true                   # File-backed persistence
        maxPayload: 10485760                # 10MB max message size
        retention: 604800                   # 7-day retention (seconds)
```

**Docker Compose Configuration:**

infrastructure/docker-compose/docker-compose.local.yaml:13-41

```yaml
nats:
  image: "nats:2-alpine"
  command:
    - "-js"              # Enable JetStream
    - "-sd"              # Store directory
    - "/data"
    - "-m"               # Monitoring port
    - "8222"
  ports:
    - "4222:4222"        # Client port
    - "8222:8222"        # Monitoring port
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:8222/varz"]
    interval: "5s"
    timeout: "3s"
    retries: 10
  volumes:
    - "nats-data:/data"  # Persistent storage
  networks:
    bitbrat-network:
      aliases:
        - "nats.bitbrat.local"
```

**Key Characteristics:**
- **Version**: NATS 2.10 Alpine (lightweight)
- **JetStream**: Enabled with file-backed persistence
- **Storage**: 10GB max file storage, unlimited memory
- **Retention**: 7-day default retention for streams
- **Monitoring**: HTTP monitoring API on port 8222 (`/varz`, `/healthz`)
- **Network**: Isolated Docker network with DNS alias

### 1.2 Driver Implementation

**Source:** src/services/message-bus/nats-driver.ts

#### Publisher (NatsPublisher)

```typescript
export class NatsPublisher implements MessagePublisher {
  private connPromise: Promise<NatsConnection>;
  private jsPromise: Promise<JetStreamClient>;

  constructor(subject: string) {
    this.connPromise = connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222'
    });
    this.jsPromise = this.connPromise.then(async (c) => {
      const jsm = await c.jetstreamManager();
      await ensureStream(jsm);  // Auto-create streams
      return c.jetstream();
    });
  }

  async publishJson(data: unknown, attributes: AttributeMap = {}): Promise<string | null> {
    const js = await this.jsPromise;
    const payload = sc.encode(JSON.stringify(data));
    const headers = mapToHeaders(normalizeAttributes(attributes));
    const pa = await js.publish(subj, payload, { headers });
    return pa.seq ? String(pa.seq) : null;  // Return sequence number
  }
}
```

**Features:**
- ✅ Lazy connection establishment
- ✅ Auto-stream creation via `ensureStream()`
- ✅ NATS headers for message attributes
- ✅ Sequence-based message IDs
- ✅ Flush support for guaranteed delivery

#### Subscriber (NatsSubscriber)

```typescript
export class NatsSubscriber implements MessageSubscriber {
  async subscribe(subject: string, handler: MessageHandler, options: SubscribeOptions = {}): Promise<UnsubscribeFn> {
    const durable = options.durable || `${subj.replace(/\./g, '-')}-${queue}-durable`;

    const opts = consumerOpts();
    opts.durable(durable);              // Durable consumer
    opts.manualAck();                   // Explicit ack required
    opts.ackExplicit();                 // No auto-ack
    opts.ackWait(ackWaitSeconds * 1000); // 60s default ack timeout
    if (queue) opts.queue(queue);       // Queue group for load balancing
    if (options.maxInFlight) opts.maxAckPending(options.maxInFlight);

    const sub = await js.subscribe(subj, opts);

    // Message processing loop
    for await (const m of sub) {
      const keepAlive = setInterval(() => {
        (m as any).working?.();  // Reset ack-wait timer
      }, workingMs);

      try {
        await handler(dataBuf, attrs, { ack, nack });
        if (options.ack === 'auto') await ack();
      } catch (e) {
        await nack();
      } finally {
        clearInterval(keepAlive);
      }
    }
  }
}
```

**Features:**
- ✅ **Durable Consumers**: Auto-generated durable consumer names
- ✅ **Ack-Wait Mechanism**: 60s timeout with periodic `working()` calls
- ✅ **Queue Groups**: Load balancing across multiple consumers
- ✅ **Explicit Ack**: Manual acknowledgment prevents message loss
- ✅ **Redelivery Metadata**: Extracts `deliveryCount`, `redelivered`, `streamSequence`
- ✅ **Graceful Drain**: Clean unsubscribe via `sub.drain()`

### 1.3 Stream Management

**Source:** tools/init-nats-streams.ts

**Standard Streams:**

```typescript
const STANDARD_STREAMS: StreamDefinition[] = [
  { name: 'internal-mcp',              subjects: ['internal.mcp.>'] },
  { name: 'internal-ingress',          subjects: ['internal.ingress.>'] },
  { name: 'internal-egress',           subjects: ['internal.egress.>'] },
  { name: 'internal-contextualization', subjects: ['internal.contextualization.>'] },
  { name: 'internal-analysis',         subjects: ['internal.analysis.>'] },
  { name: 'internal-reaction',         subjects: ['internal.reaction.>'] },
  { name: 'internal-api',              subjects: ['internal.api.>'] },
];

const DEFAULT_STREAM_CONFIG = {
  storage: 'file',              // Persistent file storage
  retention: 'limits',          // Retain based on limits (not interest)
  max_age: 86400_000_000_000,   // 24-hour retention
  replicas: 1,                  // Single replica (no clustering)
  discard: 'old',               // Discard old messages when limits reached
};
```

**Idempotent Stream Initialization:**
- Runs via `npm run init-streams` or `brat docker up`
- Creates all 7 standard streams if missing
- Safe to run multiple times (idempotent)
- Reports existing vs newly created streams

### 1.4 Base Server Integration

**Source:** src/common/base-server.ts:500-774

**Message Subscription Pattern:**

```typescript
protected async onMessage<T>(
  destination: string,
  handler: MessageHandler<T>,
  options?: SubscribeOptions & { idempotency?: SubscriptionIdempotencyConfig }
): Promise<void> {
  const subject = `${this.config.busPrefix || ''}${destination}`;
  const queue = options?.queue || this.serviceName;

  const subscriber = createMessageSubscriber();  // Auto-selects NATS driver

  const unsubscribe = await subscriber.subscribe(
    subject,
    async (data, attributes, ctx) => {
      const parsed = JSON.parse(data.toString('utf8')) as T;

      // Extract EventContext (correlationId, traceId, sessionId, userId)
      const eventCtx = extractEventContext(parsed);

      // Redis-based idempotency check (opt-in)
      if (idempotencyEnabled && correlationId) {
        const result = await checkIdempotency(redis, config, logger);
        if (result.isDuplicate) {
          await ctx.ack();
          return;  // Skip duplicate message
        }
      }

      // Execute handler with EventContext
      await runWithEventContext(eventCtx, () =>
        Promise.resolve(handler(parsed, attributes, ctx))
      );
    },
    { queue, ack }
  );

  this.unsubscribers.push(unsubscribe);
}
```

**Features:**
- ✅ **Automatic Driver Selection**: Based on `MESSAGE_BUS_DRIVER` env var
- ✅ **BUS_PREFIX Support**: Namespace isolation for multi-environment
- ✅ **Queue Groups**: Default to `serviceName` for competing consumers
- ✅ **EventContext Propagation**: Distributed tracing and correlation
- ✅ **Redis Idempotency**: Optional duplicate detection (Sprint 1)
- ✅ **Graceful Shutdown**: Tracked unsubscribers for clean teardown

---

## 2. Current Usage Patterns

### 2.1 Service Dependencies

**All 17 active services depend on NATS:**

```yaml
# Sample from docker-compose.local.yaml
depends_on:
  nats:
    condition: "service_healthy"
```

**Service Breakdown:**
- **Platform Services**: 11 services (ingress-egress, event-router, llm-bot, persistence, etc.)
- **Domain Services**: 6 services (scheduler, obs-mcp, image-gen-mcp, story-engine-mcp, etc.)
- **Total**: 17 services all depend on NATS availability

### 2.2 Topic Patterns

**Source:** architecture.yaml:336-459

**Topic Categories:**

| Category | Topics | Purpose |
|----------|--------|---------|
| **Ingress** | `internal.ingress.v1` | Normalized external events |
| **Enrichment** | `internal.enriched.v1`, `internal.auth.v1`, `internal.contextualization.v1` | Event enrichment stages |
| **Analysis** | `internal.query.analysis.v1`, `internal.llmbot.v1`, `internal.analysis.v1` | LLM and reasoning |
| **Reaction** | `internal.reflex.v1`, `internal.state.mutation.v1`, `internal.reaction.v1` | Actions and mutations |
| **Egress** | `internal.egress.v1`, `internal.api.egress.v1` | Response delivery |
| **Persistence** | `internal.persistence.snapshot.v1`, `internal.persistence.finalize.v1` | Durable storage |
| **Dead Letter** | `internal.deadletter.v1`, `internal.router.dlq.v1` | Error handling |
| **MCP** | `internal.mcp.registration.v1` | Service discovery |

**Naming Convention:**
- Format: `internal.<domain>.<verb>.v<version>`
- Examples: `internal.ingress.v1`, `internal.llmbot.v1`, `internal.egress.v1`
- BUS_PREFIX: Optional environment prefix (e.g., `local.`, `staging.`)

### 2.3 Message Flow Example

**Typical Event Flow Through NATS:**

```
1. External Event (Twitch chat)
   ↓
2. ingress-egress → publishes to internal.ingress.v1
   ↓
3. event-router subscribes to internal.ingress.v1
   ↓
4. event-router → publishes to internal.auth.v1 (routing slip)
   ↓
5. auth → enriches event → publishes to internal.enriched.v1
   ↓
6. event-router → publishes to internal.llmbot.v1
   ↓
7. llm-bot → processes → publishes to internal.enriched.v1
   ↓
8. event-router → publishes to internal.egress.v1
   ↓
9. ingress-egress → delivers response to Twitch
   ↓
10. persistence → captures snapshots to PostgreSQL
```

**Per-Instance Topics:**

For services with singleton connections (ingress-egress, api-gateway):

```
internal.egress.v1.{instanceId}  // Instance-specific routing
```

Resolved from: `K_REVISION || EGRESS_INSTANCE_ID || SERVICE_INSTANCE_ID || HOSTNAME`

### 2.4 Delivery Guarantees

**At-Least-Once Delivery:**

```typescript
// Source: architecture.yaml:86
deliveryGuarantee: at-least-once
maxRetries: 5
```

**Idempotency Strategies:**

1. **In-Memory Dedupe** (src/services/message-bus/dedupe.ts):
   ```typescript
   const key = buildDedupeKey(attrs, streamSequence);
   if (dedupeShouldDrop(key, Date.now())) {
     await ack();
     continue;  // Drop duplicate
   }
   ```

2. **Redis Idempotency** (Sprint 1, src/common/idempotency-middleware.ts):
   ```typescript
   const config: IdempotencyConfig = {
     topic: destination,
     correlationId,
     source: serviceName,
     ttlSeconds: 60  // Default TTL
   };
   const result = await checkIdempotency(redis, config, logger);
   if (result.isDuplicate) {
     await ctx.ack();
     return;  // Skip processing
   }
   ```

3. **Correlation-Based** (Envelope v1):
   ```typescript
   const dedupeKey = sha256(correlationId + stepId + attempt);
   ```

---

## 3. Current Limitations and Issues

### 3.1 Single Stream Per Topic Domain

**Issue:** Current implementation uses one stream per top-level domain (`internal-ingress`, `internal-egress`, etc.)

**Impact:**
- ❌ All subjects under `internal.ingress.>` share the same stream
- ❌ Cannot configure different retention/limits per sub-topic
- ❌ Limited observability granularity

**Example:**
```typescript
// All of these share the same stream:
internal.ingress.v1
internal.ingress.v2
internal.ingress.debug.v1
```

**Recommendation:**
Consider migrating to **per-topic streams** for production workloads:
```yaml
streams:
  - name: internal-ingress-v1
    subjects: ['internal.ingress.v1']
    retention: 'limits'
    max_age: 86400_000_000_000  # 24 hours

  - name: internal-ingress-debug-v1
    subjects: ['internal.ingress.debug.v1']
    retention: 'limits'
    max_age: 3600_000_000_000   # 1 hour (shorter retention for debug)
```

### 3.2 No Clustering or High Availability

**Configuration:** architecture.yaml:217

```yaml
retention: 604800      # 7-day retention
replicas: 1            # Single replica (no HA)
```

**Impact:**
- ❌ Single point of failure for local development
- ❌ No automatic failover
- ❌ Data loss on catastrophic failure

**Mitigation:**
- ✅ Acceptable for local/development environments
- ⚠️ Would require clustering for production NATS deployment
- ✅ Currently mitigated by using Cloud Pub/Sub in production

**Production Recommendation:**
```yaml
# For production NATS deployment (if not using Pub/Sub)
replicas: 3            # 3-node cluster
cluster:
  name: bitbrat-cluster
  routes:
    - nats://nats-1:6222
    - nats://nats-2:6222
    - nats://nats-3:6222
```

### 3.3 Fixed Message Payload Limits

**Configuration:** architecture.yaml:216

```yaml
maxPayload: 10485760   # 10MB max message size
```

**Impact:**
- ⚠️ Large payloads (e.g., LLM responses, image data) may exceed limit
- ⚠️ No automatic chunking or overflow handling

**Mitigation:**
Current workarounds:
1. **External Storage**: Store large payloads in PostgreSQL/GCS, pass reference
2. **Compression**: Gzip payloads before publishing
3. **Streaming**: Use chunked responses for LLM outputs

**Recommendation:**
- ✅ 10MB is generous for event metadata
- ✅ Continue using external storage for large artifacts
- 🎯 **Opportunity**: Leverage NATS Object Store for automatic chunking (see §5.3)

### 3.4 No Stream Limits Enforcement

**Configuration:** tools/init-nats-streams.ts:71-77

```yaml
storage: 'file'
retention: 'limits'
max_age: 86400_000_000_000  # 24 hours
# Missing: max_msgs, max_bytes, max_msg_size
```

**Impact:**
- ⚠️ Streams can grow unbounded (limited only by `NATS_JETSTREAM_MAX_FILE: 10Gi`)
- ⚠️ No per-stream storage quotas
- ⚠️ Potential disk exhaustion in high-throughput scenarios

**Recommendation:**
Add stream limits:
```typescript
const DEFAULT_STREAM_CONFIG = {
  storage: 'file',
  retention: 'limits',
  max_age: 86400_000_000_000,    // 24 hours
  max_msgs: 1_000_000,           // 1M messages per stream
  max_bytes: 1_073_741_824,      // 1GB per stream
  max_msg_size: 10_485_760,      // 10MB per message
  discard: 'old',
};
```

### 3.5 Monitoring and Observability Gaps

**Current State:**
- ✅ HTTP monitoring API available on port 8222
- ✅ Health checks via `/varz` and `/healthz`
- ❌ No metrics export to Prometheus/Cloud Monitoring
- ❌ No dashboards for stream depth, consumer lag, throughput
- ❌ No alerting on stream exhaustion or consumer stalls

**Available Endpoints (unused):**
```
http://localhost:8222/varz        # Server stats
http://localhost:8222/connz       # Connection stats
http://localhost:8222/jsz         # JetStream stats
http://localhost:8222/streamz     # Stream-level stats
http://localhost:8222/consumerz   # Consumer-level stats
```

**Recommendation:**
1. Add NATS Prometheus exporter to docker-compose
2. Create Grafana dashboard for stream metrics
3. Alert on consumer lag > threshold

---

## 4. Advanced NATS Features Not Currently Used

### 4.1 NATS KV (Key-Value Store)

**Capability:** Distributed key-value store built on JetStream

**Use Cases in BitBrat:**

#### 1. Distributed Configuration
```typescript
// Instead of PostgreSQL for simple config lookups
const kv = await js.views.kv('config');
await kv.put('llm.provider', 'openai');
await kv.put('llm.model', 'gpt-4');

const entry = await kv.get('llm.provider');
console.log(entry.string());  // 'openai'
```

**Benefits:**
- ✅ Sub-millisecond reads (in-memory cache)
- ✅ Built-in versioning and history
- ✅ Watch API for real-time config updates
- ✅ No external database dependency

#### 2. Service Discovery Registry
```typescript
// MCP server registration (alternative to internal.mcp.registration.v1)
const kv = await js.views.kv('mcp-registry');

// Register service
await kv.put(`service.tool-gateway`, JSON.stringify({
  host: 'tool-gateway.bitbrat.local',
  port: 3008,
  exposure: 'platform+domain',
  registeredAt: new Date().toISOString()
}));

// Watch for new services
const watch = await kv.watch({ key: 'service.*' });
for await (const entry of watch) {
  console.log(`Service updated: ${entry.key}`);
}
```

#### 3. Feature Flag Management
```typescript
// Dynamic feature flags without database round-trips
const kv = await js.views.kv('feature-flags');
await kv.put('llm.streaming.enabled', 'true');
await kv.put('reflex.cache.enabled', 'true');

// Fast reads with TTL
const flag = await kv.get('llm.streaming.enabled');
if (flag.string() === 'true') {
  // Enable streaming
}
```

### 4.2 NATS Object Store

**Capability:** S3-like object storage built on JetStream with automatic chunking

**Use Cases in BitBrat:**

#### 1. Large LLM Responses
```typescript
// Instead of splitting large responses manually
const os = await js.views.os('llm-artifacts');

// Store large response (auto-chunked)
await os.put({
  name: `response-${correlationId}`,
  data: largeResponseBuffer,
  meta: { correlationId, model: 'gpt-4', tokenCount: 8000 }
});

// Retrieve (auto-assembled)
const info = await os.get(`response-${correlationId}`);
const response = await info.data;
```

**Benefits:**
- ✅ Automatic chunking for payloads > 10MB
- ✅ No external blob storage needed for development
- ✅ Built-in versioning and metadata
- ✅ TTL support for automatic cleanup

#### 2. Image Generation Artifacts
```typescript
// Store generated images with metadata
const os = await js.views.os('image-artifacts');

await os.put({
  name: `image-${correlationId}.png`,
  data: imageBuffer,
  meta: {
    prompt: 'a cat riding a bicycle',
    model: 'dall-e-3',
    size: '1024x1024',
    generatedAt: new Date().toISOString()
  }
});

// Later retrieval
const info = await os.get(`image-${correlationId}.png`);
const imageData = await info.data;
const metadata = info.info.metadata;
```

### 4.3 Request-Reply Pattern

**Capability:** Synchronous request-reply over async messaging

**Use Cases in BitBrat:**

#### 1. Synchronous MCP Tool Calls
```typescript
// Current: Async pub-sub with correlation
// Future: Synchronous request-reply

// Server side (tool-gateway)
const sub = nc.subscribe('mcp.tool.call');
for await (const msg of sub) {
  const request = JSON.parse(sc.decode(msg.data));
  const result = await executeTool(request.tool, request.args);
  msg.respond(sc.encode(JSON.stringify(result)));
}

// Client side (llm-bot)
const response = await nc.request('mcp.tool.call', sc.encode(JSON.stringify({
  tool: 'tavily.search',
  args: { query: 'weather in SF' }
})), { timeout: 5000 });
const result = JSON.parse(sc.decode(response.data));
```

**Benefits:**
- ✅ Simpler than pub-sub for synchronous operations
- ✅ Automatic timeout handling
- ✅ Built-in backpressure
- ✅ No correlation ID management needed

#### 2. Health Checks and Diagnostics
```typescript
// Synchronous health checks
const health = await nc.request('bit.health.check.llm-bot', empty, { timeout: 1000 });
const status = JSON.parse(sc.decode(health.data));

if (status.ok) {
  console.log('llm-bot is healthy');
}
```

### 4.4 Stream Mirroring and Sourcing

**Capability:** Replicate streams across NATS clusters or aggregate from multiple sources

**Use Cases in BitBrat:**

#### 1. Multi-Environment Event Aggregation
```yaml
# Aggregate events from multiple environments
streams:
  - name: aggregated-ingress
    sources:
      - name: local-ingress
        filter_subject: 'local.internal.ingress.>'
      - name: staging-ingress
        filter_subject: 'staging.internal.ingress.>'
```

#### 2. Cross-Cluster Persistence
```yaml
# Mirror production events to disaster recovery cluster
streams:
  - name: prod-ingress-mirror
    mirror:
      name: prod-ingress
      external:
        api: nats://prod-cluster:4222
```

### 4.5 Supercluster (Global Distribution)

**Capability:** Geo-distributed NATS with multi-region replication

**Use Case:** Multi-region BitBrat deployment with local event processing

```
US-West Cluster       US-East Cluster       EU Cluster
    |                      |                     |
    +----------------------+---------------------+
              |
         Supercluster
              |
    Global Event Routing
```

**Benefits:**
- ✅ Low-latency local processing
- ✅ Global event visibility
- ✅ Disaster recovery
- ✅ Compliance (data residency)

---

## 5. Opportunities for Enhancement

### 5.1 Migration Strategy: Hybrid KV + Pub/Sub

**Proposal:** Use NATS KV for hot-path configuration while retaining Pub/Sub for events

```typescript
// Architecture:
// - NATS KV: Configuration, feature flags, service discovery (local cache)
// - NATS Pub/Sub: Event streams (local dev)
// - Cloud Pub/Sub: Event streams (production)
// - PostgreSQL: Durable persistence (all environments)

class HybridConfigManager {
  private kv: KV;
  private db: PostgreSQL;

  async getConfig(key: string): Promise<string> {
    // Try KV first (sub-ms)
    try {
      const entry = await this.kv.get(key);
      return entry.string();
    } catch {
      // Fallback to PostgreSQL
      return await this.db.query('SELECT value FROM config WHERE key = $1', [key]);
    }
  }

  async updateConfig(key: string, value: string): Promise<void> {
    // Write to both KV and PostgreSQL
    await Promise.all([
      this.kv.put(key, value),
      this.db.query('INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value])
    ]);
  }
}
```

**Benefits:**
- ✅ **10-100x faster config reads** (in-memory KV vs PostgreSQL)
- ✅ **Real-time updates** via KV watch API
- ✅ **Durable fallback** to PostgreSQL
- ✅ **No breaking changes** to existing code

### 5.2 Stream-Specific Retention Policies

**Proposal:** Differentiated retention per topic based on data value

```typescript
const OPTIMIZED_STREAMS: StreamDefinition[] = [
  // High-value: Long retention
  {
    name: 'internal-ingress-v1',
    subjects: ['internal.ingress.v1'],
    retention: 'limits',
    max_age: 604800_000_000_000,  // 7 days
    max_bytes: 5_368_709_120,      // 5GB
  },

  // Medium-value: Standard retention
  {
    name: 'internal-analysis-v1',
    subjects: ['internal.analysis.v1'],
    retention: 'limits',
    max_age: 86400_000_000_000,   // 24 hours
    max_bytes: 1_073_741_824,     // 1GB
  },

  // Low-value: Short retention
  {
    name: 'internal-deadletter-v1',
    subjects: ['internal.deadletter.v1'],
    retention: 'limits',
    max_age: 3600_000_000_000,    // 1 hour
    max_bytes: 536_870_912,       // 512MB
  },

  // Debug: Minimal retention
  {
    name: 'internal-debug-v1',
    subjects: ['internal.debug.>'],
    retention: 'limits',
    max_age: 300_000_000_000,     // 5 minutes
    max_bytes: 104_857_600,       // 100MB
  },
];
```

**Benefits:**
- ✅ **Optimized storage usage** (70-80% reduction)
- ✅ **Faster stream operations** (smaller streams)
- ✅ **Clear data lifecycle** (explicit retention per value tier)

### 5.3 Object Store for Large Artifacts

**Proposal:** Replace inline payload encoding with NATS Object Store references

**Before (Current):**
```typescript
// LLM response stored inline in message (may exceed 10MB)
await publisher.publishJson({
  correlationId,
  type: 'llm.response.v1',
  payload: {
    text: largeResponse,  // 50KB - 10MB
    model: 'gpt-4',
    tokenCount: 8000
  }
});
```

**After (With Object Store):**
```typescript
// Store large response in Object Store
const os = await js.views.os('llm-artifacts');
const objectName = `response-${correlationId}`;
await os.put({
  name: objectName,
  data: Buffer.from(largeResponse),
  meta: { model: 'gpt-4', tokenCount: 8000 }
});

// Publish lightweight reference
await publisher.publishJson({
  correlationId,
  type: 'llm.response.v1',
  payload: {
    objectStore: 'llm-artifacts',
    objectName,
    sizeBytes: largeResponse.length
  }
});

// Consumer retrieves on-demand
const info = await os.get(objectName);
const largeResponse = (await info.data).toString();
```

**Benefits:**
- ✅ **No payload size limits** (auto-chunked)
- ✅ **Reduced stream storage** (references vs full data)
- ✅ **Lazy loading** (fetch only when needed)
- ✅ **Automatic cleanup** (TTL on objects)

### 5.4 Request-Reply for MCP Tool Gateway

**Proposal:** Replace async pub-sub with synchronous request-reply for tool calls

**Before (Current Async Pub/Sub):**
```typescript
// llm-bot publishes tool request
await publisher.publishJson({
  correlationId,
  type: 'mcp.tool.request.v1',
  replyTo: 'internal.llmbot.v1',
  payload: { tool: 'tavily.search', args: { query: 'weather' } }
});

// llm-bot subscribes to replyTo topic
await subscriber.subscribe('internal.llmbot.v1', async (data) => {
  if (data.correlationId === correlationId) {
    // Handle response
  }
});
```

**After (Request-Reply):**
```typescript
// Synchronous request-reply
const response = await nc.request(
  'mcp.tool.tavily.search',
  sc.encode(JSON.stringify({ query: 'weather' })),
  { timeout: 5000 }
);
const result = JSON.parse(sc.decode(response.data));
```

**Benefits:**
- ✅ **50% less code** (no correlation management)
- ✅ **Automatic timeout handling**
- ✅ **Simpler error handling** (no orphaned requests)
- ✅ **Better backpressure** (built-in flow control)

### 5.5 Monitoring and Observability

**Proposal:** Add comprehensive NATS monitoring stack

**Docker Compose Addition:**
```yaml
# infrastructure/docker-compose/observability/docker-compose.observability.yaml
services:
  nats-exporter:
    image: natsio/prometheus-nats-exporter:latest
    command:
      - "-varz"
      - "-connz"
      - "-jsz=all"
      - "-channelz"
      - "http://nats:8222"
    ports:
      - "7777:7777"
    networks:
      - bitbrat-network

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
    networks:
      - bitbrat-network

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
    volumes:
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3001:3000"
    networks:
      - bitbrat-network
```

**Metrics to Track:**
- Stream depth (messages waiting)
- Consumer lag (time behind head)
- Throughput (msg/sec, bytes/sec)
- Ack latency (p50, p95, p99)
- Redelivery rate
- Storage usage per stream

**Alerting Rules:**
```yaml
# prometheus-alerts.yml
groups:
  - name: nats-jetstream
    rules:
      - alert: StreamDepthHigh
        expr: nats_stream_messages > 10000
        for: 5m
        annotations:
          summary: "Stream {{ $labels.stream }} has high depth"

      - alert: ConsumerLagHigh
        expr: nats_consumer_pending > 1000
        for: 2m
        annotations:
          summary: "Consumer {{ $labels.consumer }} is lagging"

      - alert: RedeliveryRateHigh
        expr: rate(nats_consumer_redelivered[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High redelivery rate for {{ $labels.consumer }}"
```

---

## 6. Production Deployment Considerations

### 6.1 When to Use NATS vs Cloud Pub/Sub

**Current Strategy:** NATS (local/dev), Cloud Pub/Sub (production)

**Decision Matrix:**

| Factor | NATS JetStream | Cloud Pub/Sub |
|--------|---------------|---------------|
| **Latency** | <1ms (local) | 10-50ms (network) |
| **Cost** | $0 (self-hosted) | ~$40/TB ingress + egress |
| **Ops Burden** | High (self-managed) | Low (fully managed) |
| **Clustering** | Manual setup | Auto-scaled |
| **Monitoring** | Custom (Prometheus) | Built-in (Cloud Monitoring) |
| **Max Throughput** | ~10K msg/sec/node | Unlimited (auto-scale) |
| **Geo-Distribution** | Supercluster | Global by default |

**Recommendation:**
- ✅ **Keep current strategy**: NATS for dev, Pub/Sub for production
- 🎯 **Consider NATS for edge deployments**: Self-hosted with local processing
- 🎯 **Evaluate NATS for hybrid cloud**: Multi-cloud or on-prem requirements

### 6.2 NATS Clustering for Production

**If deploying NATS in production, use 3-node cluster:**

```yaml
# docker-compose.prod.yaml (example)
services:
  nats-1:
    image: nats:2-alpine
    command:
      - "-js"
      - "-sd"
      - "/data"
      - "-cluster"
      - "nats://0.0.0.0:6222"
      - "-routes"
      - "nats://nats-2:6222,nats://nats-3:6222"
    volumes:
      - nats-1-data:/data

  nats-2:
    image: nats:2-alpine
    command:
      - "-js"
      - "-sd"
      - "/data"
      - "-cluster"
      - "nats://0.0.0.0:6222"
      - "-routes"
      - "nats://nats-1:6222,nats://nats-3:6222"
    volumes:
      - nats-2-data:/data

  nats-3:
    image: nats:2-alpine
    command:
      - "-js"
      - "-sd"
      - "/data"
      - "-cluster"
      - "nats://0.0.0.0:6222"
      - "-routes"
      - "nats://nats-1:6222,nats://nats-2:6222"
    volumes:
      - nats-3-data:/data
```

**Stream Configuration for HA:**
```typescript
{
  name: 'internal-ingress-v1',
  subjects: ['internal.ingress.v1'],
  replicas: 3,  // Data replicated across all 3 nodes
  retention: 'limits',
  max_age: 86400_000_000_000
}
```

### 6.3 Security Hardening

**Current:** No authentication, suitable for isolated Docker network

**Production Recommendations:**

1. **Enable NKey Authentication:**
```bash
# Generate NKeys
nsc add account bitbrat
nsc add user -a bitbrat ingress-egress
nsc add user -a bitbrat event-router
nsc add user -a bitbrat llm-bot
```

2. **TLS Encryption:**
```yaml
nats:
  command:
    - "-js"
    - "-tls"
    - "-tlscert=/certs/server-cert.pem"
    - "-tlskey=/certs/server-key.pem"
    - "-tlscacert=/certs/ca-cert.pem"
```

3. **Authorization (Per-Service Permissions):**
```
# ingress-egress user
publish: internal.ingress.>
subscribe: internal.egress.>

# event-router user
subscribe: internal.ingress.>, internal.enriched.>
publish: internal.*.>

# llm-bot user
subscribe: internal.llmbot.>
publish: internal.enriched.>
```

---

## 7. Migration Roadmap

### Phase 1: Monitoring and Observability (Sprint 1-2)

**Goal:** Gain visibility into current NATS usage

**Tasks:**
1. Add NATS Prometheus exporter to docker-compose
2. Create Grafana dashboards for:
   - Stream depth and consumer lag
   - Throughput (msg/sec, bytes/sec)
   - Redelivery rates
3. Set up alerting for anomalies
4. Baseline current metrics

**Deliverables:**
- Monitoring stack in `infrastructure/docker-compose/observability/`
- Grafana dashboards in `documentation/dashboards/nats/`
- Runbook for interpreting metrics

### Phase 2: Stream Optimization (Sprint 3-4)

**Goal:** Optimize stream configuration for efficiency

**Tasks:**
1. Audit current stream usage (depth, throughput, retention needs)
2. Implement differentiated retention policies
3. Add stream limits (max_msgs, max_bytes)
4. Create stream management CLI commands in `brat`

**Deliverables:**
- Updated `tools/init-nats-streams.ts` with optimized configs
- Stream usage report
- `brat stream stats` command

### Phase 3: KV for Configuration (Sprint 5-6)

**Goal:** Replace PostgreSQL for hot-path configuration

**Tasks:**
1. Implement `ConfigManager` with KV + PostgreSQL fallback
2. Migrate feature flags to KV
3. Migrate MCP service registry to KV
4. Add KV watch API for real-time config updates

**Deliverables:**
- `src/common/resources/kv-manager.ts`
- Migration guide for config keys
- Performance comparison report

### Phase 4: Object Store for Large Artifacts (Sprint 7-8)

**Goal:** Eliminate payload size limitations

**Tasks:**
1. Implement `ArtifactManager` using NATS Object Store
2. Migrate LLM responses to Object Store
3. Migrate image generation artifacts
4. Add automatic cleanup (TTL)

**Deliverables:**
- `src/common/resources/object-store-manager.ts`
- Updated LLM bot service
- Storage usage comparison

### Phase 5: Request-Reply for MCP (Sprint 9-10)

**Goal:** Simplify synchronous tool calls

**Tasks:**
1. Evaluate request-reply performance vs pub-sub
2. Implement request-reply wrapper in `tool-gateway`
3. Migrate MCP tool calls to request-reply
4. Update LLM bot to use request-reply

**Deliverables:**
- Request-reply adapter
- Performance comparison
- Updated tool-gateway and llm-bot

---

## 8. Code Examples

### 8.1 Adding KV-Based Configuration

**Implementation:**

```typescript
// src/common/resources/kv-manager.ts
import { connect, KV } from 'nats';
import type { ResourceManager } from './types';

export interface KVResource {
  kv: KV;
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  watch(key: string, handler: (value: string) => void): Promise<void>;
}

export class KVManager implements ResourceManager<KVResource> {
  async setup(ctx: SetupContext): Promise<KVResource> {
    const nc = await connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222'
    });
    const js = nc.jetstream();
    const kv = await js.views.kv('bitbrat-config', {
      history: 10,  // Keep last 10 versions
      ttl: 0        // No expiration
    });

    return {
      kv,
      async get(key: string): Promise<string | undefined> {
        try {
          const entry = await kv.get(key);
          return entry.string();
        } catch {
          return undefined;
        }
      },
      async put(key: string, value: string): Promise<void> {
        await kv.put(key, value);
      },
      async watch(key: string, handler: (value: string) => void): Promise<void> {
        const watch = await kv.watch({ key });
        for await (const entry of watch) {
          if (!entry) continue;
          handler(entry.string());
        }
      }
    };
  }

  async shutdown(instance: KVResource): Promise<void> {
    // KV is backed by JetStream connection, will be closed on nc.close()
  }
}

// Usage in BaseServer
class MyBit extends Bit {
  constructor() {
    super({
      resources: {
        kv: new KVManager()
      }
    });
  }

  async setup(): Promise<void> {
    const kv = this.getResource<KVResource>('kv');

    // Read config
    const provider = await kv.get('llm.provider');
    console.log(`LLM Provider: ${provider}`);

    // Watch for updates
    await kv.watch('llm.provider', (value) => {
      console.log(`LLM Provider updated to: ${value}`);
      this.reconfigureLLM(value);
    });
  }
}
```

### 8.2 Using Object Store for Large Responses

**Implementation:**

```typescript
// src/common/resources/object-store-manager.ts
import { connect, ObjectStore } from 'nats';
import type { ResourceManager } from './types';

export interface ObjectStoreResource {
  os: ObjectStore;
  put(name: string, data: Buffer, metadata?: Record<string, string>): Promise<void>;
  get(name: string): Promise<{ data: Buffer; metadata?: Record<string, string> }>;
  delete(name: string): Promise<void>;
}

export class ObjectStoreManager implements ResourceManager<ObjectStoreResource> {
  async setup(ctx: SetupContext): Promise<ObjectStoreResource> {
    const nc = await connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222'
    });
    const js = nc.jetstream();
    const os = await js.views.os('bitbrat-artifacts', {
      storage: 'file',
      max_bytes: 10_737_418_240,  // 10GB total storage
      ttl: 86400_000_000_000       // 24-hour TTL
    });

    return {
      os,
      async put(name: string, data: Buffer, metadata?: Record<string, string>): Promise<void> {
        await os.put({ name, data, meta: metadata });
      },
      async get(name: string): Promise<{ data: Buffer; metadata?: Record<string, string> }> {
        const info = await os.get(name);
        const data = await info.data;
        return {
          data: Buffer.from(data),
          metadata: info.info.metadata
        };
      },
      async delete(name: string): Promise<void> {
        await os.delete(name);
      }
    };
  }

  async shutdown(instance: ObjectStoreResource): Promise<void> {
    // Object Store is backed by JetStream connection
  }
}

// Usage in LLM Bot
class LLMBotService extends Bit {
  async handleLLMRequest(event: InternalEventV2): Promise<void> {
    const os = this.getResource<ObjectStoreResource>('objectStore');

    // Generate large LLM response
    const largeResponse = await this.callLLM(event.payload.prompt);

    if (largeResponse.length > 100_000) {  // > 100KB
      // Store in Object Store
      const objectName = `llm-response-${event.correlationId}`;
      await os.put(objectName, Buffer.from(largeResponse), {
        model: 'gpt-4',
        tokenCount: String(largeResponse.length / 4),
        correlationId: event.correlationId
      });

      // Publish lightweight reference
      await this.next({
        ...event,
        payload: {
          responseRef: {
            objectStore: 'bitbrat-artifacts',
            objectName,
            sizeBytes: largeResponse.length
          }
        }
      });
    } else {
      // Small response, include inline
      await this.next({
        ...event,
        payload: { text: largeResponse }
      });
    }
  }
}
```

### 8.3 Request-Reply for MCP Tool Calls

**Implementation:**

```typescript
// src/apps/tool-gateway.ts (server side)
class ToolGateway extends Bit {
  async setup(): Promise<void> {
    const nc = await connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222'
    });

    // Register request-reply handler for each tool
    for (const tool of this.tools) {
      const sub = nc.subscribe(`mcp.tool.${tool.name}`);

      (async () => {
        for await (const msg of sub) {
          const request = JSON.parse(sc.decode(msg.data));

          try {
            const result = await this.executeTool(tool.name, request.args);
            msg.respond(sc.encode(JSON.stringify({ ok: true, result })));
          } catch (error: any) {
            msg.respond(sc.encode(JSON.stringify({
              ok: false,
              error: error.message
            })));
          }
        }
      })();
    }
  }
}

// src/apps/llm-bot-service.ts (client side)
class LLMBotService extends Bit {
  private nc!: NatsConnection;

  async setup(): Promise<void> {
    this.nc = await connect({
      servers: process.env.NATS_URL || 'nats://localhost:4222'
    });
  }

  async callTool(toolName: string, args: unknown): Promise<unknown> {
    // Synchronous request-reply (no correlation ID needed!)
    const response = await this.nc.request(
      `mcp.tool.${toolName}`,
      sc.encode(JSON.stringify({ args })),
      { timeout: 5000 }  // 5s timeout
    );

    const result = JSON.parse(sc.decode(response.data));

    if (!result.ok) {
      throw new Error(`Tool call failed: ${result.error}`);
    }

    return result.result;
  }
}
```

---

## 9. Testing and Validation

### 9.1 Current Test Coverage

**Test Files:**
- `src/services/message-bus/nats-driver.test.ts` (91 lines)
- `tests/services/message-bus/nats-attributes.spec.ts`
- `tests/services/message-bus/nats-flush.spec.ts`
- `tests/services/message-bus/nats-logging.spec.ts`

**Coverage:**
- ✅ Publisher header encoding
- ✅ Subscriber deliverTo + queue behavior
- ✅ Flush operations
- ✅ Attribute normalization
- ❌ **Missing**: Integration tests with real NATS
- ❌ **Missing**: Performance benchmarks
- ❌ **Missing**: Failure scenario tests (network partition, node failure)

### 9.2 Recommended Test Additions

**Integration Test Suite:**

```typescript
// tests/integration/nats-jetstream.integration.test.ts
describe('NATS JetStream Integration', () => {
  let nc: NatsConnection;
  let js: JetStreamClient;

  beforeAll(async () => {
    nc = await connect({ servers: 'nats://localhost:4222' });
    js = nc.jetstream();
  });

  afterAll(async () => {
    await nc.close();
  });

  it('should handle message redelivery correctly', async () => {
    const subject = 'test.redelivery';
    let attempts = 0;

    const sub = await js.subscribe(subject, consumerOpts()
      .durable('test-consumer')
      .ackWait(1000)  // 1s ack-wait
    );

    // Publish message
    await js.publish(subject, sc.encode('test'));

    // Don't ack first delivery
    for await (const msg of sub) {
      attempts++;
      if (attempts === 1) {
        // Don't ack, should redeliver
        continue;
      } else if (attempts === 2) {
        // Verify redelivery
        expect(msg.info.redelivered).toBe(true);
        expect(msg.info.deliveryCount).toBe(2);
        msg.ack();
        break;
      }
    }
  });

  it('should enforce stream limits', async () => {
    const stream = await js.streams.add({
      name: 'test-limits',
      subjects: ['test.limits'],
      max_msgs: 10,
      discard: 'old'
    });

    // Publish 15 messages
    for (let i = 0; i < 15; i++) {
      await js.publish('test.limits', sc.encode(`msg-${i}`));
    }

    const info = await js.streams.info('test-limits');
    expect(info.state.messages).toBe(10);  // Should retain only 10
  });
});
```

**Performance Benchmark:**

```typescript
// tests/benchmarks/nats-throughput.bench.ts
describe('NATS Throughput Benchmark', () => {
  it('should handle 10K msg/sec', async () => {
    const nc = await connect({ servers: 'nats://localhost:4222' });
    const js = nc.jetstream();

    const messageCount = 10_000;
    const payload = Buffer.alloc(1024);  // 1KB messages

    const start = Date.now();

    for (let i = 0; i < messageCount; i++) {
      await js.publish('test.throughput', payload);
    }

    await nc.flush();
    const duration = Date.now() - start;
    const throughput = messageCount / (duration / 1000);

    console.log(`Throughput: ${throughput.toFixed(0)} msg/sec`);
    expect(throughput).toBeGreaterThan(5000);  // At least 5K msg/sec
  });
});
```

---

## 10. Summary and Recommendations

### 10.1 Current State Assessment

**Strengths:**
- ✅ **Solid foundation**: Well-architected driver abstraction
- ✅ **Robust delivery**: Durable consumers, ack-wait, idempotency
- ✅ **Good practices**: Queue groups, explicit ack, redelivery handling
- ✅ **Operational simplicity**: Single container, file-backed persistence

**Weaknesses:**
- ⚠️ **Underutilized**: Advanced NATS features not leveraged
- ⚠️ **Limited monitoring**: No metrics export or dashboards
- ⚠️ **No stream limits**: Risk of unbounded growth
- ⚠️ **Single replica**: No HA for local deployments

### 10.2 Top 3 Quick Wins

1. **Add Monitoring** (1-2 days)
   - Add NATS Prometheus exporter
   - Create basic Grafana dashboard
   - **Impact**: Immediate visibility into stream health

2. **Implement Stream Limits** (1 day)
   - Add `max_msgs`, `max_bytes` to stream configs
   - **Impact**: Prevent disk exhaustion

3. **KV for Feature Flags** (2-3 days)
   - Migrate feature flags from PostgreSQL to KV
   - **Impact**: 10-100x faster reads, real-time updates

### 10.3 Long-Term Recommendations

**Do:**
- ✅ Continue using NATS for local/dev environments
- ✅ Implement KV for hot-path configuration
- ✅ Use Object Store for large artifacts (LLM responses, images)
- ✅ Add comprehensive monitoring and alerting
- ✅ Implement differentiated retention policies

**Don't:**
- ❌ Replace Cloud Pub/Sub in production (unless cost/compliance requires)
- ❌ Deploy NATS without clustering in production
- ❌ Store sensitive data in KV without encryption
- ❌ Exceed 10MB payloads (use Object Store instead)

**Consider:**
- 🎯 Request-reply for synchronous MCP tool calls (reduces complexity)
- 🎯 NATS Supercluster for multi-region deployments
- 🎯 Stream mirroring for disaster recovery
- 🎯 NKey authentication for production deployments

### 10.4 Final Verdict

**BitBrat's current NATS implementation is production-ready for local/development environments.** The driver abstraction is well-designed, and the core pub-sub patterns are solid. However, **significant value is being left on the table** by not leveraging NATS-native features like KV, Object Store, and request-reply.

**Recommendation:** Follow the phased migration roadmap (§7) to incrementally adopt advanced NATS features while maintaining the current driver abstraction. This will:
- ✅ Improve performance (10-100x faster config reads)
- ✅ Reduce complexity (simpler tool calls with request-reply)
- ✅ Eliminate payload limits (Object Store auto-chunking)
- ✅ Enhance observability (comprehensive monitoring)

All while **maintaining compatibility** with the existing Cloud Pub/Sub production deployment.

---

## References

- **NATS Documentation**: https://docs.nats.io/
- **JetStream Guide**: https://docs.nats.io/nats-concepts/jetstream
- **KV Store**: https://docs.nats.io/nats-concepts/jetstream/key-value-store
- **Object Store**: https://docs.nats.io/nats-concepts/jetstream/obj_store
- **BitBrat Messaging System**: documentation/reference/messaging-system.md
- **Architecture YAML**: architecture.yaml
- **NATS Driver**: src/services/message-bus/nats-driver.ts
- **Stream Init**: tools/init-nats-streams.ts

---

**Document Status:** ✅ Complete
**Next Review:** Sprint 400 (after monitoring implementation)
**Owner:** Platform Architecture Team
