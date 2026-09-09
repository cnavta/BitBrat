-- Migration: Add snapshots view with JSON field extraction
-- Sprint: TBD
-- Date: 2026-08-21
--
-- This view extracts commonly-queried fields from the snapshots.data JSONB column
-- for easier querying and analysis. Flattens the EventSnapshotDocV1 structure
-- including nested InternalEventV2 fields (message, identity, routing, etc.).
--
-- Usage:
--   SELECT * FROM snapshots_view WHERE correlation_id = 'abc-123';
--   SELECT * FROM snapshots_view WHERE user_id = 'user-456' ORDER BY captured_at DESC LIMIT 10;
--   SELECT * FROM snapshots_view WHERE routing_stage = 'analysis' AND kind = 'update';

-- Drop view if exists (for idempotent migrations)
DROP VIEW IF EXISTS snapshots_view;

-- Create snapshots view with extracted JSON fields
CREATE VIEW snapshots_view AS
SELECT
  -- Primary identifiers
  s.id AS snapshot_id,
  s.data->>'correlationId' AS correlation_id,
  (s.data->>'sequence')::int AS sequence,
  s.data->>'kind' AS kind,

  -- Snapshot metadata
  s.data->>'capturedAt' AS captured_at,
  s.data->>'sourceService' AS source_service,
  s.data->>'sourceTopic' AS source_topic,
  s.data->>'idempotencyKey' AS idempotency_key,
  s.data->>'changeSummary' AS change_summary,

  -- Routing slip fields
  s.data->>'stage' AS routing_stage,
  s.data->>'stepId' AS step_id,
  (s.data->>'attempt')::int AS attempt,

  -- Event type and basic metadata
  s.data->'event'->>'type' AS event_type,
  s.data->'event'->>'v' AS event_version,
  s.data->'event'->>'traceId' AS trace_id,

  -- Message fields (for chat events)
  s.data->'event'->'message'->>'id' AS message_id,
  s.data->'event'->'message'->>'role' AS message_role,
  s.data->'event'->'message'->>'text' AS message_text,
  s.data->'event'->'message'->>'language' AS message_language,

  -- Ingress metadata
  s.data->'event'->'ingress'->>'ingressAt' AS ingress_at,
  s.data->'event'->'ingress'->>'source' AS ingress_source,
  s.data->'event'->'ingress'->>'connector' AS ingress_connector,
  s.data->'event'->'ingress'->>'channel' AS ingress_channel,

  -- Identity: External (platform-provided)
  s.data->'event'->'identity'->'external'->>'id' AS external_user_id,
  s.data->'event'->'identity'->'external'->>'platform' AS external_platform,
  s.data->'event'->'identity'->'external'->>'displayName' AS external_display_name,
  s.data->'event'->'identity'->'external'->'roles' AS external_roles,

  -- Identity: User (internal auth-enriched)
  s.data->'event'->'identity'->'user'->>'id' AS user_id,
  s.data->'event'->'identity'->'user'->>'email' AS user_email,
  s.data->'event'->'identity'->'user'->>'displayName' AS user_display_name,
  s.data->'event'->'identity'->'user'->'roles' AS user_roles,
  s.data->'event'->'identity'->'user'->>'status' AS user_status,
  s.data->'event'->'identity'->'user'->>'notes' AS user_notes,
  s.data->'event'->'identity'->'user'->'tags' AS user_tags,

  -- Identity: Auth metadata
  s.data->'event'->'identity'->'auth'->>'provider' AS auth_provider,
  s.data->'event'->'identity'->'auth'->>'method' AS auth_method,
  (s.data->'event'->'identity'->'auth'->>'matched')::boolean AS auth_matched,
  s.data->'event'->'identity'->'auth'->>'at' AS auth_at,

  -- Egress metadata
  s.data->'event'->'egress'->>'destination' AS egress_destination,
  s.data->'event'->'egress'->>'type' AS egress_type,
  s.data->'event'->'egress'->>'connector' AS egress_connector,
  s.data->'event'->'egress'->>'channel' AS egress_channel,

  -- Routing slip summary
  s.data->'event'->'routing'->>'stage' AS event_routing_stage,
  jsonb_array_length(COALESCE(s.data->'event'->'routing'->'slip', '[]'::jsonb)) AS routing_slip_length,
  jsonb_array_length(COALESCE(s.data->'event'->'routing'->'history', '[]'::jsonb)) AS routing_history_length,

  -- Annotations summary
  jsonb_array_length(COALESCE(s.data->'event'->'annotations', '[]'::jsonb)) AS annotations_count,

  -- Candidates summary
  jsonb_array_length(COALESCE(s.data->'event'->'candidates', '[]'::jsonb)) AS candidates_count,

  -- QoS fields
  (s.data->'event'->'qos'->>'persistenceTtlSec')::int AS qos_persistence_ttl_sec,
  (s.data->'event'->'qos'->>'tracer')::boolean AS qos_tracer,
  (s.data->'event'->'qos'->>'maxResponseMs')::int AS qos_max_response_ms,

  -- Debug metadata (Sprint 371+)
  (s.data->'event'->'metadata'->'debug'->>'enabled')::boolean AS debug_enabled,
  s.data->'event'->'metadata'->'debug'->>'initiatedBy' AS debug_initiated_by,
  s.data->'event'->'metadata'->'debug'->>'feedbackChannel' AS debug_feedback_channel,
  s.data->'event'->'metadata'->'debug'->>'startedAt' AS debug_started_at,

  -- Delivery metadata (for final snapshots)
  s.data->'delivery'->>'destination' AS delivery_destination,
  s.data->'delivery'->>'status' AS delivery_status,
  s.data->'delivery'->>'deliveredAt' AS delivery_delivered_at,
  s.data->'delivery'->>'providerMessageId' AS delivery_provider_message_id,
  s.data->'delivery'->'error'->>'code' AS delivery_error_code,
  s.data->'delivery'->'error'->>'message' AS delivery_error_message,

  -- Deadletter metadata (for deadletter snapshots)
  s.data->'deadletter'->>'reason' AS deadletter_reason,
  s.data->'deadletter'->>'at' AS deadletter_at,
  s.data->'deadletter'->>'lastStepId' AS deadletter_last_step_id,
  s.data->'deadletter'->>'originalType' AS deadletter_original_type,
  s.data->'deadletter'->'error'->>'code' AS deadletter_error_code,
  s.data->'deadletter'->'error'->>'message' AS deadletter_error_message,

  -- Full JSONB data (for advanced queries)
  s.data AS full_data,

  -- Timestamps
  s.created_at,
  s.updated_at

