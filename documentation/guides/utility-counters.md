# Utility Service: Counter Guide

**Author**: Platform Team
**Sprint**: sprint-27-6tp11t
**Last Updated**: 2026-08-27
**Service**: utility-service

## Overview

The **Counter** feature provides flexible, scoped counter management with automatic TTL (time-to-live) expiration, metadata storage, and historical snapshots. Counters are ideal for tracking arbitrary metrics across different scopes (global, stream, user, session, custom) with minimal overhead.

**Key Features**:
- ✅ **Scoped counters**: Track metrics per stream, user, session, or globally
- ✅ **Automatic TTL**: Counters auto-expire after configured duration
- ✅ **Hybrid storage**: Fast Redis values + persistent PostgreSQL metadata
- ✅ **Atomic operations**: Thread-safe increment/decrement
- ✅ **Historical snapshots**: Capture counter state for analytics
- ✅ **Rich metadata**: Attach descriptions, categories, icons, etc.

## Core Concepts

### 1. Scopes

Counters are **scoped** to control their visibility and lifecycle. Choose the right scope based on your use case:

| Scope Type | Scope Value | Use Case | Example |
|------------|-------------|----------|---------|
| `global` | `"global"` | Platform-wide metrics | Total messages processed |
| `stream` | Channel name | Per-stream metrics | Deaths in current stream |
| `user` | User ID | Per-user metrics | User's total points |
| `session` | Session ID | Per-session metrics | Bids in current auction |
| `custom` | Any string | Custom grouping | Team-specific counters |

**Auto-inference**: If you don't specify scope parameters, the platform automatically infers scope from event context:
- `stream` scope → `event.ingress.channel`
- `user` scope → `event.identity.user.id`
- `global` scope → default fallback

### 2. TTL (Time-to-Live)

Counters can have an optional TTL (in seconds) for automatic expiration:

```typescript
// Counter expires after 1 hour
ttlSeconds: 3600

// Permanent counter (no TTL)
ttlSeconds: undefined
```

**Use Cases**:
- ✅ **Stream-scoped**: TTL = stream duration (auto-expire when stream ends)
- ✅ **Session-scoped**: TTL = session timeout
- ✅ **Global**: No TTL (permanent tracking)

**Important**: When a counter expires:
- ❌ Redis value is **deleted automatically**
- ✅ DocumentStore metadata **remains** (with `expiresAt` timestamp)
- ✅ Snapshots are **preserved** for historical analysis

### 3. Metadata

Attach arbitrary JSON metadata to counters for rich context:

```typescript
metadata: {
  description: "Player deaths in current run",
  icon: "💀",
  category: "gameplay",
  game: "Dark Souls 3",
  difficulty: "NG+7"
}
```

Metadata is stored in PostgreSQL and can be queried/filtered using `counter.list`.

### 4. Snapshots

Capture counter state at specific points in time for historical tracking:

```typescript
// Manual snapshot
counter.snapshot({ name: "deaths", trigger: "manual" })

// Triggered snapshot
counter.snapshot({ name: "deaths", trigger: "stream_end" })
```

Snapshots include:
- Current counter value
- Snapshot timestamp
- Trigger type (`manual`, `periodic`, `expiration`, `stream_end`)

## Common Use Cases

### Use Case 1: Stream Death Counter

Track player deaths during a gaming stream, auto-expire when stream ends:

```typescript
// Create counter when stream starts
counter.create({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",  // or auto-infer from event
  initialValue: 0,
  ttlSeconds: 14400,  // 4 hours (max stream duration)
  metadata: {
    description: "Player deaths in current stream",
    icon: "💀",
    game: "Elden Ring"
  }
})

// Increment on each death
counter.increment({ name: "deaths", scopeType: "stream", scopeValue: "bitbrat" })

// Get current count for overlay
counter.get({ name: "deaths", scopeType: "stream", scopeValue: "bitbrat" })
// Returns: { value: 42, key: "counter:stream:bitbrat:deaths" }

// Take snapshot when stream ends
counter.snapshot({ name: "deaths", scopeType: "stream", scopeValue: "bitbrat", trigger: "stream_end" })
```

**Best Practices**:
- Set TTL slightly longer than expected stream duration
- Take snapshot at stream end for permanent record
- Use metadata to track game, difficulty, etc.

### Use Case 2: User Points System

Track user points across all streams:

```typescript
// Create permanent user counter
counter.create({
  name: "points",
  scopeType: "user",
  scopeValue: "user_123",  // or auto-infer from event
  initialValue: 0,
  // No TTL - permanent counter
  metadata: {
    description: "Total channel points earned",
    icon: "⭐",
    unit: "points"
  }
})

// Award points
counter.increment({ name: "points", scopeType: "user", scopeValue: "user_123", delta: 100 })

// Redeem points
counter.decrement({ name: "points", scopeType: "user", scopeValue: "user_123", delta: 50 })

// Check balance
counter.get({ name: "points", scopeType: "user", scopeValue: "user_123" })
```

