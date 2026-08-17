# Execution Plan: Redis-Based Idempotency Layer Implementation

**Sprint:** sprint-1-9ih2e3 (Research) → Future Implementation Sprints
**Lead Implementor:** Lead Implementor
**Created:** 2026-08-06

---

## Executive Summary

This execution plan breaks down the Redis-based idempotency layer implementation into **4 phases spanning 3-4 sprints** with a total estimated effort of **24-32 hours**.

**Objective:** Eliminate duplicate message processing platform-wide by implementing transparent, configurable, Redis-backed idempotency middleware in the Bit messaging framework.

**Success Criteria:**
- ✅ No duplicate debug messages after service restarts/deploys
- ✅ Configurable per-Bit with simple opt-in
- ✅ < 5ms Redis latency (p95)
- ✅ Graceful degradation (fail-open on Redis errors)
- ✅ Zero breaking changes to existing services

---

## Architecture Analysis

### Strengths

1. **Clean Integration Point**
   - Middleware pattern in `base-server.ts::onMessage()` is non-invasive
   - Transparent to application code (opt-in via config)
   - Consistent with existing Bit resource pattern

2. **Robust Fail-Safe Design**
   - Fail-open strategy prevents message loss
   - Graceful degradation on Redis unavailability
   - Clear logging for observability

3. **Flexible Configuration**
   - 3-level hierarchy (global → per-Bit → per-subscription)
   - Customizable key derivation functions
   - TTL tuning per use case

4. **Platform-Agnostic**
   - Works on Docker, GCP, AWS, Azure
   - No vendor lock-in
   - Standard Redis protocol

### Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Redis unavailable at startup | Service fails to start | Low | Make Redis optional, warn on missing config |
| Redis connection lost mid-run | Message processing stalls | Medium | Fail-open: process messages without idempotency |
| Redis latency spike | Increased message latency | Medium | Set timeout (100ms), fail-open on timeout |
| Key collision (different events, same key) | False duplicate detection | Low | Include topic + correlationId + source in key |
| TTL too short | Duplicates leak through | Medium | Conservative defaults (300s), monitoring |
| TTL too long | Memory usage grows | Low | Use Redis memory policies, monitor memory |

### Open Questions Requiring Decisions

1. **Q:** Make Redis required or optional dependency?
   **Recommendation:** Optional - fail gracefully if unavailable
   **Rationale:** Allows gradual rollout, local dev without Redis

2. **Q:** Enable idempotency by default or opt-in?
   **Recommendation:** Opt-in initially, default-on after validation
   **Rationale:** Conservative rollout reduces blast radius

3. **Q:** Use standalone Redis or Redis Cluster?
   **Recommendation:** Start standalone, add cluster support in Phase 2
   **Rationale:** YAGNI - validate pattern before adding complexity

4. **Q:** Custom key function - per-Bit or per-subscription?
   **Recommendation:** Support both (per-subscription overrides per-Bit)
   **Rationale:** Maximum flexibility for edge cases

---

## Implementation Phases

### Phase 0: Preparation (Pre-Sprint, 2 hours)

**Goal:** Set up infrastructure and validate Redis connectivity

**Tasks:**
1. Add Redis to local docker-compose.yml
2. Provision Redis on staging (Cloud Memorystore or equivalent)
3. Validate Redis connectivity from services
4. Document Redis deployment topology

**Deliverables:**
- Updated `docker-compose.yml`
- Redis provisioned on staging
- Connection test script

**Decision Point:** Redis deployment model validated

---

### Phase 1: Foundation (Sprint 2, 10-14 hours)

**Goal:** Implement core idempotency infrastructure without service integration

**Milestones:**
1. ✅ RedisManager resource available
2. ✅ Idempotency middleware functional
3. ✅ Configuration model complete
4. ✅ Unit tests passing (>90% coverage)
5. ✅ Integration tests passing

**Key Deliverables:**

#### 1.1 RedisManager Resource (4 hours)
- `src/common/resources/redis-manager.ts`
- Connection management (connect, disconnect, error handling)
- Graceful degradation on connection failure
- Health check integration
- Unit tests with redis-mock

#### 1.2 Configuration Extension (2 hours)
- Extend `IConfig` interface with Redis fields
- Add `REDIS_URL`, `IDEMPOTENCY_DRIVER`, `IDEMPOTENCY_DEFAULT_TTL`
- Environment variable parsing
- Validation logic

#### 1.3 Idempotency Middleware (4 hours)
- Key derivation logic (default + custom)
- Redis SET NX EX check
- Fail-open error handling
- Metrics/logging instrumentation
- Unit tests with mock Redis

#### 1.4 Integration into base-server.ts (2-4 hours)
- Update `onMessage()` signature (add `idempotency` option)
- Wrap handler with middleware
- Resource initialization
- Backward compatibility (no breaking changes)

