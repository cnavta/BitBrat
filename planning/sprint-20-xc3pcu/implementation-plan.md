# Implementation Plan: Event Stream Analyzer - Phase 3

**Sprint:** sprint-20-xc3pcu
**Phase:** 3 (Production Readiness)
**Owner:** Lead Implementor
**Created:** 2026-08-19
**Status:** Planning

---

## Executive Summary

Phase 3 transforms the event-stream-analyzer from a validated multi-observer system (Phase 2) into a production-ready service with:
- **Real LLM Analysis**: Replace stub summaries with GPT-4 powered insights
- **Snapshot & Recovery**: Periodic window state persistence with crash recovery
- **Observability**: Prometheus metrics and structured logging
- **Memory Management**: Pressure detection and event eviction strategies
- **Load Testing**: Validation at scale (100+ observers, 10k events/min)

**Foundation**: Phases 1-2 delivered RxJS streaming architecture, multi-observer support, database persistence, and three window types (sliding, tumbling, session). Phase 3 focuses on production hardening and operational readiness.

**Estimated Effort**: 64 hours across 16 tasks (P3-001 through P3-016)

---

## Table of Contents

1. [Phase 3 Goals](#phase-3-goals)
2. [Architecture Changes](#architecture-changes)
3. [Implementation Tasks](#implementation-tasks)
4. [Testing Strategy](#testing-strategy)
5. [Deployment Plan](#deployment-plan)
6. [Risk Mitigation](#risk-mitigation)
7. [Success Criteria](#success-criteria)

---

## Phase 3 Goals

### Primary Objectives

1. **Real LLM Analysis Integration**
   - Replace stub event formatting with StreamAnalystEngine
   - Support custom prompts per observer (promptId field)
   - Enable inspection mode for debugging
   - Reduce LLM costs through event filtering and summarization

2. **Data Loss Mitigation**
   - Periodic window state snapshots (5-min default)
   - Reconstruct windows on service restart
   - Graceful shutdown with snapshot trigger
   - Max 5-min data loss on crash
   - Zero data loss on clean shutdown

3. **Observability & Monitoring**
   - Prometheus metrics (window size, processing latency, memory usage)
   - Structured logging with correlation IDs
   - Health checks and readiness probes
   - Alert definitions for operational issues

4. **Memory Management**
   - Track total events across all windows
   - Auto-evict oldest events when threshold reached
   - Configurable memory limits per observer
   - Graceful degradation under pressure

5. **Production Validation**
   - Load testing script (100 observers, 10k events/min)
   - Performance benchmarking and tuning
   - Agent-dev deployment validation
   - Staging deployment with real traffic

### Non-Goals (Deferred to Phase 4)

- Hybrid mode (stream + database backup for zero data loss)
- Condition-based triggers (threshold detection, pattern matching)
- Advanced aggregations (pre-LLM filtering, top-N selection)
- Multi-platform correlation

---

## Architecture Changes

### Current Architecture (Phase 2)

```
EventStreamAnalyzerService
  ├─ ObserverRepository (PostgreSQL persistence)
  ├─ RxJSWindowManager (sliding/tumbling/session windows)
  ├─ SubscriptionManager (reference-counted topics)
  └─ Stub Analysis (formatted event summaries)
```

### Phase 3 Architecture

```
EventStreamAnalyzerService
  ├─ ObserverRepository (PostgreSQL persistence)
  ├─ RxJSWindowManager (sliding/tumbling/session windows)
  ├─ SubscriptionManager (reference-counted topics)
  ├─ StreamAnalystEngine (LLM analysis) ← NEW
  ├─ SnapshotManager (periodic state persistence) ← NEW
  ├─ MemoryManager (pressure detection + eviction) ← NEW
  └─ MetricsCollector (Prometheus metrics) ← NEW
```

### New Components

| Component | Purpose | Priority |
|-----------|---------|----------|
| **StreamAnalystEngine** | GPT-4 powered event summarization | P0 (blocker) |
| **SnapshotManager** | Periodic window state snapshots | P0 (critical path) |
| **MemoryManager** | Event eviction under memory pressure | P1 |
| **MetricsCollector** | Prometheus metrics collection | P1 |
| **Load Testing Scripts** | Validation at scale | P1 |

---

## Implementation Tasks

### Week 1: LLM Integration & Snapshot Foundation (P3-001 → P3-006)

#### P3-001: Integrate StreamAnalystEngine (6 hours)

**Objective**: Replace stub analysis with real LLM-powered summarization

**Files**:
- Modify: `src/apps/event-stream-analyzer-service.ts`
- Reuse: `src/services/stream-analyst/engine.ts` (existing engine)

**Implementation**:
```typescript
import { StreamAnalystEngine } from '../services/stream-analyst/engine';

export class EventStreamAnalyzerServer extends Bit {
  private engine!: StreamAnalystEngine;

  private async setup(): Promise<void> {
    // ... existing setup ...

    // Initialize StreamAnalystEngine
    this.engine = new StreamAnalystEngine(
      this.getResource('documentStore'),
      this.getLogger(),
      {
        defaultModel: 'gpt-4o-mini',
        enableInspection: false
      }
    );
  }

  private async handleWindowClose(
    events: InternalEventV2[],
    observer: StreamObserver
  ): Promise<void> {
    const { analysis } = observer;

    // Prepare events for LLM (PII redaction, tokenization)
    const preparedEvents = await this.prepareEventsForAnalysis(events);

    // Call StreamAnalystEngine
    const summary = await this.engine.summarize({
      requestId: `window-${observer.id}-${Date.now()}`,
      observerId: observer.id,
      events: preparedEvents,
      promptId: analysis.promptId || 'standard-chat-summary-v1',
      streamType: 'chat',
      inspectionEnabled: analysis.inspectionEnabled || false,
      outputFormat: analysis.outputFormat || 'markdown'
    });

    // Publish to egress
    await this.publishSummary(summary, observer);
  }
}
```

**Tests**: Integration test with mock LLM responses

**Acceptance**:
- LLM analysis replaces stub summaries
- Existing prompts (standard-chat-summary-v1) work
- Inspection mode can be enabled per observer
- Cost tracking logged for each LLM call

---

#### P3-002: Implement SnapshotManager (8 hours)

**Objective**: Periodic window state persistence for crash recovery

**File**: `src/services/event-stream-analyzer/snapshot-manager.ts`

**Interface**:
```typescript
export class SnapshotManager {
  constructor(
    private observerRepository: ObserverRepository,
    private documentStore: IDocumentStore,
    private logger: any,
    private config: {
      snapshotIntervalMs: number;  // Default: 300000 (5 min)
      enabled: boolean;             // Default: true
    }
  ) {}

  /**
   * Start periodic snapshot loop
   */
  async start(): Promise<void>;

  /**
   * Stop snapshot loop (graceful shutdown)
   */
  async stop(): Promise<void>;

  /**
   * Take immediate snapshot of all windows
   */
  async takeSnapshot(
    windowStates: Map<string, WindowState>
  ): Promise<void>;

  /**
   * Restore windows from last snapshot
   */
  async restoreWindows(): Promise<Map<string, WindowState>>;
}

interface WindowState {
  observerId: string;
  eventIds: string[];          // References to events in window
  eventCount: number;
  windowStartedAt: string;
  lastEventAt: string;
  snapshotAt: string;
}
```

**Database Schema**:
```sql
-- New migration: 019-add-window-snapshots.sql
CREATE TABLE window_snapshots (
  observer_id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,  -- WindowState
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_window_snapshots_snapshot_at
  ON window_snapshots(snapshot_at);
```

**Logic**:
- Snapshot loop runs every 5 minutes (configurable)
- Captures event IDs currently in each window
- Stores metadata (event count, timestamps)
- On restore: fetch events by ID, reconstruct windows
- Graceful shutdown triggers immediate snapshot

**Tests**: Unit tests for snapshot/restore cycle

---

#### P3-003: Integrate Snapshot Lifecycle (4 hours)

**Modify**: `src/apps/event-stream-analyzer-service.ts`

**Changes**:
1. Initialize SnapshotManager in setup()
2. Start snapshot loop after observer loading
3. Pass window states to SnapshotManager on each snapshot
4. Restore windows from snapshot on startup (if exists)
5. Trigger snapshot in onShutdown hook

**Flow**:
```
Startup:
  1. Load observers from database
  2. Restore window states from snapshots (if exists)
  3. Create RxJS windows with restored state
  4. Start snapshot loop

Periodic (every 5 min):
  5. Collect current window states
  6. Persist to window_snapshots table

Shutdown (SIGTERM):
  7. Stop accepting new events
  8. Trigger final snapshot
  9. Cleanup RxJS subscriptions
  10. Close database connections
```

**Acceptance**:
- Service restarts restore windows from last snapshot
- Events processed before crash are recovered
- Max 5-min data loss on crash
- Zero data loss on clean shutdown
- Snapshot overhead < 100ms

---

#### P3-004: Crash Recovery Tests (4 hours)

**File**: `src/apps/event-stream-analyzer-service.test.ts`

**Scenarios**:
1. **Mid-window crash**:
   - Publish 50 events over 3 minutes
   - Trigger snapshot
   - Simulate crash (service stop)
   - Restart service
   - Verify 50 events restored to window

2. **Graceful shutdown**:
   - Publish 100 events
   - Call onShutdown hook
   - Verify snapshot created
   - Restart and verify full recovery

3. **No snapshot available**:
   - Start service with empty snapshots table
   - Verify clean initialization

4. **Stale snapshot handling**:
   - Create snapshot with 10-minute-old data
   - Start service
   - Verify stale events discarded (configurable threshold)

**Metrics to Validate**:
- Snapshot persistence latency (< 100ms)
- Restore latency (< 500ms for 1000 events)
- Memory footprint after restore

---

#### P3-005: Graceful Shutdown Implementation (2 hours)

**Modify**: `src/apps/event-stream-analyzer-service.ts`

**Implementation**:
```typescript
export class EventStreamAnalyzerServer extends Bit {
  private isShuttingDown = false;

  async onShutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.getLogger().info('event-stream-analyzer.shutdown.start');

    // 1. Stop accepting new events
    await this.subscriptionManager?.destroy();

    // 2. Trigger final snapshot
    if (this.snapshotManager) {
      const windowStates = this.windowManager.getAllWindowStates();
      await this.snapshotManager.takeSnapshot(windowStates);
    }

    // 3. Cleanup RxJS subscriptions
    if (this.windowManager) {
      this.windowManager.destroy();
    }

    this.getLogger().info('event-stream-analyzer.shutdown.complete');
  }
}
```

**Signal Handling**:
```typescript
process.on('SIGTERM', async () => {
  await server.close('shutdown');
  process.exit(0);
});

process.on('SIGINT', async () => {
  await server.close('shutdown');
  process.exit(0);
});
```

**Acceptance**:
- SIGTERM/SIGINT trigger onShutdown hook
- Final snapshot created before exit
- No in-flight events lost
- Clean exit code (0)

---

#### P3-006: Database Migration for Snapshots (1 hour)

**File**: `infrastructure/postgres/migrations/019-add-window-snapshots.sql`

**Schema**:
```sql
-- Window state snapshots for crash recovery
CREATE TABLE window_snapshots (
  observer_id VARCHAR(255) PRIMARY KEY REFERENCES stream_observers(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_window_snapshots_snapshot_at
  ON window_snapshots(snapshot_at);

-- GIN index for fast JSONB queries (optional, if filtering by window state)
CREATE INDEX idx_window_snapshots_data
  ON window_snapshots USING GIN (data);
```

**Validation**:
```bash
psql -U postgres -d bitbrat < infrastructure/postgres/migrations/019-add-window-snapshots.sql
\d window_snapshots;
```

---

### Week 2: Memory Management & Observability (P3-007 → P3-012)

#### P3-007: Implement MemoryManager (6 hours)

**File**: `src/services/event-stream-analyzer/memory-manager.ts`

**Purpose**: Track total events across all windows, evict oldest when threshold reached

**Interface**:
```typescript
export class MemoryManager {
  constructor(
    private logger: any,
    private config: {
      maxTotalEvents: number;      // Default: 10000
      evictionStrategy: 'oldest' | 'largest-window';
      warningThreshold: number;    // Default: 0.8 (80%)
    }
  ) {}

  /**
   * Check if adding N events would exceed limit
   */
  canAddEvents(count: number): boolean;

  /**
   * Register events added to a window
   */
  addEvents(observerId: string, count: number): void;

  /**
   * Register events removed from a window
   */
  removeEvents(observerId: string, count: number): void;

  /**
   * Get eviction candidates when over limit
   */
  getEvictionCandidates(): Array<{
    observerId: string;
    evictCount: number;
  }>;

  /**
   * Get current memory stats
   */
  getStats(): {
    totalEvents: number;
    utilizationPercent: number;
    eventsByObserver: Map<string, number>;
  };
}
```

**Logic**:
- Track events per observer
- When adding events would exceed limit:
  - Identify eviction candidates (oldest events or largest windows)
  - Emit eviction event
  - WindowManager handles actual eviction
  - Log eviction metrics

**Tests**: Unit tests for eviction strategies

---

#### P3-008: Integrate MemoryManager (3 hours)

**Modify**:
- `src/apps/event-stream-analyzer-service.ts`
- `src/services/event-stream-analyzer/rxjs-window-manager.ts`

**Flow**:
1. Before adding event to window, check `memoryManager.canAddEvents(1)`
2. If over limit, get eviction candidates
3. Call `windowManager.evictOldestEvents(observerId, count)`
4. Update memory manager stats
5. Log eviction event

**Acceptance**:
- Total event count stays under configurable limit
- Eviction metrics logged
- No impact on event processing latency (< 5ms overhead)

---

#### P3-009: Implement Prometheus Metrics (6 hours)

**File**: `src/services/event-stream-analyzer/metrics-collector.ts`

**Metrics**:
```typescript
// Window metrics
event_stream_analyzer_window_size_gauge{observer_id, window_type}
event_stream_analyzer_window_age_seconds{observer_id}
event_stream_analyzer_window_event_count{observer_id}

// Processing metrics
event_stream_analyzer_events_received_total{observer_id}
event_stream_analyzer_events_filtered_total{observer_id, reason}
event_stream_analyzer_events_evicted_total{observer_id, strategy}
event_stream_analyzer_analysis_latency_seconds{observer_id, status}

// Resource metrics
event_stream_analyzer_memory_usage_bytes
event_stream_analyzer_total_events_gauge
event_stream_analyzer_subscriptions_active_gauge

// Error metrics
event_stream_analyzer_errors_total{type, observer_id}
```

**Integration**:
- Export metrics on `/metrics` endpoint (standard Bit pattern)
- Update metrics on each window event (add, close, evict)
- Track LLM analysis duration and cost

**Tests**: Verify metrics incremented correctly

---

#### P3-010: Enhanced Logging (3 hours)

**Modify**: All event-stream-analyzer files

**Enhancements**:
1. Add correlation IDs to all log entries
2. Structured logging with consistent fields:
   ```json
   {
     "observerId": "poc-chat-summary",
     "windowType": "sliding",
     "eventCount": 42,
     "analysisLatencyMs": 1234,
     "llmCost": 0.0023
   }
   ```
3. Log levels:
   - ERROR: Analysis failures, snapshot errors
   - WARN: Memory pressure, eviction events
   - INFO: Window closure, observer lifecycle
   - DEBUG: Event filtering, subscription changes

**Acceptance**:
- All logs queryable by observerId
- Performance impact < 2ms per log entry
- Logs structured for JSON parsing

---

#### P3-011: Health Checks & Readiness (2 hours)

**Modify**: `src/apps/event-stream-analyzer-service.ts`

**Endpoints**:
```typescript
// Liveness: Is service running?
GET /healthz → 200 OK (always, unless crashed)

// Readiness: Can service accept traffic?
GET /readyz → 200 OK if:
  - Database connection healthy
  - NATS connection healthy
  - At least 1 observer loaded
  - Snapshot manager running (if enabled)
```

**Kubernetes Integration**:
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

#### P3-012: Alert Definitions (2 hours)

**File**: `infrastructure/alerts/event-stream-analyzer.yaml`

**Alerts**:
```yaml
groups:
  - name: event-stream-analyzer
    rules:
      # High memory usage
      - alert: EventStreamAnalyzerMemoryPressure
        expr: |
          event_stream_analyzer_total_events_gauge
          / event_stream_analyzer_memory_limit_gauge > 0.9
        for: 5m
        annotations:
          summary: "Event stream analyzer nearing memory limit"

      # Analysis failures
      - alert: EventStreamAnalyzerHighErrorRate
        expr: |
          rate(event_stream_analyzer_errors_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate in event stream analyzer"

      # Slow analysis
      - alert: EventStreamAnalyzerSlowAnalysis
        expr: |
          histogram_quantile(0.95,
            event_stream_analyzer_analysis_latency_seconds) > 30
        for: 10m
        annotations:
          summary: "Event stream analysis taking > 30s (p95)"
```

---

### Week 3: Load Testing & Production Validation (P3-013 → P3-016)

#### P3-013: Load Testing Script (6 hours)

**File**: `scripts/load-test-event-stream-analyzer.ts`

**Scenarios**:

**Test 1: 100 Observers, Moderate Load**
- Create 100 observers with sliding windows
- Publish 10k events/min (distributed across observers)
- Run for 30 minutes
- Measure:
  - Memory usage over time
  - CPU usage
  - Analysis latency (p50, p95, p99)
  - Eviction frequency

**Test 2: High-Volume Burst**
- Create 10 observers
- Publish 1000 events/sec for 5 minutes
- Verify:
  - No event loss
  - Memory manager evicts correctly
  - Analysis completes for all windows

**Test 3: Observer Churn**
- Start with 50 observers
- Every minute:
  - Delete 10 random observers
  - Create 10 new observers
- Run for 30 minutes
- Verify:
  - Subscriptions cleaned up
  - No memory leaks
  - Windows restored on restart

**Output**:
```
=== Load Test Results ===
Duration: 30 minutes
Total events published: 300,000
Total analyses triggered: 6,000
Success rate: 99.9%

Memory:
  Peak: 1.8 GB
  Average: 1.2 GB
  Evictions: 23

Latency (analysis):
  p50: 1.2s
  p95: 4.5s
  p99: 8.1s

Throughput:
  Events/sec: 166
  Analyses/sec: 3.3
```

---

#### P3-014: Performance Tuning (6 hours)

**Optimizations**:

1. **Event Filtering**:
   - Move filter logic to stream pipeline (RxJS operators)
   - Avoid processing events that don't match any observer
   - Benchmark: 50% reduction in memory usage

2. **Batch Processing**:
   - Batch snapshot writes (100 windows per transaction)
   - Batch event lookups for restoration
   - Benchmark: 70% reduction in database queries

3. **RxJS Subscription Pooling**:
   - Reuse subscriptions for common topics
   - Reduce overhead of multiple observers on same topic
   - Benchmark: 30% reduction in CPU usage

4. **LLM Cost Optimization**:
   - Pre-filter events before LLM (remove duplicates, low-value messages)
   - Use gpt-4o-mini by default (90% cost reduction vs gpt-4)
   - Summarize in batches when possible

**Acceptance**:
- Memory usage < 2GB for 100 observers
- CPU usage < 50% steady state
- Latency < 1s p95 for analysis
- LLM cost < $0.10 per 1000 events

---

#### P3-015: Agent-Dev Validation (4 hours)

**Objective**: Proactive validation in isolated environment

**Workflow**:
```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-phase3-validation" })

# 2. Deploy service
bit deploy event-stream-analyzer --context agent-dev-phase3-validation

# 3. Create test observer
observer.create({
  id: "test-observer-agent-dev",
  active: true,
  source: {
    mode: "stream",
    topics: ["internal.reflex.v1"],
    filters: { platforms: ["twitch"] }
  },
  window: { type: "sliding", sizeMs: 60000, slideMs: 30000 },
  trigger: { type: "time" },
  analysis: {
    promptId: "standard-chat-summary-v1",
    inspectionEnabled: true
  },
  delivery: {
    egressTopic: "internal.egress.v1",
    destination: { type: "chat", target: "#test" }
  }
})

# 4. Publish test events
# 5. Verify window closure and LLM analysis
# 6. Check logs for errors
# 7. Verify metrics exported

# 8. Cleanup
agent_dev.destroy({ name: "agent-dev-phase3-validation", confirm: true })
```

**Validation Checklist**:
- ✅ Service starts successfully
- ✅ Observer loaded from database
- ✅ Subscription created to internal.reflex.v1
- ✅ Events processed and added to window
- ✅ Window closes after slideMs
- ✅ LLM analysis triggered
- ✅ Summary published to egress
- ✅ Snapshot created periodically
- ✅ Metrics exported on /metrics
- ✅ Clean shutdown with final snapshot

---

#### P3-016: Staging Deployment & Validation (4 hours)

**Deployment**:
```bash
# 1. Run database migration
psql -U postgres -d bitbrat -h staging < infrastructure/postgres/migrations/019-add-window-snapshots.sql

# 2. Deploy service
bit deploy event-stream-analyzer --context staging

# 3. Verify deployment
fleet.info({ bit: "event-stream-analyzer", context: "staging" })
fleet.logs({ bit: "event-stream-analyzer", context: "staging", limit: 100 })
```

**Create Production Observer**:
```typescript
observer.create({
  id: "twitch-chat-summary-5min",
  active: true,
  source: {
    mode: "stream",
    topics: ["internal.reflex.v1"],
    filters: {
      platforms: ["twitch"],
      eventTypes: ["chat.message.v1"]
    }
  },
  window: {
    type: "sliding",
    sizeMs: 300000,  // 5 minutes
    slideMs: 60000   // 1 minute slide
  },
  trigger: { type: "time" },
  analysis: {
    promptId: "standard-chat-summary-v1",
    inspectionEnabled: false,
    outputFormat: "markdown"
  },
  delivery: {
    egressTopic: "internal.egress.v1",
    destination: {
      type: "chat",
      target: "#bitbrat"
    }
  }
})
```

**Validation**:
- Monitor for 24 hours
- Verify summaries delivered to Twitch chat
- Check Prometheus metrics in Grafana
- Review logs for errors
- Validate snapshot/restore on service restart

---

## Testing Strategy

### Test Pyramid

**Unit Tests (50%)**:
- SnapshotManager snapshot/restore cycle
- MemoryManager eviction strategies
- MetricsCollector metric updates
- StreamAnalystEngine integration

**Integration Tests (30%)**:
- End-to-end LLM analysis flow
- Crash recovery scenarios
- Graceful shutdown validation
- Memory pressure handling

**Load Tests (15%)**:
- 100 observers at 10k events/min
- High-volume burst scenarios
- Observer churn (create/delete)

**Production Validation (5%)**:
- Agent-dev deployment
- Staging deployment with real traffic
- 24-hour monitoring

### Coverage Targets

- **Line Coverage**: 85%+
- **Branch Coverage**: 80%+
- **New Components**: 90%+ (SnapshotManager, MemoryManager, MetricsCollector)

---

## Deployment Plan

### Environments

| Environment | Status | Purpose |
|-------------|--------|---------|
| Local | ✅ Ready | Development and unit testing |
| Agent-dev | ✅ Ready | Proactive validation (Phase 3) |
| Staging | ✅ Ready | Integration testing with real events |
| Production | ⏸️ Post-Phase 3 | After successful staging validation |

### Migration Steps

**1. Database Migration** (Staging, Production):
```bash
# Staging
psql -U postgres -d bitbrat -h staging < infrastructure/postgres/migrations/019-add-window-snapshots.sql

# Production (after staging validation)
psql -U postgres -d bitbrat -h production < infrastructure/postgres/migrations/019-add-window-snapshots.sql
```

**2. Service Deployment**:
```bash
# Agent-dev (proactive validation)
agent_dev.provision({ name: "agent-dev-phase3" })
bit deploy event-stream-analyzer --context agent-dev-phase3

# Staging
bit deploy event-stream-analyzer --context staging

# Production (blue/green deployment)
bit deploy event-stream-analyzer --context production
```

**3. Observer Migration** (if needed):
```sql
-- Update existing observers with new analysis config
UPDATE stream_observers
SET data = jsonb_set(
  data,
  '{analysis,promptId}',
  '"standard-chat-summary-v1"'
)
WHERE (data->'analysis'->>'promptId') IS NULL;
```

---

## Risk Mitigation

### Identified Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM cost explosion | Medium | High | Use gpt-4o-mini, pre-filter events, set cost limits |
| Snapshot overhead impacts performance | Medium | Medium | Batch writes, async snapshots, benchmark early |
| Memory eviction loses important events | Low | Medium | Configurable thresholds, alert on eviction frequency |
| Crash during snapshot causes data corruption | Low | High | Atomic writes, transaction rollback on failure |

### Mitigation Strategies

**LLM Cost Management**:
- Default to gpt-4o-mini ($0.15/1M tokens vs $5/1M for gpt-4)
- Pre-filter events (remove duplicates, system messages)
- Set per-observer cost limits in config
- Alert when daily cost exceeds threshold

**Snapshot Performance**:
- Run snapshots asynchronously (don't block event processing)
- Batch writes (100 windows per transaction)
- Benchmark: snapshot should complete in < 100ms
- If too slow, increase interval or reduce snapshot granularity

**Memory Eviction**:
- Default threshold: 10,000 events total across all windows
- Evict oldest first (configurable strategy)
- Log all evictions with context
- Alert if eviction rate > 5% of events

**Data Corruption**:
- Use PostgreSQL transactions for snapshot writes
- Rollback on any error
- Validate snapshot data before save
- Test restore from corrupted snapshots

---

## Success Criteria

### Phase 3 Completion Criteria

**Functional**:
- ✅ Real LLM analysis replacing stub summaries
- ✅ Snapshot/restore validated (max 5-min data loss)
- ✅ Graceful shutdown with zero data loss
- ✅ Memory management with automatic eviction
- ✅ Prometheus metrics exported
- ✅ Health checks and readiness probes

**Quality**:
- ✅ 30+ new tests, 100% passing
- ✅ 85%+ code coverage on new code
- ✅ No TypeScript errors
- ✅ No linting errors
- ✅ Load tests pass at target scale

**Performance**:
- ✅ Memory usage < 2GB (100 observers)
- ✅ CPU usage < 50% steady state
- ✅ Analysis latency < 5s p95
- ✅ Snapshot overhead < 100ms
- ✅ LLM cost < $0.10 per 1000 events

**Operational**:
- ✅ Agent-dev deployment successful
- ✅ Staging deployment validated (24 hours)
- ✅ Grafana dashboards created
- ✅ Alert rules defined
- ✅ Runbook documentation complete

### Definition of Done (Per Task)

- [ ] Code implemented and reviewed
- [ ] Unit tests written and passing
- [ ] Integration tests added (where applicable)
- [ ] Performance benchmarked (if relevant)
- [ ] Documentation updated (code comments + user docs)
- [ ] No new TypeScript errors
- [ ] Deployed to agent-dev and validated
- [ ] Task marked complete in backlog

---

## Next Steps

1. ✅ Review and approve this implementation plan
2. ⏭️ Start P3-001: Integrate StreamAnalystEngine
3. ⏭️ Progress through tasks sequentially (respecting dependencies)
4. ⏭️ Deploy to agent-dev for validation before completion
5. ⏭️ Staging deployment for 24-hour soak test
6. ⏭️ Production deployment (blue/green)

**Estimated Timeline**: 3-4 weeks (64 hours total effort)

**Phase 4 Handoff**: After successful Phase 3 validation, prepare handoff document for advanced features (hybrid mode, condition triggers, advanced aggregations).

---

**Prepared By:** Lead Implementor
**Date:** 2026-08-19
**Sprint:** sprint-20-xc3pcu
**Phase:** 3 of 4

