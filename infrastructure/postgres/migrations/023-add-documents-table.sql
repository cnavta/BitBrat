-- Migration 023: Add documents table for composition registry
-- Sprint 41 (COMP-017A): Document store for composition definitions
--
-- Creates a generic JSONB document store used by:
-- - CompositionRegistry (stores composition definitions)
-- - Future document-based features
--
-- Schema:
-- - id: Document identifier (unique within collection)
-- - collection: Logical grouping (e.g., "compositions")
-- - data: JSONB document data
-- - created_at: Creation timestamp
-- - updated_at: Last modification timestamp
--
-- Indexes:
-- - Primary key: (collection, id) for fast lookups
-- - idx_documents_collection: Fast collection scans
-- - idx_documents_data_gin: Fast JSONB queries using GIN index

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT NOT NULL,
  collection TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);

-- Create index on collection for fast collection scans
CREATE INDEX IF NOT EXISTS idx_documents_collection
ON documents (collection);

-- Create GIN index on JSONB data for fast queries
-- Supports @>, ->, ->>, and other JSONB operators
CREATE INDEX IF NOT EXISTS idx_documents_data_gin
ON documents USING GIN (data);

-- Add comment for documentation
COMMENT ON TABLE documents IS 'Generic JSONB document store for composition registry and other document-based features (Sprint 41)';
COMMENT ON COLUMN documents.id IS 'Document identifier (unique within collection)';
COMMENT ON COLUMN documents.collection IS 'Logical collection name (e.g., "compositions")';
COMMENT ON COLUMN documents.data IS 'JSONB document data';
COMMENT ON COLUMN documents.created_at IS 'Document creation timestamp';
COMMENT ON COLUMN documents.updated_at IS 'Last modification timestamp';
