# Redis-Based Idempotency Layer for Bit Messaging Framework

**Sprint:** sprint-1-9ih2e3 (Research)
**Owner:** Lead Implementor
**Created:** 2026-08-06

---

## Executive Summary

Design a **distributed, configurable idempotency layer** using Redis that integrates seamlessly into the Bit messaging framework. This provides automatic deduplication of messages across service restarts and multiple instances without requiring application-level implementation.

**Key Properties:**
- ✅ **Temporal:** TTL-based expiration (seconds to minutes, not permanent)
- ✅ **Distributed:** Works across multiple service instances
- ✅ **High-volume:** Redis handles millions of ops/sec
- ✅ **Configurable:** Opt-in per Bit, per topic, or globally
- ✅ **Platform-agnostic:** Works on Docker, GCP, AWS, Azure
- ✅ **Gracefully degrades:** Falls back if Redis unavailable

---

## Problem Statement

### Current State

**At-Least-Once Delivery:**
- NATS JetStream: Durable consumers, message redelivery
- Google Pub/Sub: At-least-once delivery guarantee
- No platform-wide idempotency protection

**Symptoms:**
1. Debug messages duplicated after deploy (Sprint 1 trigger)
2. Potential duplicate event processing in routing layer
3. No protection against crash/restart scenarios
4. Scattered dedupe logic (in-memory caches, manual patterns)

**Example Failure:**
```
12:41 PM: User sends !debug !ping
12:41 PM: Progress messages delivered ✓
12:43 PM: Deploy → Services restart
12:43 PM: NATS redelivers un-ack'd messages
12:43 PM: Duplicate messages sent to user ❌
```

### Desired State

**Exactly-Once Processing (via idempotency):**
- Messages processed at most once within TTL window
- Automatic deduplication at subscription layer
- Configurable per Bit/topic
- Survives service restarts
- Minimal application-level changes

---

## Solution Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Bit Messaging Layer                       │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  onMessage('internal.auth.v1', handler, {            │   │
│  │    idempotency: { enabled: true, ttl: 300 }          │   │
│  │  })                                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         IdempotencyMiddleware (New)                  │   │
│  │  - Extract idempotency key (correlationId, etc.)     │   │
│  │  - Check Redis: SET key NX EX ttl                    │   │
│  │  - If exists → Skip handler (duplicate)              │   │
│  │  - If new → Proceed to handler                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                           ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         User Handler (Existing)                       │   │
│  │  - Process message                                    │   │
│  │  - Call next() / complete()                          │   │
│  │  - Ack message                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           ↕
                    ┌──────────────┐
                    │     Redis    │
                    │  (Idempotency │
                    │     Cache)    │
                    └──────────────┘
```

---

## Design Details

### 1. Idempotency Key Design

**Default Key Format:**
```
bitbrat:idempotency:{topic}:{correlationId}
```

**Example:**
```
bitbrat:idempotency:internal.egress.v1:3f40f0c0-a745-4bfa-8d39-895a7381de39
```

**Custom Keys:**
```typescript
await this.onMessage('internal.auth.v1', handler, {
  idempotency: {
    enabled: true,
    ttl: 300,
    keyFn: (event, topic) => {
      // Custom key derivation
      return `${topic}:${event.correlationId}:${event.ingress?.source}`;
    }
  }
});
```

**Key Composition Strategy:**
- **Topic:** Ensures different topics don't collide
- **CorrelationId:** Unique event identifier
- **Optional:** Add source, messageType, etc. for finer granularity

---

### 2. Redis Operations

**Check-and-Set Pattern:**
```typescript
async function checkIdempotency(key: string, ttl: number): Promise<boolean> {
  // SET key "1" EX ttl NX
  // Returns "OK" if new (not duplicate)
  // Returns null if exists (duplicate)

  const result = await redis.set(key, '1', {
    EX: ttl,    // Expiration in seconds
    NX: true    // Only set if not exists
  });

  return result === null; // true = duplicate, false = new
}
```

**Example Usage:**
```typescript
const key = 'bitbrat:idempotency:internal.egress.v1:abc123';
const isDuplicate = await checkIdempotency(key, 300); // 5 min TTL

if (isDuplicate) {
  logger.info('message.deduplicated', { key });
  await ctx.ack(); // Ack without processing
  return;
}

