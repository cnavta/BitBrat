# Technical Architecture: Platform Utilities - Counters & Bidding

**Sprint**: sprint-27-6tp11t
**Author**: Claude (Architect)
**Date**: 2026-08-26
**Status**: Draft

---

## Executive Summary

This document defines the technical architecture for two related platform utilities that enable common streaming features: **Counters** (tracking arbitrary numeric values) and **Bidding** (collecting and aggregating user submissions). Both are implemented as MCP tools within a new `utility-service` Bit, leveraging Redis for ephemeral state and PostgreSQL for persistent metadata and historical tracking.

**Key Design Principles:**
- **Simple > Complex**: Two focused solutions rather than one overengineered system
- **LLM-Friendly**: Intuitive key naming and tool signatures for agent-driven workflows
- **Scoping Flexibility**: Support stream/session/global/user contexts without configuration overhead
- **Event-Driven Integration**: Natural composition with reflexes, routing slips, and agent flows

---

## 1. Problem Statement

### Use Cases

**Counters:**
- "4 deaths this stream!" - increment on specific events
- "10 crashes this patch!" - scoped to a time period
- Per-user counters (e.g., message count, contribution tracking)
- Global counters (e.g., community milestones)

**Bidding:**
- `!bid 432` - users submit numeric guesses
- Find MAX bid, MIN bid, or closest to target value
- Aggregate distributions from chat participation
- Session-scoped collection (e.g., "bidding closes in 5 minutes")

### Requirements

**Functional:**
1. Increment/decrement counters by arbitrary amounts
2. Retrieve current counter values
3. Submit user bids with values
4. Aggregate bid submissions (max, min, closest to X)
5. Scope management (stream, session, global, user-specific)
6. Time-based expiration (TTL for ephemeral counters/bids)
7. Persistent metadata for counter/bid definitions
8. LLM-accessible via MCP tools

**Non-Functional:**
1. Low latency (<50ms for counter operations)
2. Concurrent access support (multiple users bidding simultaneously)
3. Historical tracking (optional, for analytics)
4. Graceful degradation (fail-open if Redis unavailable)

---

## 2. Architecture Overview

### 2.1 Service Design

**New Bit: `utility-service`**

```yaml
# architecture.yaml
services:
  utility-service:
    profile: mcp-server
    category: platform
    stage: react
    kind: mcp-server
    port: 3015
    mcp:
      exposure: platform+domain
      description: "Platform utilities: counters, bidding, etc."
    topics:
      consumes:
        - internal.stream.lifecycle.v1  # Auto-scope to stream sessions
      produces:
        - internal.utility.counter.v1   # Counter change events (optional)
        - internal.utility.bid.v1       # Bid submission events (optional)
    env:
      - REDIS_URL
      - DATABASE_URL
      - COUNTER_DEFAULT_TTL_SECONDS
      - BID_SESSION_DEFAULT_TTL_SECONDS
    secrets: []
```

**Profile Rationale:**
- `mcp-server`: Primary function is exposing MCP tools
- `platform+domain`: Tools should be accessible both to platform bits and domain LLM agents
- `stage: react`: Counters/bids often result from user actions (mutations)

### 2.2 Storage Strategy

**Redis (Ephemeral State):**
- Counter values (fast increment/get operations)
- Active bid session entries (in-memory aggregation)
- TTL enforcement (automatic expiration)
- Key pattern: `{entity}:{scope}:{identifier}:{variant?}`

**PostgreSQL (Persistent Metadata):**
- Counter definitions (name, scope type, TTL, metadata)
- Bid session metadata (name, scope, target value, created/expired timestamps)
- Historical tracking (optional: counter snapshots, bid results)

**Hybrid Approach:**
- Write counter increments to Redis (low latency)
- Periodic snapshots to Postgres (historical tracking)
- Metadata always in Postgres (queryable, survives restarts)

---

## 3. Counters Design

### 3.1 Data Model

**Counter Metadata (PostgreSQL):**

```sql
CREATE TABLE counter_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(50) NOT NULL CHECK (scope_type IN ('global', 'stream', 'user', 'session', 'custom')),
  scope_value VARCHAR(255),  -- e.g., user ID, stream ID, session ID
  ttl_seconds INTEGER,        -- NULL = no expiration
  metadata JSONB,             -- Extensible: { description, icon, category, ... }
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,       -- Computed: created_at + ttl_seconds
  created_by VARCHAR(255),    -- User/service that created it

  UNIQUE(name, scope_type, scope_value)
);

CREATE INDEX idx_counter_scope ON counter_definitions(scope_type, scope_value);
CREATE INDEX idx_counter_expiration ON counter_definitions(expires_at) WHERE expires_at IS NOT NULL;
```

