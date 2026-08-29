# Execution Plan: Platform Utilities - Counters & Bidding

**Sprint**: sprint-27-6tp11t
**Lead Implementor**: Claude
**Date**: 2026-08-27
**Architecture**: Based on architecture-revision-v2.md

---

## Executive Summary

Implement a new **utility-service** Bit that provides two platform utilities:
1. **Arbitrary Counters** - Scoped counter management with TTL, metadata, and historical snapshots
2. **Bidding Sessions** - User bidding/guessing with aggregation queries (max, min, closest)

**Storage Strategy**:
- Counter metadata → IDocumentStore (platform-agnostic)
- Counter values → Redis simple keys (fast INCR/DECR)
- Bid session metadata → IDocumentStore (persistent, queryable)
- Active bids → Redis Hashes (fast, ephemeral, TTL)
- Bid results → IDocumentStore (historical analytics)

**Hybrid Approach**: Redis for speed + DocumentStore for persistence/queryability.

---

## Architecture Alignment

### Platform Patterns Used
✅ **Bit Model**: Extends `Bit` base class
✅ **DocumentStore**: Uses `IDocumentStore` for metadata (PostgreSQL default)
✅ **Redis**: Direct `RedisClientType` access for Hashes (via ResourceManager)
✅ **MCP Tools**: Registers platform-only tools for LLM integration
✅ **Scoped Resources**: Scope resolution (global, stream, user, session, custom)
✅ **Fail-Open**: Graceful degradation on Redis failures

### Similar Services (Reference)
- **claim-check-service** - Redis + metadata pattern, lazy resource init
- **scheduler-service** - MCP tool registration, platform-only exposure
- **auth-service** - Scope resolution from event context

---

## Implementation Phases

### **Phase 1: Foundation & Counter Tools** ⭐ THIS SPRINT
**Goal**: Implement utility-service with full counter functionality

**Deliverables**:
1. ✅ Create `utility-service` Bit skeleton
2. ✅ Implement `ScopeResolver` (scope inference from event context)
3. ✅ Implement `CounterManager` (DocumentStore + Redis simple keys)
4. ✅ Register 6 counter MCP tools: create, increment, get, delete, list, snapshot
5. ✅ Unit tests for CounterManager (100% coverage)
6. ✅ Integration tests (agent-dev validation)
7. ✅ Update architecture.yaml
8. ✅ Documentation (tool reference, usage guide)

**Estimated Effort**: 12-16 hours

---

### **Phase 2: Bidding Tools** (Future Sprint)
**Goal**: Implement bidding session management with hybrid storage

**Deliverables**:
1. ⏸ Implement `BidManager` (Hybrid: Redis Hashes + DocumentStore)
2. ⏸ Register 8 bid MCP tools: create, submit, close, getMax, getMin, getClosest, list, results
3. ⏸ Unit tests for BidManager (100% coverage)
4. ⏸ Integration tests (multi-user scenarios)
5. ⏸ Documentation (tool reference, usage examples)

**Estimated Effort**: 10-14 hours

---

### **Phase 3: Event Integration** (Future Sprint)
**Goal**: Automatic scoping and lifecycle management

**Deliverables**:
1. ⏸ Auto-scope from stream lifecycle (stream.online → scopeType: stream)
2. ⏸ Auto-close bid sessions on stream.offline (configurable)
3. ⏸ Periodic counter snapshots (via scheduler-service integration)
4. ⏸ Historical analytics queries for bid results

**Estimated Effort**: 8-12 hours

---

### **Phase 4: Advanced Features** (Backlog)
**Goal**: Extended functionality for future use cases

**Ideas**:
- Leaderboards (Redis Sorted Sets or DocumentStore queries)
- Counter decay schedules (decrement over time)
- Blind bidding (encrypted values until session close)
- Counter groups (multi-counter aggregations)

---

## Phase 1 Detailed Task Breakdown

### 1. Service Scaffold (2 hours)
**Task**: Create utility-service Bit with resource initialization

**Files**:
- `src/apps/utility-service.ts` - Main Bit entry point
- `src/services/utility/types.ts` - Shared types and interfaces

**Implementation**:
```typescript
export class UtilityService extends Bit {
  private docStore: IDocumentStore;
  private redis: RedisClientType;
  private counterManager?: CounterManager;
  private scopeResolver: ScopeResolver;

  constructor() {
    super({ mcpExposure: 'platform-only' });
    this.onStartup(async () => this.setup());
  }

  private async setup(): Promise<void> {
    // Get resources from base server
    this.docStore = (this as any).resources.documentStore;
    this.redis = (this as any).resources.redis;

    // Initialize managers (lazy pattern)
    this.scopeResolver = new ScopeResolver(this.getLogger());

    // Register tools
    this.registerCounterTools();
  }
}
```

