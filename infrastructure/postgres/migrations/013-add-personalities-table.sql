-- Migration: Add personalities table for LLM personality/identity prompts
-- Sprint: 344 - PostgreSQL Migration Cleanup
-- Date: 2026-07-18
--
-- This table stores personality documents used by llm-bot for prompt identity composition.
-- Previously stored in Firestore at: personalities/{personalityId}
--
-- Schema fields (stored in JSONB data column):
-- - name: Unique personality name (e.g., "bitbrat_the_ai")
-- - text: Full personality/identity prompt text
-- - status: active | inactive | archived
-- - version: Integer version number (incremented on updates)
-- - tags: Array of tags for categorization
-- - platform: Optional platform override (openai, ollama, vllm)
-- - model: Optional model override (gpt-4o, llama3, etc.)
-- - createdAt: ISO timestamp
-- - updatedAt: ISO timestamp

CREATE TABLE IF NOT EXISTS personalities (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for name lookups (primary query pattern)
CREATE INDEX idx_personalities_name ON personalities((data->>'name'));

-- Index for status filtering (active/inactive/archived)
CREATE INDEX idx_personalities_status ON personalities((data->>'status'));

-- Index for version sorting
CREATE INDEX idx_personalities_version ON personalities(((data->>'version')::int));

-- Composite index for personality resolution (name + status + version DESC)
-- Supports query: WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1
CREATE INDEX idx_personalities_name_status_version ON personalities(
  (data->>'name'),
  (data->>'status'),
  ((data->>'version')::int) DESC
);

-- Index for platform-specific personalities
CREATE INDEX idx_personalities_platform ON personalities((data->>'platform'));

-- Index for model-specific personalities
CREATE INDEX idx_personalities_model ON personalities((data->>'model'));

-- GIN index for tag-based searches
CREATE INDEX idx_personalities_tags ON personalities USING GIN ((data->'tags'));

SELECT 'personalities table created successfully' AS status;
