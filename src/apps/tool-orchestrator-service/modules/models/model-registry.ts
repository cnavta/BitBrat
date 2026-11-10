/**
 * Model Registry Module
 * Persistent PostgreSQL-backed model storage with security profiles
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import { IDocumentStore, QueryFilter } from '../../../../common/persistence/interfaces';
import { Logger } from 'pino';
import {
  ModelRegistryDocument,
  ModelQueryFilters,
  ModelTrust,
  ToolPolicy,
} from '../types';
import { IModelRegistry } from './interfaces';

const COLLECTION_NAME = 'model_registry';

/**
 * ModelRegistry implementation using PostgreSQL DocumentStore
 */
export class ModelRegistry implements IModelRegistry {
  constructor(
    private readonly store: IDocumentStore,
    private readonly logger: Logger
  ) {}

  /**
   * Register a new model in the registry
   */
  async registerModel(model: ModelRegistryDocument): Promise<void> {
    this.logger.debug({ modelId: model.id, provider: model.provider }, 'model_registry.register_model');

    // Check if model already exists
    const existing = await this.getModel(model.id);
    if (existing) {
      this.logger.warn({
        modelId: model.id,
        displayName: model.displayName,
      }, 'model_registry.model_already_exists');
      throw new Error(`Model with ID "${model.id}" already exists. Use updateModel() to modify.`);
    }

    await this.store.set(COLLECTION_NAME, model.id, model);

    this.logger.info({
      modelId: model.id,
      displayName: model.displayName,
      provider: model.provider,
      tier: model.tier,
    }, 'model_registry.model_registered');
  }

  /**
   * Get a model by ID
   */
  async getModel(id: string): Promise<ModelRegistryDocument | null> {
    this.logger.debug({ modelId: id }, 'model_registry.get_model');
    return await this.store.get<ModelRegistryDocument>(COLLECTION_NAME, id);
  }

  /**
   * List models with optional filters
   */
  async listModels(filters: ModelQueryFilters): Promise<ModelRegistryDocument[]> {
    this.logger.debug({ filters }, 'model_registry.list_models');

    const queryFilters: QueryFilter[] = [];

    if (filters.provider && filters.provider.length > 0) {
      queryFilters.push({
        field: 'provider',
        operator: 'in',
        value: filters.provider,
      });
    }

    if (filters.tier && filters.tier.length > 0) {
      queryFilters.push({
        field: 'tier',
        operator: 'in',
        value: filters.tier,
      });
    }

    if (filters.status && filters.status.length > 0) {
      queryFilters.push({
        field: 'status',
        operator: 'in',
        value: filters.status,
      });
    }

    const models = await this.store.query<ModelRegistryDocument>(COLLECTION_NAME, {
      filters: queryFilters.length > 0 ? queryFilters : undefined,
    });

    // Apply capability filtering if requested (post-query filtering for JSONB)
    let filteredModels = models;
    if (filters.capabilities) {
      filteredModels = this.applyCapabilityFilter(models, filters.capabilities);
    }

    this.logger.debug({
      totalFound: models.length,
      afterCapabilityFilter: filteredModels.length,
    }, 'model_registry.list_models_result');

    return filteredModels;
  }

  /**
   * Update a model's metadata
   */
  async updateModel(
    id: string,
    updates: Partial<ModelRegistryDocument>
  ): Promise<void> {
    this.logger.debug({ modelId: id, updates }, 'model_registry.update_model');

    const existing = await this.getModel(id);
    if (!existing) {
      throw new Error(`Model not found: ${id}`);
    }

    // Update last used timestamp if not provided
    if (!updates.lastUsedAt && updates.metrics) {
      updates.lastUsedAt = new Date();
    }

    await this.store.set(COLLECTION_NAME, id, updates, true); // merge=true

    this.logger.info({ modelId: id }, 'model_registry.model_updated');
  }

  /**
   * Get model roles
   */
  async getModelRoles(modelId: string): Promise<string[]> {
    this.logger.debug({ modelId }, 'model_registry.get_model_roles');

    const model = await this.getModel(modelId);
    if (!model) {
      this.logger.warn({ modelId }, 'model_registry.model_not_found');
      return [];
    }

    return model.roles;
  }

  /**
   * Get model tier
   */
  async getModelTier(modelId: string): Promise<string> {
    this.logger.debug({ modelId }, 'model_registry.get_model_tier');

    const model = await this.getModel(modelId);
    if (!model) {
      this.logger.warn({ modelId }, 'model_registry.model_not_found');
      throw new Error(`Model not found: ${modelId}`);
    }

    return model.tier;
  }

