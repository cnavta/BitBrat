# Technical Architecture: Real-Time Stream Analyst Service v4
## Event Stream Observability with In-Memory Sliding Windows

**Status**: Proposed Architecture (Real-Time Event Stream Processing)
**Last Updated**: 2026-08-18
**Author**: Architectural Review
**Related Documents**: [v3 (Database Polling)](./stream-analyst-v3.md), [SESSI v2](./sessi-v2.md), [Platform Flow](../concepts/platform-flow.md)

---

## 1. Executive Summary

### 1.1 Paradigm Shift: From Polling to Streaming

The **stream-analyst-service v3** proposed a database-polling approach where observers periodically query PostgreSQL for events within time windows. While functional, this approach:

❌ Introduces latency (minimum 1-minute polling intervals)
❌ Couples analysis to persistence layer
❌ Wastes database resources (repeated queries over same data)
❌ Cannot react to patterns as they emerge
❌ Misses the core value proposition: **real-time stream analysis**

### 1.2 New Vision: Event-Native Stream Processing

**stream-analyst-service v4** proposes a fundamentally different architecture:

✅ **Subscribe directly to event topics** (NATS/Pub/Sub message bus)
✅ **In-memory sliding time windows** maintained per observer
✅ **Real-time pattern detection** as events flow through the system
✅ **Sub-second latency** from event ingress to analysis trigger
✅ **Zero database queries** for streaming analysis (snapshots for persistence)
✅ **Graceful degradation** (data loss on restart acceptable, snapshotting mitigates)

**Core Insight**: BitBrat is already an event-driven platform with high-quality event streams. Stream-analyst should **tap into these streams natively** rather than polling their database shadows.

---

## 2. Architecture Comparison

### 2.1 V3 (Database Polling) vs V4 (Event Streaming)

| Dimension | v3: Database Polling | v4: Event Streaming |
|-----------|---------------------|-------------------|
| **Data Source** | PostgreSQL `events` table | NATS topics (internal.* hierarchy) |
| **Trigger Mechanism** | Timer polling (1-min intervals) | Event arrival + time-based window closure |
| **Latency** | 1-60 seconds (depends on poll interval) | <100ms (event arrival to analysis) |
| **State Management** | Stateless (query on demand) | In-memory sliding windows per observer |
| **Scalability** | Limited by database query load | Limited by memory (window size × observer count) |
| **Data Loss on Restart** | None (events persist in database) | Window contents lost (mitigated by snapshots) |
| **Database Impact** | Heavy (repeated range queries) | Minimal (snapshots only) |
| **Real-Time Capabilities** | Limited (polling delay) | Full (immediate pattern detection) |
| **Integration** | Decoupled from event flow | Native to event flow |
| **Complexity** | Low (simple query logic) | Medium (window management, snapshots) |

### 2.2 When to Use Each Approach

**Use v3 (Database Polling) when**:
- Historical analysis (queries over hours/days)
- Zero data loss is critical (regulatory compliance)
- Low event volume (< 100 events/minute)
- Observers are low-frequency (hourly, daily summaries)

**Use v4 (Event Streaming) when**:
- Real-time pattern detection required (toxicity, anomalies)
- Sub-second latency needed
- High event volume (> 1000 events/minute)
- Observers are high-frequency (every 1-5 minutes)
- **✅ This is BitBrat's primary use case**

---

## 3. Real-Time Architecture Design

### 3.1 System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    BitBrat Event Flow (Existing)                      │
│                                                                       │
│  Ingress → Contextualization → Analysis → Reaction → Egress          │
│     ↓             ↓                ↓         ↓          ↓             │
│  Topic:     internal.         internal.  internal.  internal.        │
│         contextualization.v1  analysis.v1 reaction.v1 egress.v1      │
└───────────┬──────────┬──────────┬─────────┬──────────┬───────────────┘
            │          │          │         │          │
            ▼          ▼          ▼         ▼          ▼
   ┌────────────────────────────────────────────────────────────────┐
   │         stream-analyst-service (NEW: Event Stream Mode)        │
   │                                                                 │
   │  ┌────────────────────────────────────────────────────────┐   │
   │  │        Observer Orchestrator (Main Service Thread)     │   │
   │  │  - Manages observer lifecycle                          │   │
   │  │  - Creates/updates/deletes stream windows              │   │
   │  │  - Coordinates LLM analysis requests                   │   │
   │  └────────────────────────────────────────────────────────┘   │
   │                         │                                       │
   │                         ▼                                       │
   │  ┌────────────────────────────────────────────────────────┐   │
   │  │       WindowManager (In-Memory State)                  │   │
   │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
   │  │  │  Observer 1  │  │  Observer 2  │  │  Observer N  │ │   │
   │  │  │  Window:     │  │  Window:     │  │  Window:     │ │   │
   │  │  │  [E1,E2,E3]  │  │  [E8,E9]     │  │  [E42,...]   │ │   │
   │  │  │  5-min slide │  │  10-min tumble│  │  1-min slide │ │   │
   │  │  └──────────────┘  └──────────────┘  └──────────────┘ │   │
   │  └────────────────────────────────────────────────────────┘   │
   │           │                    │                    │          │
   │           ▼                    ▼                    ▼          │
   │  ┌────────────────┐   ┌────────────────┐   ┌───────────────┐ │
   │  │ Event Stream   │   │ Time-based     │   │ Snapshot      │ │
   │  │ Subscribers    │   │ Triggers       │   │ Manager       │ │
   │  │ (Topic subs)   │   │ (Interval)     │   │ (Persistence) │ │
   │  └────────────────┘   └────────────────┘   └───────────────┘ │
   │           │                    │                    │          │
   └───────────┼────────────────────┼────────────────────┼──────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
