# Execution Plan: Progress Middleware Architecture Fix

**Sprint 36 - Implementation Strategy**
**Lead Implementor**: System
**Date**: 2026-08-31
**Approach**: Option A (Breaking Change)

---

## Overview

This execution plan outlines the concrete steps to implement the dual-phase lifecycle for FeedbackMiddleware, transforming it from a reactive "late detection" system to a proactive timer-based tracking system.

**Goal**: Progress messages arrive DURING long-running operations, not AFTER them.

**Strategy**: Sequential implementation with continuous testing, culminating in agent-dev validation before merge.

---

## Phase Breakdown

### Phase 1: Core Implementation (Tasks 1-6)
**Estimated time**: 4-6 hours
**Goal**: Implement dual-phase lifecycle methods

#### Tasks
1. **Add `startTracking()` method** - New public API for starting operation tracking
2. **Extract timer scheduling logic** - Refactor `startTracking()` into dedicated `scheduleTimers()` method
3. **Add `completeOperation()` method** - Clean public API for operation cleanup
4. **Update `llm-bot` integration** - Call `startTracking()` after annotation
5. **Update `base-server` integration** - Change `beforeNext()` → `completeOperation()`
6. **Remove `beforeNext()` method** - Breaking change: delete deprecated method

**Dependencies**: Sequential (each task depends on previous)

**Validation**: Code compiles, no runtime errors

---

### Phase 2: Cleanup (Tasks 7-8)
**Estimated time**: 1-2 hours
**Goal**: Simplify timer logic by removing reactive compensation

#### Tasks
7. **Remove Case 2 & 3 logic** - Delete late detection compensation in `scheduleTimers()`
8. **Simplify timer scheduling** - Remove `alreadyElapsedMs` calculations (always fresh operations)

**Dependencies**: Requires Phase 1 complete

**Validation**: Timer logic simplified, no conditional branches for "late detection"

---

### Phase 3: Testing (Tasks 9-14)
**Estimated time**: 4-6 hours
**Goal**: Comprehensive test coverage for dual-phase lifecycle

#### Tasks
9. **Unit tests: `startTracking()`** - Test proactive timer scheduling
10. **Unit tests: `completeOperation()`** - Test cleanup and idempotency
11. **Unit tests: Timer behavior** - Test timers fire at correct thresholds
12. **Unit tests: Edge cases** - Fast operations, late cleanup, duplicate calls
13. **Integration tests: End-to-end timing** - 35-second operation simulation
14. **Integration tests: Failure modes** - Redis down, NATS down, service crash

**Dependencies**: Requires Phase 2 complete

**Validation**: 100% test pass rate, > 95% code coverage on changed files

---

### Phase 4: Agent-Dev Validation (Tasks 15-17)
**Estimated time**: 2-3 hours
**Goal**: Validate with real Twitch traffic and image generation

#### Tasks
15. **Provision agent-dev context** - Create isolated test environment
16. **Deploy and test** - Deploy llm-bot, trigger image generation, validate timing
17. **Validate message ordering** - Confirm progress arrives before final response

**Dependencies**: Requires Phase 3 complete

**Validation**:
- Progress messages at T+2s, T+7s, T+12s, T+30s
- Final response at T+40s+ (after all progress)
- No race conditions observed

---

### Phase 5: Documentation (Tasks 18-20)
**Estimated time**: 2-3 hours
**Goal**: Update all documentation for new lifecycle

#### Tasks
18. **Update JSDoc comments** - Document new methods, deprecations
19. **Update CLAUDE.md** - Add development pattern for long-running operations
20. **Create lifecycle guide** - New doc: `feedback-middleware-lifecycle.md`

**Dependencies**: Can run parallel with Phase 1-4

**Validation**: Documentation complete, examples accurate

---

### Phase 6: Finalization (Tasks 21-22)
**Estimated time**: 1 hour
**Goal**: Prepare for merge and deployment

