# Technical Architecture: Bidding System for Utility Service

**Author**: Claude (Lead Implementor)
**Date**: 2026-08-29
**Status**: Ready for Implementation
**Based On**: Sprint 27 Research (architecture-revision-v2.md)

---

## Executive Summary

This document specifies the technical architecture for implementing a **Bidding System** within the existing `utility-service` Bit. The bidding system enables users to submit numeric guesses in chat contexts, with LLM-driven aggregation queries (max, min, closest to target).

**Key Design Decisions**:
- ✅ **Hybrid Storage**: Redis Hashes (active sessions) + DocumentStore (metadata/results)
- ✅ **Platform Integration**: Extends existing `utility-service` with new MCP tools
- ✅ **Scope Reuse**: Leverages existing ScopeResolver from counter implementation
- ✅ **Fail-Open**: Graceful degradation if Redis unavailable

---

## 1. System Context

### 1.1 Current State

The `utility-service` Bit currently provides:
- ✅ **CounterManager**: Scoped counter management (Phase 1 - Complete)
- ✅ **ScopeResolver**: Auto-inference of scope from event context (Phase 1 - Complete)
- ✅ **DocumentStore Integration**: Metadata persistence (Phase 1 - Complete)
- ✅ **Redis Integration**: Fast value storage (Phase 1 - Complete)

**Implementation Status**:
- Service deployed to staging
- 54/54 tests passing
- 6 counter MCP tools registered
- Resources: `IDocumentStore` + `RedisClientType` available

### 1.2 Bidding System Scope

**New Components**:
- `BidManager` class (hybrid storage management)
- 8 new MCP tools (bid.*)
- 3 new DocumentStore collections
- Redis Hash structures for active sessions

**Reused Components**:
- Existing `ScopeResolver` (no changes needed)
- Existing resource initialization pattern
- Existing MCP tool registration pattern

---

## 2. Use Cases

### 2.1 Primary Use Cases

**UC1: Stream Event Prediction**
```
Scenario: Boss HP Guessing Game
1. LLM creates bid session: "Guess the boss's HP!" (target: 1500)
2. Users submit bids: !bid 1499, !bid 1350, !bid 1620
3. LLM queries closest bid to 1500
4. LLM announces winner and closes session
```

**UC2: Community Polls**
```
Scenario: Viewer Count Prediction
1. LLM creates session: "Guess peak viewers today"
2. Users submit guesses throughout stream
3. LLM queries max/min submissions
4. Session auto-closes on stream.offline
```

**UC3: Historical Analytics**
```
Scenario: Bid Distribution Analysis
1. Query past bid sessions by scope (stream:bitbrat)
2. Analyze winning bid patterns
3. Display leaderboard of most accurate predictors
```

### 2.2 Functional Requirements

| Requirement | Priority | Implementation |
|-------------|----------|----------------|
| **FR1**: Create scoped bid sessions | P0 | `bid.create` tool |
| **FR2**: Submit/update user bids | P0 | `bid.submit` tool (atomic upsert) |
| **FR3**: Query max bid | P0 | `bid.getMax` tool |
| **FR4**: Query min bid | P0 | `bid.getMin` tool |
| **FR5**: Query closest to target | P0 | `bid.getClosest` tool |
| **FR6**: List active sessions | P0 | `bid.list` tool |
| **FR7**: Close session with snapshot | P0 | `bid.close` tool |
| **FR8**: Query historical results | P1 | `bid.results` tool |
| **FR9**: TTL auto-expiration | P0 | Redis EXPIRE |
| **FR10**: Concurrent bid submissions | P0 | Redis Hash atomic operations |

### 2.3 Non-Functional Requirements

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| **NFR1**: Bid submission latency | <50ms | Redis HSET p99 |
| **NFR2**: Aggregation query latency | <100ms | Client-side sort p99 |
| **NFR3**: Concurrent users per session | 1000+ | Load test with 1000 users |
| **NFR4**: Session TTL accuracy | ±5 seconds | Redis EXPIRE validation |
| **NFR5**: Historical query performance | <500ms | DocumentStore query p95 |
| **NFR6**: Graceful degradation | 100% | Unit tests with null Redis |

