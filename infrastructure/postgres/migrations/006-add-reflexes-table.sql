-- Migration: Add reflexes table for reflex service
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores reflex definitions (event-driven automation rules).
-- Previously stored in Firestore at: reflexes/{id}

CREATE TABLE IF NOT EXISTS reflexes (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for active status lookups (filtering inactive reflexes)
CREATE INDEX idx_reflexes_active ON reflexes((data->>'active'));

-- Index for priority ordering (selecting reflexes by priority)
CREATE INDEX idx_reflexes_priority ON reflexes((data->>'priority'));

-- Composite index for active + priority queries (cache initialization)
CREATE INDEX idx_reflexes_active_priority ON reflexes((data->>'active'), (data->>'priority'));

SELECT 'reflexes table created successfully' AS status;