**Architecture.yaml Updates**:
```yaml
services:
  utility:
    profile: core
    kind: pipeline-service
    mcp:
      exposure: platform-only
      capabilities:
        - counters
        - bidding
    resources:
      - documentStore
      - redis
```

---

### 2. Scope Resolver (3 hours)
**Task**: Implement scope resolution logic

**Files**:
- `src/services/utility/scope-resolver.ts`
- `src/services/utility/scope-resolver.test.ts`

**Functionality**:
- Resolve `scopeType` + `scopeValue` from event context
- Support explicit scope params (override)
- Support auto-inference from `ingress.channel`, `identity.userId`, etc.

**Test Coverage**:
- Explicit scope parameters
- Auto-inference from stream context
- Auto-inference from user context
- Global scope default
- Error cases (missing context)

---

### 3. Counter Manager (4 hours)
**Task**: Implement counter metadata + value management

**Files**:
- `src/services/utility/counter-manager.ts`
- `src/services/utility/counter-manager.test.ts`

**DocumentStore Collections**:
- `counter_definitions` - Metadata (id, name, scope, ttl, metadata, createdAt, expiresAt)
- `counter_snapshots` - Historical values (id, counterId, value, snapshotAt, trigger)

**Redis Keys**:
- `counter:{scopeType}:{scopeValue}:{name}` - Current value (string)

**Methods**:
```typescript
interface CounterManager {
  create(params: CreateCounterParams): Promise<CounterResult>;
  increment(params: IncrementParams): Promise<IncrementResult>;
  decrement(params: DecrementParams): Promise<DecrementResult>;
  get(params: GetParams): Promise<GetResult>;
  set(params: SetParams): Promise<SetResult>;
  delete(params: DeleteParams): Promise<DeleteResult>;
  list(params: ListParams): Promise<CounterDefinition[]>;
  snapshot(params: SnapshotParams): Promise<SnapshotResult>;
}
```

**Key Features**:
- TTL enforcement (Redis EXPIRE)
- Metadata storage (DocumentStore)
- Atomic increments (Redis INCR/DECR)
- Query active counters by scope
- Manual snapshots to DocumentStore

---

### 4. Counter MCP Tools (2 hours)
**Task**: Register 6 MCP tools for counter operations

**Tools**:
1. `counter.create` - Create new counter with metadata
2. `counter.increment` - Increment by delta (default 1)
3. `counter.get` - Get current value + metadata
4. `counter.delete` - Remove counter (metadata + value)
5. `counter.list` - Query counters by scope
6. `counter.snapshot` - Take manual snapshot

**Zod Schemas**:
```typescript
const CreateCounterSchema = z.object({
  name: z.string().min(1).max(64),
  scopeType: z.enum(['global', 'stream', 'user', 'session', 'custom']).optional(),
  scopeValue: z.string().optional(),
  initialValue: z.number().default(0),
  ttlSeconds: z.number().positive().optional(),
  metadata: z.record(z.any()).optional(),
  createdBy: z.string().optional(),
  event: z.any().optional() // For scope auto-inference
});
```

---

### 5. Unit Tests (3 hours)
**Task**: Comprehensive unit tests for CounterManager and ScopeResolver

**Test Files**:
- `counter-manager.test.ts` - 20+ test cases
- `scope-resolver.test.ts` - 15+ test cases

**Test Categories**:
- Counter lifecycle (create, increment, delete)
- TTL enforcement
- Scope resolution (all types)
- Error handling (missing Redis, invalid params)
- Snapshot creation
- Query filtering

**Mock Strategy**:
- Mock IDocumentStore
- Mock RedisClientType
- Real ScopeResolver (no mocks needed)

---

### 6. Integration Tests (2 hours)
**Task**: Agent-dev validation with real Redis + PostgreSQL

**Test Scenarios**:
1. Deploy utility-service to agent-dev context
2. Create counter via MCP tool
3. Increment counter multiple times
4. Verify value in Redis
5. Verify metadata in PostgreSQL
6. List counters by scope
7. Delete counter
8. Verify cleanup

**Validation Script**:
```bash
#!/bin/bash
# planning/sprint-27-6tp11t/validate_counters.sh

# 1. Provision agent-dev
agent_dev.provision({ name: "agent-dev-utility-test" })

# 2. Deploy utility service
bit deploy utility --context agent-dev-utility-test

# 3. Test counter operations
fleet.info({ bit: "utility", context: "agent-dev-utility-test" })

# 4. Verify health
fleet.health({ bit: "utility", context: "agent-dev-utility-test" })

# 5. Cleanup
agent_dev.destroy({ name: "agent-dev-utility-test", confirm: true })
```

---

### 7. Documentation (2 hours)
**Task**: Create user-facing and developer documentation

**Files**:
- `documentation/guides/utility-counters.md` - User guide
- `documentation/reference/utility-tools.md` - MCP tool reference
- `documentation/architecture/utility-service.md` - Technical architecture

