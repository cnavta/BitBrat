-- Migration 030: Migrate tool-gateway sourceMetadata to tool-orchestrator
-- Sprint 66: Update tool origin references after tool-gateway deprecation
--
-- Purpose: Change sourceMetadata.mcpServer from "tool-gateway" to "tool-orchestrator"
--          for all tools that were imported from tool-gateway
-- Safety: Creates backup table, allows rollback
--
-- Problem: 371 tools still reference tool-gateway as their origin server.
--          When llm-bot tries to execute these tools, it looks up which MCP server
--          they came from and tries to route to tool-gateway, which doesn't exist.
--
-- Error Example:
-- "MCP Tool Error: Model not found: tool-gateway"
-- Tool: mcp_disposition-service_bit_config_get
--
-- Schema: DocumentStore uses JSONB `data` column
-- sourceMetadata structure: {"mcpServer": {"name": "tool-gateway"}}
-- Target structure:         {"mcpServer": {"name": "tool-orchestrator"}}

BEGIN;

-- ============================================================================
-- Step 1: Create backup table (for rollback)
-- ============================================================================
DROP TABLE IF EXISTS platform_tool_registry_backup_030;

CREATE TABLE platform_tool_registry_backup_030 AS
SELECT * FROM platform_tool_registry
WHERE data->'sourceMetadata'->>'mcpServer' LIKE '%tool-gateway%';

-- Log backup creation
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM platform_tool_registry_backup_030;
  RAISE NOTICE 'Backup created: % tools saved to platform_tool_registry_backup_030', backup_count;
END $$;

-- ============================================================================
-- Step 2: Update sourceMetadata to reference tool-orchestrator
-- ============================================================================
-- Strategy:
-- 1. Update data->'sourceMetadata'->'mcpServer'->>'name' from "tool-gateway" to "tool-orchestrator"
-- 2. Preserve all other sourceMetadata fields
-- 3. Update lastUpdatedAt timestamp

UPDATE platform_tool_registry
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{sourceMetadata,mcpServer,name}',
      '"tool-orchestrator"'
    ),
    '{lastUpdatedAt}',
    to_jsonb(NOW()::text)
  ),
  updated_at = NOW()
WHERE
  data->'sourceMetadata'->>'mcpServer' LIKE '%tool-gateway%';

-- ============================================================================
-- Step 3: Verify fixes
-- ============================================================================
DO $$
DECLARE
  fixed_count INTEGER;
  remaining_tool_gateway INTEGER;
BEGIN
  -- Count tools that were fixed
  SELECT COUNT(*) INTO fixed_count
  FROM platform_tool_registry_backup_030 b
  INNER JOIN platform_tool_registry r ON b.id = r.id
  WHERE b.data->'sourceMetadata'->>'mcpServer' LIKE '%tool-gateway%'
    AND r.data->'sourceMetadata'->>'mcpServer' LIKE '%tool-orchestrator%';

  -- Count tools still referencing tool-gateway (should be 0)
  SELECT COUNT(*) INTO remaining_tool_gateway
  FROM platform_tool_registry
  WHERE data->'sourceMetadata'->>'mcpServer' LIKE '%tool-gateway%';

  RAISE NOTICE 'Fixed % tools', fixed_count;
  RAISE NOTICE 'Remaining tool-gateway references: %', remaining_tool_gateway;

  -- Abort if fix didn't work
  IF remaining_tool_gateway > 0 THEN
    RAISE EXCEPTION 'Migration failed: % tools still reference tool-gateway', remaining_tool_gateway;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Show before/after examples
-- ============================================================================
SELECT
  b.id AS tool_id,
  b.data->'sourceMetadata'->>'mcpServer' AS before_source_metadata,
  r.data->'sourceMetadata'->>'mcpServer' AS after_source_metadata,
  'FIXED' AS status
FROM platform_tool_registry_backup_030 b
INNER JOIN platform_tool_registry r ON b.id = r.id
WHERE b.data->'sourceMetadata'->>'mcpServer' != r.data->'sourceMetadata'->>'mcpServer'
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
-- FROM platform_tool_registry_backup_030 b
-- WHERE r.id = b.id;
-- COMMIT;
--
-- Then drop backup table:
-- DROP TABLE platform_tool_registry_backup_030;

-- ============================================================================
-- Post-Migration Validation:
-- ============================================================================
-- Run this query after migration to verify no tools reference tool-gateway:
--
-- SELECT
--   COUNT(*) AS total_mcp_tools,
--   COUNT(CASE WHEN data->'sourceMetadata'->>'mcpServer' LIKE '%tool-gateway%' THEN 1 END) AS tool_gateway_refs,
--   COUNT(CASE WHEN data->'sourceMetadata'->>'mcpServer' LIKE '%tool-orchestrator%' THEN 1 END) AS tool_orchestrator_refs
-- FROM platform_tool_registry
-- WHERE data->>'source' = 'mcp';
--
-- Expected result:
-- total_mcp_tools | tool_gateway_refs | tool_orchestrator_refs
-- ----------------|-------------------|------------------------
--            504  |                 0 |                    371
