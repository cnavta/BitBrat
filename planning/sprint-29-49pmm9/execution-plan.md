# Execution Plan: Bidding System Implementation

**Sprint**: TBD (Based on Sprint 27 Research)
**Lead Implementor**: Claude
**Date**: 2026-08-29
**Architecture**: BIDDING-SYSTEM-ARCHITECTURE.md
**Estimated Effort**: 10-14 hours

---

## Executive Summary

Implement bidding functionality in the existing `utility-service` Bit by adding `BidManager` class and 8 new MCP tools. This extends Phase 1 (Counters) with Phase 2 (Bidding) capabilities.

**Key Approach**:
- ✅ Extend existing `utility-service` (no new Bit required)
- ✅ Reuse `ScopeResolver` from Phase 1 (no changes needed)
- ✅ Follow hybrid storage pattern (Redis Hashes + DocumentStore)
- ✅ Follow Phase 1 testing patterns (unit + agent-dev integration)

**Dependencies**:
- Phase 1 (Counters) must be complete ✅
- Existing resources: `IDocumentStore`, `RedisClientType` ✅
- No new npm dependencies required ✅

---

## Phase Breakdown

### **Phase 1: Core Bidding Infrastructure** (8-10 hours)
**Goal**: Implement BidManager with create, submit, close, and aggregation tools

**Deliverables**:
1. `BidManager` class with hybrid storage
2. 8 MCP tools registered (bid.*)
3. Unit tests (100% coverage)
4. Integration tests (agent-dev validation)

---

### **Phase 2: Documentation & Validation** (2-4 hours)
**Goal**: Complete user documentation and validation artifacts

**Deliverables**:
1. User guide for bidding
2. MCP tool reference
3. Technical architecture updates
4. Agent-dev validation script

---

## Detailed Task Breakdown

### Task Group 1: BidManager Implementation (4 hours)

#### Task 1.1: Create BidManager Skeleton (30 min)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**Implementation**:
```typescript
import { IDocumentStore } from '../../common/persistence/interfaces';
import { RedisClientType } from 'redis';
import { ScopeResolver } from './scope-resolver';
import { Logger } from 'pino';

export class BidManager {
  constructor(
    private docStore: IDocumentStore,
    private redis: RedisClientType,
    private scopeResolver: ScopeResolver,
    private logger: Logger
  ) {}

  // Placeholder methods (to be implemented)
  async create(params: CreateBidSessionParams): Promise<BidSessionResult> {
    throw new Error('Not implemented');
  }

  async submit(params: SubmitBidParams): Promise<SubmitBidResult> {
    throw new Error('Not implemented');
  }

  async close(params: CloseBidSessionParams): Promise<CloseBidSessionResult> {
    throw new Error('Not implemented');
  }

  async getMax(params: GetMaxBidParams): Promise<BidEntry> {
    throw new Error('Not implemented');
  }

  async getMin(params: GetMinBidParams): Promise<BidEntry> {
    throw new Error('Not implemented');
  }

  async getClosest(params: GetClosestBidParams): Promise<BidEntry> {
    throw new Error('Not implemented');
  }

  async list(params: ListBidSessionsParams): Promise<BidSession[]> {
    throw new Error('Not implemented');
  }

  async getResults(params: GetBidResultsParams): Promise<BidResult[]> {
    throw new Error('Not implemented');
  }
}
```

**Acceptance Criteria**:
- TypeScript compiles without errors
- All method signatures match architecture spec
- Constructor takes 4 dependencies
- Exports all types (interfaces)

---

#### Task 1.2: Add TypeScript Interfaces (30 min)
**Priority**: P0
**File**: `src/services/utility/types.ts` (extend existing)

