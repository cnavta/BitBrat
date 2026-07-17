-- Migration: Add tool_usage table for MCP tool usage tracking
-- Sprint: 343 - PostgreSQL Migration
-- Date: 2026-07-17
--
-- This table stores MCP tool usage analytics for monitoring and debugging.
-- Previously stored in Firestore at: tool_usage/{id}

CREATE TABLE IF NOT EXISTS tool_usage (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for tool name lookups (finding all usage of a specific tool)
CREATE INDEX idx_tool_usage_tool_name ON tool_usage((data->>'tool_name'));

-- Index for timestamp-based queries (analytics, cleanup)
CREATE INDEX idx_tool_usage_timestamp ON tool_usage((data->>'timestamp'));

-- Index for user lookups (finding all tool usage by a user)
CREATE INDEX idx_tool_usage_user_id ON tool_usage((data->>'user_id'));

-- Index for service lookups (finding all tool usage by a service)
CREATE INDEX idx_tool_usage_service ON tool_usage((data->>'service'));

-- Index for correlation ID (tracing tool usage across requests)
CREATE INDEX idx_tool_usage_correlation_id ON tool_usage((data->>'correlation_id'));

SELECT 'tool_usage table created successfully' AS status;
