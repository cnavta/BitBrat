# Sprint 369: Scheduler Redesign

**Status**: Ready for Implementation
**Start Date**: 2026-07-26
**Target Completion**: 2026-07-29
**Estimated Duration**: 2-3 days (12 hours)

---

## Overview

Replace the GCP Cloud Scheduler dependency with an internal `setInterval`-based ticker, making the scheduler **platform-agnostic** and **self-contained**. This redesign enables BitBrat to run on Docker, GCP, AWS, Azure, and self-hosted environments without external infrastructure dependencies.

---

## Problem Statement

The current scheduler implementation (Sprint 186) relies on Google Cloud Scheduler to trigger a "tick" event every minute. This creates several issues:

1. **GCP-Only**: Breaks platform-agnostic principle
2. **External Dependency**: Requires GCP project setup, IAM permissions, Pub/Sub topics
3. **No Local Development Story**: Developers must manually trigger `/tick` endpoint
4. **Configuration Complexity**: Additional infrastructure to manage

---

## Solution

Replace the external GCP Cloud Scheduler with an **internal Node.js timer** using `setInterval()`:

```typescript
// Before (Sprint 186)
GCP Cloud Scheduler → HTTP POST /tick → scheduler-service

// After (Sprint 369)
scheduler-service (self-contained with setInterval)
```

### Key Benefits

- ✅ **Platform-Agnostic**: Works on Docker, GCP, AWS, Azure, self-hosted
- ✅ **Zero External Dependencies**: Only requires PostgreSQL/NATS
- ✅ **Simpler Configuration**: One environment variable (`SCHEDULER_TICK_INTERVAL_MS`)
- ✅ **Better Local Development**: Works identically everywhere
- ✅ **Graceful Lifecycle**: Proper start/stop with timer cleanup

---

## Sprint Documents

### 1. Technical Architecture
**File**: [`technical-architecture.md`](./technical-architecture.md)

