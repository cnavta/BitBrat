# Firestore to PostgreSQL Collection Mapping

**Date**: 2026-07-16
**Sprint**: 343 - PostgreSQL Migration
**Status**: Complete

---

## Overview

This document provides a comprehensive mapping between Firestore collections and PostgreSQL tables in the BitBrat platform. The migration follows a **document-store pattern** where each Firestore collection maps to a PostgreSQL table with a JSONB `data` column preserving the original document structure.

---

## Mapping Table

| # | Firestore Collection | PostgreSQL Table | Status | Indexes | Special Features |
|---|---------------------|-----------------|--------|---------|------------------|
| 1 | `events` | `events` | ✅ Mapped | correlationId, type, source, created_at | Event persistence & retrieval |
| 2 | `context_packs` | `context_packs` | ✅ Mapped | tags (GIN), embedding (ivfflat) | **Vector similarity search** |
| 3 | `users` | `auth_users` | ✅ Mapped | platformId, username | Auth service integration |
| 4 | `configs` | `routing_rules` | ✅ Mapped | pattern, active | Event router rules |
| 5 | `services` | `service_registry` | ✅ Mapped | status | Service discovery |
| 6 | `oauth` | `auth_scopes` | ✅ Mapped | - | OAuth token storage |
| 7 | `state` | `user_state` | ✅ Mapped | userId | Per-user state |
| 8 | - | `global_state` | ✅ Mapped | - | System-wide state |
| 9 | - | `sessions` | ✅ Mapped | userId, expiresAt | User sessions |
| 10 | - | `conversation_history` | ✅ Mapped | userId, timestamp | Chat history |
| 11 | - | `llm_responses` | ✅ Mapped | correlationId | LLM response cache |
| 12 | - | `integration_configs` | ✅ Mapped | platform | Platform integrations |
| 13 | - | `metrics` | ✅ Mapped | timestamp, metricName | System metrics |
| - | `gateways` | - | ❌ Not mapped | - | **To be migrated** |
| - | `mcp_servers` | - | ❌ Not mapped | - | **To be migrated** |
| - | `mutation_log` | - | ❌ Not mapped | - | **To be migrated** |
| - | `personalities` | - | ❌ Not mapped | - | **To be migrated** |
| - | `reflexes` | - | ❌ Not mapped | - | **To be migrated** |
| - | `schedules` | - | ❌ Not mapped | - | **To be migrated** |
| - | `sources` | - | ❌ Not mapped | - | **To be migrated** |
| - | `tool_usage` | - | ❌ Not mapped | - | **To be migrated** |
| - | `user_disposition_observations` | - | ❌ Not mapped | - | **To be migrated** |

---

## Detailed Mapping

### 1. events → events

**Firestore**: `events` collection
**PostgreSQL**: `events` table

**Purpose**: Event persistence and retrieval (highest priority)

**Schema**:
```sql
CREATE TABLE events (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_events_created_at` - Time-based queries
- `idx_events_correlation_id` - Trace event chains
- `idx_events_type` - Filter by event type
- `idx_events_source` - Filter by event source

**Migration Status**: ✅ 569 documents migrated (local), 569 migrated (staging)

---

### 2. context_packs → context_packs

**Firestore**: `context_packs` collection
**PostgreSQL**: `context_packs` table

**Purpose**: LLM context packs with vector similarity search

**Schema**:
```sql
CREATE TABLE context_packs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  embedding vector(1536),  -- OpenAI ada-002 embeddings
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_context_packs_embedding` - **IVFFlat vector index** for similarity search
- `idx_context_packs_tags` - GIN index for tag filtering

**Special Features**:
- **pgvector extension** enabled for semantic search
- 1536-dimensional embeddings (OpenAI ada-002 format)
- Cosine similarity operations

**Migration Status**: ✅ 6 documents migrated (local), 6 migrated (staging)

---

### 3. users → auth_users

**Firestore**: `users` collection
**PostgreSQL**: `auth_users` table

**Purpose**: User authentication and profile storage

**Schema**:
```sql
CREATE TABLE auth_users (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_auth_users_platform_id` - Lookup by platform user ID
- `idx_auth_users_username` - Lookup by username

**Integration**:
- **auth-service** refactored to use `DocumentStoreUserRepo`
- Factory pattern: `createUserRepo()` switches between Firestore/PostgreSQL
- Backward compatible with existing Firestore code

**Migration Status**: ✅ 0 documents (empty on staging/local)

---

### 4. configs → routing_rules

**Firestore**: `configs` collection
**PostgreSQL**: `routing_rules` table

**Purpose**: Event router rules (JsonLogic-based)

**Schema**:
```sql
CREATE TABLE routing_rules (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_routing_rules_pattern` - Match patterns
- `idx_routing_rules_active` - Filter active rules

**Migration Status**: ✅ 0 documents (empty on staging/local)

---

### 5. services → service_registry

**Firestore**: `services` collection
**PostgreSQL**: `service_registry` table

**Purpose**: Service discovery and health tracking