---

## 3. Data Architecture

### 3.1 Storage Strategy Decision

**Evaluated Options**:
1. ❌ **Redis Hashes Only**: Fast but no persistence, limited queries
2. ❌ **DocumentStore Only**: Persistent but slower, no native TTL
3. ✅ **Hybrid Approach**: Redis for speed + DocumentStore for persistence

**Rationale**:
- Active bidding sessions need <50ms writes (Redis Hashes)
- Historical analytics need queryable persistence (DocumentStore)
- TTL enforcement needs native support (Redis EXPIRE)
- Multi-user aggregation needs atomic updates (Redis HSET)

### 3.2 DocumentStore Collections

#### Collection: `bid_sessions`

**Purpose**: Session metadata (persistent, queryable)

**Schema**:
```typescript
interface BidSession {
  id: string;                    // "{scope_type}:{scope_value}:{name}"
  name: string;                  // Session name (e.g., "boss_hp_guess")
  scopeType: 'global' | 'stream' | 'user' | 'session' | 'custom';
  scopeValue: string;            // Scope identifier (e.g., "bitbrat")
  targetValue?: number;          // Optional target for "closest" queries
  ttlSeconds?: number;           // Auto-expiration time (null = manual close)
  metadata: {                    // Extensible metadata
    description?: string;        // "Guess the boss HP!"
    rules?: string;              // "Closest guess wins"
    prize?: string;              // "100 channel points"
    icon?: string;               // "🎯"
    tags?: string[];             // ["gaming", "prediction"]
    [key: string]: any;
  };
  createdAt: string;             // ISO 8601 timestamp
  expiresAt?: string;            // Computed: createdAt + ttlSeconds
  closedAt?: string;             // Manual closure timestamp
  createdBy: string;             // User/service that created it
  status: 'active' | 'closed' | 'expired';
}
```

**Indexes** (PostgreSQL):
- Primary: `id` (unique)
- Query: `scopeType`, `scopeValue`, `status`, `createdAt`

**Example Document**:
```json
{
  "id": "stream:bitbrat:boss_hp_guess",
  "name": "boss_hp_guess",
  "scopeType": "stream",
  "scopeValue": "bitbrat",
  "targetValue": 1500,
  "ttlSeconds": 3600,
  "metadata": {
    "description": "Guess the boss HP!",
    "icon": "🎯"
  },
  "createdAt": "2026-08-29T10:00:00Z",
  "expiresAt": "2026-08-29T11:00:00Z",
  "closedAt": null,
  "createdBy": "llm-bot",
  "status": "active"
}
```

---

#### Collection: `bid_results`

**Purpose**: Historical session results (analytics, auditing)

**Schema**:
```typescript
interface BidResult {
  id: string;                    // "{session_id}:{closed_timestamp}"
  sessionId: string;             // Reference to bid_sessions.id
  closedAt: string;              // ISO 8601 timestamp
  totalEntries: number;          // Number of unique bidders
  winner?: {                     // Optional: computed winner
    userId: string;
    userName?: string;
    value: number;
    difference?: number;         // Distance to target (if applicable)
  };
  statistics: {                  // Aggregated stats
    max: number;
    min: number;
    mean: number;
    median: number;
    stdDev?: number;
  };
  allEntries: Array<{            // Full bid distribution
    userId: string;
    userName?: string;
    value: number;
    submittedAt: string;
  }>;
  metadata: {                    // Session-specific context
    scopeType: string;
    scopeValue: string;
    targetValue?: number;
    [key: string]: any;
  };
}
```

**Indexes** (PostgreSQL):
- Primary: `id` (unique)
- Query: `sessionId`, `closedAt`, `metadata.scopeType`, `metadata.scopeValue`

