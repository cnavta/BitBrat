# Technical Architecture: Platform Utilities - Counters & Bidding (Revision 2)

**Sprint**: sprint-27-6tp11t
**Author**: Claude (Architect)
**Date**: 2026-08-26
**Status**: Draft
**Revision**: 2 - Incorporates DocumentStore pattern and Redis Hash evaluation

---

## Revision History

**v2 (2026-08-26)**:
- Updated metadata storage to use `IDocumentStore` interface (platform default)
- Added evaluation of Redis Hashes vs PostgreSQL for bid storage
- Revised storage strategy recommendations based on platform patterns

**v1 (2026-08-26)**: Initial draft

---

## 1. Storage Strategy Revisions

### 1.1 DocumentStore Pattern (Platform Default)

The BitBrat platform uses a **vendor-neutral DocumentStore abstraction** (`IDocumentStore`) for metadata persistence. This supports both PostgreSQL (JSONB) and Firestore backends via a common interface.

**Key Interface Methods**:
```typescript
interface IDocumentStore {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, data: T, merge?: boolean): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  query<T>(collection: string, options: QueryOptions): Promise<T[]>;
  getAll<T>(collection: string): Promise<T[]>;
  batch(operations: BatchOperation[]): Promise<void>;
  health(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}
```

**Why This Matters**:
- Platform-agnostic: Works with PostgreSQL (default) and Firestore (legacy)
- Consistent patterns across all services
- Built-in health checks and batch operations
- No raw SQL required (all operations via document abstraction)

### 1.2 Redis Operations via IKVStore

The platform also provides `IKVStore` interface for Redis operations:

```typescript
interface IKVStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  increment(key: string, delta?: number): Promise<number>;
  decrement(key: string, delta?: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, ttl: number): Promise<void>;
  health(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}
```

**However**: Current implementation (`RedisManager`) provides direct `RedisClientType` access, which includes full Redis command set (including Hashes, Sets, Sorted Sets, etc.).

---

## 2. Revised Counter Design

### 2.1 Counter Metadata (IDocumentStore)

**Collection**: `counter_definitions`
**Document ID**: `{scope_type}:{scope_value}:{name}` (e.g., `stream:bitbrat:deaths`)

**Document Schema**:
```typescript
interface CounterDefinition {
  id: string;                    // Document ID (also the Redis key pattern)
  name: string;                  // Counter name
  scopeType: 'global' | 'stream' | 'user' | 'session' | 'custom';
  scopeValue: string;            // Scope identifier (e.g., channel name, user ID)
  ttlSeconds?: number;           // Expiration time (null = persistent)
  metadata: {                    // Extensible metadata
    description?: string;
    category?: string;
    icon?: string;
    displayFormat?: string;      // 'number', 'currency', 'percentage'
    tags?: string[];
    [key: string]: any;
  };
  createdAt: string;             // ISO 8601 timestamp
  expiresAt?: string;            // Computed: createdAt + ttlSeconds
  createdBy: string;             // User/service that created it
}
```

**DocumentStore Operations**:
```typescript
// Create counter definition
await docStore.set('counter_definitions', 'stream:bitbrat:deaths', {
  id: 'stream:bitbrat:deaths',
  name: 'deaths',
  scopeType: 'stream',
  scopeValue: 'bitbrat',
  ttlSeconds: 86400,
  metadata: { description: 'Deaths this stream', icon: '💀' },
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  createdBy: 'llm-bot'
});

// Query counters by scope
const streamCounters = await docStore.query<CounterDefinition>(
  'counter_definitions',
  {
    filters: [
      { field: 'scopeType', operator: '==', value: 'stream' },
      { field: 'scopeValue', operator: '==', value: 'bitbrat' }
    ]
  }
);

// List all active counters (not expired)
const activeCounters = await docStore.query<CounterDefinition>(
  'counter_definitions',
  {
    filters: [
      { field: 'expiresAt', operator: '>', value: new Date().toISOString() }
    ]
  }
);
```

### 2.2 Counter Values (Redis Simple Keys)

**Storage**: Redis string values with `INCR`/`DECR` operations
**Key Pattern**: `counter:{scope_type}:{scope_value}:{name}`
**TTL**: Set from `CounterDefinition.ttlSeconds`

