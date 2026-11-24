-- Migration 028: Backfill missing source field
-- Purpose: Fix data integrity issue where 110 tools (21.8%) have NULL or empty source
-- Sprint: 66 (Schema Injection via LlmProfile Integration)
-- Root Cause: Import code UPDATE path skipped source field, leaving existing tools without source
-- Impact: Tools with NULL/empty source fail with "Unknown tool source: undefined"
-- Related: Migration 027 (same 110 tools had NULL rbac)

-- Backfill tools with missing source field
-- Sets source='mcp' for all MCP tools (IDs starting with 'mcp:')
-- Note: DocumentStore uses generic 'data' JSONB column, not individual columns
UPDATE platform_tool_registry
SET data = jsonb_set(
  data,
  '{source}',
  '"mcp"'
)
WHERE (data->>'source' IS NULL OR data->>'source' = '')
  AND id LIKE 'mcp:%';

-- Verify: Check how many tools were updated
-- Expected: ~110 tools updated (21.8% of 505 total)
-- SELECT COUNT(*) FROM platform_tool_registry WHERE data->>'source' IS NULL OR data->>'source' = '';  -- Should be 0 after migration

-- Verify: Check source distribution
-- Expected: ~504 'mcp', 1 'composition'
-- SELECT data->>'source' as source, COUNT(*) FROM platform_tool_registry GROUP BY source ORDER BY count DESC;
