# Execution Plan: Agent-Centric Logging Implementation

> **Status:** Ready for Execution
> **Created:** 2026-07-10
> **Technical Architecture:** `documentation/technical-architecture/agent-centric-logging-v1.md`
> **Estimated Duration:** 2-3 weeks (with staged rollout)
> **Team Size:** 1-2 developers

---

## Executive Summary

This execution plan breaks down the Agent-Centric Logging v1 Technical Architecture into deliverable tasks with clear dependencies, estimates, and success criteria. The implementation uses AsyncLocalStorage to provide automatic correlationId propagation, solving the 60% missing correlationId problem and enabling reliable fleet observability.

**Strategic Approach:** Incremental, backward-compatible implementation with continuous validation.

---

## Critical Path Analysis

### Dependencies Map

```
Foundation (Phase 1)
    ↓
Message Handler Integration (Phase 2)
    ↓
    ├─→ HTTP Integration (Phase 2b)
    └─→ Service Cleanup (Phase 3) [Optional, can run in parallel]
         ↓
Enhanced Context (Phase 4) [Optional, future sprint]
```

### Blocker Analysis

| Component | Blocks | Risk Level | Mitigation |
|-----------|--------|------------|------------|
| EventContext creation | Everything | LOW | Simple, well-understood pattern |
| Logger enhancement | Phase 2+ | LOW | Additive only, no breaking changes |
| BaseServer.onMessage() | Service integration | MEDIUM | Core message handling, needs testing |
| HTTP middleware | HTTP endpoints | MEDIUM | Express middleware pattern |

### Critical Path

1. **EventContext Infrastructure** (Day 1-2)
   - Cannot proceed without this foundation
   - Low risk, straightforward implementation

2. **Logger Enhancement** (Day 2-3)
   - Depends on EventContext
   - Must maintain backward compatibility

3. **BaseServer Integration** (Day 3-5)
   - Highest risk component
   - All services depend on this working correctly
   - Requires extensive testing

4. **Validation & Rollout** (Day 6-10)
   - Staged deployment critical for risk management
   - Fleet observability validation

---

## Phase Breakdown

### Phase 1: Foundation Infrastructure

**Goal:** Create AsyncLocalStorage infrastructure without breaking anything

**Duration:** 2 days

**Tasks:**
1. Create event-context.ts module
2. Enhance Logger.base() method
3. Write unit tests for event context
4. Write unit tests for logger enhancement
5. Update type definitions
6. Document usage patterns

**Success Criteria:**
- ✅ EventContext module compiles without errors
- ✅ All existing tests pass
- ✅ New unit tests achieve >95% coverage
- ✅ Logger works with and without context

**Deliverables:**
- `src/common/event-context.ts`
- `src/common/event-context.test.ts`
- Updated `src/common/logging.ts`
- Updated `src/common/logging.test.ts`

---

### Phase 2: Message Handler Integration

**Goal:** Automatic context injection for all message handlers

**Duration:** 3 days

**Tasks:**
1. Update BaseServer.onMessage() with context wrapping
2. Extract correlation fields from message data
3. Handle edge cases (missing correlationId, malformed data)
4. Write integration tests for message handlers
5. Add error handling and logging
6. Performance benchmarking

**Success Criteria:**
- ✅ All message handlers automatically get context
- ✅ CorrelationId extracted from InternalEventV2
- ✅ Performance overhead < 1%
- ✅ Graceful fallback when correlationId missing
- ✅ Integration tests pass

**Deliverables:**
- Updated `src/common/base-server.ts` (onMessage method)
- New `src/common/base-server.context.test.ts`
- Performance benchmark results

---

### Phase 2b: HTTP Request Integration

**Goal:** Automatic context injection for HTTP routes

**Duration:** 2 days

**Tasks:**
1. Create HTTP context middleware
2. Extract correlation headers (x-correlation-id, x-request-id)
3. Generate correlationId when missing
4. Integrate middleware in BaseServer setup
5. Write tests for HTTP context extraction
6. Test with Express request/response cycle

