# Execution Plan — Scheduler Redesign (Sprint 369)

**Lead Implementor**: Claude Code
**Date**: 2026-07-26
**Sprint**: 369
**Estimated Duration**: 3-4 days

---

## Overview

This execution plan breaks down the scheduler redesign into discrete, accomplishable tasks organized by implementation phase. Each task is scoped to be completable in 15-60 minutes and includes clear acceptance criteria.

---

## Task Sequencing Strategy

### Sequential Dependencies (Must Complete in Order)

1. **Core Implementation** → **Tests** → **Documentation** → **Observability**
2. Within each phase, tasks can be parallelized where dependencies allow

### Critical Path

```
Task 1.1 (Ticker) → Task 1.2 (Lifecycle) → Task 1.3 (Publisher Cache)
  → Task 2.1 (Unit Tests) → Task 2.4 (Integration Tests)
  → Task 4.1 (Deployment)
```

**Estimated Critical Path Duration**: 6-8 hours of focused development time

---

## Phase 1: Core Implementation (P0 - Blocking)

**Goal**: Replace GCP Cloud Scheduler dependency with internal timer
**Estimated Time**: 3-4 hours
**Blocking**: All subsequent phases depend on this

### Task Breakdown

#### 1.1: Add Internal Ticker Mechanism
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 45 minutes
**Dependencies**: None

**Changes**:
- Add private instance variables:
  - `tickInterval: ReturnType<typeof setInterval> | null = null`
  - `TICK_INTERVAL_MS: number` (read from env, default 60000)
- Add `startTicker()` method with `setInterval()` logic
- Call `startTicker()` from `setup()` lifecycle hook
- Add error handling (try/catch around `handleTick()`)
- Add logging: `scheduler.ticker.starting`, `scheduler.tick.interval`

**Acceptance Criteria**:
- ✅ Ticker starts automatically on service startup
- ✅ `handleTick()` is called every `TICK_INTERVAL_MS` milliseconds
- ✅ Errors in `handleTick()` are logged but don't crash service
- ✅ Logs include interval configuration

**Code Location**: Lines 177-214 (constructor and setupApp methods)

---

#### 1.2: Implement Graceful Shutdown
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 30 minutes
**Dependencies**: Task 1.1

**Changes**:
- Add `stopTicker()` method with `clearInterval()` logic
- Override `stop()` method to call `stopTicker()` before `super.stop()`
- Add logging: `scheduler.ticker.stopped`
- Add safety check (only clear if `tickInterval` is not null)

**Acceptance Criteria**:
- ✅ Timer is cleared when `stop()` is called
- ✅ `stop()` is idempotent (safe to call multiple times)
- ✅ No leaked timers after shutdown
- ✅ Logs confirm ticker stopped

**Code Location**: New method after `startTicker()`

---

#### 1.3: Add Publisher Caching
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 30 minutes
**Dependencies**: None

**Changes**:
- Add private instance variable: `publishers: Map<string, ReturnType<typeof createMessagePublisher>> = new Map()`
- Add `getPublisher(topic: string)` method with cache lookup/creation logic
- Update `handleTick()` to use `this.getPublisher(topic)` instead of local Map

**Acceptance Criteria**:
- ✅ Publishers are cached and reused across ticks
- ✅ One publisher per unique topic
- ✅ Publishers are created lazily on first use

**Code Location**: Lines 380-388 (replace local publisher Map)

---

#### 1.4: Add Batch Processing
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 45 minutes
**Dependencies**: Task 1.3

**Changes**:
- Extract schedule execution logic to `processSingleSchedule()` method
- Update `handleTick()` to process schedules in batches of 10
- Use `Promise.allSettled()` for parallel execution with error isolation
- Add logging: `scheduler.tick.batch_processing` with batch count

**Acceptance Criteria**:
- ✅ Schedules processed in batches of 10
- ✅ One failed schedule doesn't block others
- ✅ All schedules eventually execute
- ✅ Logs show batch processing progress

**Code Location**: Lines 372-407 (refactor handleTick)

---

#### 1.5: Add Configuration Support
**Files**:
- `src/apps/scheduler-service.ts`
- `env/local/scheduler.yaml`
- `env/staging/scheduler.yaml`

**Estimated Time**: 30 minutes
**Dependencies**: Task 1.1

