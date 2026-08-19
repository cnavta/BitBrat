-- Migration 019: Add window_snapshots table for crash recovery
-- Sprint: sprint-20-xc3pcu (Event Stream Analyzer - Phase 3)
-- Purpose: Enable periodic window state snapshots for crash recovery with max 5-min data loss
-- Created: 2026-08-19

-- Window state snapshots for crash recovery
-- Stores periodic snapshots of event window states to enable restoration after service restart
CREATE TABLE IF NOT EXISTS window_snapshots (
  -- Primary key: observer_id (one snapshot per observer)
  observer_id VARCHAR(255) PRIMARY KEY,

  -- Window state data (JSONB for flexible schema)
  -- Structure: { eventIds: string[], eventCount: number, windowStartedAt: ISO8601, lastEventAt: ISO8601 }
  data JSONB NOT NULL,

  -- Snapshot metadata
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Foreign key to stream_observers with cascade delete
  -- When observer is deleted, its snapshot is automatically removed
  CONSTRAINT fk_window_snapshots_observer
    FOREIGN KEY (observer_id)
    REFERENCES stream_observers(id)
    ON DELETE CASCADE
);

-- Index for chronological queries (find latest snapshots)
CREATE INDEX IF NOT EXISTS idx_window_snapshots_snapshot_at
  ON window_snapshots(snapshot_at);

-- GIN index for fast JSONB queries (if filtering by window state properties)
-- Enables queries like: WHERE data @> '{"eventCount": 100}'
CREATE INDEX IF NOT EXISTS idx_window_snapshots_data
  ON window_snapshots USING GIN (data);

-- Comments for documentation
COMMENT ON TABLE window_snapshots IS 'Periodic snapshots of event window states for crash recovery (Phase 3)';
COMMENT ON COLUMN window_snapshots.observer_id IS 'References stream_observers(id) - one snapshot per observer';
COMMENT ON COLUMN window_snapshots.data IS 'Window state: { eventIds: string[], eventCount: number, windowStartedAt: ISO8601, lastEventAt: ISO8601 }';
COMMENT ON COLUMN window_snapshots.snapshot_at IS 'Timestamp when snapshot was created (default: NOW())';

-- Example data structure for reference:
-- {
--   "eventIds": ["evt-123", "evt-124", "evt-125"],
--   "eventCount": 3,
--   "windowStartedAt": "2026-08-19T12:00:00.000Z",
--   "lastEventAt": "2026-08-19T12:04:30.000Z"
-- }