#### Tasks
21. **Code review prep** - Self-review, ensure all files changed are documented
22. **Create validation script** - Automated script for agent-dev validation

**Dependencies**: Requires Phase 1-5 complete

**Validation**: All deliverables ready for PR

---

## Execution Timeline

### Sequential Execution (Recommended)

```
Day 1 (6-8 hours):
├─ Phase 1: Core Implementation (4-6h)
│  ├─ Task 1: Add startTracking() [1h]
│  ├─ Task 2: Extract timer scheduling [1h]
│  ├─ Task 3: Add completeOperation() [30m]
│  ├─ Task 4: Update llm-bot integration [30m]
│  ├─ Task 5: Update base-server integration [30m]
│  └─ Task 6: Remove beforeNext() [30m]
│
└─ Phase 2: Cleanup (1-2h)
   ├─ Task 7: Remove Case 2 & 3 logic [1h]
   └─ Task 8: Simplify timer scheduling [1h]

Day 2 (6-8 hours):
├─ Phase 3: Testing (4-6h)
│  ├─ Task 9: Unit tests: startTracking() [1h]
│  ├─ Task 10: Unit tests: completeOperation() [1h]
│  ├─ Task 11: Unit tests: Timer behavior [1h]
│  ├─ Task 12: Unit tests: Edge cases [1h]
│  ├─ Task 13: Integration tests: End-to-end [1h]
│  └─ Task 14: Integration tests: Failure modes [1h]
│
└─ Phase 4: Agent-Dev Validation (2-3h)
   ├─ Task 15: Provision agent-dev context [30m]
   ├─ Task 16: Deploy and test [1-2h]
   └─ Task 17: Validate message ordering [30m]

Day 3 (3-4 hours):
├─ Phase 5: Documentation (2-3h)
│  ├─ Task 18: Update JSDoc comments [1h]
│  ├─ Task 19: Update CLAUDE.md [30m]
│  └─ Task 20: Create lifecycle guide [1h]
│
└─ Phase 6: Finalization (1h)
   ├─ Task 21: Code review prep [30m]
   └─ Task 22: Create validation script [30m]
```

**Total estimated time**: 15-20 hours (3 days)

---

### Parallel Execution (Advanced)

For faster delivery, documentation (Phase 5) can run parallel with implementation:

```
Day 1:
├─ Phase 1: Core Implementation (4-6h) [BLOCKING]
├─ Phase 5: Documentation (2-3h) [PARALLEL - start after architecture finalized]

Day 2:
├─ Phase 2: Cleanup (1-2h) [BLOCKING]
├─ Phase 3: Testing (4-6h) [BLOCKING]

Day 3:
├─ Phase 4: Agent-Dev Validation (2-3h) [BLOCKING]
├─ Phase 6: Finalization (1h) [BLOCKING]
```

**Total estimated time**: 12-18 hours (2.5 days with parallelization)

---

## Critical Path

Tasks that MUST complete before others can proceed:

```
Task 1 (startTracking)
  → Task 2 (scheduleTimers)
    → Task 3 (completeOperation)
      → Task 4 (llm-bot integration)
        → Task 5 (base-server integration)
          → Task 6 (remove beforeNext)
            → Task 7 (remove Case 2 & 3)
              → Task 8 (simplify timer logic)
                → Tasks 9-14 (testing)
                  → Tasks 15-17 (agent-dev validation)
                    → Task 21-22 (finalization)
```

**Documentation tasks (18-20)** can run in parallel with implementation.

---

## Risk Mitigation

### Risk 1: Timer scheduling breaks existing behavior

**Mitigation**:
- Keep existing tests passing during Phase 1
- Add new tests incrementally
- Validate after each task completion

**Fallback**: Revert to previous commit if timers don't fire

---

### Risk 2: Integration point in llm-bot incorrect

