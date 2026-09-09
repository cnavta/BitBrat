# Bidding System User Guide

**Platform:** utility-service
**Sprint:** 29 (sprint-29-49pmm9)
**Status:** Production-ready
**MCP Tools:** 8 (platform-only exposure)

## Overview

The bidding system enables LLMs to create prediction games, auctions, and guessing contests where users submit numeric bids. Sessions are scoped (global, stream, user, session, custom) with optional target values and TTLs. Active bids stored in Redis Hashes for fast queries; results snapshotted to DocumentStore for analytics. Supports atomic submissions, aggregation queries (max/min/closest), and statistical analysis on close.

**Use cases:** Price-is-Right games, auction systems, prediction markets, user engagement contests, data collection via numeric inputs.

**Architecture:** Hybrid storage (Redis + DocumentStore), client-side sorting for aggregation, fail-open error handling.

---

## Quick Start

### Example: Stream-scoped Price Guessing Game

```javascript
// 1. Create session with target value
bid.create({
  name: "price-guess-game",
  scopeType: "stream",
  scopeValue: "my-channel",
  targetValue: 100,
  ttlSeconds: 300,  // 5 minutes
  metadata: {
    description: "Guess the secret number!",
    prize: "100 channel points"
  }
})
// Result: { success: true, sessionId: "stream:my-channel:price-guess-game", ... }

// 2. Users submit bids
bid.submit({ session: "stream:my-channel:price-guess-game", user: "alice", value: 95 })
bid.submit({ session: "stream:my-channel:price-guess-game", user: "bob", value: 120 })
bid.submit({ session: "stream:my-channel:price-guess-game", user: "charlie", value: 88 })

// 3. Query current leader
bid.getClosest({ session: "stream:my-channel:price-guess-game" })
// Result: { userId: "alice", value: 95, difference: 5 }

// 4. Close session and announce winner
bid.close({ session: "stream:my-channel:price-guess-game", computeWinner: true })
// Result: { winner: { userId: "alice", value: 95 }, statistics: { max: 120, min: 88, mean: 101, median: 95 }, ... }
```

---

## MCP Tools Reference

### Tool Inventory

| Tool | Purpose | Scope Support | Target Required |
|------|---------|---------------|-----------------|
| `bid.create` | Create new session | All | No |
| `bid.submit` | Submit/update bid | N/A | No |
| `bid.getMax` | Query highest bid | N/A | No |
| `bid.getMin` | Query lowest bid | N/A | No |
| `bid.getClosest` | Query nearest to target | N/A | Yes |
| `bid.close` | Close session, compute results | N/A | No |
| `bid.list` | List sessions by filters | All | No |
| `bid.results` | Query historical results | N/A | No |

**Exposure:** All tools are `platform-only` (available to LLM agents, not directly to users).

---

## Tool Specifications

### bid.create

**Purpose:** Create a new bidding session with optional target value and TTL.

**Parameters:**
```typescript
{
  name: string,              // Session name (1-64 chars)
  scopeType?: 'global' | 'stream' | 'user' | 'session' | 'custom',
  scopeValue?: string,       // Required if scopeType specified
  targetValue?: number,      // Optional target for closest-to queries
  ttlSeconds?: number,       // Auto-expire session (Redis TTL)
  metadata?: object,         // Custom metadata (description, prize, etc.)
  event?: InternalEventV2,   // For scope auto-inference
  createdBy?: string         // Creator ID (default: 'system')
}
```

**Returns:**
```typescript
{
  success: boolean,
  sessionId: string,         // Format: {scopeType}:{scopeValue}:{name}
  sessionKey: string,        // Redis hash key: bid:session:{sessionId}
  expiresAt?: string,        // ISO 8601 (if TTL set)
  error?: string
}
```

**Scope Resolution Priority:**
1. Explicit `scopeType` + `scopeValue`
2. Explicit `scopeType` + infer value from `event`
3. Auto-infer both from `event.ingress.channel` or `event.identity.user.id`
4. Default to `global:global`

**Examples:**