#### 1.5 Integration Tests (2-4 hours)
- Testcontainers setup (Redis container)
- End-to-end idempotency flow
- Duplicate detection verification
- TTL expiration testing
- Graceful degradation scenarios

**Decision Point:** Foundation validated, ready for service integration

---

### Phase 2: Service Integration (Sprint 2-3, 6-8 hours)

**Goal:** Enable idempotency in critical services (ingress-egress, auth, llm-bot)

**Milestones:**
1. ✅ Egress delivery deduplication working
2. ✅ Routing layer deduplication working
3. ✅ Debug message issue resolved
4. ✅ No performance regression

**Key Deliverables:**

#### 2.1 Ingress-Egress Integration (2 hours)
- Enable idempotency for `internal.egress.v1` subscription
- TTL: 60s (fast feedback, egress-focused)
- Custom key: `{topic}:{correlationId}:{source}`
- Manual testing: verify no duplicates after restart

#### 2.2 Auth Service Integration (1-2 hours)
- Enable idempotency for `internal.auth.v1` subscription
- TTL: 300s (cover deploy windows)
- Default key derivation
- Manual testing: verify no duplicate enrichment

#### 2.3 LLM-Bot Integration (1-2 hours)
- Enable idempotency for relevant subscriptions
- TTL: 300s
- Default key derivation
- Manual testing: verify no duplicate LLM calls

#### 2.4 Docker Compose Update (1 hour)
- Add Redis service
- Configure volume for persistence (optional)
- Update `.env.example` with Redis variables
- Document local setup

#### 2.5 Architecture.yaml Update (1 hour)
- Add Redis to resources
- Document idempotency config per service
- Update service env templates

**Decision Point:** Debug message issue resolved in staging

---

### Phase 3: Validation & Hardening (Sprint 3, 4-6 hours)

**Goal:** Validate production-readiness and performance

**Milestones:**
1. ✅ Performance benchmarks acceptable
2. ✅ Chaos testing passed
3. ✅ Documentation complete
4. ✅ Monitoring/alerting configured

**Key Deliverables:**

#### 3.1 Performance Testing (2 hours)
- Benchmark Redis latency (p50, p95, p99)
- Benchmark end-to-end message latency
- Load testing (1k, 10k, 100k msg/sec)
- Memory usage profiling
- Target: Redis latency < 5ms p95, total < 100ms p95

#### 3.2 Chaos Testing (2 hours)
- Redis connection loss mid-processing
- Redis timeout scenarios
- Redis memory exhaustion
- Network partition between service and Redis
- Verify fail-open behavior (no message loss)

#### 3.3 Documentation (2 hours)
- Update CLAUDE.md with idempotency section
- Create troubleshooting guide
- Document configuration options
- Add runbook for Redis operations
- Update architecture diagrams

**Decision Point:** Production deployment approved

---

### Phase 4: Production Rollout (Sprint 4, 2-4 hours)

**Goal:** Deploy to production and validate

**Milestones:**
1. ✅ Staging deployment successful
2. ✅ Production deployment successful
3. ✅ No incidents (24 hours)
4. ✅ Metrics baseline established

**Key Deliverables:**

#### 4.1 Staging Deployment (1 hour)
- Deploy Redis (Cloud Memorystore or equivalent)
- Deploy updated services with idempotency enabled
- Monitor for 24 hours
- Validate no duplicates during deploy cycles

#### 4.2 Production Deployment (1 hour)
- Deploy Redis (HA cluster recommended)
- Gradual rollout (canary → 50% → 100%)
- Monitor metrics (latency, error rate, dedupe hit rate)
- Rollback plan ready

#### 4.3 Monitoring & Alerting (1 hour)
- Configure dashboards (Grafana, Cloud Monitoring)
- Set up alerts (Redis unavailable, latency spike, error rate)
- Document baseline metrics
- Create on-call runbook

#### 4.4 Post-Deployment Validation (1 hour)
- Verify no duplicates during multiple deploy cycles
- Check Redis memory usage trends
- Review logs for errors/warnings
- Collect user feedback

**Decision Point:** Production rollout complete

---

## Task Breakdown & Dependencies

### Critical Path (Must Complete)

```
Phase 0: Prep
  └─→ Phase 1.1: RedisManager
      └─→ Phase 1.2: Config
          └─→ Phase 1.3: Middleware
              └─→ Phase 1.4: base-server integration
                  └─→ Phase 1.5: Integration tests
                      └─→ Phase 2.1: Ingress-Egress
                          └─→ Phase 3.1: Performance tests
                              └─→ Phase 4: Production rollout
```

### Parallel Work Streams