**Example Document**:
```json
{
  "id": "boss_hp_guess:1735470000000",
  "sessionId": "stream:bitbrat:boss_hp_guess",
  "closedAt": "2026-08-29T11:00:00Z",
  "totalEntries": 3,
  "winner": {
    "userId": "alice",
    "value": 1499,
    "difference": 1
  },
  "statistics": {
    "max": 1620,
    "min": 1350,
    "mean": 1489.67,
    "median": 1499
  },
  "allEntries": [
    { "userId": "alice", "value": 1499, "submittedAt": "2026-08-29T10:15:00Z" },
    { "userId": "bob", "value": 1350, "submittedAt": "2026-08-29T10:20:00Z" },
    { "userId": "charlie", "value": 1620, "submittedAt": "2026-08-29T10:25:00Z" }
  ],
  "metadata": {
    "scopeType": "stream",
    "scopeValue": "bitbrat",
    "targetValue": 1500
  }
}
```

---

#### Collection: `bid_leaderboard` (Future/Optional)

**Purpose**: Per-user accuracy tracking across sessions

**Schema** (Deferred to Phase 2):
```typescript
interface BidLeaderboardEntry {
  id: string;                    // "{scope_type}:{scope_value}:{user_id}"
  userId: string;
  userName?: string;
  scopeType: string;
  scopeValue: string;
  stats: {
    totalSessions: number;
    wins: number;
    avgDifference: number;
    bestGuess: {
      sessionId: string;
      difference: number;
      timestamp: string;
    };
  };
  updatedAt: string;
}
```

---

### 3.3 Redis Structures

#### Redis Hash: Active Bid Sessions

**Key Pattern**: `bid:session:{session_id}`

**Structure**:
```
Hash Key: bid:session:stream:bitbrat:boss_hp_guess
Hash Fields:
  _metadata → '{"targetValue":1500,"createdAt":"2026-08-29T10:00:00Z"}'
  user:alice → "1499"
  user:bob → "1350"
  user:charlie → "1620"
TTL: 3600 seconds (from session.ttlSeconds)
```

**Operations**:
```typescript
// Create session (metadata field)
await redis.hSet('bid:session:boss_hp_guess', '_metadata', JSON.stringify({
  targetValue: 1500,
  createdAt: new Date().toISOString()
}));
await redis.expire('bid:session:boss_hp_guess', 3600);

// Submit bid (atomic upsert)
await redis.hSet('bid:session:boss_hp_guess', 'user:alice', '1499');

// Get all bids
const allBids = await redis.hGetAll('bid:session:boss_hp_guess');
// Returns: { _metadata: '...', 'user:alice': '1499', ... }

// Get specific user bid
const aliceBid = await redis.hGet('bid:session:boss_hp_guess', 'user:alice');

// Count entries
const count = await redis.hLen('bid:session:boss_hp_guess') - 1; // -1 for _metadata

// Delete session (manual cleanup)
await redis.del('bid:session:boss_hp_guess');
```

**Why Hashes?**:
- ✅ Atomic upsert (user can update bid)
- ✅ Single Redis operation for all bids (`HGETALL`)
- ✅ TTL applies to entire session
- ✅ Natural data model (user → value mapping)
- ⚠️ No native sorting (client-side sort required)

---

### 3.4 Data Flow Diagrams

#### Create Session Flow
```
┌──────────┐  bid.create  ┌─────────────┐
│   LLM    │─────────────▶│ BidManager  │
└──────────┘              └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐          ┌─────────────┐
            │ DocumentStore│          │    Redis    │
            │              │          │             │
            │ bid_sessions │          │ HSET _meta  │
            │   (metadata) │          │ EXPIRE TTL  │
            └──────────────┘          └─────────────┘
```

#### Submit Bid Flow
```
┌──────────┐  bid.submit  ┌─────────────┐
│   User   │─────────────▶│ BidManager  │
└──────────┘              └──────┬──────┘
                                 │
                                 ▼
                          ┌─────────────┐
                          │    Redis    │
                          │             │
                          │ HSET user:X │
                          │   (atomic)  │
                          └─────────────┘
```

