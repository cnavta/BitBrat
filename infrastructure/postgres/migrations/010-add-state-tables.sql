-- Migration: Add state and mutation_log tables for state-engine
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- These tables support the state-engine service for managing application state
-- and tracking state mutations.

-- 1. State table (stores current state snapshots)
CREATE TABLE IF NOT EXISTS state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for state type/key lookups
CREATE INDEX idx_state_key ON state((data->>'key'));

-- Index for state type
CREATE INDEX idx_state_type ON state((data->>'type'));

-- 2. Mutation log table (audit trail of state mutations)
CREATE TABLE IF NOT EXISTS mutation_log (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for mutation tracking by mutation ID
CREATE INDEX idx_mutation_log_mutation_id ON mutation_log((data->>'mutationId'));

-- Index for correlation ID tracing
CREATE INDEX idx_mutation_log_correlation_id ON mutation_log((data->>'correlationId'));

-- Index for state key being mutated
CREATE INDEX idx_mutation_log_state_key ON mutation_log((data->>'stateKey'));

-- Index for timestamp-based queries
CREATE INDEX idx_mutation_log_timestamp ON mutation_log((data->>'timestamp'));

-- Composite index for state key + timestamp queries
CREATE INDEX idx_mutation_log_key_time ON mutation_log(
  (data->>'stateKey'),
  (data->>'timestamp')
);

SELECT 'state and mutation_log tables created successfully' AS status;
