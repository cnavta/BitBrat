# Sprint 1 Research Summary: Platform-Wide Idempotency Layer

**Sprint ID:** sprint-1-9ih2e3
**Type:** Research Sprint
**Owner:** Lead Implementor
**Completed:** 2026-08-06

---

## Sprint Goal

Investigate debug trace message re-delivery issue and design a platform-wide solution for distributed idempotency in the Bit messaging framework.

---

## Key Findings

### 1. Root Cause Identified

**Problem:** Debug messages (and potentially other messages) are re-delivered after service restarts due to:

1. **Durable NATS consumers** persist unacknowledged messages across restarts
2. **Graceful shutdown race condition** - acks may not reach NATS before container termination
3. **No deduplication at message consumption layer** - only at publish layer
4. **In-memory dedupe caches** lost on restart

**Evidence:** Staging test showing duplicate messages appearing after `brat bit deploy --all` cycles.

**See:** `revised-root-cause.md`, `ack-analysis.md`

---

### 2. Architectural Gap

**Current State:**
- At-least-once delivery (NATS JetStream, Google Pub/Sub)
- No platform-wide idempotency guarantee
- Dedupe logic scattered across services (error-prone, incomplete)
- No protection against redelivery after crashes/restarts

**Impact:**
- Debug messages duplicated (visible symptom)
- Potential duplicate event processing in routing layer (hidden risk)
- Poor user experience (duplicate notifications)
- Operational burden (manual NATS data deletion workaround)

---

### 3. Solution Direction

**Recommendation:** **Redis-based idempotency layer** integrated into Bit messaging framework

**Why Redis:**
- ✅ **Temporal decay:** Built-in TTL support (seconds to minutes, not permanent)
- ✅ **High-volume:** Handles millions of ops/sec with sub-ms latency
- ✅ **Distributed:** Works across multiple service instances
- ✅ **Platform-agnostic:** Works on Docker, GCP, AWS, Azure
- ✅ **Simple:** SET NX EX pattern is purpose-built for idempotency
- ✅ **Common:** Already standard in cloud deployments

**Core Pattern:**
```typescript
const isDuplicate = await redis.set(key, '1', { EX: ttl, NX: true }) === null;
if (isDuplicate) {
  await ctx.ack(); // Skip processing
  return;
}
// Process message normally
```

---

## Design Highlights

### 1. Integration Point

**Transparent middleware** in `base-server.ts::onMessage()`:

```typescript
await this.onMessage('internal.egress.v1', handler, {
  idempotency: {
    enabled: true,
    ttl: 60, // seconds
  }
});
```

**No application code changes required** - opt-in via configuration.

---

### 2. Configuration Model

**Three levels of configuration:**

1. **Global defaults** (env vars):
   ```yaml
   IDEMPOTENCY_DRIVER: redis
   REDIS_URL: redis://localhost:6379
   IDEMPOTENCY_DEFAULT_TTL: 300
   ```

2. **Per-Bit defaults** (static config):
   ```typescript
   protected static IDEMPOTENCY_CONFIG = {
     'internal.auth.v1': { ttl: 300 }
   };
   ```

3. **Per-subscription override** (highest priority):
   ```typescript
   { idempotency: { enabled: true, ttl: 60 } }
   ```

---

### 3. Key Design

**Default:**
```
bitbrat:idempotency:{topic}:{correlationId}
```

**Example:**
```
bitbrat:idempotency:internal.egress.v1:3f40f0c0-a745-4bfa-8d39-895a7381de39
```

**Custom:**
```typescript
keyFn: (event, topic) => `${topic}:${event.correlationId}:${event.ingress?.source}`
```

---

### 4. Graceful Degradation

**Fail-open strategy:**
- Redis unavailable → Warn + disable idempotency
- Redis connection lost → Process messages (avoid stalling)
- Redis timeout → Log + process message
- SET NX error → Process message

**Zero data loss** - always prefer processing over dropping messages.

---

### 5. TTL Strategy

| Use Case | TTL | Rationale |
|----------|-----|-----------|
| Egress delivery | 60s | Fast feedback, rare redelivery |
| Routing (auth, llm) | 300s | Cover deploy windows |
| Long-running tasks | 3600s | Protect against long retries |
| Debug messages | 300s | Match user's deletion interval |

---

## Deliverables

### 1. Problem Analysis
- ✅ **revised-root-cause.md** - Detailed root cause analysis with evidence
- ✅ **ack-analysis.md** - Message acknowledgment flow verification

### 2. Solution Design
- ✅ **redis-idempotency-architecture.md** - Complete technical architecture (50+ pages)
  - Integration design
  - Configuration model
  - API surface
  - Resource manager
  - Deployment considerations
  - Implementation roadmap

### 3. Research Artifacts
- ✅ **execution-plan.md** - Original analysis (now superseded)
- ✅ **backlog.yaml** - Original task list (now superseded)
- ✅ This summary document

---

## Implementation Roadmap

### Sprint 2: Foundation (8-12 hours)
1. **RedisManager** resource implementation
2. **IdempotencyMiddleware** in base-server.ts
3. Configuration model (env vars, IConfig extension)
4. Unit tests (Redis mocking)
5. Integration tests (testcontainers)