**Operations**:
```typescript
// Via RedisClientType (direct access)
const newValue = await redis.incr('counter:stream:bitbrat:deaths');
await redis.expire('counter:stream:bitbrat:deaths', 86400);

// Via IKVStore (abstraction)
const newValue = await kvStore.increment('counter:stream:bitbrat:deaths', 1);
await kvStore.expire('counter:stream:bitbrat:deaths', 86400);
```

**Recommendation**: Use `IKVStore` for portability unless advanced Redis features needed.

### 2.3 Historical Snapshots (IDocumentStore)

**Collection**: `counter_snapshots`
**Document ID**: Auto-generated UUID

**Document Schema**:
```typescript
interface CounterSnapshot {
  id: string;                    // UUID
  counterId: string;             // Reference to counter definition ID
  value: number;                 // Counter value at snapshot time
  snapshotAt: string;            // ISO 8601 timestamp
  trigger: 'periodic' | 'manual' | 'expiration' | 'stream_end';
}
```

**Query Example**:
```typescript
// Get snapshot history for a counter
const snapshots = await docStore.query<CounterSnapshot>(
  'counter_snapshots',
  {
    filters: [
      { field: 'counterId', operator: '==', value: 'stream:bitbrat:deaths' }
    ],
    orderBy: { field: 'snapshotAt', direction: 'desc' },
    limit: 10
  }
);
```

---

## 3. Revised Bidding Design: Redis Hashes vs DocumentStore

### 3.1 Storage Option Evaluation

#### **Option A: Redis Hashes**

**Structure**:
```
Hash Key: bid:session:{session_id}
Hash Fields:
  user:{user_id} → value (string representation of number)
  _metadata → JSON string with session config
```

**Operations**:
```typescript
// Create session metadata
await redis.hSet('bid:session:boss_hp_guess', '_metadata', JSON.stringify({
  name: 'boss_hp_guess',
  scopeType: 'stream',
  scopeValue: 'bitbrat',
  targetValue: 1500,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
}));

// Submit bid
await redis.hSet('bid:session:boss_hp_guess', 'user:alice', '1499');
await redis.hSet('bid:session:boss_hp_guess', 'user:bob', '1350');
await redis.expire('bid:session:boss_hp_guess', 3600);

// Get all bids
const allBids = await redis.hGetAll('bid:session:boss_hp_guess');
// Returns: { _metadata: '...', 'user:alice': '1499', 'user:bob': '1350' }

// Get specific user bid
const aliceBid = await redis.hGet('bid:session:boss_hp_guess', 'user:alice');

// Count entries
const count = await redis.hLen('bid:session:boss_hp_guess') - 1; // -1 for _metadata
```

**Pros**:
- ✅ **Fast**: Single Redis operation for all bids (`HGETALL`)
- ✅ **Atomic**: Upsert with `HSET` (auto-updates if user rebids)
- ✅ **TTL**: Entire session expires together
- ✅ **Simple**: One hash per session, natural data model

**Cons**:
- ❌ **No Sorting**: `HGETALL` returns unordered hash, must sort client-side
- ❌ **No Indexing**: Can't efficiently query "all bids > X" or "range queries"
- ❌ **Limited Queries**: No native support for MIN/MAX/CLOSEST (client-side computation)
- ❌ **Persistence**: Volatile if Redis restarts (unless using RDB/AOF)
- ❌ **No History**: Once session expires, all data lost

**Query Performance** (100 users):
```typescript
// Get closest bid to target (client-side)
const allBids = await redis.hGetAll('bid:session:boss_hp_guess');
const entries = Object.entries(allBids)
  .filter(([key]) => key.startsWith('user:'))
  .map(([key, value]) => ({
    user: key.replace('user:', ''),
    value: parseFloat(value)
  }));

// Sort by distance to target
const target = 1500;
const sorted = entries.sort((a, b) =>
  Math.abs(a.value - target) - Math.abs(b.value - target)
);

const winner = sorted[0]; // O(n log n) for sorting
```

**Conclusion**: Excellent for **small-to-medium sessions** (<1000 users) where sorting overhead is acceptable.

---

#### **Option B: DocumentStore (PostgreSQL JSONB)**

