-- Migration: Add disposition_observations table for user disposition tracking
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores user disposition observations from query analysis and interactions.
-- Used by disposition-service to track user sentiment, engagement, and behavior patterns.

CREATE TABLE IF NOT EXISTS disposition_observations (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for userKey lookups (find all observations for a user)
CREATE INDEX idx_disposition_observations_user_key ON disposition_observations((data->>'userKey'));

-- Index for observedAt time-based queries
CREATE INDEX idx_disposition_observations_observed_at ON disposition_observations((data->>'observedAt'));

-- Composite index for active observation queries (userKey + observedAt >= cutoff)
CREATE INDEX idx_disposition_observations_user_time ON disposition_observations(
  (data->>'userKey'),
  (data->>'observedAt')
);

-- Index for correlationId tracing
CREATE INDEX idx_disposition_observations_correlation_id ON disposition_observations((data->>'correlationId'));

SELECT 'disposition_observations table created successfully' AS status;
