-- Migration: 021 - Add counter tables (CORRECTED)
-- Sprint: sprint-27-6tp11t
-- Description: Create counter_definitions and counter_snapshots tables for counter system
-- Date: 2026-08-29
-- Schema: JSONB-based DocumentStore pattern

-- ============================================================================
-- TABLE: counter_definitions
-- Purpose: Store counter metadata (persistent, queryable)
-- Schema: DocumentStore JSONB pattern (data column, not individual columns)
-- ============================================================================

CREATE TABLE IF NOT EXISTS counter_definitions (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance (using JSONB extraction)
CREATE INDEX IF NOT EXISTS idx_counter_definitions_name
  ON counter_definitions((data->>'name'));

CREATE INDEX IF NOT EXISTS idx_counter_definitions_scope_type
  ON counter_definitions((data->>'scopeType'));

CREATE INDEX IF NOT EXISTS idx_counter_definitions_scope_value
  ON counter_definitions((data->>'scopeType'), (data->>'scopeValue'));

CREATE INDEX IF NOT EXISTS idx_counter_definitions_created_at
  ON counter_definitions((data->>'createdAt'));

CREATE INDEX IF NOT EXISTS idx_counter_definitions_expires_at
  ON counter_definitions((data->>'expiresAt'))
  WHERE (data->>'expiresAt') IS NOT NULL;

-- GIN index for full metadata JSONB queries
CREATE INDEX IF NOT EXISTS idx_counter_definitions_metadata
  ON counter_definitions USING GIN ((data->'metadata'));

-- Comment
COMMENT ON TABLE counter_definitions IS
  'Counter definitions - JSONB-based DocumentStore for counter metadata and configuration';

-- ============================================================================
-- TABLE: counter_snapshots
-- Purpose: Store counter value snapshots for historical tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS counter_snapshots (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_counter_snapshots_counter_id
  ON counter_snapshots((data->>'counterId'));

CREATE INDEX IF NOT EXISTS idx_counter_snapshots_snapshot_at
  ON counter_snapshots((data->>'snapshotAt'));

CREATE INDEX IF NOT EXISTS idx_counter_snapshots_trigger
  ON counter_snapshots((data->>'trigger'));

-- Composite index for counter history queries
CREATE INDEX IF NOT EXISTS idx_counter_snapshots_counter_time
  ON counter_snapshots((data->>'counterId'), (data->>'snapshotAt'));

-- Comment
COMMENT ON TABLE counter_snapshots IS
  'Counter snapshots - JSONB-based DocumentStore for historical value tracking and analytics';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'counter_definitions') THEN
    RAISE EXCEPTION 'Table counter_definitions was not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'counter_snapshots') THEN
    RAISE EXCEPTION 'Table counter_snapshots was not created';
  END IF;

  RAISE NOTICE 'Migration 021 (counter tables) completed successfully - JSONB schema';
END $$;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- DROP TABLE IF EXISTS counter_snapshots CASCADE;
-- DROP TABLE IF EXISTS counter_definitions CASCADE;
