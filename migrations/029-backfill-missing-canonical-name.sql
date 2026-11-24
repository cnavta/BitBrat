-- Migration 029: Backfill Missing canonicalName
-- Sprint 66: Fix tools with empty/null canonicalName
--
-- Purpose: Extract canonicalName from tool ID for tools with missing canonicalName
-- Safety: Creates backup table, allows rollback
--
-- Problem: 110 tools have empty string canonicalName (data->>'canonicalName' = '')
-- Root Cause: Tool registration didn't validate canonicalName before storage
--
-- Examples:
-- ❌ mcp:reflex.update → canonicalName: ""
-- ❌ mcp:composition.list_tools → canonicalName: ""
-- ❌ mcp:state-engine/bit.shutdown → canonicalName: ""
--
-- Expected Results:
-- ✅ mcp:reflex.update → canonicalName: "update"
-- ✅ mcp:composition.list_tools → canonicalName: "list_tools"
-- ✅ mcp:state-engine/bit.shutdown → canonicalName: "bit.shutdown"
--
-- Schema: DocumentStore uses JSONB `data` column
-- Access fields via: data->>'fieldName'
-- Update with: jsonb_set(data, '{fieldName}', '"new_value"')

BEGIN;

-- ============================================================================
-- Step 1: Create backup table (for rollback)
-- ============================================================================
DROP TABLE IF EXISTS platform_tool_registry_backup_029;

CREATE TABLE platform_tool_registry_backup_029 AS
SELECT * FROM platform_tool_registry
WHERE data->>'source' = 'mcp'
  AND (data->>'canonicalName' IS NULL OR data->>'canonicalName' = '');

-- Log backup creation
DO $$
DECLARE
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM platform_tool_registry_backup_029;
  RAISE NOTICE 'Backup created: % tools saved to platform_tool_registry_backup_029', backup_count;
END $$;

-- ============================================================================
-- Step 2: Backfill canonicalName by extracting from ID
-- ============================================================================
-- Strategy (same as migration 028):
-- 1. Tool ID format: "mcp:namespace/tool.name" or "mcp:namespace.tool.name"
-- 2. Extract tool name after last '/' or after namespace prefix
-- 3. Preserve dots in tool names (e.g., "bit.info" not "bit_info")

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
          -- Example: "mcp:reflex.update" → "update"
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
  AND (data->>'canonicalName' IS NULL OR data->>'canonicalName' = '');

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
  FROM platform_tool_registry_backup_029 b
  INNER JOIN platform_tool_registry r ON b.id = r.id
  WHERE (b.data->>'canonicalName' IS NULL OR b.data->>'canonicalName' = '')
    AND (r.data->>'canonicalName' IS NOT NULL AND r.data->>'canonicalName' != '');

  -- Count tools still missing canonicalName (should be 0)
  SELECT COUNT(*) INTO remaining_missing
  FROM platform_tool_registry
  WHERE data->>'source' = 'mcp'
    AND (data->>'canonicalName' IS NULL OR data->>'canonicalName' = '');

  RAISE NOTICE 'Fixed % tools', fixed_count;
  RAISE NOTICE 'Remaining missing canonicalName: %', remaining_missing;

  -- Abort if fix didn't work
  IF remaining_missing > 0 THEN
    RAISE EXCEPTION 'Migration failed: % tools still have missing canonicalName', remaining_missing;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Show before/after examples
-- ============================================================================
SELECT
  b.id AS tool_id,
  CASE
    WHEN b.data->>'canonicalName' = '' THEN '(empty string)'
    WHEN b.data->>'canonicalName' IS NULL THEN '(null)'
    ELSE b.data->>'canonicalName'
  END AS before_canonical_name,
  r.data->>'canonicalName' AS after_canonical_name,
  'FIXED' AS status
FROM platform_tool_registry_backup_029 b
INNER JOIN platform_tool_registry r ON b.id = r.id
WHERE (b.data->>'canonicalName' IS NULL OR b.data->>'canonicalName' = '')
  AND (r.data->>'canonicalName' IS NOT NULL AND r.data->>'canonicalName' != '')
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
-- FROM platform_tool_registry_backup_029 b
-- WHERE r.id = b.id;
-- COMMIT;
--
-- Then drop backup table:
-- DROP TABLE platform_tool_registry_backup_029;

-- ============================================================================
-- Post-Migration Validation:
-- ============================================================================
-- Run this query after migration to verify no tools have missing canonicalName:
--
-- SELECT
--   COUNT(*) AS total_mcp_tools,
--   COUNT(CASE WHEN data->>'canonicalName' IS NULL OR data->>'canonicalName' = '' THEN 1 END) AS missing_canonical_name,
--   COUNT(CASE WHEN data->>'canonicalName' IS NOT NULL AND data->>'canonicalName' != '' THEN 1 END) AS valid_canonical_name
-- FROM platform_tool_registry
-- WHERE data->>'source' = 'mcp';
--
-- Expected result:
-- total_mcp_tools | missing_canonical_name | valid_canonical_name
-- ----------------|------------------------|---------------------
--            504  |                      0 |                 504
