-- Migration: Add sources table for platform connection status tracking
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores real-time status of external platform connections (Twitch, Discord, etc.)
-- Used by persistence service to track system.source.status and system.stream.* events

CREATE TABLE IF NOT EXISTS sources (
  -- Primary key: composite of platform:id (e.g., "twitch:123456")
  id TEXT PRIMARY KEY,

  -- JSON document containing the source state
  -- Structure follows SourceDocV1 interface from src/services/persistence/model.ts
  data JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by platform
CREATE INDEX IF NOT EXISTS idx_sources_platform ON sources ((data->>'platform'));

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources ((data->>'status'));

-- Index for querying by stream status
CREATE INDEX IF NOT EXISTS idx_sources_stream_status ON sources ((data->>'streamStatus'));

-- Index for updated_at to track recent changes
CREATE INDEX IF NOT EXISTS idx_sources_updated_at ON sources (updated_at DESC);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sources_updated_at_trigger
  BEFORE UPDATE ON sources
  FOR EACH ROW
  EXECUTE FUNCTION update_sources_updated_at();

-- Verification
SELECT
  'sources table created' AS status,
  COUNT(*) AS initial_row_count
FROM sources;