│  Message Bus    │   │  Analysis       │   │  PostgreSQL         │
│  (NATS/Pub/Sub) │   │  Engine (LLM)   │   │  (Snapshots Only)   │
│                 │   │                 │   │                     │
│ • Subscribes to │   │ • StreamBuffer  │   │ • window_snapshots  │
│   configured    │   │ • Prompt        │   │ • stream_observers  │
│   topics        │   │   Assembly      │   │                     │
│ • Filters by    │   │ • Annotation    │   │ (No event queries)  │
│   observer rules│   │   Generation    │   │                     │
└─────────────────┘   └─────────────────┘   └─────────────────────┘
```

### 3.2 Key Components

#### 3.2.1 WindowManager (NEW)

**Purpose**: Maintain in-memory sliding windows for all active observers

**Data Structure**:
```typescript
interface StreamWindow {
  observerId: string;
  windowType: 'sliding' | 'tumbling' | 'session';
  windowSizeMs: number;
  slideIntervalMs?: number;    // For sliding windows
  sessionGapMs?: number;        // For session windows
  events: InternalEventV2[];
  firstEventAt: Date | null;
  lastEventAt: Date | null;
  watermark: Date;              // For late event handling
  triggerScheduled: NodeJS.Timeout | null;
}

class WindowManager {
  private windows: Map<string, StreamWindow> = new Map();

  // Add event to matching windows
  addEvent(event: InternalEventV2): void {
    for (const [observerId, window] of this.windows) {
      if (this.matchesObserver(event, observerId)) {
        this.addToWindow(window, event);
        this.scheduleWindowTrigger(window);
      }
    }
  }

  // Time-based window closure
  private scheduleWindowTrigger(window: StreamWindow): void {
    if (window.triggerScheduled) return;

    const now = Date.now();
    const windowEnd = window.firstEventAt
      ? window.firstEventAt.getTime() + window.windowSizeMs
      : now + window.windowSizeMs;

    const delay = windowEnd - now;

    window.triggerScheduled = setTimeout(() => {
      this.triggerAnalysis(window);
      window.triggerScheduled = null;
    }, delay);
  }

  // Evict old events (sliding window)
  private evictOldEvents(window: StreamWindow): void {
    const cutoff = new Date(Date.now() - window.windowSizeMs);
    window.events = window.events.filter(e =>
      new Date(e.ingress.ingressAt) > cutoff
    );
  }
}
```

**Window Types Supported**:

1. **Sliding Windows** (most common)
   - Window advances by `slideInterval` (e.g., every 1 minute)
   - Window size is `windowSize` (e.g., 5 minutes)
   - Events appear in multiple overlapping windows
   - **Use case**: Continuous monitoring (chat activity every 5 min, sliding 1 min)

2. **Tumbling Windows** (non-overlapping)
   - Fixed-size, non-overlapping windows
   - Each event appears in exactly one window
   - **Use case**: Hourly summaries, daily reports

3. **Session Windows** (activity-based)
   - Dynamic size based on inactivity gaps
   - Window closes after `sessionGap` milliseconds of no events
   - **Use case**: User conversation threads, burst detection

#### 3.2.2 Event Stream Subscribers (NEW)

**Purpose**: Subscribe to configured message bus topics and route events to windows

```typescript
class EventStreamSubscriber extends Bit {
  private windowManager: WindowManager;

  async setupSubscriptions(): Promise<void> {
    const observers = await this.loadActiveObservers();

    // Get unique set of topics to subscribe to
    const topics = new Set(observers.flatMap(o => o.source.topics));

    for (const topic of topics) {
      await this.onMessage<InternalEventV2>(
        { destination: topic, queue: `stream-analyst-${topic}` },
        async (event, attrs, ctx) => {
          // Route to all matching windows
          this.windowManager.addEvent(event);
          await ctx.ack();
        }
      );
    }
  }
}
```

**Key Properties**:
- Separate queue per topic (prevent head-of-line blocking)
- At-least-once delivery semantics (idempotent window additions)
- Topic filtering via observer configuration
- Additional event-level filtering (e.g., platform, channel)

#### 3.2.3 Snapshot Manager (NEW)

**Purpose**: Persist window state for recovery after restarts

**Strategy**: Periodic snapshots + write-ahead log

```typescript
class SnapshotManager {
  // Periodic snapshot (every 5 minutes)
  async snapshotWindows(): Promise<void> {
    const windows = this.windowManager.getAllWindows();

    for (const window of windows) {
      await db.set('window_snapshots', window.observerId, {
        observerId: window.observerId,
        snapshotAt: new Date(),
        events: window.events.map(e => e.correlationId), // Store only IDs
        windowState: {
          firstEventAt: window.firstEventAt,
          lastEventAt: window.lastEventAt,
          watermark: window.watermark
        }
      });
    }
  }