**User Guide Contents**:
- Counter concepts (scope, TTL, metadata)
- Common use cases (deaths counter, stream duration)
- LLM tool usage examples
- Best practices (scope selection, TTL values)

**Tool Reference Contents**:
- All 6 counter tools with signatures
- Parameter descriptions
- Return value schemas
- Error codes
- Usage examples

---

## Testing Strategy

### Unit Tests (Jest)
- **Target**: 100% coverage for managers
- **Mocks**: DocumentStore, Redis
- **Focus**: Logic correctness, edge cases

### Integration Tests (Agent-Dev)
- **Target**: End-to-end validation
- **Environment**: Real Redis + PostgreSQL
- **Focus**: Resource integration, deployment validation

### Manual Testing (Local Dev)
- **Target**: LLM interaction patterns
- **Environment**: Local stack
- **Focus**: Tool usability, scope inference

---

## Risk Mitigation

### Risk 1: Redis Unavailability
**Mitigation**: Fail-open pattern (log error, skip counter operations)
**Fallback**: Counter tools return error, service continues running
**Test**: Unit tests with null Redis client

### Risk 2: DocumentStore Latency
**Mitigation**: Use Redis for hot path (increments), DocumentStore for metadata only
**Fallback**: Cache definitions in memory (future optimization)
**Test**: Integration tests with slow PostgreSQL queries

### Risk 3: Scope Ambiguity
**Mitigation**: ScopeResolver prioritizes explicit params over auto-inference
**Fallback**: Default to global scope if context insufficient
**Test**: Unit tests for all resolution paths

### Risk 4: TTL Sync (Redis vs DocumentStore)
**Mitigation**: DocumentStore stores `expiresAt` timestamp (computed from TTL)
**Fallback**: Background job to clean expired definitions (future)
**Test**: Integration tests verify Redis key expires per TTL

---

## Success Criteria

### Phase 1 Complete When:
✅ utility-service deployed to agent-dev successfully
✅ All 6 counter MCP tools registered and callable
✅ Counter values persist in Redis with TTL
✅ Counter metadata persists in PostgreSQL
✅ Unit tests pass (100% coverage)
✅ Integration tests pass (agent-dev validation)
✅ Documentation complete
✅ No errors in fleet.logs for 5 minutes of operation

---

## Next Steps (Phase 2 Preview)

### Bid Manager Design
- Session metadata → DocumentStore (`bid_sessions`)
- Active bids → Redis Hash (`bid:session:{id}`)
- Results → DocumentStore (`bid_results`)

### Key Challenges
1. Closest-to-target query (client-side sorting)
2. Session close handler (snapshot to DocumentStore)
3. Multi-user concurrency (atomic HSET)

### Dependencies
- Phase 1 complete (reuse ScopeResolver)
- Redis Hashes support (already available)
- DocumentStore batch operations (already available)

---

## Appendix

### File Structure
```
src/
  apps/
    utility-service.ts          # Main Bit entry point
  services/
    utility/
      types.ts                  # Shared interfaces
      scope-resolver.ts         # Scope resolution logic
      scope-resolver.test.ts
      counter-manager.ts        # Counter operations
      counter-manager.test.ts
      bid-manager.ts            # [Phase 2] Bidding operations
      bid-manager.test.ts       # [Phase 2]

documentation/
  guides/
    utility-counters.md         # User guide for counters
    utility-bidding.md          # [Phase 2] User guide for bidding
  reference/
    utility-tools.md            # MCP tool reference
  architecture/
    utility-service.md          # Technical architecture

planning/sprint-27-6tp11t/
  architecture-revision-v2.md   # Architecture spec
  execution-plan.md             # This document
  backlog.yaml                  # Trackable task backlog
  validate_counters.sh          # Integration test script
```

### Dependencies (npm)
- `zod` - Schema validation (already installed)
- `redis` - Redis client (already installed)
- Platform abstractions (IDocumentStore, ResourceManager)

### Environment Variables
```bash
# Required for utility-service
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:pass@localhost:5432/bitbrat

# Optional configuration
COUNTER_DEFAULT_TTL_SECONDS=86400  # 24 hours
COUNTER_MAX_TTL_SECONDS=604800     # 7 days
```

---

## References

- **Architecture Spec**: `planning/sprint-27-6tp11t/architecture-revision-v2.md`
- **IDocumentStore**: `src/common/persistence/interfaces.ts:44-97`
- **RedisManager**: `src/common/resources/redis-manager.ts`
- **Claim Check Pattern**: `src/apps/claim-check-service.ts` (similar Redis + metadata pattern)
- **Scheduler Service**: MCP tool registration example
- **Platform Flow**: `documentation/concepts/platform-flow.md`

---

**Status**: Ready for implementation
**Next Action**: Begin Phase 1 - Task 1 (Service Scaffold)