**Collection**: `bid_sessions` (session metadata)
**Document Schema**:
```typescript
interface BidSession {
  id: string;                    // session ID
  name: string;
  scopeType: 'global' | 'stream' | 'session' | 'custom';
  scopeValue: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata: {
    description?: string;
    rules?: string;
    prize?: string;
    [key: string]: any;
  };
  createdAt: string;
  expiresAt?: string;
  closedAt?: string;             // Manual closure timestamp
  createdBy: string;
}
```

**Collection**: `bid_entries` (user submissions)
**Document ID**: `{session_id}:{user_id}` (e.g., `boss_hp_guess:alice`)

```typescript
interface BidEntry {
  id: string;                    // Document ID
  sessionId: string;             // Reference to bid session
  userId: string;
  userName?: string;             // Display name
  value: number;
  submittedAt: string;
  metadata: {
    platform?: string;
    correlationId?: string;
    [key: string]: any;
  };
}
```

**Operations**:
```typescript
// Submit bid (upsert via merge)
await docStore.set('bid_entries', 'boss_hp_guess:alice', {
  id: 'boss_hp_guess:alice',
  sessionId: 'boss_hp_guess',
  userId: 'alice',
  userName: 'Alice',
  value: 1499,
  submittedAt: new Date().toISOString(),
  metadata: {}
}, true); // merge=true for upsert

// Get max bid
const maxBids = await docStore.query<BidEntry>('bid_entries', {
  filters: [
    { field: 'sessionId', operator: '==', value: 'boss_hp_guess' }
  ],
  orderBy: { field: 'value', direction: 'desc' },
  limit: 1
});
const maxBid = maxBids[0];

// Get closest to target (requires custom query in PostgreSQL backend)
// IDocumentStore doesn't support ABS() or computed fields in orderBy
// Would need to fetch all and sort client-side OR use raw SQL
```

**Pros**:
- ✅ **Persistent**: Survives Redis restarts, permanent history
- ✅ **Queryable**: Filters, ordering, pagination via DocumentStore
- ✅ **Scalable**: Handles 10k+ users per session efficiently
- ✅ **Historical**: Sessions remain queryable after expiration (for analytics)
- ✅ **Platform-Agnostic**: Works with PostgreSQL or Firestore

**Cons**:
- ❌ **Slower**: Network round-trip to PostgreSQL for each operation
- ❌ **Complex Queries**: "Closest to X" requires client-side sorting or raw SQL
- ❌ **No Native TTL**: Must implement expiration via background job
- ❌ **Heavier**: Overkill for ephemeral, short-lived sessions

**Query Performance** (100 users):
```typescript
// Get closest bid (must fetch all and sort client-side)
const allBids = await docStore.query<BidEntry>('bid_entries', {
  filters: [
    { field: 'sessionId', operator: '==', value: 'boss_hp_guess' }
  ]
});

const target = 1500;
const sorted = allBids.sort((a, b) =>
  Math.abs(a.value - target) - Math.abs(b.value - target)
);
const winner = sorted[0]; // Same O(n log n) as Redis Hashes
```

**Conclusion**: Best for **long-lived sessions** or when **historical tracking** is required.

---

#### **Option C: Hybrid Approach** ⭐ **RECOMMENDED**

**Active Session**: Redis Hash (fast, ephemeral)
**Session Metadata**: DocumentStore (persistent, queryable)
**Historical Results**: DocumentStore (analytics, auditing)

**Workflow**:
```typescript
// 1. Create session metadata (DocumentStore)
await docStore.set('bid_sessions', 'boss_hp_guess', {
  id: 'boss_hp_guess',
  name: 'boss_hp_guess',
  scopeType: 'stream',
  scopeValue: 'bitbrat',
  targetValue: 1500,
  ttlSeconds: 3600,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  createdBy: 'llm-bot'
});

// 2. Accept bids in Redis Hash (fast)
await redis.hSet('bid:session:boss_hp_guess', 'user:alice', '1499');
await redis.expire('bid:session:boss_hp_guess', 3600);

// 3. On session close, snapshot results to DocumentStore
const allBids = await redis.hGetAll('bid:session:boss_hp_guess');
const entries = Object.entries(allBids)
  .filter(([key]) => key.startsWith('user:'))
  .map(([key, value]) => ({ user: key.replace('user:', ''), value: parseFloat(value) }));

const target = 1500;
const winner = entries.sort((a, b) =>
  Math.abs(a.value - target) - Math.abs(b.value - target)
)[0];

// Store result
await docStore.set('bid_results', `boss_hp_guess:${Date.now()}`, {
  sessionId: 'boss_hp_guess',
  closedAt: new Date().toISOString(),
  winner: winner.user,
  winningValue: winner.value,
  totalEntries: entries.length,
  allEntries: entries  // Full distribution for analytics
});

// Update session metadata
await docStore.set('bid_sessions', 'boss_hp_guess', {
  closedAt: new Date().toISOString()
}, true); // merge
```

