-- Migration: Add persistence layer tables
-- Date: 2026-07-16
-- Reason: Support event persistence and source tracking for PostgreSQL backend

-- Create sources table (for tracking external sources like Twitch/Discord)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sources') THEN
    CREATE TABLE sources (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for common queries
    CREATE INDEX idx_sources_platform ON sources((data->>'platform'));
    CREATE INDEX idx_sources_status ON sources((data->>'status'));

    RAISE NOTICE 'Created sources table';
  ELSE
    RAISE NOTICE 'Table sources already exists, skipping';
  END IF;
END
$$;

-- Create snapshots table (flattened subcollection for event snapshots)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'snapshots') THEN
    CREATE TABLE snapshots (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      correlation_id VARCHAR(255),  -- Foreign key to events table
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for queries
    CREATE INDEX idx_snapshots_correlation_id ON snapshots(correlation_id);
    CREATE INDEX idx_snapshots_idempotency_key ON snapshots((data->>'idempotencyKey'));
    CREATE INDEX idx_snapshots_kind ON snapshots((data->>'kind'));
    CREATE INDEX idx_snapshots_sequence ON snapshots(((data->>'sequence')::int));

    RAISE NOTICE 'Created snapshots table';
  ELSE
    RAISE NOTICE 'Table snapshots already exists, skipping';
  END IF;
END
$$;

-- Create state table (for state-engine mutations)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'state') THEN
    CREATE TABLE state (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for state queries
    CREATE INDEX idx_state_version ON state(((data->>'version')::int));
    CREATE INDEX idx_state_updated_by ON state((data->>'updatedBy'));

    RAISE NOTICE 'Created state table';
  ELSE
    RAISE NOTICE 'Table state already exists, skipping';
  END IF;
END
$$;

-- Create mutation_log table (for state mutation audit trail)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mutation_log') THEN
    CREATE TABLE mutation_log (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for mutation queries
    CREATE INDEX idx_mutation_log_key ON mutation_log((data->>'key'));
    CREATE INDEX idx_mutation_log_status ON mutation_log((data->>'status'));
    CREATE INDEX idx_mutation_log_actor ON mutation_log((data->>'actor'));
    CREATE INDEX idx_mutation_log_committed_at ON mutation_log((data->>'committedAt'));

    RAISE NOTICE 'Created mutation_log table';
  ELSE
    RAISE NOTICE 'Table mutation_log already exists, skipping';
  END IF;
END
$$;

SELECT 'Persistence layer tables migration complete' AS status;
