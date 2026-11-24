-- Migration 027: Backfill missing RBAC configuration
-- Purpose: Fix data integrity issue where 110 tools (21.8%) have NULL rbac
-- Sprint: 66 (Schema Injection via LlmProfile Integration)
-- Root Cause: Import code UPDATE path skipped RBAC field, leaving existing tools with NULL rbac
-- Impact: Tools with NULL rbac crashed RBAC validator until defensive fix deployed

-- Backfill tools with missing RBAC configuration
-- Sets default RBAC with no restrictions (fail-open behavior)
-- Note: DocumentStore uses generic 'data' JSONB column, not individual columns
UPDATE platform_tool_registry
SET data = jsonb_set(
  data,
  '{rbac}',
  '{"userRoles": {"required": [], "denied": []}, "modelRoles": {"required": [], "denied": []}, "modelTiers": {"allowed": [], "denied": []}}'::jsonb
)
WHERE data->'rbac' IS NULL;

-- Verify: Check how many tools were updated
-- Expected: ~110 tools updated (21.8% of 505 total)
-- SELECT COUNT(*) FROM platform_tool_registry WHERE data->'rbac' IS NULL;  -- Should be 0 after migration