**Pros**:
- ✅ **Fast Active Sessions**: Redis performance during bidding window
- ✅ **Persistent History**: Results preserved for analytics
- ✅ **TTL Enforcement**: Redis handles auto-expiration
- ✅ **Queryable Archives**: Can query past sessions via DocumentStore

**Cons**:
- ⚠️ **Complexity**: Two storage systems to manage
- ⚠️ **Snapshot Logic**: Must implement session close handler

**Recommendation**: **Use Hybrid Approach** for production. Provides best of both worlds.

---

### 3.2 Bid Storage Decision Matrix

| Feature | Redis Hashes | DocumentStore | Hybrid (Redis + Doc) |
|---------|--------------|---------------|----------------------|
| **Write Speed** | ⭐⭐⭐⭐⭐ (ms) | ⭐⭐⭐ (10-50ms) | ⭐⭐⭐⭐⭐ (active) |
| **Query MAX/MIN** | ⭐⭐ (client-side) | ⭐⭐⭐⭐ (SQL) | ⭐⭐⭐⭐ (snapshot) |
| **Query CLOSEST** | ⭐⭐ (client-side) | ⭐⭐ (client-side) | ⭐⭐ (client-side) |
| **Persistence** | ⭐⭐ (RDB/AOF) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **TTL** | ⭐⭐⭐⭐⭐ (native) | ⭐⭐ (manual) | ⭐⭐⭐⭐⭐ |
| **Scalability** | ⭐⭐⭐⭐ (<1k users) | ⭐⭐⭐⭐⭐ (10k+) | ⭐⭐⭐⭐⭐ |
| **Historical Queries** | ❌ (ephemeral) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Complexity** | ⭐⭐⭐⭐⭐ (simple) | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Platform Fit** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**Recommendation for Bidding**: **Hybrid Approach**
- Use Redis Hashes for active bidding sessions (speed, TTL)
- Snapshot to DocumentStore on close (history, analytics)
- Session metadata always in DocumentStore (queryable, persistent)

---

## 4. Revised Service Architecture

### 4.1 Dependencies

```typescript
// utility-service.ts
export class UtilityService extends Bit {
  private docStore: IDocumentStore;
  private redis: RedisClientType;
  private kvStore: IKVStore;
  private counterManager: CounterManager;
  private bidManager: BidManager;

  async setup(): Promise<void> {
    // Get DocumentStore from resources (platform-managed)
    this.docStore = (this as any).resources.documentStore;

    // Get Redis client (platform-managed)
    this.redis = (this as any).resources.redis;

    // Optional: Use KVStore abstraction if Redis Hashes not needed
    // this.kvStore = new RedisKVStore(this.redis);

    // Initialize managers
    this.counterManager = new CounterManager(
      this.docStore,
      this.redis,
      new ScopeResolver(),
      this.getLogger()
    );

    this.bidManager = new BidManager(
      this.docStore,
      this.redis,
      new ScopeResolver(),
      this.getLogger()
    );

    // Register MCP tools
    this.registerCounterTools();
    this.registerBidTools();
  }
}
```

### 4.2 Counter Manager (Revised)