**Changes**:
- Read `SCHEDULER_TICK_INTERVAL_MS` from environment (default: 60000)
- Add validation (min: 1000, max: 3600000)
- Update env files with configuration
- Add logging: `scheduler.config.loaded` with interval value

**Acceptance Criteria**:
- ✅ Tick interval is configurable via environment variable
- ✅ Invalid values are rejected with clear error
- ✅ Default is 60 seconds
- ✅ Configuration is logged on startup

**Code Location**: Constructor (lines 180-189)

---

#### 1.6: Remove GCP Dependencies
**Files**:
- `src/apps/scheduler-service.ts`
- `architecture.yaml`

**Estimated Time**: 20 minutes
**Dependencies**: Tasks 1.1-1.5

**Changes**:
- Remove Pub/Sub subscription to `internal.scheduler.tick` (lines 204-213)
- Keep HTTP `/tick` endpoint for manual trigger (lines 197-201)
- Update `architecture.yaml`: Remove `internal.scheduler.tick` from `topics.consumes`
- Update HTTP endpoint response to include success message

**Acceptance Criteria**:
- ✅ No Pub/Sub subscription code remains
- ✅ HTTP `/tick` endpoint still works for manual trigger
- ✅ `architecture.yaml` reflects correct topic consumption
- ✅ Service starts without GCP dependencies

**Code Location**: Lines 204-213 (delete), architecture.yaml line ~542

---

#### 1.7: Add Enhanced Logging
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 30 minutes
**Dependencies**: Tasks 1.1, 1.4

**Changes**:
- Add structured logging to `handleTick()`: count, timestamp, duration
- Add logging to `processSingleSchedule()`: schedule ID, type, topic, success/failure
- Add logging to `executeSchedule()`: correlation ID, event type
- Include execution stats in tick completion log

**Acceptance Criteria**:
- ✅ Each tick logs start/end with execution count
- ✅ Each schedule execution is logged individually
- ✅ Errors include full context (schedule ID, type, error message)
- ✅ Logs are structured JSON with consistent fields

**Code Location**: Throughout handleTick/processSingleSchedule/executeSchedule

---

## Phase 2: Testing (P0 - Blocking for Deployment)

**Goal**: Achieve >80% test coverage on scheduler logic
**Estimated Time**: 3-4 hours
**Blocking**: Required before deployment

### Task Breakdown

#### 2.1: Unit Tests - calculateNextRun
**File**: `src/apps/scheduler-service.test.ts`
**Estimated Time**: 45 minutes
**Dependencies**: Phase 1 complete

**Test Cases**:
- ✅ Once schedule with future date returns that date
- ✅ Once schedule with past date returns null
- ✅ Cron schedule returns future date
- ✅ Invalid cron expression returns null and logs error
- ✅ Invalid once timestamp returns null and logs error

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Edge cases covered (timezone, DST, leap year)
- ✅ 100% coverage of `calculateNextRun()` method

---

#### 2.2: Unit Tests - Ticker Lifecycle
**File**: `src/apps/scheduler-service.test.ts`
**Estimated Time**: 45 minutes
**Dependencies**: Task 1.2

**Test Cases**:
- ✅ Ticker starts on `setup()`
- ✅ Ticker calls `handleTick()` at configured interval
- ✅ Ticker stops on `stop()`
- ✅ `stop()` is idempotent
- ✅ Timer is cleared after stop

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Uses Jest fake timers
- ✅ No leaked timers in test suite
- ✅ 100% coverage of ticker lifecycle

---

#### 2.3: Unit Tests - handleTick
**File**: `src/apps/scheduler-service.test.ts`
**Estimated Time**: 60 minutes
**Dependencies**: Tasks 1.3, 1.4

**Test Cases**:
- ✅ Queries repository with current time
- ✅ Executes all due schedules
- ✅ Updates `lastRun` and `nextRun` after execution
- ✅ Disables once schedules after execution
- ✅ Keeps cron schedules enabled
- ✅ Handles repository errors gracefully
- ✅ Processes schedules in batches
- ✅ Uses cached publishers

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Uses mock repository
- ✅ Verifies batch processing behavior
- ✅ 100% coverage of `handleTick()` and `processSingleSchedule()`

---

#### 2.4: Integration Tests - Schedule Execution
**File**: `src/apps/scheduler-service.integration.test.ts`
**Estimated Time**: 90 minutes
**Dependencies**: Phase 1 complete

