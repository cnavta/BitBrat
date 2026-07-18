-- Migration: Add api_tokens table for API gateway token persistence
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores API tokens created via the auth-service create_api_token MCP tool.
-- Previously stored in Firestore at: gateways/api/tokens/{token_hash}

CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(255) PRIMARY KEY,  -- token_hash (SHA-256 hex)
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for user lookups (finding all tokens for a user)
CREATE INDEX idx_api_tokens_user_id ON api_tokens((data->>'user_id'));

-- Index for timestamp-based queries (token expiration, cleanup)
CREATE INDEX idx_api_tokens_created_at ON api_tokens(created_at);

-- Index for token_hash lookups (validation, revocation)
-- Note: Primary key already provides index, but explicit for clarity
CREATE INDEX idx_api_tokens_hash ON api_tokens((data->>'token_hash'));

SELECT 'api_tokens table created successfully' AS status;