#### Close Session Flow
```
┌──────────┐  bid.close   ┌─────────────┐
│   LLM    │─────────────▶│ BidManager  │
└──────────┘              └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐          ┌─────────────┐
            │    Redis     │          │DocumentStore│
            │              │          │             │
            │  HGETALL     │──┐       │ bid_results │
            │  (snapshot)  │  │       │  (history)  │
            │              │  │       │             │
            │  DEL (opt)   │  │       │bid_sessions │
            └──────────────┘  │       │(closedAt)   │
                              │       └─────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Compute Stats   │
                    │ - max/min       │
                    │ - mean/median   │
                    │ - winner        │
                    └─────────────────┘
```

---

## 4. Component Design

### 4.1 BidManager Class

**Responsibilities**:
- Manage bid session lifecycle (create, close, expire)
- Handle user bid submissions (atomic upsert)
- Execute aggregation queries (max, min, closest)
- Snapshot results to DocumentStore
- Coordinate Redis + DocumentStore operations

**Dependencies**:
```typescript
export class BidManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,  // Reused from CounterManager
    private logger: Logger
  ) {}
}
```

**Public Methods**:
```typescript
interface BidManager {
  // Session Management
  create(params: CreateBidSessionParams): Promise<BidSessionResult>;
  close(params: CloseBidSessionParams): Promise<CloseBidSessionResult>;
  list(params: ListBidSessionsParams): Promise<BidSession[]>;

  // Bid Operations
  submit(params: SubmitBidParams): Promise<SubmitBidResult>;

  // Aggregation Queries
  getMax(params: GetMaxBidParams): Promise<BidEntry>;
  getMin(params: GetMinBidParams): Promise<BidEntry>;
  getClosest(params: GetClosestBidParams): Promise<BidEntry>;

  // Historical Queries
  getResults(params: GetBidResultsParams): Promise<BidResult[]>;
}
```

**Key Implementation Notes**:
- Use `scopeResolver.resolve()` for scope inference (same as counters)
- Atomic operations: `HSET` for bid submissions
- Client-side sorting for aggregation queries (Redis Hashes unordered)
- Fail-open pattern: Log error, return graceful error if Redis unavailable
- TTL enforcement: Redis `EXPIRE` on session creation

---

### 4.2 MCP Tool Specifications

All tools registered with `platform-only` exposure (accessible to LLM agents and platform bits).

#### 4.2.1 `bid.create`

**Description**: Create a new bid session with optional target value and TTL.

**Zod Schema**:
```typescript
const CreateBidSessionSchema = z.object({
  name: z.string().min(1).max(64),
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  targetValue: z.number().optional(),
  ttlSeconds: z.number().positive().optional(),
  metadata: z.record(z.any()).optional(),
  createdBy: z.string().optional(),
  event: z.any().optional()  // For scope auto-inference
});
```

**Example Request**:
```json
{
  "name": "boss_hp_guess",
  "targetValue": 1500,
  "ttlSeconds": 3600,
  "metadata": {
    "description": "Guess the boss HP!",
    "icon": "🎯"
  },
  "event": { "ingress": { "channel": "bitbrat" } }
}
```

**Example Response**:
```json
{
  "success": true,
  "sessionId": "stream:bitbrat:boss_hp_guess",
  "sessionKey": "bid:session:stream:bitbrat:boss_hp_guess",
  "expiresAt": "2026-08-29T11:00:00Z"
}
```

---

#### 4.2.2 `bid.submit`

**Description**: Submit or update a user's bid in an active session.

**Zod Schema**:
```typescript
const SubmitBidSchema = z.object({
  session: z.string(),          // Session ID or name
  user: z.string(),              // User ID
  userName: z.string().optional(),
  value: z.number(),
  metadata: z.record(z.any()).optional()
});
```

