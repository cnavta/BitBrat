-- Migration: Add prompt_logs table for LLM prompt logging
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores LLM prompt logs (flattened from Firestore subcollections).
-- Previously stored in Firestore at: services/{serviceName}/prompt_logs/{logId}
-- Now flattened to a single prompt_logs table.

CREATE TABLE IF NOT EXISTS prompt_logs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for correlationId lookups (tracing prompts to events)
CREATE INDEX idx_prompt_logs_correlation_id ON prompt_logs((data->>'correlationId'));

-- Index for platform/model filtering (e.g., find all OpenAI gpt-4 logs)
CREATE INDEX idx_prompt_logs_platform ON prompt_logs((data->>'platform'));
CREATE INDEX idx_prompt_logs_model ON prompt_logs((data->>'model'));

-- Index for timestamp queries (find recent logs)
CREATE INDEX idx_prompt_logs_created_at ON prompt_logs(created_at);

-- Composite index for platform + model queries
CREATE INDEX idx_prompt_logs_platform_model ON prompt_logs(
  (data->>'platform'),
  (data->>'model')
);

SELECT 'prompt_logs table created successfully' AS status;
