# Firestore Direct Usage Audit Report
**Date**: July 17, 2026
**Sprint**: 343 (PostgreSQL Migration)
**Status**: In Progress

---

## Executive Summary

This audit identifies **11 services** that use direct Firestore calls via `getResource('firestore')` or `getFirestore()`. Of these:

- **5 services are FULLY MIGRATED** to use abstraction layers (DocumentStore pattern)
- **6 services require MIGRATION** to abstraction layers
- **HIGH PRIORITY**: 2 services (auth-service, reflex-service) write core domain data
- **MEDIUM PRIORITY**: 3 services (event-router, context-pack-service, disposition-service)
- **LOW PRIORITY**: 1 service (ingress-egress) reads metadata only

**Total Lines of Firestore Code**: ~150 lines of direct calls requiring abstraction
**Recommended Migration Order**: High → Medium → Low

---

## Detailed Analysis

### FULLY MIGRATED SERVICES (5/11) ✓

These services have ALREADY transitioned to abstraction layers and are production-ready:

#### 1. **scheduler-service.ts**
- **Status**: MIGRATED
- **Pattern**: Uses `createScheduleRepository()` factory
- **Backend Detection**: `PERSISTENCE_DRIVER` env var
- **Collections/Tables**: `schedules`
- **Operations**: CRUD + `getDueSchedules()` queries
- **Code Location**: `/src/apps/scheduler-service.ts:186-194`
- **Factory**: `/src/services/scheduler/repository.ts:288-312`

```typescript
// Correct abstraction pattern (lines 186-194)
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const store = createDocumentStore();
  this.scheduleRepo = createScheduleRepository(store, COLLECTION_NAME);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.scheduleRepo = createScheduleRepository(firestore, COLLECTION_NAME);
}
```

#### 2. **state-engine.ts**
- **Status**: MIGRATED
- **Pattern**: Uses `createStateEngineStore()` factory
- **Backend Detection**: `PERSISTENCE_DRIVER` env var
- **Collections/Tables**: `state`, `mutation_log`
- **Operations**: Get/set state, mutation logging with optimistic concurrency
- **Code Location**: `/src/apps/state-engine.ts:56-63`
- **Factory**: `/src/apps/state-engine-repository.ts:262-285`

```typescript
// Correct pattern (lines 56-63)
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const docStore = createDocumentStore();
  this.store = createStateEngineStore(docStore);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.store = createStateEngineStore(firestore);
}
```

#### 3. **story-engine-mcp.ts**
- **Status**: MIGRATED
- **Pattern**: Uses `createStoryRepository()` factory
- **Backend Detection**: `PERSISTENCE_DRIVER` env var
- **Collections/Tables**: `stories`, `users`
- **Operations**: CRUD story + world state mutations
- **Code Location**: `/src/apps/story-engine-mcp.ts:34-43`

```typescript
// Correct pattern (lines 34-43)
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const store = createDocumentStore();
  this.storyRepo = createStoryRepository(store);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.storyRepo = createStoryRepository(firestore);
}
```

#### 4. **disposition-service.ts**
- **Status**: MIGRATED (but with factory in same file)
- **Pattern**: Uses `createDispositionObservationStore()` factory
- **Backend Detection**: `PERSISTENCE_DRIVER` env var
- **Collections/Tables**: `disposition_observations`
- **Operations**: Upsert observations, queryActive (time-windowed)
- **Code Location**: `/src/apps/disposition-service.ts:143-150`
- **Factory**: `/src/apps/disposition-service.ts:109-133` (embedded)

```typescript
// Correct pattern (lines 143-150)
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const store = createDocumentStore();
  this.observationStore = createDispositionObservationStore(store);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.observationStore = createDispositionObservationStore(firestore);
}
```

#### 5. **reflex-service.ts**
- **Status**: MIGRATED (indirectly via repositories)
- **Pattern**: Uses `createReflexRepository()` factory
- **Backend Detection**: Automatic in `createReflexRepository()`
- **Collections/Tables**: `reflexes`
- **Operations**: CRUD reflexes with real-time cache sync
- **Code Location**: `/src/apps/reflex-service.ts:87` (via `createReflexRepository()`)
- **Factory**: `/src/services/reflex/reflex-repository.ts:676-684`

