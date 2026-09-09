# Event Stream Observers

**Real-time event stream analysis with configurable windowing and LLM-powered summarization.**

## What Are Stream Observers?

Stream observers are configurable event processors that collect events from the BitBrat message bus, group them into time windows, and generate LLM-powered summaries. They enable real-time monitoring and analysis of event streams across multiple platforms (Twitch, Discord, Slack, etc.).

**Core Capabilities:**
- **Windowing**: Sliding, tumbling, or session-based event grouping
- **Filtering**: Platform, event type, and channel filters
- **Analysis**: GPT-4 powered summarization with custom prompts
- **Persistence**: PostgreSQL-backed observer configuration and crash recovery
- **Observability**: Prometheus metrics and structured logging

**Architecture:**
```
NATS Topics → [Event Filter] → [Window Manager] → [LLM Analysis] → Egress Topic
                                      ↓
                              [Snapshot Manager]
                                (crash recovery)
```

---

## Use Cases

### 1. Chat Activity Summarization

**Scenario**: Summarize Twitch chat every 5 minutes to help moderators track conversation trends.

**Observer Configuration:**
```typescript
{
  id: 'twitch-chat-summary-5min',
  active: true,
  source: {
    mode: 'stream',
    topics: ['internal.contextualization.v1'],
    filters: {
      platforms: ['twitch'],
      eventTypes: ['chat.message']
    }
  },
  window: {
    type: 'sliding',      // Overlapping windows
    sizeMs: 300000,       // 5 minutes
    slideMs: 60000        // Slide every 1 minute (4-min overlap)
  },
  trigger: {
    type: 'time'          // Window closes after duration
  },
  analysis: {
    promptId: 'standard-chat-summary-v1',
    inspectionEnabled: false,
    outputFormat: 'markdown'
  },
  delivery: {
    egressTopic: 'internal.egress.v1',
    destination: {
      target: 'bitbrat-channel'
    }
  }
}
```

**MCP Tool Usage:**
```bash
event_stream_analyzer.observer.create({
  id: "twitch-chat-summary-5min",
  windowType: "sliding",
  windowSizeMs: 300000,
  slideMs: 60000,
  platforms: ["twitch"],
  eventTypes: ["chat.message"],
  promptId: "standard-chat-summary-v1",
  egressTopic: "internal.egress.v1"
})
```

**Result**: Every minute, receive a 5-minute rolling summary of Twitch chat activity, posted to the bitbrat-channel.

---

### 2. Multi-Platform Moderation Alert

**Scenario**: Monitor moderation events across Twitch, Discord, and Slack. Generate hourly reports of warnings, bans, and timeouts.

**Observer Configuration:**
```typescript
{
  id: 'multi-platform-moderation-hourly',
  active: true,
  source: {
    mode: 'stream',
    topics: ['internal.contextualization.v1'],
    filters: {
      platforms: ['twitch', 'discord', 'slack'],
      eventTypes: [
        'moderation.timeout',
        'moderation.ban',
        'moderation.warning',
        'moderation.kick'
      ]
    }
  },
  window: {
    type: 'tumbling',     // Non-overlapping windows
    sizeMs: 3600000       // 1 hour (no slideMs needed)
  },
  trigger: {
    type: 'time'
  },
  analysis: {
    promptId: 'moderation-report-v1',
    inspectionEnabled: false,
    outputFormat: 'markdown'
  },
  delivery: {
    egressTopic: 'internal.egress.v1',
    destination: {
      target: 'mod-logs-channel'
    }
  }
}
```

**MCP Tool Usage:**
```bash
event_stream_analyzer.observer.create({
  id: "multi-platform-moderation-hourly",
  windowType: "tumbling",
  windowSizeMs: 3600000,
  platforms: ["twitch", "discord", "slack"],
  eventTypes: ["moderation.timeout", "moderation.ban", "moderation.warning", "moderation.kick"],
  promptId: "moderation-report-v1",
  egressTopic: "internal.egress.v1"
})
```

**Result**: Every hour (on the hour), receive a summary of all moderation actions across all platforms.

---

### 3. Stream Highlights Detector

**Scenario**: Detect high-engagement moments during a Twitch stream by monitoring message volume bursts.