**Success Criteria:**
- ✅ All HTTP requests get automatic context
- ✅ Headers properly extracted
- ✅ UUID generation for missing correlationId
- ✅ Middleware integrates seamlessly
- ✅ Tests cover edge cases

**Deliverables:**
- HTTP context middleware in `base-server.ts`
- HTTP integration tests
- Updated Express setup

---

### Phase 3: Validation & Staging Deployment

**Goal:** Validate in staging environment with real traffic

**Duration:** 3 days

**Tasks:**
1. Build and deploy to staging
2. Enable for single service (reflex)
3. Monitor logs for correlationId coverage
4. Run fleet.trace validation tests
5. Check performance metrics
6. Validate OpenTelemetry interaction
7. Document any issues found

**Success Criteria:**
- ✅ 100% of logs in test service have correlationId
- ✅ fleet.trace reconstructs complete timelines
- ✅ No performance degradation observed
- ✅ OpenTelemetry correlation still works
- ✅ No errors or warnings in logs

**Deliverables:**
- Staging deployment
- Validation test results
- Performance metrics report
- Issue log (if any)

---

### Phase 4: Production Rollout

**Goal:** Gradual rollout to production with monitoring

**Duration:** 5 days

**Tasks:**
1. Deploy to production (all services)
2. Monitor correlationId coverage metrics
3. Run automated fleet observability tests
4. Monitor performance and errors
5. Validate cross-service tracing
6. Document rollout outcomes
7. Create runbook for troubleshooting

**Success Criteria:**
- ✅ Zero production incidents
- ✅ CorrelationId coverage increases to near 100%
- ✅ fleet.trace works reliably
- ✅ Performance within acceptable bounds
- ✅ All services logging correctly

**Deliverables:**
- Production deployment
- Monitoring dashboard updates
- Rollout report
- Troubleshooting runbook

---

### Phase 5: Service Cleanup (Optional)

**Goal:** Remove manual correlationId passing from services

**Duration:** 3 days (can be separate sprint)

**Tasks:**
1. Audit all services for manual correlationId
2. Create cleanup checklist per service
3. Remove redundant correlationId parameters
4. Update tests to remove manual context
5. Deploy cleaned services incrementally
6. Validate logs unchanged (deduplication working)

**Success Criteria:**
- ✅ Code is cleaner and more maintainable
- ✅ No functionality regression
- ✅ Logs identical before/after cleanup
- ✅ Developer feedback positive

**Deliverables:**
- Cleaned service code
- Updated tests
- Code review approval
- Deployment verification

---

## Detailed Task Backlog

### Sprint Backlog (Priority Order)

#### Epic 1: Foundation Infrastructure

**Story 1.1: Create EventContext Module**
- **Priority:** P0 (Blocker)
- **Estimate:** 4 hours
- **Assignee:** TBD
- **Description:** Create `src/common/event-context.ts` with AsyncLocalStorage-based context management
- **Acceptance Criteria:**
  - [ ] Module exports EventContext interface
  - [ ] runWithEventContext function works correctly
  - [ ] getEventContext retrieves current context
  - [ ] updateEventContext merges updates
  - [ ] Context isolated per async call chain
- **Dependencies:** None
- **Files:**
  - CREATE `src/common/event-context.ts`

**Story 1.2: Write EventContext Unit Tests**
- **Priority:** P0 (Blocker)
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Comprehensive unit tests for event context propagation
- **Acceptance Criteria:**
  - [ ] Test context propagation through async/await
  - [ ] Test context isolation between calls
  - [ ] Test updateEventContext merging
  - [ ] Test getEventContext outside context returns undefined
  - [ ] Test nested context calls
  - [ ] Coverage > 95%
- **Dependencies:** Story 1.1
- **Files:**
  - CREATE `src/common/event-context.test.ts`

