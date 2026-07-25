-- Migration: Add generic configs table for backwards compatibility
-- Date: 2026-07-25
-- Reason: Legacy code paths attempt to write to 'configs' collection
--         This table provides backwards compatibility until all code is migrated

CREATE TABLE IF NOT EXISTS configs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_configs_updated_at ON configs(updated_at);

SELECT 'Configs table created for backwards compatibility' AS status;