```javascript
// Explicit scope
bid.create({
  name: "auction-item-42",
  scopeType: "global",
  scopeValue: "global",
  targetValue: 1000,
  metadata: { description: "Charity auction", prize: "$1000 donation" }
})

// Auto-infer scope from event
bid.create({
  name: "viewer-prediction",
  event: { ingress: { channel: "bitbrat" }, ... },  // Infers stream:bitbrat
  targetValue: 500
})

// No target value (max/min only)
bid.create({
  name: "high-score-contest",
  scopeType: "stream",
  scopeValue: "gaming-channel"
})

// Temporary session with TTL
bid.create({
  name: "flash-auction",
  scopeType: "global",
  scopeValue: "global",
  targetValue: 50,
  ttlSeconds: 60  // Expires in 1 minute
})
```

---

### bid.submit

**Purpose:** Submit a new bid or update an existing bid (atomic upsert).

**Parameters:**
```typescript
{
  session: string,    // Session ID (from bid.create result)
  user: string,       // User ID
  value: number,      // Bid value (supports decimals)
  userName?: string,  // Display name (optional)
  metadata?: object   // Custom metadata (optional)
}
```

**Returns:**
```typescript
{
  success: boolean,
  entryId: string,         // Format: {sessionId}:{userId}
  previousValue?: number,  // Previous bid if updating
  newValue?: number,       // New bid value
  error?: string
}
```

**Behavior:**
- **First submission:** Creates new entry, `previousValue` is undefined
- **Subsequent submissions:** Updates entry, returns both previous and new values
- **Atomicity:** Uses Redis HSET (atomic upsert, no race conditions)

**Examples:**

```javascript
// First bid
bid.submit({
  session: "stream:bitbrat:price-guess",
  user: "alice",
  value: 95
})
// Result: { success: true, entryId: "stream:bitbrat:price-guess:alice", newValue: 95 }

// Update bid
bid.submit({
  session: "stream:bitbrat:price-guess",
  user: "alice",
  value: 103
})
// Result: { success: true, entryId: "...", previousValue: 95, newValue: 103 }

// Decimal values
bid.submit({
  session: "global:global:auction",
  user: "bob",
  value: 123.45
})
```

---

### bid.getMax / bid.getMin

**Purpose:** Query the highest or lowest bid in an active session.

**Parameters:**
```typescript
{
  session: string  // Session ID
}
```

**Returns:**
```typescript
{
  sessionId: string,
  userId: string,
  userName?: string,
  value: number,
  submittedAt: string  // ISO 8601 (approximate)
}
```

**Errors:** Throws if session has no bids.

**Examples:**

```javascript
// Get highest bid
bid.getMax({ session: "stream:bitbrat:price-guess" })
// Result: { userId: "bob", value: 120, ... }

// Get lowest bid
bid.getMin({ session: "stream:bitbrat:price-guess" })
// Result: { userId: "charlie", value: 88, ... }
```

**Performance:** O(n) where n = number of bids. Acceptable for <1000 bids/session.

---

### bid.getClosest

**Purpose:** Query the bid closest to the target value.

**Parameters:**
```typescript
{
  session: string,  // Session ID
  target?: number   // Override session target (optional)
}
```

**Returns:**
```typescript
{
  sessionId: string,
  userId: string,
  userName?: string,
  value: number,
  submittedAt: string,
  difference?: number  // Absolute distance to target
}
```

**Target Resolution:**
1. Use `target` parameter if provided
2. Use session's `targetValue` from creation
3. Error if neither available

**Errors:** Throws if no target or no bids.

**Examples:**

```javascript
// Use session target (100)
bid.getClosest({ session: "stream:bitbrat:price-guess" })
// Bids: alice:95, bob:120, charlie:88
// Result: { userId: "alice", value: 95, difference: 5 }

// Override target
bid.getClosest({ session: "stream:bitbrat:price-guess", target: 90 })
// Result: { userId: "charlie", value: 88, difference: 2 }
```

**Performance:** O(n log n) due to sorting. Acceptable for <1000 bids/session.

---

### bid.close

**Purpose:** Close a session, compute statistics, determine winner, and snapshot to DocumentStore.