**Story 1.3: Enhance Logger with EventContext**
- **Priority:** P0 (Blocker)
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Update Logger.base() to automatically inject EventContext fields
- **Acceptance Criteria:**
  - [ ] Logger imports and uses getEventContext
  - [ ] correlationId added when present
  - [ ] traceId, sessionId, userId added when present
  - [ ] stage field added when present
  - [ ] Backward compatible (works without context)
  - [ ] Does not override OTel fields
  - [ ] Handles exceptions gracefully
- **Dependencies:** Story 1.1
- **Files:**
  - UPDATE `src/common/logging.ts` (line 96-109)

**Story 1.4: Write Logger Enhancement Tests**
- **Priority:** P0 (Blocker)
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Unit tests for Logger with EventContext integration
- **Acceptance Criteria:**
  - [ ] Test Logger includes correlationId from context
  - [ ] Test Logger works without context (backward compat)
  - [ ] Test all context fields (traceId, sessionId, userId, stage)
  - [ ] Test OTel fields take precedence
  - [ ] Test exception handling
  - [ ] Coverage > 95%
- **Dependencies:** Story 1.3
- **Files:**
  - UPDATE `src/common/logging.test.ts`

**Story 1.5: Update Type Definitions**
- **Priority:** P1
- **Estimate:** 1 hour
- **Assignee:** TBD
- **Description:** Ensure TypeScript types are correct and exported
- **Acceptance Criteria:**
  - [ ] EventContext interface exported
  - [ ] All functions properly typed
  - [ ] No type errors in dependent code
  - [ ] JSDoc comments added
- **Dependencies:** Story 1.1, 1.3
- **Files:**
  - UPDATE `src/common/event-context.ts`
  - UPDATE `src/types/index.ts` (if needed)

---

#### Epic 2: Message Handler Integration

**Story 2.1: Update BaseServer.onMessage() with Context Wrapping**
- **Priority:** P0 (Blocker)
- **Estimate:** 6 hours
- **Assignee:** TBD
- **Description:** Wrap message handlers to automatically inject EventContext
- **Acceptance Criteria:**
  - [ ] Import runWithEventContext in base-server.ts
  - [ ] Create wrappedHandler function
  - [ ] Extract correlationId from message data
  - [ ] Extract traceId, sessionId, userId if present
  - [ ] Build EventContext object
  - [ ] Wrap handler execution with context
  - [ ] Maintain existing message handler behavior
  - [ ] Handle missing correlationId gracefully
  - [ ] Preserve error handling and acknowledgment
- **Dependencies:** Epic 1 complete
- **Files:**
  - UPDATE `src/common/base-server.ts` (onMessage method, ~line 500-600)

**Story 2.2: Handle Edge Cases**
- **Priority:** P0 (Blocker)
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Robust handling of malformed/missing data
- **Acceptance Criteria:**
  - [ ] Handle undefined/null data
  - [ ] Handle missing correlationId
  - [ ] Handle malformed message structure
  - [ ] Handle type cast failures
  - [ ] Log warnings for missing context (debug level)
  - [ ] Never throw exceptions in context extraction
- **Dependencies:** Story 2.1
- **Files:**
  - UPDATE `src/common/base-server.ts`

**Story 2.3: Write Message Handler Integration Tests**
- **Priority:** P0 (Blocker)
- **Estimate:** 4 hours
- **Assignee:** TBD
- **Description:** Integration tests for automatic context injection
- **Acceptance Criteria:**
  - [ ] Test message with correlationId auto-injects context
  - [ ] Test message without correlationId works
  - [ ] Test nested async operations maintain context
  - [ ] Test multiple handlers don't interfere
  - [ ] Test error handling preserves context
  - [ ] Test acknowledgment works correctly
  - [ ] Coverage > 90%
- **Dependencies:** Story 2.1, 2.2
- **Files:**
  - CREATE `src/common/base-server.context.test.ts`

