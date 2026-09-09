-- Migration: 022 - Add bidding tables (CORRECTED)
-- Sprint: sprint-29-49pmm9
-- Description: Create bid_sessions and bid_results tables for bidding system
-- Date: 2026-08-29
-- Schema: JSONB-based DocumentStore pattern

-- ============================================================================
-- TABLE: bid_sessions
-- Purpose: Store bidding session metadata (persistent, queryable)
-- Schema: DocumentStore JSONB pattern (data column, not individual columns)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bid_sessions (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance (using JSONB extraction)
CREATE INDEX IF NOT EXISTS idx_bid_sessions_name
  ON bid_sessions((data->>'name'));

CREATE INDEX IF NOT EXISTS idx_bid_sessions_scope_type
  ON bid_sessions((data->>'scopeType'));

CREATE INDEX IF NOT EXISTS idx_bid_sessions_scope_value
  ON bid_sessions((data->>'scopeType'), (data->>'scopeValue'));

CREATE INDEX IF NOT EXISTS idx_bid_sessions_status
  ON bid_sessions((data->>'status'));

CREATE INDEX IF NOT EXISTS idx_bid_sessions_created_at
  ON bid_sessions((data->>'createdAt'));

CREATE INDEX IF NOT EXISTS idx_bid_sessions_expires_at
  ON bid_sessions((data->>'expiresAt'))
  WHERE (data->>'expiresAt') IS NOT NULL;

-- GIN index for full metadata JSONB queries
CREATE INDEX IF NOT EXISTS idx_bid_sessions_metadata
  ON bid_sessions USING GIN ((data->'metadata'));

-- Comment
COMMENT ON TABLE bid_sessions IS
  'Bidding session metadata - JSONB-based DocumentStore for session configuration and state';

-- ============================================================================
-- TABLE: bid_results
-- Purpose: Store closed session results (analytics, history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bid_results (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_bid_results_session_id
  ON bid_results((data->>'sessionId'));

CREATE INDEX IF NOT EXISTS idx_bid_results_closed_at
  ON bid_results((data->>'closedAt'));

CREATE INDEX IF NOT EXISTS idx_bid_results_total_entries
  ON bid_results(((data->>'totalEntries')::int));

-- GIN indexes for JSONB object queries
CREATE INDEX IF NOT EXISTS idx_bid_results_winner
  ON bid_results USING GIN ((data->'winner'));

CREATE INDEX IF NOT EXISTS idx_bid_results_statistics
  ON bid_results USING GIN ((data->'statistics'));

CREATE INDEX IF NOT EXISTS idx_bid_results_metadata
  ON bid_results USING GIN ((data->'metadata'));

-- Comment
COMMENT ON TABLE bid_results IS
  'Bidding session results - JSONB-based DocumentStore for immutable snapshots of closed sessions';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bid_sessions') THEN
    RAISE EXCEPTION 'Table bid_sessions was not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bid_results') THEN
    RAISE EXCEPTION 'Table bid_results was not created';
  END IF;

  RAISE NOTICE 'Migration 022 (bidding tables) completed successfully - JSONB schema';
END $$;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- DROP TABLE IF EXISTS bid_results CASCADE;
-- DROP TABLE IF EXISTS bid_sessions CASCADE;