**Add Interfaces**:
```typescript
// Session Types
export interface BidSession {
  id: string;
  name: string;
  scopeType: 'global' | 'stream' | 'user' | 'session' | 'custom';
  scopeValue: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata: Record<string, any>;
  createdAt: string;
  expiresAt?: string;
  closedAt?: string;
  createdBy: string;
  status: 'active' | 'closed' | 'expired';
}

export interface BidEntry {
  sessionId: string;
  userId: string;
  userName?: string;
  value: number;
  submittedAt: string;
  difference?: number;
}

export interface BidResult {
  id: string;
  sessionId: string;
  closedAt: string;
  totalEntries: number;
  winner?: {
    userId: string;
    userName?: string;
    value: number;
    difference?: number;
  };
  statistics: {
    max: number;
    min: number;
    mean: number;
    median: number;
    stdDev?: number;
  };
  allEntries: Array<{
    userId: string;
    userName?: string;
    value: number;
    submittedAt: string;
  }>;
  metadata: Record<string, any>;
}

// Params Types
export interface CreateBidSessionParams {
  name: string;
  scopeType?: string;
  scopeValue?: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata?: Record<string, any>;
  createdBy?: string;
  event?: any;
}

export interface SubmitBidParams {
  session: string;
  user: string;
  userName?: string;
  value: number;
  metadata?: Record<string, any>;
}

export interface CloseBidSessionParams {
  session: string;
  computeWinner?: boolean;
  deleteRedisHash?: boolean;
}

export interface GetMaxBidParams {
  session: string;
}

export interface GetMinBidParams {
  session: string;
}

export interface GetClosestBidParams {
  session: string;
  target?: number;
}

export interface ListBidSessionsParams {
  scopeType?: string;
  scopeValue?: string;
  status?: 'active' | 'closed' | 'expired';
  limit?: number;
}

export interface GetBidResultsParams {
  sessionId?: string;
  scopeType?: string;
  scopeValue?: string;
  limit?: number;
  orderBy?: 'closedAt' | 'totalEntries';
}

// Result Types
export interface BidSessionResult {
  success: boolean;
  sessionId: string;
  sessionKey: string;
  expiresAt?: string;
  error?: string;
}

export interface SubmitBidResult {
  success: boolean;
  entryId: string;
  previousValue?: number;
  newValue?: number;
  error?: string;
}

export interface CloseBidSessionResult {
  success: boolean;
  sessionId: string;
  closedAt: string;
  finalCount: number;
  winner?: {
    userId: string;
    value: number;
    difference?: number;
  };
  statistics?: {
    max: number;
    min: number;
    mean: number;
    median: number;
  };
  error?: string;
}
```

**Acceptance Criteria**:
- All interfaces exported
- TypeScript strict mode passes
- Matches architecture specification

---

