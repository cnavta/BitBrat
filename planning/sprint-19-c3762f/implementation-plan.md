# Implementation Plan: Event Stream Analyzer - Phase 2

**Sprint:** sprint-19-c3762f
**Phase:** 2 (Multi-Observer & Window Types)
**Owner:** christophernavta
**Created:** 2026-08-19
**Status:** Planning

---

## Executive Summary

Phase 2 builds on the validated Phase 1 POC to add production-ready features:
- **Observer Persistence**: PostgreSQL-backed observer storage for durability
- **Multi-Observer Support**: Run 10+ independent observers concurrently
- **Additional Window Types**: Tumbling (non-overlapping) and session (inactivity-based) windows
- **Dynamic Subscriptions**: Automatically manage NATS subscriptions based on active observers

**Foundation**: Phase 1 delivered a working RxJS streaming architecture with sliding windows. All code is validated and tests pass (11/11). This phase extends that foundation without breaking changes.

**Estimated Effort**: 53 hours across 15 tasks (P2-001 through P2-015)

---

## Table of Contents

1. [Phase 2 Goals](#phase-2-goals)
2. [Architecture Changes](#architecture-changes)
3. [Implementation Tasks](#implementation-tasks)
4. [Database Schema](#database-schema)
5. [Testing Strategy](#testing-strategy)
6. [Deployment Plan](#deployment-plan)
7. [Risk Mitigation](#risk-mitigation)
8. [Success Criteria](#success-criteria)

---

## Phase 2 Goals

### Primary Objectives

1. **Observer Lifecycle Management**
   - Create PostgreSQL migration for `stream_observers` table
   - Implement ObserverRepository for CRUD operations
   - Load observers from database on service startup
   - Replace hardcoded POC observer with database-driven observers

2. **Multi-Observer Support**
   - Support 10+ concurrent observers running independently
   - Per-observer filtering (platform, type, channel)
   - Isolated error handling (one observer failure doesn't affect others)
   - Dynamic subscription management (reference counting for topics)

3. **Additional Window Types**
   - Tumbling windows (non-overlapping, fixed-size)
   - Session windows (inactivity-based, variable-size)
   - Window type validation with Zod schemas

4. **Production Readiness**
   - MCP tools for observer CRUD operations
   - Comprehensive test coverage (20+ tests)
   - Load testing (100 observers, 10k events/min)
   - Agent-dev validation before completion

### Non-Goals (Deferred to Phase 3)

- Snapshot/recovery mechanisms
- Prometheus metrics
- Memory pressure detection
- Hybrid mode (stream + database backup)
- Condition-based triggers

---

## Architecture Changes

### Current Architecture (Phase 1)

```
EventStreamAnalyzerService
  ├─ RxJSWindowManager (sliding windows only)
  ├─ In-memory observers Map
  ├─ Hardcoded POC observer
  └─ Single NATS subscription (internal.contextualization.v1)
```

### Phase 2 Architecture

```
EventStreamAnalyzerService
  ├─ RxJSWindowManager (sliding + tumbling + session)
  ├─ ObserverRepository (PostgreSQL persistence)
  ├─ SubscriptionManager (dynamic topic subscriptions)
  ├─ Database-driven observers (loaded on startup)
  └─ Multi-topic NATS subscriptions (ref-counted)
```

### New Components

| Component | Purpose | Priority |
|-----------|---------|----------|
| **stream_observers** migration | Database schema | P0 (blocker) |
| **ObserverRepository** | CRUD operations via IDocumentStore | P0 (critical path) |
| **SubscriptionManager** | Dynamic topic management | P0 (critical path) |
| **Tumbling windows** | Non-overlapping windows | P1 |
| **Session windows** | Inactivity-based windows | P1 |

---

## Implementation Tasks

### Week 1: Observer Persistence (P2-001 → P2-004)

#### P2-001: Create PostgreSQL Migration (2 hours)

**File**: `infrastructure/postgres/migrations/018-add-stream-observers.sql`

**Schema**:
```sql
CREATE TABLE stream_observers (
  id VARCHAR(255) PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  mcp_enabled BOOLEAN DEFAULT true,
  source JSONB NOT NULL,          -- StreamSourceV4 (mode, topics, filters)
  window JSONB NOT NULL,          -- StreamWindowConfig (type, sizeMs, slideMs)
  trigger JSONB NOT NULL,         -- StreamTriggerV4 (type)
  analysis JSONB NOT NULL,        -- StreamAnalysis (promptId, outputFormat)
  delivery JSONB NOT NULL,        -- StreamDelivery (egressTopic, destination)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stream_observers_active ON stream_observers(active);
CREATE INDEX idx_stream_observers_created_at ON stream_observers(created_at);
```

**Acceptance**:
- Migration file created and tested locally
- Indexes on `active` and `created_at` for performance
- Schema matches `StreamObserver` interface (src/types/sessi.ts)

---

#### P2-002: Run Migration (1 hour)

**Environments**: local, staging

**Validation**:
```bash
psql -U postgres -d bitbrat
\d stream_observers;
\d+ stream_observers;  # Verify indexes
```

---

#### P2-003: Implement ObserverRepository (4 hours)

**File**: `src/services/event-stream-analyzer/observer-repository.ts`

**Interface**:
```typescript
export class ObserverRepository {
  constructor(private documentStore: IDocumentStore) {}

  async create(observer: StreamObserver): Promise<StreamObserver>
  async get(id: string): Promise<StreamObserver | null>
  async list(filters?: { active?: boolean }): Promise<StreamObserver[]>
  async update(id: string, changes: Partial<StreamObserver>): Promise<void>
  async delete(id: string): Promise<void>
}
```

**Patterns**:
- Use `IDocumentStore` abstraction (platform-agnostic)
- Validate with Zod before persistence
- Handle not-found errors gracefully
- Log all operations with observerId context

**Tests**: `observer-repository.test.ts` (100% coverage)

---

#### P2-004: MCP observer.create Tool (3 hours)

**Integrate ObserverRepository into event-stream-analyzer-service.ts**

**Flow**:
1. Validate observer config with Zod
2. Persist to database via ObserverRepository
3. Create window in RxJSWindowManager
4. Add topic subscription via SubscriptionManager
5. Return success + observerId

**Acceptance**:
- End-to-end test: MCP call → database → window active
- Observer persists across service restarts
- Validation rejects invalid configs

---

### Week 2: Dynamic Subscriptions & Multi-Observer (P2-005 → P2-010)

#### P2-008: SubscriptionManager (6 hours) - CRITICAL PATH

**File**: `src/services/event-stream-analyzer/subscription-manager.ts`

**Purpose**: Track active topics across all observers, manage NATS subscriptions with reference counting

**Interface**:
```typescript
export class SubscriptionManager {
  private topicCounts = new Map<string, number>();
  private subscriptions = new Map<string, () => Promise<void>>();

  async addTopic(topic: string, handler: MessageHandler): Promise<void>
  async removeTopic(topic: string): Promise<void>
  getActiveTopic(): string[]
  getSubscriptionCount(): number
}
```

**Logic**:
- Reference count topics (increment on observer create, decrement on delete)
- Add NATS subscription when first observer for topic created
- Remove NATS subscription when last observer for topic deleted
- Graceful error handling (failed subscription doesn't crash service)

---

#### P2-009: Load Observers on Startup (2 hours) - CRITICAL PATH

**Modify**: `event-stream-analyzer-service.ts:setup()`

**Flow**:
1. Load all active observers from database via ObserverRepository
2. For each observer:
   - Create window in WindowManager
   - Add topics to SubscriptionManager
3. Log loaded observer count
4. Handle empty observer list gracefully

**Acceptance**:
- Service restarts restore all active observers
- Windows resume at correct state
- No hardcoded POC observer

---

#### P2-005, P2-006, P2-007: MCP CRUD Tools (4 hours total)

**Tools**:
- `event_stream_analyzer.observer.list` (1 hour)
- `event_stream_analyzer.observer.update` (2 hours)
- `event_stream_analyzer.observer.delete` (1 hour)

**Patterns**:
- Update: Destroy old window, create new window with updated config
- Delete: Remove from database, destroy window, remove topic subscription
- List: Support filtering by `active` status

---

#### P2-010: Integration Test - Multi-Observer (3 hours)

**File**: `event-stream-analyzer-service.test.ts`

**Scenarios**:
1. Create 5 observers with different configs
2. Publish events matching different filters
3. Verify each observer triggers independently
4. No cross-observer interference
5. Subscription management works correctly

---

### Week 3: Additional Window Types (P2-011 → P2-015)

#### P2-011: Tumbling Windows (4 hours)

**Extend**: `rxjs-window-manager.ts`

**Method**: `createTumblingWindow(observer, callback)`

**RxJS Pattern**:
```typescript
const subject = new Subject();
const trigger = new Subject();

subject.pipe(
  buffer(trigger),
  filter(events => events.length > 0)
).subscribe(callback);

// Trigger window close every sizeMs
setInterval(() => trigger.next(), sizeMs);
```

**Characteristics**:
- Non-overlapping (events appear in exactly one window)
- Fixed-size intervals
- Manual trigger via Subject

---

#### P2-012: Session Windows (6 hours)

**Method**: `createSessionWindow(observer, callback)`

**RxJS Pattern**:
```typescript
subject.pipe(
  debounceTime(sessionGapMs),  // Close window after inactivity
  scan((buffer, event) => [...buffer, event], []),
  filter(events => events.length > 0)
).subscribe(callback);
```

**Characteristics**:
- Variable-size windows (based on activity)
- Close after `sessionGapMs` of no events
- Good for burst detection

**Edge Cases**:
- Empty sessions (no events)
- Rapid bursts (no inactivity)
- Very long sessions (memory limits)

---

#### P2-013: Window Type Validation (2 hours)

**Extend**: `src/types/sessi.ts`

**Zod Schemas**:
```typescript
const SlidingWindowSchema = z.object({
  type: z.literal('sliding'),
  sizeMs: z.number().positive(),
  slideMs: z.number().positive()
});

const TumblingWindowSchema = z.object({
  type: z.literal('tumbling'),
  sizeMs: z.number().positive()
});

const SessionWindowSchema = z.object({
  type: z.literal('session'),
  sessionGapMs: z.number().positive(),
  maxDurationMs: z.number().positive().optional()
});

export const WindowConfigSchema = z.discriminatedUnion('type', [
  SlidingWindowSchema,
  TumblingWindowSchema,
  SessionWindowSchema
]);
```

---

#### P2-014, P2-015: Window Type Tests (8 hours total)

**Unit Tests** (4 hours):
- Test each window type independently
- Verify timing characteristics
- Test edge cases (empty, single event, bursts)
- Use `jest.useFakeTimers()`

**Integration Tests** (4 hours):
- Create observers with different window types
- Publish events, verify all trigger correctly
- Test window transitions (update observer window type)

---

## Database Schema

### stream_observers Table

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(255) | Primary key, unique observer ID |
| active | BOOLEAN | Enable/disable observer |
| mcp_enabled | BOOLEAN | Allow MCP tool control |
| source | JSONB | StreamSourceV4 (mode, topics, filters) |
| window | JSONB | StreamWindowConfig (type, sizeMs, slideMs) |
| trigger | JSONB | StreamTriggerV4 (type) |
| analysis | JSONB | StreamAnalysis (promptId, outputFormat) |
| delivery | JSONB | StreamDelivery (egressTopic, destination) |
| created_at | TIMESTAMP | Observer creation time |
| updated_at | TIMESTAMP | Last modification time |

**Indexes**:
- `idx_stream_observers_active` - Fast active observer queries
- `idx_stream_observers_created_at` - Chronological ordering

---

## Testing Strategy

### Test Pyramid

**Unit Tests (60%)**:
- ObserverRepository CRUD operations
- SubscriptionManager reference counting
- RxJSWindowManager window type methods
- Event filtering logic
- Zod schema validation

**Integration Tests (30%)**:
- Multi-observer scenarios (10+ observers)
- Window type combinations
- Database → WindowManager → Publishing flow
- MCP tool end-to-end

**Load Tests (10%)**:
- 100 observers, 10k events/min
- Memory usage < 2GB
- CPU usage < 50% steady state
- Latency < 1s p95

### Test Patterns from Phase 1

**Fake Timers**:
```typescript
jest.useFakeTimers();
jest.advanceTimersByTime(60000);
jest.useRealTimers();
```

**Multi-Observer**:
```typescript
it('should handle 5 independent observers', async () => {
  const obs1 = await createObserver({ platforms: ['twitch'] });
  const obs2 = await createObserver({ platforms: ['discord'] });
  // ... create 3 more

  await publishEvents(10);
  jest.advanceTimersByTime(slideMs);

  expect(summaries).toHaveLength(5);
});
```

---

## Deployment Plan

### Environments

| Environment | Status | Notes |
|-------------|--------|-------|
| Local | ✅ Ready | PostgreSQL, NATS available |
| Agent-dev | ⚠️ Partial | PostgreSQL available, NATS missing |
| Staging | ✅ Ready | Full stack available |
| Production | ⏸️ Phase 3 | After Phase 2 validation |

### Deployment Steps

1. **Local Development**:
   ```bash
   npm run build
   npm test
   psql -U postgres -d bitbrat < infrastructure/postgres/migrations/018-add-stream-observers.sql
   ```

2. **Agent-Dev Validation** (proactive):
   ```bash
   # Provision agent-dev context
   agent_dev.provision({ name: "agent-dev-phase2-validation" })

   # Deploy service
   bit deploy event-stream-analyzer --context agent-dev-phase2-validation

   # Validate
   fleet.logs({ bit: "event-stream-analyzer", context: "agent-dev-phase2-validation" })
   fleet.info({ bit: "event-stream-analyzer", context: "agent-dev-phase2-validation" })

   # Cleanup
   agent_dev.destroy({ name: "agent-dev-phase2-validation", confirm: true })
   ```

3. **Staging Deployment**:
   ```bash
   # Run migration
   # Deploy service
   # Create test observers via MCP
   # Verify analysis triggers and delivers
   ```

---

## Risk Mitigation

### Identified Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database performance with many observers | Medium | High | Index optimization, load testing early |
| Dynamic subscription complexity | Medium | Medium | Careful reference counting, thorough testing |
| Session window edge cases | Low | Medium | Comprehensive test scenarios |
| Multi-observer interference | Low | High | Isolated error handling, independent windows |

### Mitigation Strategies

**Database Performance**:
- Create indexes on `active`, `created_at`
- Load test with 100+ observers early (P2-010)
- Monitor query performance
- Consider caching if needed

**Dynamic Subscriptions**:
- Reference count topics carefully
- Log all subscription add/remove events
- Test edge cases (last observer deleted, first observer added)
- Graceful handling of subscription failures

**Window Edge Cases**:
- Test empty windows (no events)
- Test single-event windows
- Test rapid event bursts
- Test inactivity gaps (session windows)
- Use fake timers for deterministic testing

**Multi-Observer Isolation**:
- Wrap each observer's window callback in try/catch
- Log errors with observerId context
- Don't let one observer failure affect others
- Monitor per-observer health

---

## Success Criteria

### Phase 2 Completion Criteria

**Functional**:
- ✅ Observer CRUD via MCP tools working
- ✅ Database persistence validated
- ✅ 10+ concurrent observers running
- ✅ Sliding, tumbling, session windows all working
- ✅ Dynamic subscription management functional

**Quality**:
- ✅ 20+ tests, 100% passing
- ✅ 90%+ code coverage on new code
- ✅ No TypeScript errors
- ✅ No linting errors

**Performance**:
- ✅ 100 observers, 10k events/min handled
- ✅ Memory usage < 2GB
- ✅ CPU usage < 50% steady state
- ✅ Latency < 1s p95

**Documentation**:
- ✅ All tasks documented in backlog
- ✅ Phase 2 retrospective created
- ✅ Phase 3 handoff prepared

### Definition of Done (Per Task)

- [ ] Code implemented and reviewed
- [ ] Unit tests written and passing
- [ ] Integration tests added (where applicable)
- [ ] Documentation updated (code comments)
- [ ] No new TypeScript errors
- [ ] Deployed to agent-dev and validated (before sprint completion)
- [ ] Task marked complete in backlog

---

## Next Steps

1. ✅ Review and approve this implementation plan
2. ⏭️ Start P2-001: Create database migration
3. ⏭️ Progress through tasks sequentially (respecting dependencies)
4. ⏭️ Deploy to agent-dev for final validation before completion

**Estimated Timeline**: 2-3 weeks (53 hours total effort)

---

**Prepared By:** christophernavta
**Date:** 2026-08-19
**Sprint:** sprint-19-c3762f
**Phase:** 2 of 4