### Use Case 3: Global Message Counter

Track total messages processed by the platform:

```typescript
// Create global counter
counter.create({
  name: "messages_processed",
  scopeType: "global",
  initialValue: 0,
  metadata: {
    description: "Total messages processed since launch",
    category: "platform_metrics"
  }
})

// Increment on each message
counter.increment({ name: "messages_processed", scopeType: "global" })

// Periodic snapshots for analytics
counter.snapshot({ name: "messages_processed", scopeType: "global", trigger: "periodic" })
```

### Use Case 4: Session Bidding Counter

Track total bids in a temporary bidding session:

```typescript
// Create session counter
counter.create({
  name: "total_bids",
  scopeType: "session",
  scopeValue: "auction_20260827",
  initialValue: 0,
  ttlSeconds: 300,  // 5-minute auction
  metadata: {
    description: "Total bids in current auction",
    item: "Legendary Sword",
    startTime: "2026-08-27T10:00:00Z"
  }
})

// Increment on each bid
counter.increment({ name: "total_bids", scopeType: "session", scopeValue: "auction_20260827" })

// Snapshot when auction closes
counter.snapshot({
  name: "total_bids",
  scopeType: "session",
  scopeValue: "auction_20260827",
  trigger: "expiration"
})
```

## MCP Tool Usage

### From LLM (via tool-gateway)

LLMs can interact with counters using platform MCP tools:

```typescript
// LLM creates counter during stream start
<tool-call>
  <tool>counter.create</tool>
  <parameters>
    {
      "name": "deaths",
      "scopeType": "stream",
      "initialValue": 0,
      "ttlSeconds": 14400,
      "metadata": {
        "description": "Deaths in current stream",
        "icon": "💀"
      }
    }
  </parameters>
</tool-call>

// LLM increments counter when user says "I died"
<tool-call>
  <tool>counter.increment</tool>
  <parameters>
    {
      "name": "deaths",
      "scopeType": "stream"
      // scopeValue auto-inferred from event.ingress.channel
    }
  </parameters>
</tool-call>

// LLM reports current count
<tool-call>
  <tool>counter.get</tool>
  <parameters>
    {
      "name": "deaths",
      "scopeType": "stream"
    }
  </parameters>
</tool-call>
```

### From Platform Services (via CounterManager)

Services can access counters programmatically:

```typescript
import { CounterManager } from '../services/utility/counter-manager';

class MyService extends Bit {
  private counterManager: CounterManager;

  async trackMetric(name: string, value: number) {
    await this.counterManager.create({
      name,
      scopeType: 'global',
      initialValue: value,
      metadata: { source: this.name }
    });
  }

  async incrementMetric(name: string) {
    await this.counterManager.increment({
      name,
      scopeType: 'global',
      delta: 1
    });
  }
}
```

## Best Practices

### Scope Selection

✅ **Use `stream` scope for**:
- Metrics tied to live stream sessions
- Temporary counters with known end time
- Per-channel statistics

✅ **Use `user` scope for**:
- User-specific persistent metrics
- Cross-stream user data
- Personal achievements/stats

✅ **Use `global` scope for**:
- Platform-wide metrics
- Permanent counters
- Aggregate statistics

✅ **Use `session` scope for**:
- Temporary grouped events (auctions, polls, games)
- Short-lived interactions
- Time-bounded activities

✅ **Use `custom` scope for**:
- Team/organization metrics
- Multi-dimensional grouping
- Non-standard categorization

### TTL Configuration

| Counter Type | Recommended TTL | Rationale |
|--------------|----------------|-----------|
| Stream metrics | 4-6 hours | Covers max stream duration + buffer |
| Session metrics | Event duration + 10% | Ensure capture of late events |
| User metrics | None (permanent) | Persistent user data |
| Global metrics | None (permanent) | Long-term analytics |
| Temporary events | 2x expected duration | Safety margin for delays |

### Metadata Organization

```typescript
// ✅ Good: Structured, queryable metadata
metadata: {
  description: "Player deaths in speedrun",
  category: "gameplay",
  game: "Celeste",
  difficulty: "golden_strawberry",
  runner: "user_123",
  startTime: "2026-08-27T10:00:00Z"
}

// ❌ Bad: Unstructured, hard to query
metadata: {
  info: "deaths for celeste run user_123 golden strawberry"
}
```

### Snapshot Strategy

```typescript
// ✅ Snapshot at critical events
counter.snapshot({ name: "deaths", trigger: "stream_end" })
counter.snapshot({ name: "bids", trigger: "expiration" })
counter.snapshot({ name: "metrics", trigger: "periodic" })  // e.g., hourly

// ❌ Don't snapshot too frequently (performance cost)
// Avoid: Snapshot on every increment
```