**Mitigation**:
- Review llm-bot code flow before Task 4
- Add debug logging at integration point
- Test with agent-dev immediately after integration

**Fallback**: Move integration point if needed (before analysis in architecture doc)

---

### Risk 3: Tests don't catch race conditions

**Mitigation**:
- Use jest fake timers (deterministic)
- Integration test with 35s simulation
- Agent-dev validation with real traffic

**Fallback**: Add stress tests with concurrent operations

---

### Risk 4: Agent-dev validation fails

**Mitigation**:
- Provision agent-dev early (Task 15)
- Test incremental changes (after Phase 1, Phase 2)
- Monitor logs in real-time

**Fallback**: Iterate on implementation before proceeding to Phase 6

---

## Quality Gates

Each phase has exit criteria that MUST be met before proceeding:

### Phase 1 Exit Criteria
- [ ] Code compiles with no TypeScript errors
- [ ] `startTracking()` method implemented and callable
- [ ] `completeOperation()` method implemented and callable
- [ ] llm-bot calls `startTracking()` after annotation
- [ ] base-server calls `completeOperation()` before publish
- [ ] `beforeNext()` method removed (breaking change complete)

### Phase 2 Exit Criteria
- [ ] Case 2 & 3 logic removed from codebase
- [ ] `scheduleTimers()` has no conditional branches for elapsed time
- [ ] Timer scheduling simplified (no reactive compensation)
- [ ] Code compiles and runs without errors

### Phase 3 Exit Criteria
- [ ] All unit tests pass (100% pass rate)
- [ ] All integration tests pass (100% pass rate)
- [ ] Code coverage > 95% on changed files
- [ ] No regressions in existing tests
- [ ] Edge cases covered (idempotency, cleanup, failures)

### Phase 4 Exit Criteria
- [ ] Agent-dev context provisioned and running
- [ ] llm-bot deployed successfully
- [ ] Image generation request tested (30+ second operation)
- [ ] Progress messages arrive at T+2s, T+7s, T+12s, T+30s
- [ ] Final response arrives after all progress (T+40s+)
- [ ] No race conditions observed (progress never after final)
- [ ] Logs show clean execution (no errors, warnings expected)

### Phase 5 Exit Criteria
- [ ] All JSDoc comments updated
- [ ] CLAUDE.md pattern added and accurate
- [ ] `feedback-middleware-lifecycle.md` created
- [ ] Examples in docs tested and work

### Phase 6 Exit Criteria
- [ ] All code reviewed (self-review checklist complete)
- [ ] Validation script created and tested
- [ ] Sprint artifacts complete (execution plan, backlog, architecture)
- [ ] Ready for PR creation

---

## Rollback Strategy

If any phase fails and cannot be fixed quickly:

### Immediate Rollback
```bash
# 1. Check current state
git status

# 2. Discard all changes (if not committed)
git restore .

# 3. If committed, revert
git log --oneline -5
git revert <commit-hash>
```

### Partial Rollback
- Phase 1 fails → Revert to clean state, re-analyze integration points
- Phase 2 fails → Keep Phase 1, don't remove Case 2 & 3 (degraded but working)
- Phase 3 fails → Fix tests, don't proceed to validation
- Phase 4 fails → Iterate on implementation, don't proceed to finalization

---

## Testing Strategy

### Unit Tests (Tasks 9-12)

**Framework**: Jest with fake timers

**Coverage targets**:
- `startTracking()`: 100%
- `completeOperation()`: 100%
- `scheduleTimers()`: 100%
- Timer callbacks: 100%

**Key scenarios**:
- Fresh operation → timers scheduled correctly
- Fast operation (< 2s) → no progress sent
- Long operation (35s) → all progress messages sent
- Multiple `startTracking()` calls → idempotent
- `completeOperation()` before timer → no messages sent
- `completeOperation()` never called → max lifetime cleanup

### Integration Tests (Tasks 13-14)

**Framework**: Jest with mocked dependencies

