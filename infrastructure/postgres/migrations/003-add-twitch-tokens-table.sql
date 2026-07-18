-- Migration: Add twitch_tokens table
-- Date: 2026-07-17
-- Reason: Support OAuth token storage for Twitch connectors in PostgreSQL backend

-- Create twitch_tokens table (for storing OAuth tokens from Twitch/Discord/other platforms)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'twitch_tokens') THEN
    CREATE TABLE twitch_tokens (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for token queries
    CREATE INDEX idx_twitch_tokens_user_id ON twitch_tokens((data->>'userId'));
    CREATE INDEX idx_twitch_tokens_updated_at ON twitch_tokens(updated_at);

    RAISE NOTICE 'Created twitch_tokens table';
  ELSE
    RAISE NOTICE 'Table twitch_tokens already exists, skipping';
  END IF;
END
$$;

SELECT 'Twitch tokens table migration complete' AS status;
