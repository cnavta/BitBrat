# Execution Plan: Stream Analyst Real-Time v4
## In-Memory Event Stream Processing with Sliding Windows

**Project Lead**: Lead Implementor
**Architecture**: [stream-analyst-realtime-v4.md](../../documentation/technical-architecture/stream-analyst-realtime-v4.md)
**Start Date**: 2026-08-18
**Target Completion**: 8 sprints (Phase 1-3: 5 sprints, Phase 4: 3 sprints)

---

## Executive Summary

This execution plan implements a **real-time event stream processing service** for BitBrat, replacing the proposed database-polling approach with native NATS topic subscriptions and in-memory sliding windows. The service enables sub-second latency pattern detection, toxicity analysis, and automated summarization across event streams.

**Key Implementation Change**: We will create a new `event-stream-analyzer` service using the `brat` CLI tooling. The existing `stream-analyst-service` will be marked as `active: false` in architecture.yaml and deprecated.

---

## Project Phases

### Phase 1: Proof of Concept (Sprint 1)
**Duration**: 1 sprint (2 weeks)
**Goal**: Validate RxJS-based streaming approach with single observer
**Risk**: HIGH (new technology, architectural validation)
**Go/No-Go Decision**: End of Sprint 1

### Phase 2: Multi-Observer & Window Types (Sprints 2-3)
**Duration**: 2 sprints (4 weeks)
**Goal**: Observer lifecycle management, all window types functional
**Risk**: MEDIUM (dynamic subscription management)

### Phase 3: Production Readiness (Sprints 4-5)
**Duration**: 2 sprints (4 weeks)
**Goal**: Snapshots, observability, load testing
**Risk**: MEDIUM (data loss mitigation, performance)

### Phase 4: Advanced Features (Sprints 6-8) [OPTIONAL]
**Duration**: 3 sprints (6 weeks)
**Goal**: Hybrid mode, condition-based triggers, advanced aggregations
**Risk**: LOW (enhancements, not blockers)

---

## Phase 1: Proof of Concept (Sprint 1)

### Sprint 1 Objectives

**Primary Goal**: Demonstrate end-to-end real-time stream processing with RxJS

**Success Criteria**:
- ✅ Single observer processes events from NATS in < 1 second latency
- ✅ RxJS `bufferTime` correctly implements 5-min sliding window
- ✅ LLM analysis triggered on window closure
- ✅ Results published to `internal.egress.v1`
- ✅ Memory usage < 100MB for single observer
- ✅ Zero database queries during streaming

**Deliverables**:
1. Working POC service (new codebase, ignore existing)
2. Performance benchmark report (latency, memory, throughput)
3. Integration test suite (end-to-end flow)
4. Go/no-go recommendation

### Implementation Tasks

#### 1.1 Project Setup & Dependencies
**Estimated Effort**: 2 hours

```bash
# Install RxJS
npm install rxjs

# Install testing utilities
npm install --save-dev @types/node
```

**Service Creation**:
- Use `brat bit create event-stream-analyzer --profile llm --exposure platform-only --stage analyze --register --active`
- This generates: `src/apps/event-stream-analyzer-service.ts`, test file, Dockerfile, compose file

**New Files to Create**:
- `src/services/event-stream-analyzer/rxjs-window-manager.ts` (NEW)
- `src/services/event-stream-analyzer/event-filter.ts` (NEW)

**Reuse from Existing stream-analyst**:
- `src/services/stream-analyst/stream-buffer.ts` (PII redaction, tokenization - copy/adapt)
- `src/services/stream-analyst/engine.ts` (LLM analysis logic - copy/refactor to be window-agnostic)

#### 1.2 Core RxJS Window Manager
**Estimated Effort**: 8 hours

**File**: `src/services/event-stream-analyzer/rxjs-window-manager.ts`

