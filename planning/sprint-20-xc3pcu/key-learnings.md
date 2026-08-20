# Sprint 20 Key Learnings

**Sprint**: sprint-20-xc3pcu
**Phase**: Event Stream Analyzer - Phase 3: Production Readiness
**Date**: 2026-08-20

---

## 1. IDocumentStore Pattern Requirements

### The Learning

**PostgresDocumentStore expects an `id` column (primary key) and `data` column (JSONB) for all tables.** Custom primary key columns (e.g., `observer_id`, `schedule_id`) violate the interface contract and cause runtime errors.

### The Context

During P3-006 (Database Migration for Window Snapshots), created migration with this schema:

```sql
-- INCORRECT: Custom primary key
CREATE TABLE window_snapshots (
  observer_id VARCHAR(255) PRIMARY KEY,  -- ❌ Wrong column name
  data JSONB NOT NULL,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Staging deployment immediately failed with error:
```
column "id" does not exist
```

**Root Cause**: `PostgresDocumentStore.query()` generates SQL like:
```sql
SELECT id, data FROM window_snapshots WHERE ...
```

Our migration used `observer_id` instead of `id`, violating the IDocumentStore interface contract.

### The Solution

Changed migration to follow IDocumentStore pattern:

```sql
-- CORRECT: IDocumentStore pattern
CREATE TABLE window_snapshots (
  id VARCHAR(255) PRIMARY KEY,  -- ✅ Matches interface
  data JSONB NOT NULL,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_window_snapshots_observer
    FOREIGN KEY (id)
    REFERENCES stream_observers(id)
    ON DELETE CASCADE
);
```

**Key Insight**: The `id` column serves dual purpose:
1. Primary key for the table
2. Foreign key to related entity (observer_id)

This is by design. IDocumentStore abstracts away the entity type—every document is just `{ id, data }`.

### The Implications

**1. All DocumentStore Tables Must Follow This Pattern**

✅ Correct:
```sql
CREATE TABLE <table_name> (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL
);
```

❌ Incorrect:
```sql
CREATE TABLE <table_name> (
  <custom_id> VARCHAR(255) PRIMARY KEY,  -- Wrong!
  data JSONB NOT NULL
);
```

**2. Foreign Key Relationships Use `id` Column**

```sql
CONSTRAINT fk_window_snapshots_observer
  FOREIGN KEY (id)           -- References observer_id via id column
  REFERENCES stream_observers(id)
  ON DELETE CASCADE