**Example Request**:
```json
{
  "session": "boss_hp_guess",
  "user": "alice",
  "userName": "Alice",
  "value": 1499
}
```

**Example Response**:
```json
{
  "success": true,
  "entryId": "stream:bitbrat:boss_hp_guess:alice",
  "previousValue": null,
  "newValue": 1499
}
```

---

#### 4.2.3 `bid.getMax`

**Description**: Get the highest bid in a session.

**Zod Schema**:
```typescript
const GetMaxBidSchema = z.object({
  session: z.string()
});
```

**Example Response**:
```json
{
  "success": true,
  "sessionId": "stream:bitbrat:boss_hp_guess",
  "userId": "charlie",
  "userName": "charlie",
  "value": 1620,
  "submittedAt": "2026-08-29T10:25:00Z"
}
```

---

#### 4.2.4 `bid.getMin`

**Description**: Get the lowest bid in a session.

**Zod Schema**:
```typescript
const GetMinBidSchema = z.object({
  session: z.string()
});
```

---

#### 4.2.5 `bid.getClosest`

**Description**: Get the bid closest to the target value.

**Zod Schema**:
```typescript
const GetClosestBidSchema = z.object({
  session: z.string(),
  target: z.number().optional()  // Override session.targetValue
});
```

**Example Response**:
```json
{
  "success": true,
  "sessionId": "stream:bitbrat:boss_hp_guess",
  "userId": "alice",
  "value": 1499,
  "difference": 1,
  "targetValue": 1500
}
```

---

#### 4.2.6 `bid.close`

**Description**: Close a session, snapshot results to DocumentStore, optionally delete Redis hash.

**Zod Schema**:
```typescript
const CloseBidSessionSchema = z.object({
  session: z.string(),
  computeWinner: z.boolean().default(true),
  deleteRedisHash: z.boolean().default(false)
});
```

**Example Response**:
```json
{
  "success": true,
  "sessionId": "stream:bitbrat:boss_hp_guess",
  "closedAt": "2026-08-29T11:00:00Z",
  "finalCount": 3,
  "winner": {
    "userId": "alice",
    "value": 1499,
    "difference": 1
  },
  "statistics": {
    "max": 1620,
    "min": 1350,
    "mean": 1489.67,
    "median": 1499
  }
}
```

---

#### 4.2.7 `bid.list`

**Description**: List active or historical bid sessions by scope.

**Zod Schema**:
```typescript
const ListBidSessionsSchema = z.object({
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  status: z.enum(['active', 'closed', 'expired']).optional(),
  limit: z.number().positive().default(50)
});
```

---

#### 4.2.8 `bid.results`

**Description**: Query historical bid results for analytics.

**Zod Schema**:
```typescript
const GetBidResultsSchema = z.object({
  sessionId: z.string().optional(),
  scopeType: z.string().optional(),
  scopeValue: z.string().optional(),
  limit: z.number().positive().default(50),
  orderBy: z.enum(['closedAt', 'totalEntries']).default('closedAt')
});
```

---

## 5. Error Handling

### 5.1 Error Scenarios

| Error | Cause | Mitigation |
|-------|-------|------------|
| **SessionNotFound** | Invalid session ID | Return MCP error with suggestion |
| **RedisUnavailable** | Redis connection lost | Fail-open: log error, return graceful error |
| **NoBidsFound** | Aggregation query on empty session | Return error with count = 0 |
| **TTLExpired** | Session expired before close | Return error, suggest query bid_results |
| **DuplicateSession** | Session ID collision | Append timestamp suffix |
| **InvalidTarget** | Non-numeric target value | Validate in Zod schema |

### 5.2 Fail-Open Strategy