```typescript
export class CounterManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,
    private logger: Logger
  ) {}

  async create(params: CreateCounterParams): Promise<CounterResult> {
    const scope = this.scopeResolver.resolve(
      { scopeType: params.scopeType, scopeValue: params.scopeValue },
      params.event
    );

    const id = `${scope.scopeType}:${scope.scopeValue}:${params.name}`;

    // 1. Create metadata in DocumentStore
    const definition: CounterDefinition = {
      id,
      name: params.name,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      ttlSeconds: params.ttlSeconds,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
      expiresAt: params.ttlSeconds
        ? new Date(Date.now() + params.ttlSeconds * 1000).toISOString()
        : undefined,
      createdBy: params.createdBy || 'system'
    };

    await this.docStore.set('counter_definitions', id, definition);

    // 2. Initialize value in Redis
    const key = `counter:${id}`;
    await this.redis.set(key, String(params.initialValue || 0));
    if (params.ttlSeconds) {
      await this.redis.expire(key, params.ttlSeconds);
    }

    this.logger.info('counter.created', { id, key });
    return { success: true, counterId: id, key };
  }

  async increment(params: IncrementParams): Promise<IncrementResult> {
    const key = params.key || this.resolveKey(params);
    const newValue = await this.redis.incr(key);

    return { success: true, newValue, key };
  }

  async get(params: GetParams): Promise<GetResult> {
    const key = params.key || this.resolveKey(params);

    // Get current value from Redis
    const value = await this.redis.get(key);

    // Get metadata from DocumentStore
    const id = key.replace('counter:', '');
    const definition = await this.docStore.get<CounterDefinition>(
      'counter_definitions',
      id
    );

    return {
      success: true,
      value: parseInt(value || '0', 10),
      key,
      metadata: definition?.metadata
    };
  }

  async list(params: ListParams): Promise<CounterDefinition[]> {
    const filters: QueryFilter[] = [];

    if (params.scopeType) {
      filters.push({ field: 'scopeType', operator: '==', value: params.scopeType });
    }

    if (params.scopeValue) {
      filters.push({ field: 'scopeValue', operator: '==', value: params.scopeValue });
    }

    if (!params.includeExpired) {
      filters.push({
        field: 'expiresAt',
        operator: '>',
        value: new Date().toISOString()
      });
    }

    return await this.docStore.query<CounterDefinition>(
      'counter_definitions',
      { filters }
    );
  }

  private resolveKey(params: any): string {
    const scope = this.scopeResolver.resolve(params);
    return `counter:${scope.scopeType}:${scope.scopeValue}:${params.name}`;
  }
}
```

### 4.3 Bid Manager (Hybrid Approach)