**Observer Configuration:**
```typescript
{
  id: 'stream-highlights-session',
  active: true,
  source: {
    mode: 'stream',
    topics: ['internal.contextualization.v1'],
    filters: {
      platforms: ['twitch'],
      eventTypes: ['chat.message', 'cheer', 'subscription']
    }
  },
  window: {
    type: 'session',      // Window closes after inactivity
    sessionGapMs: 60000   // 1 minute of inactivity = window close
  },
  trigger: {
    type: 'time'
  },
  analysis: {
    promptId: 'highlight-detection-v1',
    inspectionEnabled: false,
    outputFormat: 'markdown'
  },
  delivery: {
    egressTopic: 'internal.egress.v1',
    destination: {
      target: 'highlights-channel'
    }
  }
}
```

**MCP Tool Usage:**
```bash
event_stream_analyzer.observer.create({
  id: "stream-highlights-session",
  windowType: "session",
  sessionGapMs: 60000,
  platforms: ["twitch"],
  eventTypes: ["chat.message", "cheer", "subscription"],
  promptId: "highlight-detection-v1",
  egressTopic: "internal.egress.v1"
})
```

**Result**: When chat activity bursts (indicating an exciting moment), the session window captures the conversation. After 1 minute of calm, the window closes and generates a highlight summary.

---

### 4. Discord Server Sentiment Tracking

**Scenario**: Track overall sentiment in a Discord server with 15-minute summaries.

**Observer Configuration:**
```typescript
{
  id: 'discord-sentiment-15min',
  active: true,
  source: {
    mode: 'stream',
    topics: ['internal.contextualization.v1'],
    filters: {
      platforms: ['discord'],
      eventTypes: ['chat.message']
      // No channel filter = all channels
    }
  },
  window: {
    type: 'sliding',
    sizeMs: 900000,       // 15 minutes
    slideMs: 300000       // Slide every 5 minutes
  },
  trigger: {
    type: 'time'
  },
  analysis: {
    promptId: 'sentiment-analysis-v1',
    inspectionEnabled: false,
    outputFormat: 'markdown'
  },
  delivery: {
    egressTopic: 'internal.egress.v1',
    destination: {
      target: 'sentiment-dashboard'
    }
  }
}
```

**Result**: Every 5 minutes, receive a 15-minute rolling sentiment analysis of Discord activity.

---

### 5. Channel-Specific Monitoring

**Scenario**: Monitor only #general and #announcements channels in Discord for important updates.

**Observer Configuration:**
```typescript
{
  id: 'discord-important-channels',
  active: true,
  source: {
    mode: 'stream',
    topics: ['internal.contextualization.v1'],
    filters: {
      platforms: ['discord'],
      channels: ['general', 'announcements'], // Channel filter
      eventTypes: ['chat.message']
    }
  },
  window: {
    type: 'tumbling',
    sizeMs: 1800000       // 30 minutes
  },
  trigger: {
    type: 'time'
  },
  analysis: {
    promptId: 'channel-digest-v1',
    inspectionEnabled: false,
    outputFormat: 'markdown'
  },
  delivery: {
    egressTopic: 'internal.egress.v1'
  }
}
```

**MCP Tool Usage:**
```bash
event_stream_analyzer.observer.create({
  id: "discord-important-channels",
  windowType: "tumbling",
  windowSizeMs: 1800000,
  platforms: ["discord"],
  channels: ["general", "announcements"],
  eventTypes: ["chat.message"],
  promptId: "channel-digest-v1",
  egressTopic: "internal.egress.v1"
})
```

**Result**: Every 30 minutes, receive a digest of messages from only #general and #announcements.

---

## Window Types Explained

### Sliding Windows
**Use When**: You want overlapping windows for continuous monitoring.

```
Timeline:  |----[Window 1 (5m)]-------|
           |  |----[Window 2 (5m)]-------|
           |  |  |----[Window 3 (5m)]-------|
           0  1m 2m 3m 4m 5m 6m 7m 8m 9m 10m
```

**Characteristics:**
- Window size: `sizeMs` (e.g., 5 minutes)
- Slide interval: `slideMs` (e.g., 1 minute)
- Overlap: `sizeMs - slideMs` (e.g., 4 minutes)
- Use case: Trend detection, rolling averages

**Example:**
```typescript
window: {
  type: 'sliding',
  sizeMs: 300000,    // 5 minutes
  slideMs: 60000     // Slide every 1 minute
}
```

### Tumbling Windows
**Use When**: You want non-overlapping, fixed-duration windows.

```
Timeline:  |----[Window 1]----||----[Window 2]----||----[Window 3]----|
           0m               30m                 60m                 90m
```

**Characteristics:**
- Window size: `sizeMs` (e.g., 30 minutes)
- No overlap
- Use case: Periodic reports, hourly digests