## Querying Counters

### List All Stream Counters

```typescript
counter.list({
  scopeType: "stream",
  scopeValue: "bitbrat"
})
// Returns all active counters for stream "bitbrat"
```

### List Expired Counters

```typescript
counter.list({
  scopeType: "stream",
  scopeValue: "bitbrat",
  includeExpired: true
})
// Includes counters past their TTL
```

### List All User Counters

```typescript
counter.list({
  scopeType: "user",
  scopeValue: "user_123"
})
// Returns all active counters for user_123
```

## Direct Key Access (Advanced)

For performance-critical operations, you can bypass scope resolution and use direct Redis keys:

```typescript
// Resolve key once
const key = "counter:stream:bitbrat:deaths";

// Use key directly for subsequent operations
counter.increment({ key })  // Faster (no scope resolution)
counter.get({ key })
counter.delete({ key })
```

**Format**: `counter:{scopeType}:{scopeValue}:{name}`

**Use Cases**:
- High-frequency updates
- Batch operations
- Performance optimization

## Troubleshooting

### Counter Not Found

**Symptom**: `counter.get` returns 0 or null

**Possible Causes**:
1. Counter expired (TTL elapsed)
2. Wrong scope parameters
3. Counter never created

**Solutions**:
```typescript
// Check DocumentStore for metadata (even if expired)
counter.list({ scopeType: "stream", scopeValue: "bitbrat", includeExpired: true })

// Verify scope resolution
// Expected: { scopeType: "stream", scopeValue: "bitbrat" }
// Actual: Check event.ingress.channel matches scopeValue
```

### Increment Not Working

**Symptom**: Counter value doesn't change

**Possible Causes**:
1. Redis connection issue
2. Scope mismatch
3. Counter expired

**Solutions**:
```typescript
// Check service logs for Redis errors
fleet.logs({ bit: "utility", level: "error" })

// Verify counter exists
counter.get({ name: "deaths", scopeType: "stream", scopeValue: "bitbrat" })

// Check TTL status in metadata
counter.list({ scopeType: "stream", scopeValue: "bitbrat", includeExpired: true })
// Look for expiresAt field
```

### Scope Auto-Inference Not Working

**Symptom**: Counter defaults to global scope unexpectedly

**Possible Causes**:
1. Event context missing channel/user info
2. Event not passed to MCP tool

**Solutions**:
```typescript
// Explicit scope (bypass auto-inference)
counter.create({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",  // Explicit value
  ...
})

// Check event context
// event.ingress.channel should be present for stream scope
// event.identity.user.id should be present for user scope
```

### Metadata Not Persisting

**Symptom**: Metadata missing from `counter.get` results

**Possible Causes**:
1. Using direct key access (bypasses metadata lookup)
2. DocumentStore connection issue

**Solutions**:
```typescript
// Use name-based access (includes metadata)
counter.get({ name: "deaths", scopeType: "stream", scopeValue: "bitbrat" })

// Check DocumentStore connectivity
fleet.health({ bit: "utility" })
// Should show: documentStore: true
```

## Performance Considerations

### High-Frequency Updates

For counters updated multiple times per second:

✅ **Do**:
- Use direct key access (`{ key: "counter:..." }`)
- Batch increments when possible (`delta: 100` instead of 100 calls)
- Use Redis for reads (avoid DocumentStore metadata queries)

❌ **Don't**:
- Query metadata on every increment
- Create new counters frequently
- Use complex scope resolution in hot paths

### Large-Scale Deployments

For hundreds of counters:

✅ **Do**:
- Use consistent naming conventions
- Leverage scope filtering in queries
- Set appropriate TTLs to prevent accumulation
- Schedule periodic cleanup of expired DocumentStore entries

❌ **Don't**:
- Create unlimited counters without TTL
- Use overly broad queries (`list({})` returns everything)
- Snapshot on every increment

## Related Documentation

- **MCP Tool Reference**: `/documentation/reference/utility-tools.md`
- **Technical Architecture**: `/documentation/architecture/utility-service.md`
- **Scope Resolution**: See `ScopeResolver` implementation
- **Hybrid Storage**: See `CounterManager` implementation
- **Bidding Guide**: `/documentation/guides/utility-bidding.md` (Phase 2)

## Examples

See complete examples in:
- Test suite: `src/services/utility/counter-manager.test.ts`
- Validation script: `planning/sprint-27-6tp11t/validate_counters.sh`
- Integration tests: `src/services/utility/counter-integration.test.ts` (future)

## Support

For issues or questions:
1. Check service logs: `fleet.logs({ bit: "utility" })`
2. Verify health: `fleet.health({ bit: "utility" })`
3. Review architecture: `brat config show`
4. Consult reference docs: `/documentation/reference/utility-tools.md`