  // Restore from snapshot on startup
  async restoreWindows(): Promise<void> {
    const snapshots = await db.query('window_snapshots', {
      filters: [{ field: 'snapshotAt', operator: '>', value: fifteenMinutesAgo }]
    });

    for (const snapshot of snapshots) {
      // Reconstruct window from snapshot
      const events = await this.fetchEventsByIds(snapshot.events);
      this.windowManager.createWindow(snapshot.observerId, events, snapshot.windowState);
    }
  }
}
```

**Snapshot Frequency Trade-offs**:
- **Every 1 min**: Max 1 min data loss, high database write load
- **Every 5 min**: Max 5 min data loss, moderate load ✅ **Recommended**
- **Every 15 min**: Max 15 min data loss, low load

**Data Loss Mitigation**:
- Accept data loss on restart (streaming semantics)
- Use snapshots to minimize loss window (5 min)
- Trigger manual snapshot before shutdown (graceful restart)
- **For critical observers**: Use hybrid mode (stream + database backup)

---

### 3.3 Observer Configuration Schema (Updated)

```typescript
interface StreamObserver {
  id: string;
  active: boolean;
  mcpEnabled: boolean;

  // Source configuration (NEW: Topic-based)
  source: {
    mode: 'stream' | 'database' | 'hybrid';  // NEW: Mode selector

    // Stream mode (NEW)
    topics?: string[];                        // e.g., ["internal.contextualization.v1"]
    filters?: {
      platforms?: string[];                   // e.g., ["twitch", "discord"]
      eventTypes?: string[];                  // e.g., ["chat.message.v1"]
      channels?: string[];                    // e.g., ["#bitbrat"]
      customLogic?: JsonLogic;                // Advanced filtering
    };

    // Database mode (fallback to v3 behavior)
    collection?: 'events' | 'prompt_logs';
    dbFilters?: Record<string, any>;
  };

  // Window configuration (NEW)
  window: {
    type: 'sliding' | 'tumbling' | 'session';
    sizeMs: number;                           // e.g., 300000 (5 minutes)
    slideMs?: number;                         // For sliding windows (e.g., 60000 = 1 min)
    sessionGapMs?: number;                    // For session windows
    maxEvents?: number;                       // Evict oldest if exceeded (memory safety)
    lateEventToleranceMs?: number;            // Accept events up to N ms late
  };

  // Trigger configuration (NEW)
  trigger: {
    type: 'time' | 'count' | 'condition';

    // Time-based: Analyze when window closes
    timeConfig?: {
      windowCloseStrategy: 'on-time' | 'on-event-after-time';
    };

    // Count-based: Analyze after N events
    countConfig?: {
      threshold: number;                      // e.g., 100 events
    };

    // Condition-based: Analyze when pattern detected
    conditionConfig?: {
      logic: JsonLogic;                       // e.g., {">=": [{"var": "events.length"}, 50]}
    };
  };

  // Analysis configuration (same as v3)
  analysis: {
    promptId: string;
    inspectionEnabled: boolean;
    outputFormat: 'markdown' | 'json';
    throttleMs?: number;                      // Min time between analyses
  };

  // Delivery configuration (same as v3)
  delivery: {
    egressTopic: string;
    destination: {
      type: 'chat' | 'dm' | 'email' | 'webhook';
      target: string;
    };
  };

  // Metadata
  createdAt: string;
  updatedAt: string;
}
```

**Example: Real-Time Toxicity Detection**

```yaml
id: "twitch-toxicity-realtime"
active: true
mcpEnabled: false

source:
  mode: "stream"
  topics:
    - "internal.contextualization.v1"  # Get enriched events with auth
  filters:
    platforms: ["twitch"]
    eventTypes: ["chat.message.v1"]
    channels: ["#bitbrat"]

window:
  type: "sliding"
  sizeMs: 300000        # 5-minute window
  slideMs: 60000        # Slide every 1 minute
  maxEvents: 500        # Memory safety (evict if exceeded)

trigger:
  type: "time"
  timeConfig:
    windowCloseStrategy: "on-time"  # Analyze every 1 min

analysis:
  promptId: "toxicity-detection-v1"
  inspectionEnabled: true           # Get annotations
  throttleMs: 60000                 # Max once per minute

delivery:
  egressTopic: "internal.egress.v1"
  destination:
    type: "chat"
    target: "#moderation"