**Parameters:**
```typescript
{
  session: string,           // Session ID
  computeWinner?: boolean,   // Default: true
  deleteRedisHash?: boolean  // Default: false
}
```

**Returns:**
```typescript
{
  success: boolean,
  sessionId: string,
  closedAt: string,  // ISO 8601
  finalCount: number,
  winner?: {
    userId: string,
    value: number,
    difference?: number  // Distance to target
  },
  statistics?: {
    max: number,
    min: number,
    mean: number,
    median: number
  },
  error?: string
}
```

**Side Effects:**
1. Updates session status to `'closed'` in DocumentStore
2. Creates snapshot in `bid_results` collection with:
   - All entries (userId, value, submittedAt)
   - Statistics (max, min, mean, median)
   - Winner (if `computeWinner` true and target exists)
   - Metadata
3. Optionally deletes Redis hash (if `deleteRedisHash` true)

**Winner Determination:** Sorts bids by distance to target, returns closest.

**Examples:**

```javascript
// Close with winner
bid.close({
  session: "stream:bitbrat:price-guess",
  computeWinner: true
})
// Result: {
//   finalCount: 5,
//   winner: { userId: "alice", value: 95, difference: 5 },
//   statistics: { max: 120, min: 88, mean: 101, median: 95 },
//   ...
// }

// Close without winner (no target value)
bid.close({
  session: "stream:gaming:high-score",
  computeWinner: false
})

// Close and cleanup Redis
bid.close({
  session: "global:global:flash-auction",
  deleteRedisHash: true  // Free Redis memory
})
```

**Performance:** O(n log n) for winner sorting, O(n) for statistics.

---

### bid.list

**Purpose:** List bid sessions with optional filters.

**Parameters:**
```typescript
{
  scopeType?: 'global' | 'stream' | 'user' | 'session' | 'custom',
  scopeValue?: string,
  status?: 'active' | 'closed' | 'expired',
  limit?: number  // Default: 50
}
```

**Returns:**
```typescript
BidSession[]  // Array of session metadata
```

**Examples:**

```javascript
// List all active sessions in a stream
bid.list({
  scopeType: "stream",
  scopeValue: "bitbrat",
  status: "active"
})

// List all closed sessions (any scope)
bid.list({ status: "closed", limit: 10 })

// List all sessions (no filters)
bid.list({})
```

---

### bid.results

**Purpose:** Query historical bid results for analytics.

**Parameters:**
```typescript
{
  sessionId?: string,      // Specific session
  scopeType?: string,      // Filter by scope
  scopeValue?: string,     // Filter by scope value
  limit?: number,          // Default: 50
  orderBy?: 'closedAt' | 'totalEntries'  // Default: 'closedAt'
}
```

**Returns:**
```typescript
BidResult[]  // Array of result snapshots
```

**Result Schema:**
```typescript
{
  id: string,               // {sessionId}:{timestamp}
  sessionId: string,
  closedAt: string,
  totalEntries: number,
  winner?: { userId, value, difference },
  statistics: { max, min, mean, median },
  allEntries: [{ userId, value, submittedAt }, ...],
  metadata: object
}
```

**Examples:**

```javascript
// Get results for specific session
bid.results({ sessionId: "stream:bitbrat:price-guess-1" })

// Get all results for a stream
bid.results({
  scopeType: "stream",
  scopeValue: "bitbrat",
  orderBy: "closedAt",
  limit: 20
})

// Get sessions with most entries
bid.results({ orderBy: "totalEntries", limit: 10 })
```

---

## Use Cases

### 1. Price-is-Right Game

**Scenario:** Viewers guess the price of an item, closest wins.

```javascript
// Start game
const session = await bid.create({
  name: "price-right-round-1",
  event: currentEvent,  // Auto-infers stream scope
  targetValue: 149.99,  // Secret price
  ttlSeconds: 180,      // 3 minutes
  metadata: { description: "Guess the price of the gaming headset!" }
});

// Users submit guesses via chat
// LLM calls bid.submit() for each !guess command

// During game: show leader
const leader = await bid.getClosest({ session: session.sessionId });
// "Current leader: alice with $95 (off by $54.99)"

// End game
const results = await bid.close({ session: session.sessionId });
// "Winner: alice with $95! Statistics: 42 guesses, range $10-$500"
```

