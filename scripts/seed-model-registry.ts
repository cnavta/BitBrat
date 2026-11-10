/**
 * Model Registry Seed Script
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 *
 * Loads model definitions from config/model-registry-seed.yaml into the model registry
 * Idempotent - safe to run multiple times
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ModelRegistry } from '../src/apps/tool-orchestrator-service/modules/models/model-registry';
import { ModelRegistryDocument } from '../src/apps/tool-orchestrator-service/modules/types';
import { createDocumentStore } from '../src/common/persistence/factory';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

interface ModelSeedConfig {
  models: Array<{
    id: string;
    provider: string;
    displayName: string;
    description?: string;
    modelType: 'llm' | 'rule-based' | 'hybrid';
    roles: string[];
    tier: string;
    trust: Array<{
      scope: string;
      scores: {
        reliability: number;
        fidelity: number;
        integrity: number;
        calibration: number;
      };
    }>;
    capabilities: {
      toolCalling: boolean;
      vision: boolean;
      streaming: boolean;
      maxContextTokens: number;
      maxOutputTokens: number;
    };
    cost: {
      inputTokenCost: number;
      outputTokenCost: number;
    };
    toolPolicy: {
      allowedTools: string[];
      deniedTools: string[];
    };
    status: 'active' | 'deprecated' | 'disabled';
  }>;
}

async function seedModelRegistry(): Promise<void> {
  logger.info('model_registry_seed.start');

  try {
    // Load seed configuration
    const configPath = path.join(__dirname, '../config/model-registry-seed.yaml');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Seed configuration not found: ${configPath}`);
    }

    const configFile = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configFile) as ModelSeedConfig;

    logger.info({ modelCount: config.models.length }, 'model_registry_seed.config_loaded');

    // Initialize DocumentStore and ModelRegistry
    const store = await createDocumentStore();
    const registry = new ModelRegistry(store, logger);

    logger.info('model_registry_seed.registry_initialized');

    // Seed models
    let registeredCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const modelDef of config.models) {
      const model: ModelRegistryDocument = {
        id: modelDef.id,
        provider: modelDef.provider,
        displayName: modelDef.displayName,
        description: modelDef.description,
        modelType: modelDef.modelType,
        roles: modelDef.roles,
        tier: modelDef.tier as any,
        trust: modelDef.trust,
        capabilities: modelDef.capabilities,
        cost: modelDef.cost,
        toolPolicy: modelDef.toolPolicy,
        status: modelDef.status as any,
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      try {
        // Check if model already exists
        const existing = await registry.getModel(model.id);

        if (existing) {
          // Update existing model (idempotent)
          await registry.updateModel(model.id, {
            description: model.description,
            trust: model.trust,
            capabilities: model.capabilities,
            cost: model.cost,
            toolPolicy: model.toolPolicy,
            status: model.status,
          });
          updatedCount++;
          logger.info({ modelId: model.id }, 'model_registry_seed.model_updated');
        } else {
          // Register new model
          await registry.registerModel(model);
          registeredCount++;
          logger.info({ modelId: model.id }, 'model_registry_seed.model_registered');
        }
      } catch (err) {
        skippedCount++;
        logger.error({
          modelId: model.id,
          error: err instanceof Error ? err.message : String(err),
        }, 'model_registry_seed.model_failed');
      }
    }

    logger.info({
      total: config.models.length,
      registered: registeredCount,
      updated: updatedCount,
      skipped: skippedCount,
    }, 'model_registry_seed.complete');

    process.exit(0);
  } catch (err) {
    logger.error({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }, 'model_registry_seed.failed');
    process.exit(1);
  }
}

// Run seed
seedModelRegistry();
