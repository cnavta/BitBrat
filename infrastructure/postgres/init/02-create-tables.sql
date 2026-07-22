-- Create all collection tables
-- This script runs automatically on first container startup via docker-entrypoint-initdb.d
--
-- Each table follows the same pattern:
-- - id: Primary key (document ID from Firestore)
-- - data: JSONB column storing the full document
-- - created_at: Timestamp when document was created
-- - updated_at: Timestamp when document was last updated

-- 1. Events collection (highest priority - event persistence)
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_correlation_id ON events((data->>'correlationId'));
CREATE INDEX idx_events_type ON events((data->>'type'));
CREATE INDEX idx_events_source ON events((data->>'source'));

-- 2. Routing rules collection (event router rules)
CREATE TABLE IF NOT EXISTS routing_rules (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_routing_rules_pattern ON routing_rules((data->>'pattern'));
CREATE INDEX idx_routing_rules_active ON routing_rules((data->>'active'));

-- 3. Context packs collection (with vector support for similarity search)
CREATE TABLE IF NOT EXISTS context_packs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  embedding vector(1536),  -- OpenAI ada-002 embeddings
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_context_packs_embedding ON context_packs USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_context_packs_tags ON context_packs USING GIN ((data->'tags'));

-- 4. Service registry collection
CREATE TABLE IF NOT EXISTS service_registry (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_service_registry_status ON service_registry((data->>'status'));

-- 5. Auth users collection
CREATE TABLE IF NOT EXISTS auth_users (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_auth_users_platform_id ON auth_users((data->>'platformId'));
CREATE INDEX idx_auth_users_username ON auth_users((data->>'username'));

-- 6. Auth scopes collection
CREATE TABLE IF NOT EXISTS auth_scopes (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. User state collection
CREATE TABLE IF NOT EXISTS user_state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_state_user_id ON user_state((data->>'userId'));

-- 8. Global state collection
CREATE TABLE IF NOT EXISTS global_state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 9. Sessions collection
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions((data->>'userId'));
CREATE INDEX idx_sessions_expires_at ON sessions((data->>'expiresAt'));

-- 10. Conversation history collection
CREATE TABLE IF NOT EXISTS conversation_history (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_history_user_id ON conversation_history((data->>'userId'));
CREATE INDEX idx_conversation_history_timestamp ON conversation_history((data->>'timestamp'));

-- 11. LLM responses collection
CREATE TABLE IF NOT EXISTS llm_responses (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_llm_responses_correlation_id ON llm_responses((data->>'correlationId'));

-- 12. Integration configs collection
CREATE TABLE IF NOT EXISTS integration_configs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_integration_configs_platform ON integration_configs((data->>'platform'));

-- 13. Metrics collection
CREATE TABLE IF NOT EXISTS metrics (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_timestamp ON metrics((data->>'timestamp'));
CREATE INDEX idx_metrics_metric_name ON metrics((data->>'metricName'));

-- 14. OAuth tokens collection (Twitch, Discord, etc.)
CREATE TABLE IF NOT EXISTS twitch_tokens (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_twitch_tokens_user_id ON twitch_tokens((data->>'userId'));
CREATE INDEX idx_twitch_tokens_updated_at ON twitch_tokens(updated_at);

-- 15. API Gateway tokens collection
CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_user_id ON api_tokens((data->>'user_id'));
CREATE INDEX idx_api_tokens_created_at ON api_tokens(created_at);
CREATE INDEX idx_api_tokens_hash ON api_tokens((data->>'token_hash'));

-- 16. MCP tool usage tracking
CREATE TABLE IF NOT EXISTS tool_usage (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tool_usage_tool_name ON tool_usage((data->>'tool_name'));
CREATE INDEX idx_tool_usage_timestamp ON tool_usage((data->>'timestamp'));
CREATE INDEX idx_tool_usage_user_id ON tool_usage((data->>'user_id'));
CREATE INDEX idx_tool_usage_service ON tool_usage((data->>'service'));
CREATE INDEX idx_tool_usage_correlation_id ON tool_usage((data->>'correlation_id'));

-- 17. Reflexes collection (event-driven automation rules)
CREATE TABLE IF NOT EXISTS reflexes (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reflexes_active ON reflexes((data->>'active'));
CREATE INDEX idx_reflexes_priority ON reflexes((data->>'priority'));
CREATE INDEX idx_reflexes_active_priority ON reflexes((data->>'active'), (data->>'priority'));

-- 18. Snapshots collection (event snapshots - flattened from Firestore subcollections)
-- Firestore structure: events/{correlationId}/snapshots/{snapshotId}
-- PostgreSQL: Flattened with correlationId as FK field in data JSONB
CREATE TABLE IF NOT EXISTS snapshots (
  id VARCHAR(255) PRIMARY KEY,  -- snapshotId (e.g., "{correlationId}-000001-initial")
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_snapshots_correlation_id ON snapshots((data->>'correlationId'));
CREATE INDEX idx_snapshots_kind ON snapshots((data->>'kind'));
CREATE INDEX idx_snapshots_sequence ON snapshots((data->>'sequence'));
CREATE INDEX idx_snapshots_idempotency_key ON snapshots((data->>'idempotencyKey'));
CREATE INDEX idx_snapshots_correlation_idempotency ON snapshots(
  (data->>'correlationId'),
  (data->>'idempotencyKey')
);

-- 19. Prompt logs collection (LLM prompt logs - flattened from Firestore subcollections)
-- Firestore structure: services/{serviceName}/prompt_logs/{logId}
-- PostgreSQL: Flattened to single prompt_logs table with serviceName discriminator (Sprint 344)
CREATE TABLE IF NOT EXISTS prompt_logs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_prompt_logs_service_name ON prompt_logs((data->>'serviceName'));
CREATE INDEX idx_prompt_logs_correlation_id ON prompt_logs((data->>'correlationId'));
CREATE INDEX idx_prompt_logs_platform ON prompt_logs((data->>'platform'));
CREATE INDEX idx_prompt_logs_model ON prompt_logs((data->>'model'));
CREATE INDEX idx_prompt_logs_created_at ON prompt_logs(created_at);
CREATE INDEX idx_prompt_logs_platform_model ON prompt_logs((data->>'platform'), (data->>'model'));
CREATE INDEX idx_prompt_logs_service_platform ON prompt_logs((data->>'serviceName'), (data->>'platform'));

-- 20. User disposition observations (user sentiment/behavior tracking)
CREATE TABLE IF NOT EXISTS disposition_observations (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_disposition_observations_user_key ON disposition_observations((data->>'userKey'));
CREATE INDEX idx_disposition_observations_observed_at ON disposition_observations((data->>'observedAt'));
CREATE INDEX idx_disposition_observations_user_time ON disposition_observations((data->>'userKey'), (data->>'observedAt'));
CREATE INDEX idx_disposition_observations_correlation_id ON disposition_observations((data->>'correlationId'));

-- 21. State (application state snapshots managed by state-engine)
CREATE TABLE IF NOT EXISTS state (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_state_key ON state((data->>'key'));
CREATE INDEX idx_state_type ON state((data->>'type'));

-- 22. Mutation log (audit trail of state mutations)
CREATE TABLE IF NOT EXISTS mutation_log (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mutation_log_mutation_id ON mutation_log((data->>'mutationId'));
CREATE INDEX idx_mutation_log_correlation_id ON mutation_log((data->>'correlationId'));
CREATE INDEX idx_mutation_log_state_key ON mutation_log((data->>'stateKey'));
CREATE INDEX idx_mutation_log_timestamp ON mutation_log((data->>'timestamp'));
CREATE INDEX idx_mutation_log_key_time ON mutation_log((data->>'stateKey'), (data->>'timestamp'));

-- 23. Personalities collection (LLM identity/personality prompts)
-- Stores personality documents used by llm-bot for prompt composition
-- Firestore mapping: personalities/{personalityId}
CREATE TABLE IF NOT EXISTS personalities (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_personalities_name ON personalities((data->>'name'));
CREATE INDEX idx_personalities_status ON personalities((data->>'status'));
CREATE INDEX idx_personalities_version ON personalities(((data->>'version')::int));
CREATE INDEX idx_personalities_name_status_version ON personalities(
  (data->>'name'),
  (data->>'status'),
  ((data->>'version')::int) DESC
);
CREATE INDEX idx_personalities_platform ON personalities((data->>'platform'));
CREATE INDEX idx_personalities_model ON personalities((data->>'model'));
CREATE INDEX idx_personalities_tags ON personalities USING GIN ((data->'tags'));

-- 24. Sources collection (platform connection status tracking)
-- Added in migration 012-add-sources-table.sql (Sprint 343)
-- Stores real-time status of external platform connections (Twitch, Discord, etc.)
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_platform ON sources ((data->>'platform'));
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources ((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_sources_stream_status ON sources ((data->>'streamStatus'));
CREATE INDEX IF NOT EXISTS idx_sources_updated_at ON sources (updated_at DESC);

-- Trigger to auto-update updated_at timestamp for sources
CREATE OR REPLACE FUNCTION update_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sources_updated_at_trigger
  BEFORE UPDATE ON sources
  FOR EACH ROW
  EXECUTE FUNCTION update_sources_updated_at();

SELECT 'All tables created successfully' AS status;