```

---

## 4. Library Evaluation

### 4.1 Candidate Libraries for Stream Processing

| Library | Stars | Maturity | TypeScript | Use Case | Verdict |
|---------|-------|----------|------------|----------|---------|
| **RxJS** | 30k+ | Mature | ✅ First-class | Reactive streams, time-based operators | ✅ **Recommended** |
| **Scramjet** | 2k+ | Stable | ✅ Good | Kafka Streams-like for Node.js | ⚠️ Consider |
| **Highland.js** | 3k+ | Stable | ⚠️ OK | Functional streams | ❌ Limited time operators |
| **Node.js Streams** | Built-in | Mature | ✅ Built-in | Low-level stream abstraction | ❌ No time windows |
| **Custom** | N/A | New | ✅ Full control | Tailored to BitBrat | ⚠️ Maintenance burden |

### 4.2 RxJS Evaluation (Recommended)

**Strengths**:
- ✅ **Battle-tested**: Used in Angular, React, production systems worldwide
- ✅ **Rich time operators**: `bufferTime`, `windowTime`, `debounceTime`, `throttleTime`
- ✅ **Excellent TypeScript support**: First-class types
- ✅ **Small footprint**: Tree-shakeable, ~20KB min+gzip
- ✅ **Well-documented**: Extensive docs, tutorials, community

**Relevant Operators**:

```typescript
import { fromEvent } from 'rxjs';
import { bufferTime, filter, map } from 'rxjs/operators';

// Example: 5-minute sliding window, sliding every 1 minute
const eventStream$ = fromEvent<InternalEventV2>(eventEmitter, 'event');

const toxicityObserver$ = eventStream$.pipe(
  filter(e => e.source.platform === 'twitch'),
  filter(e => e.eventType === 'chat.message.v1'),
  bufferTime(
    5 * 60 * 1000,  // 5-minute window
    1 * 60 * 1000   // 1-minute slide
  ),
  filter(events => events.length > 0),
  map(events => this.analyzeWindow(events))
);

toxicityObserver$.subscribe(summary => {
  this.publishToEgress(summary);
});
```

**Key Operators for Stream Analyst**:

| Operator | Use Case | Example |
|----------|----------|---------|
| `bufferTime(windowMs, slideMs)` | Sliding time windows | 5-min window, 1-min slide |
| `windowTime(windowMs)` | Observable of observables (nested windows) | Complex window logic |
| `throttleTime(ms)` | Rate limiting | Max 1 analysis per minute |
| `debounceTime(ms)` | Session windows | Close window after 30s inactivity |
| `filter(predicate)` | Event filtering | Platform, channel, event type |
| `scan(accumulator)` | Stateful aggregation | Running counts, averages |

**Challenges**:
- ⚠️ **Learning curve**: Reactive programming paradigm unfamiliar to some
- ⚠️ **Memory management**: Need to unsubscribe to prevent leaks
- ⚠️ **Backpressure**: May need custom handling for high-throughput scenarios

**Mitigation**:
- Document RxJS patterns clearly
- Use `takeUntil` for automatic cleanup
- Monitor subscription counts and memory usage

### 4.3 Custom Implementation (Alternative)

**When to Build Custom**:
- RxJS overhead too high (unlikely given tree-shaking)
- Need BitBrat-specific optimizations (e.g., routing slip-aware windows)
- Team strongly prefers avoiding RxJS

**Implementation Sketch**:

```typescript
class SlidingWindow<T> {
  private events: T[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private windowSizeMs: number,
    private slideMs: number,
    private onTrigger: (events: T[]) => void,
    private getTimestamp: (event: T) => Date
  ) {
    this.scheduleNextTrigger();
  }

  add(event: T): void {
    this.events.push(event);
    this.evictOldEvents();
  }

  private evictOldEvents(): void {
    const cutoff = Date.now() - this.windowSizeMs;
    this.events = this.events.filter(e =>
      this.getTimestamp(e).getTime() > cutoff
    );
  }

