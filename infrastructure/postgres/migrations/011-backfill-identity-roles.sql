-- Migration: Backfill identitySummary.roles from snapshots
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This migration backfills the roles, rolesMeta, tags, and status fields
-- in the events table's identitySummary by extracting them from the
-- latest auth-enriched snapshot for each event.

-- Step 1: Add roles field to identitySummary for events that have user identity
UPDATE events e
SET data = jsonb_set(
  data,
  '{identitySummary,roles}',
  COALESCE(
    (
      SELECT s.data->'event'->'identity'->'user'->'roles'
      FROM snapshots s
      WHERE s.data->>'correlationId' = e.data->>'correlationId'
        AND s.data->'event'->'identity'->'user'->'roles' IS NOT NULL
      ORDER BY (s.data->>'sequence')::int DESC
      LIMIT 1
    ),
    '[]'::jsonb
  )
)
WHERE data->'identitySummary'->'userId' IS NOT NULL
  AND data->'identitySummary'->'userId' != 'null'::jsonb
  AND (data->'identitySummary'->'roles' IS NULL OR data->'identitySummary'->'roles' = 'null'::jsonb);

-- Step 2: Add rolesMeta field
UPDATE events e
SET data = jsonb_set(
  data,
  '{identitySummary,rolesMeta}',
  COALESCE(
    (
      SELECT s.data->'event'->'identity'->'user'->'rolesMeta'
      FROM snapshots s
      WHERE s.data->>'correlationId' = e.data->>'correlationId'
        AND s.data->'event'->'identity'->'user'->'rolesMeta' IS NOT NULL
      ORDER BY (s.data->>'sequence')::int DESC
      LIMIT 1
    ),
    '{}'::jsonb
  )
)
WHERE data->'identitySummary'->'userId' IS NOT NULL
  AND data->'identitySummary'->'userId' != 'null'::jsonb
  AND (data->'identitySummary'->'rolesMeta' IS NULL OR data->'identitySummary'->'rolesMeta' = 'null'::jsonb);

-- Step 3: Add tags field
UPDATE events e
SET data = jsonb_set(
  data,
  '{identitySummary,tags}',
  COALESCE(
    (
      SELECT s.data->'event'->'identity'->'user'->'tags'
      FROM snapshots s
      WHERE s.data->>'correlationId' = e.data->>'correlationId'
        AND s.data->'event'->'identity'->'user'->'tags' IS NOT NULL
      ORDER BY (s.data->>'sequence')::int DESC
      LIMIT 1
    ),
    '[]'::jsonb
  )
)
WHERE data->'identitySummary'->'userId' IS NOT NULL
  AND data->'identitySummary'->'userId' != 'null'::jsonb
  AND (data->'identitySummary'->'tags' IS NULL OR data->'identitySummary'->'tags' = 'null'::jsonb);

-- Step 4: Add status field
UPDATE events e
SET data = jsonb_set(
  data,
  '{identitySummary,status}',
  COALESCE(
    (
      SELECT s.data->'event'->'identity'->'user'->'status'
      FROM snapshots s
      WHERE s.data->>'correlationId' = e.data->>'correlationId'
        AND s.data->'event'->'identity'->'user'->'status' IS NOT NULL
      ORDER BY (s.data->>'sequence')::int DESC
      LIMIT 1
    ),
    '"active"'::jsonb
  )
)
WHERE data->'identitySummary'->'userId' IS NOT NULL
  AND data->'identitySummary'->'userId' != 'null'::jsonb
  AND (data->'identitySummary'->'status' IS NULL OR data->'identitySummary'->'status' = 'null'::jsonb);

-- Report backfill statistics
SELECT
  'Backfill complete' AS status,
  COUNT(*) FILTER (WHERE data->'identitySummary'->'roles' IS NOT NULL) AS events_with_roles,
  COUNT(*) FILTER (WHERE data->'identitySummary'->'rolesMeta' IS NOT NULL) AS events_with_role_meta,
  COUNT(*) FILTER (WHERE data->'identitySummary'->'tags' IS NOT NULL) AS events_with_tags,
  COUNT(*) FILTER (WHERE data->'identitySummary'->'status' IS NOT NULL) AS events_with_status,
  COUNT(*) AS total_events_with_identity
FROM events
WHERE data->'identitySummary'->'userId' IS NOT NULL
  AND data->'identitySummary'->'userId' != 'null'::jsonb;