FROM snapshots s;

-- Create indexes on commonly-queried view columns
-- Note: These are functional indexes on the base table, which the view will use

-- Index for user-based queries
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id
  ON snapshots((data->'event'->'identity'->'user'->>'id'));

-- Index for external user queries (platform-specific)
CREATE INDEX IF NOT EXISTS idx_snapshots_external_user_id
  ON snapshots((data->'event'->'identity'->'external'->>'id'));

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_snapshots_event_type
  ON snapshots((data->'event'->>'type'));

-- Index for routing stage queries
CREATE INDEX IF NOT EXISTS idx_snapshots_routing_stage
  ON snapshots((data->>'stage'));

-- Index for ingress source queries
CREATE INDEX IF NOT EXISTS idx_snapshots_ingress_source
  ON snapshots((data->'event'->'ingress'->>'source'));

-- Index for ingress channel queries
CREATE INDEX IF NOT EXISTS idx_snapshots_ingress_channel
  ON snapshots((data->'event'->'ingress'->>'channel'));

-- Index for captured_at timestamp queries (chronological ordering)
CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
  ON snapshots((data->>'capturedAt'));

-- Index for debug mode queries
CREATE INDEX IF NOT EXISTS idx_snapshots_debug_enabled
  ON snapshots(((data->'event'->'metadata'->'debug'->>'enabled')::boolean))
  WHERE (data->'event'->'metadata'->'debug'->>'enabled')::boolean = true;

-- Index for deadletter snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_deadletter
  ON snapshots((data->>'kind'))
  WHERE data->>'kind' = 'deadletter';

-- Composite index for user timeline queries
CREATE INDEX IF NOT EXISTS idx_snapshots_user_timeline
  ON snapshots(
    (data->'event'->'identity'->'user'->>'id'),
    (data->>'capturedAt') DESC
  );

SELECT 'snapshots_view created successfully with indexes' AS status;

-- Usage examples (as comments for documentation):
--
-- 1. Get all snapshots for a specific correlation ID:
--    SELECT * FROM snapshots_view WHERE correlation_id = 'c9f2a3b1-4e5f-6a7b-8c9d-0e1f2a3b4c5d';
--
-- 2. Get user's recent messages:
--    SELECT message_text, captured_at, routing_stage
--    FROM snapshots_view
--    WHERE user_id = 'user-123'
--    ORDER BY captured_at DESC
--    LIMIT 20;
--
-- 3. Find all debug sessions:
--    SELECT correlation_id, debug_initiated_by, debug_started_at, event_type
--    FROM snapshots_view
--    WHERE debug_enabled = true
--    ORDER BY debug_started_at DESC;
--
-- 4. Analyze routing stage distribution:
--    SELECT routing_stage, COUNT(*) as count
--    FROM snapshots_view
--    WHERE captured_at > NOW() - INTERVAL '7 days'
--    GROUP BY routing_stage
--    ORDER BY count DESC;
--
-- 5. Find failed deliveries:
--    SELECT correlation_id, delivery_error_code, delivery_error_message
--    FROM snapshots_view
--    WHERE kind = 'final' AND delivery_error_code IS NOT NULL;
--
-- 6. Get deadletter snapshots:
--    SELECT correlation_id, deadletter_reason, deadletter_error_message
--    FROM snapshots_view
--    WHERE kind = 'deadletter'
--    ORDER BY deadletter_at DESC;
--
-- 7. Find snapshots by platform (Discord, Twitch, etc.):
--    SELECT correlation_id, external_platform, external_user_id, message_text
--    FROM snapshots_view
--    WHERE external_platform = 'discord'
--    ORDER BY captured_at DESC
--    LIMIT 100;
--
-- 8. Get message history for a specific channel:
--    SELECT message_text, external_display_name, captured_at
--    FROM snapshots_view
--    WHERE ingress_channel = '#general'
--    ORDER BY captured_at DESC;
--
-- 9. Analyze tool usage in debug sessions:
--    SELECT
--      correlation_id,
--      jsonb_array_length(full_data->'event'->'metadata'->'toolInteractions') as tool_count
--    FROM snapshots_view
--    WHERE debug_enabled = true
--    AND full_data->'event'->'metadata'->'toolInteractions' IS NOT NULL;
--
-- 10. Find snapshots with specific annotation kinds:
--     SELECT correlation_id, message_text
--     FROM snapshots_view
--     WHERE full_data->'event'->'annotations' @> '[{"kind": "prompt"}]'::jsonb;
