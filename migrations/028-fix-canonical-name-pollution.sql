-- Migration 028: Fix canonicalName Pollution
-- Sprint 66: Clean up multiple-prefix pollution in canonicalName field
--
-- Purpose: Normalize canonicalName to match original tool names from upstream MCP servers
-- Safety: Creates backup table, allows rollback
--
-- Problem Examples (from Analysis 027):
-- ❌ "mcp:mcp_mcp_mcp_mcp_mcp_mcp_counter.increment" → ✅ "counter.increment"
-- ❌ "mcp:mcp_event-stream-analyzer_bit.readiness"   → ✅ "bit.readiness"
-- ❌ "mcp:mcp_tool-orchestrator_bit.info"            → ✅ "bit.info"
--
-- Root Cause: tool-gateway's importFromBit() was using sanitized tool names
-- instead of canonicalName, causing re-prefixing on each import cycle.
--
-- Impact: 247 tools (49% of MCP tools) affected
--
-- Schema: DocumentStore uses JSONB `data` column
-- Access fields via: data->>'fieldName'
-- Update with: jsonb_set(data, '{fieldName}', '"new_value"')

BEGIN;

-- ============================================================================
-- Step 1: Create backup table (for rollback)
-- ============================================================================
DROP TABLE IF EXISTS platform_tool_registry_backup_028;

CREATE TABLE platform_tool_registry_backup_028 AS
SELECT * FROM platform_tool_registry
WHERE data->>'source' = 'mcp' AND data->>'canonicalName' LIKE 'mcp:mcp_%';

-- Log backup creation
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM platform_tool_registry_backup_028;
  RAISE NOTICE 'Backup created: % tools saved to platform_tool_registry_backup_028', backup_count;
END $$;

-- ============================================================================
-- Step 2: Fix canonicalName by extracting tool name from ID
-- ============================================================================
-- Strategy:
-- 1. Tool ID format: "mcp:namespace/tool.name" or "mcp:tool.name"
-- 2. Extract tool name after last '/' or after first '.'
-- 3. Preserve dots in tool names (e.g., "bit.info" not "bit_info")
-- 4. Remove all "mcp:" prefixes and underscore pollution

UPDATE platform_tool_registry
SET
  data = jsonb_set(
    jsonb_set(
      data,
      '{canonicalName}',
      to_jsonb(
        CASE
          -- Pattern 1: "mcp:namespace/tool.name" → "tool.name"
          -- Example: "mcp:image-gen-mcp/bit.info" → "bit.info"
          WHEN id LIKE 'mcp:%/%' THEN
            SPLIT_PART(id, '/', 2)

          -- Pattern 2: "mcp:namespace.tool.name" → "tool.name"
          -- Example: "mcp:reflex.list" → "list"
          -- Extract everything after first dot following "mcp:"
          WHEN id LIKE 'mcp:%' AND id NOT LIKE '%/%' THEN
            CASE
              WHEN POSITION('.' IN SUBSTRING(id FROM 5)) > 0 THEN
                SUBSTRING(id FROM POSITION('.' IN id) + 1)
              ELSE
                SUBSTRING(id FROM 5)  -- No dot, just remove mcp: prefix
            END

          ELSE
            data->>'canonicalName'  -- Keep as-is if doesn't match patterns
        END
      )
    ),
    '{lastUpdatedAt}',
    to_jsonb(NOW()::text)
  ),
  updated_at = NOW()
WHERE
  data->>'source' = 'mcp'
  AND data->>'canonicalName' LIKE 'mcp:mcp_%';

-- ============================================================================
-- Step 3: Verify fixes
-- ============================================================================
DO $$
DECLARE
  fixed_count INTEGER;
  remaining_polluted INTEGER;
BEGIN
  -- Count tools that were fixed
  SELECT COUNT(*) INTO fixed_count
  FROM platform_tool_registry_backup_028 b
  INNER JOIN platform_tool_registry r ON b.id = r.id
  WHERE b.data->>'canonicalName' != r.data->>'canonicalName';

  -- Count tools still polluted (should be 0)
  SELECT COUNT(*) INTO remaining_polluted
  FROM platform_tool_registry
  WHERE data->>'source' = 'mcp' AND data->>'canonicalName' LIKE 'mcp:mcp_%';

  RAISE NOTICE 'Fixed % tools', fixed_count;
  RAISE NOTICE 'Remaining polluted tools: %', remaining_polluted;

  -- Abort if fix didn't work
  IF remaining_polluted > 0 THEN
    RAISE EXCEPTION 'Migration failed: % tools still have polluted canonicalName', remaining_polluted;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Show before/after examples
-- ============================================================================
SELECT
  b.id AS tool_id,
  b.data->>'canonicalName' AS before_canonical_name,
  r.data->>'canonicalName' AS after_canonical_name,
  'FIXED' AS status
FROM platform_tool_registry_backup_028 b
INNER JOIN platform_tool_registry r ON b.id = r.id
WHERE b.data->>'canonicalName' != r.data->>'canonicalName'
ORDER BY LENGTH(b.data->>'canonicalName') DESC  -- Show worst cases first
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
-- FROM platform_tool_registry_backup_028 b
-- WHERE r.id = b.id;
-- COMMIT;
--
-- Then drop backup table:
-- DROP TABLE platform_tool_registry_backup_028;

-- ============================================================================
-- Post-Migration Validation:
-- ============================================================================
-- Run this query after migration to verify all tools have clean canonicalName:
--
-- SELECT
--   COUNT(*) AS total_mcp_tools,
--   COUNT(CASE WHEN data->>'canonicalName' LIKE 'mcp:mcp_%' THEN 1 END) AS polluted_tools,
--   COUNT(CASE WHEN data->>'canonicalName' NOT LIKE 'mcp:%' THEN 1 END) AS clean_tools
-- FROM platform_tool_registry
-- WHERE data->>'source' = 'mcp';
--
-- Expected result:
-- total_mcp_tools | polluted_tools | clean_tools
-- ----------------|----------------|-------------
--            504  |              0 |         504