**Example:**
```typescript
window: {
  type: 'tumbling',
  sizeMs: 1800000    // 30 minutes (no slideMs)
}
```

### Session Windows
**Use When**: You want windows based on activity bursts (conversation clusters).

```
Timeline:  [Activity] [---Gap---] [Activity][Gap] [Activity] [---Gap---]
           |----Session 1-------|  |---S2---|     |----Session 3-------|
```

**Characteristics:**
- Window closes after inactivity gap: `sessionGapMs`
- Variable duration (adapts to activity)
- Use case: Highlight detection, conversation clustering

**Example:**
```typescript
window: {
  type: 'session',
  sessionGapMs: 60000  // Close after 1 minute of inactivity
}
```

---

## Observer Lifecycle

### Creating an Observer

**Via MCP Tool:**
```bash
event_stream_analyzer.observer.create({
  id: "my-observer",
  windowType: "sliding",
  windowSizeMs: 300000,
  slideMs: 60000,
  platforms: ["twitch", "discord"],
  eventTypes: ["chat.message"],
  promptId: "standard-chat-summary-v1",
  egressTopic: "internal.egress.v1"
})
```

**What Happens:**
1. Observer persisted to `stream_observers` table (PostgreSQL)
2. RxJS window subscription created
3. NATS subscription established for `internal.contextualization.v1`
4. Service begins routing matching events to the window

### Listing Observers

**Via MCP Tool:**
```bash
event_stream_analyzer.observer.list({
  active: true  // Only active observers
})
```

**Returns:**
```json
[
  {
    "id": "twitch-chat-summary-5min",
    "active": true,
    "window": { "type": "sliding", "sizeMs": 300000, "slideMs": 60000 },
    "source": {
      "filters": { "platforms": ["twitch"], "eventTypes": ["chat.message"] }
    },
    "analysis": { "promptId": "standard-chat-summary-v1" },
    "updatedAt": "2026-08-20T12:00:00.000Z"
  }
]
```

### Updating an Observer

**Via MCP Tool:**
```bash
event_stream_analyzer.observer.update({
  observerId: "twitch-chat-summary-5min",
  active: false  // Pause the observer
})
```

**Or change window configuration:**
```bash
event_stream_analyzer.observer.update({
  observerId: "twitch-chat-summary-5min",
  windowSizeMs: 600000,  // Change to 10 minutes
  slideMs: 120000        // Slide every 2 minutes
})
```

**What Happens:**
1. Observer updated in database
2. If window config changed: old window destroyed, new window created
3. Changes take effect immediately

### Pausing/Resuming an Observer

**Pause:**
```bash
event_stream_analyzer.observer.update({
  observerId: "my-observer",
  active: false
})
```

**Resume:**
```bash
event_stream_analyzer.observer.update({
  observerId: "my-observer",
  active: true
})
```

### Deleting an Observer

**Via MCP Tool:**
```bash
event_stream_analyzer.observer.remove({
  observerId: "my-observer"
})
```

**What Happens:**
1. Window subscription destroyed
2. NATS subscription removed
3. Observer deleted from database
4. Window snapshot deleted (CASCADE)

---

## Event Filtering

### Platform Filtering

Restrict events to specific platforms:

```typescript
filters: {
  platforms: ['twitch']           // Only Twitch
}

filters: {
  platforms: ['twitch', 'discord'] // Twitch OR Discord
}

// No platform filter = all platforms
```

### Event Type Filtering

Restrict to specific event types:

```typescript
filters: {
  eventTypes: ['chat.message']    // Only chat messages
}

filters: {
  eventTypes: [
    'chat.message',
    'cheer',
    'subscription'
  ]  // Multiple types
}

// No eventTypes filter = all event types
```

### Channel Filtering

Restrict to specific channels (when applicable):

```typescript
filters: {
  platforms: ['discord'],
  channels: ['general', 'announcements']  // Only these channels
}

// No channels filter = all channels
```

### Combined Filtering

All filters are AND-ed together:

```typescript
filters: {
  platforms: ['twitch'],           // AND platform is Twitch
  eventTypes: ['chat.message'],    // AND event type is chat.message
  channels: ['bitbrat']            // AND channel is bitbrat
}
```

---

## LLM Analysis

### Prompt Selection

Observers use prompt IDs to select analysis behavior:

**Available Prompts** (from `stream_analyst_prompts` table):
- `standard-chat-summary-v1`: General chat summarization
- `moderation-report-v1`: Moderation action summary
- `highlight-detection-v1`: Detect exciting moments
- `sentiment-analysis-v1`: Track sentiment trends
- `channel-digest-v1`: Channel-specific digest

**Specify Prompt:**
```typescript
analysis: {
  promptId: 'standard-chat-summary-v1'
}
```

### Inspection Mode

Enable to see raw LLM request/response for debugging:

```typescript
analysis: {
  promptId: 'standard-chat-summary-v1',
  inspectionEnabled: true  // Logs full LLM I/O
}
```

**Use Case**: Debugging prompt performance, cost analysis, quality assessment.

### Output Format

```typescript
analysis: {
  outputFormat: 'markdown'  // Currently supported: markdown
}
```

---

## Crash Recovery

### How It Works

1. **Periodic Snapshots** (every 5 minutes):
   - Window state saved to `window_snapshots` table
   - Includes: `eventIds`, `windowStartedAt`, `lastEventAt`

2. **On Service Crash**:
   - Last snapshot is max 5 minutes old
   - Max 5-minute data loss

3. **On Service Restart**:
   - Snapshots restored from database
   - Windows reconstructed with partial event history
   - Service resumes processing

4. **Graceful Shutdown**:
   - Final snapshot taken before shutdown
   - Zero data loss

### Snapshot Schema

```typescript
interface WindowState {
  observerId: string;
  eventIds: string[];        // Event correlation IDs in window
  eventCount: number;
  windowStartedAt: string;   // ISO8601 timestamp
  lastEventAt: string;       // ISO8601 timestamp
  snapshotAt: string;        // ISO8601 timestamp
}
```

### Stale Snapshot Handling

Snapshots older than 10 minutes are discarded on restore (configurable via `staleThresholdMs`).

---

## Memory Management

### Event Limits

**Default**: 10,000 events total across all observers

**Warning Threshold**: 80% (8,000 events)

**Eviction Trigger**: When limit exceeded, oldest events evicted to bring usage to 70%

### Eviction Strategies

**Oldest** (default):
- Eviction distributed proportionally across all observers
- Fair: No single observer starves others

**Largest-Window** (optional):
- Evict from observer with most events
- Minimizes cross-window impact

### Configuration

```typescript
// In MemoryManager initialization (src/apps/event-stream-analyzer-service.ts)
this.memoryManager = new MemoryManager(this.getLogger(), {
  maxEvents: 10000,          // Total event limit
  warningThreshold: 0.8,     // Warn at 80%
  evictionStrategy: 'oldest' // 'oldest' | 'largest-window'
});
```

---

## Monitoring & Observability

### Metrics

**Via MCP Tool:**
```bash
event_stream_analyzer.metrics.get({
  format: "json"  // or "prometheus"
})
```

**Key Metrics:**
- `eventsReceived`: Total events received
- `eventsFiltered`: Events that didn't match any observer
- `eventsEvicted`: Events evicted due to memory pressure
- `windowsClosed`: Total windows closed
- `analysisCount`: Successful LLM analyses
- `analysisErrors`: Failed LLM analyses
- `averageAnalysisLatencyMs`: Rolling average (last 100)
- `snapshotCount`: Successful snapshots
- `snapshotErrors`: Failed snapshots

**Per-Observer Window Metrics:**
- `eventCount`: Events currently in window
- `windowAgeMs`: Time since window started
- `lastEventAgeMs`: Time since last event

**Resource Metrics:**
- `totalEvents`: Events in memory
- `memoryUsagePercent`: % of max events
- `activeObservers`: Number of active observers
- `activeSubscriptions`: NATS subscription count

### Logs

**Log Levels:**
- `ERROR`: Analysis failures, snapshot errors
- `WARN`: Memory warnings, evictions
- `INFO`: Window closures, observer lifecycle
- `DEBUG`: Event filtering, LLM analysis details

**Key Log Fields:**
- `observerId`: Stream observer ID
- `correlationId`: Event correlation ID
- `requestId`: LLM analysis request ID
- `eventCount`: Events in window
- `analysisLatencyMs`: LLM analysis duration
- `platform`: Event source platform

---

## Best Practices

### 1. Choose the Right Window Type

- **Sliding**: Use for continuous monitoring (dashboards, trend detection)
- **Tumbling**: Use for periodic reports (hourly digests, daily summaries)
- **Session**: Use for activity burst detection (highlights, conversations)

### 2. Configure Appropriate Window Sizes