**Test Cases**:
- ✅ Once schedule executes and disables
- ✅ Cron schedule executes multiple times
- ✅ Events are published to correct topic
- ✅ Event payload matches schedule definition
- ✅ Manual `/tick` trigger works
- ✅ Concurrent schedules execute without conflict

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Uses real PostgreSQL (test database)
- ✅ Uses real NATS (test connection)
- ✅ Verifies end-to-end behavior
- ✅ Tests pass in CI environment

**Note**: May require Docker Compose test setup or in-memory backends

---

#### 2.5: Error Handling Tests
**File**: `src/apps/scheduler-service.test.ts`
**Estimated Time**: 45 minutes
**Dependencies**: Task 2.3

**Test Cases**:
- ✅ Database connection failure during tick
- ✅ Message bus publish failure
- ✅ Repository update failure after execution
- ✅ Invalid schedule data (corrupted JSON)
- ✅ Publisher creation failure

**Acceptance Criteria**:
- ✅ All test cases pass
- ✅ Service remains operational after errors
- ✅ Errors are logged with full context
- ✅ Subsequent ticks still execute

---

## Phase 3: Documentation (P1 - Required for Completion)

**Goal**: Update all documentation to reflect new architecture
**Estimated Time**: 2 hours
**Blocking**: Required for sprint completion

### Task Breakdown

#### 3.1: Update CLAUDE.md
**File**: `CLAUDE.md`
**Estimated Time**: 30 minutes
**Dependencies**: Phase 1 complete

**Changes**:
- Update scheduler description in service list
- Add scheduler configuration section
- Document `SCHEDULER_TICK_INTERVAL_MS` environment variable
- Update deployment notes (remove GCP Cloud Scheduler references)

**Acceptance Criteria**:
- ✅ CLAUDE.md accurately reflects new architecture
- ✅ No references to GCP Cloud Scheduler remain
- ✅ Configuration options documented
- ✅ LLM-readable structure maintained

---

#### 3.2: Create Scheduler Guide
**File**: `documentation/guides/scheduler.md`
**Estimated Time**: 60 minutes
**Dependencies**: Phase 1 complete

**Sections**:
- Overview and use cases
- Creating schedules (once vs cron)
- Event definition structure
- Topic selection
- MCP tool reference
- Troubleshooting common issues
- Performance considerations

**Acceptance Criteria**:
- ✅ Complete guide created
- ✅ Includes code examples
- ✅ Covers all MCP tools
- ✅ LLM-first documentation principles applied

---

#### 3.3: Add Troubleshooting Guide
**File**: `documentation/guides/scheduler-troubleshooting.md`
**Estimated Time**: 30 minutes
**Dependencies**: Phase 2 complete

**Sections**:
- Missed schedules (diagnosis and resolution)
- Schedule drift after restart
- Clock skew issues
- Database performance
- Message bus backpressure
- Common configuration errors

**Acceptance Criteria**:
- ✅ Common issues documented
- ✅ Clear diagnostic steps
- ✅ Resolution procedures
- ✅ Examples of error messages

---

## Phase 4: Deployment & Validation (P0 - Blocking for Release)

**Goal**: Deploy to all environments and validate functionality
**Estimated Time**: 2 hours
**Blocking**: Required before sprint completion

### Task Breakdown

#### 4.1: Local Environment Validation
**Environment**: Local Docker Compose
**Estimated Time**: 30 minutes
**Dependencies**: Phases 1-2 complete

**Validation Steps**:
- ✅ Build service: `npm run build`
- ✅ Start local stack: `npm run local`
- ✅ Verify scheduler starts with internal ticker
- ✅ Create test once schedule via MCP
- ✅ Create test cron schedule via MCP
- ✅ Verify schedules execute
- ✅ Verify events published to message bus
- ✅ Manual `/tick` trigger works
- ✅ Check logs for errors
- ✅ Graceful shutdown works

**Acceptance Criteria**:
- ✅ All validation steps pass
- ✅ No errors in logs
- ✅ Schedules execute within 1 minute of nextRun

---

#### 4.2: Agent-Dev Environment Validation
**Environment**: Agent-dev context
**Estimated Time**: 30 minutes
**Dependencies**: Task 4.1

**Validation Steps**:
- ✅ Provision agent-dev context
- ✅ Start services
- ✅ Seed database (includes test schedules)
- ✅ Verify scheduler ticker starts
- ✅ Monitor schedule execution
- ✅ Verify no GCP dependencies attempted
- ✅ Check resource usage (memory, CPU)
- ✅ Destroy context

