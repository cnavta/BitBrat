-- Migration 031: Backfill Missing sourceMetadata
-- Sprint 66: Fix tools with NULL/missing sourceMetadata
--
-- Purpose: Reconstruct sourceMetadata.mcpServer from tool ID for tools with missing metadata
-- Safety: Creates backup table, allows rollback
--
-- Problem: 110 tools have NULL sourceMetadata, causing tool execution crashes:
--          "Cannot read properties of undefined (reading 'mcpServer')"
--
-- Error Example:
-- Tool: mcp_reflex_bit_config_get
-- Error: "Cannot read properties of undefined (reading 'mcpServer')"
-- Trace ID: 91d7cf3d-a42e-4c69-8f3e-4dac239d0a4f
--
-- Schema: DocumentStore uses JSONB `data` column
-- Target structure: {
--   "sourceMetadata": {
--     "mcpServer": {
--       "name": "server-name",
--       "transport": "stdio"
--     }
--   }
-- }

BEGIN;

-- ============================================================================
-- Step 1: Create backup table (for rollback)
-- ============================================================================
DROP TABLE IF EXISTS platform_tool_registry_backup_031;

CREATE TABLE platform_tool_registry_backup_031 AS
SELECT * FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
  AND data->>'sourceMetadata' IS NULL;

-- Log backup creation
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM platform_tool_registry_backup_031;
  RAISE NOTICE 'Backup created: % tools saved to platform_tool_registry_backup_031', backup_count;
END $$;

-- ============================================================================
-- Step 2: Backfill sourceMetadata by extracting server name from ID
-- ============================================================================
-- Strategy:
-- 1. Tool ID format: "mcp:namespace/tool.name" or "mcp:tool.name"
-- 2. Extract namespace as server name
-- 3. Special cases:
--    - "mcp:agent.sendProgressUpdate" → "tool-orchestrator"
--    - "mcp:composition.*" → "tool-orchestrator"
-- 4. If namespace extracted from ID, use that (e.g., "mcp:api-gateway/bit.info" → "api-gateway")

UPDATE platform_tool_registry
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{sourceMetadata}',
      jsonb_build_object(
        'mcpServer', jsonb_build_object(
          'name',
          CASE
            -- Special case: agent.sendProgressUpdate is from tool-orchestrator
            WHEN id = 'mcp:agent.sendProgressUpdate' THEN 'tool-orchestrator'

            -- Special case: composition.* tools are from tool-orchestrator
            WHEN id LIKE 'mcp:composition.%' THEN 'tool-orchestrator'

            -- Pattern 1: "mcp:namespace/tool.name" → extract "namespace"
            -- Example: "mcp:api-gateway/bit.info" → "api-gateway"
            WHEN id LIKE 'mcp:%/%' THEN
              SPLIT_PART(SUBSTRING(id FROM 5), '/', 1)

            -- Pattern 2: "mcp:tool.name" (no namespace) → assume "tool-orchestrator"
            -- Example: "mcp:some_tool" → "tool-orchestrator"
            ELSE 'tool-orchestrator'
          END,
          'transport', 'stdio'
        )
      )
    ),
    '{lastUpdatedAt}',
    to_jsonb(NOW()::text)
  ),
  updated_at = NOW()
WHERE
  data->>'source' = 'mcp'
  AND data->>'sourceMetadata' IS NULL;

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
  FROM platform_tool_registry_backup_031 b
  INNER JOIN platform_tool_registry r ON b.id = r.id
  WHERE b.data->>'sourceMetadata' IS NULL
    AND r.data->>'sourceMetadata' IS NOT NULL;

  -- Count tools still missing sourceMetadata (should be 0)
  SELECT COUNT(*) INTO remaining_missing
  FROM platform_tool_registry
  WHERE data->>'source' = 'mcp'
    AND data->>'sourceMetadata' IS NULL;

  RAISE NOTICE 'Fixed % tools', fixed_count;
  RAISE NOTICE 'Remaining missing sourceMetadata: %', remaining_missing;

  -- Abort if fix didn't work
  IF remaining_missing > 0 THEN
    RAISE EXCEPTION 'Migration failed: % tools still have missing sourceMetadata', remaining_missing;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Show before/after examples
-- ============================================================================
SELECT
  b.id AS tool_id,
  CASE
    WHEN b.data->>'sourceMetadata' IS NULL THEN '(null)'
    ELSE b.data->>'sourceMetadata'
  END AS before_source_metadata,
  r.data->'sourceMetadata'->>'mcpServer' AS after_mcp_server,
  'FIXED' AS status
FROM platform_tool_registry_backup_031 b
INNER JOIN platform_tool_registry r ON b.id = r.id
WHERE b.data->>'sourceMetadata' IS NULL
  AND r.data->>'sourceMetadata' IS NOT NULL
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
-- FROM platform_tool_registry_backup_031 b
-- WHERE r.id = b.id;
-- COMMIT;
--
-- Then drop backup table:
-- DROP TABLE platform_tool_registry_backup_031;

-- ============================================================================
-- Post-Migration Validation:
-- ============================================================================
-- Run this query after migration to verify no tools have missing sourceMetadata:
--
-- SELECT
--   COUNT(*) AS total_mcp_tools,
--   COUNT(CASE WHEN data->>'sourceMetadata' IS NULL THEN 1 END) AS missing_source_metadata,
--   COUNT(CASE WHEN data->'sourceMetadata'->>'mcpServer' IS NULL THEN 1 END) AS missing_mcp_server
-- FROM platform_tool_registry
-- WHERE data->>'source' = 'mcp';
--
-- Expected result:
-- total_mcp_tools | missing_source_metadata | missing_mcp_server
-- ----------------|-------------------------|-------------------
--            504  |                       0 |                  0