  private scheduleNextTrigger(): void {
    const timer = setTimeout(() => {
      this.onTrigger([...this.events]);  // Copy to prevent mutation
      this.scheduleNextTrigger();
    }, this.slideMs);

    this.timers.set('main', timer);
  }

  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
  }
}
```

**Verdict**: Start with RxJS (proven, feature-rich). Consider custom only if RxJS proves problematic.

---

## 5. Implementation Roadmap

### Phase 1: Proof of Concept (1 sprint)
**Goal**: Validate real-time streaming approach with single observer

#### Sprint 1: RxJS Integration & Basic Streaming
- [ ] Install RxJS (`npm install rxjs`)
- [ ] Create `StreamWindowManager` using RxJS `bufferTime`
- [ ] Subscribe to single topic (`internal.contextualization.v1`)
- [ ] Implement single sliding window observer (5-min window, 1-min slide)
- [ ] Connect to existing `StreamAnalystEngine` for LLM analysis
- [ ] Publish results to egress
- [ ] Integration test: Real-time chat activity summary

**Acceptance Criteria**:
- Events from NATS trigger analysis within 1 minute
- Window correctly buffers 5 minutes of events
- Analysis results delivered via egress
- No database queries during streaming

**Deliverables**:
- Working POC service
- Performance metrics (latency, memory usage)
- Go/no-go decision on real-time approach

---

### Phase 2: Multi-Observer & Window Types (2 sprints)

#### Sprint 2: Observer Lifecycle Management
- [ ] Create observer CRUD MCP tools
- [ ] Implement dynamic subscription management (add/remove topics on observer create/delete)
- [ ] Support multiple concurrent observers
- [ ] Add observer-level filtering (platform, channel, event type)
- [ ] PostgreSQL migrations for `stream_observers` table

**Acceptance Criteria**:
- Can create observer via MCP tool
- Service dynamically subscribes to new topics
- Multiple observers run independently
- Filters correctly route events to matching windows

#### Sprint 3: Tumbling & Session Windows
- [ ] Implement tumbling window support (RxJS `bufferCount` or custom)
- [ ] Implement session window support (RxJS `debounceTime` + custom logic)
- [ ] Add window type validation
- [ ] Unit tests for all window types
- [ ] Documentation: Window type selection guide

**Acceptance Criteria**:
- Tumbling windows produce non-overlapping results
- Session windows close after inactivity gap
- All window types pass integration tests

---

### Phase 3: Production Readiness (2 sprints)

#### Sprint 4: Snapshot & Recovery
- [ ] Implement `SnapshotManager` (periodic snapshots to PostgreSQL)
- [ ] Add write-ahead log for critical events (optional)
- [ ] Implement window restoration on startup
- [ ] Graceful shutdown (trigger snapshots before exit)
- [ ] Test data loss scenarios (crash, restart, network partition)

**Acceptance Criteria**:
- Max 5-minute data loss on unplanned restart
- Zero data loss on graceful restart
- Snapshots complete within 10 seconds
- Restored windows resume correctly

#### Sprint 5: Observability & Tuning
- [ ] Add metrics (window sizes, event rates, analysis latency, memory usage)
- [ ] Implement memory pressure detection (auto-eviction)
- [ ] Add backpressure handling (drop events if overwhelmed)
- [ ] Performance tuning (subscription pooling, batch processing)
- [ ] Load testing (100 observers, 10k events/min)

**Acceptance Criteria**:
- Service handles 100 observers at 10k events/min
- Memory usage < 2GB
- CPU usage < 50% at steady state
- Prometheus metrics exported

---

### Phase 4: Hybrid Mode & Advanced Features (2-3 sprints)

#### Sprint 6: Hybrid Mode (Stream + Database)
- [ ] Support `mode: 'hybrid'` in observer config
- [ ] Stream-based windows for real-time
- [ ] Database backups for recovery
- [ ] Reconciliation logic (detect drift between stream and database)

**Use case**: Critical observers that need zero data loss

#### Sprint 7: Condition-Based Triggers
- [ ] Implement `trigger.type: 'condition'` (JsonLogic evaluation)
- [ ] Add pattern detection (e.g., "analyze if >50 events or avg sentiment < 0.3")
- [ ] Examples: Burst detection, anomaly thresholds

#### Sprint 8: Advanced Aggregations
- [ ] Support pre-LLM aggregations (counts, averages, percentiles)
- [ ] Reduce LLM input size (e.g., "100 messages → top 10 by toxicity score")
- [ ] Custom windowing strategies (e.g., "first 5 and last 5 events")

---

## 6. Technical Decisions

### 6.1 Library Choice: RxJS vs Custom

**Decision**: Use RxJS for Phase 1-3, evaluate custom for Phase 4+

**Rationale**:
- ✅ RxJS provides all needed operators out-of-box
- ✅ Mature, well-tested, widely adopted
- ✅ TypeScript-first design
- ⚠️ Custom may be needed for BitBrat-specific optimizations later

**Re-evaluation Criteria**: If RxJS proves problematic (memory leaks, performance), revisit in Sprint 5.

### 6.2 Snapshot Frequency: 1 min vs 5 min vs 15 min

**Decision**: 5-minute snapshots (default)

**Rationale**:
- ✅ Acceptable data loss window for most use cases
- ✅ Low database write load (~10 observers × 12/hour = 120 writes/hour)
- ✅ Fast snapshot generation (<10 seconds)
- ⚠️ Critical observers can use 1-min or hybrid mode

**Configuration**: Make snapshot frequency configurable per observer

### 6.3 Event Storage in Snapshots: Full Events vs Event IDs

**Decision**: Store event IDs only in snapshots, reconstruct from database on restore

**Rationale**:
- ✅ Smaller snapshot size (100 IDs vs 100 full events)
- ✅ Faster snapshot writes
- ⚠️ Requires database query on restore (acceptable since restarts are rare)
- ⚠️ Relies on event persistence (acceptable, already required for audit)

**Alternative**: Store full events for faster restore (trade-off: larger snapshots)

### 6.4 Window Closure Strategy: On-Time vs On-Event-After-Time

**Decision**: Support both, default to `on-time`

**On-Time** (default):
- Window closes at exact time boundary (e.g., 5 min after first event)
- Scheduled via `setTimeout`
- ✅ Predictable, deterministic

**On-Event-After-Time**:
- Window closes when first event arrives AFTER time boundary
- ✅ Ensures window never analyzed empty
- ⚠️ Unpredictable timing (depends on event arrival)

**Use case mapping**:
- `on-time`: Regular summaries (every 5 min)
- `on-event-after-time`: Burst detection (close window on first event after burst ends)

### 6.5 Backpressure Handling: Drop vs Queue vs Reject

**Decision**: Drop old events when memory pressure detected

**Rationale**:
- ✅ Prevent OOM crashes
- ✅ Maintains real-time responsiveness
- ⚠️ Data loss (acceptable for streaming semantics)

**Implementation**:
```typescript
class WindowManager {
  private maxTotalEvents = 10000;  // Global limit across all windows

