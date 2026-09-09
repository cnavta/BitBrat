# Snapshots View Reference

**Migration:** 020-add-snapshots-view.sql
**Date:** 2026-08-21
**Purpose:** Flatten JSONB snapshots data for easier querying

---

## Overview

The `snapshots_view` PostgreSQL view extracts commonly-queried fields from the `snapshots.data` JSONB column, making it easier to query event history without writing complex JSON path expressions.

**Key Benefits:**
- ✅ **Simplified Queries**: Use column names instead of JSONB operators
- ✅ **Performance**: Indexed columns for fast lookups
- ✅ **Type Safety**: Proper type casting (int, boolean, timestamp)
- ✅ **Discoverability**: All fields visible in schema browsers

---

## Schema

### Primary Identifiers

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | VARCHAR(255) | Primary key (e.g., "corr-123-000002-update") |
| `correlation_id` | VARCHAR(255) | Event correlation ID |
| `sequence` | INT | Snapshot sequence number (1-indexed) |
| `kind` | VARCHAR(50) | Snapshot type: initial, update, final, deadletter |

### Snapshot Metadata

| Column | Type | Description |
|--------|------|-------------|
| `captured_at` | TIMESTAMP | When snapshot was captured (ISO8601) |
| `source_service` | VARCHAR(255) | Service that created snapshot |
| `source_topic` | VARCHAR(255) | Message bus topic that triggered snapshot |
| `idempotency_key` | VARCHAR(255) | Deduplication key |
| `change_summary` | TEXT | Human-readable summary of changes |

### Routing Slip

| Column | Type | Description |
|--------|------|-------------|
| `routing_stage` | VARCHAR(50) | Current stage: initial, contextualization, analysis, reaction, response, error |
| `step_id` | VARCHAR(255) | Current step ID (e.g., "auth", "llm-bot", "egress") |
| `attempt` | INT | Retry attempt number (0-indexed) |

### Event Basic Fields

| Column | Type | Description |
|--------|------|-------------|
| `event_type` | VARCHAR(255) | Event type (e.g., "chat.message.v1", "llm.request.v1") |
| `event_version` | VARCHAR(10) | Event schema version ("2") |
| `trace_id` | VARCHAR(255) | W3C trace ID for distributed tracing |

### Message Fields (Chat Events)

| Column | Type | Description |
|--------|------|-------------|
| `message_id` | VARCHAR(255) | Unique message identifier |
| `message_role` | VARCHAR(50) | Role: user, assistant, system, tool |
| `message_text` | TEXT | Message text content |
| `message_language` | VARCHAR(10) | Language code (e.g., "en", "es") |

### Ingress Metadata

| Column | Type | Description |
|--------|------|-------------|
| `ingress_at` | TIMESTAMP | When event entered system (ISO8601) |
| `ingress_source` | VARCHAR(255) | Ingress source (e.g., "ingress.discord", "api-gateway") |
| `ingress_connector` | VARCHAR(50) | Connector type: twitch, discord, slack, api, system |
| `ingress_channel` | VARCHAR(255) | Channel ID or name |

### Identity: External (Platform-Provided)

| Column | Type | Description |
|--------|------|-------------|
| `external_user_id` | VARCHAR(255) | Platform-specific user ID |
| `external_platform` | VARCHAR(50) | Platform: discord, twitch, slack |
| `external_display_name` | VARCHAR(255) | Platform display name |
| `external_roles` | JSONB | Platform roles (array) |

### Identity: User (Auth-Enriched)

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | VARCHAR(255) | Internal user ID (from users table) |
| `user_email` | VARCHAR(255) | User email address |
| `user_display_name` | VARCHAR(255) | Internal display name |
| `user_roles` | JSONB | Internal roles (array) |
| `user_status` | VARCHAR(50) | User status: active, banned, suspended |
| `user_notes` | TEXT | Admin notes about user |
| `user_tags` | JSONB | User tags (array) |

### Identity: Auth Metadata

| Column | Type | Description |
|--------|------|-------------|
| `auth_provider` | VARCHAR(50) | Auth provider: discord, twitch, api_key |
| `auth_method` | VARCHAR(50) | Auth method: enrichment, direct |
| `auth_matched` | BOOLEAN | Whether user was matched in auth DB |
| `auth_at` | TIMESTAMP | When auth occurred (ISO8601) |