**Story 2.4: Performance Benchmarking**
- **Priority:** P1
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Measure AsyncLocalStorage overhead
- **Acceptance Criteria:**
  - [ ] Benchmark message handler with/without context
  - [ ] Measure latency impact (<1ms acceptable)
  - [ ] Measure throughput impact (<1% acceptable)
  - [ ] Measure memory impact
  - [ ] Document results
  - [ ] Create performance regression test
- **Dependencies:** Story 2.1
- **Files:**
  - CREATE `src/common/base-server.benchmark.ts`
  - CREATE `docs/performance-benchmarks.md`

---

#### Epic 3: HTTP Request Integration

**Story 3.1: Create HTTP Context Middleware**
- **Priority:** P1
- **Estimate:** 4 hours
- **Assignee:** TBD
- **Description:** Express middleware to extract context from HTTP headers
- **Acceptance Criteria:**
  - [ ] Extract x-correlation-id header
  - [ ] Extract x-request-id header
  - [ ] Extract x-cloud-trace-context header
  - [ ] Extract x-session-id header
  - [ ] Generate UUID if correlationId missing
  - [ ] Build EventContext object
  - [ ] Wrap next() with runWithEventContext
  - [ ] Handle exceptions gracefully
- **Dependencies:** Epic 1 complete
- **Files:**
  - UPDATE `src/common/base-server.ts` (add setupHttpContextMiddleware method)

**Story 3.2: Integrate HTTP Middleware in BaseServer**
- **Priority:** P1
- **Estimate:** 2 hours
- **Assignee:** TBD
- **Description:** Call middleware setup during BaseServer initialization
- **Acceptance Criteria:**
  - [ ] Call setupHttpContextMiddleware in constructor/setup
  - [ ] Middleware registered before routes
  - [ ] Middleware applies to all routes
  - [ ] Does not interfere with existing middleware
  - [ ] Works with Express error handling
- **Dependencies:** Story 3.1
- **Files:**
  - UPDATE `src/common/base-server.ts` (constructor/setup method)

**Story 3.3: Write HTTP Context Tests**
- **Priority:** P1
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Test HTTP request context extraction end-to-end
- **Acceptance Criteria:**
  - [ ] Test header extraction works
  - [ ] Test UUID generation for missing headers
  - [ ] Test context propagates to route handlers
  - [ ] Test context propagates to logger
  - [ ] Test multiple requests don't interfere
  - [ ] Test error cases
  - [ ] Coverage > 90%
- **Dependencies:** Story 3.2
- **Files:**
  - CREATE `src/common/base-server.http-context.test.ts`

---

#### Epic 4: Validation & Testing

**Story 4.1: Create End-to-End Fleet Trace Test**
- **Priority:** P0 (Blocker)
- **Estimate:** 4 hours
- **Assignee:** TBD
- **Description:** Validate fleet.trace works with automatic correlation
- **Acceptance Criteria:**
  - [ ] Publish test event to ingress
  - [ ] Wait for processing across services
  - [ ] Query fleet.trace with correlationId
  - [ ] Verify all services present in trace
  - [ ] Verify timeline complete and ordered
  - [ ] Verify every log entry has correlationId
  - [ ] Test passes reliably
- **Dependencies:** Epic 2 complete
- **Files:**
  - CREATE `src/__tests__/integration/fleet-trace-correlation.test.ts`

**Story 4.2: Create Staging Validation Script**
- **Priority:** P0 (Blocker)
- **Estimate:** 3 hours
- **Assignee:** TBD
- **Description:** Automated validation script for staging deployment
- **Acceptance Criteria:**
  - [ ] Script deploys to staging
  - [ ] Script runs test traffic through system
  - [ ] Script validates correlationId coverage
  - [ ] Script queries fleet.logs and fleet.trace
  - [ ] Script measures performance metrics
  - [ ] Script generates validation report
  - [ ] Script exits with proper status code
- **Dependencies:** Epic 2, Epic 3 complete
- **Files:**
  - CREATE `scripts/validate-logging-coverage.sh`

