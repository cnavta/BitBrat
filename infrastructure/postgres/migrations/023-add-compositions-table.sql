-- Migration 023: Add compositions table for composition registry
-- Sprint 41 (COMP-017A): Store composition definitions and versions
--
-- Creates dedicated table for composition storage:
-- - Composition metadata (name, description, version)
-- - Full composition definition (JSONB)
-- - Content-based deduplication via contentHash
-- - Automatic version management
--
-- Schema:
-- - id: Unique identifier (UUID)
-- - name: Composition name (used as MCP tool ID)
-- - version: Version number (auto-incremented per name)
-- - content_hash: SHA-256 hash for deduplication
-- - definition: Full composition definition (JSONB)
-- - created_at: Creation timestamp
-- - updated_at: Last modification timestamp
--
-- Indexes:
-- - Primary key: id
-- - Unique constraint: (name, version)
-- - Unique constraint: (name, content_hash)
-- - Index on name for fast lookups
-- - GIN index on definition for JSONB queries

-- Create compositions table
CREATE TABLE IF NOT EXISTS compositions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Ensure unique (name, version) pairs
  CONSTRAINT compositions_name_version_unique UNIQUE (name, version),

  -- Ensure unique (name, content_hash) pairs for deduplication
  CONSTRAINT compositions_name_hash_unique UNIQUE (name, content_hash)
);

-- Create index on name for fast lookups by name
CREATE INDEX IF NOT EXISTS idx_compositions_name
ON compositions (name);

-- Create index on content_hash for deduplication queries
CREATE INDEX IF NOT EXISTS idx_compositions_content_hash
ON compositions (content_hash);

-- Create GIN index on JSONB definition for fast queries
-- Supports @>, ->, ->>, and other JSONB operators
CREATE INDEX IF NOT EXISTS idx_compositions_definition_gin
ON compositions USING GIN (definition);

-- Add comments for documentation
COMMENT ON TABLE compositions IS 'Composition definitions and versions (Sprint 41 - COMP-017A)';
COMMENT ON COLUMN compositions.id IS 'Unique composition identifier (UUID)';
COMMENT ON COLUMN compositions.name IS 'Composition name (used as MCP tool ID)';
COMMENT ON COLUMN compositions.version IS 'Version number (auto-incremented per name)';
COMMENT ON COLUMN compositions.content_hash IS 'SHA-256 content hash for deduplication';
COMMENT ON COLUMN compositions.definition IS 'Full composition definition (JSONB)';
COMMENT ON COLUMN compositions.created_at IS 'Composition creation timestamp';
COMMENT ON COLUMN compositions.updated_at IS 'Last modification timestamp';