### Egress Metadata

| Column | Type | Description |
|--------|------|-------------|
| `egress_destination` | VARCHAR(255) | Egress destination topic or channel |
| `egress_type` | VARCHAR(50) | Egress type: chat, dm, event |
| `egress_connector` | VARCHAR(50) | Egress connector type |
| `egress_channel` | VARCHAR(255) | Egress channel ID |

### Routing Summary

| Column | Type | Description |
|--------|------|-------------|
| `event_routing_stage` | VARCHAR(50) | Event's current routing stage |
| `routing_slip_length` | INT | Number of steps in routing slip |
| `routing_history_length` | INT | Number of completed steps |

### Annotations & Candidates

| Column | Type | Description |
|--------|------|-------------|
| `annotations_count` | INT | Number of annotations attached to event |
| `candidates_count` | INT | Number of response candidates |

### QoS (Quality of Service)

| Column | Type | Description |
|--------|------|-------------|
| `qos_persistence_ttl_sec` | INT | Persistence TTL in seconds |
| `qos_tracer` | BOOLEAN | Whether tracing is enabled |
| `qos_max_response_ms` | INT | Max response time in milliseconds |

### Debug Metadata (Sprint 371+)

| Column | Type | Description |
|--------|------|-------------|
| `debug_enabled` | BOOLEAN | Whether debug mode is active |
| `debug_initiated_by` | VARCHAR(255) | User who initiated debug mode |
| `debug_feedback_channel` | VARCHAR(255) | Channel for debug trace messages |
| `debug_started_at` | TIMESTAMP | When debug mode was activated |

### Delivery Metadata (Final Snapshots)

| Column | Type | Description |
|--------|------|-------------|
| `delivery_destination` | VARCHAR(255) | Where response was delivered |
| `delivery_status` | VARCHAR(50) | Delivery status: FINALIZED, ERROR |
| `delivery_delivered_at` | TIMESTAMP | When delivery occurred |
| `delivery_provider_message_id` | VARCHAR(255) | Provider's message ID |
| `delivery_error_code` | VARCHAR(50) | Error code if delivery failed |
| `delivery_error_message` | TEXT | Error message if delivery failed |

### Deadletter Metadata (Deadletter Snapshots)

| Column | Type | Description |
|--------|------|-------------|
| `deadletter_reason` | TEXT | Why event was deadlettered |
| `deadletter_at` | TIMESTAMP | When deadlettering occurred |
| `deadletter_last_step_id` | VARCHAR(255) | Last successful step ID |
| `deadletter_original_type` | VARCHAR(255) | Original event type |
| `deadletter_error_code` | VARCHAR(50) | Error code |
| `deadletter_error_message` | TEXT | Error message |

### Full Data & Timestamps

| Column | Type | Description |
|--------|------|-------------|
| `full_data` | JSONB | Complete EventSnapshotDocV1 structure |
| `created_at` | TIMESTAMP | When snapshot was inserted |
| `updated_at` | TIMESTAMP | When snapshot was last updated |

---

## Indexes

The view leverages functional indexes on the base `snapshots` table for optimal query performance:

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_snapshots_correlation_id` | `data->>'correlationId'` | Join with events table |
| `idx_snapshots_kind` | `data->>'kind'` | Filter by snapshot type |
| `idx_snapshots_sequence` | `data->>'sequence'` | Chronological ordering |
| `idx_snapshots_idempotency_key` | `data->>'idempotencyKey'` | Deduplication |
| `idx_snapshots_user_id` | `data->'event'->'identity'->'user'->>'id'` | User-based queries |
| `idx_snapshots_external_user_id` | `data->'event'->'identity'->'external'->>'id'` | Platform user queries |
| `idx_snapshots_event_type` | `data->'event'->>'type'` | Event type filtering |
| `idx_snapshots_routing_stage` | `data->>'stage'` | Routing stage filtering |
| `idx_snapshots_ingress_source` | `data->'event'->'ingress'->>'source'` | Source filtering |
| `idx_snapshots_ingress_channel` | `data->'event'->'ingress'->>'channel'` | Channel filtering |
| `idx_snapshots_captured_at` | `data->>'capturedAt'` | Time-based queries |
| `idx_snapshots_debug_enabled` | `data->'event'->'metadata'->'debug'->>'enabled'` | Debug mode queries |
| `idx_snapshots_deadletter` | `data->>'kind'` (partial) | Deadletter snapshots |
| `idx_snapshots_user_timeline` | `user_id, captured_at DESC` | User timeline queries |

---

## Common Query Patterns

### 1. Get Full Event History

```sql
SELECT *
FROM snapshots_view
WHERE correlation_id = 'c9f2a3b1-4e5f-6a7b-8c9d-0e1f2a3b4c5d'
ORDER BY sequence ASC;
```

**Use Case:** Reconstruct complete event lifecycle

---

### 2. User Message History

```sql
SELECT
  message_text,
  external_display_name,
  captured_at,
  routing_stage
