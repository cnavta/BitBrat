-- Migration 032: Backfill Missing config
-- Sprint 66: Fix tools with NULL/missing config
--
-- Purpose: Create default config for tools missing config object
-- Safety: Creates backup table, allows rollback
--
-- Problem: 110 tools have NULL config, causing tool execution crashes:
--          "Cannot read properties of undefined (reading 'timeoutMs')"
--
-- Error Example:
-- Tool: mcp_get_state_prefix
-- Error: "Cannot read properties of undefined (reading 'timeoutMs')"
-- Correlation ID: 4eda8a1f-d8db-453d-8d70-1af6cbf2e9cd
--
-- Schema: DocumentStore uses JSONB `data` column
-- Target structure: {
--   "config": {
--     "timeoutMs": 5000,
--     "retryPolicy": {
--       "maxAttempts": 3,
--       "backoffMs": 1000
--     }
--   }
-- }

BEGIN;

-- ============================================================================
-- Step 1: Create backup table (for rollback)
-- ============================================================================
DROP TABLE IF EXISTS platform_tool_registry_backup_032;

CREATE TABLE platform_tool_registry_backup_032 AS
SELECT * FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
  AND data->>'config' IS NULL;

-- Log backup creation
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM platform_tool_registry_backup_032;
  RAISE NOTICE 'Backup created: % tools saved to platform_tool_registry_backup_032', backup_count;
END $$;

-- ============================================================================
-- Step 2: Backfill config with safe defaults
-- ============================================================================
-- Strategy:
-- 1. Set timeoutMs to 5000 (5 seconds default)
-- 2. Set retryPolicy to { maxAttempts: 3, backoffMs: 1000 }
-- 3. These match tool-gateway.ts defaults

UPDATE platform_tool_registry
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{config}',
      jsonb_build_object(
        'timeoutMs', 5000,
        'retryPolicy', jsonb_build_object(
          'maxAttempts', 3,
          'backoffMs', 1000
        )
      )
    ),
    '{lastUpdatedAt}',
    to_jsonb(NOW()::text)
  ),
  updated_at = NOW()
WHERE
  data->>'source' = 'mcp'
  AND data->>'config' IS NULL;

-- ============================================================================
-- Step 3: Verify fixes
-- ============================================================================
DO $$
DECLARE
  fixed_count INTEGER;
  remaining_missing INTEGER;
BEGIN
  -- Count tools that were fixed
  SELECT COUNT(*) INTO fixed_count
  FROM platform_tool_registry_backup_032 b
  INNER JOIN platform_tool_registry r ON b.id = r.id
  WHERE b.data->>'config' IS NULL
    AND r.data->>'config' IS NOT NULL;

  -- Count tools still missing config (should be 0)
  SELECT COUNT(*) INTO remaining_missing
  FROM platform_tool_registry
  WHERE data->>'source' = 'mcp'
    AND data->>'config' IS NULL;

  RAISE NOTICE 'Fixed % tools', fixed_count;
  RAISE NOTICE 'Remaining missing config: %', remaining_missing;

  -- Abort if fix didn't work
  IF remaining_missing > 0 THEN
    RAISE EXCEPTION 'Migration failed: % tools still have missing config', remaining_missing;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Show before/after examples
-- ============================================================================
SELECT
  b.id AS tool_id,
  CASE
    WHEN b.data->>'config' IS NULL THEN '(null)'
    ELSE b.data->>'config'
  END AS before_config,
  r.data->'config'->>'timeoutMs' AS after_timeout_ms,
  r.data->'config'->'retryPolicy'->>'maxAttempts' AS after_max_attempts,
  'FIXED' AS status
FROM platform_tool_registry_backup_032 b
INNER JOIN platform_tool_registry r ON b.id = r.id
WHERE b.data->>'config' IS NULL
  AND r.data->>'config' IS NOT NULL
ORDER BY b.id
LIMIT 20;

-- ============================================================================
-- Step 5: Commit transaction
-- ============================================================================
COMMIT;

-- ============================================================================
-- Rollback Instructions (if needed):
-- ============================================================================
-- If migration causes issues, rollback with:
--
-- BEGIN;
-- UPDATE platform_tool_registry r
-- SET
--   data = b.data,
--   updated_at = b.updated_at
-- FROM platform_tool_registry_backup_032 b
-- WHERE r.id = b.id;
-- COMMIT;
--
-- Then drop backup table:
-- DROP TABLE platform_tool_registry_backup_032;

-- ============================================================================
-- Post-Migration Validation:
-- ============================================================================
-- Run this query after migration to verify no tools have missing config:
--
-- SELECT
--   COUNT(*) AS total_mcp_tools,
--   COUNT(CASE WHEN data->>'config' IS NULL THEN 1 END) AS missing_config,
--   COUNT(CASE WHEN data->'config'->>'timeoutMs' IS NULL THEN 1 END) AS missing_timeout
-- FROM platform_tool_registry
-- WHERE data->>'source' = 'mcp';
--
-- Expected result:
-- total_mcp_tools | missing_config | missing_timeout
-- ----------------|----------------|----------------
--            504  |              0 |               0