**Stream A (Foundation):** Phase 1.1 → 1.2 → 1.3 → 1.4 → 1.5
**Stream B (Documentation):** Phase 3.3 (can start after Phase 1 complete)
**Stream C (Infrastructure):** Phase 0, Phase 2.4, Phase 4.1 (can parallelize)

---

## Testing Strategy

### Unit Tests

**Scope:**
- RedisManager (connection, error handling, graceful degradation)
- Idempotency middleware (key derivation, duplicate detection)
- Configuration parsing (env vars, defaults, validation)

**Tools:**
- Jest
- redis-mock (in-memory Redis for fast tests)
- Sinon (stubbing, spying)

**Coverage Target:** >90%

### Integration Tests

**Scope:**
- End-to-end message flow with idempotency enabled
- Duplicate detection (same message twice)
- TTL expiration (message re-processable after TTL)
- Fail-open scenarios (Redis unavailable)
- Multi-instance scenarios (cross-pod deduplication)

**Tools:**
- Jest + Testcontainers (real Redis container)
- Supertest (HTTP testing)
- NATS test harness (message simulation)

**Coverage Target:** Critical paths covered

### Manual Testing

**Scenarios:**
1. **Happy path:**
   - Send `!debug !ping` in staging
   - Verify messages delivered once
   - Restart service
   - Verify no duplicates

2. **Deploy cycle:**
   - Send `!debug !ping`
   - Run `brat bit deploy --all`
   - Verify no duplicate debug messages

3. **Redis failure:**
   - Stop Redis mid-processing
   - Verify messages still processed (fail-open)
   - Restart Redis
   - Verify idempotency resumes

4. **Performance:**
   - High-volume message load (1k msg/sec)
   - Measure latency impact
   - Verify no bottlenecks

### Performance Benchmarks

**Metrics:**
- Redis latency (p50, p95, p99): Target < 5ms p95
- End-to-end message latency: Target < 100ms p95
- Memory usage: Baseline + growth rate
- Dedupe hit rate: % of messages deduplicated

**Tools:**
- k6 (load testing)
- Redis SLOWLOG
- Prometheus metrics
- Custom benchmarking scripts

---

## Rollout Strategy

### Phase A: Local Development (Week 1)
- Add Redis to docker-compose
- Developers test locally
- Validate developer experience

### Phase B: Staging Deployment (Week 2)
- Deploy Redis to staging
- Enable idempotency on critical services
- Monitor for 1 week
- Collect performance metrics

### Phase C: Production Canary (Week 3)
- Deploy Redis to production (HA cluster)
- Enable idempotency on 10% of ingress-egress instances
- Monitor for anomalies
- Gradual rollout to 100%

### Phase D: Full Rollout (Week 4)
- Enable on all services
- Monitor metrics baseline
- Document lessons learned

### Rollback Plan

**Trigger Conditions:**
- Redis latency > 100ms sustained
- Message processing errors > 1%
- Redis memory > 80% sustained
- User-reported issues

**Rollback Steps:**
1. Disable idempotency via env var: `IDEMPOTENCY_DRIVER=none`
2. Redeploy affected services (no code changes needed)
3. Investigate root cause
4. Fix and re-deploy

**Recovery Time Objective:** < 15 minutes

---

## Configuration Reference

### Environment Variables

```yaml
# Required
REDIS_URL: redis://localhost:6379

# Optional (with defaults)
IDEMPOTENCY_DRIVER: redis                 # redis | memory | none
IDEMPOTENCY_DEFAULT_TTL: 300              # seconds
IDEMPOTENCY_KEY_PREFIX: bitbrat:idempotency
REDIS_CONNECT_TIMEOUT: 5000               # milliseconds
REDIS_COMMAND_TIMEOUT: 100                # milliseconds
```

### Per-Service Configuration

```yaml
# env/local/ingress-egress.yaml
IDEMPOTENCY_EGRESS_ENABLED: true
IDEMPOTENCY_EGRESS_TTL: 60

# env/local/auth.yaml
IDEMPOTENCY_AUTH_ENABLED: true
IDEMPOTENCY_AUTH_TTL: 300
```

### Per-Subscription Configuration

```typescript
// In service code
await this.onMessage('internal.egress.v1', handler, {
  idempotency: {
    enabled: true,
    ttl: 60,
    keyFn: (event, topic) => `${topic}:${event.correlationId}:${event.ingress?.source}`
  }
});
```

---

## Metrics & Observability

### Key Metrics to Track

**Redis Metrics:**
- `redis.connection.status` (connected | disconnected)
- `redis.latency.p95` (milliseconds)
- `redis.errors.rate` (errors/sec)
- `redis.memory.used` (bytes)
- `redis.keys.count` (active idempotency keys)

**Idempotency Metrics:**
- `idempotency.check.total` (counter)
- `idempotency.deduplicated` (counter)
- `idempotency.processed` (counter)
- `idempotency.hit_rate` (deduplicated / total)
- `idempotency.error.rate` (errors/sec)

