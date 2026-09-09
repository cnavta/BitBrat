# Utility Service: Technical Architecture

**Service**: utility-service
**Sprint**: sprint-27-6tp11t
**Category**: Platform
**Profile**: Core
**Last Updated**: 2026-08-27

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Hybrid Storage Strategy](#hybrid-storage-strategy)
4. [Data Models](#data-models)
5. [Scope Resolution](#scope-resolution)
6. [Service Components](#service-components)
7. [Sequence Diagrams](#sequence-diagrams)
8. [Design Decisions](#design-decisions)
9. [Performance Characteristics](#performance-characteristics)
10. [Security Considerations](#security-considerations)
11. [Future Enhancements](#future-enhancements)

---

## Overview

The utility-service provides **platform utilities** for arbitrary counter management and bidding session management (Phase 2). It implements a **hybrid storage model** that combines Redis for hot-path operations with DocumentStore for persistent, queryable metadata.

### Service Metadata

```yaml
Service: utility
Category: platform
Profile: core
Kind: pipeline-service
Port: 3020
MCP Exposure: platform-only
Stateful: false
```

### Capabilities

**Phase 1** (Sprint 27):
- ✅ Counter creation with metadata
- ✅ Atomic increment/decrement operations
- ✅ TTL-based expiration
- ✅ Scope-based isolation (global, stream, user, session, custom)
- ✅ Historical snapshots
- ✅ Queryable metadata

**Phase 2** (Future):
- ⏳ Bidding session management
- ⏳ Multi-user bid aggregation
- ⏳ Bid result queries (max, min, closest)

---

## Architecture Principles

### 1. Hybrid Storage (Hot/Cold Separation)

**Design Goal**: Optimize for both performance (fast updates) and queryability (rich metadata).

```
┌─────────────────────────────────────────────────────────────┐
│                    Utility Service                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                  ┌────────────────┐   │
│  │ CounterManager  │                  │ ScopeResolver  │   │
│  └────────┬────────┘                  └────────┬───────┘   │
│           │                                    │           │
│           │ Hot Path (values)                  │           │
│           ├────────────────┐                   │           │
│           │                │                   │           │
│           ▼                ▼                   ▼           │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │    Redis    │  │ DocumentStore   │  │ Event Context│   │
│  │             │  │  (PostgreSQL)   │  │              │   │
│  │ - Values    │  │ - Metadata      │  │ - Channel ID │   │
│  │ - TTL       │  │ - Definitions   │  │ - User ID    │   │
│  │ - INCR/DECR │  │ - Snapshots     │  │ - Session ID │   │
│  └─────────────┘  └─────────────────┘  └──────────────┘   │
│   Fast, Atomic     Persistent, Queryable                    │
└─────────────────────────────────────────────────────────────┘
```

**Why Hybrid?**

| Requirement | Solution | Storage |
|------------|----------|---------|
| Fast increments | Atomic Redis INCR/DECR | Redis |
| Sub-millisecond reads | Redis GET | Redis |
| Automatic expiration | Redis EXPIRE | Redis |
| Rich metadata queries | DocumentStore filters | PostgreSQL |
| Historical snapshots | DocumentStore persistence | PostgreSQL |
| Cross-counter queries | DocumentStore indexes | PostgreSQL |

### 2. Fail-Open Pattern

**Design Goal**: Service remains available even when dependencies are degraded.

```typescript
// Lazy resource initialization
private ensureCounterManager(): CounterManager | null {
  if (!this.docStore || !this.redis) {
    this.logger.debug('Resources not ready');
    return null;  // Fail-open: return null, don't throw
  }
  return new CounterManager(...);
}
```

**Graceful Degradation**:
- Redis unavailable → Return error, don't crash
- DocumentStore unavailable → Return error, don't crash
- Partial availability → Serve what's possible

### 3. Scope-Based Isolation

**Design Goal**: Counters are isolated by scope to prevent collisions and enable automatic lifecycle management.

**Key Format**: `counter:{scopeType}:{scopeValue}:{name}`

```
counter:global:global:messages_processed
counter:stream:bitbrat:deaths
counter:user:user_123:points
counter:session:auction_001:total_bids
counter:custom:team_alpha:wins
```

**Benefits**:
- ✅ No name collisions across scopes
- ✅ Automatic cleanup when scope expires
- ✅ Query all counters for a scope
- ✅ Clear ownership and lifecycle

---

## Hybrid Storage Strategy

### Redis (Hot Path)

**Purpose**: Fast, atomic counter values with automatic TTL expiration.

**Operations**:
```typescript
// Create counter
await redis.set(key, String(initialValue));
await redis.expire(key, ttlSeconds);

// Atomic increment
const newValue = await redis.incrBy(key, delta);

// Atomic decrement
const newValue = await redis.decrBy(key, delta);

// Get value
const value = await redis.get(key);

// Delete
await redis.del(key);
```

**Key Patterns**:
```
counter:{scopeType}:{scopeValue}:{name}
```

**Examples**:
```
counter:stream:bitbrat:deaths → "42"
counter:user:user_123:points → "1500"
counter:global:global:messages_processed → "1000000"
```

**TTL Behavior**:
- TTL set on counter creation via `EXPIRE`
- Redis automatically deletes key when TTL expires
- No manual cleanup required for expired counters

### DocumentStore (Cold Path)

**Purpose**: Persistent, queryable metadata and historical snapshots.

**Collections**:
1. `counter_definitions` - Counter metadata
2. `counter_snapshots` - Historical snapshots

#### Collection: counter_definitions

**Schema**:
```typescript
interface CounterDefinition {
  id: string;                    // Format: {scopeType}:{scopeValue}:{name}
  name: string;                  // Counter name (unique within scope)
  scopeType: ScopeType;          // 'global' | 'stream' | 'user' | 'session' | 'custom'
  scopeValue: string;            // Scope identifier
  ttlSeconds?: number;           // TTL in seconds (optional)
  metadata: Record<string, any>; // Arbitrary metadata
  createdAt: string;             // ISO 8601 timestamp
  expiresAt?: string;            // ISO 8601 timestamp (if TTL set)
  createdBy: string;             // Creator identifier
}
```

**Example Document**:
```json
{
  "id": "stream:bitbrat:deaths",
  "name": "deaths",
  "scopeType": "stream",
  "scopeValue": "bitbrat",
  "ttlSeconds": 14400,
  "metadata": {
    "description": "Player deaths in current stream",
    "icon": "💀",
    "game": "Elden Ring",
    "difficulty": "NG+7"
  },
  "createdAt": "2026-08-27T10:00:00Z",
  "expiresAt": "2026-08-27T14:00:00Z",
  "createdBy": "llm-bot"
}
```

**Indexes** (recommended):
```sql
CREATE INDEX idx_counter_definitions_scope ON counter_definitions (scopeType, scopeValue);
CREATE INDEX idx_counter_definitions_expires ON counter_definitions (expiresAt);
CREATE INDEX idx_counter_definitions_created ON counter_definitions (createdAt);
```

**Queries**:
```typescript
// List all counters for a stream
await docStore.query('counter_definitions', {
  filters: [
    { field: 'scopeType', operator: '==', value: 'stream' },
    { field: 'scopeValue', operator: '==', value: 'bitbrat' }
  ]
});

// List active counters (not expired)
await docStore.query('counter_definitions', {
  filters: [
    { field: 'expiresAt', operator: '>', value: new Date().toISOString() }
  ]
});
```

#### Collection: counter_snapshots

**Schema**:
```typescript
interface CounterSnapshot {
  id: string;          // UUID
  counterId: string;   // Reference to counter definition
  value: number;       // Counter value at snapshot time
  snapshotAt: string;  // ISO 8601 timestamp
  trigger: 'periodic' | 'manual' | 'expiration' | 'stream_end';
}
```

**Example Document**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "counterId": "stream:bitbrat:deaths",
  "value": 42,
  "snapshotAt": "2026-08-27T14:00:00Z",
  "trigger": "stream_end"
}
```

**Indexes** (recommended):
```sql
CREATE INDEX idx_counter_snapshots_counter ON counter_snapshots (counterId);
CREATE INDEX idx_counter_snapshots_time ON counter_snapshots (snapshotAt);
```

**Queries**:
```typescript
// Get all snapshots for a counter
await docStore.query('counter_snapshots', {
  filters: [
    { field: 'counterId', operator: '==', value: 'stream:bitbrat:deaths' }
  ],
  orderBy: { field: 'snapshotAt', direction: 'desc' }
});
```

---

## Scope Resolution

### ScopeResolver Component

**Purpose**: Resolve `scopeType` and `scopeValue` from explicit parameters or event context.

**Resolution Priority** (4 levels):

```typescript
class ScopeResolver {
  resolve(params: ScopeParams): ScopeResult {
    // Priority 1: Explicit scope parameters
    if (params.scopeType && params.scopeValue) {
      return { scopeType: params.scopeType, scopeValue: params.scopeValue };
    }

    // Priority 2: Explicit type + inferred value
    if (params.scopeType && params.event) {
      const scopeValue = this.inferScopeValue(params.scopeType, params.event);
      return { scopeType: params.scopeType, scopeValue };
    }

    // Priority 3: Auto-infer both from event
    if (params.event) {
      return this.inferFromEvent(params.event);
    }

    // Priority 4: Default to global
    return { scopeType: 'global', scopeValue: 'global' };
  }
}
```

### Auto-Inference Logic

```typescript
private inferFromEvent(event: InternalEventV2): ScopeResult {
  // Priority 1: Stream scope (if channel available)
  if (event.ingress?.channel) {
    return {
      scopeType: 'stream',
      scopeValue: event.ingress.channel
    };
  }

  // Priority 2: User scope (if user ID available)
  const userId = event.identity?.user?.id || event.identity?.external?.id;
  if (userId) {
    return {
      scopeType: 'user',
      scopeValue: userId
    };
  }

  // Priority 3: Global scope (fallback)
  return { scopeType: 'global', scopeValue: 'global' };
}
```

### Inference Rules Table

| Event Field | Scope Type | Scope Value |
|------------|------------|-------------|
| `event.ingress.channel` | `stream` | `event.ingress.channel` |
| `event.identity.user.id` | `user` | `event.identity.user.id` |
| `event.identity.external.id` | `user` | `event.identity.external.id` |
| None | `global` | `"global"` |

**Channel > User ID > External ID > Global**

---

## Service Components

### 1. UtilityService (Bit Entry Point)

**File**: `src/apps/utility-service.ts`

**Responsibilities**:
- Extend `Bit` base class
- Initialize resources (DocumentStore, Redis)
- Register MCP tools
- Provide health check endpoint

**Key Methods**:
```typescript
class UtilityService extends Bit {
  private async setup(): Promise<void> {
    this.setupResources();
    this.registerCounterTools();
  }

  private ensureCounterManager(): CounterManager | null {
    // Lazy initialization with fail-open
  }

  public async healthCheck(): Promise<HealthResult> {
    // Verify DocumentStore and Redis connectivity
  }
}
```

### 2. CounterManager

**File**: `src/services/utility/counter-manager.ts`

**Responsibilities**:
- Implement all counter operations
- Coordinate Redis and DocumentStore writes
- Enforce TTL via Redis EXPIRE
- Create historical snapshots

**Key Methods**:
```typescript
class CounterManager {
  async create(params: CreateCounterParams): Promise<CounterResult>
  async increment(params: IncrementParams): Promise<IncrementResult>
  async decrement(params: DecrementParams): Promise<DecrementResult>
  async get(params: GetCounterParams): Promise<GetCounterResult>
  async set(params: SetCounterParams): Promise<SetCounterResult>
  async delete(params: DeleteCounterParams): Promise<DeleteCounterResult>
  async list(params: ListCountersParams): Promise<CounterDefinition[]>
  async snapshot(params: SnapshotCounterParams): Promise<SnapshotCounterResult>

  private async resolveKey(params): Promise<string>
}
```

### 3. ScopeResolver

**File**: `src/services/utility/scope-resolver.ts`

**Responsibilities**:
- Resolve scope from parameters and event context
- Validate scope types
- Build counter IDs and Redis keys

**Key Methods**:
```typescript
class ScopeResolver {
  resolve(params: ScopeParams): ScopeResult
  buildId(scope: ScopeResult, name: string): string
  buildKey(prefix: string, scope: ScopeResult, name: string): string

  private inferFromEvent(event: InternalEventV2): ScopeResult
  private inferScopeValue(scopeType: ScopeType, event: InternalEventV2): string
  private validateScopeType(scopeType: ScopeType): void
}
```

---

## Sequence Diagrams

### Sequence 1: Create Counter

```
┌─────┐          ┌──────────────┐    ┌────────────────┐    ┌───────┐    ┌──────────────┐
│ LLM │          │ToolGateway   │    │UtilityService  │    │ Redis │    │DocumentStore │
└──┬──┘          └──────┬───────┘    └────────┬───────┘    └───┬───┘    └──────┬───────┘
   │                    │                     │                │                │
   │ counter.create()   │                     │                │                │
   ├───────────────────>│                     │                │                │
   │                    │                     │                │                │
   │                    │ create(params)      │                │                │
   │                    ├────────────────────>│                │                │
   │                    │                     │                │                │
   │                    │              resolve scope           │                │
   │                    │              build ID/key            │                │
   │                    │                     │                │                │
   │                    │                     │ get(definition)│                │
   │                    │                     ├───────────────────────────────>│
   │                    │                     │<───────────────────────────────┤
   │                    │                     │   (check exists)               │
   │                    │                     │                │                │
   │                    │                     │ set(definition)│                │
   │                    │                     ├───────────────────────────────>│
   │                    │                     │                │                │
   │                    │                     │ SET key value  │                │
   │                    │                     ├───────────────>│                │
   │                    │                     │                │                │
   │                    │                     │ EXPIRE key ttl │                │
   │                    │                     ├───────────────>│                │
   │                    │                     │                │                │
   │                    │<────────────────────┤                │                │
   │                    │   CounterResult     │                │                │
   │                    │                     │                │                │
   │<───────────────────┤                     │                │                │
   │  { counterId, key }│                     │                │                │
   │                    │                     │                │                │
```

### Sequence 2: Increment Counter

```
┌─────┐          ┌──────────────┐    ┌────────────────┐    ┌───────┐
│ LLM │          │ToolGateway   │    │UtilityService  │    │ Redis │
└──┬──┘          └──────┬───────┘    └────────┬───────┘    └───┬───┘
   │                    │                     │                │
   │counter.increment() │                     │                │
   ├───────────────────>│                     │                │
   │                    │                     │                │
   │                    │ increment(params)   │                │
   │                    ├────────────────────>│                │
   │                    │                     │                │
   │                    │              resolve key             │
   │                    │                     │                │
   │                    │                     │ INCRBY key delta│
   │                    │                     ├───────────────>│
   │                    │                     │<───────────────┤
   │                    │                     │   newValue     │
   │                    │                     │                │
   │                    │<────────────────────┤                │
   │                    │ IncrementResult     │                │
   │                    │                     │                │
   │<───────────────────┤                     │                │
   │ { newValue, key }  │                     │                │
   │                    │                     │                │
```

### Sequence 3: Get Counter with Metadata

```
┌─────┐          ┌──────────────┐    ┌────────────────┐    ┌───────┐    ┌──────────────┐
│ LLM │          │ToolGateway   │    │UtilityService  │    │ Redis │    │DocumentStore │
└──┬──┘          └──────┬───────┘    └────────┬───────┘    └───┬───┘    └──────┬───────┘
   │                    │                     │                │                │
   │  counter.get()     │                     │                │                │
   ├───────────────────>│                     │                │                │
   │                    │                     │                │                │
   │                    │   get(params)       │                │                │
   │                    ├────────────────────>│                │                │
   │                    │                     │                │                │
   │                    │              resolve key             │                │
   │                    │                     │                │                │
   │                    │                     │ GET key        │                │
   │                    │                     ├───────────────>│                │
   │                    │                     │<───────────────┤                │
   │                    │                     │   valueStr     │                │
   │                    │                     │                │                │
   │                    │                     │ get(definition)│                │
   │                    │                     ├───────────────────────────────>│
   │                    │                     │<───────────────────────────────┤
   │                    │                     │   definition.metadata          │
   │                    │                     │                │                │
   │                    │<────────────────────┤                │                │
   │                    │  GetCounterResult   │                │                │
   │                    │                     │                │                │
   │<───────────────────┤                     │                │                │
   │{ value, metadata } │                     │                │                │
   │                    │                     │                │                │
```

### Sequence 4: Snapshot Counter

```
┌─────┐          ┌──────────────┐    ┌────────────────┐    ┌───────┐    ┌──────────────┐
│ LLM │          │ToolGateway   │    │UtilityService  │    │ Redis │    │DocumentStore │
└──┬──┘          └──────┬───────┘    └────────┬───────┘    └───┬───┘    └──────┬───────┘
   │                    │                     │                │                │
   │counter.snapshot()  │                     │                │                │
   ├───────────────────>│                     │                │                │
   │                    │                     │                │                │
   │                    │ snapshot(params)    │                │                │
   │                    ├────────────────────>│                │                │
   │                    │                     │                │                │
   │                    │              resolve key             │                │
   │                    │              generate UUID           │                │
   │                    │                     │                │                │
   │                    │                     │ GET key        │                │
   │                    │                     ├───────────────>│                │
   │                    │                     │<───────────────┤                │
   │                    │                     │   value        │                │
   │                    │                     │                │                │
   │                    │                     │ set(snapshot)  │                │
   │                    │                     ├───────────────────────────────>│
   │                    │                     │                │                │
   │                    │<────────────────────┤                │                │
   │                    │ SnapshotResult      │                │                │
   │                    │                     │                │                │
   │<───────────────────┤                     │                │                │
   │{snapshotId, value} │                     │                │                │
   │                    │                     │                │                │
```

---

## Design Decisions

### 1. Why Hybrid Storage (Redis + DocumentStore)?

**Alternative Considered**: Pure DocumentStore (PostgreSQL only)

**Decision**: Use Redis for values, DocumentStore for metadata

**Rationale**:
- ✅ **Performance**: Redis INCR/DECR is ~100x faster than SQL UPDATE
- ✅ **Atomicity**: Redis provides atomic operations without explicit transactions
- ✅ **TTL**: Redis EXPIRE is native and automatic (vs. manual cleanup jobs)
- ✅ **Queryability**: DocumentStore provides rich metadata queries
- ✅ **Persistence**: Snapshots in DocumentStore survive Redis restarts

**Trade-offs**:
- ❌ **Complexity**: Two storage systems to manage
- ❌ **Consistency**: Eventual consistency between Redis and DocumentStore
- ✅ **Acceptable**: Counter values are ephemeral (rebuil from snapshots if needed)

### 2. Why Auto-Scope Inference?

**Alternative Considered**: Require explicit scope parameters always

**Decision**: Auto-infer scope from event context when possible

**Rationale**:
- ✅ **UX**: Simpler LLM tool calls (fewer required parameters)
- ✅ **Correctness**: Event context is authoritative for channel/user
- ✅ **Flexibility**: Explicit params still supported for advanced use cases

**Example**:
```typescript
// Before (explicit scope)
counter.create({
  name: "deaths",
  scopeType: "stream",
  scopeValue: "bitbrat",  // Must know channel name
  ...
})

// After (auto-inference)
counter.create({
  name: "deaths",
  // scopeType/scopeValue auto-inferred from event
  ...
})
```

### 3. Why Fail-Open Pattern?

**Alternative Considered**: Fail-closed (throw errors when resources unavailable)

**Decision**: Return null/error responses, don't crash

**Rationale**:
- ✅ **Availability**: Service remains available during degraded dependencies
- ✅ **Graceful Degradation**: LLM can handle error responses intelligently
- ✅ **Lazy Initialization**: Resources may not be ready at startup
- ❌ **Error Handling**: Callers must check for null/error responses

**Implementation**:
```typescript
private ensureCounterManager(): CounterManager | null {
  if (!this.docStore || !this.redis) {
    return null;  // Fail-open
  }
  return new CounterManager(...);
}
```

### 4. Why Platform-Only MCP Exposure?

**Alternative Considered**: Platform+Domain (expose to external LLMs)

**Decision**: Platform-only (internal tools only)

**Rationale**:
- ✅ **Security**: Prevent external abuse of counter system
- ✅ **Control**: Platform services mediate access
- ✅ **Flexibility**: Can add domain exposure later if needed
- ✅ **Consistency**: Counters are infrastructure, not user-facing features

### 5. Why Lazy Resource Initialization?

**Alternative Considered**: Eager initialization at startup

**Decision**: Lazy initialization (resources created on first use)

**Rationale**:
- ✅ **Resilience**: Service starts even if resources not ready
- ✅ **Testing**: Easier to test without full infrastructure
- ✅ **Flexibility**: Resources can be hot-swapped
- ❌ **Latency**: First request may be slower (acceptable for counters)

---

## Performance Characteristics

### Latency

| Operation | Hot Path (Redis only) | Cold Path (Redis + DocumentStore) |
|-----------|----------------------|-----------------------------------|
| `create` | N/A | ~5-10ms |
| `increment` | ~1ms | N/A |
| `decrement` | ~1ms | N/A |
| `get` (key) | ~1ms | N/A |
| `get` (name) | ~2ms | ~5ms (includes metadata) |
| `delete` | ~2ms | ~5ms |
| `list` | N/A | ~10-50ms (depends on result size) |
| `snapshot` | ~2ms | ~5ms |

**Notes**:
- Hot path: Redis operations only
- Cold path: Redis + DocumentStore round-trip
- Network latency not included (add ~1-2ms for local, ~10-50ms for cloud)

### Throughput

| Operation | Max Throughput | Bottleneck |
|-----------|---------------|------------|
| `increment` | ~100k ops/sec | Redis INCRBY |
| `get` | ~100k ops/sec | Redis GET |
| `create` | ~1k ops/sec | DocumentStore writes |
| `list` | ~100 queries/sec | DocumentStore queries |

**Scaling**:
- Redis: Vertical scaling (single instance) or Redis Cluster (sharding)
- DocumentStore: Connection pooling, read replicas, indexes

### Memory

**Per Counter**:
- Redis: ~100 bytes (key + value)
- DocumentStore: ~500-1000 bytes (definition + metadata)

**Estimate for 1 million counters**:
- Redis: ~100 MB
- DocumentStore: ~500 MB - 1 GB

**TTL Impact**:
- Expired counters auto-deleted from Redis (memory freed)
- DocumentStore entries persist (manual cleanup job needed)

---

## Security Considerations

### 1. MCP Exposure: Platform-Only

**Risk**: External abuse of counter system

**Mitigation**: Platform-only exposure
- ✅ Only platform services can call counter tools
- ✅ LLM access mediated through tool-gateway (RBAC enforced)
- ✅ No direct external access

### 2. Scope Isolation

**Risk**: Counter name collisions across scopes

**Mitigation**: Scoped keys (`counter:{scopeType}:{scopeValue}:{name}`)
- ✅ No collisions between streams/users/sessions
- ✅ Clear ownership (scope defines lifecycle)
- ✅ Automatic cleanup when scope expires

### 3. TTL Enforcement

**Risk**: Unbounded counter accumulation

**Mitigation**: TTL-based expiration
- ✅ Redis automatically deletes expired counters
- ✅ DocumentStore tracks `expiresAt` for queries
- ⚠️ Manual cleanup job needed for DocumentStore orphans (Phase 2)

### 4. Input Validation

**Risk**: Invalid scope types, malicious metadata

**Mitigation**: Zod schema validation
- ✅ All MCP tool inputs validated
- ✅ Scope type enum enforced
- ✅ Name length limits (max 64 characters)

---

## Future Enhancements

### Phase 2: Bidding Sessions (Future Sprint)

**Features**:
- Bidding session management
- User bid submission
- Bid aggregation queries (max, min, closest)
- Blind bidding support

**Storage**:
- Active bids: Redis Hashes (ephemeral, TTL)
- Bid results: DocumentStore (persistent)

**MCP Tools** (8 additional):
- `bid.session.create`
- `bid.submit`
- `bid.session.close`
- `bid.get.max`
- `bid.get.min`
- `bid.get.closest`
- `bid.session.list`
- `bid.results`

### Phase 3: Event Integration (Future Sprint)

**Features**:
- Automatic scope inference from routing slip
- Auto-create counters on stream start
- Auto-snapshot on stream end
- Event-driven TTL adjustment

### Phase 4: Advanced Features (Backlog)

**Features**:
- Leaderboards (top-N queries)
- Decay functions (time-based value reduction)
- Counter templates (pre-configured counter types)
- Bulk operations (batch create/update)
- Historical analytics (trend analysis)

---

## Related Documentation

- **Architecture Revision**: `planning/sprint-27-6tp11t/architecture-revision-v2.md`
- **Execution Plan**: `planning/sprint-27-6tp11t/execution-plan.md`
- **Backlog**: `planning/sprint-27-6tp11t/backlog.yaml`
- **User Guide**: `documentation/guides/utility-counters.md`
- **MCP Tool Reference**: `documentation/reference/utility-tools.md`
- **Validation Report**: `planning/sprint-27-6tp11t/validation-report.md`

---

## Implementation Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/apps/utility-service.ts` | Bit entry point, MCP tools | 479 |
| `src/services/utility/types.ts` | Type definitions | 400 |
| `src/services/utility/scope-resolver.ts` | Scope resolution logic | 234 |
| `src/services/utility/counter-manager.ts` | Counter operations | 408 |
| `src/services/utility/scope-resolver.test.ts` | ScopeResolver tests | 400 |
| `src/services/utility/counter-manager.test.ts` | CounterManager tests | 450 |
| **Total** | | **~2,400 lines** |

---

## Appendix: Design Alternatives Considered

### Alternative 1: Pure Redis (No DocumentStore)

**Pros**:
- Simpler architecture (single storage system)
- Lower latency for all operations
- Native TTL support

**Cons**:
- ❌ No rich metadata queries
- ❌ No historical snapshots (Redis persistence unreliable)
- ❌ No cross-counter queries
- ❌ Metadata limited to key names (not queryable)

**Decision**: Rejected due to lack of queryability

### Alternative 2: Pure DocumentStore (No Redis)

**Pros**:
- Simpler architecture
- Rich queries and metadata
- Persistent snapshots

**Cons**:
- ❌ Slow increments (SQL UPDATE vs. Redis INCR)
- ❌ No atomic operations (requires explicit transactions)
- ❌ Manual TTL cleanup (cron jobs)
- ❌ Higher latency (~10-50ms vs. ~1ms)

**Decision**: Rejected due to performance concerns

### Alternative 3: Redis + Firestore

**Pros**:
- Redis for values (fast)
- Firestore for metadata (queryable)
- Managed services (less ops)

**Cons**:
- ❌ Firestore deprecated in BitBrat platform
- ❌ Vendor lock-in (GCP only)
- ❌ Higher cost than PostgreSQL

**Decision**: Rejected due to platform deprecation of Firestore

---

## Conclusion

The utility-service implements a **hybrid storage architecture** that balances performance, queryability, and persistence. By using Redis for hot-path operations and DocumentStore for metadata, we achieve:

✅ Sub-millisecond counter updates
✅ Rich metadata queries
✅ Automatic TTL expiration
✅ Historical snapshots
✅ Platform-agnostic persistence

This architecture is **production-ready** and supports future enhancements (bidding, event integration, advanced analytics) without major refactoring.