### 2. Charity Auction

**Scenario:** Global auction with no target, highest bid wins.

```javascript
// Create auction
await bid.create({
  name: "charity-auction-item-5",
  scopeType: "global",
  scopeValue: "global",
  metadata: {
    description: "Signed poster",
    prize: "Signed poster from creator",
    minBid: 10
  }
});

// Show current high bid
const highBid = await bid.getMax({ session: "global:global:charity-auction-item-5" });
// "Current high bid: $125 by bob"

// Close auction
const results = await bid.close({
  session: "global:global:charity-auction-item-5",
  computeWinner: false  // Winner is max bidder (no target)
});
// Winner determined by results.statistics.max
```

### 3. User Prediction Market

**Scenario:** Each user predicts a value, tracked per-user.

```javascript
// Each user gets their own session
await bid.create({
  name: "daily-prediction",
  scopeType: "user",
  scopeValue: "alice",
  targetValue: null,  // Revealed later
  ttlSeconds: 86400   // 24 hours
});

// User submits prediction
await bid.submit({
  session: "user:alice:daily-prediction",
  user: "alice",
  value: 42
});

// Later: set target and determine winners across all users
// Query all user sessions, compute accuracy
const allSessions = await bid.list({
  scopeType: "user",
  status: "active"
});
```

### 4. Stream Engagement Metric

**Scenario:** Track average viewer predictions over time.

```javascript
// Create session at stream start
await bid.create({
  name: "viewer-sentiment",
  scopeType: "stream",
  scopeValue: "bitbrat",
  metadata: { description: "How are you feeling? (1-10)" }
});

// Viewers submit throughout stream
// bid.submit() for each response

// Periodic analytics
const results = await bid.close({
  session: "stream:bitbrat:viewer-sentiment"
});
// results.statistics.mean = average sentiment
// results.statistics.median = median sentiment
// results.totalEntries = participation count
```

---

## Best Practices

### Session Naming

✅ **Good:**
- `price-guess-round-1` (descriptive, versioned)
- `auction-signed-poster` (clear purpose)
- `daily-prediction-2026-08-29` (dated)

❌ **Avoid:**
- `game` (too generic)
- `test123` (unclear purpose)
- `alice-thing` (ambiguous)

### Scope Selection

| Scope | When to Use | Example |
|-------|-------------|---------|
| `global` | Platform-wide events | Charity auctions, platform-wide contests |
| `stream` | Channel-specific games | Price-is-Right per stream |
| `user` | Per-user tracking | Daily predictions, user stats |
| `session` | Ephemeral, conversation-scoped | One-off quick polls |
| `custom` | Complex multi-scope scenarios | Cross-stream tournaments |

### TTL Guidelines

| Duration | Use Case |
|----------|----------|
| 60s | Flash games, rapid polls |
| 180-300s | Standard stream games (3-5 min) |
| 3600s | Hourly events |
| 86400s | Daily predictions |
| No TTL | Permanent sessions (manual close) |

**Warning:** Sessions without TTL remain in Redis until manually closed or server restart.

### Metadata Best Practices

```javascript
// Good metadata
{
  description: "User-facing description of the game",
  prize: "What the winner gets",
  rules: "Brief rules or constraints",
  icon: "🎮",  // Emoji for UI
  category: "game",
  minBid: 10,
  maxBid: 1000
}

// Avoid storing large objects
{
  userList: [...1000 users...],  // ❌ Use DocumentStore instead
  historyLog: [...],              // ❌ Bloats session metadata
}
```

### Error Handling

```javascript
// Always check success flag
const result = await bid.create({ name: "game", ... });
if (!result.success) {
  console.error("Failed to create session:", result.error);
  // Fallback behavior
}

// Handle missing target for getClosest
try {
  const closest = await bid.getClosest({ session: sessionId });
} catch (error) {
  // Session has no target value
  console.log("No target set, using max bid instead");
  const max = await bid.getMax({ session: sessionId });
}
```

### Performance Considerations

