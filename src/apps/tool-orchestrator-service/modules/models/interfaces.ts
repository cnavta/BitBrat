/**
 * Model Registry Interfaces
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import {
  ModelRegistryDocument,
  ModelQueryFilters,
  ModelTrust,
  ToolPolicy,
} from '../types';

/**
 * Model Registry Interface
 * Manages LLM and agent model metadata with security profiles
 */
export interface IModelRegistry {
  // Model CRUD operations
  registerModel(model: ModelRegistryDocument): Promise<void>;
  getModel(id: string): Promise<ModelRegistryDocument | null>;
  listModels(filters: ModelQueryFilters): Promise<ModelRegistryDocument[]>;
  updateModel(id: string, updates: Partial<ModelRegistryDocument>): Promise<void>;

  // Security queries
  getModelRoles(modelId: string): Promise<string[]>;
  getModelTier(modelId: string): Promise<string>;
  getTrustScores(modelId: string, scope?: string): Promise<ModelTrust | null>;

  // Tool policy
  validateToolAccess(modelId: string, toolId: string): Promise<boolean>;
  getModelToolPolicy(modelId: string): Promise<ToolPolicy>;
}