**Acceptance Criteria**:
- ✅ Scheduler works in ephemeral context
- ✅ No external dependencies required
- ✅ Resource usage acceptable

---

#### 4.3: Staging Environment Deployment
**Environment**: Staging (bitbrat.lan)
**Estimated Time**: 30 minutes
**Dependencies**: Task 4.2

**Deployment Steps**:
- ✅ Deploy updated scheduler service
- ✅ Verify service health
- ✅ Check existing schedules still work
- ✅ Create new test schedule
- ✅ Monitor execution over 1 hour
- ✅ Check logs for errors
- ✅ Verify backward compatibility

**Acceptance Criteria**:
- ✅ Service deploys successfully
- ✅ Existing schedules continue working
- ✅ New schedules execute correctly
- ✅ No regressions detected

---

#### 4.4: PostgreSQL Index Creation
**File**: `infrastructure/postgres/migrations/`
**Estimated Time**: 30 minutes
**Dependencies**: Task 4.1

**Changes**:
- Create migration: `014_add_schedules_due_index.sql`
- Add partial index on `(data->>'enabled', data->>'nextRun')`
- Run migration in all environments
- Verify query performance with `EXPLAIN ANALYZE`

**Acceptance Criteria**:
- ✅ Migration created
- ✅ Index created in local, staging environments
- ✅ Query performance improved (verify with EXPLAIN)
- ✅ No existing data affected

---

## Phase 5: Observability (P1 - Nice to Have)

**Goal**: Add comprehensive observability for operations
**Estimated Time**: 2 hours
**Blocking**: Not blocking sprint completion

### Task Breakdown

#### 5.1: Add Scheduler Stats MCP Tool
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 45 minutes
**Dependencies**: Phase 1 complete

**Changes**:
- Add `get_scheduler_stats()` MCP tool
- Track stats: total schedules, enabled schedules, last tick time, next tick time, executions since startup
- Return stats as JSON

**Acceptance Criteria**:
- ✅ Tool returns accurate stats
- ✅ Stats updated in real-time
- ✅ Tool accessible via MCP

---

#### 5.2: Add Execution History Tracking
**File**: `src/services/scheduler/repository.ts`
**Estimated Time**: 60 minutes
**Dependencies**: Phase 1 complete

**Changes**:
- Add `executionHistory` field to `ScheduleDoc` (array of last 10 executions)
- Update `processSingleSchedule()` to append to history
- Include: timestamp, success/failure, error message (if any)
- Limit to 10 most recent executions

**Acceptance Criteria**:
- ✅ History tracked in database
- ✅ Limited to 10 entries
- ✅ Visible via `get_schedule` MCP tool
- ✅ No performance impact

---

#### 5.3: Add Structured Metrics
**File**: `src/apps/scheduler-service.ts`
**Estimated Time**: 30 minutes
**Dependencies**: Phase 1 complete

**Changes**:
- Log structured metrics: `scheduler.metrics.tick_duration_ms`, `scheduler.metrics.schedules_executed`, `scheduler.metrics.errors`
- Include in tick completion log
- Format for easy parsing by log aggregators

**Acceptance Criteria**:
- ✅ Metrics logged after each tick
- ✅ Structured JSON format
- ✅ Useful for dashboarding

---

## Phase 6: Enhancements (P2 - Future Work)

**Goal**: Optional enhancements for better UX
**Estimated Time**: 3-4 hours
**Blocking**: Can be deferred to future sprints

### Tasks (Summary Only)

- **6.1**: Pause/resume MCP tools (30 min)
- **6.2**: Schedule dry-run mode (preview next 5 executions) (45 min)
- **6.3**: Timezone-aware cron expressions (60 min)
- **6.4**: Schedule conflict detection (warn if 100+ in 1 minute) (45 min)
- **6.5**: Execution retry logic (failed schedules auto-retry 3x) (60 min)

---

## Risk Mitigation Plan

### Risk 1: Timer Doesn't Fire Reliably

**Mitigation**:
- Add heartbeat logging every tick
- Add `/healthz` check for last tick time
- Unit tests with Jest fake timers
- Integration tests with real timers

**Fallback**: Manual `/tick` endpoint as emergency trigger

---

### Risk 2: Tests Fail in CI

