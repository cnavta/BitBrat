-- Migration 019: Add window_snapshots table for crash recovery
-- Sprint: sprint-20-xc3pcu (Event Stream Analyzer - Phase 3)
-- Purpose: Enable periodic window state snapshots for crash recovery with max 5-min data loss
-- Created: 2026-08-19
-- Updated: 2026-08-20 (Fixed to match IDocumentStore pattern with id column)

-- Window state snapshots for crash recovery
-- Stores periodic snapshots of event window states to enable restoration after service restart
-- Uses IDocumentStore pattern: id (PK) + data (JSONB)
CREATE TABLE IF NOT EXISTS window_snapshots (
  -- Primary key: id follows IDocumentStore pattern (same as observer_id)
  id VARCHAR(255) PRIMARY KEY,

  -- Window state data (JSONB for flexible schema)
  -- Structure: { observerId, eventIds: string[], eventCount: number, windowStartedAt: ISO8601, lastEventAt: ISO8601, snapshotAt: ISO8601 }
  data JSONB NOT NULL,

  -- Snapshot metadata (denormalized for query performance)
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Foreign key to stream_observers with cascade delete
  -- When observer is deleted, its snapshot is automatically removed
  CONSTRAINT fk_window_snapshots_observer
    FOREIGN KEY (id)
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
COMMENT ON TABLE window_snapshots IS 'Periodic snapshots of event window states for crash recovery (Phase 3) - IDocumentStore pattern';
COMMENT ON COLUMN window_snapshots.id IS 'Primary key (observer_id) - references stream_observers(id)';
COMMENT ON COLUMN window_snapshots.data IS 'Window state JSONB: { observerId, eventIds, eventCount, windowStartedAt, lastEventAt, snapshotAt }';
COMMENT ON COLUMN window_snapshots.snapshot_at IS 'Timestamp when snapshot was created (denormalized from data.snapshotAt)';

-- Example data structure for reference:
-- {
--   "observerId": "chat-summarizer-5min",
--   "eventIds": ["evt-123", "evt-124", "evt-125"],
--   "eventCount": 3,
--   "windowStartedAt": "2026-08-19T12:00:00.000Z",
--   "lastEventAt": "2026-08-19T12:04:30.000Z",
--   "snapshotAt": "2026-08-19T12:05:00.000Z"
-- }