FROM snapshots_view
WHERE user_id = 'user-123'
  AND message_text IS NOT NULL
ORDER BY captured_at DESC
LIMIT 20;
```

**Use Case:** Display user's recent messages

---

### 3. Debug Sessions

```sql
SELECT
  correlation_id,
  debug_initiated_by,
  debug_started_at,
  event_type,
  message_text
FROM snapshots_view
WHERE debug_enabled = true
ORDER BY debug_started_at DESC
LIMIT 50;
```

**Use Case:** Review debug sessions for troubleshooting

---

### 4. Routing Stage Distribution

```sql
SELECT
  routing_stage,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM snapshots_view
WHERE captured_at > NOW() - INTERVAL '7 days'
  AND kind = 'update'
GROUP BY routing_stage
ORDER BY count DESC;
```

**Use Case:** Analyze where events spend time in routing flow

---

### 5. Failed Deliveries

```sql
SELECT
  correlation_id,
  message_text,
  delivery_error_code,
  delivery_error_message,
  delivery_delivered_at
FROM snapshots_view
WHERE kind = 'final'
  AND delivery_error_code IS NOT NULL
ORDER BY delivery_delivered_at DESC;
```

**Use Case:** Investigate delivery failures

---

### 6. Deadletter Analysis

```sql
SELECT
  deadletter_reason,
  COUNT(*) as count,
  ARRAY_AGG(DISTINCT deadletter_error_code) as error_codes
FROM snapshots_view
WHERE kind = 'deadletter'
  AND deadletter_at > NOW() - INTERVAL '24 hours'
GROUP BY deadletter_reason
ORDER BY count DESC;
```

**Use Case:** Identify most common failure reasons

---

### 7. Platform Activity

```sql
SELECT
  external_platform,
  COUNT(DISTINCT external_user_id) as unique_users,
  COUNT(*) as total_messages
FROM snapshots_view
WHERE event_type = 'chat.message.v1'
  AND captured_at > NOW() - INTERVAL '1 day'
  AND kind = 'initial'
GROUP BY external_platform;
```

**Use Case:** Monitor activity across platforms (Discord, Twitch, Slack)

---

### 8. Channel Message History

```sql
SELECT
  message_text,
  external_display_name,
  captured_at
FROM snapshots_view
WHERE ingress_channel = '#general'
  AND message_text IS NOT NULL
  AND kind = 'initial'
ORDER BY captured_at DESC
LIMIT 100;
```

**Use Case:** Display channel chat history

---

### 9. Tool Interaction Analysis (Debug Mode)

```sql
SELECT
  correlation_id,
  debug_initiated_by,
  jsonb_array_length(full_data->'event'->'metadata'->'toolInteractions') as tool_count,
  full_data->'event'->'metadata'->'toolInteractions' as tools
FROM snapshots_view
WHERE debug_enabled = true
  AND full_data->'event'->'metadata'->'toolInteractions' IS NOT NULL
ORDER BY captured_at DESC;
```

**Use Case:** Analyze tool usage in debug sessions

---

### 10. LLM Bot Performance

```sql
WITH llm_snapshots AS (
  SELECT
    correlation_id,
    routing_stage,
    captured_at,
    LAG(captured_at) OVER (PARTITION BY correlation_id ORDER BY sequence) as prev_captured_at
  FROM snapshots_view
  WHERE routing_stage IN ('analysis', 'reaction')
)
SELECT
  routing_stage,
  AVG(EXTRACT(EPOCH FROM (captured_at - prev_captured_at))) as avg_duration_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (captured_at - prev_captured_at))) as p95_duration_seconds