```typescript
export class BidManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,
    private logger: Logger
  ) {}

  async create(params: CreateBidSessionParams): Promise<BidSessionResult> {
    const scope = this.scopeResolver.resolve(
      { scopeType: params.scopeType, scopeValue: params.scopeValue },
      params.event
    );

    const id = `${scope.scopeType}:${scope.scopeValue}:${params.name}`;

    // Create session metadata in DocumentStore
    const session: BidSession = {
      id,
      name: params.name,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      targetValue: params.targetValue,
      ttlSeconds: params.ttlSeconds,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
      expiresAt: params.ttlSeconds
        ? new Date(Date.now() + params.ttlSeconds * 1000).toISOString()
        : undefined,
      createdBy: params.createdBy || 'system'
    };

    await this.docStore.set('bid_sessions', id, session);

    // Initialize Redis hash with metadata
    const hashKey = `bid:session:${id}`;
    await this.redis.hSet(hashKey, '_metadata', JSON.stringify({
      targetValue: params.targetValue,
      createdAt: session.createdAt
    }));

    if (params.ttlSeconds) {
      await this.redis.expire(hashKey, params.ttlSeconds);
    }

    this.logger.info('bid.session.created', { id, hashKey });
    return { success: true, sessionId: id, sessionKey: id };
  }

  async submit(params: SubmitBidParams): Promise<SubmitResult> {
    const hashKey = `bid:session:${params.session}`;
    const userKey = `user:${params.user}`;

    // Get previous value (if any)
    const previousValue = await this.redis.hGet(hashKey, userKey);

    // Upsert bid
    await this.redis.hSet(hashKey, userKey, String(params.value));

    this.logger.info('bid.submitted', {
      session: params.session,
      user: params.user,
      value: params.value,
      previousValue: previousValue ? parseFloat(previousValue) : null
    });

    return {
      success: true,
      entryId: `${params.session}:${params.user}`,
      previousValue: previousValue ? parseFloat(previousValue) : null
    };
  }

  async getMax(params: GetMaxParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    const maxEntry = entries.reduce((max, entry) =>
      entry.value > max.value ? entry : max
    );

    return this.toBidEntry(params.session, maxEntry);
  }

  async getMin(params: GetMinParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    const minEntry = entries.reduce((min, entry) =>
      entry.value < min.value ? entry : min
    );

    return this.toBidEntry(params.session, minEntry);
  }

  async getClosest(params: GetClosestParams): Promise<BidEntry> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    // Get target from params or session metadata
    let target = params.target;
    if (!target) {
      const metadataJson = allBids['_metadata'];
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson);
        target = metadata.targetValue;
      }
    }

    if (!target) {
      throw new Error('No target value specified');
    }

    const entries = this.parseHashEntries(allBids);
    if (entries.length === 0) {
      throw new Error('No bids found');
    }

    // Sort by distance to target
    const sorted = entries.sort((a, b) =>
      Math.abs(a.value - target!) - Math.abs(b.value - target!)
    );

    const winner = sorted[0];
    return {
      ...this.toBidEntry(params.session, winner),
      difference: Math.abs(winner.value - target)
    };
  }

  async close(params: CloseParams): Promise<CloseResult> {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);

    // Update session metadata in DocumentStore
    await this.docStore.set('bid_sessions', params.session, {
      closedAt: new Date().toISOString()
    }, true); // merge

    // Snapshot results to DocumentStore for history
    await this.docStore.set('bid_results', `${params.session}:${Date.now()}`, {
      sessionId: params.session,
      closedAt: new Date().toISOString(),
      totalEntries: entries.length,
      allEntries: entries
    });

    // Keep Redis hash for TTL expiration (or delete immediately)
    // await this.redis.del(hashKey); // Optional: immediate cleanup

    this.logger.info('bid.session.closed', {
      session: params.session,
      totalEntries: entries.length
    });

    return {
      success: true,
      closedAt: new Date().toISOString(),
      finalCount: entries.length
    };
  }

  private parseHashEntries(hash: Record<string, string>): Array<{ user: string; value: number }> {
    return Object.entries(hash)
      .filter(([key]) => key.startsWith('user:'))
      .map(([key, value]) => ({
        user: key.replace('user:', ''),
        value: parseFloat(value)
      }));
  }

  private toBidEntry(sessionId: string, entry: { user: string; value: number }): BidEntry {
    return {
      sessionId,
      userId: entry.user,
      userName: entry.user, // Could lookup from user service
      value: entry.value,
      submittedAt: new Date().toISOString()
    };
  }
}
```

---

## 5. Revised Data Schema

### 5.1 DocumentStore Collections

**Collection: `counter_definitions`**
```typescript
{
  id: string;                    // "stream:bitbrat:deaths"
  name: string;                  // "deaths"
  scopeType: string;
  scopeValue: string;
  ttlSeconds?: number;
  metadata: object;
  createdAt: string;
  expiresAt?: string;
  createdBy: string;
}
```

**Collection: `counter_snapshots`**
```typescript
{
  id: string;                    // Auto-generated UUID
  counterId: string;             // Reference to counter definition
  value: number;
  snapshotAt: string;
  trigger: string;
}
```

**Collection: `bid_sessions`**
```typescript
{
  id: string;                    // "stream:bitbrat:boss_hp_guess"
  name: string;
  scopeType: string;
  scopeValue: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata: object;
  createdAt: string;
  expiresAt?: string;
  closedAt?: string;
  createdBy: string;
}
```

**Collection: `bid_results`** (historical)
```typescript
{
  id: string;                    // "boss_hp_guess:1703001234567"
  sessionId: string;
  closedAt: string;
  totalEntries: number;
  winner?: string;               // Optional: computed winner
  winningValue?: number;
  allEntries: Array<{
    user: string;
    value: number;
  }>;
}
```

### 5.2 Redis Structures

**Counter Values** (Simple Keys):
```
Key: counter:stream:bitbrat:deaths
Value: "42" (string representation of integer)
TTL: From counter definition
```

**Bid Sessions** (Hashes):
```
Key: bid:session:boss_hp_guess
Fields:
  _metadata: '{"targetValue":1500,"createdAt":"..."}'
  user:alice: "1499"
  user:bob: "1350"
  user:charlie: "1620"
TTL: From session definition
```

