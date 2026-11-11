/**
 * In-Memory Model Registry
 * Sprint 58: RBAC Integration Testing
 *
 * Simple Map-based implementation for testing purposes.
 * Not suitable for production use (no persistence, no concurrency control).
 */

import { IModelRegistry } from './interfaces';
import {
  ModelRegistryDocument,
  ModelQueryFilters,
  ModelTrust,
  ToolPolicy,
} from '../types';

export class InMemoryModelRegistry implements IModelRegistry {
  private models: Map<string, ModelRegistryDocument> = new Map();

  async registerModel(model: ModelRegistryDocument): Promise<void> {
    this.models.set(model.id, model);
  }

  async getModel(id: string): Promise<ModelRegistryDocument | null> {
    return this.models.get(id) || null;
  }

  async listModels(filters: ModelQueryFilters): Promise<ModelRegistryDocument[]> {
    let results = Array.from(this.models.values());

    // Apply filters
    if (filters.provider) {
      results = results.filter((model) =>
        filters.provider!.includes(model.provider)
      );
    }

    if (filters.tier) {
      results = results.filter((model) =>
        filters.tier!.includes(model.tier)
      );
    }

    if (filters.status) {
      results = results.filter((model) =>
        filters.status!.includes(model.status)
      );
    }

    if (filters.capabilities?.toolCalling !== undefined) {
      results = results.filter(
        (model) => model.capabilities.toolCalling === filters.capabilities!.toolCalling
      );
    }

    if (filters.capabilities?.vision !== undefined) {
      results = results.filter(
        (model) => model.capabilities.vision === filters.capabilities!.vision
      );
    }

    return results;
  }

  async updateModel(
    id: string,
    updates: Partial<ModelRegistryDocument>
  ): Promise<void> {
    const existing = this.models.get(id);
    if (!existing) {
      throw new Error(`Model not found: ${id}`);
    }

    this.models.set(id, {
      ...existing,
      ...updates,
    });
  }

  async getModelRoles(modelId: string): Promise<string[]> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    return model.roles;
  }

  async getModelTier(modelId: string): Promise<string> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    return model.tier;
  }

  async getTrustScores(
    modelId: string,
    scope?: string
  ): Promise<ModelTrust | null> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Find trust profile matching scope (exact match first)
    if (scope) {
      const exactMatch = model.trust.find((t) => t.scope === scope);
      if (exactMatch) {
        return exactMatch;
      }
    }

    // Fallback to 'general' scope
    const generalMatch = model.trust.find((t) => t.scope === 'general');
    if (generalMatch) {
      return generalMatch;
    }

    // Return first profile if no match
    return model.trust.length > 0 ? model.trust[0] : null;
  }

  async validateToolAccess(modelId: string, toolId: string): Promise<boolean> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const policy = model.toolPolicy;

    // Check denylist first
    if (policy.deniedTools.includes(toolId)) {
      return false;
    }

    // Check allowlist (empty allowlist = allow all)
    if (policy.allowedTools.length === 0) {
      return true;
    }

    return policy.allowedTools.includes(toolId);
  }

  async getModelToolPolicy(modelId: string): Promise<ToolPolicy> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    return model.toolPolicy;
  }
}