FROM llm_snapshots
WHERE prev_captured_at IS NOT NULL
GROUP BY routing_stage;
```

**Use Case:** Measure LLM bot processing latency

---

### 11. User Annotation Analysis

```sql
SELECT
  user_id,
  user_display_name,
  annotations_count,
  COUNT(*) as message_count
FROM snapshots_view
WHERE annotations_count > 0
  AND kind = 'final'
  AND captured_at > NOW() - INTERVAL '7 days'
GROUP BY user_id, user_display_name, annotations_count
ORDER BY annotations_count DESC;
```

**Use Case:** Identify users with heavily annotated messages

---

### 12. Response Candidate Analysis

```sql
SELECT
  correlation_id,
  candidates_count,
  full_data->'event'->'candidates' as candidates
FROM snapshots_view
WHERE candidates_count > 1
  AND kind = 'final'
ORDER BY candidates_count DESC
LIMIT 20;
```

**Use Case:** Find events with multiple response candidates

---

### 13. Auth Failure Analysis

```sql
SELECT
  external_platform,
  external_user_id,
  auth_matched,
  COUNT(*) as attempts
FROM snapshots_view
WHERE auth_matched = false
  AND captured_at > NOW() - INTERVAL '1 day'
GROUP BY external_platform, external_user_id, auth_matched
ORDER BY attempts DESC;
```

**Use Case:** Identify users failing authentication

---

### 14. Egress Channel Distribution

```sql
SELECT
  egress_connector,
  egress_channel,
  COUNT(*) as message_count
FROM snapshots_view
WHERE kind = 'final'
  AND captured_at > NOW() - INTERVAL '7 days'
GROUP BY egress_connector, egress_channel
ORDER BY message_count DESC
LIMIT 10;
```

**Use Case:** Identify most active egress channels

---

### 15. Event Type Timeline

```sql
SELECT
  DATE_TRUNC('hour', captured_at::timestamp) as hour,
  event_type,
  COUNT(*) as count
FROM snapshots_view
WHERE captured_at > NOW() - INTERVAL '24 hours'
  AND kind = 'initial'
GROUP BY hour, event_type
ORDER BY hour DESC, count DESC;
```

**Use Case:** Monitor event type distribution over time

---

## Advanced Queries

### Multi-Table Join: Events + Snapshots

```sql
SELECT
  e.correlation_id,
  e.status as aggregate_status,
  s.routing_stage,
  s.message_text,
  s.captured_at
FROM events e
LEFT JOIN snapshots_view s ON e.correlation_id = s.correlation_id
WHERE e.status = 'IN_PROGRESS'
  AND s.kind = 'update'
ORDER BY s.captured_at DESC
LIMIT 100;
```

**Use Case:** Monitor in-progress events with latest snapshot details

---

### Filtering with JSONB Operators

```sql
-- Find snapshots with specific annotation kinds
SELECT
  correlation_id,
  message_text,
  full_data->'event'->'annotations' as annotations
FROM snapshots_view
WHERE full_data->'event'->'annotations' @> '[{"kind": "prompt"}]'::jsonb
  AND kind = 'final';

-- Find snapshots with personality annotations
SELECT
  correlation_id,
  message_text,
  jsonb_array_elements(full_data->'event'->'annotations') as annotation
FROM snapshots_view
WHERE full_data->'event'->'annotations' @> '[{"kind": "personality"}]'::jsonb;
```

**Use Case:** Advanced filtering on nested JSONB structures

---

### Time-Series Analysis

```sql
WITH hourly_stats AS (
  SELECT
    DATE_TRUNC('hour', captured_at::timestamp) as hour,
    routing_stage,
    COUNT(*) as snapshot_count,
    COUNT(DISTINCT correlation_id) as unique_events
  FROM snapshots_view
  WHERE captured_at > NOW() - INTERVAL '7 days'
  GROUP BY hour, routing_stage
)
SELECT
  hour,
  routing_stage,
  snapshot_count,
  unique_events,
  ROUND(snapshot_count::numeric / unique_events, 2) as avg_snapshots_per_event