**Counter Values (Redis):**

```
Key Pattern: counter:{scope_type}:{scope_value}:{name}
Value: Integer (Redis INCR/DECR)
TTL: Set from counter_definitions.ttl_seconds

Examples:
  counter:global:*:total_messages       -> 1,234,567
  counter:stream:bitbrat:deaths         -> 4
  counter:user:alice:contributions      -> 42
  counter:session:abc123:crashes        -> 10
```

**Historical Snapshots (PostgreSQL - Optional):**

```sql
CREATE TABLE counter_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_id UUID REFERENCES counter_definitions(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,
  snapshot_at TIMESTAMP DEFAULT NOW(),
  trigger VARCHAR(50)  -- 'periodic', 'manual', 'expiration'
);

CREATE INDEX idx_snapshot_counter ON counter_snapshots(counter_id, snapshot_at DESC);
```

### 3.2 Key Naming Strategy

**LLM-Friendly Patterns:**

The key naming strategy is designed to be both human-readable and LLM-parseable:

```
Syntax: counter:{scope_type}:{scope_value}:{name}

Scope Types:
  - global:*                   (platform-wide, no scope value needed)
  - stream:{channel_name}      (per-stream, resets on stream.offline)
  - user:{user_id}             (per-user, persistent)
  - session:{session_id}       (ephemeral, custom TTL)
  - custom:{custom_scope}      (flexible for future use cases)

Examples:
  counter:global:*:community_milestone
  counter:stream:bitbrat:deaths_this_stream
  counter:user:alice:total_messages_sent
  counter:session:patch-7-2:crashes_this_patch
```

**LLM Interaction Pattern:**

When an LLM needs to increment a counter, it can infer keys from context:

```typescript
// Agent receives event with identity and stream context
const key = `counter:stream:${event.ingress.source.channel}:deaths`;
await counter.increment({ key, by: 1 });
```

Alternatively, use simplified tool calls with scope inference:

```typescript
// LLM provides semantic name, platform infers scope from event context
await counter.increment({
  name: 'deaths',
  scope: 'stream',  // Auto-resolved to current stream from event.ingress
  by: 1
});
```

### 3.3 MCP Tool Definitions

**counter.create**

```typescript
{
  name: 'counter.create',
  description: 'Create a new counter with optional scope and TTL',
  inputSchema: z.object({
    name: z.string().describe('Counter name (e.g., "deaths", "crashes")'),
    scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).default('global'),
    scopeValue: z.string().optional().describe('Scope identifier (e.g., channel name, user ID). Inferred from context if omitted.'),
    ttlSeconds: z.number().optional().describe('Expiration time in seconds. Omit for persistent counter.'),
    initialValue: z.number().default(0),
    metadata: z.record(z.any()).optional().describe('Extensible metadata (description, category, etc.)')
  }),
  returns: {
    success: boolean,
    counterId: string,
    key: string,
    message: string
  }
}
```

**counter.increment**

```typescript
{
  name: 'counter.increment',
  description: 'Increment a counter by a specified amount',
  inputSchema: z.object({
    key: z.string().optional().describe('Full Redis key (e.g., "counter:stream:bitbrat:deaths"). Provide key OR (name + scope).'),
    name: z.string().optional(),
    scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
    scopeValue: z.string().optional(),
    by: z.number().default(1).describe('Amount to increment (default: 1, can be negative for decrement)')
  }),
  returns: {
    success: boolean,
    newValue: number,
    key: string
  }
}
```

**counter.get**

```typescript
{
  name: 'counter.get',
  description: 'Retrieve current counter value',
  inputSchema: z.object({
    key: z.string().optional(),
    name: z.string().optional(),
    scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
    scopeValue: z.string().optional()
  }),
  returns: {
    success: boolean,
    value: number,
    key: string,
    metadata: object  // From counter_definitions
  }
}
```

**counter.reset**

```typescript
{
  name: 'counter.reset',
  description: 'Reset counter to zero (or specified value)',
  inputSchema: z.object({
    key: z.string().optional(),
    name: z.string().optional(),
    scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
    scopeValue: z.string().optional(),
    toValue: z.number().default(0)
  }),
  returns: { success: boolean, key: string }
}
```

**counter.delete**