```typescript
import { Subject, Subscription } from 'rxjs';
import { bufferTime, filter } from 'rxjs/operators';
import type { InternalEventV2 } from '../../types/events';
import type { StreamObserver } from '../../types/sessi';

export class RxJSWindowManager {
  private eventSubject = new Subject<InternalEventV2>();
  private subscriptions = new Map<string, Subscription>();
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Create a sliding window observer using RxJS bufferTime
   */
  createSlidingWindow(
    observer: StreamObserver,
    onWindowClose: (events: InternalEventV2[], observerId: string) => Promise<void>
  ): void {
    const { windowSizeMs, slideMs } = observer.window;

    const subscription = this.eventSubject.pipe(
      // Filter events matching this observer
      filter(event => this.matchesObserver(event, observer)),

      // Buffer events in sliding window
      bufferTime(windowSizeMs, slideMs),

      // Skip empty windows
      filter(events => events.length > 0)
    ).subscribe({
      next: async (events) => {
        this.logger.info('rxjs.window.closed', {
          observerId: observer.id,
          eventCount: events.length
        });
        await onWindowClose(events, observer.id);
      },
      error: (err) => {
        this.logger.error('rxjs.window.error', {
          observerId: observer.id,
          error: err.message
        });
      }
    });

    this.subscriptions.set(observer.id, subscription);
  }

  /**
   * Add event to stream (will be routed to matching windows)
   */
  addEvent(event: InternalEventV2): void {
    this.eventSubject.next(event);
  }

  /**
   * Match event against observer filters
   */
  private matchesObserver(event: InternalEventV2, observer: StreamObserver): boolean {
    const { filters } = observer.source;
    if (!filters) return true;

    // Platform filter
    if (filters.platforms?.length) {
      const platform = event.ingress?.source || event.source?.platform;
      if (!filters.platforms.includes(platform)) return false;
    }

    // Event type filter
    if (filters.eventTypes?.length) {
      if (!filters.eventTypes.includes(event.type)) return false;
    }

    // Channel filter (example - adjust based on event schema)
    if (filters.channels?.length) {
      const channel = event.source?.channel;
      if (!channel || !filters.channels.includes(channel)) return false;
    }

    return true;
  }

  /**
   * Remove observer (cleanup subscription)
   */
  removeObserver(observerId: string): void {
    const sub = this.subscriptions.get(observerId);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(observerId);
    }
  }

  /**
   * Cleanup all subscriptions
   */
  destroy(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
  }
}
```

**Tests**: `src/services/event-stream-analyzer/rxjs-window-manager.test.ts`
- Test sliding window timing (5 min window, 1 min slide)
- Test event filtering (platform, eventType, channel)
- Test multiple observers independently
- Test subscription cleanup

#### 1.3 Service Integration (Passive Observer Pattern)
**Estimated Effort**: 6 hours

**File**: `src/apps/event-stream-analyzer-service.ts`

```typescript
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { RxJSWindowManager } from '../services/event-stream-analyzer/rxjs-window-manager';
import { StreamAnalystEngine } from '../services/event-stream-analyzer/engine';
import { createMessagePublisher } from '../services/message-bus';
import { z } from 'zod';

export class EventStreamAnalyzerService extends Bit {
  private windowManager: RxJSWindowManager;
  private engine: StreamAnalystEngine;

  constructor(opts = {}) {
    super({
      ...opts,
      serviceName: 'event-stream-analyzer',
      mcpExposure: 'platform-only'
    });
  }

  protected static CONFIG_DEFAULTS = {
    SERVICE_NAME: 'event-stream-analyzer',
    PORT: 3000,
    STREAM_ANALYST_MODE: 'stream',
    STREAM_ANALYST_DEFAULT_WINDOW_SIZE_MS: 300000,  // 5 min
    STREAM_ANALYST_DEFAULT_SLIDE_MS: 60000          // 1 min
  };

  async setup(): Promise<void> {
    this.windowManager = new RxJSWindowManager(this.getLogger());
    this.engine = new StreamAnalystEngine(
      this.getResource('documentStore'),
      this.getLogger()
    );

    // POC: Hardcode single observer for now
    const pocObserver = this.createPOCObserver();
    this.windowManager.createSlidingWindow(
      pocObserver,
      this.handleWindowClose.bind(this)
    );

    // Subscribe to contextualization topic (passive observer)
    await this.onMessage<InternalEventV2>(
      {
        destination: 'internal.contextualization.v1',
        queue: 'event-stream-analyzer-observer'
      },
      async (event, attrs, ctx) => {
        this.windowManager.addEvent(event);
        await ctx.ack();
      }
    );

    this.getLogger().info('event-stream-analyzer.setup.complete', {
      mode: 'stream',
      observers: 1
    });
  }

  private createPOCObserver() {
    return {
      id: 'poc-chat-summary',
      active: true,
      mcpEnabled: false,
      source: {
        mode: 'stream',
        topics: ['internal.contextualization.v1'],
        filters: {
          platforms: ['twitch'],
          eventTypes: ['chat.message.v1']
        }
      },
      window: {
        type: 'sliding',
        sizeMs: 300000,  // 5 minutes
        slideMs: 60000,  // 1 minute
        maxEvents: 500
      },
      trigger: { type: 'time' },
      analysis: {
        promptId: 'standard-chat-summary-v1',
        inspectionEnabled: false,
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1',
        destination: {
          type: 'chat',
          target: '#bitbrat'
        }
      }
    };
  }

  private async handleWindowClose(events: InternalEventV2[], observerId: string): Promise<void> {
    try {
      this.getLogger().info('event-stream-analyzer.window.analyzing', {
        observerId,
        eventCount: events.length
      });

      // Use existing engine for LLM analysis
      const summary = await this.engine.summarize({
        requestId: `window-${observerId}-${Date.now()}`,
        observerId,
        streamType: 'chat',
        windowMinutes: 5,
        inspectionEnabled: false
      });

      // Publish to summarization report topic
      const reportPub = createMessagePublisher('internal.summarization.report.v1');
      await reportPub.publishJson({
        observerId,
        summary,
        eventCount: events.length,
        at: new Date().toISOString()
      });

      // Publish to egress
      const egressPub = createMessagePublisher('internal.egress.v1');
      await egressPub.publishJson({
        requestId: `window-${observerId}-${Date.now()}`,
        egress: {
          destination: '#bitbrat',
          connector: 'twitch',
          type: 'chat'
        },
        message: {
          id: `summary-${Date.now()}`,
          role: 'assistant',
          text: summary,
          at: new Date().toISOString()
        }
      });

      this.getLogger().info('event-stream-analyzer.window.complete', { observerId });
    } catch (err: any) {
      this.getLogger().error('event-stream-analyzer.window.failed', {
        observerId,
        error: err.message
      });
    }
  }

  async close(): Promise<void> {
    this.windowManager.destroy();
    await super.close('shutdown');
  }
}

export function createApp() {
  return new EventStreamAnalyzerService();
}

if (require.main === module) {
  const server = createApp();
  const cfg = server.getConfig();
  server.start(cfg.port).catch((e) => {
    console.error('FAILED_TO_START_EVENT_STREAM_ANALYZER', e);
    process.exit(1);
  });
}
```