**Story 4.3: Performance Monitoring Setup**
- **Priority:** P1
- **Estimate:** 2 hours
- **Assignee:** TBD
- **Description:** Add metrics to track correlation coverage and performance
- **Acceptance Criteria:**
  - [ ] Metric: percentage of logs with correlationId
  - [ ] Metric: context extraction time
  - [ ] Metric: logger overhead
  - [ ] Dashboard updated
  - [ ] Alerts configured for degradation
- **Dependencies:** None (can run in parallel)
- **Files:**
  - UPDATE monitoring configuration

---

#### Epic 5: Documentation & Rollout

**Story 5.1: Update Developer Documentation**
- **Priority:** P1
- **Estimate:** 2 hours
- **Assignee:** TBD
- **Description:** Document the new context propagation system
- **Acceptance Criteria:**
  - [ ] Update CLAUDE.md with context usage
  - [ ] Add examples to documentation
  - [ ] Document migration path
  - [ ] Document troubleshooting steps
  - [ ] Update architecture diagrams
- **Dependencies:** Epic 2, Epic 3 complete
- **Files:**
  - UPDATE `CLAUDE.md`
  - CREATE `documentation/guides/event-context-usage.md`

**Story 5.2: Create Troubleshooting Runbook**
- **Priority:** P1
- **Estimate:** 2 hours
- **Assignee:** TBD
- **Description:** Runbook for diagnosing context propagation issues
- **Acceptance Criteria:**
  - [ ] Document common issues
  - [ ] Document diagnostic commands
  - [ ] Document how to check context in logs
  - [ ] Document how to validate fleet.trace
  - [ ] Document rollback procedure
- **Dependencies:** Validation testing complete
- **Files:**
  - CREATE `documentation/runbooks/event-context-troubleshooting.md`

**Story 5.3: Staged Production Rollout**
- **Priority:** P0 (Blocker)
- **Estimate:** 8 hours (across multiple days)
- **Assignee:** TBD
- **Description:** Gradual rollout to production with monitoring
- **Acceptance Criteria:**
  - [ ] Build production images
  - [ ] Deploy to production (all services)
  - [ ] Monitor for 24 hours
  - [ ] Run validation tests
  - [ ] Check correlationId coverage metrics
  - [ ] Verify fleet.trace works
  - [ ] Verify performance acceptable
  - [ ] Document any issues
  - [ ] Rollback plan ready
- **Dependencies:** Staging validation passed
- **Files:**
  - Deployment artifacts

---

#### Epic 6: Service Cleanup (Optional/Future Sprint)

**Story 6.1: Audit Services for Manual CorrelationId**
- **Priority:** P2 (Nice to Have)
- **Estimate:** 4 hours
- **Assignee:** TBD
- **Description:** Find all places where correlationId is manually passed
- **Acceptance Criteria:**
  - [ ] Grep/search for correlationId patterns
  - [ ] Create checklist per service
  - [ ] Identify routing helpers to update
  - [ ] Prioritize by service importance
  - [ ] Document cleanup plan
- **Dependencies:** Production rollout complete
- **Files:**
  - CREATE `planning/service-cleanup-checklist.md`

**Story 6.2: Clean Up High-Priority Services**
- **Priority:** P2
- **Estimate:** 6 hours
- **Assignee:** TBD
- **Description:** Remove manual correlationId from core services
- **Acceptance Criteria:**
  - [ ] Remove correlationId from llm-bot logs
  - [ ] Remove correlationId from event-router logs
  - [ ] Remove correlationId from reflex logs
  - [ ] Update tests
  - [ ] Verify logs unchanged (deduplication working)
  - [ ] Code review approval
  - [ ] Deploy incrementally
- **Dependencies:** Story 6.1
- **Files:**
  - UPDATE `src/apps/llm-bot-service.ts`
  - UPDATE `src/apps/event-router-service.ts`
  - UPDATE `src/apps/reflex-service.ts`

---

## Task Summary & Estimates

### By Epic

