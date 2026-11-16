-- Migration 025: Create model_registry table
-- Purpose: Store LLM and agent model metadata with security profiles
-- Sprint: 57+ (Foundation - tool-orchestrator with Persistent Registries)
--
-- DocumentStore Pattern: Uses JSONB 'data' column for flexible schema
-- Compatible with IDocumentStore interface (PostgresDocumentStore)

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying via JSONB paths
CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry USING GIN ((data->'provider'));
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry USING GIN ((data->'tier'));
CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry USING GIN ((data->'status'));
CREATE INDEX IF NOT EXISTS idx_model_registry_data ON model_registry USING GIN (data);

-- Rollback script
-- DROP INDEX IF EXISTS idx_model_registry_data;
-- DROP INDEX IF EXISTS idx_model_registry_status;
-- DROP INDEX IF EXISTS idx_model_registry_tier;
-- DROP INDEX IF EXISTS idx_model_registry_provider;
-- DROP TABLE IF EXISTS model_registry;