**Mitigation**:
- Use in-memory PostgreSQL or test database
- Mock message bus in unit tests
- Separate unit vs integration tests
- Increase timeouts for CI environment

**Fallback**: Run tests locally before merge

---

### Risk 3: Backward Compatibility Break

**Mitigation**:
- Keep existing data model unchanged
- Keep MCP tool signatures unchanged
- Test with existing schedules in staging
- Gradual rollout (local → staging → prod)

**Fallback**: Rollback to Sprint 186 version

---

## Definition of Done

### Sprint Completion Criteria

- ✅ All Phase 1 tasks complete (core implementation)
- ✅ All Phase 2 tasks complete (testing, >80% coverage)
- ✅ All Phase 3 tasks complete (documentation)
- ✅ All Phase 4 tasks complete (deployment validation)
- ✅ Code reviewed and merged
- ✅ No regressions in existing functionality
- ✅ Service runs in local, agent-dev, and staging environments
- ✅ All tests pass in CI

### Individual Task Completion Criteria

For each task:
- ✅ Code written and tested locally
- ✅ Unit tests pass (if applicable)
- ✅ Integration tests pass (if applicable)
- ✅ Code follows TypeScript style guide
- ✅ Logs are structured and meaningful
- ✅ Error handling is comprehensive
- ✅ Documentation updated (if applicable)

---

## Estimated Timeline

### Optimistic (Best Case)
- **Phase 1**: 3 hours
- **Phase 2**: 3 hours
- **Phase 3**: 1.5 hours
- **Phase 4**: 1.5 hours
- **Total**: 9 hours (1-2 days)

### Realistic (Expected)
- **Phase 1**: 4 hours
- **Phase 2**: 4 hours
- **Phase 3**: 2 hours
- **Phase 4**: 2 hours
- **Total**: 12 hours (2-3 days)

### Pessimistic (Worst Case)
- **Phase 1**: 5 hours
- **Phase 2**: 5 hours
- **Phase 3**: 2.5 hours
- **Phase 4**: 2.5 hours
- **Debugging/Rework**: 2 hours
- **Total**: 17 hours (3-4 days)

---

## Daily Checkpoints

### Day 1 Goals
- ✅ Complete Phase 1 (Tasks 1.1-1.7)
- ✅ Begin Phase 2 (Task 2.1)

### Day 2 Goals
- ✅ Complete Phase 2 (Tasks 2.1-2.5)
- ✅ Begin Phase 3 (Task 3.1)

### Day 3 Goals
- ✅ Complete Phase 3 (Tasks 3.1-3.3)
- ✅ Complete Phase 4 (Tasks 4.1-4.4)
- ✅ Sprint retrospective

### Day 4 (Buffer)
- ✅ Address any failing tests
- ✅ Fix any deployment issues
- ✅ Optional: Begin Phase 5

---

## Communication Plan

### Daily Updates
- **Morning**: Review task status, identify blockers
- **Evening**: Log progress, update YAML backlog

### Blockers
- **Immediate**: Log in YAML backlog with `blocked: true`
- **Resolution**: Document in task notes

### Completion
- **Per Task**: Update YAML status to `completed`
- **Per Phase**: Summary comment in YAML

---

## Rollback Plan

### If Deployment Fails

1. **Immediate**: Rollback to previous scheduler version
2. **Diagnosis**: Review logs, identify root cause
3. **Fix**: Address issue in development branch
4. **Re-test**: Full validation in agent-dev context
5. **Re-deploy**: After validation passes

### Rollback Commands

```bash
# Revert to Sprint 186 version
git revert <commit-hash>

# Redeploy old version
npm run brat -- deploy service scheduler

# Recreate GCP Cloud Scheduler job (if needed)
# (manual GCP Console operation)
```

---

## Success Metrics

### Technical Metrics
- ✅ Test coverage: >80%
- ✅ All tests pass in CI
- ✅ No linter errors
- ✅ Zero critical bugs

### Functional Metrics
- ✅ Schedules execute within 1 minute of `nextRun` (99% of time)
- ✅ Service uptime: 99.9%
- ✅ Zero missed schedules after service restart
- ✅ Backward compatible with existing schedules

### Operational Metrics
- ✅ Service memory usage: <200 MB
- ✅ Service CPU usage: <5% idle, <20% during tick
- ✅ Database queries: <1s per tick
- ✅ Log noise: <10 log lines per minute

---

**End of Execution Plan**