// Process message normally
await handler(event, attributes, ctx);
```

---

### 3. Configuration Model

**Environment Variables:**
```yaml
# env/local/global.yaml
IDEMPOTENCY_DRIVER: redis        # redis | memory | none
REDIS_URL: redis://localhost:6379
REDIS_CLUSTER_URLS: redis://host1:6379,redis://host2:6379  # Optional cluster
IDEMPOTENCY_DEFAULT_TTL: 300     # Default 5 minutes
IDEMPOTENCY_KEY_PREFIX: bitbrat:idempotency
```

**Per-Bit Configuration:**
```typescript
// In bit subclass
export class AuthService extends Bit {
  protected static IDEMPOTENCY_CONFIG = {
    'internal.auth.v1': {
      enabled: true,
      ttl: 300,
      keyFn: (event) => event.correlationId
    }
  };
}
```

**Per-Subscription Override:**
```typescript
await this.onMessage('internal.egress.v1', handler, {
  idempotency: {
    enabled: true,
    ttl: 60, // 1 minute for egress
  }
});
```

**Priority Resolution:**
1. Per-subscription config (highest)
2. Per-Bit static config
3. Global defaults (lowest)

---

### 4. Integration into base-server.ts

**New onMessage Signature:**
```typescript
interface SubscribeOptions {
  queue?: string;
  ack?: 'auto' | 'explicit';
  maxInFlight?: number;
  durable?: string;

  // NEW: Idempotency config
  idempotency?: {
    enabled: boolean;
    ttl?: number;          // Seconds, defaults to IDEMPOTENCY_DEFAULT_TTL
    keyFn?: IdempotencyKeyFn;  // Custom key derivation
  };
}

type IdempotencyKeyFn = (event: any, topic: string) => string;
```

**Middleware Wrapper:**
```typescript
protected async onMessage<T = any>(
  arg1: string | { destination: string; queue?: string; ack?: 'auto' | 'explicit' },
  handler: MessageHandler<T>,
  options?: SubscribeOptions
): Promise<void> {
  const cfg = typeof arg1 === 'string' ? { destination: arg1 } : arg1;

  // Check if idempotency is enabled
  const idempotencyConfig = options?.idempotency
    || this.getIdempotencyConfig(cfg.destination);

  if (idempotencyConfig?.enabled) {
    // Wrap handler with idempotency middleware
    const wrappedHandler = await this.wrapWithIdempotency(
      handler,
      cfg.destination,
      idempotencyConfig
    );

    // Subscribe with wrapped handler
    await this.subscribeToMessage(cfg, wrappedHandler, options);
  } else {
    // Subscribe without idempotency (existing behavior)
    await this.subscribeToMessage(cfg, handler, options);
  }
}

private async wrapWithIdempotency<T>(
  handler: MessageHandler<T>,
  topic: string,
  config: IdempotencyConfig
): Promise<MessageHandler<T>> {
  return async (event: T, attributes: AttributeMap, ctx: MessageContext) => {
    const redisClient = this.getResource<RedisClient>('redis');

    if (!redisClient) {
      // Graceful degradation: Redis unavailable, process normally
      this.logger.warn('idempotency.redis_unavailable', { topic });
      return await handler(event, attributes, ctx);
    }

    // Derive idempotency key
    const keyFn = config.keyFn || ((e: any, t: string) => `${t}:${e.correlationId}`);
    const rawKey = keyFn(event, topic);
    const key = `${this.config.idempotencyKeyPrefix || 'bitbrat:idempotency'}:${rawKey}`;
    const ttl = config.ttl || this.config.idempotencyDefaultTtl || 300;

    try {
      // Check Redis for duplicate
      const isDuplicate = await redisClient.set(key, '1', { EX: ttl, NX: true }) === null;

      if (isDuplicate) {
        this.logger.info('message.deduplicated', {
          topic,
          key,
          correlationId: (event as any).correlationId,
        });

        // Ack without processing
        await ctx.ack();
        return;
      }

      // Not a duplicate, process normally
      this.logger.debug('message.idempotency_check_passed', { topic, key });
      return await handler(event, attributes, ctx);

    } catch (redisError: any) {
      // Redis error: log warning and process message (fail open)
      this.logger.warn('idempotency.redis_error', {
        topic,
        error: redisError.message,
        fallback: 'processing_message',
      });
      return await handler(event, attributes, ctx);
    }
  };
}
```

---

### 5. Resource Manager: RedisManager

**New File:** `src/common/resources/redis-manager.ts`

```typescript
import { createClient, RedisClientType } from 'redis';
import type { ResourceManager } from './types';
import { logger } from '../logging';

export type RedisClient = RedisClientType;

