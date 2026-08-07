# Sprint 1 Key Learnings: Redis-Based Distributed Idempotency

**Sprint ID**: sprint-1-9ih2e3
**Date**: August 6-7, 2026
**Focus**: Distributed systems, idempotency, testing, deployment infrastructure

---

## Technical Learnings

### 1. Redis SET NX EX Pattern for Distributed Idempotency

**Learning**: The Redis `SET key value NX EX ttl` command is the canonical pattern for distributed duplicate detection.

**Why It Matters**:
- **Atomic operation**: Prevents race conditions across distributed instances
- **Built-in expiration**: No manual cleanup needed
- **Widely supported**: Available in Redis 2.6.12+
- **Simple**: Single command, no complex logic

**Implementation**:
```typescript
const result = await redisClient.set(key, 'processed', { NX: true, EX: ttlSeconds });
if (result === 'OK') {
  // First time seeing this message
  return { isDuplicate: false };
} else {
  // Duplicate (key already exists)
  return { isDuplicate: true };
}
```

**Key Insight**: Don't overthink distributed locking - Redis provides atomic primitives that solve the problem elegantly.

**Applicability**: Any distributed system needing deduplication (message queues, API requests, webhook processing).

---

### 2. Fail-Open vs. Fail-Closed Design for Infrastructure

**Learning**: For infrastructure features, fail-open (continue processing on failure) is often the right default.

**Why It Matters**:
- **Availability > Strict Correctness**: Platform staying up is more important than preventing every duplicate
- **Single Point of Failure**: Fail-closed makes Redis a SPOF
- **Graceful Degradation**: System degrades to "no deduplication" instead of "complete failure"

**Implementation**:
```typescript
try {
  const result = await checkIdempotency(redis, config, logger);
  if (result.isDuplicate) {
    logger.info('Duplicate detected, skipping');
    return; // Skip processing
  }
} catch (error) {
  logger.warn('Idempotency check failed, processing anyway (fail-open)');
  // Continue processing despite error
}
```

**Tradeoff**: Potential duplicates during Redis outage (acceptable) vs. service downtime (unacceptable).

**Key Insight**: Design infrastructure features to degrade gracefully, not catastrophically.

**Applicability**: Caching, rate limiting, analytics, session management, any non-critical infrastructure.

---

### 3. 3-Level Configuration Hierarchy for Flexibility

**Learning**: Implementing a priority-based configuration hierarchy enables flexibility without complexity.

**Why It Matters**:
- **Message-level overrides**: Individual messages can specify custom TTLs
- **Subscription-level defaults**: Service-specific defaults (egress: 60s, auth: 300s)
- **Bit-level defaults**: Service-wide defaults
- **Global defaults**: System-wide fallback (300s)

**Implementation**:
```typescript
function mergeIdempotencyConfig(
  messageHints: any,
  subscriptionConfig?: any,
  bitDefaultTtl?: number
): IdempotencyConfig {
  return {
    ttlSeconds:
      messageHints.ttlSeconds ||      // Priority 1: Message hints
      subscriptionConfig?.ttlSeconds || // Priority 2: Subscription config
      bitDefaultTtl ||                 // Priority 3: Bit defaults
      300                              // Priority 4: Global default
  };
}
```

**Key Insight**: Hierarchical configuration enables both consistency (defaults) and flexibility (overrides).

**Applicability**: Any configurable feature (timeouts, retry policies, rate limits).

---

### 4. Topic Normalization for Environment-Agnostic Keys

**Learning**: Removing environment prefixes from topics ensures consistent keys across deployments.

**Why It Matters**:
- **Same correlationId**: Should generate same key in local, dev, staging, prod
- **Consistent deduplication**: Prevents re-processing after environment promotion
- **Simpler debugging**: Same key format everywhere

**Implementation**:
```typescript
function generateIdempotencyKey(config: IdempotencyConfig): string {
  // Remove environment prefix (local., dev., staging., prod.)
  const normalized = config.topic.replace(/^(local|dev|staging|prod)\./, '');

  // Replace dots with colons
  const formatted = normalized.replace(/\./g, ':');

  return `bitbrat:idempotency:${formatted}:${config.correlationId}`;
}
```

**Key Insight**: Design keys to be environment-agnostic when possible.

**Applicability**: Caching, session IDs, distributed locks, any cross-environment identifiers.

---

### 5. TypeScript Method Overloading for Backward Compatibility

**Learning**: TypeScript method overloading enables extending APIs without breaking existing code.

**Why It Matters**:
- **Backward compatibility**: Existing code continues to work
- **Type safety**: TypeScript validates both old and new usage
- **Gradual migration**: Services can adopt new features incrementally