  /**
   * Get trust scores for a model with scope matching
   * Defaults to 'tool-use' scope, falls back to 'general' if not found
   */
  async getTrustScores(modelId: string, scope: string = 'tool-use'): Promise<ModelTrust | null> {
    this.logger.debug({ modelId, scope }, 'model_registry.get_trust_scores');

    const model = await this.getModel(modelId);
    if (!model) {
      this.logger.warn({ modelId }, 'model_registry.model_not_found');
      return null;
    }

    // Try to find exact scope match
    let trustScore = model.trust.find((t) => t.scope === scope);

    // Fallback to 'general' scope if requested scope not found
    if (!trustScore && scope !== 'general') {
      trustScore = model.trust.find((t) => t.scope === 'general');
      if (trustScore) {
        this.logger.debug({
          modelId,
          requestedScope: scope,
          fallbackScope: 'general',
        }, 'model_registry.trust_score_fallback');
      }
    }

    if (!trustScore) {
      this.logger.warn({
        modelId,
        scope,
        availableScopes: model.trust.map((t) => t.scope),
      }, 'model_registry.trust_score_not_found');
      return null;
    }

    return trustScore;
  }

  /**
   * Validate if a model has access to a specific tool
   */
  async validateToolAccess(modelId: string, toolId: string): Promise<boolean> {
    this.logger.debug({ modelId, toolId }, 'model_registry.validate_tool_access');

    const model = await this.getModel(modelId);
    if (!model) {
      this.logger.warn({ modelId }, 'model_registry.model_not_found');
      return false;
    }

    const policy = model.toolPolicy;

    // Check deny list first
    if (policy.deniedTools.length > 0) {
      const isDenied = policy.deniedTools.some((pattern) =>
        this.matchesPattern(toolId, pattern)
      );
      if (isDenied) {
        this.logger.debug({
          modelId,
          toolId,
          reason: 'denied_by_policy',
        }, 'model_registry.tool_access_denied');
        return false;
      }
    }

    // If allow list is empty, allow all (except denied)
    if (policy.allowedTools.length === 0) {
      this.logger.debug({
        modelId,
        toolId,
        reason: 'no_allowlist',
      }, 'model_registry.tool_access_granted');
      return true;
    }

    // Check allow list
    const isAllowed = policy.allowedTools.some((pattern) =>
      this.matchesPattern(toolId, pattern)
    );

    if (isAllowed) {
      this.logger.debug({
        modelId,
        toolId,
        reason: 'allowed_by_policy',
      }, 'model_registry.tool_access_granted');
    } else {
      this.logger.debug({
        modelId,
        toolId,
        reason: 'not_in_allowlist',
      }, 'model_registry.tool_access_denied');
    }

    return isAllowed;
  }

  /**
   * Get model tool policy
   */
  async getModelToolPolicy(modelId: string): Promise<ToolPolicy> {
    this.logger.debug({ modelId }, 'model_registry.get_model_tool_policy');

    const model = await this.getModel(modelId);
    if (!model) {
      this.logger.warn({ modelId }, 'model_registry.model_not_found');
      throw new Error(`Model not found: ${modelId}`);
    }

    return model.toolPolicy;
  }

  /**
   * Apply capability filtering to models (post-query)
   */
  private applyCapabilityFilter(
    models: ModelRegistryDocument[],
    capabilities: { toolCalling?: boolean; vision?: boolean }
  ): ModelRegistryDocument[] {
    return models.filter((model) => {
      if (capabilities.toolCalling !== undefined) {
        if (model.capabilities.toolCalling !== capabilities.toolCalling) {
          return false;
        }
      }

      if (capabilities.vision !== undefined) {
        if (model.capabilities.vision !== capabilities.vision) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Match tool ID against pattern (supports wildcards)
   */
  private matchesPattern(toolId: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    // Example: "mcp.*" -> /^mcp\..*$/
    // First escape all regex special characters (including . and *),
    // then convert our escaped wildcards to their regex equivalents
    const regexPattern = pattern
      .replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')  // Escape all regex special chars (including * and .)
      .replace(/\\\*/g, '.*')                   // Convert escaped * to .* for zero-or-more wildcard
      .replace(/\\\./g, '.');                   // Convert escaped . to . for any-char wildcard
    const regex = new RegExp(`^${regexPattern}$`);

    return regex.test(toolId);
  }
}
