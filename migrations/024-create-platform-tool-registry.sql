-- Migration 024: Create platform_tool_registry table
-- Purpose: Persistent storage for tool metadata with RBAC configuration
-- Sprint: 57 (Foundation - tool-orchestrator with Persistent Registries)

CREATE TABLE IF NOT EXISTS platform_tool_registry (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL CHECK (source IN ('internal', 'mcp', 'composition')),
  source_metadata JSONB NOT NULL DEFAULT '{}',
  input_schema JSONB NOT NULL,
  output_schema JSONB,
  rbac JSONB NOT NULL DEFAULT '{"userRoles": {"required": [], "denied": []}, "modelRoles": {"required": [], "denied": []}, "modelTiers": {"allowed": [], "denied": []}}',
  config JSONB NOT NULL DEFAULT '{"timeoutMs": 30000, "retryPolicy": {"maxAttempts": 3, "backoffMs": 1000}}',
  health JSONB NOT NULL DEFAULT '{"status": "healthy"}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  category TEXT,
  related_tools TEXT[] NOT NULL DEFAULT '{}',
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_health_check_at TIMESTAMP WITH TIME ZONE,
  last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_tool_canonical_name UNIQUE (canonical_name)
);

-- Indexes for efficient querying
CREATE INDEX idx_platform_tool_registry_source ON platform_tool_registry(source);
CREATE INDEX idx_platform_tool_registry_status ON platform_tool_registry(status);
CREATE INDEX idx_platform_tool_registry_category ON platform_tool_registry(category);
CREATE INDEX idx_platform_tool_registry_tags ON platform_tool_registry USING GIN(tags);
CREATE INDEX idx_platform_tool_registry_rbac ON platform_tool_registry USING GIN(rbac);
CREATE INDEX idx_platform_tool_registry_source_metadata ON platform_tool_registry USING GIN(source_metadata);

-- Rollback script
-- DROP INDEX IF EXISTS idx_platform_tool_registry_source_metadata;
-- DROP INDEX IF EXISTS idx_platform_tool_registry_rbac;
-- DROP INDEX IF EXISTS idx_platform_tool_registry_tags;
-- DROP INDEX IF EXISTS idx_platform_tool_registry_category;
-- DROP INDEX IF EXISTS idx_platform_tool_registry_status;
-- DROP INDEX IF EXISTS idx_platform_tool_registry_source;
-- DROP TABLE IF EXISTS platform_tool_registry;
