/**
 * Model Registry Document Types
 * LLM and agent model metadata with security profiles
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

export type ModelType = 'llm' | 'rule-based' | 'hybrid';

export type ModelTier = 'free' | 'basic' | 'premium' | 'enterprise' | 'deterministic' | 'system';

export type ModelStatus = 'active' | 'deprecated' | 'disabled';

/**
 * Trust score for a specific scope
 */
export interface ModelTrust {
  scope: string; // e.g., 'tool-use', 'general', 'code-generation'
  scores: {
    reliability: number; // 0-100
    fidelity: number; // 0-100
    integrity: number; // 0-100
    calibration: number; // 0-100
  };
}

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

/**
 * Model cost structure
 */
export interface ModelCost {
  inputTokenCost: number; // USD per 1M tokens
  outputTokenCost: number; // USD per 1M tokens
}

/**
 * Tool access policy for model
 */
export interface ToolPolicy {
  allowedTools: string[]; // Tool IDs or patterns
  deniedTools: string[]; // Tool IDs or patterns
}

/**
 * Model usage metrics
 */
export interface ModelMetrics {
  totalRequests: number;
  totalTokensUsed: number;
  totalCostUSD: number;
  avgResponseTimeMs: number;
}

/**
 * Main model registry document
 * Maps to model_registry PostgreSQL table
 */
export interface ModelRegistryDocument {
  id: string;
  provider: string; // 'openai', 'anthropic', 'ollama', 'bitbrat'
  displayName: string;
  description?: string;
  modelType: ModelType;
  roles: string[];
  tier: ModelTier;
  trust: ModelTrust[];
  capabilities: ModelCapabilities;
  cost: ModelCost;
  toolPolicy: ToolPolicy;
  status: ModelStatus;
  registeredAt: Date;
  lastUsedAt?: Date;
  metrics: ModelMetrics;
}

/**
 * Model query filters for registry searches
 */
export interface ModelQueryFilters {
  provider?: string[];
  tier?: ModelTier[];
  status?: ModelStatus[];
  capabilities?: {
    toolCalling?: boolean;
    vision?: boolean;
  };
}