**Deliverables:**
- `src/common/resources/redis-manager.ts`
- Updated `src/common/base-server.ts` (onMessage middleware)
- Updated `src/types/index.ts` (IConfig extension)
- Tests: `src/common/resources/__tests__/redis-manager.spec.ts`
- Tests: `tests/integration/idempotency-middleware.spec.ts`

---

### Sprint 3: Integration (6-8 hours)
1. Add idempotency to **ingress-egress** (egress subscriptions)
2. Add idempotency to **auth-service** (routing subscriptions)
3. Add idempotency to **llm-bot** (routing subscriptions)
4. Update docker-compose.yml (add Redis service)
5. Update architecture.yaml (Redis config)

**Deliverables:**
- Updated service files with idempotency config
- `docker-compose.yml` with Redis
- `architecture.yaml` with Redis resource
- Environment templates with REDIS_URL

---

### Sprint 4: Validation (4-6 hours)
1. Manual testing: staging deploy cycle
2. Performance testing: Redis latency impact
3. Chaos testing: Redis failure scenarios
4. Documentation updates

**Deliverables:**
- Validation report
- Performance benchmarks
- Updated CLAUDE.md
- Troubleshooting guide: `documentation/guides/idempotency-troubleshooting.md`

---

### Sprint 5: Rollout (2-4 hours)
1. Deploy to staging → monitor
2. Deploy to production → monitor
3. Remove legacy dedupe logic (cleanup)
4. Post-deployment validation

**Deliverables:**
- Production deployment
- Monitoring dashboards
- Post-deployment report

---

## Success Metrics

### Functional
- ✅ No duplicate debug messages after deploy
- ✅ No duplicate event processing in routing layer
- ✅ Idempotency survives service restarts
- ✅ Works across multiple instances

### Non-Functional
- ✅ Redis latency < 5ms (p95)
- ✅ Total message latency < 100ms (p95)
- ✅ Graceful degradation on Redis failure
- ✅ Zero data loss (fail open on errors)

### Operational
- ✅ Simple configuration (env vars)
- ✅ Self-service enablement (per Bit)
- ✅ Clear logs/metrics for debugging
- ✅ No manual intervention required

---

## Immediate Next Steps

1. **Review architecture document** (`redis-idempotency-architecture.md`)
   - Validate design decisions
   - Identify any gaps or concerns
   - Approve for implementation

2. **Provision Redis infrastructure**
   - Local: Add Redis to docker-compose.yml
   - Staging: Provision Cloud Memorystore (GCP) or equivalent
   - Production: Provision HA Redis cluster

3. **Create Sprint 2** (Implementation)
   - Copy roadmap from architecture doc
   - Break down into trackable tasks
   - Estimate effort per task

4. **Update CLAUDE.md**
   - Add section on idempotency layer (future state)
   - Document configuration model
   - Link to architecture doc

---

## Key Learnings

1. **At-least-once ≠ exactly-once** - Platform must provide idempotency guarantees
2. **In-memory caches don't survive restarts** - Need distributed persistence
3. **Graceful shutdown is hard** - Race conditions between ack and container kill
4. **Dedupe at consumption > dedupe at publish** - More robust, simpler
5. **Redis is ideal for temporal idempotency** - Fast, distributed, TTL built-in

---

## Questions for Review

1. **Redis deployment model:**
   - Standalone Redis for local/staging?
   - Redis Cluster for production?
   - Managed service (Cloud Memorystore, ElastiCache)?

2. **Default TTL values:**
   - 60s for egress (current proposal)
   - 300s for routing (current proposal)
   - Are these reasonable?

3. **Rollout strategy:**
   - Enable gradually (service by service)?
   - Enable globally from day one?
   - How to measure impact?

4. **Metrics and observability:**
   - Which metrics to emit?
   - Dashboards to create?
   - Alerting thresholds?

---

## Appendix: Files Created

### Analysis
- `planning/sprint-1-9ih2e3/revised-root-cause.md`
- `planning/sprint-1-9ih2e3/ack-analysis.md`

### Design
- `planning/sprint-1-9ih2e3/redis-idempotency-architecture.md` (MAIN DELIVERABLE)

### Original (Superseded)
- `planning/sprint-1-9ih2e3/execution-plan.md`
- `planning/sprint-1-9ih2e3/backlog.yaml`

### Sprint Artifacts
- `planning/sprint-1-9ih2e3/sprint-manifest.yaml`
- `planning/sprint-1-9ih2e3/request-log.md`
- `planning/sprint-1-9ih2e3/research-summary.md` (THIS FILE)

---

## Recommendation

**Proceed with Redis-based idempotency layer implementation.**

The design is:
- ✅ Well-scoped (clear integration points)
- ✅ Platform-agnostic (works everywhere)
- ✅ Low-risk (fail-open, graceful degradation)
- ✅ High-impact (solves debug issue + future-proofs messaging)
- ✅ Incremental (can roll out gradually)

**Estimated total effort:** 20-30 hours across 4 sprints.

**Primary risk:** Redis operational overhead (mitigated by managed services).

**Recommendation:** Start Sprint 2 implementation with foundation work (RedisManager + middleware).