FROM hourly_stats
ORDER BY hour DESC, snapshot_count DESC;
```

**Use Case:** Analyze system load and event processing patterns

---

## Performance Considerations

### Index Usage

All indexed columns are extracted directly from the base table's functional indexes, ensuring optimal query performance:

```sql
-- Good: Uses idx_snapshots_user_id
SELECT * FROM snapshots_view WHERE user_id = 'user-123';

-- Good: Uses idx_snapshots_event_type
SELECT * FROM snapshots_view WHERE event_type = 'chat.message.v1';

-- Good: Uses idx_snapshots_user_timeline (composite)
SELECT * FROM snapshots_view
WHERE user_id = 'user-123'
ORDER BY captured_at DESC;
```

### Query Optimization Tips

1. **Always filter by indexed columns first**
   ```sql
   -- Good
   WHERE correlation_id = 'abc-123' AND routing_stage = 'analysis'

   -- Less optimal
   WHERE routing_stage = 'analysis' AND correlation_id = 'abc-123'
   ```

2. **Use LIMIT for large result sets**
   ```sql
   SELECT * FROM snapshots_view
   WHERE user_id = 'user-123'
   ORDER BY captured_at DESC
   LIMIT 100;  -- Always limit!
   ```

3. **Avoid full_data queries without WHERE clause**
   ```sql
   -- Bad: Full table scan
   SELECT full_data FROM snapshots_view;

   -- Good: Filtered first
   SELECT full_data FROM snapshots_view
   WHERE correlation_id = 'abc-123';
   ```

4. **Use COUNT(*) instead of COUNT(column) when possible**
   ```sql
   -- Faster
   SELECT COUNT(*) FROM snapshots_view WHERE user_id = 'user-123';

   -- Slower
   SELECT COUNT(snapshot_id) FROM snapshots_view WHERE user_id = 'user-123';
   ```

---

## Maintenance

### View Refresh

The view is **automatically updated** when the base `snapshots` table changes (no manual refresh needed).

### Schema Evolution

If the `EventSnapshotDocV1` or `InternalEventV2` schemas change, the view definition must be updated:

```sql
-- Drop and recreate view
DROP VIEW IF EXISTS snapshots_view;
-- ... (paste updated view definition)
```

### Index Maintenance

Indexes are created on the base `snapshots` table and are **automatically maintained** by PostgreSQL.

---

## Troubleshooting

### Query Not Using Index

**Symptom:** Query is slow despite indexed columns

**Solution:** Use `EXPLAIN ANALYZE` to verify index usage:

```sql
EXPLAIN ANALYZE
SELECT * FROM snapshots_view WHERE user_id = 'user-123';
```

Look for `Index Scan using idx_snapshots_user_id` in the output.

### Null Values in Expected Fields

**Symptom:** Columns are unexpectedly NULL

**Possible Causes:**
- Event missing that field (e.g., no message for system events)
- JSONB path incorrect (check `full_data` to verify structure)
- Type casting failure (e.g., invalid timestamp)

**Solution:** Check the raw JSONB data:

```sql
SELECT full_data FROM snapshots_view WHERE snapshot_id = 'problematic-id';
```

### Performance Degradation

**Symptom:** Queries getting slower over time

**Possible Causes:**
- Table size growing (millions of rows)
- Missing VACUUM/ANALYZE

**Solutions:**
```sql
-- Vacuum and analyze
VACUUM ANALYZE snapshots;

-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('snapshots'));

-- Add time-based partitioning (advanced)
-- See PostgreSQL partitioning documentation
```

---

## References

- **Migration File:** `infrastructure/postgres/migrations/020-add-snapshots-view.sql`
- **Base Table:** `infrastructure/postgres/migrations/007-add-snapshots-table.sql`
- **Event Schema:** `src/types/events.ts` (EventSnapshotDocV1, InternalEventV2)
- **Persistence Service:** `src/services/persistence/store.ts`
- **PostgreSQL JSONB Docs:** https://www.postgresql.org/docs/current/datatype-json.html

---

**Document Status:** ✅ Complete
**Last Updated:** 2026-08-21
**Owner:** Platform Architecture Team