```typescript
async submit(params: SubmitBidParams): Promise<SubmitBidResult> {
  try {
    const hashKey = `bid:session:${params.session}`;
    await this.redis.hSet(hashKey, `user:${params.user}`, String(params.value));
    return { success: true, entryId: `${params.session}:${params.user}` };
  } catch (error) {
    this.logger.error('bid.submit.failed', { error, params });

    // Fail-open: Return error but don't crash service
    return {
      success: false,
      error: 'Redis unavailable - bid not recorded',
      code: 'REDIS_ERROR'
    };
  }
}
```

---

## 6. Performance Considerations

### 6.1 Latency Targets

| Operation | Target (p99) | Redis Op | Complexity |
|-----------|--------------|----------|------------|
| `bid.submit` | <50ms | HSET | O(1) |
| `bid.getMax` | <100ms | HGETALL + sort | O(n log n) |
| `bid.getMin` | <100ms | HGETALL + sort | O(n log n) |
| `bid.getClosest` | <100ms | HGETALL + sort | O(n log n) |
| `bid.close` | <200ms | HGETALL + DocStore write | O(n log n) |
| `bid.list` | <500ms | DocumentStore query | O(n) |

### 6.2 Scalability Analysis

**Small Sessions** (<100 users):
- Redis `HGETALL` ~1ms
- Client-side sort ~1ms
- Total: <5ms (well under target)

**Medium Sessions** (100-1000 users):
- Redis `HGETALL` ~5-10ms
- Client-side sort ~10-20ms
- Total: <50ms (acceptable)

**Large Sessions** (1000+ users):
- Redis `HGETALL` ~20-50ms
- Client-side sort ~50-100ms
- Total: <150ms (acceptable for rare use case)

**Recommendation**: Hybrid approach handles 1000+ users efficiently. For 10k+ users, consider Redis Sorted Sets (future optimization).

---

## 7. Testing Strategy

### 7.1 Unit Tests

**BidManager Tests** (20+ tests):
- Session creation (with/without TTL)
- Bid submission (new + update)
- Aggregation queries (max, min, closest)
- Session close (snapshot logic)
- Error handling (null Redis, invalid params)
- Scope resolution (all types)

**Mock Strategy**:
- Mock `IDocumentStore` (in-memory map)
- Mock `RedisClientType` (in-memory hash)
- Real `ScopeResolver` (no mocks)

### 7.2 Integration Tests

**Agent-Dev Scenarios**:
1. Deploy utility-service with bidding enabled
2. Create session via `bid.create`
3. Submit 10 bids from different users
4. Query max/min/closest
5. Close session
6. Verify DocumentStore snapshot
7. Verify Redis hash deleted (if configured)

**Multi-User Concurrency Test**:
- Provision agent-dev context
- Simulate 100 concurrent `bid.submit` calls
- Verify all bids recorded (no lost writes)
- Verify Redis Hash integrity

### 7.3 Load Tests

**Scenario**: 1000 users submit bids in 60 seconds
- Submit rate: ~17 bids/second
- Expected Redis load: <5% CPU
- Expected latency: p99 <50ms

---

## 8. Security Considerations

### 8.1 Input Validation

- ✅ Session name: Max 64 chars, alphanumeric + underscore
- ✅ Bid value: Number validation via Zod
- ✅ User ID: String validation, no SQL injection risk
- ✅ TTL: Max 7 days (604800 seconds)

### 8.2 Authorization

- Session creation: Platform-only (LLM agents + platform bits)
- Bid submission: User-scoped (validate `userId` matches identity)
- Aggregation queries: Public (read-only)
- Session close: Platform-only (admin/LLM control)

### 8.3 Rate Limiting

**Future Enhancement** (not in Phase 1):
- Per-user bid submission: 1 bid/second
- Per-session bid submission: 100 bids/second
- Aggregation queries: 10 queries/second

---

## 9. Deployment Considerations

### 9.1 Architecture.yaml Updates

**No Changes Required** - Bidding extends existing `utility-service`:
```yaml
services:
  utility:
    profile: core
    kind: pipeline-service
    mcp:
      exposure: platform-only
      capabilities:
        - counters
        - bidding  # Already declared in Phase 1
    resources:
      - documentStore
      - redis
```