export interface RedisResource {
  client: RedisClient;
  set: (key: string, value: string, options?: any) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
}

export class RedisManager implements ResourceManager<RedisResource> {
  async setup(config: any): Promise<RedisResource> {
    const redisUrl = config.redisUrl || process.env.REDIS_URL;

    if (!redisUrl) {
      logger.warn('redis.setup.no_url', { fallback: 'disabled' });
      throw new Error('REDIS_URL not configured');
    }

    const client = createClient({ url: redisUrl });

    client.on('error', (err) => {
      logger.error('redis.connection_error', { error: err.message });
    });

    await client.connect();
    logger.info('redis.connected', { url: redisUrl });

    return {
      client,
      set: (key, value, options) => client.set(key, value, options),
      get: (key) => client.get(key),
      del: (key) => client.del(key),
    };
  }

  async shutdown(resource: RedisResource): Promise<void> {
    try {
      await resource.client.quit();
      logger.info('redis.disconnected');
    } catch (e: any) {
      logger.warn('redis.shutdown_error', { error: e.message });
    }
  }
}
```

**Register in base-server.ts:**
```typescript
// In constructor
this.resourceManagers = {
  publisher: new PublisherManager(),
  firestore: new FirestoreManager(),
  documentStore: new DocumentStoreManager(),
  redis: new RedisManager(),  // NEW
  ...(options?.resources || {}),
};
```

---

### 6. Graceful Degradation

**Fallback Strategy:**

| Scenario | Behavior |
|----------|----------|
| Redis unavailable at startup | Warn + disable idempotency |
| Redis connection lost mid-run | Fail open (process messages) |
| Redis timeout (>100ms) | Log warning + process message |
| SET NX error | Process message (avoid stalling) |

**Example:**
```typescript
try {
  const isDuplicate = await redis.set(key, '1', { EX: ttl, NX: true }) === null;
  if (isDuplicate) {
    await ctx.ack();
    return;
  }
} catch (error) {
  // Fail open: process message despite Redis error
  logger.warn('idempotency.redis_error_fail_open', { error: error.message });
}

// Continue processing
await handler(event, attributes, ctx);
```

---

### 7. TTL Strategy

**Recommended Defaults:**

| Use Case | TTL | Rationale |
|----------|-----|-----------|
| Egress delivery | 60s | Fast feedback, rare redelivery |
| Routing (auth, llm) | 300s (5min) | Cover deploy windows |
| Long-running tasks | 3600s (1hr) | Protect against long retries |
| Debug messages | 300s (5min) | Match user's deletion interval |

**Configuration:**
```yaml
# Per-service overrides in env/{context}/{service}.yaml
# Example: env/local/ingress-egress.yaml
IDEMPOTENCY_EGRESS_TTL: 60
IDEMPOTENCY_ROUTING_TTL: 300
```

---

### 8. Deployment Considerations

**Local Development:**
```bash
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
```

**Cloud Deployments:**

| Platform | Service | Notes |
|----------|---------|-------|
| **GCP** | Cloud Memorystore (Redis) | Managed, HA, 99.9% SLA |
| **AWS** | ElastiCache (Redis) | Managed, cluster mode |
| **Azure** | Azure Cache for Redis | Managed, geo-replication |
| **Self-hosted** | Redis Sentinel | HA failover |

**High Availability:**
- Use Redis Cluster (3+ nodes) in production
- Configure `REDIS_CLUSTER_URLS` for multi-node setup
- Client library handles failover automatically

---

## Solving the Debug Message Issue

**With this architecture, the debug message problem is solved:**

### Before (Current):
```
1. Debug message published to internal.egress.v1
2. ingress-egress receives, delivers to Slack
3. Deploy → service restarts
4. NATS redelivers un-ack'd message
5. ❌ Duplicate sent to Slack (no dedupe)
```

### After (With Redis Idempotency):
```
1. Debug message published to internal.egress.v1
2. ingress-egress receives
   - Redis check: SET bitbrat:idempotency:internal.egress.v1:abc123 EX 60 NX
   - Returns OK (new message)
3. Deliver to Slack, ack
4. Deploy → service restarts
5. NATS redelivers un-ack'd message
6. ingress-egress receives
   - Redis check: SET bitbrat:idempotency:internal.egress.v1:abc123 EX 60 NX
   - Returns NULL (duplicate)
   - ✅ Ack without delivering