  addEvent(event: InternalEventV2): void {
    const totalEvents = this.countTotalEvents();

    if (totalEvents >= this.maxTotalEvents) {
      // Evict oldest event from largest window
      this.evictOldestEvent();
      this.logger.warn('stream.backpressure.evicted', { totalEvents });
    }

    // Proceed with adding event
  }
}
```

---

## 7. Integration with Existing BitBrat Architecture

### 7.1 Topic Selection Strategy

**Which topics should stream-analyst subscribe to?**

| Topic | Stage | Use Case | Recommended? |
|-------|-------|----------|--------------|
| `internal.ingress.v1` | Attention | Raw events (no context) | ❌ Too early, no user identity |
| `internal.contextualization.v1` | Contextualization | Enriched with auth, env | ✅ **Primary choice** |
| `internal.analysis.v1` | Analysis | Enriched with LLM analysis | ⚠️ Optional (post-analysis summaries) |
| `internal.reaction.v1` | Reaction | Enriched with tool results | ⚠️ Optional (reaction summaries) |
| `internal.egress.v1` | Egress | Final responses | ❌ Too late |

**Recommendation**: Default to `internal.contextualization.v1`

**Rationale**:
- ✅ Events have user identity (from `auth` service)
- ✅ Events have pre-analysis context (from `query-analyzer`)
- ✅ Early enough to detect patterns before LLM processing
- ✅ Matches ENRICH → NEXT pattern (stream-analyst enriches, calls `next()`)

**Advanced**: Allow observers to specify multiple topics (e.g., combine `contextualization` + `analysis` for comparing pre/post LLM)

### 7.2 Stream-Analyst as an "Analysis Stage" Bit

**Question**: Should stream-analyst follow the ENRICH → NEXT pattern?

**Option A**: Yes (Participates in Event Flow)
```typescript
await this.onMessage<InternalEventV2>(
  'internal.contextualization.v1',
  async (event, attrs, ctx) => {
    // Add to window for analysis
    this.windowManager.addEvent(event);

    // Enrich with "seen by stream-analyst" annotation
    event.annotations.push({
      kind: 'stream-analyst-seen',
      value: { observerIds: matchingObservers },
      source: this.name
    });

    // Advance routing slip
    await this.next(event);
    await ctx.ack();
  }
);
```

**Option B**: No (Passive Observer)
```typescript
await this.onMessage<InternalEventV2>(
  {
    destination: 'internal.contextualization.v1',
    queue: 'stream-analyst-observer'  // Separate queue, doesn't block flow
  },
  async (event, attrs, ctx) => {
    // Add to window for analysis
    this.windowManager.addEvent(event);

    // DON'T call next() — just observe
    await ctx.ack();
  }
);
```

**Decision**: **Option B (Passive Observer)** ✅

**Rationale**:
- ✅ Stream-analyst is **observational, not transformational**
- ✅ Analysis happens **asynchronously** (when window closes), not inline
- ✅ Doesn't block event flow progression
- ✅ Separate queue prevents head-of-line blocking
- ❌ Option A would delay event processing waiting for window additions

**Exception**: If observer wants to **enrich** events inline (e.g., add toxicity scores immediately), use Option A.

### 7.3 Publishing Analysis Results

**Where should stream-analyst publish summaries?**

**Option A**: Direct to `internal.egress.v1` (Current approach)
```typescript
await this.publishToEgress(summary, observer.delivery);
```

**Option B**: Publish to `internal.summarization.report.v1`, let other services consume
```typescript
await this.publish('internal.summarization.report.v1', {
  observerId,
  summary,
  annotations,
  windowMetadata
});
```

**Decision**: **Both** ✅

- **Always** publish to `internal.summarization.report.v1` (audit trail, downstream consumers)
- **If configured**, also publish to `internal.egress.v1` (user delivery)

**Rationale**:
- ✅ Decouples analysis from delivery
- ✅ Allows other services to react to summaries (e.g., alert-service)
- ✅ Maintains audit trail

---

## 8. Configuration Schema

### 8.1 Environment Variables

```bash
# Stream processing
STREAM_ANALYST_MODE=stream                # 'stream', 'database', or 'hybrid'
STREAM_ANALYST_MAX_OBSERVERS=100
STREAM_ANALYST_MAX_TOTAL_EVENTS=10000     # Memory limit
STREAM_ANALYST_SNAPSHOT_INTERVAL_MS=300000 # 5 minutes