#### 1.4 Integration Tests
**Estimated Effort**: 4 hours

**File**: `src/apps/event-stream-analyzer-service.test.ts`

```typescript
import { EventStreamAnalyzerService } from './event-stream-analyzer-service';
import { createMessagePublisher } from '../services/message-bus';

describe('EventStreamAnalyzer POC Integration', () => {
  let service: EventStreamAnalyzerService;

  beforeAll(async () => {
    service = new EventStreamAnalyzerService();
    await service.start(3000);
  });

  afterAll(async () => {
    await service.close();
  });

  it('should process sliding window and publish to egress', async () => {
    const pub = createMessagePublisher('internal.contextualization.v1');

    // Publish 10 test events over 5 seconds
    for (let i = 0; i < 10; i++) {
      await pub.publishJson({
        v: '2',
        correlationId: `test-${i}`,
        type: 'chat.message.v1',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'twitch',
          connector: 'system'
        },
        message: {
          id: `msg-${i}`,
          role: 'user',
          text: `Test message ${i}`
        },
        routing: { stage: 'contextualization', slip: [], history: [] }
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for window to close (1 minute slide)
    await new Promise(resolve => setTimeout(resolve, 65000));

    // TODO: Verify egress message published
    // (requires test consumer or spy on message bus)
  }, 90000);
});
```

#### 1.5 Performance Benchmarking
**Estimated Effort**: 4 hours

**File**: `scripts/benchmark-event-stream-analyzer.ts`

```typescript
// Benchmark script to measure:
// - Latency: Event ingress → analysis trigger
// - Memory usage: Heap size over time
// - Throughput: Events/second processed

import { EventStreamAnalyzerService } from '../src/apps/event-stream-analyzer-service';
import { performance } from 'perf_hooks';

async function benchmark() {
  const service = new EventStreamAnalyzerService();
  await service.start(3000);

  const startMem = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  // Publish 1000 events over 60 seconds
  for (let i = 0; i < 1000; i++) {
    // ... publish events
    if (i % 100 === 0) {
      const currentMem = process.memoryUsage().heapUsed;
      console.log(`Events: ${i}, Memory: ${Math.round((currentMem - startMem) / 1024 / 1024)}MB`);
    }
  }

  const endTime = performance.now();
  const endMem = process.memoryUsage().heapUsed;

  console.log('=== Benchmark Results ===');
  console.log(`Total time: ${endTime - startTime}ms`);
  console.log(`Memory increase: ${Math.round((endMem - startMem) / 1024 / 1024)}MB`);
  console.log(`Throughput: ${(1000 / ((endTime - startTime) / 1000)).toFixed(2)} events/sec`);

  await service.close();
}

benchmark().catch(console.error);
```