7. No duplicate in Slack!
```

**Configuration for ingress-egress:**
```typescript
// In ingress-egress-service.ts
await this.onMessage<InternalEventV2>(
  { destination: INTERNAL_EGRESS_V1, queue: `ingress-egress.${instanceId}`, ack: 'explicit' },
  async (evt, attrs, ctx) => {
    await this.processEgress(evt, INTERNAL_EGRESS_V1);
    await ctx.ack();
  },
  {
    idempotency: {
      enabled: true,
      ttl: 60, // 1 minute
      keyFn: (evt) => evt.correlationId // Default, but explicit
    }
  }
);
```

---

## Implementation Roadmap

### Phase 1: Foundation (Sprint 2)

**Deliverables:**
1. RedisManager resource implementation
2. IdempotencyMiddleware in base-server.ts
3. Configuration model (env vars, IConfig extension)
4. Unit tests (Redis mocking)
5. Integration tests (testcontainers)

**Effort:** 8-12 hours

---

### Phase 2: Integration (Sprint 2 or 3)

**Deliverables:**
1. Add idempotency to ingress-egress (egress subscriptions)
2. Add idempotency to auth-service (routing subscriptions)
3. Add idempotency to llm-bot (routing subscriptions)
4. Update docker-compose.yml (add Redis)
5. Update architecture.yaml (Redis config)

**Effort:** 6-8 hours

---

### Phase 3: Validation (Sprint 3)

**Deliverables:**
1. Manual testing: staging deploy cycle (verify no duplicates)
2. Performance testing: Redis latency impact
3. Chaos testing: Redis failure scenarios
4. Documentation: CLAUDE.md, troubleshooting guide

**Effort:** 4-6 hours

---

### Phase 4: Rollout (Sprint 4)

**Deliverables:**
1. Deploy to staging → monitor
2. Deploy to production → monitor
3. Remove legacy in-memory dedupe logic (cleanup)
4. Post-deployment validation

**Effort:** 2-4 hours

---

## Success Criteria

**Functional:**
- ✅ No duplicate debug messages after deploy
- ✅ No duplicate event processing in routing layer
- ✅ Idempotency survives service restarts
- ✅ Works across multiple instances

**Non-Functional:**
- ✅ Redis latency < 5ms (p95)
- ✅ Total message latency < 100ms (p95)
- ✅ Graceful degradation on Redis failure
- ✅ Zero data loss (fail open on errors)

**Operational:**
- ✅ Simple configuration (env vars)
- ✅ Self-service enablement (per Bit)
- ✅ Clear logs/metrics for debugging
- ✅ Documented troubleshooting guide

---

## Open Questions

1. **Q:** Should we support Redis Cluster from day one?
   **A:** Yes - use `redis` npm package cluster support, configure via `REDIS_CLUSTER_URLS`

2. **Q:** What happens if Redis has stale keys (service crashed before TTL)?
   **A:** Non-issue - TTL automatically expires keys. Max impact = TTL duration.

3. **Q:** Should we add metrics for idempotency hit rate?
   **A:** Yes - emit `message.deduplicated` and `message.processed` counters

4. **Q:** Can we use this for non-message deduplication (HTTP, MCP)?
   **A:** Yes! Extract RedisIdempotencyStore as standalone utility

5. **Q:** Should we clear Redis on deploy?
   **A:** No - defeats the purpose. TTL handles cleanup.

---

## Appendix: Redis Commands Reference

**SET NX EX (Idempotency Check):**
```bash
# Set key with 300s TTL if not exists
redis> SET bitbrat:idempotency:internal.egress.v1:abc123 1 EX 300 NX
OK  # New key, process message

redis> SET bitbrat:idempotency:internal.egress.v1:abc123 1 EX 300 NX
(nil)  # Key exists, duplicate!
```

**GET (Debug/Inspect):**
```bash
redis> GET bitbrat:idempotency:internal.egress.v1:abc123
"1"

redis> TTL bitbrat:idempotency:internal.egress.v1:abc123
(integer) 287  # Seconds remaining
```

**DEL (Manual Cleanup):**
```bash
redis> DEL bitbrat:idempotency:internal.egress.v1:abc123
(integer) 1  # Key deleted
```

**SCAN (Find All Keys):**
```bash
redis> SCAN 0 MATCH bitbrat:idempotency:* COUNT 100
1) "cursor"
2) ["key1", "key2", ...]
```

---

## Related Sprints

- **Sprint 1 (this):** Research - Identify root cause, design solution
- **Sprint 2:** Implement Redis idempotency layer
- **Sprint 3:** Integrate into services, validation
- **Sprint 4:** Production rollout, monitoring