**Coverage targets**:
- End-to-end timing validation
- Failure mode handling (Redis down, NATS down)
- Message ordering verification

**Key scenarios**:
- 35-second operation → 7 progress messages (initial + 5 updates + timeout)
- 1-second operation → 0 progress messages
- Redis unavailable → progress uses in-memory state
- NATS unavailable → error logged, operation continues
- Service crash → graceful shutdown clears timers

### Agent-Dev Validation (Tasks 15-17)

**Environment**: Isolated Docker context

**Test cases**:
1. **Image generation** (30-40s operation)
   - Expected: Progress at T+2s, T+7s, T+12s, T+30s, final at T+40s
   - Validation: Twitch chat message ordering

2. **Fast LLM response** (< 2s)
   - Expected: No progress, immediate response
   - Validation: No extra messages

3. **Multiple concurrent operations**
   - Expected: Each tracked independently
   - Validation: Logs show separate tracking states

**Success criteria**:
- 100% correct message ordering (no race conditions)
- Timers fire within ±100ms of expected
- Logs show clean execution

---

## Deliverables

### Code Changes
- [ ] `src/common/middleware/feedback-middleware.ts` - Core implementation
- [ ] `src/apps/llm-bot-service.ts` - Integration point
- [ ] `src/common/base-server.ts` - Integration point
- [ ] `src/common/middleware/feedback-middleware.test.ts` - Unit tests
- [ ] `src/common/middleware/feedback-middleware.integration.test.ts` - Integration tests

### Documentation
- [ ] JSDoc comments (inline)
- [ ] `CLAUDE.md` - Development pattern
- [ ] `documentation/concepts/feedback-middleware-lifecycle.md` - Lifecycle guide

### Sprint Artifacts
- [x] `technical-architecture.md` - Architecture analysis
- [x] `execution-plan.md` - This document
- [ ] `backlog.yaml` - Prioritized task list
- [ ] `validation-script.sh` - Agent-dev validation automation
- [ ] `implementation-plan.md` - Detailed implementation steps
- [ ] `verification-report.md` - Test results and validation
- [ ] `retrospective.md` - Lessons learned

---

## Success Metrics

### Code Quality
- [ ] TypeScript compiles with 0 errors
- [ ] ESLint passes with 0 warnings
- [ ] Test coverage > 95% on changed files
- [ ] All tests pass (unit + integration)

### Functional Correctness
- [ ] Progress messages arrive during operations (verified in agent-dev)
- [ ] Message ordering deterministic (100% correct in testing)
- [ ] No race conditions (verified in agent-dev)
- [ ] Timers cleared on completion (verified in unit tests)
- [ ] Memory leaks prevented (verified in unit tests)

### Performance
- [ ] Memory per operation < 10 KB (measured in tests)
- [ ] Timer overhead < 1% CPU (benchmark in agent-dev)
- [ ] Progress message latency < 100ms (measured in agent-dev)

---

## Communication Plan

### During Implementation
- Update sprint status as phases complete
- Log issues/blockers in request-log.md
- Document decisions in implementation-plan.md

### After Validation
- Create verification-report.md with test results
- Update sprint manifest with completion status
- Prepare PR description with summary

### Post-Merge
- Create retrospective.md with lessons learned
- Update sprint index
- Document any follow-up work needed

---

## Next Steps

1. **Review this execution plan** - Validate approach, timeline, tasks
2. **Get approval** - Confirm breaking change acceptable, timeline realistic
3. **Create backlog.yaml** - Convert tasks to trackable YAML format
4. **Begin Phase 1** - Start implementation with Task 1

**Ready to proceed**: Waiting for approval to start implementation.

---

**End of Execution Plan**

**Status**: READY FOR IMPLEMENTATION
**Estimated delivery**: 3 days (sequential) or 2.5 days (parallel)
**Risk level**: LOW (well-defined tasks, comprehensive testing, clear rollback)
