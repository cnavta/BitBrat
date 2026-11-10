-- Migration 026: Create mcp_server_registrations table
-- Purpose: Track MCP server connections and imported tools
-- Sprint: 57 (Foundation - tool-orchestrator with Persistent Registries)

CREATE TABLE IF NOT EXISTS mcp_server_registrations (
  name TEXT PRIMARY KEY,
  transport TEXT NOT NULL CHECK (transport IN ('http', 'stdio')),
  connection_config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  tools_imported TEXT[] NOT NULL DEFAULT '{}',
  last_discovery_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_mcp_server_registrations_status ON mcp_server_registrations(status);
CREATE INDEX idx_mcp_server_registrations_transport ON mcp_server_registrations(transport);

-- Rollback script
-- DROP INDEX IF EXISTS idx_mcp_server_registrations_transport;
-- DROP INDEX IF EXISTS idx_mcp_server_registrations_status;
-- DROP TABLE IF EXISTS mcp_server_registrations;
