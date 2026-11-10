/**
 * Model Registry Unit Tests
 * Sprint 57: Foundation - tool-orchestrator with Persistent Registries
 */

import { ModelRegistry } from './model-registry';
import { IDocumentStore } from '../../../../common/persistence/interfaces';
import { ModelRegistryDocument, ModelQueryFilters } from '../types';
import { Logger } from 'pino';

// Mock DocumentStore (reusing from tool-registry tests)
class MockDocumentStore implements IDocumentStore {
  private data: Map<string, Map<string, any>> = new Map();

  async get<T = any>(collection: string, id: string): Promise<T | null> {
    const coll = this.data.get(collection);
    return coll?.get(id) || null;
  }

  async set<T = any>(
    collection: string,
    id: string,
    data: T,
    merge?: boolean
  ): Promise<void> {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    const coll = this.data.get(collection)!;

    if (merge && coll.has(id)) {
      const existing = coll.get(id);
      coll.set(id, { ...existing, ...data });
    } else {
      coll.set(id, data);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    this.data.get(collection)?.delete(id);
  }

  async query<T = any>(collection: string, options: any): Promise<T[]> {
    const coll = this.data.get(collection);
    if (!coll) return [];

    let results = Array.from(coll.values());

    // Apply filters
    if (options.filters) {
      for (const filter of options.filters) {
        results = results.filter((doc: any) => {
          const value = doc[filter.field];
          switch (filter.operator) {
            case '==':
              return value === filter.value;
            case 'in':
              return filter.value.includes(value);
            default:
              return true;
          }
        });
      }
    }

    return results as T[];
  }

  async getAll<T = any>(collection: string): Promise<T[]> {
    const coll = this.data.get(collection);
    return coll ? Array.from(coll.values()) as T[] : [];
  }

  watch<T = any>(
    collection: string,
    callback: (documents: T[]) => void,
    pollInterval?: number
  ): () => void {
    return () => {};
  }

  async batch(operations: any[]): Promise<void> {
    for (const op of operations) {
      if (op.type === 'set') {
        await this.set(op.collection, op.id, op.data);
      } else if (op.type === 'delete') {
        await this.delete(op.collection, op.id);
      }
    }
  }

  async health(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    return { healthy: true, latency: 1 };
  }
}

// Mock Logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any as Logger;

describe('ModelRegistry', () => {
  let registry: ModelRegistry;
  let store: MockDocumentStore;

  beforeEach(() => {
    store = new MockDocumentStore();
    registry = new ModelRegistry(store, mockLogger);
  });

  describe('registerModel', () => {
    it('should register a new model', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        description: 'OpenAI GPT-4 model',
        modelType: 'llm',
        roles: ['model', 'premium'],
        tier: 'premium',
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 95,
              fidelity: 93,
              integrity: 94,
              calibration: 92,
            },
          },
        ],
        capabilities: {
          toolCalling: true,
          vision: true,
          streaming: true,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: {
          inputTokenCost: 30,
          outputTokenCost: 60,
        },
        toolPolicy: {
          allowedTools: [],
          deniedTools: [],
        },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const retrieved = await registry.getModel('gpt-4');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.displayName).toBe('GPT-4');
      expect(retrieved?.tier).toBe('premium');
    });