- **Too small** (<1 min): Excessive LLM calls, high cost, noisy summaries
- **Too large** (>1 hour): Delayed insights, large context windows
- **Sweet spot**: 5-30 minutes for most use cases

### 3. Use Filters to Reduce Noise

```typescript
// Bad: Process all events from all platforms
filters: {}

// Good: Target specific platforms and event types
filters: {
  platforms: ['twitch'],
  eventTypes: ['chat.message']
}
```

### 4. Monitor Memory Usage

Use metrics to track memory pressure:
```bash
event_stream_analyzer.metrics.get({ format: "json" })
```

If `memoryUsagePercent` consistently >70%, consider:
- Reducing window sizes
- Adding more filters
- Increasing `maxEvents` limit

### 5. Test with Inspection Mode

Before deploying to production:
```typescript
analysis: {
  inspectionEnabled: true  // See LLM requests/responses
}
```

Review logs to ensure prompt quality and cost efficiency.

### 6. Use Meaningful Observer IDs

```typescript
// Bad
id: "obs-1"

// Good
id: "twitch-chat-summary-5min"
id: "discord-moderation-hourly"
id: "stream-highlights-session"
```

### 7. Clean Up Inactive Observers

Regularly audit and remove unused observers:
```bash
event_stream_analyzer.observer.list({ active: false })
```

---

## Troubleshooting

### No Summaries Generated

**Check:**
1. Observer is active: `event_stream_analyzer.observer.status({ observerId: "..." })`
2. Events match filters: Review `eventsFiltered` metric
3. Window is closing: Check window configuration (tumbling requires `sizeMs`, session requires activity)
4. LLM analysis errors: Check `analysisErrors` metric and error logs

### High Memory Usage

**Solutions:**
1. Reduce window sizes
2. Add stricter filters
3. Increase eviction threshold
4. Review `eventsEvicted` metric for eviction frequency

### Slow Analysis

**Check:**
1. `averageAnalysisLatencyMs` metric
2. LLM provider latency (inspect mode)
3. Window size (larger windows = more tokens = slower)

### Missing Events After Crash

**Expected Behavior:**
- Graceful shutdown: Zero data loss (final snapshot)
- Crash: Max 5-minute data loss (last periodic snapshot)

**If data loss >5 minutes:**
- Check snapshot interval configuration
- Review `snapshotErrors` metric
- Check database connectivity

---

## Advanced Configuration

### Custom Snapshot Interval

```typescript
// In SnapshotManager initialization (src/apps/event-stream-analyzer-service.ts)
this.snapshotManager = new SnapshotManager(documentStore, this.getLogger(), {
  enabled: true,
  snapshotIntervalMs: 180000,  // 3 minutes (default: 5 minutes)
  staleThresholdMs: 360000     // 6 minutes (default: 10 minutes)
});
```

### Custom Memory Limits

```typescript
// In MemoryManager initialization
this.memoryManager = new MemoryManager(this.getLogger(), {
  maxEvents: 20000,           // Increase limit (default: 10000)
  warningThreshold: 0.85,     // Warn at 85% (default: 0.8)
  evictionStrategy: 'largest-window'  // Change strategy
});
```

### Multiple Topic Subscriptions

```typescript
source: {
  mode: 'stream',
  topics: [
    'internal.contextualization.v1',
    'internal.analysis.v1'  // Subscribe to multiple topics
  ]
}
```

---

## API Reference

### MCP Tools

**Create Observer:**
```
event_stream_analyzer.observer.create(params)
```

**List Observers:**
```
event_stream_analyzer.observer.list({ active?: boolean })
```

**Update Observer:**
```
event_stream_analyzer.observer.update(params)
```

**Remove Observer:**
```
event_stream_analyzer.observer.remove({ observerId: string })
```

**Get Observer Status:**
```
event_stream_analyzer.observer.status({ observerId: string })
```

**Get Metrics:**
```
event_stream_analyzer.metrics.get({ format: "json" | "prometheus" })
```

---

## Related Documentation

- [Agent Flow Patterns](../concepts/agent-flow-patterns.md) - Understanding the event pipeline
- [5-Stage Model](../concepts/agent-flow-stages.md) - Event processing stages
- [Stream Analyst Engine](./stream-analyst-engine.md) - LLM analysis internals
- [Prometheus Metrics](./prometheus-metrics.md) - Monitoring and alerting

---

**Sprint**: sprint-20-xc3pcu (Event Stream Analyzer - Phase 3: Production Readiness)
**Last Updated**: 2026-08-20