```typescript
{
  name: 'counter.delete',
  description: 'Delete counter definition and value',
  inputSchema: z.object({
    counterId: z.string().optional().describe('Counter UUID from counter_definitions'),
    key: z.string().optional()
  }),
  returns: { success: boolean }
}
```

**counter.list**

```typescript
{
  name: 'counter.list',
  description: 'List all counters matching scope filters',
  inputSchema: z.object({
    scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
    scopeValue: z.string().optional(),
    includeExpired: z.boolean().default(false)
  }),
  returns: {
    counters: Array<{
      id: string,
      name: string,
      key: string,
      value: number,
      scopeType: string,
      scopeValue: string,
      expiresAt: string | null
    }>
  }
}
```

### 3.4 Event-Driven Integration

**Auto-Scoping via Stream Lifecycle Events:**

The utility-service subscribes to `internal.stream.lifecycle.v1` to automatically manage stream-scoped counters:

```typescript
// utility-service.ts
await this.onMessage<StreamLifecycleEvent>(
  'internal.stream.lifecycle.v1',
  async (event, attrs, ctx) => {
    if (event.lifecycle === 'stream.online') {
      // Stream started - counters are ready (already created or auto-created)
      this.logger.info('Stream started', { channel: event.channel });
    }

    if (event.lifecycle === 'stream.offline') {
      // Stream ended - snapshot all stream-scoped counters before TTL expiration
      await this.snapshotStreamCounters(event.channel);

      // Optionally publish counter summary event
      await this.publish('internal.utility.counter.v1', {
        action: 'stream_summary',
        channel: event.channel,
        counters: await this.getStreamCounters(event.channel)
      });
    }

    await ctx.ack();
  }
);
```

**Reflex Integration Example:**

```yaml
# reflexes.yaml
- trigger: "!crash"
  action: increment_counter
  params:
    name: "crashes"
    scopeType: "session"
    scopeValue: "patch-7-2"  # Or dynamic from event context
    by: 1
  response: "💥 Crash #{counter.value} this patch!"
```

**Agent Flow Integration:**

```typescript
// In LLM bot or query-analyzer
const deathMentioned = /died|death|rip/i.test(event.message.text);

if (deathMentioned) {
  const result = await this.registry.getTool('counter.increment').execute({
    name: 'deaths',
    scopeType: 'stream',
    by: 1
  }, context);

  if (!result.isError) {
    const count = JSON.parse(result.content[0].text).newValue;
    this.logger.info('Death counter incremented', { count });
  }
}
```

---

## 4. Bidding Design

### 4.1 Data Model

**Bid Session Metadata (PostgreSQL):**

```sql
CREATE TABLE bid_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(50) NOT NULL CHECK (scope_type IN ('global', 'stream', 'session', 'custom')),
  scope_value VARCHAR(255),
  target_value NUMERIC,       -- Optional: for "closest to X" queries
  ttl_seconds INTEGER,
  metadata JSONB,             -- { description, rules, prize, ... }
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  closed_at TIMESTAMP,        -- Manual closure (before expiration)
  created_by VARCHAR(255),

  UNIQUE(name, scope_type, scope_value)
);

CREATE INDEX idx_bid_session_scope ON bid_sessions(scope_type, scope_value);
CREATE INDEX idx_bid_session_expiration ON bid_sessions(expires_at) WHERE expires_at IS NOT NULL;
```

**Bid Entries (PostgreSQL):**

```sql
CREATE TABLE bid_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES bid_sessions(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255),     -- Display name for results
  value NUMERIC NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,             -- { platform, correlation_id, ... }

  UNIQUE(session_id, user_id)  -- One bid per user per session (updates allowed)
);

CREATE INDEX idx_bid_entry_session ON bid_entries(session_id, submitted_at DESC);
CREATE INDEX idx_bid_entry_value ON bid_entries(session_id, value);
```

**Why PostgreSQL for Bids (not Redis)?**