# Window defaults
STREAM_ANALYST_DEFAULT_WINDOW_SIZE_MS=300000   # 5 minutes
STREAM_ANALYST_DEFAULT_SLIDE_MS=60000          # 1 minute

# Backpressure
STREAM_ANALYST_BACKPRESSURE_STRATEGY=drop      # 'drop', 'queue', 'reject'
STREAM_ANALYST_MEMORY_PRESSURE_THRESHOLD=0.8   # 80% of maxTotalEvents

# LLM configuration (same as v3)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...

# Feature flags
STREAM_ANALYST_ENABLE_SNAPSHOTS=true
STREAM_ANALYST_ENABLE_HYBRID_MODE=true
STREAM_ANALYST_ENABLE_SESSION_WINDOWS=true
```

### 8.2 Observer Configuration Example

**Toxicity Detection (Sliding Window)**:
```yaml
id: "twitch-toxicity-sliding"
active: true

source:
  mode: "stream"
  topics: ["internal.contextualization.v1"]
  filters:
    platforms: ["twitch"]
    eventTypes: ["chat.message.v1"]

window:
  type: "sliding"
  sizeMs: 300000        # 5 minutes
  slideMs: 60000        # 1 minute
  maxEvents: 500

trigger:
  type: "time"

analysis:
  promptId: "toxicity-detection-v1"
  inspectionEnabled: true
  throttleMs: 60000

delivery:
  egressTopic: "internal.egress.v1"
  destination:
    type: "chat"
    target: "#moderation"
```

**User Session Summary (Session Window)**:
```yaml
id: "user-session-summary"
active: true

source:
  mode: "stream"
  topics: ["internal.contextualization.v1"]
  filters:
    platforms: ["discord"]
    customLogic:
      "===": [{"var": "identity.user.id"}, "user-12345"]

window:
  type: "session"
  sessionGapMs: 300000  # Close after 5 min inactivity
  maxEvents: 1000

trigger:
  type: "time"
  timeConfig:
    windowCloseStrategy: "on-event-after-time"

analysis:
  promptId: "session-summary-v1"
  inspectionEnabled: false

delivery:
  egressTopic: "internal.egress.v1"
  destination:
    type: "dm"
    target: "user-12345"
```

---

## 9. Metrics & Observability

### 9.1 Service Metrics

```
# Window metrics
stream_analyst_windows_active{observer_id}
stream_analyst_window_events_total{observer_id}
stream_analyst_window_size_bytes{observer_id}
stream_analyst_window_age_seconds{observer_id}

# Event processing
stream_analyst_events_received_total{topic, observer_id}
stream_analyst_events_filtered_total{observer_id, reason}
stream_analyst_events_evicted_total{observer_id, reason}

# Analysis triggers
stream_analyst_analyses_triggered_total{observer_id, trigger_type}
stream_analyst_analysis_latency_seconds{observer_id}

# Snapshots
stream_analyst_snapshots_total{observer_id, status}
stream_analyst_snapshot_latency_seconds
stream_analyst_snapshot_size_bytes{observer_id}

# Resource usage
stream_analyst_memory_usage_bytes
stream_analyst_backpressure_events_total{strategy}
```

### 9.2 RxJS-Specific Metrics

```
stream_analyst_rxjs_subscriptions_active{observer_id}
stream_analyst_rxjs_subscription_errors_total{observer_id}
stream_analyst_rxjs_buffer_overflow_total{observer_id}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Window Management**:
```typescript
describe('SlidingWindow (RxJS)', () => {
  it('should buffer events for 5 minutes', () => {
    // Test bufferTime(5min, 1min)
  });

  it('should emit every 1 minute', () => {
    // Test slide interval
  });

  it('should evict events older than 5 minutes', () => {
    // Test time-based eviction
  });
});
```

**Event Filtering**:
```typescript
describe('EventFilter', () => {
  it('should filter by platform', () => {
    // Test platform filter
  });

  it('should filter by custom JsonLogic', () => {
    // Test complex filter
  });
});
```

### 10.2 Integration Tests

**End-to-End Streaming**:
```typescript
describe('StreamAnalyst E2E', () => {
  it('should analyze sliding window and deliver via egress', async () => {
    // 1. Create observer
    const observer = await createObserver({
      source: { mode: 'stream', topics: ['test.events'] },
      window: { type: 'sliding', sizeMs: 5000, slideMs: 1000 }
    });

    // 2. Publish test events
    for (let i = 0; i < 10; i++) {
      await publishToNats('test.events', { id: i, text: `Message ${i}` });
      await sleep(500);
    }

    // 3. Wait for window to close
    await sleep(6000);

    // 4. Verify egress delivery
    const egressMessages = await consumeFromNats('internal.egress.v1');
    expect(egressMessages).toHaveLength(1);
    expect(egressMessages[0].message.text).toContain('summary');
  });
});
```

**Snapshot Recovery**:
```typescript
describe('SnapshotManager', () => {
  it('should restore windows from snapshot', async () => {
    // 1. Create windows, add events
    // 2. Trigger snapshot
    // 3. Restart service
    // 4. Verify windows restored
  });
});
```

