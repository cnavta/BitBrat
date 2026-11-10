-- Migration 025: Create model_registry table
-- Purpose: Store LLM and agent model metadata with security profiles
-- Sprint: 57 (Foundation - tool-orchestrator with Persistent Registries)

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  model_type TEXT NOT NULL DEFAULT 'llm' CHECK (model_type IN ('llm', 'rule-based', 'hybrid')),
  roles TEXT[] NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL CHECK (tier IN ('free', 'basic', 'premium', 'enterprise', 'deterministic', 'system')),
  trust JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL DEFAULT '{"toolCalling": false, "vision": false, "streaming": false, "maxContextTokens": 0, "maxOutputTokens": 0}',
  cost JSONB NOT NULL DEFAULT '{"inputTokenCost": 0, "outputTokenCost": 0}',
  tool_policy JSONB NOT NULL DEFAULT '{"allowedTools": [], "deniedTools": []}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  metrics JSONB NOT NULL DEFAULT '{"totalRequests": 0, "totalTokensUsed": 0, "totalCostUSD": 0, "avgResponseTimeMs": 0}',
  CONSTRAINT unique_model_display_name UNIQUE (display_name)
);

-- Indexes for efficient querying
CREATE INDEX idx_model_registry_provider ON model_registry(provider);
CREATE INDEX idx_model_registry_tier ON model_registry(tier);
CREATE INDEX idx_model_registry_status ON model_registry(status);
CREATE INDEX idx_model_registry_roles ON model_registry USING GIN(roles);
CREATE INDEX idx_model_registry_capabilities ON model_registry USING GIN(capabilities);

-- Rollback script
-- DROP INDEX IF EXISTS idx_model_registry_capabilities;
-- DROP INDEX IF EXISTS idx_model_registry_roles;
-- DROP INDEX IF EXISTS idx_model_registry_status;
-- DROP INDEX IF EXISTS idx_model_registry_tier;
-- DROP INDEX IF EXISTS idx_model_registry_provider;
-- DROP TABLE IF EXISTS model_registry;
