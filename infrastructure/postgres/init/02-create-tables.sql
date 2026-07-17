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

SELECT 'All tables created successfully' AS status;
