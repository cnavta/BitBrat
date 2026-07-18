# Sprint 343 - PostgreSQL Migration Refactoring Backlog

**Created**: 2026-07-16
**Last Updated**: 2026-07-16
**Status**: Phase 1B - Service Refactoring
**Progress**: 13/18 services complete (72%)

---

## Prioritization Strategy

Services are prioritized based on:

1. **Impact**: How critical is the service to platform functionality?
2. **Complexity**: How difficult is the refactoring? (Simple < Medium < Complex)
3. **Dependencies**: Do other services depend on this?
4. **Quick Wins**: Can we build momentum with easy refactorings?

**Strategy**: Start with **Simple services** to build momentum, then tackle **Medium** services, saving **Complex** services for when we have established patterns.

---

## ✅ Completed (13/18 - 72%)

| Service | File | Complexity | Completed |
|---------|------|------------|-----------|
| UserRepo | `src/services/auth/user-repo.ts` | Medium | ✅ Session 1 |
| RuleLoader | `src/services/router/rule-loader.ts` | Simple | ✅ Session 2 |
| AuthTokenStore | `src/services/oauth/auth-token-store.ts` | Simple | ✅ Session 2 |
| ReflexRepository | `src/services/reflex/reflex-repository.ts` | Medium | ✅ Session 2 |
| ContextPackStore | `src/apps/context-pack-service.ts` | Simple | ✅ Session 3 |
| ToolUsageStore | `src/common/mcp/observability.ts` | Simple | ✅ Session 3 |
| ApiTokenStore | `src/services/api-gateway/auth.ts` | Simple | ✅ Session 3 |
| PromptLogStore (query-analyzer) | `src/services/query-analyzer/llm-provider.ts` | Simple | ✅ Session 3 |
| PromptLogStore (image-gen-mcp) | `src/services/image-gen-mcp/index.ts` | Simple | ✅ Session 3 |
| ScheduleRepository | `src/services/scheduler/repository.ts` | Medium | ✅ Session 4 |
| ToolGateway (MCP servers + context packs) | `src/apps/tool-gateway.ts` | Medium | ✅ Session 4 |
| DispositionObservationStore | `src/apps/disposition-service.ts` | Medium | ✅ Session 4 |
| StoryRepository | `src/services/story-engine/repository.ts` | Medium | ✅ Session 4 |

---

## 🎯 High Priority - Quick Wins (Simple Services)

These services have **simple operations** (1-2 methods, no transactions, often fire-and-forget). Target: Complete in this session.

### 1. ✅ **SKIP: mcp/registry-watcher** - Read-only subscription
**File**: `src/common/mcp/registry-watcher.ts`
**Collections**: `mcp_servers`
**Operations**: Real-time subscription (onSnapshot) - read-only
**Complexity**: Simple
**Reason to Skip**: Read-only consumer, low priority for migration

### 2. **mcp/observability** - Tool usage logging
**File**: `src/common/mcp/observability.ts`
**Collections**: `tool_usage`
**Operations**: 1 write (add to collection, fire-and-forget)
**Complexity**: Simple
**Estimated Time**: 30-45 minutes
**Priority**: Medium - enables observability for MCP tools

### 3. **context-pack service** - Context pack storage
**File**: `src/apps/context-pack-service.ts`
**Collections**: `context_packs`
**Operations**: 1 write (upsert with merge)
**Complexity**: Simple
**Estimated Time**: 30-45 minutes
**Priority**: High - RAG context storage

### 4. **api-gateway/auth** - API token validation
**File**: `src/services/api-gateway/auth.ts`
**Collections**: `gateways/api/tokens`
**Operations**: 1 read (get by hash), 1 write (update timestamp)
**Complexity**: Simple
**Estimated Time**: 45-60 minutes
**Priority**: High - API authentication

### 5. **query-analyzer/llm-provider** - Prompt logging
**File**: `src/services/query-analyzer/llm-provider.ts`
**Collections**: `services/query-analyzer/prompt_logs`
**Operations**: 1 write (add to subcollection, fire-and-forget)
**Complexity**: Simple
**Estimated Time**: 30 minutes
**Priority**: Low - logging only

### 6. **image-gen-mcp** - Prompt logging
**File**: `src/services/image-gen-mcp/index.ts`
**Collections**: `services/image-gen-mcp/prompt_logs`
**Operations**: 1 write (add to subcollection, fire-and-forget)
**Complexity**: Simple
**Estimated Time**: 30 minutes
**Priority**: Low - logging only

---

## 🎯 Medium Priority - Important Services (Medium Complexity)

These services have **multiple operations** or **complex queries**. Target: Complete in next 1-2 sessions.