**Session Size Limits:**
- **<100 bids:** Excellent performance (all operations <10ms)
- **100-1000 bids:** Good performance (aggregations <100ms)
- **>1000 bids:** Consider optimization (potential lag on close)

**Optimization for Large Sessions:**
```javascript
// For high-volume sessions, close without deleting Redis hash
// Allows continued queries while keeping snapshot
await bid.close({
  session: sessionId,
  deleteRedisHash: false  // Keep for analytics
});

// Later cleanup when done
// (Manual Redis DEL or rely on TTL)
```

---

## Troubleshooting

### Common Issues

#### "No bids found" Error

**Symptom:** `bid.getMax()`, `bid.getMin()`, or `bid.getClosest()` throws error.

**Causes:**
1. Session has no bids yet
2. Session ID incorrect
3. Redis hash expired (TTL)

**Solutions:**
```javascript
// Check if session has bids before querying
const allBids = await bid.list({ status: "active" });
if (allBids.find(s => s.id === sessionId)) {
  // Session exists, may be empty
}

// Use try-catch for graceful handling
try {
  const max = await bid.getMax({ session: sessionId });
} catch (error) {
  console.log("No bids yet, waiting for first submission");
}
```

#### "No target value specified" Error

**Symptom:** `bid.getClosest()` throws error.

**Cause:** Session created without `targetValue`, and no explicit `target` provided.

**Solution:**
```javascript
// Option 1: Provide explicit target
bid.getClosest({ session: sessionId, target: 100 });

// Option 2: Use max/min instead
bid.getMax({ session: sessionId });
```

#### Session Not Found in List

**Symptom:** `bid.list()` doesn't return expected session.

**Causes:**
1. Session expired (TTL)
2. Incorrect scope filters
3. Session status doesn't match filter

**Solutions:**
```javascript
// List all sessions (no filters)
const all = await bid.list({});

// Check specific scope
const sessions = await bid.list({
  scopeType: "stream",
  scopeValue: "bitbrat",
  status: "active"  // Try "closed" if not found
});
```

#### Results Not Appearing After Close

**Symptom:** `bid.results()` returns empty after closing session.

**Causes:**
1. Close operation failed (check error)
2. Query filters too restrictive
3. DocumentStore write delay

**Solutions:**
```javascript
// Close with error check
const closeResult = await bid.close({ session: sessionId });
if (!closeResult.success) {
  console.error("Close failed:", closeResult.error);
}

// Query by session ID (most specific)
const results = await bid.results({ sessionId: sessionId });

// Check DocumentStore health
// (Platform admin command)
```

### Performance Issues

**Symptom:** `bid.close()` takes >5 seconds.

**Cause:** Session has >1000 bids, client-side sorting is slow.

**Mitigations:**
1. **Limit session size:** Use TTL to prevent runaway growth
2. **Skip winner computation:** `computeWinner: false` saves sorting
3. **Batch processing:** Close multiple sessions async
4. **Future optimization:** Request Redis ZSET support (see architecture notes)

---

## Data Persistence

### Storage Layers

| Data | Storage | Lifetime | Purpose |
|------|---------|----------|---------|
| Active bids | Redis Hash | Until close or TTL | Fast queries |
| Session metadata | DocumentStore (bid_sessions) | Permanent | Queryability, audit trail |
| Results snapshot | DocumentStore (bid_results) | Permanent | Analytics, history |

### Redis Hash Structure

**Key Pattern:** `bid:session:{sessionId}`

**Fields:**
- `_metadata`: JSON string with `{ targetValue, createdAt }`
- `user:{userId}`: Bid value (string representation of number)

**Example:**
```
Key: bid:session:stream:bitbrat:price-guess

Fields:
  _metadata: {"targetValue":100,"createdAt":"2026-08-29T12:00:00Z"}
  user:alice: "95"
  user:bob: "120"
  user:charlie: "88"
```

### DocumentStore Collections

#### bid_sessions

**Purpose:** Session metadata for querying and audit.

**Schema:**
```typescript
{
  id: string,              // {scopeType}:{scopeValue}:{name}
  name: string,
  scopeType: ScopeType,
  scopeValue: string,
  targetValue?: number,
  ttlSeconds?: number,
  metadata: object,
  createdAt: string,
  expiresAt?: string,
  closedAt?: string,
  createdBy: string,
  status: 'active' | 'closed' | 'expired'
}
```

