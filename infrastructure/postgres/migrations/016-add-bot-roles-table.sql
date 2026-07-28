-- Migration: Add bot_roles table
-- Description: User context roles for LLM bot (Sprint 344)
-- Created: 2026-07-27

CREATE TABLE IF NOT EXISTS bot_roles (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for enabled roles query (used by user-context.ts)
CREATE INDEX IF NOT EXISTS idx_bot_roles_enabled
    ON bot_roles ((data->'enabled'));

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_bot_roles_data
    ON bot_roles USING GIN (data);

-- Comments
COMMENT ON TABLE bot_roles IS 'Bot roles for user context (LLM bot personality system)';
COMMENT ON COLUMN bot_roles.id IS 'Role ID';
COMMENT ON COLUMN bot_roles.data IS 'JSONB role document (enabled, name, permissions, etc.)';
