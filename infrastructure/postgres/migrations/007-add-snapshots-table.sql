-- Migration: Add snapshots table for event persistence
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores event snapshots (flattened from Firestore subcollections).
-- Previously stored in Firestore at: events/{correlationId}/snapshots/{snapshotId}
-- Now flattened with correlationId as a foreign key field.

CREATE TABLE IF NOT EXISTS snapshots (
  id VARCHAR(255) PRIMARY KEY,  -- snapshotId (e.g., "{correlationId}-000001-initial")
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for correlationId lookups (joining with events table)
CREATE INDEX idx_snapshots_correlation_id ON snapshots((data->>'correlationId'));

-- Index for kind lookups (filtering by snapshot type: initial, update, final, deadletter)
CREATE INDEX idx_snapshots_kind ON snapshots((data->>'kind'));

-- Index for sequence ordering (chronological snapshot ordering per event)
CREATE INDEX idx_snapshots_sequence ON snapshots((data->>'sequence'));

-- Index for idempotencyKey deduplication (persistence repository uses this)
CREATE INDEX idx_snapshots_idempotency_key ON snapshots((data->>'idempotencyKey'));

-- Composite index for common query pattern (correlationId + idempotencyKey)
-- Used in repository.ts:246-251 for idempotency checks
CREATE INDEX idx_snapshots_correlation_idempotency ON snapshots(
  (data->>'correlationId'),
  (data->>'idempotencyKey')
);

SELECT 'snapshots table created successfully' AS status;