**Message Metrics:**
- `message.latency.p95` (milliseconds, before/after)
- `message.throughput` (messages/sec)
- `message.error_rate` (errors/sec)

### Logging

**Structured logs:**
```json
{
  "level": "info",
  "message": "message.deduplicated",
  "topic": "internal.egress.v1",
  "key": "bitbrat:idempotency:internal.egress.v1:abc123",
  "correlationId": "abc123",
  "ttl": 60
}
```

### Alerts

**Critical:**
- Redis unavailable (all instances down)
- Redis latency > 100ms for 5 minutes

**Warning:**
- Redis latency > 50ms for 5 minutes
- Redis memory > 80%
- Idempotency error rate > 0.1%

---

## Success Criteria

### Functional
- [ ] No duplicate debug messages after service restart (manual test)
- [ ] No duplicate debug messages after deploy cycle (manual test)
- [ ] Idempotency survives Redis restart (manual test)
- [ ] Works across multiple service instances (integration test)
- [ ] Graceful degradation on Redis failure (chaos test)

### Non-Functional
- [ ] Redis latency < 5ms (p95)
- [ ] End-to-end message latency < 100ms (p95)
- [ ] Memory usage growth < 10MB/day (with TTL cleanup)
- [ ] Zero message loss on Redis errors (fail-open)
- [ ] Code coverage > 90% (unit tests)

### Operational
- [ ] Simple configuration (env vars only)
- [ ] Clear logs for debugging
- [ ] Metrics available in Grafana/Cloud Monitoring
- [ ] Documented troubleshooting guide
- [ ] Runbook for on-call engineers

---

## Timeline Estimate

| Phase | Duration | Dependencies | Effort |
|-------|----------|--------------|--------|
| **Phase 0: Prep** | 2 hours | None | 2h |
| **Phase 1: Foundation** | 10-14 hours | Phase 0 | 12h avg |
| **Phase 2: Integration** | 6-8 hours | Phase 1 | 7h avg |
| **Phase 3: Validation** | 4-6 hours | Phase 2 | 5h avg |
| **Phase 4: Rollout** | 2-4 hours | Phase 3 | 3h avg |
| **Total** | **24-32 hours** | | **29h avg** |

**Sprint Allocation:**
- **Sprint 2:** Phase 0 + Phase 1 (14 hours)
- **Sprint 3:** Phase 2 + Phase 3 (12 hours)
- **Sprint 4:** Phase 4 (3 hours)

---

## Risk Register

| ID | Risk | Impact | Likelihood | Mitigation | Owner |
|----|------|--------|------------|------------|-------|
| R1 | Redis single point of failure | High | Medium | Use Redis Cluster in prod | DevOps |
| R2 | Memory leak from unbounded keys | High | Low | Set maxmemory + LRU policy | Lead Impl |
| R3 | Key collision false positives | Medium | Low | Include source in key | Lead Impl |
| R4 | TTL too short, duplicates leak | Medium | Medium | Conservative defaults, monitoring | Lead Impl |
| R5 | Performance regression | Medium | Medium | Benchmarking, gradual rollout | Lead Impl |
| R6 | Complexity increases debugging | Low | Medium | Comprehensive logging | Lead Impl |

---

## Appendix A: File Structure

```
src/
  common/
    resources/
      redis-manager.ts                 # NEW: Redis resource manager
      __tests__/
        redis-manager.spec.ts          # NEW: Unit tests
    base-server.ts                     # MODIFIED: Add idempotency middleware
  types/
    index.ts                           # MODIFIED: Extend IConfig

tests/
  integration/
    idempotency-middleware.spec.ts     # NEW: Integration tests

docker-compose.yml                     # MODIFIED: Add Redis service
architecture.yaml                      # MODIFIED: Add Redis config

documentation/
  guides/
    idempotency-troubleshooting.md     # NEW: Troubleshooting guide

CLAUDE.md                              # MODIFIED: Document idempotency layer
```

---

## Appendix B: Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-06 | Use Redis (not Memcache) | More features, better community support |
| 2026-08-06 | Fail-open on Redis errors | Prefer availability over strict deduplication |
| 2026-08-06 | Opt-in idempotency | Conservative rollout, validate before default-on |
| TBD | Redis Cluster vs Standalone | Decide based on prod volume |
| TBD | Default TTL values | Tune based on validation testing |

---

## Next Steps

1. **Review this execution plan** with stakeholders
2. **Approve Redis deployment** for local/staging/prod
3. **Create Sprint 2** with Phase 0 + Phase 1 tasks
4. **Assign resources** (Lead Implementor + 1 reviewer)
5. **Begin implementation** starting with RedisManager