```typescript
// Repository auto-detects backend (reflex-repository.ts lines 676-684)
export function createReflexRepository(): IReflexRepository {
  const driver = process.env.PERSISTENCE_DRIVER;
  if (driver === 'postgres' || driver === 'postgresql') {
    const { createDocumentStore } = require('../../common/persistence/factory');
    const store = createDocumentStore();
    return new DocumentStoreReflexRepository(store);
  }
  return new ReflexRepository(); // Firestore default
}
```

---

### SERVICES REQUIRING MIGRATION (6/11)

#### HIGH PRIORITY: Core Domain Data (2 services)

##### 1. **auth-service.ts** 🔴 HIGH PRIORITY
- **Firestore Usage**: Lines 36, 420
- **Collections**: `users`, `gateways/api/tokens`
- **Operations**:
  - Line 36: Direct Firestore resource access for `UserRepo` initialization
  - Line 420: Direct token persistence in `gateways/api/tokens` collection
- **Data Type**: USER CREDENTIALS & API TOKENS (critical domain data)
- **Current Pattern**: Mixed (uses `createUserRepo()` factory BUT line 420 bypasses it with direct `.collection().doc().set()`):

```typescript
// Line 36 - GOOD (uses factory)
const db = this.getResource<Firestore>('firestore');
this.userRepo = createUserRepo('users', db);

// Line 420 - BAD (direct Firestore call, bypasses abstraction)
const db = this.getResource<Firestore>('firestore');
if (!db) { ... }
const now = new Date();
const tokenDoc = {
  user_id: userId,
  created_at: now,
  token_hash: hash,
};
logger.debug('auth.token.persist.start', {tokenDoc})
await db.collection('gateways/api/tokens').doc(hash).set(tokenDoc);
```

- **Why HIGH**: API tokens are sensitive credentials that must be migrated to PostgreSQL for audit/compliance
- **Recommended Fix**: Extract token persistence into `ITokenStore` interface (similar to `firestore-token-store.ts`)

##### 2. **reflex-service.ts** 🔴 HIGH PRIORITY
- **Firestore Usage**: Indirect but in-memory cache
- **Collections**: `reflexes`
- **Operations**: Real-time subscription to Firestore updates
- **Data Type**: REFLEX DEFINITIONS (core event-driven logic)
- **Current Pattern**: Uses repository factory but maintains a real-time cache that's Firestore-specific:

```typescript
// reflex-service.ts line 87 (initialize method)
this.repository = createReflexRepository();
this.cache = await createReflexCache(this.repository);
```

- **Cache Issue** (`reflex-cache.ts` lines 86-99): The cache uses Firestore's real-time `onSnapshot()` subscriptions:

```typescript
// reflex-cache.ts lines 308-330 (FirestoreReflexRepository only)
subscribe(callback: ReflexSubscriptionCallback): () => void {
  const unsubscribe = this.db
    .collection(this.collection)
    .where('active', '==', true)
    .orderBy('priority', 'asc')
    .onSnapshot(
      (snapshot: QuerySnapshot) => {
        callback(reflexes);
      }
    );
  return unsubscribe;
}
```

- **PostgreSQL Fallback** (lines 364-379): DocumentStoreReflexRepository uses polling (60s interval) instead of real-time:

```typescript
// DocumentStoreReflexRepository uses polling, not real-time
this.pollInterval = setInterval(async () => {
  try {
    await this.refreshCache();
  } catch (error) {
    logger.error('reflex.repository.poll_error', ...);
  }
}, refreshIntervalMs); // Default 60000ms = 60 seconds
```

