/**
 * Tool Registry Document Types
 * Persistent tool metadata with RBAC configuration
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

export type ToolSource = 'internal' | 'mcp' | 'composition';

export type ToolStatus = 'active' | 'deprecated' | 'disabled';

export interface ToolSourceMetadata {
  mcpServer?: {
    name: string;
    version?: string;
  };
  bit?: {
    name: string;
    version?: string;
  };
  composition?: {
    toolIds: string[];
    strategy: 'sequential' | 'parallel' | 'conditional';
  };
}

export interface ToolRBAC {
  userRoles: {
    required: string[];
    denied: string[];
  };
  modelRoles: {
    required: string[];
    denied: string[];
  };
  modelTiers: {
    allowed: string[];
    denied: string[];
  };
  minTrustThresholds?: {
    scope?: string; // Default: 'tool-use'
    reliability?: number; // 0-100
    fidelity?: number; // 0-100
    integrity?: number; // 0-100
    calibration?: number; // 0-100
  };
}

export interface ToolRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface ToolConfig {
  timeoutMs: number;
  retryPolicy: ToolRetryPolicy;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ToolHealth {
  status: HealthStatus;
  lastError?: string;
  lastErrorAt?: Date;
  lastInvocationAt?: Date;
  lastSuccessAt?: Date;
  consecutiveFailures?: number;
}

/**
 * Main tool registry document
 * Maps to platform_tool_registry PostgreSQL table
 */
export interface ToolRegistryDocument {
  id: string;
  canonicalName: string;
  description?: string;
  source: ToolSource;
  sourceMetadata: ToolSourceMetadata;
  inputSchema: any; // JSON Schema
  outputSchema?: any; // JSON Schema
  rbac: ToolRBAC;
  config: ToolConfig;
  health: ToolHealth;
  status: ToolStatus;
  tags: string[];
  category?: string;
  relatedTools: string[];
  importedAt: Date;
  lastHealthCheckAt?: Date;
  lastUpdatedAt: Date;
}

/**
 * Tool query filters for registry searches
 */
export interface ToolQueryFilters {
  source?: ToolSource[];
  status?: ToolStatus[];
  category?: string;
  tags?: string[];
  rbacFilter?: {
    userRoles?: string[];
    modelId?: string;
  };
}