    it('should reject duplicate model IDs', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: {
          inputTokenCost: 30,
          outputTokenCost: 60,
        },
        toolPolicy: {
          allowedTools: [],
          deniedTools: [],
        },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);
      await expect(registry.registerModel(model)).rejects.toThrow(
        'Model with ID "gpt-4" already exists'
      );
    });
  });

  describe('listModels', () => {
    beforeEach(async () => {
      const models: ModelRegistryDocument[] = [
        {
          id: 'gpt-4',
          provider: 'openai',
          displayName: 'GPT-4',
          modelType: 'llm',
          roles: ['model', 'premium'],
          tier: 'premium',
          trust: [],
          capabilities: {
            toolCalling: true,
            vision: true,
            streaming: false,
            maxContextTokens: 128000,
            maxOutputTokens: 4096,
          },
          cost: { inputTokenCost: 30, outputTokenCost: 60 },
          toolPolicy: { allowedTools: [], deniedTools: [] },
          status: 'active',
          registeredAt: new Date(),
          metrics: {
            totalRequests: 0,
            totalTokensUsed: 0,
            totalCostUSD: 0,
            avgResponseTimeMs: 0,
          },
        },
        {
          id: 'gpt-3.5-turbo',
          provider: 'openai',
          displayName: 'GPT-3.5 Turbo',
          modelType: 'llm',
          roles: ['model', 'basic'],
          tier: 'basic',
          trust: [],
          capabilities: {
            toolCalling: true,
            vision: false,
            streaming: false,
            maxContextTokens: 16000,
            maxOutputTokens: 4096,
          },
          cost: { inputTokenCost: 0.5, outputTokenCost: 1.5 },
          toolPolicy: { allowedTools: [], deniedTools: [] },
          status: 'active',
          registeredAt: new Date(),
          metrics: {
            totalRequests: 0,
            totalTokensUsed: 0,
            totalCostUSD: 0,
            avgResponseTimeMs: 0,
          },
        },
        {
          id: 'reflex',
          provider: 'bitbrat',
          displayName: 'Reflex',
          modelType: 'rule-based',
          roles: ['agent', 'deterministic'],
          tier: 'deterministic',
          trust: [],
          capabilities: {
            toolCalling: true,
            vision: false,
            streaming: false,
            maxContextTokens: 0,
            maxOutputTokens: 0,
          },
          cost: { inputTokenCost: 0, outputTokenCost: 0 },
          toolPolicy: { allowedTools: [], deniedTools: [] },
          status: 'active',
          registeredAt: new Date(),
          metrics: {
            totalRequests: 0,
            totalTokensUsed: 0,
            totalCostUSD: 0,
            avgResponseTimeMs: 0,
          },
        },
      ];

      for (const model of models) {
        await store.set('model_registry', model.id, model);
      }
    });

    it('should filter by provider', async () => {
      const filters: ModelQueryFilters = { provider: ['openai'] };
      const results = await registry.listModels(filters);

      expect(results).toHaveLength(2);
      expect(results.every((m) => m.provider === 'openai')).toBe(true);
    });

    it('should filter by tier', async () => {
      const filters: ModelQueryFilters = { tier: ['premium'] };
      const results = await registry.listModels(filters);

      expect(results).toHaveLength(1);
      expect(results[0].tier).toBe('premium');
    });

    it('should filter by capabilities', async () => {
      const filters: ModelQueryFilters = {
        capabilities: { vision: true },
      };
      const results = await registry.listModels(filters);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('gpt-4');
    });

    it('should filter by multiple capabilities', async () => {
      const filters: ModelQueryFilters = {
        capabilities: { toolCalling: true, vision: false },
      };
      const results = await registry.listModels(filters);

      expect(results).toHaveLength(2); // gpt-3.5-turbo and reflex
      expect(results.some((m) => m.id === 'gpt-4')).toBe(false);
    });
  });

  describe('getTrustScores', () => {
    it('should return trust scores for requested scope', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [
          {
            scope: 'tool-use',
            scores: {
              reliability: 95,
              fidelity: 93,
              integrity: 94,
              calibration: 92,
            },
          },
          {
            scope: 'general',
            scores: {
              reliability: 90,
              fidelity: 88,
              integrity: 89,
              calibration: 87,
            },
          },
        ],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: { allowedTools: [], deniedTools: [] },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const trustScores = await registry.getTrustScores('gpt-4', 'tool-use');
      expect(trustScores).not.toBeNull();
      expect(trustScores?.scope).toBe('tool-use');
      expect(trustScores?.scores.reliability).toBe(95);
    });

    it('should fall back to general scope if requested scope not found', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [
          {
            scope: 'general',
            scores: {
              reliability: 90,
              fidelity: 88,
              integrity: 89,
              calibration: 87,
            },
          },
        ],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: { allowedTools: [], deniedTools: [] },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const trustScores = await registry.getTrustScores('gpt-4', 'tool-use');
      expect(trustScores).not.toBeNull();
      expect(trustScores?.scope).toBe('general'); // Fallback
    });
  });

  describe('validateToolAccess', () => {
    it('should allow access when no policy restrictions', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: {
          allowedTools: [],
          deniedTools: [],
        },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const hasAccess = await registry.validateToolAccess('gpt-4', 'any.tool');
      expect(hasAccess).toBe(true);
    });

    it('should deny access when tool is in deny list', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: {
          allowedTools: [],
          deniedTools: ['dangerous.*'],
        },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const hasAccess = await registry.validateToolAccess('gpt-4', 'dangerous.tool');
      expect(hasAccess).toBe(false);
    });

    it('should allow access when tool matches allow list', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: [],
        tier: 'premium',
        trust: [],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: {
          allowedTools: ['safe.*', 'approved.tool'],
          deniedTools: [],
        },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const hasAccessWildcard = await registry.validateToolAccess('gpt-4', 'safe.tool1');
      expect(hasAccessWildcard).toBe(true);

      const hasAccessExact = await registry.validateToolAccess('gpt-4', 'approved.tool');
      expect(hasAccessExact).toBe(true);

      const hasAccessDenied = await registry.validateToolAccess('gpt-4', 'unapproved.tool');
      expect(hasAccessDenied).toBe(false);
    });
  });

  describe('getModelRoles', () => {
    it('should return model roles', async () => {
      const model: ModelRegistryDocument = {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        modelType: 'llm',
        roles: ['model', 'premium', 'vision'],
        tier: 'premium',
        trust: [],
        capabilities: {
          toolCalling: true,
          vision: false,
          streaming: false,
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
        },
        cost: { inputTokenCost: 30, outputTokenCost: 60 },
        toolPolicy: { allowedTools: [], deniedTools: [] },
        status: 'active',
        registeredAt: new Date(),
        metrics: {
          totalRequests: 0,
          totalTokensUsed: 0,
          totalCostUSD: 0,
          avgResponseTimeMs: 0,
        },
      };

      await registry.registerModel(model);

      const roles = await registry.getModelRoles('gpt-4');
      expect(roles).toEqual(['model', 'premium', 'vision']);
    });

    it('should return empty array for non-existent model', async () => {
      const roles = await registry.getModelRoles('non-existent');
      expect(roles).toEqual([]);
    });
  });
});