### 7. ✅ **scheduler** - Scheduled event execution
**File**: `src/apps/scheduler-service.ts`, `src/services/scheduler/repository.ts`
**Collections**: `schedules`
**Operations**: 6 methods (list, get, create, update, delete, getDueSchedules)
**Complexity**: Medium
**Completed**: ✅ Session 4
**Repository Pattern**: Separate repository file created for better organization
**Date Handling**: Bidirectional Firestore Timestamp ↔ JavaScript Date conversion
**MCP Tools**: 5 tools refactored (list_schedules, get_schedule, create_schedule, update_schedule, delete_schedule)

### 8. ✅ **tool-gateway** - MCP server registry + context packs
**File**: `src/apps/tool-gateway.ts`
**Collections**: `mcp_servers`, `context_packs`
**Operations**: 2 upsert operations (MCP servers + context packs)
**Complexity**: Medium
**Completed**: ✅ Session 4
**Inline Abstractions**: Created `IMcpServerStore` + implementations inline
**Reused**: `IContextPackStore` from context-pack-service (Session 3)
**Fire-and-Forget Pattern**: Maintained 5s timeout for non-blocking writes

### 9. ✅ **disposition-service** - User behavior tracking
**File**: `src/apps/disposition-service.ts`
**Collections**: `disposition_observations`
**Operations**: 2 methods (upsert, queryActive)
**Complexity**: Medium
**Completed**: ✅ Session 4
**Inline Abstractions**: Created `IDispositionObservationStore` + implementations inline
**Query Features**: Filters (userKey, observedAt), ordering (desc), limit
**Time**: ~1 hour

### 10. ✅ **story-engine-mcp** - Interactive storytelling
**File**: `src/apps/story-engine-mcp.ts`, `src/services/story-engine/repository.ts`
**Collections**: `users`, `stories`
**Operations**: 6 methods (getUser, setUserActiveStory, getStory, createStory, appendToHistory, updateStory)
**Complexity**: Medium
**Completed**: ✅ Session 4
**Repository Pattern**: Separate repository file created
**Dual-Pattern Approach**: Firestore uses FieldValue.arrayUnion, PostgreSQL uses fetch-modify-update
**MCP Tools**: 5 tools refactored (start_story, get_current_scene, process_action, commit_scene, update_world_state)

### 11. **llm-bot/user-context** - User role and profile lookups
**File**: `src/services/llm-bot/user-context.ts`
**Collections**: `configs/bot/roles`, `users`
**Operations**: 2 reads (query enabled roles, get user doc)
**Complexity**: Medium
**Estimated Time**: 1.5-2 hours
**Priority**: Medium - Enhances LLM responses with user context
**Note**: In-memory caching with TTL, timeout guards

### 12. **stream-analyst** - Stream summarization
**File**: `src/services/stream-analyst/engine.ts`
**Collections**: `stream_observers`, `summarization_runs`, `events`
**Operations**: 2 reads (get observer, get run), queries for event aggregation
**Complexity**: Medium
**Estimated Time**: 2-3 hours
**Priority**: Low - Analytics feature
**Dependencies**: Persistence layer for event queries

### 13. **vector-provider** - Vector similarity search
**File**: `src/common/context/vector-provider.ts`
**Collections**: `context_packs`
**Operations**: 1 vector query (findNearest with embeddings)
**Complexity**: Medium
**Estimated Time**: 1.5-2 hours
**Priority**: High - RAG context retrieval
**Note**: Requires vector index support in PostgreSQL (pgvector)

---

## 🔴 High Priority - Complex Services (High Complexity)

These services use **transactions** or **subcollections**. Target: Complete after Medium services are done.

### 14. **state-engine** - State management with transactions
**File**: `src/apps/state-engine.ts`
**Collections**: `state`, `mutation_log`
**Operations**: 2 reads (get, query with prefix), transactions, 2 writes
**Complexity**: Medium-Complex
**Estimated Time**: 3-4 hours
**Priority**: **CRITICAL** - Core state management
**Dependencies**: Multiple services depend on state-engine
**Challenges**: Optimistic concurrency control, transactions

### 15. **persistence/store** - Event persistence with transactions
**File**: `src/services/persistence/store.ts`
**Collections**: `events`, `events/{id}/snapshots` (subcollection), `sources`
**Operations**: Transactions (create aggregate + snapshot), writes
**Complexity**: Medium-Complex
**Estimated Time**: 3-4 hours
**Priority**: **CRITICAL** - Core event persistence
**Challenges**: Transactions, subcollections, normalization

---

## ⚪ Low Priority - Can Be Deferred