Comprehensive architectural design including:
- Current state analysis (what works, what doesn't)
- Proposed architecture with code examples
- Testing strategy
- Migration path
- Risk analysis
- Performance characteristics
- Appendices with examples and SQL

### 2. Execution Plan
**File**: [`execution-plan.md`](./execution-plan.md)

Detailed implementation breakdown:
- Task sequencing strategy
- 6 phases of work (Core → Tests → Docs → Deploy → Observability → Enhancements)
- 26 total tasks with time estimates
- Acceptance criteria per task
- Risk mitigation plan
- Definition of done
- Timeline estimates (optimistic/realistic/pessimistic)

### 3. YAML Backlog
**File**: [`backlog.yaml`](./backlog.yaml)

Trackable task list in YAML format:
- Structured by phase (Phase 1-6)
- Each task has: ID, title, description, priority, status, dependencies, acceptance criteria
- Progress tracking built-in
- Risk and blocker tracking
- Changelog for sprint history

---

## Task Breakdown

### Phase 1: Core Implementation (P0 - 4 hours)
- 1.1: Add Internal Ticker Mechanism (45 min)
- 1.2: Implement Graceful Shutdown (30 min)
- 1.3: Add Publisher Caching (30 min)
- 1.4: Add Batch Processing (45 min)
- 1.5: Add Configuration Support (30 min)
- 1.6: Remove GCP Dependencies (20 min)
- 1.7: Add Enhanced Logging (30 min)

### Phase 2: Testing (P0 - 4 hours)
- 2.1: Unit Tests - calculateNextRun (45 min)
- 2.2: Unit Tests - Ticker Lifecycle (45 min)
- 2.3: Unit Tests - handleTick (60 min)
- 2.4: Integration Tests - Schedule Execution (90 min)
- 2.5: Error Handling Tests (45 min)

### Phase 3: Documentation (P1 - 2 hours)
- 3.1: Update CLAUDE.md (30 min)
- 3.2: Create Scheduler Guide (60 min)
- 3.3: Add Troubleshooting Guide (30 min)

### Phase 4: Deployment & Validation (P0 - 2 hours)
- 4.1: Local Environment Validation (30 min)
- 4.2: Agent-Dev Environment Validation (30 min)
- 4.3: Staging Environment Deployment (30 min)
- 4.4: PostgreSQL Index Creation (30 min)

### Phase 5: Observability (P1 - 2 hours)
- 5.1: Add Scheduler Stats MCP Tool (45 min)
- 5.2: Add Execution History Tracking (60 min)
- 5.3: Add Structured Metrics (30 min)

### Phase 6: Future Enhancements (P2 - Deferred)
- 6.1: Pause/Resume MCP Tools
- 6.2: Schedule Dry-Run Mode
- 6.3: Timezone-Aware Cron
- 6.4: Schedule Conflict Detection
- 6.5: Execution Retry Logic

---

## Success Criteria

1. ✅ Platform-agnostic (works on all Docker-based environments)
2. ✅ Zero external dependencies beyond PostgreSQL/NATS
3. ✅ Test coverage >80%
4. ✅ Schedules execute within 1 minute of `nextRun`
5. ✅ Graceful shutdown with no leaked timers
6. ✅ Backward compatible with existing schedules

---

## Implementation Guide

### For Implementors

1. **Read Documents in Order**:
   - Start with `technical-architecture.md` for design context
   - Review `execution-plan.md` for task breakdown
   - Use `backlog.yaml` for daily tracking

2. **Follow Phase Order**:
   - Phase 1 → Phase 2 → Phase 3 → Phase 4 (all blocking)
   - Phase 5 → Phase 6 (optional/future)

3. **Update backlog.yaml**:
   - Change task status: `not_started` → `in_progress` → `completed`
   - Track actual time in `actual_minutes`
   - Add blockers if stuck
   - Update progress counters

4. **Daily Checkpoints**:
   - Day 1: Complete Phase 1
   - Day 2: Complete Phase 2, start Phase 3
   - Day 3: Complete Phases 3-4, optional Phase 5

### For Reviewers

1. **Check Against Acceptance Criteria**:
   - Each task has clear acceptance criteria
   - Verify all criteria met before marking complete

2. **Verify Test Coverage**:
   - Run `npm test -- --coverage`
   - Ensure >80% coverage on scheduler logic

3. **Validate Deployments**:
   - Local environment works
   - Agent-dev context works
   - Staging deployment successful

---

## Key Files Modified

### Core Implementation
- `src/apps/scheduler-service.ts` - Main scheduler service
- `src/services/scheduler/repository.ts` - Schedule repository (minimal changes)
- `architecture.yaml` - Remove `internal.scheduler.tick` from consumes

### Testing
- `src/apps/scheduler-service.test.ts` - Unit tests
- `src/apps/scheduler-service.integration.test.ts` - Integration tests

### Configuration
- `env/local/scheduler.yaml` - Add `SCHEDULER_TICK_INTERVAL_MS`
- `env/staging/scheduler.yaml` - Add `SCHEDULER_TICK_INTERVAL_MS`

### Documentation
- `CLAUDE.md` - Update scheduler section
- `documentation/guides/scheduler.md` - New guide
- `documentation/guides/scheduler-troubleshooting.md` - New troubleshooting guide

### Database
- `infrastructure/postgres/migrations/014_add_schedules_due_index.sql` - Performance index

---

## Configuration

### Environment Variables

```yaml
# env/local/scheduler.yaml
SCHEDULER_TICK_INTERVAL_MS: "60000"  # Default: 60 seconds (1 minute)
LOG_LEVEL: "debug"
```

### Validation

- **Minimum**: 1,000 ms (1 second)
- **Maximum**: 3,600,000 ms (1 hour)
- **Default**: 60,000 ms (1 minute)

---

## Testing Strategy

### Unit Tests (Jest)
- `calculateNextRun()` - Next run calculation
- Ticker lifecycle - Start/stop behavior
- `handleTick()` - Tick execution logic
- Error handling - Failure scenarios

### Integration Tests
- End-to-end schedule execution
- Real PostgreSQL + NATS
- Once and cron schedules
- Manual `/tick` trigger

### Validation Environments
1. Local Docker Compose
2. Agent-dev ephemeral context
3. Staging environment (bitbrat.lan)

---

## Rollback Plan

If deployment fails:

1. **Immediate**: Revert to Sprint 186 version
   ```bash
   git revert <commit-hash>
   npm run brat -- deploy service scheduler
   ```

2. **GCP Cleanup**: If GCP Cloud Scheduler job was removed, recreate manually

3. **Data**: No data migration required (backward compatible)

---

## Timeline

### Optimistic (Best Case)
- **Total**: 9 hours (1-2 days)
- Phase 1: 3 hours
- Phase 2: 3 hours
- Phase 3: 1.5 hours
- Phase 4: 1.5 hours

### Realistic (Expected)
- **Total**: 12 hours (2-3 days)
- Phase 1: 4 hours
- Phase 2: 4 hours
- Phase 3: 2 hours
- Phase 4: 2 hours

### Pessimistic (Worst Case)
- **Total**: 17 hours (3-4 days)
- Includes debugging/rework buffer

---

## Resources

### Code References
- **Base Server**: `src/common/base-server.ts` - Bit lifecycle hooks
- **Safe Timers**: `src/common/safe-timers.ts` - Timer safety utilities
- **MCP Client Manager**: `src/common/mcp/client-manager.ts` - setInterval examples
- **Sprint 186**: `planning/sprint-186-a7b8c9/` - Original implementation

### Documentation
- **CLAUDE.md**: Platform design principles
- **Architecture.yaml**: Service definitions and topic governance
- **Bit Model**: `documentation/concepts/bit-model.md`

---

## Contact

**Architect**: Claude Code
**Lead Implementor**: Claude Code
**Sprint**: 369
**Started**: 2026-07-26

---

## Quick Start

```bash
# 1. Read the technical architecture
cat planning/sprint-369-scheduler-redesign/technical-architecture.md

# 2. Review the execution plan
cat planning/sprint-369-scheduler-redesign/execution-plan.md

# 3. Start with Phase 1, Task 1.1
# Edit: src/apps/scheduler-service.ts
# Add internal ticker mechanism

# 4. Update backlog as you work
# Edit: planning/sprint-369-scheduler-redesign/backlog.yaml
# Change task status to 'in_progress', then 'completed'

# 5. Run tests frequently
npm test

# 6. Validate in local environment
npm run build
npm run local

# 7. Create schedules via MCP and verify execution
```

---

**Ready to begin implementation!**