- Need table structure for user->value mapping
- Query operations (MAX, MIN, ORDER BY for closest)
- Persistent results (don't want to lose bids on Redis restart)
- Concurrent writes (Postgres handles better than Redis lists)
- Can still use Redis for caching aggregates if needed

### 4.2 Key Naming Strategy (Session Identification)

Unlike counters, bidding uses **session IDs** rather than complex key patterns:

```
Session Naming: {scope_type}:{scope_value}:{name}

Examples:
  global:*:weekly_prediction
  stream:bitbrat:boss_hp_guess
  session:event-2026-08:raffle_entries
```

**LLM Interaction:**

```typescript
// Create bid session
await bid.create({
  name: 'boss_hp_guess',
  scopeType: 'stream',
  ttlSeconds: 3600,  // 1 hour
  targetValue: 1500,  // Boss has 1500 HP
  metadata: { prize: 'VIP status' }
});

// User submits bid via reflex: "!bid 432"
await bid.submit({
  session: 'stream:bitbrat:boss_hp_guess',  // Or just 'boss_hp_guess' with scope inference
  user: event.identity.userId,
  value: 432
});

// Agent queries for winner
const result = await bid.get_closest({
  session: 'boss_hp_guess',
  target: 1500
});
// Returns: { user: 'alice', value: 1499, difference: 1 }
```

### 4.3 MCP Tool Definitions

**bid.create**

```typescript
{
  name: 'bid.create',
  description: 'Create a new bid session for collecting user submissions',
  inputSchema: z.object({
    name: z.string().describe('Session name (e.g., "boss_hp_guess")'),
    scopeType: z.enum(['global', 'stream', 'session', 'custom']).default('stream'),
    scopeValue: z.string().optional(),
    ttlSeconds: z.number().optional().describe('Auto-close after N seconds'),
    targetValue: z.number().optional().describe('For "closest to X" queries'),
    metadata: z.record(z.any()).optional()
  }),
  returns: {
    success: boolean,
    sessionId: string,
    sessionKey: string
  }
}
```

**bid.submit**

```typescript
{
  name: 'bid.submit',
  description: 'Submit a bid value for a user (upserts if user already submitted)',
  inputSchema: z.object({
    session: z.string().describe('Session ID or name (with scope inference)'),
    user: z.string().describe('User identifier'),
    userName: z.string().optional().describe('Display name for results'),
    value: z.number().describe('Bid value'),
    metadata: z.record(z.any()).optional()
  }),
  returns: {
    success: boolean,
    entryId: string,
    previousValue: number | null
  }
}
```

**bid.get_max**

```typescript
{
  name: 'bid.get_max',
  description: 'Get the highest bid in a session',
  inputSchema: z.object({
    session: z.string()
  }),
  returns: {
    user: string,
    userName: string,
    value: number,
    submittedAt: string
  }
}
```

**bid.get_min**

```typescript
{
  name: 'bid.get_min',
  description: 'Get the lowest bid in a session',
  inputSchema: z.object({
    session: z.string()
  }),
  returns: {
    user: string,
    userName: string,
    value: number,
    submittedAt: string
  }
}
```

**bid.get_closest**

```typescript
{
  name: 'bid.get_closest',
  description: 'Get the bid closest to a target value',
  inputSchema: z.object({
    session: z.string(),
    target: z.number().optional().describe('Target value (defaults to session.target_value)')
  }),
  returns: {
    user: string,
    userName: string,
    value: number,
    difference: number,
    submittedAt: string
  }
}
```

**bid.get_all**

```typescript
{
  name: 'bid.get_all',
  description: 'Get all bids in a session, optionally sorted',
  inputSchema: z.object({
    session: z.string(),
    sortBy: z.enum(['value', 'submitted_at', 'user']).default('submitted_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().optional()
  }),
  returns: {
    entries: Array<{
      user: string,
      userName: string,
      value: number,
      submittedAt: string
    }>,
    count: number
  }
}
```

**bid.close**

```typescript
{
  name: 'bid.close',
  description: 'Manually close a bid session (prevents new submissions)',
  inputSchema: z.object({
    session: z.string()
  }),
  returns: {
    success: boolean,
    closedAt: string,
    finalCount: number
  }
}
```

**bid.delete**

```typescript
{
  name: 'bid.delete',
  description: 'Delete bid session and all entries',
  inputSchema: z.object({
    session: z.string()
  }),
  returns: { success: boolean, deletedEntries: number }
}
```

### 4.4 Event-Driven Integration

**Reflex Integration Example:**

```yaml
# reflexes.yaml
- trigger: "!bid {amount:number}"
  action: submit_bid
  params:
    session: "boss_hp_guess"  # Could be dynamic from context
    value: "{amount}"
  response: "✅ Bid recorded: {amount}! Current entries: {bid.count}"

- trigger: "!bidclose"
  action: close_bid_and_announce
  requires_role: moderator
  workflow:
    - bid.close({ session: "boss_hp_guess" })
    - bid.get_closest({ session: "boss_hp_guess" })
    - announce_winner
```

**Agent Flow Integration:**

```typescript
// LLM decides to start a bid session based on stream context
const gamePhase = event.annotations.find(a => a.kind === 'game_phase');

if (gamePhase?.value === 'boss_fight_started') {
  await this.registry.getTool('bid.create').execute({
    name: 'boss_hp_guess',
    scopeType: 'stream',
    ttlSeconds: 600,  // 10 minutes
    metadata: {
      description: 'Guess the boss HP!',
      prize: 'Winner gets VIP for the day'
    }
  }, context);

  // Announce to chat
  await this.next({
    ...event,
    message: { text: '🎯 Bidding open! Type !bid <number> to guess boss HP!' }
  });
}
```

---

## 5. Unified Concepts

### 5.1 Scoping Strategy

Both counters and bidding share the same scoping taxonomy:

| Scope Type | Use Case | Lifecycle | Example |
|------------|----------|-----------|---------|
| `global` | Platform-wide metrics | Persistent | Total messages ever sent |
| `stream` | Per-stream session | Resets on stream.offline | Deaths this stream |
| `user` | Per-user tracking | Persistent | User contribution count |
| `session` | Custom time-bounded | TTL-based | Crashes this patch/event |
| `custom` | Flexible/future | Configurable | Team-based, game-based, etc. |

**Scope Resolution Priority:**

1. Explicit `scopeValue` in tool call
2. Inferred from event context (e.g., `event.ingress.source.channel`)
3. Default to `global:*` if no context available

### 5.2 Common Metadata Schema

Both counter and bid definitions support extensible JSONB metadata:

```typescript
interface EntityMetadata {
  description?: string;       // Human-readable description
  category?: string;          // Grouping (e.g., 'gameplay', 'community')
  icon?: string;              // Emoji or icon identifier
  displayFormat?: string;     // Formatting hint (e.g., 'currency', 'percentage')
  tags?: string[];            // Searchable tags
  createdBy?: string;         // Service or user that created it
  [key: string]: any;         // Extensible for future use cases
}
```

### 5.3 TTL and Expiration

**Redis TTL (Counters):**
- Set via `EXPIRE` command when counter created
- Automatic cleanup by Redis
- Optionally snapshot to Postgres before expiration

**PostgreSQL Expiration (Bids):**
- `expires_at` column computed on creation
- Background job (cron or scheduler-service) periodically deletes expired sessions
- Grace period (e.g., 24 hours) before hard delete for audit/analytics

**Manual Closure:**
- `bid.close()` sets `closed_at` timestamp
- Prevents new submissions but preserves data until TTL expires

---

## 6. Implementation Plan

### 6.1 Service Structure

```
src/
  apps/
    utility-service.ts                # Main Bit entry point
  services/
    utility/
      counter-manager.ts              # Counter business logic
      bid-manager.ts                  # Bid business logic
      scope-resolver.ts               # Unified scope inference
      storage/
        redis-counter-store.ts        # Redis adapter for counters
        postgres-counter-store.ts     # Postgres adapter for metadata/snapshots
        postgres-bid-store.ts         # Postgres adapter for bids
      __tests__/
        counter-manager.test.ts
        bid-manager.test.ts
        scope-resolver.test.ts
```

### 6.2 Key Abstractions

**ScopeResolver:**

```typescript
interface ScopeContext {
  scopeType: ScopeType;
  scopeValue: string;
  resolvedFrom: 'explicit' | 'event' | 'default';
}

class ScopeResolver {
  resolve(
    params: { scopeType?: ScopeType; scopeValue?: string },
    event?: InternalEventV2
  ): ScopeContext {
    // Priority: explicit params > event context > global default
    if (params.scopeValue) {
      return {
        scopeType: params.scopeType || 'custom',
        scopeValue: params.scopeValue,
        resolvedFrom: 'explicit'
      };
    }

    if (event?.ingress?.source?.channel && params.scopeType === 'stream') {
      return {
        scopeType: 'stream',
        scopeValue: event.ingress.source.channel,
        resolvedFrom: 'event'
      };
    }

    if (event?.identity?.userId && params.scopeType === 'user') {
      return {
        scopeType: 'user',
        scopeValue: event.identity.userId,
        resolvedFrom: 'event'
      };
    }

    return {
      scopeType: 'global',
      scopeValue: '*',
      resolvedFrom: 'default'
    };
  }
}
```

**CounterManager:**

```typescript
class CounterManager {
  constructor(
    private redisStore: RedisCounterStore,
    private postgresStore: PostgresCounterStore,
    private scopeResolver: ScopeResolver
  ) {}

  async create(params: CreateCounterParams): Promise<CounterResult> {
    // 1. Create metadata in Postgres
    const definition = await this.postgresStore.createDefinition(params);

    // 2. Initialize value in Redis
    const key = this.buildKey(definition);
    await this.redisStore.set(key, params.initialValue || 0, definition.ttlSeconds);

    return { success: true, counterId: definition.id, key };
  }

  async increment(params: IncrementParams, event?: InternalEventV2): Promise<IncrementResult> {
    const key = params.key || this.resolveKey(params, event);
    const newValue = await this.redisStore.incr(key, params.by || 1);

    // Optionally publish event for observability
    await this.publishCounterEvent('incremented', key, newValue);

    return { success: true, newValue, key };
  }

  private buildKey(definition: CounterDefinition): string {
    return `counter:${definition.scopeType}:${definition.scopeValue}:${definition.name}`;
  }

  private resolveKey(params: any, event?: InternalEventV2): string {
    const scope = this.scopeResolver.resolve(params, event);
    return `counter:${scope.scopeType}:${scope.scopeValue}:${params.name}`;
  }
}
```

**BidManager:**

```typescript
class BidManager {
  constructor(
    private postgresStore: PostgresBidStore,
    private scopeResolver: ScopeResolver
  ) {}

  async create(params: CreateBidSessionParams): Promise<BidSessionResult> {
    const session = await this.postgresStore.createSession(params);
    return { success: true, sessionId: session.id, sessionKey: session.name };
  }

  async submit(params: SubmitBidParams): Promise<SubmitResult> {
    // Upsert (update if user already submitted)
    const entry = await this.postgresStore.upsertEntry(params);
    return {
      success: true,
      entryId: entry.id,
      previousValue: entry.previousValue
    };
  }

  async getClosest(params: GetClosestParams): Promise<BidEntry | null> {
    const session = await this.postgresStore.getSession(params.session);
    const target = params.target || session.targetValue;

    if (!target) {
      throw new Error('No target value specified');
    }

    // Query: ORDER BY ABS(value - target) ASC LIMIT 1
    return await this.postgresStore.getClosestEntry(session.id, target);
  }
}
```

### 6.3 Database Migrations

**Migration: 001_create_counter_tables.sql**

```sql
-- Counter definitions
CREATE TABLE counter_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(50) NOT NULL CHECK (scope_type IN ('global', 'stream', 'user', 'session', 'custom')),
  scope_value VARCHAR(255),
  ttl_seconds INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_by VARCHAR(255),

  UNIQUE(name, scope_type, scope_value)
);

CREATE INDEX idx_counter_scope ON counter_definitions(scope_type, scope_value);
CREATE INDEX idx_counter_expiration ON counter_definitions(expires_at) WHERE expires_at IS NOT NULL;

-- Counter snapshots (historical tracking)
CREATE TABLE counter_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_id UUID REFERENCES counter_definitions(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,
  snapshot_at TIMESTAMP DEFAULT NOW(),
  trigger VARCHAR(50)
);

CREATE INDEX idx_snapshot_counter ON counter_snapshots(counter_id, snapshot_at DESC);
```

**Migration: 002_create_bid_tables.sql**

```sql
-- Bid sessions
CREATE TABLE bid_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  scope_type VARCHAR(50) NOT NULL CHECK (scope_type IN ('global', 'stream', 'session', 'custom')),
  scope_value VARCHAR(255),
  target_value NUMERIC,
  ttl_seconds INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_by VARCHAR(255),

  UNIQUE(name, scope_type, scope_value)
);

CREATE INDEX idx_bid_session_scope ON bid_sessions(scope_type, scope_value);
CREATE INDEX idx_bid_session_expiration ON bid_sessions(expires_at) WHERE expires_at IS NOT NULL;

-- Bid entries
CREATE TABLE bid_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES bid_sessions(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255),
  value NUMERIC NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  UNIQUE(session_id, user_id)
);

CREATE INDEX idx_bid_entry_session ON bid_entries(session_id, submitted_at DESC);
CREATE INDEX idx_bid_entry_value ON bid_entries(session_id, value);
```

### 6.4 Configuration

**Environment Variables:**

```bash
# Redis (for counter values)
REDIS_URL=redis://localhost:6379

# PostgreSQL (for metadata and bids)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bitbrat

# Defaults
COUNTER_DEFAULT_TTL_SECONDS=86400      # 24 hours
BID_SESSION_DEFAULT_TTL_SECONDS=3600   # 1 hour

# Snapshots
ENABLE_COUNTER_SNAPSHOTS=true
SNAPSHOT_INTERVAL_SECONDS=300          # 5 minutes
```

**Feature Flags:**

```typescript
// Via fleet.flags MCP tool
ENABLE_COUNTER_TOOLS=true
ENABLE_BID_TOOLS=true
ENABLE_HISTORICAL_SNAPSHOTS=true
```

### 6.5 Testing Strategy

**Unit Tests:**
- CounterManager: create, increment, get, reset operations
- BidManager: create session, submit, aggregations (max/min/closest)
- ScopeResolver: context inference logic
- Storage adapters: Redis and Postgres adapters

**Integration Tests:**
- End-to-end MCP tool calls
- Concurrent bid submissions
- TTL expiration behavior
- Stream lifecycle integration (counters reset on stream.offline)

**Load Tests:**
- High-frequency counter increments (simulate chat spam)
- Concurrent bid submissions (100+ users simultaneously)
- Redis failover (graceful degradation)

---

## 7. Operational Considerations

### 7.1 Observability

**Metrics:**
- `counter.operations{operation=increment|get|reset}` - Counter tool call rates
- `counter.definitions.total` - Total defined counters
- `bid.operations{operation=submit|query}` - Bid tool call rates
- `bid.sessions.active` - Active bid sessions
- `redis.operations{command=incr|get}` - Redis operation latency

**Logs:**
- Counter creation: `{ level: 'info', event: 'counter.created', name, scope, key }`
- Bid submission: `{ level: 'info', event: 'bid.submitted', session, user, value }`
- Expiration: `{ level: 'debug', event: 'counter.expired', key, finalValue }`

**Alerts:**
- Redis unavailable (fail-open, but log warning)
- Postgres connection failures (critical for bids)
- Unexpectedly high counter increment rates (potential abuse)

### 7.2 Graceful Degradation

**Redis Failure (Counters):**
- Log error, return cached/default value
- Optionally fall back to Postgres-only mode (slower, but functional)
- Do not block event processing

**Postgres Failure (Metadata/Bids):**
- Counters: Redis values still work, metadata queries fail
- Bids: Critical failure, return error to LLM (cannot accept submissions without persistence)

### 7.3 Scalability

**Counter Hot Keys:**
- Global counters (`counter:global:*:total_messages`) are potential hot keys
- Mitigation: Use Redis pipelining, client-side batching, or sharding

**Bid Query Performance:**
- `get_closest` with large entry counts may be slow
- Mitigation: Index on `value`, limit session sizes, cache aggregates

**Horizontal Scaling:**
- utility-service is stateless (all state in Redis/Postgres)
- Can scale to multiple instances behind load balancer
- Redis Cluster for distributed counter storage (if needed)

---

## 8. Future Enhancements

### 8.1 Advanced Counter Features

**Leaderboards:**
- `counter.leaderboard({ category: 'user', limit: 10 })` - Top N users by counter value
- Requires indexing in Postgres or Redis Sorted Sets

**Decay/Reset Schedules:**
- Weekly/monthly auto-reset counters
- Integration with scheduler-service for cron-like behavior

**Counter Arithmetic:**
- `counter.add({ from: 'counter:a', to: 'counter:b' })` - Transfer values
- `counter.compare({ a, b })` - Comparison operations

### 8.2 Advanced Bid Features

**Blind Bidding:**
- Hide bid values until session closed
- Requires encrypted storage or deferred reveal

**Tiered Bidding:**
- Multiple winners (1st, 2nd, 3rd place)
- `bid.get_top_n({ session, n: 3 })`

**Statistical Aggregations:**
- Mean, median, standard deviation
- Distribution visualization data

### 8.3 Unified Analytics

**Cross-Entity Queries:**
- "Show all counters and bid sessions for stream X"
- `utility.get_session_summary({ scopeType: 'stream', scopeValue: 'bitbrat' })`

**Export:**
- `utility.export({ format: 'csv', entity: 'counters', filter: {...} })`
- Integration with data warehouse for long-term analytics

---

## 9. Security & Authorization

### 9.1 RBAC Integration

**Tool-Level Authorization:**

```typescript
// In utility-service MCP tool registration
this.registerToolWithContext(
  'counter.delete',
  'Delete a counter',
  deleteSchema,
  async (params, context) => {
    // Only moderators/admins can delete counters
    if (!context.userRoles.includes('moderator')) {
      return this.errorResult('Unauthorized: moderator role required');
    }
    return await this.counterManager.delete(params);
  },
  [] // No pack restrictions
);
```

**Scope-Based Permissions:**
- Users can only modify user-scoped counters for their own user ID
- Stream-scoped operations require moderator role
- Global-scoped operations require admin role

### 9.2 Input Validation

**Counter Increment Limits:**
- Max increment: ±1,000,000 per call (prevent abuse)
- Rate limiting: Max 100 increments per user per minute

**Bid Value Validation:**
- Numeric range constraints (e.g., 1-10000)
- Configurable per session in metadata

**Key/Name Sanitization:**
- Alphanumeric + underscores/hyphens only
- Max length: 255 characters
- No SQL injection vectors (parameterized queries)

---

## 10. Migration & Adoption

### 10.1 Deployment Phases

**Phase 1: Core Infrastructure (Sprint 27)**
- Implement utility-service Bit
- Counter tools (create, increment, get, delete)
- Basic PostgreSQL + Redis integration
- Unit + integration tests

**Phase 2: Bid Tools (Sprint 28?)**
- Bid session tools (create, submit, close)
- Aggregation queries (max, min, closest)
- Reflex integration examples

**Phase 3: Event Integration (Sprint 29?)**
- Stream lifecycle auto-scoping
- Historical snapshots
- Analytics dashboard

**Phase 4: Advanced Features (Backlog)**
- Leaderboards, decay schedules, blind bidding
- Unified analytics, export functionality

### 10.2 Backward Compatibility

**No Breaking Changes:**
- New service, no modifications to existing services
- Opt-in adoption via MCP tool calls
- Existing reflexes/agents unaffected

**Deprecation Plan:**
- If replacing existing counter implementations, mark old tools deprecated
- 3-sprint grace period before removal

---

## 11. Success Metrics

**Adoption:**
- Number of counters created within first week
- Number of bid sessions created within first week
- Percentage of streams using counter/bid features

**Performance:**
- Counter increment latency: p95 < 50ms
- Bid submission latency: p95 < 100ms
- Redis availability: > 99.9%

**Reliability:**
- Zero data loss incidents
- Graceful degradation during Redis outages
- No blocking errors in event processing pipeline

---

## 12. Open Questions & Decisions

### 12.1 Resolved Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Counter storage | Redis (values) + Postgres (metadata) | Redis for speed, Postgres for durability |
| Bid storage | PostgreSQL only | Table structure required, persistence critical |
| MCP exposure | platform+domain | Enable both reflexes and LLM agents |
| Scope taxonomy | 5 types (global/stream/user/session/custom) | Covers 90% of use cases, extensible |
| Key naming | Colon-delimited hierarchical | LLM-friendly, human-readable |

### 12.2 Open Questions

1. **Should counters publish events on increment?**
   - Pro: Enables real-time dashboards, cross-service reactions
   - Con: High volume (spam), potential performance impact
   - **Recommendation**: Optional flag, default off

2. **Should bid sessions auto-close on stream.offline?**
   - Pro: Natural lifecycle alignment
   - Con: May want bids to persist across streams
   - **Recommendation**: Configurable per session (`autoCloseOnStreamEnd: boolean`)

3. **Should we support counter arithmetic (add/subtract between counters)?**
   - Pro: Enables team-based counters, budget tracking
   - Con: Complexity, potential race conditions
   - **Recommendation**: Phase 4 enhancement

4. **Should utility-service be a monolith or split into counter-service + bid-service?**
   - Pro (split): Independent scaling, clearer boundaries
   - Con (split): Overhead of 2 services, shared scope resolution
   - **Recommendation**: Start monolith, split if usage diverges significantly

---

## 13. Conclusion

This architecture provides a **simple, flexible, and LLM-friendly** foundation for enabling arbitrary counters and bidding features on the BitBrat platform. Key strengths:

- **Composable**: MCP tools integrate naturally with reflexes, routing slips, and agent flows
- **Performant**: Redis for hot paths, Postgres for durable state
- **Scoped**: Flexible scoping supports global, stream, user, and custom contexts
- **Extensible**: Metadata schema and custom scopes allow for future use cases without architecture changes

**Recommended Next Steps:**
1. Review and approve this architecture document
2. Create implementation plan (break into tasks)
3. Implement Phase 1 (core counter tools + infrastructure)
4. Validate in agent-dev environment
5. Deploy to staging, gather feedback
6. Iterate on Phase 2 (bid tools) based on Phase 1 learnings

---

**Document Status**: Draft → Pending Review
**Next Review Date**: 2026-08-26 (today - awaiting user feedback)
**Approvers**: christophernavta (Product Owner), Claude (Architect)