#### bid_results

**Purpose:** Snapshot of session results for analytics.

**Schema:**
```typescript
{
  id: string,              // {sessionId}:{timestamp}
  sessionId: string,
  closedAt: string,
  totalEntries: number,
  winner?: {
    userId: string,
    value: number,
    difference?: number
  },
  statistics: {
    max: number,
    min: number,
    mean: number,
    median: number
  },
  allEntries: Array<{
    userId: string,
    value: number,
    submittedAt: string
  }>,
  metadata: object
}
```

### Cleanup Strategies

**Option 1: Auto-expire with TTL**
```javascript
bid.create({
  name: "temp-game",
  ttlSeconds: 3600,  // Redis auto-deletes after 1 hour
  ...
});
// DocumentStore metadata remains, Redis hash expires
```

**Option 2: Manual cleanup after close**
```javascript
bid.close({
  session: sessionId,
  deleteRedisHash: true  // Free Redis memory immediately
});
// Snapshot preserved in DocumentStore
```

**Option 3: Periodic batch cleanup**
```javascript
// Platform admin task (future enhancement)
// Query expired sessions, delete Redis hashes
const expired = await bid.list({ status: "expired" });
// Bulk delete via Redis DEL
```

---

## Integration with LLM Workflows

### Example: Chat Command Flow

```
User: !guess 95
  ↓
1. Ingress (Discord/Twilio)
  ↓
2. internal.ingress.v1 → event-router
  ↓
3. internal.analysis.v1 → llm-bot
  ↓
4. LLM detects !guess command, extracts value
  ↓
5. LLM calls bid.submit() via tool-gateway
  ↓
6. utility-service writes to Redis
  ↓
7. LLM generates response: "Your guess of $95 has been recorded!"
  ↓
8. internal.egress.v1 → ingress-egress → Discord
```

### Example: Proactive Announcement

```javascript
// LLM workflow: Announce leader every 30 seconds

// 1. Schedule periodic check
// (via scheduler-service or internal timer)

// 2. Query current leader
const leader = await bid.getClosest({ session: activeSessionId });

// 3. Generate announcement event
await publishEvent({
  type: "internal.egress.v1",
  egress: { platform: "discord", channel: "bitbrat" },
  message: { text: `Current leader: ${leader.userId} with ${leader.value}!` }
});
```

---

## Appendix: Architecture Summary

### Design Principles

1. **Hybrid Storage:** Redis for speed, DocumentStore for persistence
2. **Client-Side Sorting:** Simple, no Redis ZSET dependency
3. **Fail-Open:** Graceful degradation if Redis unavailable
4. **Atomic Operations:** Redis HSET prevents race conditions
5. **Immutable Snapshots:** Results snapshots never modified after close

### Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| create() | O(1) | Single DocumentStore write + Redis HSET |
| submit() | O(1) | Atomic Redis HSET |
| getMax() | O(n) | HGETALL + Array.reduce |
| getMin() | O(n) | HGETALL + Array.reduce |
| getClosest() | O(n log n) | HGETALL + Array.sort |
| close() | O(n log n) | HGETALL + statistics + sort for winner |
| list() | O(m) | DocumentStore query (m = result count) |
| getResults() | O(m) | DocumentStore query (m = result count) |

### Future Enhancements

**Potential Optimizations:**
- Redis ZSET for O(log n) aggregation queries
- Background workers for async close operations
- WebSocket subscriptions for real-time updates
- Leaderboard caching for high-traffic sessions

**Monitoring Metrics:**
- Session count by scope
- Average bids per session
- Close operation latency (P50, P95, P99)
- Redis memory usage (hash size distribution)

---

## See Also

- **Counter System Guide:** `documentation/guides/counter-system.md`
- **Utility Service Architecture:** `documentation/architecture/utility-service.md`
- **MCP Tool Reference:** `documentation/reference/mcp-tools.md`
- **Sprint 29 Artifacts:** `planning/sprint-29-49pmm9/`