### 10.3 Load Tests

```typescript
describe('StreamAnalyst Load Test', () => {
  it('should handle 100 observers at 10k events/min', async () => {
    // Create 100 observers
    // Publish 10k events/min (167 events/sec)
    // Monitor memory, CPU, latency
    // Assert: latency < 1s p95, memory < 2GB
  });
});
```

---

## 11. Migration from Database Polling (v3 to v4)

### 11.1 Migration Path

**Phase 1**: Deploy v4 alongside v3 (parallel operation)
- v3 continues database polling (existing observers)
- v4 handles new stream-based observers
- No data loss, gradual migration

**Phase 2**: Migrate low-frequency observers to v4
- Hourly, daily summaries
- Low risk (long windows, infrequent)

**Phase 3**: Migrate high-frequency observers to v4
- 1-min, 5-min windows
- Monitor carefully for data loss

**Phase 4**: Deprecate v3 (database polling mode)
- Retain hybrid mode for critical observers
- Remove v3 code after 3 months

### 11.2 Rollback Plan

If v4 proves problematic:

1. **Immediate**: Disable stream mode via feature flag
   ```bash
   STREAM_ANALYST_MODE=database  # Revert to v3 behavior
   ```

2. **Short-term**: Re-enable database polling for affected observers
   ```yaml
   # Update observer config
   source:
     mode: "database"
     collection: "events"
   ```

3. **Long-term**: Fix v4 issues, re-migrate incrementally

---

## 12. Success Criteria

### 12.1 Phase 1 (POC)
- [ ] Single observer processes events from NATS in real-time
- [ ] Latency from event ingress to analysis < 1 second
- [ ] Memory usage < 100MB for single observer
- [ ] Analysis accuracy matches v3 (database polling)

### 12.2 Phase 2 (Multi-Observer)
- [ ] 10 concurrent observers running independently
- [ ] Dynamic observer creation/deletion works
- [ ] All window types (sliding, tumbling, session) functional
- [ ] Zero cross-observer interference

### 12.3 Phase 3 (Production)
- [ ] 100 observers at 10k events/min (167 events/sec)
- [ ] Memory usage < 2GB
- [ ] CPU usage < 50% steady state
- [ ] Max 5-minute data loss on restart
- [ ] Zero data loss on graceful shutdown

---

## 13. Open Questions

1. **RxJS vs Custom**: Commit to RxJS long-term, or treat as temporary?
   - **Recommendation**: RxJS for Phase 1-3, re-evaluate in Phase 4

2. **Snapshot Format**: JSON vs MessagePack vs binary?
   - **Recommendation**: JSON (human-readable, debuggable)

3. **Multi-Service Deployment**: Single stream-analyst instance or multiple?
   - **Recommendation**: Single instance (simpler), scale horizontally if needed

4. **Late Event Handling**: Accept late events or strict time boundaries?
   - **Recommendation**: Configurable watermark tolerance (default 30s)

5. **Cross-Observer Aggregation**: Should observers be able to correlate across windows?
   - **Recommendation**: Phase 4 feature (observer chaining)

---

## 14. References

- [v3 Architecture (Database Polling)](./stream-analyst-v3.md)
- [SESSI v2](./sessi-v2.md)
- [Platform Flow](../concepts/platform-flow.md)
- [Agent Flow Stages](../concepts/agent-flow-stages.md)
- [RxJS Documentation](https://rxjs.dev/)
- [RxJS bufferTime Operator](https://rxjs.dev/api/operators/bufferTime)
- [RxJS windowTime Operator](https://rxjs.dev/api/operators/windowTime)
- [Scramjet Framework](https://docs.scramjet.org/framework/)
- [Kafka Streams Concepts](https://kafka.apache.org/documentation/streams/)

---

## 15. Appendix: Code Locations

| Component | File Path | Status |
|-----------|-----------|--------|
| Current Service | `src/apps/stream-analyst-service.ts` | ⚠️ Needs refactor |
| Current Engine | `src/services/stream-analyst/engine.ts` | ✅ Reuse (analysis logic) |
| Current Buffer | `src/services/stream-analyst/stream-buffer.ts` | ✅ Reuse |
| **NEW** WindowManager | `src/services/stream-analyst/window-manager.ts` | ❌ To create |
| **NEW** SnapshotManager | `src/services/stream-analyst/snapshot-manager.ts` | ❌ To create |
| **NEW** RxJS Integration | `src/services/stream-analyst/rxjs-windows.ts` | ❌ To create |
| Type Definitions | `src/types/sessi.ts` | ⚠️ Needs update |

---

**Status**: This is a proposed architecture requiring stakeholder review and prioritization.

**Decision Required**: Approve Phase 1 POC (RxJS + basic streaming) for next sprint?

**Next Steps**:
1. Review with platform team
2. Approve/reject real-time streaming approach
3. If approved: Assign Phase 1 implementation
4. If rejected: Proceed with v3 (database polling)