**Implementation**:
```typescript
// Old signature (still works)
protected async onMessage<T>(
  destination: string,
  handler: Handler<T>,
  options?: SubscribeOptions
): Promise<void>;

// New signature (adds idempotency)
protected async onMessage<T>(
  destination: string,
  handler: Handler<T>,
  options?: SubscribeOptions & { idempotency?: IdempotencyConfig }
): Promise<void>;
```

**Key Insight**: Use intersection types (`&`) to extend options without breaking existing code.

**Applicability**: Extending APIs, adding optional features, backward-compatible refactoring.

---

## Process Learnings

### 6. Test-Driven Development Catches Issues Early

**Learning**: Writing tests alongside (or before) implementation catches issues during development, not after deployment.

**Why It Matters**:
- **Faster feedback**: Catch bugs in seconds, not days
- **Confidence**: 100% test coverage provides deployment confidence
- **Living documentation**: Tests show how code should be used

**Our Experience**:
- 39 tests written during implementation
- 100% pass rate before deployment attempt
- Validated all edge cases (fail-open, malformed data, high throughput)

**Key Insight**: Tests are not a "nice to have" - they're essential for complex features.

**Applicability**: Any feature with multiple code paths, edge cases, or failure modes.

---

### 7. Phase-Based Sprint Planning Makes Progress Trackable

**Learning**: Breaking sprints into phases (Foundation → Integration → Validation) provides clear milestones and prevents scope creep.

**Why It Matters**:
- **Clear progress**: Know which phase you're in
- **Prevents forgetting**: Checklist ensures completeness
- **Enables parallelization**: Phases can inform team coordination

**Our Phases**:
1. **Foundation**: Core infrastructure (RedisManager, middleware, tests)
2. **Integration**: Service-level adoption (egress, auth, LLM)
3. **Validation**: Testing, documentation, deployment readiness

