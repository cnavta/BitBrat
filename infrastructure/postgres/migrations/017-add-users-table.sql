-- Migration: Add users table
-- Description: User data for LLM bot context (Sprint 344)
-- Created: 2026-07-27

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_users_data
    ON users USING GIN (data);

-- Index for common user lookups
CREATE INDEX IF NOT EXISTS idx_users_platform_id
    ON users ((data->'platform'), (data->'platformId'));

-- Comments
COMMENT ON TABLE users IS 'User data for LLM bot context and personalization';
COMMENT ON COLUMN users.id IS 'User ID (typically platform:platformId)';
COMMENT ON COLUMN users.data IS 'JSONB user document (platform, platformId, preferences, metadata)';