**Schema**:
```sql
CREATE TABLE service_registry (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_service_registry_status` - Filter by service status

**Migration Status**: ✅ 0 documents (empty on staging/local)

---

### 6. oauth → auth_scopes

**Firestore**: `oauth` collection
**PostgreSQL**: `auth_scopes` table

**Purpose**: OAuth token and scope storage

**Schema**:
```sql
CREATE TABLE auth_scopes (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Migration Status**: ✅ 0 documents (empty on staging/local)

---

### 7. state → user_state

**Firestore**: `state` collection
**PostgreSQL**: `user_state` table

**Purpose**: Per-user state storage

**Schema**:
```sql
CREATE TABLE user_state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_user_state_user_id` - Lookup by user ID

**Migration Status**: ✅ 0 documents (empty on staging/local)

---

### 8. global_state

**Firestore**: (no equivalent)
**PostgreSQL**: `global_state` table

**Purpose**: System-wide state storage

**Schema**:
```sql
CREATE TABLE global_state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Migration Status**: ✅ Table created, no source data

---

### 9. sessions

**Firestore**: (no equivalent)
**PostgreSQL**: `sessions` table

**Purpose**: User session tracking

**Schema**:
```sql
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_sessions_user_id` - Lookup by user
- `idx_sessions_expires_at` - Expiration cleanup

**Migration Status**: ✅ Table created, no source data

---

### 10. conversation_history

**Firestore**: (no equivalent)
**PostgreSQL**: `conversation_history` table

**Purpose**: Chat conversation history

**Schema**:
```sql
CREATE TABLE conversation_history (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_conversation_history_user_id` - User's conversations
- `idx_conversation_history_timestamp` - Time-based queries

**Migration Status**: ✅ Table created, no source data

---

### 11. llm_responses

**Firestore**: (no equivalent)
**PostgreSQL**: `llm_responses` table

**Purpose**: LLM response caching

**Schema**:
```sql
CREATE TABLE llm_responses (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_llm_responses_correlation_id` - Trace responses to events

**Migration Status**: ✅ Table created, no source data

---

### 12. integration_configs

**Firestore**: (no equivalent)
**PostgreSQL**: `integration_configs` table

**Purpose**: Platform integration configurations

**Schema**:
```sql
CREATE TABLE integration_configs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_integration_configs_platform` - Filter by platform

**Migration Status**: ✅ Table created, no source data

---

### 13. metrics

**Firestore**: (no equivalent)
**PostgreSQL**: `metrics` table

**Purpose**: System metrics and analytics