### 16. **DEFER: llm-bot/processor** - Minimal direct usage
**File**: `src/services/llm-bot/processor.ts`
**Reason**: Delegates to user-context module, minimal direct Firestore usage

### 17. **DEFER: ingress-egress** - Already using repository pattern
**File**: `src/apps/ingress-egress-service.ts`
**Reason**: Already delegates to FirestoreTokenStore and FirestoreAuthTokenStore

### 18. **DEFER: api-gateway service** - Delegates to AuthService
**File**: `src/apps/api-gateway.ts`
**Reason**: No direct Firestore usage, delegates to api-gateway/auth

---

## Recommended Execution Order

### **Session 2 (Current) - Quick Wins (Target: 3-4 services)**

1. ✅ **context-pack** (30-45 min) - Simple, high priority
2. ✅ **api-gateway/auth** (45-60 min) - Simple, high priority
3. ✅ **mcp/observability** (30-45 min) - Simple, medium priority
4. **Query: Should we do logging services?** (query-analyzer, image-gen-mcp)

**Target**: 2-3 simple services = 2-2.5 hours

### **Session 3 - Medium Services (Target: 2-3 services)**

1. **tool-gateway** (1.5-2 hours) - High priority
2. **scheduler** (2-3 hours) - High priority, MCP dependencies
3. **disposition-service** (1.5-2 hours) - Medium priority

**Target**: 2-3 medium services = 5-7 hours

### **Session 4 - Remaining Medium + Start Complex (Target: 2-3 services)**

1. **story-engine-mcp** (2-3 hours) - Medium priority
2. **llm-bot/user-context** (1.5-2 hours) - Medium priority
3. **vector-provider** (1.5-2 hours) - High priority (RAG)

**Target**: 2-3 services = 5-7 hours

### **Session 5 - Complex Services (Target: 2 services)**

1. **state-engine** (3-4 hours) - **CRITICAL**, transactions
2. **persistence/store** (3-4 hours) - **CRITICAL**, transactions + subcollections

**Target**: 2 complex services = 6-8 hours

---

## Success Criteria Per Service

For each refactored service, ensure:

- ✅ **Interface defined** (IRepository or equivalent)
- ✅ **DocumentStore implementation** created
- ✅ **Factory function** for backend auto-detection
- ✅ **Backward compatibility** maintained
- ✅ **Integration tests** written and passing
- ✅ **Build passes** (no TypeScript errors)
- ✅ **Documentation** created (summary + patterns)

---

## Risk Mitigation

### High-Risk Services:

1. **state-engine**: Optimistic concurrency control via transactions
   - **Mitigation**: Study Firestore transaction semantics, test PostgreSQL transaction isolation

2. **persistence/store**: Subcollections for event snapshots
   - **Mitigation**: Design flat table schema for snapshots, maintain parent-child relationships

3. **vector-provider**: Vector similarity search
   - **Mitigation**: Verify pgvector extension installed, test query performance

---

## PostgreSQL Schema Planning

### New Tables Required:

| Service | Table Name | Key Fields | Indexes |
|---------|------------|------------|---------|
| mcp/observability | `tool_usage` | id, tool_name, timestamp | timestamp, tool_name |
| context-pack | `context_packs` | id, embedding (vector) | active, vector index |
| api-gateway/auth | `api_tokens` | hash, token_name | hash (primary), last_used_at |
| scheduler | `schedules` | id, enabled, nextRun | enabled, nextRun |
| tool-gateway | `mcp_servers`, `context_packs` | (reuse existing) | - |
| disposition | `disposition_observations` | userKey, observedAt | userKey, observedAt |
| story-engine | `stories`, `users` | id, active_story | user_id |
| user-context | `roles`, `users` | (reuse existing) | - |
| vector-provider | `context_packs` | (reuse existing) | vector index |
| state-engine | `state`, `mutation_log` | key, version | key, version |
| persistence | `events`, `event_snapshots` | id, correlationId | correlationId, timestamp |

---

## Progress Tracking

**Total Services**: 18
**Completed**: 13 (72%)
**In Progress**: 0
**Remaining**: 5 (28%)

**Estimated Total Time**: 25-35 hours
**Estimated Sessions**: 4-5 sessions (at 5-7 hours/session)

**Current Session (Session 4)**: Completed 4 services (scheduler, tool-gateway, disposition, story-engine-mcp) - all Medium complexity

---

## Notes

- **Deferred services** (3): llm-bot/processor, ingress-egress, api-gateway service
- **Skipped services** (1): mcp/registry-watcher (read-only, low priority)
- **Net refactoring target**: 14 services (18 - 4 completed)

**Updated**: 2026-07-16 - Created prioritized backlog based on agent analysis
