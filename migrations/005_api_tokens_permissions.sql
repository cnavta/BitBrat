-- Migration: 005_api_tokens_permissions.sql
-- Sprint: sprint-39-62r0fc
-- Description: Add permissions column to api_tokens table for permission-gated features
-- Date: 2026-09-02
-- Security: CRITICAL - Enables permission-based access control for event.inject.v2

-- ============================================================================
-- TABLE: api_tokens (MODIFY)
-- Purpose: Add permissions array for fine-grained access control
-- Schema: Add dedicated JSONB column alongside DocumentStore data column
-- ============================================================================

-- Ensure api_tokens table exists (created by DocumentStore)
-- If it doesn't exist, create it with DocumentStore schema
CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add permissions column (JSONB array of permission strings)
-- Default: Empty array (no permissions)
-- Example: ['event:inject', 'admin:read']
ALTER TABLE api_tokens
ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add GIN index for efficient permission checks
-- Enables fast queries like: permissions @> '["event:inject"]'
CREATE INDEX IF NOT EXISTS idx_api_tokens_permissions
  ON api_tokens USING GIN (permissions);

-- Add partial index for dev tokens (for auto-grant logic)
-- Speeds up queries that check for brat-dev-mcp:* and dev-tools:* patterns
CREATE INDEX IF NOT EXISTS idx_api_tokens_dev_tokens
  ON api_tokens((data->>'uid'))
  WHERE (data->>'uid') LIKE 'brat-dev-mcp:%' OR (data->>'uid') LIKE 'dev-tools:%';

-- Add comment
COMMENT ON COLUMN api_tokens.permissions IS
  'JSONB array of permission strings (e.g., ["event:inject", "admin:read"]). Used for permission-gated features like event.inject.v2.';

-- ============================================================================
-- DATA MIGRATION: Auto-grant event:inject to existing dev tokens
-- ============================================================================

-- Grant event:inject permission to all existing brat-dev-mcp:* tokens
UPDATE api_tokens
SET permissions = permissions || '["event:inject"]'::jsonb
WHERE (data->>'uid') LIKE 'brat-dev-mcp:%'
  AND NOT permissions @> '["event:inject"]';

-- Grant event:inject permission to all existing dev-tools:* tokens
UPDATE api_tokens
SET permissions = permissions || '["event:inject"]'::jsonb
WHERE (data->>'uid') LIKE 'dev-tools:%'
  AND NOT permissions @> '["event:inject"]';

-- ============================================================================
-- VERIFICATION QUERIES (for manual testing)
-- ============================================================================

-- Count tokens by permission
-- SELECT
--   COUNT(*) FILTER (WHERE permissions @> '["event:inject"]') AS with_event_inject,
--   COUNT(*) FILTER (WHERE permissions = '[]'::jsonb) AS no_permissions,
--   COUNT(*) AS total_tokens
-- FROM api_tokens;

-- List dev tokens with permissions
-- SELECT
--   data->>'uid' AS uid,
--   permissions,
--   created_at
-- FROM api_tokens
-- WHERE (data->>'uid') LIKE 'brat-dev-mcp:%' OR (data->>'uid') LIKE 'dev-tools:%'
-- ORDER BY created_at DESC
-- LIMIT 10;