### Sprint 1 Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| RxJS learning curve delays development | MEDIUM | MEDIUM | Pair programming, RxJS tutorial upfront |
| Integration with existing message bus issues | MEDIUM | HIGH | Early integration test, fallback to manual pub/sub |
| Memory leaks in RxJS subscriptions | MEDIUM | HIGH | Strict cleanup in tests, memory profiling |
| LLM analysis engine incompatible with new flow | LOW | MEDIUM | Engine already stateless, minimal changes needed |

### Sprint 1 Go/No-Go Criteria

**GO if**:
- ✅ Latency < 1 second (event → analysis)
- ✅ Memory usage < 100MB
- ✅ Integration test passes
- ✅ Team comfortable with RxJS approach

**NO-GO if**:
- ❌ Latency > 5 seconds
- ❌ Memory usage > 500MB
- ❌ RxJS proves too complex
- **→ Fallback to database polling (v3 architecture)**

---

## Phase 2: Multi-Observer & Window Types (Sprints 2-3)

### Sprint 2: Observer Lifecycle Management

#### Objectives
- Dynamic observer CRUD via MCP tools
- PostgreSQL schema for `stream_observers` table
- Dynamic topic subscription management
- Support 10+ concurrent observers

#### Key Tasks

**2.1 Database Schema** (4 hours)
- Create migration: `infrastructure/postgres/migrations/018-add-stream-observers.sql`
- Tables: `stream_observers`, `summarization_runs`

**2.2 Observer Repository** (6 hours)
- File: `src/services/event-stream-analyzer/observer-repository.ts`
- CRUD operations via IDocumentStore

**2.3 MCP Tools** (8 hours)
- `event_stream_analyzer.observer.create(config)`
- `event_stream_analyzer.observer.list()`
- `event_stream_analyzer.observer.update(id, config)`
- `event_stream_analyzer.observer.delete(id)`

**2.4 Dynamic Subscription Manager** (8 hours)
- Track which topics have active subscriptions
- Add/remove NATS subscriptions on observer create/delete
- Handle subscription errors gracefully

**Estimated Effort**: 26 hours

### Sprint 3: Tumbling & Session Windows

#### Objectives
- Implement tumbling window support
- Implement session window support (debounceTime)
- Comprehensive unit tests for all window types

#### Key Tasks

**3.1 Tumbling Window Implementation** (6 hours)
- Use RxJS `buffer` + manual trigger
- Non-overlapping windows

**3.2 Session Window Implementation** (8 hours)
- Use RxJS `debounceTime` for inactivity gap
- Handle session closure edge cases

**3.3 Window Type Validation** (4 hours)
- Zod schemas for each window type
- Runtime validation

**3.4 Unit Tests** (8 hours)
- Test all three window types
- Test window transitions
- Test edge cases (empty windows, late events)

**Estimated Effort**: 26 hours

---

## Phase 3: Production Readiness (Sprints 4-5)

### Sprint 4: Snapshot & Recovery

#### Objectives
- Periodic snapshots to PostgreSQL (5-min default)
- Window restoration on service startup
- Graceful shutdown with snapshot trigger
- Max 5-min data loss on crash

#### Key Tasks

**4.1 Snapshot Manager** (10 hours)
- File: `src/services/event-stream-analyzer/snapshot-manager.ts`
- Periodic snapshot loop (configurable interval)
- Store event IDs + window metadata

**4.2 Window Restoration** (8 hours)
- Fetch snapshots on startup
- Reconstruct windows from event IDs
- Resume windows at correct state

**4.3 Graceful Shutdown** (4 hours)
- SIGTERM/SIGINT handlers
- Trigger snapshot before exit
- Cleanup RxJS subscriptions

**4.4 Crash Recovery Tests** (4 hours)
- Simulate crash mid-window
- Verify restoration accuracy
- Measure data loss window

**Estimated Effort**: 26 hours

### Sprint 5: Observability & Tuning

#### Objectives
- Prometheus metrics
- Memory pressure detection
- Load testing (100 observers, 10k events/min)
- Performance tuning

#### Key Tasks