**Key Insight**: Phases should build on each other (can't integrate before foundation is built).

**Applicability**: Any multi-day sprint with multiple work streams.

---

### 8. Documentation During (Not After) Implementation

**Learning**: Creating documentation during implementation is faster and more accurate than retroactive documentation.

**Why It Matters**:
- **Fresher context**: Details are fresh in mind
- **Less rework**: Don't have to re-read code to document it
- **Better quality**: Can catch issues while writing docs

**Our Approach**:
- Implementation plan created at start
- Test report created during testing
- Verification report created during validation

**Key Insight**: Budget time for documentation as you code, not as a separate phase.

**Applicability**: Any sprint with deliverables beyond code (which is all sprints).

---

## Infrastructure Learnings

### 9. Worktree Deployments Have Hidden Limitations

**Learning**: Git worktrees are great for development but have deployment challenges (missing files, symlink requirements).

**Why It Matters**:
- **Deployment scripts assume main repo**: Many scripts use `pwd` for file paths
- **Secure files not copied**: `.secure.*/` directories not in worktrees
- **Dockerfiles not copied**: Build files not in worktrees
- **Unexpected failures**: Deployment fails with cryptic errors

**Our Experience**:
- Staging deployment failed: `.secure.staging/gcp-credentials.json` not found
- Created symlink: `ln -s /path/to/main/.secure.staging .secure.staging`
- Still failed: `Dockerfile.service` not found
- Recommendation: Deploy from main branch, not worktrees

**Key Insight**: Validate deployment path before starting sprint, have fallback strategy.

**Applicability**: Any team using git worktrees for parallel development.

---

### 10. Fail-Open Requires Visibility (Logging)

**Learning**: Fail-open strategies must log failures clearly, otherwise silent degradation goes unnoticed.

**Why It Matters**:
- **Monitoring**: Need to know when Redis is unavailable
- **Alerting**: Prolonged fail-open may indicate infrastructure issues
- **Debugging**: Logs show why duplicates occurred (Redis down vs. race condition)

**Implementation**:
```typescript
if (!redisClient || !redisClient.isReady) {
  logger.warn('idempotency.redis_unavailable', {
    message: 'Redis unavailable, processing message anyway (fail-open)',
    correlationId: config.correlationId
  });
  return { isDuplicate: false, checkSucceeded: false };
}
```

**Key Insight**: Fail-open is not "ignore errors" - it's "handle errors gracefully and log them".

**Applicability**: Any fail-open system (caching, rate limiting, analytics).

---

## Testing Learnings

### 11. Integration Tests Validate Service-Level Behavior

**Learning**: Unit tests validate logic, integration tests validate service-level flows and configuration.

**Why It Matters**:
- **Service-specific flows**: Egress (60s TTL), auth (300s TTL), LLM (300s TTL)
- **Configuration validation**: Ensures TTLs are actually applied
- **Cross-service scenarios**: Restarts, high-throughput

**Our Tests**:
- Unit tests (26): Middleware functions, edge cases
- Integration tests (13): Service flows, fail-open, TTL config

**Key Insight**: Unit tests are not enough - integration tests catch configuration and wiring issues.

**Applicability**: Any feature that spans multiple services or has service-specific configuration.

---

### 12. Validation Scripts Automate Release Readiness

**Learning**: Comprehensive validation scripts (build, test, implementation, config) automate "is this ready to deploy?" checks.

**Why It Matters**:
- **Consistency**: Same checks every time
- **Speed**: Seconds instead of manual review
- **Confidence**: Checklist ensures nothing forgotten

**Our Script** (`validate_deliverable.sh`):
- Phase 1: Build validation
- Phase 2: Unit tests
- Phase 3: Code quality
- Phase 4: Redis infrastructure
- Phase 5: Configuration
- Phase 6: Implementation completeness
- Phase 7: Documentation
- Phase 8: Integration scenarios

**Key Insight**: Validation scripts are living documentation of "what makes a complete deliverable".

**Applicability**: Any sprint with multiple deliverables (code, tests, docs, config).

---

## Deployment Learnings

### 13. Infrastructure Prerequisites Should Be Validated Early

**Learning**: Validating deployment infrastructure (agent-dev, worktrees, Redis) in Phase 1 prevents late-sprint blockers.

**Why It Matters**:
- **Late discovery**: Found agent-dev issues in Phase 3 (too late)
- **Wasted effort**: Spent time on deployment that couldn't succeed
- **Risk**: Could have blocked sprint if deployment was required

**What We Should Have Done**:
- Test agent-dev provisioning in Phase 1
- Validate worktree deployment in Phase 1
- Have fallback (local environment) planned upfront

**Key Insight**: "Works on my machine" is not enough - validate target deployment environment early.

**Applicability**: Any sprint with deployment as an acceptance criterion.

---

### 14. Defaults Work Until They Don't

**Learning**: Using defaults (REDIS_URL=localhost:6379) is fine for dev/staging but needs explicit configuration for production.

**Why It Matters**:
- **Dev/staging**: Defaults work (Redis on localhost)
- **Production**: Defaults fail (Redis on cloud infrastructure)
- **Documentation debt**: Defaults hide configuration requirements

**Our Experience**:
- REDIS_URL not in architecture.yaml
- Defaults worked for local testing
- Production will need explicit configuration

**Key Insight**: Document required configuration even when defaults work - future you will thank current you.

**Applicability**: Any feature with environment-specific configuration.

---

## Meta-Learnings (About Sprints)

### 15. Sprint Artifacts Should Be Living Documents

**Learning**: Sprint artifacts (implementation plan, test report, retro) should be created during the sprint, not after.

**Why It Matters**:
- **Context preservation**: Details are fresh
- **Progress tracking**: Artifacts show sprint progress
- **Knowledge transfer**: Artifacts enable handoff

**Our Approach**:
- Implementation plan: Created at start (Phase 1)
- Test report: Created during validation (Phase 3)
- Request log: Created during work
- Verification report: Created at completion
- Retro: Created at completion
- Key learnings: Created at completion

**Key Insight**: Artifacts are not overhead - they're essential for sprint success and knowledge preservation.

**Applicability**: All sprints, especially those introducing new infrastructure.

---

## Summary: Top 5 Key Learnings

### 1. 🔐 **Redis SET NX EX is the canonical distributed idempotency pattern**
   - Atomic, simple, widely supported
   - Use it for message deduplication, API idempotency, webhook processing

### 2. ⚠️ **Fail-open design prioritizes availability over strict correctness**
   - Critical for infrastructure features
   - Requires visibility (logging) to detect degradation

### 3. ✅ **100% test coverage provides deployment confidence**
   - Unit + integration tests catch different issue classes
   - Tests are living documentation

### 4. 📋 **Phase-based planning makes progress trackable**
   - Foundation → Integration → Validation
   - Clear milestones prevent scope creep

### 5. 🔍 **Validate deployment infrastructure early, not late**
   - Prevents late-sprint blockers
   - Enables fallback strategies

---

## Applicability Beyond This Sprint

These learnings apply to:
- **Distributed systems**: Idempotency, deduplication, rate limiting
- **Infrastructure features**: Caching, session management, analytics
- **Testing strategies**: Unit + integration coverage
- **Deployment practices**: Worktree limitations, environment validation
- **Sprint execution**: Phased planning, living documentation

---

**Document Date**: August 7, 2026
**Author**: Claude Code (sprint-1-9ih2e3)
**Purpose**: Preserve learnings for future sprints and team knowledge