| Epic | Stories | Total Estimate | Priority |
|------|---------|---------------|----------|
| Epic 1: Foundation | 5 | 14 hours (~2 days) | P0 |
| Epic 2: Message Handlers | 4 | 16 hours (~2 days) | P0 |
| Epic 3: HTTP Integration | 3 | 9 hours (~1 day) | P1 |
| Epic 4: Validation | 3 | 9 hours (~1 day) | P0 |
| Epic 5: Documentation & Rollout | 3 | 12 hours (~2 days) | P0/P1 |
| Epic 6: Cleanup (Optional) | 2 | 10 hours (~1.5 days) | P2 |
| **Total Core Work** | **18** | **60 hours** | **~8-10 days** |
| **Total with Cleanup** | **20** | **70 hours** | **~9-12 days** |

### By Priority

| Priority | Stories | Estimate | Description |
|----------|---------|----------|-------------|
| P0 (Blocker) | 12 | 48 hours | Must complete for MVP |
| P1 (Important) | 6 | 12 hours | Should complete in sprint |
| P2 (Nice to Have) | 2 | 10 hours | Future sprint |

---

## Risk Management

### High-Impact Risks

**Risk 1: Context Propagation Bugs**
- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:**
  - Extensive unit and integration tests
  - Staged rollout (staging → production)
  - Feature flag to disable if issues found
  - Monitoring and alerts
- **Contingency:** Rollback mechanism, disable wrapping

**Risk 2: Performance Degradation**
- **Likelihood:** Low
- **Impact:** Medium
- **Mitigation:**
  - Benchmark before deployment
  - Monitor latency and throughput
  - Set SLO: <1% overhead
  - Performance regression tests
- **Contingency:** Optimize context extraction, disable if >2% overhead

**Risk 3: OpenTelemetry Interaction**
- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:**
  - Test both OTel and EventContext paths
  - Ensure OTel fields take precedence
  - Validate Cloud Logging linkage
  - Integration tests cover both scenarios
- **Contingency:** Prioritize OTel correlation, EventContext as fallback

**Risk 4: Memory Leaks**
- **Likelihood:** Low
- **Impact:** High
- **Mitigation:**
  - AsyncLocalStorage automatically cleans up
  - Memory profiling in staging
  - Monitor memory usage in production
  - Load testing
- **Contingency:** Identify and fix leak, rollback if critical

---

## Success Metrics

### Quantitative Metrics

| Metric | Baseline | Target | Measurement Method |
|--------|----------|--------|-------------------|
| CorrelationId Coverage | ~40% | >95% | Log sampling + analysis |
| fleet.trace Success Rate | Unknown | >99% | Automated tests |
| Logger Performance Overhead | 0 | <1% | Benchmark suite |
| Production Incidents | 0 | 0 | Incident tracker |
| Test Coverage | ~80% | >90% | Jest coverage report |

### Qualitative Metrics

| Metric | Assessment Method |
|--------|-------------------|
| Developer Satisfaction | Survey post-rollout |
| Code Maintainability | Code review feedback |
| Documentation Quality | Developer feedback |
| Troubleshooting Ease | Support ticket volume |

---

## Rollout Strategy

### Phase A: Local Development (Day 1-7)

**Goal:** Complete implementation and testing

- Days 1-2: Epic 1 (Foundation)
- Days 3-4: Epic 2 (Message Handlers)
- Day 5: Epic 3 (HTTP Integration)
- Days 6-7: Epic 4 (Validation & Testing)

**Gate:** All tests pass, benchmarks acceptable

### Phase B: Staging Deployment (Day 8-9)

**Goal:** Validate in staging with real traffic

- Day 8: Deploy to staging
- Day 8: Run validation script
- Day 8-9: Monitor for 24 hours
- Day 9: Analyze results

**Gate:**
- ✅ >95% correlationId coverage
- ✅ fleet.trace works reliably
- ✅ No performance degradation
- ✅ Zero errors

### Phase C: Production Rollout (Day 10-12)

**Goal:** Deploy to production with monitoring

- Day 10: Deploy to production
- Day 10-12: Monitor continuously
- Day 11: Run validation tests
- Day 12: Sign-off