**5.1 Prometheus Metrics** (8 hours)
- Window metrics (size, age, event count)
- Event processing metrics (received, filtered, evicted)
- Analysis metrics (triggered, latency)
- Resource metrics (memory, subscriptions)

**5.2 Memory Pressure Detection** (6 hours)
- Track total events across all windows
- Auto-evict oldest events when threshold reached
- Log eviction events

**5.3 Load Testing** (8 hours)
- Script to create 100 observers
- Script to publish 10k events/min
- Monitor metrics during load test
- Document performance characteristics

**5.4 Performance Tuning** (4 hours)
- Optimize event filtering
- Batch processing where applicable
- RxJS subscription pooling

**Estimated Effort**: 26 hours

---

## Phase 4: Advanced Features (Sprints 6-8) [OPTIONAL]

### Sprint 6: Hybrid Mode
- Stream + database backup
- Reconciliation logic
- Zero data loss guarantee

### Sprint 7: Condition-Based Triggers
- JsonLogic evaluation on windows
- Pattern detection (burst, anomaly)
- Examples and documentation

### Sprint 8: Advanced Aggregations
- Pre-LLM filtering (top N events by score)
- Custom windowing strategies
- Cost optimization

---

## Resource Requirements

### Team
- **1 Senior Backend Engineer** (full-time, all phases)
- **1 DevOps Engineer** (50%, Phases 3-4 for load testing, deployment)
- **1 QA Engineer** (25%, all phases for test planning)

### Infrastructure
- **Agent-Dev Context** for testing (already available)
- **Staging Environment** for Phase 3 validation
- **Production Deployment** after Phase 3 completion

### External Dependencies
- RxJS library (npm install)
- PostgreSQL migrations (existing infrastructure)
- NATS message bus (already deployed)

---

## Risk Management

### High-Priority Risks

1. **RxJS Memory Leaks** (Sprint 1)
   - **Mitigation**: Strict subscription cleanup, memory profiling tools
   - **Contingency**: Switch to custom window implementation

2. **Performance at Scale** (Sprint 5)
   - **Mitigation**: Early load testing, incremental scaling
   - **Contingency**: Reduce observer count, optimize filters

3. **Data Loss on Restart** (Sprint 4)
   - **Mitigation**: Frequent snapshots, graceful shutdown
   - **Contingency**: Hybrid mode for critical observers

### Medium-Priority Risks

4. **Integration with Existing Engine** (Sprint 1)
   - **Mitigation**: Minimal refactoring, preserve analysis logic
   - **Contingency**: Duplicate engine for streaming mode

5. **Dynamic Subscription Management** (Sprint 2)
   - **Mitigation**: Thorough testing, error handling
   - **Contingency**: Manual subscription configuration

---

## Success Metrics

### Phase 1 (POC)
- ✅ Latency < 1 second (p95)
- ✅ Memory usage < 100MB (single observer)
- ✅ Zero database queries during streaming

### Phase 2 (Multi-Observer)
- ✅ 10 concurrent observers
- ✅ All window types functional
- ✅ Dynamic observer CRUD

### Phase 3 (Production)
- ✅ 100 observers at 10k events/min
- ✅ Memory < 2GB, CPU < 50%
- ✅ Max 5-min data loss on crash
- ✅ Zero data loss on graceful shutdown

### Phase 4 (Advanced)
- ✅ Hybrid mode for critical observers
- ✅ Condition-based triggers functional
- ✅ Advanced aggregations reduce LLM costs by 30%

---

## Timeline

| Phase | Sprints | Duration | Target Date |
|-------|---------|----------|-------------|
| Phase 1: POC | Sprint 1 | 2 weeks | Week 2 |
| Phase 2: Multi-Observer | Sprints 2-3 | 4 weeks | Week 6 |
| Phase 3: Production | Sprints 4-5 | 4 weeks | Week 10 |
| **Phase 3 Complete** | **5 sprints** | **10 weeks** | **Week 10** |
| Phase 4: Advanced [Optional] | Sprints 6-8 | 6 weeks | Week 16 |

**Target Production Launch**: End of Week 10 (after Phase 3)

---

## Next Steps

1. **Approve Execution Plan** (stakeholder review)
2. **Assign Sprint 1 to Senior Backend Engineer**
3. **Schedule Sprint 1 Kickoff** (architecture review, RxJS tutorial)
4. **Provision Agent-Dev Context** for POC development
5. **Create Tracking Backlog** (see backlog.yaml)

---

**Document Status**: Ready for Implementation
**Approval Required**: Engineering Lead, Product Owner