---

## 6. Key Advantages of Revised Architecture

### 6.1 Platform Alignment

✅ **DocumentStore Pattern**: Uses `IDocumentStore` for all metadata (consistent with platform)
✅ **Vendor-Neutral**: Works with PostgreSQL (default) or Firestore (legacy)
✅ **ResourceManager Pattern**: Redis and DocumentStore managed by platform
✅ **No Raw SQL**: All operations via platform abstractions

### 6.2 Counter Simplicity

✅ **Fast Increments**: Redis `INCR` for sub-millisecond updates
✅ **Persistent Metadata**: DocumentStore survives restarts
✅ **Historical Tracking**: Optional snapshots in DocumentStore
✅ **TTL Enforcement**: Redis native expiration

### 6.3 Bidding Performance

✅ **Hybrid Approach**: Redis speed + DocumentStore persistence
✅ **Atomic Upserts**: `HSET` handles user rebids naturally
✅ **Efficient Queries**: MAX/MIN computed in-memory from hash
✅ **Historical Results**: Snapshots preserved for analytics
✅ **TTL Cleanup**: Redis auto-expires old sessions

### 6.4 LLM Integration

✅ **Intuitive Tools**: Simple MCP signatures with scope inference
✅ **Metadata-Rich**: Queryable counter/session definitions
✅ **Fail-Open**: Graceful degradation if Redis unavailable
✅ **Event-Driven**: Natural integration with routing slips

---

## 7. Open Questions (Updated)

### 7.1 Resolved

✅ **Metadata Storage**: Use `IDocumentStore` (platform default)
✅ **Bid Storage**: Hybrid approach (Redis Hashes + DocumentStore snapshots)

### 7.2 Still Open

1. **Should counters publish events on increment?**
   - Recommendation: Optional flag, default off (reduce noise)

2. **Should bid sessions auto-close on stream.offline?**
   - Recommendation: Configurable per session in metadata

3. **Should we snapshot bid results on every close or only on explicit request?**
   - Recommendation: Always snapshot on close (enables analytics)

4. **Should Redis Hashes include display names or just user IDs?**
   - Recommendation: User IDs only (lightweight), lookup names on query if needed

---

## 8. Implementation Phases (Revised)

### Phase 1: Core Infrastructure (Sprint 27)
- Implement `utility-service` with DocumentStore + Redis resources
- Counter tools: create, increment, get, delete, list
- Counter metadata in `IDocumentStore`
- Counter values in Redis simple keys
- Unit tests for CounterManager

### Phase 2: Bid Tools (Sprint 28?)
- Bid session tools: create, submit, close
- Hybrid storage: Redis Hashes (active) + DocumentStore (metadata + results)
- Aggregation queries: max, min, closest
- Unit tests for BidManager

### Phase 3: Event Integration (Sprint 29?)
- Stream lifecycle auto-scoping
- Historical snapshots for counters
- Bid results analytics queries

### Phase 4: Advanced Features (Backlog)
- Leaderboards (Redis Sorted Sets or DocumentStore queries)
- Counter decay schedules (via scheduler-service)
- Blind bidding (encrypted values until close)

---

## 9. Summary of Changes from v1

**Major Revisions**:
1. ✅ Replaced raw SQL tables with `IDocumentStore` collections
2. ✅ Added Redis Hash evaluation for bid storage
3. ✅ Recommended hybrid approach (Redis + DocumentStore)
4. ✅ Updated all code examples to use platform abstractions
5. ✅ Simplified counter snapshots (DocumentStore collection)
6. ✅ Clarified ResourceManager pattern for Redis/DocumentStore

**Architectural Benefits**:
- Platform-agnostic (PostgreSQL or Firestore)
- No raw SQL dependencies
- Consistent with existing services (claim-check, etc.)
- Better performance for active sessions (Redis Hashes)
- Better analytics for historical data (DocumentStore queries)

---

**Next Steps**:
1. Review hybrid storage approach
2. Confirm Redis Hash support acceptable for bidding
3. Approve revised architecture
4. Proceed to implementation plan

**Approvers**: christophernavta (Product Owner), Claude (Architect)