**Schema**:
```sql
CREATE TABLE metrics (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `idx_metrics_timestamp` - Time-series queries
- `idx_metrics_metric_name` - Filter by metric type

**Migration Status**: ✅ Table created, no source data

---

## Unmapped Collections

The following Firestore collections **do not yet have PostgreSQL equivalents**:

### ❌ gateways
- **Purpose**: API gateway configurations
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Medium (gateway-related services need refactoring)

### ❌ mcp_servers
- **Purpose**: MCP server registry
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Medium (MCP infrastructure)

### ❌ mutation_log
- **Purpose**: State mutation audit log
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: High (audit trail preservation)

### ❌ personalities
- **Purpose**: LLM personality configurations
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Low (used by specific services)

### ❌ reflexes
- **Purpose**: Automated response rules
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Medium (reflex-service dependency)

### ❌ schedules
- **Purpose**: Scheduled task definitions
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Medium (scheduler-service dependency)

### ❌ sources
- **Purpose**: Event source configurations
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Medium (ingress-egress dependency)

### ❌ tool_usage
- **Purpose**: MCP tool usage analytics
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Low (analytics/monitoring)

### ❌ user_disposition_observations
- **Purpose**: User behavior observations
- **Action Required**: Create PostgreSQL table + migration
- **Priority**: Low (disposition-service dependency)

---

## Common Schema Pattern

All PostgreSQL tables follow a **consistent schema pattern**:

```sql
CREATE TABLE <table_name> (
  id VARCHAR(255) PRIMARY KEY,          -- Document ID from Firestore
  data JSONB NOT NULL,                  -- Full document as JSON
  created_at TIMESTAMP DEFAULT NOW(),   -- Creation timestamp
  updated_at TIMESTAMP DEFAULT NOW()    -- Last update timestamp
);
```

**Benefits**:
- **Schema flexibility**: Documents can evolve without migrations
- **Firestore compatibility**: Exact structure preservation
- **JSONB indexing**: Fast queries on nested fields using `data->>'field'`
- **Backward compatibility**: Easy to revert to Firestore

---

## JSONB Indexing Strategy

### Single Field Indexes
```sql
CREATE INDEX idx_<table>_<field> ON <table>((data->>'<field>'));
```

**Example**: `idx_events_correlation_id` on `events((data->>'correlationId'))`

### Nested Field Indexes
```sql
CREATE INDEX idx_<table>_<path> ON <table>((data->'path'->>'field'));
```

**Example**: `idx_events_identity_user_id` on `events((data->'identity'->>'userId'))`

### Array/Tag Indexes (GIN)
```sql
CREATE INDEX idx_<table>_<array> ON <table> USING GIN ((data->'<array>'));
```

**Example**: `idx_context_packs_tags` on `context_packs((data->'tags'))`

### Vector Indexes (IVFFlat)
```sql
CREATE INDEX idx_<table>_embedding ON <table> USING ivfflat (embedding vector_cosine_ops);
```

**Example**: `idx_context_packs_embedding` for similarity search

---

## Migration Statistics

### Local Environment
- **Total documents migrated**: 575
  - events: 569
  - context_packs: 6
  - Other collections: 0 (empty)

### Staging Environment (bitbrat.lan)
- **Total documents migrated**: 575
  - events: 569
  - context_packs: 6
  - Other collections: 0 (empty)

### Migration Performance
- **Average latency**: 1-5ms per document
- **Total migration time**: ~30 seconds (575 docs)
- **Method**: Individual operations (no batch writes)

---

## Data Integrity

### Verification Methods

1. **Row count comparison**:
   ```sql
   SELECT COUNT(*) FROM events;
   ```

2. **Sample data inspection**:
   ```sql
   SELECT id, jsonb_pretty(data) FROM events LIMIT 1;
   ```

3. **Nested field queries**:
   ```sql
   SELECT id, data->>'correlationId', data->'identity'->>'userId' FROM events LIMIT 5;
   ```

4. **Vector data validation**:
   ```sql
   SELECT id, array_length(embedding, 1) FROM context_packs LIMIT 1;
   ```

### Verified ✅
- All nested structures preserved (annotations, routing slips, identity)
- Vector embeddings intact (1536 dimensions)
- JSONB queries working correctly
- Indexes functional

---

## Access Patterns

### Query Examples

**Find events by correlation ID**:
```sql
SELECT * FROM events WHERE data->>'correlationId' = 'some-id';
```

**Find user by email**:
```sql
SELECT * FROM auth_users WHERE data->>'email' = 'user@example.com';
```

**Vector similarity search**:
```sql
SELECT id, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) AS similarity
FROM context_packs
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;
```

**Time-range event queries**:
```sql
SELECT * FROM events
WHERE created_at BETWEEN '2026-07-01' AND '2026-07-16'
ORDER BY created_at DESC;
```

---

## Service Integration Status

| Service | Firestore Code | PostgreSQL Code | Status |
|---------|---------------|-----------------|--------|
| auth-service | ✅ FirestoreUserRepo | ✅ DocumentStoreUserRepo | **Refactored** |
| event-router | ✅ Direct Firestore | ❌ Not refactored | Pending |
| llm-bot | ✅ Direct Firestore | ❌ Not refactored | Pending |
| query-analyzer | ✅ Direct Firestore | ❌ Not refactored | Pending |
| state-engine | ✅ Direct Firestore | ❌ Not refactored | Pending |
| disposition-service | ✅ Direct Firestore | ❌ Not refactored | Pending |
| scheduler | ✅ Direct Firestore | ❌ Not refactored | Pending |
| reflex | ✅ Direct Firestore | ❌ Not refactored | Pending |
| ... | ... | ... | 17 more to refactor |

---

## Environment Variables

### Firestore Mode (Current Default)
```bash
PERSISTENCE_DRIVER=firestore  # or unset
FIRESTORE_EMULATOR_HOST=localhost:8080  # local only
GCLOUD_PROJECT=bitbrat-local
```

### PostgreSQL Mode
```bash
PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat
```

---

## Next Steps

### Phase 1C: Service Refactoring (In Progress)
- [x] auth-service (UserRepo) - **COMPLETE**
- [ ] event-router (commands lookup)
- [ ] llm-bot (context_packs retrieval)
- [ ] state-engine (user_state/global_state)
- [ ] 14+ more services

### Phase 2: Missing Collections
- [ ] Create PostgreSQL tables for 9 unmapped collections
- [ ] Add migration support in `brat migrate` CLI
- [ ] Migrate production data

### Phase 3: Production Deployment
- [ ] Deploy to Cloud SQL (PostgreSQL managed service)
- [ ] Configure connection pooling (Cloud SQL Proxy)
- [ ] Monitor performance vs Firestore baseline
- [ ] Validate cost savings

---

## References

- **Schema Definition**: `infrastructure/postgres/init/02-create-tables.sql`
- **Migration Tool**: `tools/brat/src/commands/migrate.ts`
- **IDocumentStore Interface**: `src/common/persistence/document-store.ts`
- **PostgreSQL Store Implementation**: `src/common/persistence/postgres-store.ts`
- **Auth Service Refactoring**: `planning/sprint-343-postgres-migration/AUTH_SERVICE_REFACTORING_SUMMARY.md`
- **Test Results**: `planning/sprint-343-postgres-migration/TEST_RESULTS.md`

---

**Last Updated**: 2026-07-16
**Author**: Claude (Sprint 343)