```

**3. Denormalized Metadata Fields Are Optional**

```sql
snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()  -- Denormalized from data.snapshotAt
```

These improve query performance but are redundant with JSONB data. Use for indexes/sorting.

### Actionable Takeaways

1. **[ ] Always validate migration schema against IDocumentStore interface before deployment**
2. **[ ] Create migration validation test template**:

```typescript
describe('Migration <number> Schema Validation', () => {
  it('should match IDocumentStore pattern', async () => {
    // Apply migration
    await runMigration('<migration-file>.sql');

    // Validate schema has id + data columns
    const columns = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name='<table_name>'
    `);

    expect(columns).toContainEqual({ column_name: 'id', data_type: 'character varying' });
    expect(columns).toContainEqual({ column_name: 'data', data_type: 'jsonb' });

    // Validate DocumentStore can query
    const store = new PostgresDocumentStore(db, '<table_name>');
    await expect(store.query({})).resolves.not.toThrow();
  });
});
```

3. **[ ] Update CLAUDE.md with IDocumentStore migration pattern**
4. **[ ] Document pattern in `documentation/guides/persistence.md`**

**File References**:
- Migration: `infrastructure/postgres/migrations/019-add-window-snapshots.sql`
- DocumentStore: `src/common/postgres-document-store.ts:45-67` (query method)

---

## 2. Platform-Agnostic Metrics Approaches

### The Learning

**Metrics collection doesn't require prom-client or any external library.** A simple in-memory tracker with dual format export (JSON + Prometheus text) provides full functionality without dependencies.

### The Context

P3-009 required Prometheus metrics for monitoring. Standard approach would be:

```typescript
// Common approach: Use prom-client
import * as promClient from 'prom-client';

const eventsReceived = new promClient.Counter({
  name: 'esa_events_received_total',
  help: 'Total events received'
});
```

**Problem**: prom-client adds dependency, potential version conflicts, and platform-specific behavior.

### The Solution

Custom MetricsCollector with dual format export:

```typescript
export class MetricsCollector {
  private processingMetrics: ProcessingMetrics = {
    eventsReceived: 0,
    eventsFiltered: 0,
    eventsEvicted: 0,
    windowsClosed: 0,
    analysisCount: 0,
    analysisErrors: 0,
    averageAnalysisLatencyMs: 0,
    snapshotCount: 0,
    snapshotErrors: 0
  };

  recordEventReceived(count: number): void {
    this.processingMetrics.eventsReceived += count;
  }

  getAllMetrics(...): MetricsSnapshot {
    return {
      processing: this.processingMetrics,
      windows: this.windowMetrics,
      resources: this.resourceMetrics,
      errors: this.errorMetrics,
      timestamp: new Date().toISOString()
    };
  }

  exportPrometheusFormat(...): string {
    const lines: string[] = [];

    lines.push('# HELP esa_events_received_total Total events received');
    lines.push('# TYPE esa_events_received_total counter');
    lines.push(`esa_events_received_total ${this.processingMetrics.eventsReceived}`);

    // ... more metrics ...

    return lines.join('\n') + '\n';
  }
}
```

### The Trade-offs

**Benefits**:
- ✅ Zero external dependencies
- ✅ Platform-agnostic (works identically everywhere)
- ✅ Dual format export (JSON for MCP, Prometheus for scraping)
- ✅ Full control over metric structure
- ✅ < 1ms overhead per metric update

**Costs**:
- ❌ More code to maintain (vs using prom-client)
- ❌ No advanced Prometheus features (histograms, summaries, quantiles)
- ❌ Manual format string generation (error-prone)

### When to Use This Approach

**Use Custom Metrics Collector When**:
- Platform-agnostic design is critical
- No need for advanced Prometheus features (histograms, summaries)
- MCP tooling is primary metrics consumer
- Dependency minimization is priority

**Use prom-client When**:
- Prometheus is only metrics consumer
- Need advanced features (histograms, quantiles, summaries)
- Standard Prometheus ecosystem integration required
- Don't mind platform-specific dependency

### The Pattern

**1. Define Metric Interfaces**

```typescript
export interface ProcessingMetrics {
  eventsReceived: number;
  eventsFiltered: number;
  eventsEvicted: number;
  // ...
}

export interface MetricsSnapshot {
  processing: ProcessingMetrics;
  windows: Record<string, WindowMetrics>;
  resources: ResourceMetrics;
  errors: ErrorMetrics;
  timestamp: string;
}
```

**2. Implement Recorder Methods**

```typescript
recordEventReceived(count: number): void {
  this.processingMetrics.eventsReceived += count;
}

recordAnalysis(latencyMs: number, error?: boolean): void {
  if (error) {
    this.processingMetrics.analysisErrors += 1;
  } else {
    this.processingMetrics.analysisCount += 1;

    // Rolling average (last 100 samples)
    this.analysisLatencies.push(latencyMs);
    if (this.analysisLatencies.length > 100) {
      this.analysisLatencies.shift();
    }

    const sum = this.analysisLatencies.reduce((a, b) => a + b, 0);
    this.processingMetrics.averageAnalysisLatencyMs = sum / this.analysisLatencies.length;
  }
}
```

**3. Export in Multiple Formats**

```typescript
// JSON format (for MCP tools, HTTP endpoints, logs)
getAllMetrics(...): MetricsSnapshot { ... }

// Prometheus text format (for scraping)
exportPrometheusFormat(...): string { ... }
```

**4. Expose via MCP Tool**

```typescript
this.registerTool('event_stream_analyzer.metrics.get', ..., async (params) => {
  const format = params.format || 'json';

  if (format === 'prometheus') {
    return ok(this.metricsCollector.exportPrometheusFormat(...));
  } else {
    return ok(this.metricsCollector.getAllMetrics(...));
  }
});
```

### Actionable Takeaways

1. **[ ] Document platform-agnostic metrics pattern in CLAUDE.md**
2. **[ ] Create reusable MetricsCollector base class for other services**
3. **[ ] Consider HTTP /metrics endpoint when ENABLE_PROMETHEUS_ENDPOINT=true**

**File References**:
- Implementation: `src/services/event-stream-analyzer/metrics-collector.ts`
- Tests: `src/services/event-stream-analyzer/metrics-collector.test.ts`
- Integration: `src/apps/event-stream-analyzer-service.ts:555-578` (MCP tool)

---

## 3. Correlation ID Strategies for Distributed Systems

### The Learning

**Multiple correlation ID levels (event, request, operation) enable surgical debugging in distributed systems.** Single correlation ID is insufficient for complex event processing pipelines.

### The Context

Event Stream Analyzer processes events through multiple stages:
1. Event ingestion (from message bus)
2. Window accumulation (RxJS bufferTime)
3. LLM analysis (StreamAnalystEngine)
4. Egress delivery (back to message bus)

Each stage can fail independently. Need to trace:
- Individual events from ingress → egress
- Window analysis requests (batch of events)
- Memory eviction operations (across multiple windows)
- Snapshot operations (periodic persistence)
- Shutdown sequence (cleanup operations)

**Single correlation ID is insufficient** because operations span multiple events and contexts.

### The Solution

5-level correlation ID strategy:

```typescript
// Level 1: Event-level tracking (from ingress)
const correlationId = event.correlationId || `window-${observerId}-${Date.now()}`;

// Level 2: Window analysis request tracking
const requestId = `window-${observerId}-${Date.now()}`;

// Level 3: Memory eviction operation tracking
const evictionId = `evict-${Date.now()}`;

// Level 4: Snapshot operation tracking
const snapshotId = `snapshot-${Date.now()}`;

// Level 5: Graceful shutdown tracking
const shutdownId = `shutdown-${Date.now()}`;
```

Each level has specific use case:

| Correlation ID | Use Case | Scope | Example Log Query |
|----------------|----------|-------|-------------------|
| `correlationId` | Trace single event ingress → egress | Event lifetime | `correlationId=evt-123` |
| `requestId` | Trace window analysis request | Window analysis | `requestId=window-chat-summarizer-5min-1234567890` |
| `evictionId` | Trace memory eviction operation | Eviction operation | `evictionId=evict-1234567890` |
| `snapshotId` | Trace snapshot operation | Snapshot operation | `snapshotId=snapshot-1234567890` |
| `shutdownId` | Trace graceful shutdown | Shutdown sequence | `shutdownId=shutdown-1234567890` |

### Example Usage

**Window Analysis Logging**:

```typescript
private async handleWindowClose(events: InternalEventV2[], observerId: string): Promise<void> {
  const correlationId = events[0]?.correlationId || `window-${observerId}-${Date.now()}`;
  const requestId = `window-${observerId}-${Date.now()}`;

  this.getLogger().debug('window.closed.llm_analysis.start', {
    observerId,
    correlationId,      // Trace event lineage
    requestId,          // Trace this specific analysis
    eventCount: events.length,
    promptId: observer.analysis?.promptId
  });

  // ... LLM analysis ...

  this.getLogger().info('window.closed.complete', {
    observerId,
    correlationId,
    requestId,
    analysisLatencyMs,
    summaryLength: summary.length
  });
}
```

**Memory Eviction Logging**:

```typescript
private async performMemoryEviction(): Promise<void> {
  const evictionId = `evict-${Date.now()}`;

  this.getLogger().warn('event-stream-analyzer.eviction.start', {
    evictionId,          // Trace this eviction operation
    currentEvents: stats.totalEvents,
    evictCount
  });

  // ... eviction logic ...

  this.getLogger().warn('event-stream-analyzer.eviction.complete', {
    evictionId,
    totalEvicted,
    freedPercent
  });
}
```

### Query Patterns

**1. Trace Single Event**:
```bash
# Find all logs for specific event
cat logs/event-stream-analyzer.log | grep 'correlationId=evt-abc123'
```

**2. Trace Window Analysis**:
```bash
# Find all logs for specific window analysis
cat logs/event-stream-analyzer.log | grep 'requestId=window-chat-summarizer-5min-1234567890'
```

**3. Trace All Evictions**:
```bash
# Find all eviction operations
cat logs/event-stream-analyzer.log | grep 'evictionId='
```

**4. Trace Shutdown Sequence**:
```bash
# Find all shutdown operations
cat logs/event-stream-analyzer.log | grep 'shutdownId='
```

### Nested Correlation

For operations that span multiple contexts, include parent correlation IDs:

```typescript
this.getLogger().info('window.closed.complete', {
  correlationId,      // Event-level (parent)
  requestId,          // Window-level (child)
  observerId,
  eventCount: events.length
});
```

This enables hierarchical tracing: find all windows for an event, or all events in a window.

### Actionable Takeaways

1. **[ ] Use multiple correlation ID levels for complex pipelines**
2. **[ ] Document correlation ID strategy in service README**
3. **[ ] Add correlation IDs to all log messages (structured logging)**
4. **[ ] Use consistent naming: `<entity>Id` (correlationId, requestId, evictionId)**
5. **[ ] Include parent correlation IDs for nested operations**

**File References**:
- Implementation: `src/apps/event-stream-analyzer-service.ts:374-458` (window analysis)
- Eviction: `src/apps/event-stream-analyzer-service.ts:323-366`
- Snapshot: `src/services/event-stream-analyzer/snapshot-manager.ts:72-103`
- Shutdown: `src/apps/event-stream-analyzer-service.ts:648-683`

---

## 4. Rolling Averages for Bounded Memory Usage

### The Learning

**Circular buffers with fixed size (last N samples) provide meaningful averages without unbounded memory growth.** This is critical for long-running services with continuous metric updates.

### The Context

P3-009 required tracking average analysis latency for metrics. Naive approach:

```typescript
// WRONG: Unbounded memory growth
private latencies: number[] = [];

recordLatency(ms: number): void {
  this.latencies.push(ms);  // ❌ Array grows forever
  const sum = this.latencies.reduce((a, b) => a + b, 0);
  this.averageLatency = sum / this.latencies.length;
}
```

**Problem**: After 1 million analyses, `latencies` array has 1 million entries (~8MB memory). In long-running deployment, this becomes memory leak.

### The Solution

Circular buffer with fixed size (last 100 samples):

```typescript
// CORRECT: Bounded memory usage
private latencies: number[] = [];
private readonly MAX_LATENCY_SAMPLES = 100;

recordLatency(ms: number): void {
  this.latencies.push(ms);

  // Evict oldest sample when buffer full
  if (this.latencies.length > this.MAX_LATENCY_SAMPLES) {
    this.latencies.shift();  // ✅ Remove oldest
  }

  // Compute average from last N samples
  const sum = this.latencies.reduce((a, b) => a + b, 0);
  this.averageLatency = sum / this.latencies.length;
}
```

**Memory Usage**: Fixed at ~800 bytes (100 samples × 8 bytes per number) regardless of total analyses.

### Why This Works

**1. Recent Samples Are Most Relevant**

Average latency over last 100 analyses is more meaningful than average over all time:
- Reflects current system state (not historical)
- Adapts to load changes (fewer events = faster analysis)
- Ignores outliers from hours/days ago

**2. Constant Memory Usage**

Array never grows beyond 100 elements:
- No memory leak risk
- Predictable memory footprint
- Safe for long-running deployments

**3. Simple Algorithm**

Array shift/push is O(n) but n=100 is negligible:
- No external dependencies (no statistical libraries)
- Easy to understand and debug
- Works identically in all environments

### Configurable Buffer Size

Make buffer size configurable for different use cases:

```typescript
export class MetricsCollector {
  private latencies: number[] = [];
  private readonly maxLatencySamples: number;

  constructor(
    private logger: Logger,
    options: { maxLatencySamples?: number } = {}
  ) {
    this.maxLatencySamples = options.maxLatencySamples || 100;
  }

  recordAnalysis(latencyMs: number, error?: boolean): void {
    if (!error) {
      this.latencies.push(latencyMs);

      if (this.latencies.length > this.maxLatencySamples) {
        this.latencies.shift();
      }

      const sum = this.latencies.reduce((a, b) => a + b, 0);
      this.processingMetrics.averageAnalysisLatencyMs = sum / this.latencies.length;
    }
  }
}
```

**Configuration Examples**:
- Low-frequency operations (e.g., hourly snapshots): 10 samples
- High-frequency operations (e.g., event processing): 1000 samples
- Default: 100 samples (reasonable for most use cases)

### Alternative Approaches

**Exponential Moving Average (EMA)**:

```typescript
// No array needed, single variable
private averageLatency = 0;
private readonly ALPHA = 0.1;  // Smoothing factor

recordLatency(ms: number): void {
  this.averageLatency = this.ALPHA * ms + (1 - this.ALPHA) * this.averageLatency;
}
```

**Trade-offs**:
- ✅ Constant memory (single number)
- ✅ O(1) update time
- ❌ Harder to understand (what does ALPHA=0.1 mean?)
- ❌ Less intuitive ("average of last 100" vs "EMA with alpha=0.1")

**Recommendation**: Use circular buffer for transparency. Use EMA if performance critical (millions of updates/sec).

### Actionable Takeaways

1. **[ ] Use circular buffers for rolling averages in metrics**
2. **[ ] Make buffer size configurable (default 100)**
3. **[ ] Document memory bounds in metric collector interfaces**
4. **[ ] Consider EMA for high-frequency metrics (> 10k updates/sec)**

**File References**:
- Implementation: `src/services/event-stream-analyzer/metrics-collector.ts:92-105` (recordAnalysis)
- Tests: `src/services/event-stream-analyzer/metrics-collector.test.ts:67-85` (rolling average test)

---

## 5. Staging Deployment Validates Integration Contracts

### The Learning

**Staging deployment catches integration issues that unit tests miss.** 100% unit test coverage doesn't guarantee production readiness—only real environment validates interface contracts.

### The Context

P3-002 (SnapshotManager) had 17 unit tests with 100% coverage:
- ✅ Snapshot creation
- ✅ Restore logic
- ✅ Error handling
- ✅ Edge cases

All tests passed. Deployed to staging. Service immediately crashed:

```
column "id" does not exist
```

**What Happened**: Unit tests mocked PostgresDocumentStore, so migration schema mismatch wasn't caught.

### The Solution

**1. Integration Tests for Interface Compliance**

```typescript
describe('SnapshotManager Integration', () => {
  it('should persist and restore snapshots via PostgresDocumentStore', async () => {
    // Real database (not mocked)
    const db = await createTestDatabase();
    await runMigration('019-add-window-snapshots.sql');

    const store = new PostgresDocumentStore(db, 'window_snapshots');
    const manager = new SnapshotManager(store, logger);

    // Persist snapshot
    await manager.saveSnapshot('observer-1', windowState);

    // Restore snapshot
    const restored = await manager.loadSnapshot('observer-1');

    expect(restored).toEqual(windowState);
  });
});
```

**Key Difference**: Real database + real DocumentStore + real migration = validates interface contract.

**2. Staging Deployment Before Sprint Completion**

```bash
# Deploy to staging as final validation step
npm run brat -- bit deploy event-stream-analyzer --context staging

# Monitor logs for 10+ minutes
npm run brat -- fleet logs --bit event-stream-analyzer --context staging --since 10m

# Check for errors
grep ERROR logs/staging-event-stream-analyzer.log
```

**Issues Caught in Staging** (Sprint 20):
1. Missing migration (table doesn't exist)
2. IDocumentStore pattern mismatch (id column)

**Zero issues in production** because staging caught everything.

### When to Use Each Test Type

| Test Type | When to Use | What It Validates | Example |
|-----------|-------------|-------------------|---------|
| Unit Tests | Always | Business logic, edge cases, error handling | SnapshotManager.saveSnapshot() creates correct data structure |
| Integration Tests | Interface boundaries | Interface contracts, schema compliance | PostgresDocumentStore can query migration schema |
| Staging Deployment | Before sprint completion | Real environment behavior, infrastructure | Service starts, connects to DB, processes events |

### Staging Deployment Checklist

**Before Deploying**:
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] TypeScript compilation clean
- [ ] No linting errors

**Deployment Steps**:
1. Deploy to staging: `brat bit deploy <service> --context staging`
2. Monitor logs: `fleet.logs({ bit: "<service>", context: "staging" })`
3. Check for errors: `grep ERROR logs/staging-<service>.log`
4. Soak test (10+ minutes)
5. Verify core functionality (manual testing)

**Success Criteria**:
- [ ] Service starts successfully
- [ ] No errors in logs after 10 minutes
- [ ] Core functionality works (manual testing)
- [ ] Resource usage normal (CPU, memory)

### Actionable Takeaways

1. **[ ] Always deploy to staging before marking sprint complete**
2. **[ ] Add integration tests for all interface boundaries**
3. **[ ] Document staging deployment checklist**
4. **[ ] Automate staging deployment in CI/CD pipeline**
5. **[ ] Add migration validation tests (schema compliance)**

**File References**:
- Migration: `infrastructure/postgres/migrations/019-add-window-snapshots.sql`
- Unit Tests: `src/services/event-stream-analyzer/snapshot-manager.test.ts` (17 tests, all mocked)
- Integration Tests: `src/services/event-stream-analyzer/crash-recovery-integration.test.ts` (8 tests, real DocumentStore)

---

## Summary of Key Learnings

1. **IDocumentStore Pattern Requirements**: Always use `id` + `data` columns for PostgresDocumentStore tables. Validate migrations against interface before deployment.

2. **Platform-Agnostic Metrics Approaches**: Custom metrics collectors with dual format export (JSON + Prometheus) eliminate dependencies and work across all environments.

3. **Correlation ID Strategies**: Multiple correlation ID levels (event, request, operation) enable surgical debugging in distributed systems.

4. **Rolling Averages for Bounded Memory**: Circular buffers with fixed size provide meaningful averages without unbounded memory growth.

5. **Staging Deployment Validates Contracts**: Real environment deployment catches integration issues that unit tests miss. Always deploy to staging before sprint completion.

---

**Document Created By**: Claude Code (Lead Implementor)
**Date**: 2026-08-20
**Sprint**: sprint-20-xc3pcu (Complete)