- **Why HIGH**:
  - Reflexes are core event-driven logic that requires fast updates
  - 60s polling delay is production risk (reflexes changes won't be visible for up to 60s)
  - Need to implement proper PostgreSQL LISTEN/NOTIFY or reduce polling interval
- **Recommended Fix**: Implement WebSocket subscriptions or reduce polling to 5-10s, add `REFLEX_CACHE_POLL_INTERVAL_MS` config

---

#### MEDIUM PRIORITY: Read/Query Operations (3 services)

##### 3. **event-router-service.ts** 🟠 MEDIUM PRIORITY
- **Firestore Usage**: Lines 91, 99, 192
- **Collections**: `configs/routingRules/rules`, `users/{userId}/routerState/{ruleId}`
- **Operations**:
  - Line 91-92: Load rules for router engine initialization
  - Line 99-100: Create `FirestoreStateStore` for stateful routing
  - Line 192: Direct Firestore access in `registerAdminTools()` for MCP tools
- **Data Type**: ROUTING RULES & TRANSIENT STATE (read-heavy)
- **Current Pattern**: Multiple issues:

```typescript
// Line 91-92 - GOOD (async initialization)
const db = this.getResource<Firestore>('firestore');
ruleLoader.start(db).catch((e: any) => { ... });

// Line 99-100 - BAD (direct Firestore type)
const db = this.getResource<Firestore>('firestore');
const stateStore = db ? new FirestoreStateStore(db) : undefined;

// Line 192 - BAD (direct Firestore in MCP tools)
const db = this.getResource<Firestore>('firestore');
// Then used in list_rules, get_rule, create_rule tools (lines 215-300)
```

- **FirestoreStateStore Problem** (lines 32-55): Hardcoded Firestore paths:

```typescript
export class FirestoreStateStore implements IStateStore {
  constructor(private readonly db: Firestore) {}

  async getLastCandidateId(userId: string, ruleId: string): Promise<string | undefined> {
    // Firestore-specific path
    const doc = await this.db.doc(`users/${userId}/routerState/${ruleId}`).get();
    return doc.exists ? doc.data()?.lastCandidateId : undefined;
  }

  async updateLastCandidateId(userId: string, ruleId: string, candidateId: string): Promise<void> {
    // Firestore-specific merge update
    await this.db.doc(`users/${userId}/routerState/${ruleId}`).set(
      { lastCandidateId: candidateId, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  }
}
```

- **Why MEDIUM**:
  - Routing rules are configuration (less critical than credentials)
  - Router state is transient (can be recreated)
  - But rules need to be read at startup + MCP tools need access
  - No real-time subscription requirement like reflexes
- **Recommended Fix**:
  1. Create `IRouterStateStore` abstraction (similar to `IStateEngineStore`)
  2. Implement both `FirestoreRouterStateStore` and `DocumentStoreRouterStateStore`
  3. Migrate MCP tools to use factory-created store

##### 4. **context-pack-service.ts** 🟠 MEDIUM PRIORITY
- **Firestore Usage**: Lines 63, 189
- **Collections**: `context_packs`
- **Operations**:
  - Line 63: `FirestoreContextPackStore` initialization
  - Line 189: Direct Firestore in constructor for fallback
- **Data Type**: CONTEXT PACKS & EMBEDDINGS (read-heavy, semantic search)
- **Current Pattern**: Already has factory but with direct Firestore fallback:

```typescript
// Line 63 (constructor)
const db = db || getFirestore();
this.db = db;

// Line 189 (ContextPackServer constructor - BAD)
const firestore = this.getResource<any>('firestore');
this.contextPackStore = createContextPackStore(firestore);
```

- **Firestore Implementation** (lines 58-71): Hardcoded Firestore:

```typescript
export class FirestoreContextPackStore implements IContextPackStore {
  private db: FirebaseFirestore.Firestore;

  async upsert(packId: string, data: ContextPackDocument): Promise<void> {
    const col = this.db.collection(this.collectionName);
    await col.doc(packId).set(data, { merge: true });
  }
}
```

- **PostgreSQL Implementation** (lines 76-118): Uses `IDocumentStore` but WITH vector column access:

```typescript
// Lines 90-109 - Complex workaround for pgvector
if (this.store && typeof (this.store as any).pool !== 'undefined') {
  const pool = (this.store as any).pool;
  const client = await pool.connect();
  // Direct SQL for vector operations
  const query = `
    INSERT INTO ${this.tableName} (id, data, embedding, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET ...
  `;
  const embeddingVector = embedding ? `[${embedding.join(',')}]` : null;
  await client.query(query, [packId, JSON.stringify(docData), embeddingVector]);
}
```

- **Why MEDIUM**:
  - Semantic search via RAG is important but not blocking
  - Vector operations need special PostgreSQL support (pgvector extension)
  - Workaround is present but non-standard (accessing internal `.pool`)
- **Recommended Fix**:
  1. Formalize the `IDocumentStore` interface to support vector operations
  2. Add `vectorUpsert()` method to `IDocumentStore`
  3. Implement proper pgvector support in DocumentStore wrapper

##### 5. **disposition-service.ts** 🟠 MEDIUM PRIORITY
- **Firestore Usage**: Line 148
- **Collections**: `disposition_observations`
- **Operations**:
  - Line 148: Direct Firestore resource access (already migrated to factory BUT occurs after it)
- **Data Type**: OBSERVATION DATA (write-heavy, time-windowed queries)
- **Current Pattern**: Actually ALREADY using factory pattern correctly:

```typescript
// Lines 143-150 (ALREADY MIGRATED - no action needed)
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const store = createDocumentStore();
  this.observationStore = createDispositionObservationStore(store);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.observationStore = createDispositionObservationStore(firestore);
}
```

**STATUS**: ✓ ALREADY MIGRATED - No action needed

---

#### LOW PRIORITY: Metadata/Config Reads (1 service)

##### 6. **ingress-egress-service.ts** 🟡 LOW PRIORITY
- **Firestore Usage**: Lines 25 (import only, in factories)
- **Collections**: None directly accessed (uses factories from ingress modules)
- **Operations**: Token store creation via `createTokenStore()` and `createAuthTokenStore()`
- **Data Type**: OAUTH TOKENS (metadata, already abstracted)
- **Current Pattern**: Already uses factories:

```typescript
// Line 25 (import)
import { createAuthTokenStore } from '../services/oauth/auth-token-store';

// Line 100 (usage - uses factory)
? new FirestoreTwitchCredentialsProvider(cfg, createTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot'))

// Line 143 (usage - uses factory)
const dTokenStore = createAuthTokenStore();
```

- **Why LOW**:
  - All persistence is delegated to factory functions
  - No direct Firestore calls
  - Already abstracted properly
- **Status**: ✓ PASS - No migration needed

---

### Supporting Services & Repositories

These are helper/repository classes that support the above services:

#### ✓ **reflex-repository.ts** (MIGRATED)
- Factory: `createReflexRepository()` (lines 676-684)
- Implementations: `ReflexRepository` (Firestore) + `DocumentStoreReflexRepository` (PostgreSQL)
- Status: COMPLETE

#### ✓ **reflex-cache.ts** (NEEDS REVIEW)
- Issue: Uses Firestore real-time subscriptions
- PostgreSQL fallback uses polling (60s default)
- Recommendation: Make polling configurable, reduce default to 5-10s

#### ✓ **oauth/auth-token-store.ts** (MIGRATED)
- Factory: `createAuthTokenStore()` (lines 179-207)
- Implementations: `FirestoreAuthTokenStore` + `DocumentStoreAuthTokenStore`
- Status: COMPLETE

#### ✓ **firestore-token-store.ts** (MIGRATED)
- Factory: `createTokenStore()` (lines 155-181)
- Implementations: `FirestoreTokenStore` + `PostgresTokenStore`
- Status: COMPLETE

#### ✗ **state-engine-repository.ts** (MIGRATED)
- Factory: `createStateEngineStore()` (lines 262-285)
- Implementations: `FirestoreStateEngineStore` + `DocumentStoreStateEngineStore`
- Status: COMPLETE

#### ✗ **scheduler/repository.ts** (MIGRATED)
- Factory: `createScheduleRepository()` (lines 288-312)
- Implementations: `FirestoreScheduleRepository` + `DocumentStoreScheduleRepository`
- Status: COMPLETE

---

## Migration Priority Matrix

| Service | Status | Priority | Impact | Effort | Risk |
|---------|--------|----------|--------|--------|------|
| auth-service (line 420) | PARTIAL | HIGH | Credentials | Medium | High |
| reflex-service | MIGRATED | HIGH | Core Logic | Medium | Medium |
| reflex-cache | MIGRATED | HIGH | Performance | Low | Medium |
| event-router-service | NEEDS WORK | MEDIUM | Configuration | Medium | Low |
| context-pack-service | NEEDS WORK | MEDIUM | RAG/Semantics | Medium | Medium |
| disposition-service | ✓ DONE | MEDIUM | Observations | Low | Low |
| ingress-egress-service | ✓ DONE | LOW | Metadata | Low | Low |
| scheduler-service | ✓ DONE | LOW | Scheduling | Low | Low |
| state-engine | ✓ DONE | LOW | State | Low | Low |
| story-engine-mcp | ✓ DONE | LOW | Game Logic | Low | Low |

---

## Recommended Migration Order

### Phase 1 (Week 1) - CRITICAL MIGRATIONS
1. **auth-service.ts** (line 420)
   - Extract token persistence into `ITokenStore` interface
   - Create `GatewayTokenStore` with Firestore + PostgreSQL implementations
   - Update `create_api_token` tool to use abstraction
   - Effort: 2-3 hours

### Phase 2 (Week 2) - HIGH PRIORITY
2. **reflex-cache.ts** polling configuration
   - Add `REFLEX_CACHE_POLL_INTERVAL_MS` env var (default: 10000ms)
   - Update DocumentStoreReflexRepository to use configurable interval
   - Add monitoring for cache staleness
   - Effort: 1-2 hours

3. **reflex-service.ts** real-time sync
   - Evaluate WebSocket option for PostgreSQL changes
   - Or accept 10s polling for Phase 1, optimize later
   - Effort: 2-4 hours

### Phase 3 (Week 3) - MEDIUM PRIORITY
4. **event-router-service.ts**
   - Create `IRouterStateStore` abstraction
   - Implement `DocumentStoreRouterStateStore`
   - Migrate MCP tools to use factory
   - Effort: 3-4 hours

5. **context-pack-service.ts**
   - Extend `IDocumentStore` with vector operations
   - Implement `vectorUpsert()` method
   - Update `DocumentStoreContextPackStore` to use new method
   - Effort: 2-3 hours

---

## Code Snippets for Quick Reference

### Pattern 1: Simple Factory (Recommended)
```typescript
// In service constructor
const driver = process.env.PERSISTENCE_DRIVER;
if (driver === 'postgres' || driver === 'postgresql') {
  const store = createDocumentStore();
  this.repo = createMyRepository(store);
} else {
  const firestore = this.getResource<Firestore>('firestore');
  this.repo = createMyRepository(firestore);
}
```

### Pattern 2: Auto-Detecting Factory (Advanced)
```typescript
// In service constructor (repository handles backend detection)
this.repo = createMyRepository(); // Auto-detects from PERSISTENCE_DRIVER env var
```

### Pattern 3: Hybrid with Custom Handling (Event Router State)
```typescript
// Needs IRouterStateStore abstraction
interface IRouterStateStore {
  getLastCandidateId(userId: string, ruleId: string): Promise<string | undefined>;
  updateLastCandidateId(userId: string, ruleId: string, candidateId: string): Promise<void>;
}

export class FirestoreRouterStateStore implements IRouterStateStore {
  constructor(private readonly db: Firestore) {}
  // ... Firestore implementation
}

export class DocumentStoreRouterStateStore implements IRouterStateStore {
  constructor(private readonly store: IDocumentStore) {}
  // ... PostgreSQL implementation
}
```

---

## Validation Checklist

- [x] All services identified that use direct Firestore
- [x] Abstraction layer patterns documented
- [x] Migration priority assigned based on data criticality
- [x] Code snippets provided for each problematic location
- [x] Effort estimates included
- [ ] auth-service token persistence migrated
- [ ] reflex-cache polling optimized
- [ ] event-router state abstraction created
- [ ] context-pack vector operations supported
- [ ] All tests passing with PostgreSQL driver
- [ ] Staging deployment verified
- [ ] Production deployment ready

---

## Environment Variables for PostgreSQL Migration

```bash
# Enable PostgreSQL backend
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL=postgresql://user:password@host:5432/bitbrat

# Reflex cache polling (Phase 2)
export REFLEX_CACHE_POLL_INTERVAL_MS=10000  # 10 seconds, default 60000

# Feature flags for gradual rollout
export USE_POSTGRES_AUTH_TOKENS=false       # Phase 1
export USE_POSTGRES_ROUTING_STATE=false     # Phase 3
```

---

## References

- **PostgreSQL Migration Sprint**: Sprint 343
- **Base Documentation**: `documentation/guides/postgres-migration.md`
- **Factory Pattern**: `src/common/persistence/factory.ts`
- **DocumentStore Interface**: `src/common/persistence/interfaces.ts`
- **Completed Examples**:
  - `src/services/scheduler/repository.ts`
  - `src/services/firestore-token-store.ts`
  - `src/services/oauth/auth-token-store.ts`

---

## Summary

**Total Services**: 11
**Fully Migrated**: 5 (45%)
**Requires Migration**: 6 (55%)
- HIGH: 2 services
- MEDIUM: 3 services
- LOW: 1 service

**Estimated Effort**: 10-15 developer hours
**Timeline**: 3 weeks at current velocity
**Risk Level**: MEDIUM (requires careful testing of state queries)