#### Task 1.3: Implement `create()` Method (45 min)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**Implementation Pattern** (from architecture):
```typescript
async create(params: CreateBidSessionParams): Promise<BidSessionResult> {
  try {
    // 1. Resolve scope
    const scope = this.scopeResolver.resolve(
      { scopeType: params.scopeType, scopeValue: params.scopeValue },
      params.event
    );

    const id = `${scope.scopeType}:${scope.scopeValue}:${params.name}`;

    // 2. Create session metadata in DocumentStore
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
      createdBy: params.createdBy || 'system',
      status: 'active'
    };

    await this.docStore.set('bid_sessions', id, session);

    // 3. Initialize Redis hash with metadata
    const hashKey = `bid:session:${id}`;
    await this.redis.hSet(hashKey, '_metadata', JSON.stringify({
      targetValue: params.targetValue,
      createdAt: session.createdAt
    }));

    if (params.ttlSeconds) {
      await this.redis.expire(hashKey, params.ttlSeconds);
    }

    this.logger.info('bid.session.created', { id, hashKey, ttlSeconds: params.ttlSeconds });

    return {
      success: true,
      sessionId: id,
      sessionKey: hashKey,
      expiresAt: session.expiresAt
    };
  } catch (error) {
    this.logger.error('bid.create.failed', { error, params });
    return {
      success: false,
      sessionId: '',
      sessionKey: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

**Acceptance Criteria**:
- Creates DocumentStore document
- Creates Redis hash with `_metadata` field
- Sets TTL if specified
- Returns sessionId and hashKey
- Handles errors gracefully

---

#### Task 1.4: Implement `submit()` Method (30 min)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**Implementation**:
```typescript
async submit(params: SubmitBidParams): Promise<SubmitBidResult> {
  try {
    const hashKey = `bid:session:${params.session}`;
    const userKey = `user:${params.user}`;

    // Get previous value (if any)
    const previousValue = await this.redis.hGet(hashKey, userKey);

    // Atomic upsert
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
      previousValue: previousValue ? parseFloat(previousValue) : undefined,
      newValue: params.value
    };
  } catch (error) {
    this.logger.error('bid.submit.failed', { error, params });
    return {
      success: false,
      entryId: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

**Acceptance Criteria**:
- Uses `HSET` for atomic upsert
- Returns previous value if user updated bid
- Logs submission with details
- Handles errors gracefully

---

#### Task 1.5: Implement Aggregation Methods (1.5 hours)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**Helper Method** (parse hash entries):
```typescript
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
    userName: entry.user,
    value: entry.value,
    submittedAt: new Date().toISOString()
  };
}
```

**getMax()**:
```typescript
async getMax(params: GetMaxBidParams): Promise<BidEntry> {
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
```

**getMin()**: Similar to getMax, use `entry.value < min.value`

**getClosest()**:
```typescript
async getClosest(params: GetClosestBidParams): Promise<BidEntry> {
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
```

**Acceptance Criteria**:
- All 3 methods handle empty sessions (throw error)
- `getClosest` uses session target if not specified
- Client-side sorting implementation
- Returns `BidEntry` format

---

#### Task 1.6: Implement `close()` Method (1 hour)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**Implementation**:
```typescript
async close(params: CloseBidSessionParams): Promise<CloseBidSessionResult> {
  try {
    const hashKey = `bid:session:${params.session}`;
    const allBids = await this.redis.hGetAll(hashKey);

    const entries = this.parseHashEntries(allBids);
    const closedAt = new Date().toISOString();

    // Compute statistics
    const values = entries.map(e => e.value);
    const statistics = {
      max: Math.max(...values),
      min: Math.min(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: this.computeMedian(values)
    };

    // Compute winner (if targetValue exists)
    let winner: CloseBidSessionResult['winner'];
    if (params.computeWinner) {
      const metadataJson = allBids['_metadata'];
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson);
        if (metadata.targetValue !== undefined) {
          const sorted = entries.sort((a, b) =>
            Math.abs(a.value - metadata.targetValue) - Math.abs(b.value - metadata.targetValue)
          );
          const winnerEntry = sorted[0];
          winner = {
            userId: winnerEntry.user,
            value: winnerEntry.value,
            difference: Math.abs(winnerEntry.value - metadata.targetValue)
          };
        }
      }
    }

    // Update session metadata in DocumentStore
    await this.docStore.set('bid_sessions', params.session, {
      closedAt,
      status: 'closed'
    }, true); // merge

    // Snapshot results to DocumentStore
    await this.docStore.set('bid_results', `${params.session}:${Date.now()}`, {
      id: `${params.session}:${Date.now()}`,
      sessionId: params.session,
      closedAt,
      totalEntries: entries.length,
      winner,
      statistics,
      allEntries: entries.map(e => ({
        userId: e.user,
        value: e.value,
        submittedAt: closedAt
      })),
      metadata: {}
    });

    // Optionally delete Redis hash
    if (params.deleteRedisHash) {
      await this.redis.del(hashKey);
    }

    this.logger.info('bid.session.closed', {
      session: params.session,
      totalEntries: entries.length,
      winner
    });

    return {
      success: true,
      sessionId: params.session,
      closedAt,
      finalCount: entries.length,
      winner,
      statistics
    };
  } catch (error) {
    this.logger.error('bid.close.failed', { error, params });
    throw error;
  }
}

private computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
```

**Acceptance Criteria**:
- Computes statistics (max, min, mean, median)
- Determines winner if targetValue exists
- Snapshots to DocumentStore (bid_results)
- Updates session status to 'closed'
- Optionally deletes Redis hash

---

#### Task 1.7: Implement `list()` and `getResults()` (30 min)
**Priority**: P0
**File**: `src/services/utility/bid-manager.ts`

**list()**:
```typescript
async list(params: ListBidSessionsParams): Promise<BidSession[]> {
  const filters: any[] = [];

  if (params.scopeType) {
    filters.push({ field: 'scopeType', operator: '==', value: params.scopeType });
  }

  if (params.scopeValue) {
    filters.push({ field: 'scopeValue', operator: '==', value: params.scopeValue });
  }

  if (params.status) {
    filters.push({ field: 'status', operator: '==', value: params.status });
  }

  return await this.docStore.query<BidSession>('bid_sessions', {
    filters,
    limit: params.limit || 50
  });
}
```

**getResults()**:
```typescript
async getResults(params: GetBidResultsParams): Promise<BidResult[]> {
  const filters: any[] = [];

  if (params.sessionId) {
    filters.push({ field: 'sessionId', operator: '==', value: params.sessionId });
  }

  if (params.scopeType) {
    filters.push({ field: 'metadata.scopeType', operator: '==', value: params.scopeType });
  }

  if (params.scopeValue) {
    filters.push({ field: 'metadata.scopeValue', operator: '==', value: params.scopeValue });
  }

  return await this.docStore.query<BidResult>('bid_results', {
    filters,
    limit: params.limit || 50,
    orderBy: params.orderBy
      ? { field: params.orderBy, direction: 'desc' }
      : { field: 'closedAt', direction: 'desc' }
  });
}
```

**Acceptance Criteria**:
- Both methods query DocumentStore
- Support optional filters
- Default limit: 50
- getResults ordered by closedAt (descending)

---

### Task Group 2: MCP Tools Registration (2 hours)

#### Task 2.1: Register All 8 Bid Tools (2 hours)
**Priority**: P0
**File**: `src/apps/utility-service.ts`

**Add Method**:
```typescript
private registerBidTools(): void {
  // 1. bid.create
  this.registerTool(
    'bid.create',
    'Create a new bid session with optional target value and TTL',
    z.object({
      name: z.string().min(1).max(64),
      scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
      scopeValue: z.string().optional(),
      targetValue: z.number().optional(),
      ttlSeconds: z.number().positive().optional(),
      metadata: z.record(z.any()).optional(),
      createdBy: z.string().optional(),
      event: z.any().optional()
    }),
    async (params) => {
      const result = await this.getBidManager().create(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 2. bid.submit
  this.registerTool(
    'bid.submit',
    'Submit or update a user bid in an active session',
    z.object({
      session: z.string(),
      user: z.string(),
      userName: z.string().optional(),
      value: z.number(),
      metadata: z.record(z.any()).optional()
    }),
    async (params) => {
      const result = await this.getBidManager().submit(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 3. bid.getMax
  this.registerTool(
    'bid.getMax',
    'Get the highest bid in a session',
    z.object({
      session: z.string()
    }),
    async (params) => {
      const result = await this.getBidManager().getMax(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 4. bid.getMin
  this.registerTool(
    'bid.getMin',
    'Get the lowest bid in a session',
    z.object({
      session: z.string()
    }),
    async (params) => {
      const result = await this.getBidManager().getMin(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 5. bid.getClosest
  this.registerTool(
    'bid.getClosest',
    'Get the bid closest to the target value',
    z.object({
      session: z.string(),
      target: z.number().optional()
    }),
    async (params) => {
      const result = await this.getBidManager().getClosest(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 6. bid.close
  this.registerTool(
    'bid.close',
    'Close a bid session and snapshot results to DocumentStore',
    z.object({
      session: z.string(),
      computeWinner: z.boolean().default(true),
      deleteRedisHash: z.boolean().default(false)
    }),
    async (params) => {
      const result = await this.getBidManager().close(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 7. bid.list
  this.registerTool(
    'bid.list',
    'List bid sessions by scope and status',
    z.object({
      scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
      scopeValue: z.string().optional(),
      status: z.enum(['active', 'closed', 'expired']).optional(),
      limit: z.number().positive().default(50)
    }),
    async (params) => {
      const result = await this.getBidManager().list(params);
      return JSON.stringify(result, null, 2);
    }
  );

  // 8. bid.results
  this.registerTool(
    'bid.results',
    'Query historical bid results for analytics',
    z.object({
      sessionId: z.string().optional(),
      scopeType: z.string().optional(),
      scopeValue: z.string().optional(),
      limit: z.number().positive().default(50),
      orderBy: z.enum(['closedAt', 'totalEntries']).default('closedAt')
    }),
    async (params) => {
      const result = await this.getBidManager().getResults(params);
      return JSON.stringify(result, null, 2);
    }
  );

  this.logger.info('Bid tools registered', { count: 8 });
}
```

**Add Lazy Initialization**:
```typescript
private bidManager?: BidManager;

private getBidManager(): BidManager {
  if (!this.bidManager) {
    this.bidManager = new BidManager(
      this.getResource<IDocumentStore>('documentStore'),
      this.getResource<RedisClientType>('redis'),
      this.scopeResolver,
      this.getLogger()
    );
  }
  return this.bidManager;
}
```

**Update `setup()` Method**:
```typescript
async setup(): Promise<void> {
  // ... existing counter tools registration
  this.registerCounterTools();

  // NEW: Register bid tools
  this.registerBidTools();
}
```

**Acceptance Criteria**:
- All 8 tools registered
- Zod schemas validate inputs
- Tool handlers call BidManager methods
- Tools appear in `bit.info` output
- Lazy initialization pattern used

---

### Task Group 3: Unit Tests (3 hours)

#### Task 3.1: Create BidManager Test File (3 hours)
**Priority**: P0
**File**: `src/services/utility/bid-manager.test.ts`

**Test Structure** (25+ tests):
```typescript
import { BidManager } from './bid-manager';
import { ScopeResolver } from './scope-resolver';
import { IDocumentStore } from '../../common/persistence/interfaces';
import { RedisClientType } from 'redis';
import pino from 'pino';

describe('BidManager', () => {
  let bidManager: BidManager;
  let mockDocStore: jest.Mocked<IDocumentStore>;
  let mockRedis: any;
  let mockLogger: any;

  beforeEach(() => {
    // Mock DocumentStore
    mockDocStore = {
      set: jest.fn(),
      get: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
      batch: jest.fn(),
      health: jest.fn()
    } as any;

    // Mock Redis
    const hashStorage: Record<string, Record<string, string>> = {};
    mockRedis = {
      hSet: jest.fn((key, field, value) => {
        if (!hashStorage[key]) hashStorage[key] = {};
        hashStorage[key][field] = value;
        return Promise.resolve(1);
      }),
      hGet: jest.fn((key, field) => {
        return Promise.resolve(hashStorage[key]?.[field] || null);
      }),
      hGetAll: jest.fn((key) => {
        return Promise.resolve(hashStorage[key] || {});
      }),
      hLen: jest.fn((key) => {
        return Promise.resolve(Object.keys(hashStorage[key] || {}).length);
      }),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn((key) => {
        delete hashStorage[key];
        return Promise.resolve(1);
      })
    };

    mockLogger = pino({ level: 'silent' });

    bidManager = new BidManager(
      mockDocStore,
      mockRedis,
      new ScopeResolver(mockLogger),
      mockLogger
    );
  });

  describe('create()', () => {
    it('should create session with metadata in DocumentStore', async () => {
      const result = await bidManager.create({
        name: 'test_session',
        scopeType: 'stream',
        scopeValue: 'test_channel',
        targetValue: 100
      });

      expect(result.success).toBe(true);
      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_sessions',
        expect.stringContaining('test_session'),
        expect.objectContaining({
          name: 'test_session',
          targetValue: 100,
          status: 'active'
        })
      );
    });

    it('should initialize Redis hash with _metadata field', async () => {
      await bidManager.create({
        name: 'test_session',
        targetValue: 100
      });

      expect(mockRedis.hSet).toHaveBeenCalledWith(
        expect.stringContaining('test_session'),
        '_metadata',
        expect.stringContaining('"targetValue":100')
      );
    });

    it('should set TTL if specified', async () => {
      await bidManager.create({
        name: 'test_session',
        ttlSeconds: 3600
      });

      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.any(String),
        3600
      );
    });

    it('should handle missing event context (default to global scope)', async () => {
      const result = await bidManager.create({
        name: 'global_session'
      });

      expect(result.sessionId).toContain('global:');
    });
  });

  describe('submit()', () => {
    it('should submit new bid', async () => {
      const result = await bidManager.submit({
        session: 'test_session',
        user: 'alice',
        value: 99
      });

      expect(result.success).toBe(true);
      expect(mockRedis.hSet).toHaveBeenCalledWith(
        'bid:session:test_session',
        'user:alice',
        '99'
      );
    });

    it('should update existing bid (upsert)', async () => {
      await bidManager.submit({ session: 'test', user: 'alice', value: 50 });
      const result = await bidManager.submit({ session: 'test', user: 'alice', value: 75 });

      expect(result.success).toBe(true);
      expect(result.previousValue).toBe(50);
      expect(result.newValue).toBe(75);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.hSet.mockRejectedValueOnce(new Error('Redis down'));

      const result = await bidManager.submit({
        session: 'test',
        user: 'alice',
        value: 99
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis down');
    });
  });

  describe('getMax()', () => {
    beforeEach(async () => {
      await bidManager.submit({ session: 'test', user: 'alice', value: 50 });
      await bidManager.submit({ session: 'test', user: 'bob', value: 75 });
      await bidManager.submit({ session: 'test', user: 'charlie', value: 60 });
    });

    it('should return highest bid', async () => {
      const result = await bidManager.getMax({ session: 'test' });

      expect(result.userId).toBe('bob');
      expect(result.value).toBe(75);
    });

    it('should throw error if no bids exist', async () => {
      await expect(bidManager.getMax({ session: 'empty' }))
        .rejects.toThrow('No bids found');
    });
  });

  describe('getMin()', () => {
    beforeEach(async () => {
      await bidManager.submit({ session: 'test', user: 'alice', value: 50 });
      await bidManager.submit({ session: 'test', user: 'bob', value: 75 });
    });

    it('should return lowest bid', async () => {
      const result = await bidManager.getMin({ session: 'test' });

      expect(result.userId).toBe('alice');
      expect(result.value).toBe(50);
    });
  });

  describe('getClosest()', () => {
    beforeEach(async () => {
      await mockRedis.hSet('bid:session:test', '_metadata', JSON.stringify({ targetValue: 100 }));
      await bidManager.submit({ session: 'test', user: 'alice', value: 99 });
      await bidManager.submit({ session: 'test', user: 'bob', value: 105 });
      await bidManager.submit({ session: 'test', user: 'charlie', value: 50 });
    });

    it('should return bid closest to target', async () => {
      const result = await bidManager.getClosest({ session: 'test' });

      expect(result.userId).toBe('alice');
      expect(result.value).toBe(99);
      expect(result.difference).toBe(1);
    });

    it('should use explicit target if provided', async () => {
      const result = await bidManager.getClosest({ session: 'test', target: 104 });

      expect(result.userId).toBe('bob');
      expect(result.value).toBe(105);
      expect(result.difference).toBe(1);
    });

    it('should throw error if no target specified', async () => {
      await mockRedis.hSet('bid:session:no_target', '_metadata', JSON.stringify({}));
      await bidManager.submit({ session: 'no_target', user: 'alice', value: 50 });

      await expect(bidManager.getClosest({ session: 'no_target' }))
        .rejects.toThrow('No target value specified');
    });
  });

  describe('close()', () => {
    beforeEach(async () => {
      await mockRedis.hSet('bid:session:test', '_metadata', JSON.stringify({ targetValue: 100 }));
      await bidManager.submit({ session: 'test', user: 'alice', value: 99 });
      await bidManager.submit({ session: 'test', user: 'bob', value: 105 });
    });

    it('should compute statistics', async () => {
      const result = await bidManager.close({ session: 'test' });

      expect(result.statistics).toEqual({
        max: 105,
        min: 99,
        mean: 102,
        median: 102
      });
    });

    it('should compute winner if targetValue exists', async () => {
      const result = await bidManager.close({ session: 'test', computeWinner: true });

      expect(result.winner).toEqual({
        userId: 'alice',
        value: 99,
        difference: 1
      });
    });

    it('should snapshot results to DocumentStore', async () => {
      await bidManager.close({ session: 'test' });

      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_results',
        expect.any(String),
        expect.objectContaining({
          sessionId: 'test',
          totalEntries: 2,
          statistics: expect.any(Object)
        })
      );
    });

    it('should update session status to closed', async () => {
      await bidManager.close({ session: 'test' });

      expect(mockDocStore.set).toHaveBeenCalledWith(
        'bid_sessions',
        'test',
        expect.objectContaining({
          status: 'closed'
        }),
        true // merge
      );
    });

    it('should delete Redis hash if requested', async () => {
      await bidManager.close({ session: 'test', deleteRedisHash: true });

      expect(mockRedis.del).toHaveBeenCalledWith('bid:session:test');
    });
  });

  describe('list()', () => {
    it('should query DocumentStore with filters', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await bidManager.list({
        scopeType: 'stream',
        scopeValue: 'test_channel',
        status: 'active'
      });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_sessions', {
        filters: [
          { field: 'scopeType', operator: '==', value: 'stream' },
          { field: 'scopeValue', operator: '==', value: 'test_channel' },
          { field: 'status', operator: '==', value: 'active' }
        ],
        limit: 50
      });
    });
  });

  describe('getResults()', () => {
    it('should query bid_results collection', async () => {
      mockDocStore.query.mockResolvedValue([]);

      await bidManager.getResults({
        sessionId: 'test_session'
      });

      expect(mockDocStore.query).toHaveBeenCalledWith('bid_results', {
        filters: [
          { field: 'sessionId', operator: '==', value: 'test_session' }
        ],
        limit: 50,
        orderBy: { field: 'closedAt', direction: 'desc' }
      });
    });
  });
});
```

**Acceptance Criteria**:
- 25+ test cases covering all methods
- 100% code coverage for BidManager
- All tests pass (`npm test`)
- Mocks for DocumentStore and Redis
- No test interdependencies

---

### Task Group 4: Integration Tests (2 hours)

#### Task 4.1: Create Agent-Dev Validation Script (1 hour)
**Priority**: P0
**File**: `planning/bidding-system/validate_bidding.sh`

**Script Content**:
```bash
#!/bin/bash
set -e

echo "=== Bidding System Validation ==="
echo ""

# 1. Check utility-service health
echo "1. Checking utility-service health..."
# Use MCP tool: fleet.health({ bit: "utility" })
# Expected: healthy status

# 2. Verify bid tools registered
echo "2. Verifying bid tools registered..."
# Use MCP tool: fleet.info({ bit: "utility" })
# Expected: 8 bid.* tools in output

# 3. Create test session
echo "3. Creating test bid session..."
# Use MCP tool: bid.create({
#   name: "test_session",
#   targetValue: 100,
#   ttlSeconds: 3600
# })
# Expected: success=true, sessionId returned

# 4. Submit multiple bids
echo "4. Submitting test bids..."
# bid.submit({ session: "test_session", user: "alice", value: 99 })
# bid.submit({ session: "test_session", user: "bob", value: 105 })
# bid.submit({ session: "test_session", user: "charlie", value: 75 })

# 5. Query aggregations
echo "5. Testing aggregation queries..."
# bid.getMax({ session: "test_session" })
# Expected: user=bob, value=105
# bid.getMin({ session: "test_session" })
# Expected: user=charlie, value=75
# bid.getClosest({ session: "test_session" })
# Expected: user=alice, value=99, difference=1

# 6. Close session
echo "6. Closing session..."
# bid.close({ session: "test_session", computeWinner: true })
# Expected: winner=alice, finalCount=3, statistics computed

# 7. Verify DocumentStore snapshot
echo "7. Verifying snapshot in DocumentStore..."
# bid.results({ sessionId: "test_session" })
# Expected: 1 result found with correct data

# 8. List sessions
echo "8. Listing sessions..."
# bid.list({ status: "closed" })
# Expected: test_session in results

echo ""
echo "=== All Validation Tests Passed ==="
exit 0
```

**Acceptance Criteria**:
- Script tests all 8 MCP tools
- Multi-user submission scenario
- Aggregation correctness verification
- DocumentStore snapshot validation
- Exits 0 on success

---

#### Task 4.2: Execute Agent-Dev Validation (1 hour)
**Priority**: P0

**Steps**:
```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-bidding-test" })

# 2. Deploy utility-service
bit deploy utility --context agent-dev-bidding-test

# 3. Verify service health
fleet.health({ bit: "utility", context: "agent-dev-bidding-test" })

# 4. Run validation script
bash planning/bidding-system/validate_bidding.sh

# 5. Check logs for errors
fleet.logs({ bit: "utility", context: "agent-dev-bidding-test", limit: 100 })

# 6. Cleanup
agent_dev.destroy({ name: "agent-dev-bidding-test", confirm: true })
```

**Acceptance Criteria**:
- Service deploys successfully
- All MCP tools callable
- Validation script passes
- No error-level logs
- Agent-dev context destroys cleanly

---

### Task Group 5: Documentation (2 hours)

#### Task 5.1: Write User Guide (1 hour)
**Priority**: P1
**File**: `documentation/guides/utility-bidding.md`

**Sections**:
1. Overview (bidding concepts)
2. Creating bid sessions
3. User bid submission
4. Querying results (max, min, closest)
5. Closing sessions
6. Historical analytics
7. Common patterns
8. Best practices
9. Troubleshooting

**Acceptance Criteria**:
- Markdown renders correctly
- Code examples compile
- LLM usage examples included
- Platform patterns referenced

---

#### Task 5.2: Write MCP Tool Reference (1 hour)
**Priority**: P1
**File**: `documentation/reference/utility-tools.md` (update existing)

**Add Bidding Section**:
- All 8 bid.* tools documented
- Zod schemas shown
- Parameter descriptions
- Return value schemas
- Error codes
- Usage examples

**Acceptance Criteria**:
- Tool signatures match implementation
- Examples are accurate
- Integrated with existing counter tools docs

---

## Validation Checklist

### Pre-Implementation
- [ ] Phase 1 (Counters) complete and deployed
- [ ] Existing resources verified (DocumentStore, Redis)
- [ ] Architecture document reviewed
- [ ] Execution plan approved

### During Implementation
- [ ] All TypeScript compiles without errors
- [ ] Unit tests pass (25+ tests, 100% coverage)
- [ ] Integration tests pass (agent-dev validation)
- [ ] No imports from `deprecated/`
- [ ] Logging includes structured context

### Post-Implementation
- [ ] All 8 MCP tools registered
- [ ] Tools appear in `bit.info` output
- [ ] Agent-dev deployment successful
- [ ] No error-level logs in fleet.logs
- [ ] Documentation complete
- [ ] Sprint artifacts created

---

## Risk Mitigation

### Risk 1: Redis Hash Performance
**Probability**: Low
**Impact**: Medium
**Mitigation**: Load test with 1000 users, verify p99 <100ms

### Risk 2: Client-Side Sort Overhead
**Probability**: Medium
**Impact**: Low
**Mitigation**: Benchmark sort with 1000 entries, consider Redis Sorted Sets if needed

### Risk 3: Session Collision
**Probability**: Low
**Impact**: Low
**Mitigation**: Append timestamp to session ID on duplicate, document in error handling

### Risk 4: TTL Desync
**Probability**: Medium
**Impact**: Low
**Mitigation**: Document expected behavior, consider cleanup job in future

---

## Success Criteria

### Functional
✅ All 8 bid tools callable and functional
✅ Multi-user bid submission works (concurrency)
✅ Aggregation queries return correct results
✅ Session close snapshots to DocumentStore
✅ Historical queries work

### Non-Functional
✅ Bid submission latency <50ms (p99)
✅ Aggregation query latency <100ms (p99)
✅ 100% unit test coverage
✅ Integration tests pass
✅ No error-level logs

### Documentation
✅ User guide complete
✅ MCP tool reference updated
✅ Technical architecture finalized

---

## Timeline Estimate

| Task Group | Hours | Cumulative |
|------------|-------|------------|
| BidManager Implementation | 4 | 4 |
| MCP Tools Registration | 2 | 6 |
| Unit Tests | 3 | 9 |
| Integration Tests | 2 | 11 |
| Documentation | 2 | 13 |

**Total**: 10-14 hours (1-2 days for single implementor)

---

## Next Steps

1. **Approve Execution Plan**: Review and sign off
2. **Create Sprint Backlog**: Convert to trackable YAML
3. **Begin Implementation**: Start with Task 1.1 (BidManager skeleton)
4. **Continuous Testing**: Run tests after each task group
5. **Agent-Dev Validation**: Deploy early and often
6. **Sprint Completion**: Document findings, create PR

---

## References

- **Architecture**: BIDDING-SYSTEM-ARCHITECTURE.md
- **Sprint 27 Research**: `planning/sprint-27-6tp11t/`
- **Counter Implementation**: `src/services/utility/counter-manager.ts`
- **ScopeResolver**: `src/services/utility/scope-resolver.ts`
- **Claim Check Pattern**: `src/apps/claim-check-service.ts`

---

**Status**: Ready for Implementation
**Next Artifact**: Trackable YAML Backlog