### 9.2 Database Migrations

**DocumentStore Collections** (auto-created on first write):
- `bid_sessions` (no schema enforcement, JSONB)
- `bid_results` (no schema enforcement, JSONB)

**No SQL Migrations Required** (using DocumentStore abstraction).

### 9.3 Redis Configuration

**No Changes Required** - Uses existing Redis connection from Phase 1.

**Memory Estimation**:
- 1 session with 1000 users ~50KB (Redis Hash)
- 100 active sessions ~5MB
- Well within typical Redis capacity

---

## 10. Monitoring & Observability

### 10.1 Metrics

**Custom Metrics** (to be added):
```typescript
// Bid submission metrics
bid.submit.count (counter)
bid.submit.duration (histogram)
bid.submit.errors (counter)

// Session metrics
bid.session.active.count (gauge)
bid.session.closed.count (counter)
bid.session.entries.histogram (histogram)

// Aggregation metrics
bid.query.max.duration (histogram)
bid.query.min.duration (histogram)
bid.query.closest.duration (histogram)
```

### 10.2 Logging

**Structured Logs**:
```typescript
// Session creation
this.logger.info('bid.session.created', {
  sessionId,
  scopeType,
  scopeValue,
  ttlSeconds
});

// Bid submission
this.logger.info('bid.submitted', {
  sessionId,
  userId,
  value,
  previousValue
});

// Session close
this.logger.info('bid.session.closed', {
  sessionId,
  totalEntries,
  winner,
  closedAt
});
```

### 10.3 Health Checks

**Existing Health Endpoint** (`/healthz`):
- Already includes Redis health check
- Already includes DocumentStore health check
- No changes needed

---

## 11. Future Enhancements

### 11.1 Phase 2 Features (Backlog)

**Leaderboards**:
- Track per-user accuracy across sessions
- Redis Sorted Sets for live rankings
- `bid.leaderboard` MCP tool

**Blind Bidding**:
- Hide bids until session close
- Encrypted values in Redis
- Reveal on close

**Bid Ranges**:
- Validate bids within min/max constraints
- Reject out-of-range submissions

**Event Integration**:
- Auto-close sessions on `stream.offline`
- Auto-scope from `internal.stream.lifecycle.v1`

### 11.2 Performance Optimizations

**Redis Sorted Sets** (for very large sessions):
- Replace Hashes with Sorted Sets
- Native Redis sorting (no client-side sort)
- Trades upsert simplicity for query speed

**Caching**:
- Cache session metadata in memory
- Reduce DocumentStore reads for active sessions

---

## 12. References

### 12.1 Sprint 27 Artifacts

- **Architecture Spec**: `planning/sprint-27-6tp11t/architecture-revision-v2.md`
- **Execution Plan**: `planning/sprint-27-6tp11t/execution-plan.md`
- **Backlog**: `planning/sprint-27-6tp11t/backlog.yaml`
- **Technical Architecture**: `planning/sprint-27-6tp11t/technical-architecture.md`

### 12.2 Platform Documentation

- **IDocumentStore**: `src/common/persistence/interfaces.ts:44-97`
- **RedisManager**: `src/common/resources/redis-manager.ts`
- **Bit Base Class**: `src/common/base-server.ts`
- **Claim Check Pattern**: `src/apps/claim-check-service.ts` (similar hybrid storage)
- **Platform Flow**: `documentation/concepts/platform-flow.md`

### 12.3 Existing Implementation

- **CounterManager**: `src/services/utility/counter-manager.ts`
- **ScopeResolver**: `src/services/utility/scope-resolver.ts`
- **Utility Service**: `src/apps/utility-service.ts`

---

## 13. Approval & Sign-Off

**Architect**: Claude (Lead Implementor)
**Date**: 2026-08-29

**Ready for Implementation**: ✅

**Next Step**: Proceed to Execution Plan creation.