**Gate:**
- ✅ Zero production incidents
- ✅ CorrelationId coverage >95%
- ✅ Performance within SLO
- ✅ fleet.trace working

### Phase D: Documentation & Cleanup (Day 13-15, Optional)

**Goal:** Complete documentation and remove manual code

- Day 13: Complete documentation (Epic 5.1, 5.2)
- Day 14-15: Service cleanup (Epic 6)

---

## Testing Strategy

### Test Pyramid

```
        E2E Fleet Tests (1)
           /        \
    Integration Tests (5)
         /              \
   Unit Tests (15)
```

### Test Categories

**Unit Tests (~15 tests):**
- EventContext propagation
- EventContext isolation
- EventContext updates
- Logger context injection
- Logger backward compatibility
- Logger field priority (OTel > EventContext)
- Context extraction from messages
- Context extraction from HTTP headers

**Integration Tests (~5 tests):**
- BaseServer.onMessage context wrapping
- HTTP middleware context wrapping
- Nested async operations
- Multiple concurrent handlers
- Error handling preserves context

**End-to-End Tests (~1 test):**
- Full event flow: ingress → router → llm-bot → egress
- fleet.trace reconstruction
- Cross-service correlation

### Test Automation

**Continuous:**
- Unit tests run on every commit
- Integration tests run on PR
- E2E tests run nightly

**Pre-Deployment:**
- Full test suite must pass
- Performance benchmarks must pass
- Staging validation must pass

---

## Definition of Done

### Per Story

- [ ] Code complete and reviewed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (if applicable)
- [ ] Documentation updated
- [ ] No new TypeScript errors
- [ ] Performance benchmarks pass
- [ ] PR approved and merged

### Per Epic

- [ ] All stories complete
- [ ] Epic-level integration tests pass
- [ ] Epic documentation complete
- [ ] Code coverage targets met
- [ ] Performance validated

### Overall Sprint

- [ ] All P0 stories complete
- [ ] All tests passing
- [ ] Staging validation successful
- [ ] Production deployment successful
- [ ] 24-hour monitoring clean
- [ ] Documentation complete
- [ ] Retrospective conducted

---

## Retrospective Questions

**At sprint completion:**

1. Did we achieve >95% correlationId coverage?
2. Did fleet.trace work reliably?
3. Was performance impact acceptable?
4. Were there any production incidents?
5. What surprised us during implementation?
6. What would we do differently next time?
7. What should we improve in the next sprint?

---

## Appendix: Command Reference

### Build & Test

```bash
# Run unit tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- event-context.test.ts

# Run integration tests only
npm test -- --testPathPattern=integration

# Build
npm run build

# Lint
npm run lint
```

### Staging Deployment

```bash
# Deploy to staging
npm run brat -- deploy services --all --target staging

# Validate deployment
./scripts/validate-logging-coverage.sh staging

# Check fleet trace
npm run brat -- fleet trace <correlationId>

# Check fleet logs
npm run brat -- fleet logs --bit llm-bot --level error --since 1h
```

### Production Deployment

```bash
# Deploy to production
npm run brat -- deploy services --all --target production

# Monitor deployment
npm run brat -- fleet list
npm run brat -- fleet health --all

# Rollback if needed
git revert <commit>
npm run brat -- deploy services --all --target production
```

---

## Conclusion

This execution plan provides a clear, incremental path to implementing agent-centric logging with automatic correlationId propagation. The staged approach minimizes risk while delivering high value: reliable fleet observability and zero developer burden for correlation tracking.

**Recommended Start:** Begin with Epic 1 (Foundation) and proceed sequentially through Epic 4 (Validation) for the core MVP. Epic 5 (Documentation) and Epic 6 (Cleanup) can be completed in parallel or as follow-on work.

**Expected Outcome:** 100% correlationId coverage, reliable fleet.trace operation, and a foundation for future agent-centric features (policy logging, evidence capture, introspection).
