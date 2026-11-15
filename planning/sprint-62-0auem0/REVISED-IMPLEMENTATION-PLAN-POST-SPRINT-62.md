# Revised Implementation Plan: Tool-Orchestrator Completion
**Date**: 2026-11-14
**Status**: Active - Post Sprint 62
**Context**: Sprint 62 Complete, Remaining Work to Full Vision

---

## Executive Summary

Sprint 62 successfully delivered **MCP tool aggregation** (19 tools from PostgreSQL exposed via MCP endpoint), completing approximately **15-20% of the full Sprint 55 tool-orchestrator vision**. The core data layer is operational, but **80-85% of the architectural transformation remains**:

### What Sprint 62 Delivered (✅ Complete)

| Component | Status | Completion |
|-----------|--------|------------|
| **Tool Cache** | ✅ Complete | 100% |
| **PostgreSQL Tool Loading** | ✅ Complete | 100% |
| **MCP Server Override** | ✅ Complete | 100% |
| **Schema Cleaning** | ✅ Complete | 100% |
| **Periodic Cache Refresh** | ✅ Complete | 100% |
| **Integration Tests** | ✅ Complete | 100% |
| **Staging Validation** | ✅ Complete | 100% |

**Sprint 62 Achievement**: 76% of Sprint 62 scope (19h/34h), 100% core MCP aggregation functionality

### What Remains (❌ Gap: 80-85% of Full Vision)

| Component | Status | Gap Size | Estimated Effort |
|-----------|--------|----------|------------------|
| **ToolRegistry Module** | ⚠️ Partial | 50% | 2-3 weeks |
| **ModelRegistry Module** | ❌ Missing | 100% | 2-3 weeks |
| **Model-Based RBAC** | ❌ Missing | 100% | 2-3 weeks |
| **Tool Execution Logic** | ❌ Missing | 100% | 3-4 weeks |
| **ToolObserver Module** | ❌ Missing | 100% | 2 weeks |
| **Composition RBAC** | ❌ Missing | 100% | 2 weeks |
| **Production Cutover** | ❌ Missing | 100% | 1-2 weeks |

**Total Remaining**: ~14-18 weeks (5 sprints)

---

## Gap Analysis: Sprint 62 vs Sprint 55 Vision

### Current State (Post-Sprint 62)

**What Works**:
```typescript
// src/apps/tool-orchestrator-service.ts
export class ToolOrchestratorServer extends Bit {
  private toolCache: ToolRegistryDocument[] = []; // ✅ In-memory cache
  private toolRegistry?: ToolRegistry; // ⚠️ Partial (read-only queries)
  private toolGateway?: ToolGateway; // ❌ Missing

  // ✅ WORKS: Loads tools from PostgreSQL on startup
  private async loadToolsFromRegistry(): Promise<void> { /* ... */ }

  // ✅ WORKS: Synchronous access to cached tools
  private getAllToolsFromRegistry(): ToolRegistryDocument[] { /* ... */ }

  // ✅ WORKS: Serves aggregated tools via MCP endpoint
  protected getMcpServer(): McpServer { /* ... */ }
}
```

**What's Missing**:
```typescript
// ❌ NOT IMPLEMENTED: ToolRegistry CRUD operations
async registerTool(tool: ToolRegistryDocument): Promise<void> {
  throw new Error('Not implemented - Sprint 63');
}

// ❌ NOT IMPLEMENTED: ModelRegistry (doesn't exist)
private modelRegistry?: ModelRegistry; // No model catalog at all

// ❌ NOT IMPLEMENTED: Model-based RBAC validation
async validateToolAccess(
  toolId: string,
  userRoles: string[],
  modelId: string // ← Sprint 62 doesn't use modelId
): Promise<RBACResult> {
  throw new Error('Not implemented - Sprint 64');
}

// ❌ NOT IMPLEMENTED: Tool execution
async execute(
  toolId: string,
  args: any,
  context: ToolExecutionContext
): Promise<ToolResult> {
  throw new Error('Not implemented - Sprint 65');
}

// ❌ NOT IMPLEMENTED: ToolObserver (Loki metrics)
private toolObserver?: ToolObserver; // No observability module
```

### Sprint 55 Vision vs Sprint 62 Reality

| Feature | Sprint 55 Vision | Sprint 62 Reality | Gap |
|---------|------------------|-------------------|-----|
| **Tool Storage** | PostgreSQL persistent | PostgreSQL read-only | Write operations missing |
| **Tool CRUD** | Full create/update/deprecate/disable | Read-only queries | 100% gap |
| **Model Catalog** | PostgreSQL model_registry with trust scores | Doesn't exist | 100% gap |
| **RBAC Model** | Dual-layer (User × Model) | Not implemented | 100% gap |
| **Tool Execution** | MCP + Internal + Composition | Placeholders only | 100% gap |
| **Observability** | ToolObserver + Loki queries + 4 dashboards | Not implemented | 100% gap |
| **MCP Aggregation** | ✅ Serve 100+ tools from PostgreSQL | ✅ Serves 19 tools | ✅ Working |

---

## Revised Timeline: 5 Remaining Sprints

**Completed**: Sprint 62 (MCP Aggregation)
**Remaining**: Sprints 63-67
**Total Duration**: 14-18 weeks to completion
**Target Completion**: End of Q1 2027

| Sprint | Focus | Duration | Completion |
|--------|-------|----------|------------|
| **62** | MCP Aggregation | 2-3 weeks | ✅ Complete |
| **63** | Foundation (ToolRegistry + ModelRegistry) | 2-3 weeks | ⏳ Next |
| **64** | Model-Based RBAC | 2-3 weeks | ⏳ Pending |
| **65** | Tool Execution Migration | 3-4 weeks | ⏳ Pending |
| **66** | Observability (ToolObserver + Loki) | 2 weeks | ⏳ Pending |
| **67** | Composition RBAC + Validation + Cutover | 2-3 weeks | ⏳ Pending |

---

## Sprint 63: Foundation (ToolRegistry + ModelRegistry Completion)

**Duration**: 2-3 weeks
**Goal**: Complete persistent tool/model registries with full CRUD operations
**Prerequisites**: Sprint 62 complete ✅

### Bootstrap Information

**Entry Point**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Current State**:
- ToolRegistry exists but only implements read-only queries
- ModelRegistry doesn't exist at all
- PostgreSQL `platform_tool_registry` table exists (Migration 024)
- PostgreSQL `model_registry` table doesn't exist (Migration 025 needed)

**Goal**: Transform read-only ToolRegistry into full CRUD module, create ModelRegistry from scratch

**Key Files to Create/Modify**:
1. `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` (enhance existing ~200 lines → ~600 lines)
2. `src/apps/tool-orchestrator-service/modules/models/model-registry.ts` (new file, ~500 lines)
3. `src/apps/tool-orchestrator-service/types/tool-registry-document.ts` (new file, ~150 lines)
4. `src/apps/tool-orchestrator-service/types/model-registry-document.ts` (new file, ~200 lines)
5. `migrations/025-create-model-registry.sql` (new migration)
6. `scripts/seed-model-registry.ts` (new script, ~300 lines)

### Deliverables

1. **ToolRegistry Module Enhancement** - Full CRUD operations (create, read, update, deprecate, disable)
2. **ModelRegistry Module** - Complete model catalog with trust scores and capabilities
3. **PostgreSQL Migration 025** - Create model_registry table
4. **Model Seeding** - 10+ well-known models (gpt-4, claude, reflex, etc.)
5. **MCP Tools** - tool.import, tool.update_config, model.register, model.get
6. **Deduplication Logic** - Handle multiple sources providing same tool
7. **Integration Tests** - 20+ tests for ToolRegistry and ModelRegistry

### Tasks

#### T1: Complete ToolRegistry Module (5 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

import { IDocumentStore } from '../../../common/persistence/interfaces';
import { Logger } from 'pino';
import { ToolRegistryDocument } from '../../types/tool-registry-document';

export interface IToolRegistry {
  // Tool retrieval (already implemented in Sprint 62)
  getTool(toolId: string): Promise<ToolRegistryDocument | null>;
  queryTools(filters: QueryFilter[]): Promise<ToolRegistryDocument[]>;

  // Tool management (NEW in Sprint 63)
  registerTool(tool: Partial<ToolRegistryDocument>): Promise<void>;
  updateToolConfig(toolId: string, config: Partial<ToolConfig>): Promise<void>;
  deprecateTool(toolId: string, reason: string): Promise<void>;
  disableTool(toolId: string): Promise<void>;

  // Import pipeline (NEW in Sprint 63)
  importFromMcpServer(serverId: string, tools: MCPToolSchema[]): Promise<void>;
  importFromBit(bitName: string, tools: BitBratTool[]): Promise<void>;
  importFromComposition(compId: string, composition: CompositionSchema): Promise<void>;

  // Deduplication & validation (NEW in Sprint 63)
  deduplicateTool(toolId: string): Promise<void>;
  validateToolSchema(tool: ToolRegistryDocument): Promise<ValidationResult>;
}

export class ToolRegistry implements IToolRegistry {
  constructor(
    private readonly documentStore: IDocumentStore,
    private readonly logger: Logger,
    private readonly collection: string = 'platform_tool_registry'
  ) {}

  // ✅ Already implemented in Sprint 62
  async getTool(toolId: string): Promise<ToolRegistryDocument | null> {
    return await this.documentStore.get<ToolRegistryDocument>(
      this.collection,
      toolId
    );
  }

  async queryTools(filters: QueryFilter[]): Promise<ToolRegistryDocument[]> {
    return await this.documentStore.query<ToolRegistryDocument>(
      this.collection,
      filters
    );
  }

  // 🆕 NEW: Tool registration
  async registerTool(tool: Partial<ToolRegistryDocument>): Promise<void> {
    // 1. Validate schema
    const validation = this.validateToolSchema(tool as ToolRegistryDocument);
    if (!validation.valid) {
      throw new Error(`Invalid tool schema: ${validation.errors.join(', ')}`);
    }

    // 2. Check for duplicates
    const existing = await this.getTool(tool.id!);
    if (existing) {
      this.logger.warn('tool_registration_duplicate', {
        toolId: tool.id,
        existingSource: existing.source,
        newSource: tool.source
      });
      throw new Error(`Tool ${tool.id} already exists (source: ${existing.source})`);
    }

    // 3. Set defaults
    const document: ToolRegistryDocument = {
      ...tool as ToolRegistryDocument,
      importedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      status: 'active',
      health: {
        status: 'healthy'
      }
    };

    // 4. Store in PostgreSQL
    await this.documentStore.set(this.collection, tool.id!, document);

    this.logger.info('tool_registered', {
      toolId: tool.id,
      source: tool.source,
      canonicalName: tool.canonicalName
    });
  }

  // 🆕 NEW: MCP server import pipeline
  async importFromMcpServer(
    serverName: string,
    tools: MCPToolSchema[]
  ): Promise<void> {
    this.logger.info('mcp_import_started', {
      serverName,
      toolCount: tools.length
    });

    let imported = 0;
    let skipped = 0;

    for (const mcpTool of tools) {
      try {
        // Transform MCP schema to ToolRegistryDocument
        const document: ToolRegistryDocument = {
          id: mcpTool.name, // Canonical ID
          canonicalName: mcpTool.name,
          description: mcpTool.description || 'No description provided',
          source: 'mcp',
          sourceMetadata: {
            mcpServer: {
              name: serverName,
              transport: 'http', // TODO: Get from server config
              connectionConfig: {
                url: '', // TODO: Get from server config
              }
            }
          },
          inputSchema: mcpTool.inputSchema,
          outputSchema: undefined,
          rbac: {
            userRoles: {
              required: [], // Default: no user restrictions
              denied: []
            },
            modelRoles: {
              required: [], // Default: no model restrictions
              denied: []
            },
            modelTiers: {
              allowed: [], // Empty = all tiers allowed
              denied: []
            }
          },
          config: {
            timeoutMs: 30000, // Default: 30 seconds
            maxRetryAttempts: 3,
            retryBackoffMs: 1000,
            costTier: 'standard'
          },
          health: {
            status: 'healthy'
          },
          status: 'active',
          tags: [],
          relatedTools: []
        };

        await this.registerTool(document);
        imported++;
      } catch (err) {
        this.logger.warn('mcp_tool_import_failed', {
          toolName: mcpTool.name,
          error: err instanceof Error ? err.message : String(err)
        });
        skipped++;
      }
    }

    this.logger.info('mcp_import_complete', {
      serverName,
      imported,
      skipped,
      total: tools.length
    });
  }

  // 🆕 NEW: Deduplication logic
  async deduplicateTool(toolId: string): Promise<void> {
    // Find all tools with this canonical name
    const allTools = await this.queryTools([]);
    const duplicates = allTools.filter(
      t => t.canonicalName === toolId || t.id.includes(toolId)
    );

    if (duplicates.length <= 1) {
      this.logger.debug('no_duplicates_found', { toolId });
      return;
    }

    // Preference order: internal > composition > mcp
    const sourcePriority = { internal: 3, composition: 2, mcp: 1 };
    const preferred = duplicates.sort((a, b) => {
      return sourcePriority[b.source] - sourcePriority[a.source];
    })[0];

    this.logger.info('deduplication_started', {
      toolId,
      duplicateCount: duplicates.length,
      preferredSource: preferred.source
    });

    // Deprecate all non-preferred duplicates
    for (const tool of duplicates) {
      if (tool.id !== preferred.id) {
        await this.deprecateTool(
          tool.id,
          `Duplicate of ${preferred.id} (preferred source: ${preferred.source})`
        );
      }
    }
  }

  // 🆕 NEW: Tool config updates
  async updateToolConfig(
    toolId: string,
    config: Partial<ToolConfig>
  ): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    tool.config = { ...tool.config, ...config };
    tool.lastUpdatedAt = new Date().toISOString();

    await this.documentStore.set(this.collection, toolId, tool, true); // merge mode

    this.logger.info('tool_config_updated', {
      toolId,
      updates: Object.keys(config)
    });
  }

  // 🆕 NEW: Tool deprecation
  async deprecateTool(toolId: string, reason: string): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    tool.status = 'deprecated';
    tool.lastUpdatedAt = new Date().toISOString();

    await this.documentStore.set(this.collection, toolId, tool, true);

    this.logger.info('tool_deprecated', { toolId, reason });
  }

  // 🆕 NEW: Tool disabling
  async disableTool(toolId: string): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} not found`);
    }

    tool.status = 'disabled';
    tool.lastUpdatedAt = new Date().toISOString();

    await this.documentStore.set(this.collection, toolId, tool, true);

    this.logger.info('tool_disabled', { toolId });
  }

  // 🆕 NEW: Schema validation
  validateToolSchema(tool: ToolRegistryDocument): ValidationResult {
    const errors: string[] = [];

    if (!tool.id) errors.push('id is required');
    if (!tool.canonicalName) errors.push('canonicalName is required');
    if (!tool.source) errors.push('source is required');
    if (!tool.inputSchema) errors.push('inputSchema is required');

    // Validate source-specific metadata
    if (tool.source === 'mcp' && !tool.sourceMetadata?.mcpServer) {
      errors.push('mcpServer metadata required for MCP tools');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

**Acceptance Criteria**:
- ✅ All CRUD operations working (create, read, update, deprecate, disable)
- ✅ MCP server import pipeline functional
- ✅ Deduplication logic handles multiple sources correctly
- ✅ Schema validation catches invalid tools
- ✅ 15+ unit tests passing

---

#### T2: Create ModelRegistry Module (5 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/types/model-registry-document.ts

export interface ModelTrust {
  scope: string; // 'general', 'coding', 'reasoning', 'tool-use'
  scores: {
    reliability: number;   // 0-100: Produces correct, useful results
    fidelity: number;      // 0-100: Follows instructions and constraints
    integrity: number;     // 0-100: Resists manipulation, respects boundaries
    calibration: number;   // 0-100: Recognizes uncertainty and limitations
  };
  evidence: {
    source: 'benchmark' | 'observed' | 'manual' | 'mixed';
    samples: number;       // Number of observations
    updatedAt: string;     // ISO 8601 timestamp
  };
}

export interface ModelRegistryDocument {
  // Identity
  id: string;                      // e.g., 'gpt-4', 'claude-sonnet-3.5', 'reflex'
  provider: string;                // 'openai', 'anthropic', 'platform'
  displayName: string;             // 'GPT-4 (OpenAI)'
  description: string;

  // Security Profile
  roles: string[];                 // ['model', 'premium', 'vision', 'function-calling']
  tier: string;                    // 'free' | 'basic' | 'premium' | 'enterprise' | 'deterministic' | 'system'
  trust: ModelTrust[];             // Multi-dimensional trust scores per scope

  // Capabilities
  capabilities: {
    toolCalling: boolean;
    vision: boolean;
    streaming: boolean;
    maxContextTokens: number;
    maxOutputTokens: number;
  };

  // Cost
  cost: {
    inputTokenCost: number;        // USD per 1M tokens
    outputTokenCost: number;
  };

  // Tool Access Policy
  toolPolicy: {
    allowedTools: string[];        // Explicit whitelist (if non-empty, ONLY these)
    deniedTools: string[];         // Explicit blacklist
    maxCostPerCall?: number;       // Max $ per single tool call
  };

  // Lifecycle
  status: 'active' | 'deprecated' | 'disabled';
  registeredAt: string;
  lastUsedAt?: string;
}
```

```typescript
// src/apps/tool-orchestrator-service/modules/models/model-registry.ts

import { IDocumentStore } from '../../../common/persistence/interfaces';
import { Logger } from 'pino';
import { ModelRegistryDocument, ModelTrust } from '../../types/model-registry-document';

export interface IModelRegistry {
  // Model retrieval
  getModel(modelId: string): Promise<ModelRegistryDocument | null>;
  queryModels(filters: QueryFilter[]): Promise<ModelRegistryDocument[]>;

  // Model management
  registerModel(model: Partial<ModelRegistryDocument>): Promise<void>;
  updateModel(modelId: string, updates: Partial<ModelRegistryDocument>): Promise<void>;

  // RBAC queries
  getModelPermissions(modelId: string): Promise<ModelPermissions>;
  validateModelToolAccess(modelId: string, toolId: string): Promise<boolean>;
}

export class ModelRegistry implements IModelRegistry {
  constructor(
    private readonly documentStore: IDocumentStore,
    private readonly logger: Logger,
    private readonly collection: string = 'model_registry'
  ) {}

  async getModel(modelId: string): Promise<ModelRegistryDocument | null> {
    return await this.documentStore.get<ModelRegistryDocument>(
      this.collection,
      modelId
    );
  }

  async queryModels(filters: QueryFilter[]): Promise<ModelRegistryDocument[]> {
    return await this.documentStore.query<ModelRegistryDocument>(
      this.collection,
      filters
    );
  }

  async registerModel(model: Partial<ModelRegistryDocument>): Promise<void> {
    // Validate required fields
    if (!model.id) throw new Error('Model ID is required');
    if (!model.provider) throw new Error('Model provider is required');
    if (!model.tier) throw new Error('Model tier is required');

    // Check for duplicates
    const existing = await this.getModel(model.id);
    if (existing) {
      throw new Error(`Model ${model.id} already exists`);
    }

    // Set defaults
    const document: ModelRegistryDocument = {
      ...model as ModelRegistryDocument,
      registeredAt: new Date().toISOString(),
      status: 'active'
    };

    await this.documentStore.set(this.collection, model.id!, document);

    this.logger.info('model_registered', {
      modelId: model.id,
      provider: model.provider,
      tier: model.tier
    });
  }

  async updateModel(
    modelId: string,
    updates: Partial<ModelRegistryDocument>
  ): Promise<void> {
    const model = await this.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const updated = { ...model, ...updates };
    await this.documentStore.set(this.collection, modelId, updated, true);

    this.logger.info('model_updated', { modelId, updates: Object.keys(updates) });
  }

  async getModelPermissions(modelId: string): Promise<ModelPermissions> {
    const model = await this.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    return {
      roles: model.roles,
      tier: model.tier,
      allowedTools: model.toolPolicy.allowedTools,
      deniedTools: model.toolPolicy.deniedTools
    };
  }

  async validateModelToolAccess(
    modelId: string,
    toolId: string
  ): Promise<boolean> {
    const model = await this.getModel(modelId);
    if (!model) return false;

    // Check explicit denials first
    if (model.toolPolicy.deniedTools.includes(toolId)) {
      return false;
    }

    // If allowlist exists and non-empty, check it
    if (model.toolPolicy.allowedTools.length > 0) {
      return model.toolPolicy.allowedTools.includes(toolId);
    }

    // No restrictions = allowed
    return true;
  }
}
```

**Acceptance Criteria**:
- ✅ ModelRegistry implements IModelRegistry interface
- ✅ All CRUD operations working
- ✅ Model permissions queries functional
- ✅ Tool access validation working
- ✅ 10+ unit tests passing

---

#### T3: PostgreSQL Migration 025 (1 day)

**Implementation**:

```sql
-- migrations/025-create-model-registry.sql

-- Create model_registry table
CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL,
  trust JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL,
  cost JSONB NOT NULL,
  tool_policy JSONB NOT NULL DEFAULT '{"allowedTools":[],"deniedTools":[]}',
  status TEXT NOT NULL DEFAULT 'active',
  registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier);
CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry(status);

-- GIN index for JSONB trust scores
CREATE INDEX IF NOT EXISTS idx_model_registry_trust ON model_registry USING GIN (trust);

-- Comments
COMMENT ON TABLE model_registry IS 'Model catalog with security profiles and trust scores (Sprint 63)';
COMMENT ON COLUMN model_registry.trust IS 'Multi-dimensional trust scores per scope (general, tool-use, coding, reasoning)';
COMMENT ON COLUMN model_registry.tier IS 'Security tier: free, basic, premium, enterprise, deterministic, system';
```

**Acceptance Criteria**:
- ✅ Migration creates model_registry table
- ✅ All indexes created
- ✅ Migration is idempotent (can run multiple times)

---

#### T4: Model Seeding Script (2 days)

**Implementation**:

```typescript
// scripts/seed-model-registry.ts

import { ModelRegistry } from '../src/apps/tool-orchestrator-service/modules/models/model-registry';
import { ModelRegistryDocument } from '../src/apps/tool-orchestrator-service/types/model-registry-document';

const MODELS: Partial<ModelRegistryDocument>[] = [
  // Premium LLM Models
  {
    id: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4',
    description: 'OpenAI GPT-4 - Most capable model',
    roles: ['model', 'premium', 'vision', 'function-calling', 'admin-capable'],
    tier: 'premium',
    trust: [
      {
        scope: 'general',
        scores: {
          reliability: 95,
          fidelity: 95,
          integrity: 90,
          calibration: 85
        },
        evidence: {
          source: 'benchmark',
          samples: 10000,
          updatedAt: new Date().toISOString()
        }
      },
      {
        scope: 'tool-use',
        scores: {
          reliability: 95,
          fidelity: 95,
          integrity: 95,
          calibration: 90
        },
        evidence: {
          source: 'mixed',
          samples: 5000,
          updatedAt: new Date().toISOString()
        }
      }
    ],
    capabilities: {
      toolCalling: true,
      vision: true,
      streaming: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096
    },
    cost: {
      inputTokenCost: 0.03, // $0.03 per 1M tokens
      outputTokenCost: 0.06
    },
    toolPolicy: {
      allowedTools: [], // Empty = all tools allowed
      deniedTools: []
    }
  },

  {
    id: 'claude-opus-3.5',
    provider: 'anthropic',
    displayName: 'Claude Opus 3.5',
    description: 'Anthropic Claude Opus - Most capable Anthropic model',
    roles: ['model', 'premium', 'vision', 'function-calling', 'admin-capable'],
    tier: 'premium',
    trust: [
      {
        scope: 'general',
        scores: {
          reliability: 95,
          fidelity: 95,
          integrity: 95,
          calibration: 90
        },
        evidence: {
          source: 'benchmark',
          samples: 8000,
          updatedAt: new Date().toISOString()
        }
      },
      {
        scope: 'tool-use',
        scores: {
          reliability: 95,
          fidelity: 95,
          integrity: 95,
          calibration: 90
        },
        evidence: {
          source: 'mixed',
          samples: 4500,
          updatedAt: new Date().toISOString()
        }
      }
    ],
    capabilities: {
      toolCalling: true,
      vision: true,
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 4096
    },
    cost: {
      inputTokenCost: 0.015,
      outputTokenCost: 0.075
    },
    toolPolicy: {
      allowedTools: [],
      deniedTools: []
    }
  },

  // Basic LLM Models
  {
    id: 'gpt-3.5-turbo',
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo',
    description: 'OpenAI GPT-3.5 - Fast, cost-effective',
    roles: ['model', 'basic', 'function-calling'],
    tier: 'basic',
    trust: [
      {
        scope: 'general',
        scores: {
          reliability: 80,
          fidelity: 80,
          integrity: 75,
          calibration: 70
        },
        evidence: {
          source: 'benchmark',
          samples: 5000,
          updatedAt: new Date().toISOString()
        }
      },
      {
        scope: 'tool-use',
        scores: {
          reliability: 80,
          fidelity: 85,
          integrity: 80,
          calibration: 75
        },
        evidence: {
          source: 'mixed',
          samples: 2500,
          updatedAt: new Date().toISOString()
        }
      }
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: true,
      maxContextTokens: 16385,
      maxOutputTokens: 4096
    },
    cost: {
      inputTokenCost: 0.0005,
      outputTokenCost: 0.0015
    },
    toolPolicy: {
      allowedTools: [],
      deniedTools: ['admin.*', 'tool.delete', 'model.delete'] // Restrict admin tools
    }
  },

  // Deterministic Agent Models (NEW - Sprint 63)
  {
    id: 'reflex',
    provider: 'platform',
    displayName: 'Reflex (Deterministic Agent)',
    description: 'BitBrat reflex service - rule-based deterministic execution',
    roles: ['model', 'deterministic', 'system', 'function-calling'],
    tier: 'deterministic',
    trust: [
      {
        scope: 'tool-use',
        scores: {
          reliability: 100, // Deterministic = 100% reliable
          fidelity: 100,    // Always follows rules exactly
          integrity: 100,   // No manipulation possible
          calibration: 0    // No uncertainty (deterministic)
        },
        evidence: {
          source: 'manual',
          samples: 0, // Not empirical
          updatedAt: new Date().toISOString()
        }
      }
    ],
    capabilities: {
      toolCalling: true,
      vision: false,
      streaming: false,
      maxContextTokens: 0, // No LLM context
      maxOutputTokens: 0
    },
    cost: {
      inputTokenCost: 0,
      outputTokenCost: 0
    },
    toolPolicy: {
      allowedTools: [], // All tools allowed (agent controls via RBAC)
      deniedTools: []
    }
  },

  // Add more models: claude-sonnet-3.5, gpt-4-turbo, ollama/llama, etc.
];

export async function seedModelRegistry(registry: ModelRegistry): Promise<void> {
  console.log('Starting model registry seeding...');

  let registered = 0;
  let skipped = 0;

  for (const model of MODELS) {
    try {
      await registry.registerModel(model);
      console.log(`✅ Registered: ${model.id} (${model.tier})`);
      registered++;
    } catch (err) {
      console.warn(`⚠️  Skipped: ${model.id} (${err.message})`);
      skipped++;
    }
  }

  console.log(`\nSeeding complete: ${registered} registered, ${skipped} skipped`);
}
```

**Acceptance Criteria**:
- ✅ Seed script registers 10+ models
- ✅ Includes LLM models (gpt-4, claude, gpt-3.5-turbo)
- ✅ Includes agent models (reflex)
- ✅ Trust scores properly configured
- ✅ Idempotent (can run multiple times)

---

#### T5: MCP Tools for Tool/Model Management (3 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service.ts

export class ToolOrchestratorServer extends Bit {
  async setup(): Promise<void> {
    // ... existing setup

    // 🆕 NEW: Tool management MCP tools
    this.registerTool(
      'tool.import',
      'Import tool from external source',
      z.object({
        source: z.enum(['mcp-server', 'bit', 'composition']),
        serverId: z.string().optional(),
        toolId: z.string()
      }),
      async (args) => {
        if (!this.toolRegistry) {
          throw new Error('ToolRegistry not initialized');
        }

        if (args.source === 'mcp-server') {
          // TODO: Get MCP server tools and import
          await this.toolRegistry.importFromMcpServer(args.serverId!, []);
        }

        return { success: true, toolId: args.toolId };
      }
    );

    this.registerTool(
      'tool.update_config',
      'Update tool configuration',
      z.object({
        toolId: z.string(),
        config: z.object({
          timeoutMs: z.number().optional(),
          maxRetryAttempts: z.number().optional(),
          costTier: z.enum(['free', 'standard', 'premium', 'enterprise']).optional()
        })
      }),
      async (args) => {
        await this.toolRegistry!.updateToolConfig(args.toolId, args.config);
        return { success: true };
      }
    );

    // 🆕 NEW: Model management MCP tools
    this.registerTool(
      'model.register',
      'Register new model in catalog',
      z.object({
        id: z.string(),
        provider: z.string(),
        displayName: z.string(),
        tier: z.enum(['free', 'basic', 'premium', 'enterprise', 'deterministic', 'system']),
        roles: z.array(z.string()),
        capabilities: z.object({
          toolCalling: z.boolean(),
          vision: z.boolean()
        })
      }),
      async (args) => {
        await this.modelRegistry!.registerModel(args as any);
        return { success: true, modelId: args.id };
      }
    );

    this.registerTool(
      'model.get',
      'Get model details',
      z.object({
        modelId: z.string()
      }),
      async (args) => {
        const model = await this.modelRegistry!.getModel(args.modelId);
        if (!model) {
          throw new Error(`Model ${args.modelId} not found`);
        }
        return model;
      }
    );
  }
}
```

**Acceptance Criteria**:
- ✅ tool.import working
- ✅ tool.update_config working
- ✅ model.register working
- ✅ model.get working
- ✅ All MCP tools have proper schemas

---

### Sprint 63 Summary

**Duration**: 2-3 weeks (10-15 working days)

**Task Breakdown**:
1. T1: Complete ToolRegistry Module (5 days)
2. T2: Create ModelRegistry Module (5 days)
3. T3: PostgreSQL Migration 025 (1 day)
4. T4: Model Seeding Script (2 days)
5. T5: MCP Tools (3 days)

**Total**: 16 days (3 weeks with overlap)

**Acceptance Criteria**:
- ✅ ToolRegistry implements full IToolRegistry interface
- ✅ ModelRegistry implements full IModelRegistry interface
- ✅ PostgreSQL migration 025 complete
- ✅ 10+ models seeded (LLM + agent models)
- ✅ 4 new MCP tools working (tool.import, tool.update_config, model.register, model.get)
- ✅ 25+ unit tests passing
- ✅ Integration test: Deploy to agent-dev, verify tool/model CRUD

**Bootstrap for Sprint 64**:
- ToolRegistry and ModelRegistry are now fully functional
- 10+ models available for RBAC testing
- Can now implement dual-layer RBAC validation
- Entry point: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (new file)

---

## Sprint 64: Model-Based RBAC

**Duration**: 2-3 weeks
**Goal**: Implement dual-layer RBAC (User × Model) validation
**Prerequisites**: Sprint 63 complete (ToolRegistry + ModelRegistry functional)

### Bootstrap Information

**Entry Point**: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (new file)

**Current State**:
- ToolExecutionContext uses `agentName?: string` (deprecated pattern)
- No `modelId` field in ToolExecutionContext
- No dual-layer RBAC validation
- llm-bot doesn't pass model ID in context

**Goal**: Replace agent-based RBAC with model-based RBAC (User × Model)

**Key Files to Create/Modify**:
1. `src/types/tools.ts` (modify ToolExecutionContext interface) - **BREAKING CHANGE**
2. `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (new file, ~300 lines)
3. `src/apps/llm-bot-service.ts` (modify to pass modelId)
4. `src/apps/reflex-service.ts` (modify to pass modelId='reflex')
5. `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (new file, ~800 lines)

### Deliverables

1. **Updated ToolExecutionContext** - Add `modelId` (required), remove `agentName` (breaking change)
2. **RbacValidator Module** - Dual-layer validation logic (User × Model)
3. **ToolGateway Module** - Tool execution orchestration with RBAC enforcement
4. **Updated llm-bot** - Passes LLM modelId (gpt-4, claude, etc.)
5. **Updated reflex** - Passes agent modelId ('reflex')
6. **Model Tier Enforcement** - Premium tools restricted to premium models
7. **Trust Score Validation** - Tools require minimum trust scores
8. **RBAC Test Suite** - 20+ test scenarios

### Tasks

#### T1: Extend ToolExecutionContext (1 day)

**Implementation**:

```typescript
// src/types/tools.ts

// BEFORE (Sprint 62 and earlier):
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string; // ❌ DEPRECATED - agent is orchestrator, not decision-maker
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}

// AFTER (Sprint 64):
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string; // 🆕 REQUIRED - the LLM model making tool decisions
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // agentName removed (breaking change)
}
```

**Migration Impact**:
- All tool-invoking services must update simultaneously
- llm-bot: Pass LLM model ID (e.g., 'gpt-4', 'claude-opus-3.5')
- reflex: Pass agent model ID ('reflex')
- Any other services using tools must update

**Acceptance Criteria**:
- ✅ ToolExecutionContext has `modelId: string` (required)
- ✅ `agentName` removed from interface
- ✅ TypeScript compilation succeeds

---

#### T2: Implement ToolGateway Module (5 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts

import { IToolRegistry } from '../registry/tool-registry';
import { IModelRegistry } from '../models/model-registry';
import { RbacValidator } from './rbac-validator';
import { ToolExecutionContext, ToolResult } from '../../../types/tools';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { Logger } from 'pino';

export interface IToolGateway {
  // Tool execution
  execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  // RBAC validation
  validateToolAccess(
    toolId: string,
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<RBACValidationResult>;

  // Tool discovery
  listAvailableTools(
    modelId: string,
    userRoles: string[]
  ): Promise<ToolRegistryDocument[]>;
}

export class ToolGateway implements IToolGateway {
  private rbacValidator: RbacValidator;
  private toolCache: Map<string, ToolRegistryDocument>;
  private modelCache: Map<string, ModelRegistryDocument>;

  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly modelRegistry: IModelRegistry,
    private readonly logger: Logger
  ) {
    this.rbacValidator = new RbacValidator(toolRegistry, modelRegistry);
    this.toolCache = new Map();
    this.modelCache = new Map();

    // Cache invalidation every 5 minutes
    setInterval(() => {
      this.toolCache.clear();
      this.modelCache.clear();
      this.logger.debug('cache_cleared', { type: 'tool_and_model' });
    }, 5 * 60 * 1000);
  }

  async execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 1. Get tool from registry (with caching)
      const tool = await this.getCachedTool(toolId);
      if (!tool) {
        throw new Error(`Tool ${toolId} not found`);
      }

      // 2. Validate RBAC (dual-layer: User × Model)
      const rbacResult = await this.rbacValidator.validateToolAccess(
        toolId,
        context.userRoles,
        context.modelId
      );

      if (!rbacResult.allowed) {
        // Log RBAC denial
        await this.logToolInvocation({
          toolId,
          modelId: context.modelId,
          userId: context.userId,
          status: 'denied',
          durationMs: Date.now() - startTime,
          rbacReason: rbacResult.reason,
          rbacDetails: rbacResult.details
        });

        throw new Error(`Access denied: ${rbacResult.details || rbacResult.reason}`);
      }

      // 3. Route to appropriate execution handler
      let result: ToolResult;
      if (tool.source === 'mcp') {
        result = await this.executeMcpTool(tool, args, context);
      } else if (tool.source === 'internal') {
        result = await this.executeInternalTool(tool, args, context);
      } else if (tool.source === 'composition') {
        result = await this.executeComposition(tool, args, context);
      } else {
        throw new Error(`Unknown tool source: ${tool.source}`);
      }

      // 4. Log successful execution
      await this.logToolInvocation({
        toolId,
        modelId: context.modelId,
        userId: context.userId,
        status: 'success',
        durationMs: Date.now() - startTime
      });

      return result;
    } catch (err) {
      // Log error
      await this.logToolInvocation({
        toolId,
        modelId: context.modelId,
        userId: context.userId,
        status: 'error',
        durationMs: Date.now() - startTime,
        errorMessage: err instanceof Error ? err.message : String(err)
      });

      throw err;
    }
  }

  async validateToolAccess(
    toolId: string,
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<RBACValidationResult> {
    return await this.rbacValidator.validateToolAccess(
      toolId,
      userRoles,
      modelId
    );
  }

  async listAvailableTools(
    modelId: string,
    userRoles: string[]
  ): Promise<ToolRegistryDocument[]> {
    // Get all tools
    const allTools = await this.toolRegistry.queryTools([]);

    // Filter by RBAC
    const availableTools: ToolRegistryDocument[] = [];
    for (const tool of allTools) {
      const access = await this.rbacValidator.validateToolAccess(
        tool.id,
        userRoles,
        modelId
      );

      if (access.allowed) {
        availableTools.push(tool);
      }
    }

    return availableTools;
  }

  private async getCachedTool(toolId: string): Promise<ToolRegistryDocument | null> {
    // Check cache first
    if (this.toolCache.has(toolId)) {
      return this.toolCache.get(toolId)!;
    }

    // Cache miss - load from registry
    const tool = await this.toolRegistry.getTool(toolId);
    if (tool) {
      this.toolCache.set(toolId, tool);
    }

    return tool;
  }

  private async getCachedModel(modelId: string): Promise<ModelRegistryDocument | null> {
    // Check cache first
    if (this.modelCache.has(modelId)) {
      return this.modelCache.get(modelId)!;
    }

    // Cache miss - load from registry
    const model = await this.modelRegistry.getModel(modelId);
    if (model) {
      this.modelCache.set(modelId, model);
    }

    return model;
  }

  private async executeMcpTool(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Placeholder for Sprint 65
    throw new Error('MCP tool execution not yet implemented - Sprint 65');
  }

  private async executeInternalTool(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Placeholder for Sprint 65
    throw new Error('Internal tool execution not yet implemented - Sprint 65');
  }

  private async executeComposition(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    // Placeholder for Sprint 65
    throw new Error('Composition execution not yet implemented - Sprint 65');
  }

  private async logToolInvocation(event: {
    toolId: string;
    modelId: string;
    userId?: string;
    status: 'success' | 'error' | 'denied';
    durationMs: number;
    rbacReason?: string;
    rbacDetails?: string;
    errorMessage?: string;
  }): Promise<void> {
    // Placeholder for Sprint 66 (ToolObserver)
    this.logger.info({
      service: 'tool-orchestrator',
      level: event.status === 'error' ? 'error' : 'info',
      eventType: 'tool.invocation',
      ...event
    });
  }
}
```

**Acceptance Criteria**:
- ✅ ToolGateway implements IToolGateway interface
- ✅ RBAC validation enforced on all execution paths
- ✅ LRU cache for tool/model metadata (5min TTL)
- ✅ Logging placeholders for Sprint 66
- ✅ Execution placeholders for Sprint 65

---

#### T3: Implement Dual-Layer RBAC Validator (4 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts

import { IToolRegistry } from '../registry/tool-registry';
import { IModelRegistry } from '../models/model-registry';
import { ToolRegistryDocument } from '../../types/tool-registry-document';
import { ModelRegistryDocument } from '../../types/model-registry-document';

export interface RBACValidationResult {
  allowed: boolean;
  reason?: string;
  details?: string;
}

export class RbacValidator {
  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly modelRegistry: IModelRegistry
  ) {}

  async validateToolAccess(
    toolId: string,
    userRoles: string[],
    modelId: string
  ): Promise<RBACValidationResult> {
    // 1. Get tool and model
    const tool = await this.toolRegistry.getTool(toolId);
    if (!tool) {
      return { allowed: false, reason: 'tool_not_found' };
    }

    const model = await this.modelRegistry.getModel(modelId);
    if (!model) {
      return { allowed: false, reason: 'model_not_found' };
    }

    const rbac = tool.rbac;

    // 2. Check user required roles
    const userHasRequiredRoles = rbac.userRoles.required.every(role =>
      userRoles.includes(role)
    );
    if (!userHasRequiredRoles) {
      return {
        allowed: false,
        reason: 'user_missing_required_roles',
        details: `User requires roles: ${rbac.userRoles.required.join(', ')}`
      };
    }

    // 3. Check user denied roles
    const userHasDeniedRole = rbac.userRoles.denied.some(role =>
      userRoles.includes(role)
    );
    if (userHasDeniedRole) {
      return {
        allowed: false,
        reason: 'user_has_denied_role',
        details: 'User has a role that is explicitly denied for this tool'
      };
    }

    // 4. Check model required roles
    const modelHasRequiredRoles = rbac.modelRoles.required.every(role =>
      model.roles.includes(role)
    );
    if (!modelHasRequiredRoles) {
      return {
        allowed: false,
        reason: 'model_missing_required_roles',
        details: `Model ${modelId} lacks required roles: ${rbac.modelRoles.required.join(', ')}`
      };
    }

    // 5. Check model denied roles
    const modelHasDeniedRole = rbac.modelRoles.denied.some(role =>
      model.roles.includes(role)
    );
    if (modelHasDeniedRole) {
      return {
        allowed: false,
        reason: 'model_has_denied_role',
        details: `Model ${modelId} is explicitly denied for this tool`
      };
    }

    // 6. Check model tier restrictions
    if (rbac.modelTiers.allowed.length > 0) {
      if (!rbac.modelTiers.allowed.includes(model.tier)) {
        return {
          allowed: false,
          reason: 'model_tier_not_allowed',
          details: `Tool requires model tier: ${rbac.modelTiers.allowed.join(' or ')}, but ${modelId} is tier ${model.tier}`
        };
      }
    }

    if (rbac.modelTiers.denied.includes(model.tier)) {
      return {
        allowed: false,
        reason: 'model_tier_denied',
        details: `Tool explicitly denies model tier: ${model.tier}`
      };
    }

    // 7. Check model's tool policy (allowlist/denylist)
    if (model.toolPolicy.deniedTools.includes(toolId)) {
      return {
        allowed: false,
        reason: 'model_policy_denies_tool',
        details: `Model ${modelId} policy denies tool ${toolId}`
      };
    }

    if (model.toolPolicy.allowedTools.length > 0) {
      if (!model.toolPolicy.allowedTools.includes(toolId)) {
        return {
          allowed: false,
          reason: 'model_policy_allows_only_specific_tools',
          details: `Model ${modelId} only allows specific tools, ${toolId} not included`
        };
      }
    }

    // 8. Check model trust thresholds (if tool requires minimum trust)
    if (rbac.minTrustThresholds) {
      const scope = rbac.minTrustThresholds.scope || 'tool-use';
      const modelTrust = model.trust.find(t => t.scope === scope);

      if (!modelTrust) {
        return {
          allowed: false,
          reason: 'model_trust_scope_not_found',
          details: `Model ${modelId} has no trust profile for scope: ${scope}`
        };
      }

      // Check each trust dimension threshold
      const thresholds = rbac.minTrustThresholds;
      for (const [dimension, minScore] of Object.entries(thresholds)) {
        if (dimension === 'scope') continue; // Skip scope field

        const actualScore = modelTrust.scores[dimension as keyof typeof modelTrust.scores];
        if (actualScore < minScore) {
          return {
            allowed: false,
            reason: 'model_trust_insufficient',
            details: `Tool requires ${dimension} >= ${minScore}, but ${modelId} has ${actualScore} (scope: ${scope})`
          };
        }
      }
    }

    // 9. All checks passed
    return { allowed: true };
  }
}
```

**Acceptance Criteria**:
- ✅ Validates user required/denied roles
- ✅ Validates model required/denied roles
- ✅ Validates model tier restrictions
- ✅ Validates model tool policy (allowlist/denylist)
- ✅ Validates model trust score thresholds
- ✅ Clear error messages with details
- ✅ 20+ unit test scenarios

---

#### T4: Update llm-bot to Pass modelId (3 days)

**Implementation**:

```typescript
// src/apps/llm-bot-service.ts

export class LlmBotServer extends Bit {
  private currentModel: string = 'gpt-4.1-mini'; // Default model

  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.analysis.v1',
      async (event, attrs, ctx) => {
        // Extract model from event or use default
        const modelId = this.selectModel(event);

        // Create tool execution context with modelId
        const toolContext: ToolExecutionContext = {
          userRoles: event.identity?.user?.roles || [],
          userId: event.identity?.user?.id,
          modelId, // 🆕 NEW: Pass LLM model ID
          correlationId: event.correlationId,
          sessionId: event.sessionId
        };

        // Execute tools with model context
        const result = await this.executeLlmWithTools(
          event.message?.text || '',
          toolContext
        );

        event.candidates = [{ text: result }];
        await this.next(event);
        await ctx.ack();
      }
    );
  }

  private selectModel(event: InternalEventV2): string {
    // Check for explicit model selection in annotations
    const modelAnnotation = event.annotations.find(
      a => a.kind === 'model_selection'
    );

    if (modelAnnotation?.value?.modelId) {
      return modelAnnotation.value.modelId;
    }

    // Check user preferences
    if (event.identity?.user?.preferences?.preferredModel) {
      return event.identity.user.preferences.preferredModel;
    }

    // Default model
    return this.currentModel;
  }

  private async executeLlmWithTools(
    prompt: string,
    context: ToolExecutionContext
  ): Promise<string> {
    // LLM inference with tool calling
    // Context now includes modelId for RBAC validation
    // ...
  }
}
```

**Acceptance Criteria**:
- ✅ llm-bot passes LLM modelId (gpt-4, claude, etc.)
- ✅ Model selection logic functional
- ✅ All tool invocations include modelId
- ✅ Integration test: Send message, verify modelId propagates

---

#### T5: Update reflex to Pass modelId (2 days)

**Implementation**:

```typescript
// src/apps/reflex-service.ts

export class ReflexServer extends Bit {
  async setup(): Promise<void> {
    await this.onMessage<InternalEventV2>(
      'internal.reaction.v1',
      async (event, attrs, ctx) => {
        // Execute deterministic rules
        const actions = await this.evaluateRules(event);

        for (const action of actions) {
          if (action.type === 'tool_execution') {
            // Create tool execution context with reflex model ID
            const toolContext: ToolExecutionContext = {
              userRoles: event.identity?.user?.roles || [],
              userId: event.identity?.user?.id,
              modelId: 'reflex', // 🆕 NEW: reflex is a registered model
              correlationId: event.correlationId,
              sessionId: event.sessionId
            };

            // Execute tool via tool-orchestrator
            await this.executeTool(action.toolId, action.args, toolContext);
          }
        }

        await this.next(event);
        await ctx.ack();
      }
    );
  }
}
```

**Acceptance Criteria**:
- ✅ reflex passes modelId='reflex'
- ✅ reflex registered as deterministic model (Sprint 63)
- ✅ All tool invocations include modelId
- ✅ RBAC validation works for reflex model

---

### Sprint 64 Summary

**Duration**: 2-3 weeks (10-15 working days)

**Task Breakdown**:
1. T1: Extend ToolExecutionContext (1 day)
2. T2: Implement ToolGateway Module (5 days)
3. T3: Implement Dual-Layer RBAC Validator (4 days)
4. T4: Update llm-bot (3 days)
5. T5: Update reflex (2 days)

**Total**: 15 days (3 weeks)

**Acceptance Criteria**:
- ✅ ToolExecutionContext has `modelId` (required), `agentName` removed
- ✅ ToolGateway implements IToolGateway interface
- ✅ RbacValidator validates dual-layer (User × Model)
- ✅ Model tier enforcement working
- ✅ Trust score validation working
- ✅ llm-bot passes LLM modelId
- ✅ reflex passes agent modelId ('reflex')
- ✅ 20+ RBAC test scenarios passing

**Bootstrap for Sprint 65**:
- ToolGateway module exists with RBAC enforcement
- Execution methods are placeholders (throw errors)
- Can now implement actual tool execution logic
- Entry point: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts:executeMcpTool()` (replace placeholder)

---

## Sprint 65: Tool Execution Migration

**Duration**: 3-4 weeks
**Goal**: Migrate actual tool execution logic from tool-gateway
**Prerequisites**: Sprint 64 complete (ToolGateway + RBAC functional)

### Bootstrap Information

**Entry Point**: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (replace execution placeholders)

**Current State**:
- ToolGateway exists with RBAC enforcement
- All execution methods throw errors (placeholders from Sprint 64)
- tool-gateway.ts has working MCP/internal/composition execution (~500+ lines)
- Need to migrate execution logic to tool-orchestrator

**Goal**: Replace all execution placeholders with actual working implementations

**Key Files to Modify**:
1. `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts` (replace 3 placeholder methods)
2. `src/apps/tool-orchestrator-service/modules/gateway/mcp-client-manager.ts` (migrate from tool-gateway)
3. `src/apps/tool-orchestrator-service/modules/gateway/internal-tool-handler.ts` (new file)
4. `src/apps/tool-orchestrator-service/modules/gateway/composition-executor.ts` (migrate from tool-gateway)

### Deliverables

1. **MCP Tool Execution** - Execute tools on external MCP servers
2. **Internal Tool Execution** - Execute BitBrat platform tools
3. **Composition Execution** - Execute multi-step compositions
4. **McpClientManager Integration** - Migrate MCP client lifecycle management
5. **Event Logging** - Structured logging to Loki for all executions
6. **Error Handling** - Timeout enforcement, retry logic, graceful failures
7. **Progress Updates** - Integration with feedback middleware
8. **Comprehensive Tests** - 30+ tests covering all execution paths

### Tasks

#### T1: Migrate McpClientManager (2 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/mcp-client-manager.ts
// (Migrated from src/common/mcp/client-manager.ts)

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface McpServerConfig {
  name: string;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map();

  async getClient(serverName: string): Promise<Client> {
    // Check cache
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    // Load server config from ToolRegistry
    const tool = await this.toolRegistry.queryTools([
      { field: 'sourceMetadata.mcpServer.name', op: '==', value: serverName }
    ]);

    if (tool.length === 0) {
      throw new Error(`MCP server ${serverName} not found in registry`);
    }

    const serverConfig = tool[0].sourceMetadata?.mcpServer;
    if (!serverConfig) {
      throw new Error(`No MCP server config for ${serverName}`);
    }

    // Create client
    const client = new Client(
      { name: 'tool-orchestrator', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect based on transport
    if (serverConfig.transport === 'http') {
      const transport = new StreamableHTTPClientTransport(
        new URL(serverConfig.connectionConfig.url!)
      );
      await client.connect(transport);
    } else {
      // stdio transport (if needed)
      throw new Error('stdio transport not yet implemented');
    }

    // Cache client
    this.clients.set(serverName, client);

    return client;
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close();
      } catch (err) {
        this.logger.warn('mcp_client_disconnect_failed', {
          serverName: name,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    this.clients.clear();
  }
}
```

**Acceptance Criteria**:
- ✅ McpClientManager migrated from tool-gateway
- ✅ HTTP transport working
- ✅ Client caching functional
- ✅ Graceful disconnect on shutdown

---

#### T2: Implement MCP Tool Execution (5 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts

private mcpClientManager: McpClientManager;

constructor(...) {
  // ...
  this.mcpClientManager = new McpClientManager(this.toolRegistry, this.logger);
}

private async executeMcpTool(
  tool: ToolRegistryDocument,
  args: unknown,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const serverName = tool.sourceMetadata?.mcpServer?.name;
  if (!serverName) {
    throw new Error(`Tool ${tool.id} has no MCP server metadata`);
  }

  // 1. Get MCP client
  const client = await this.mcpClientManager.getClient(serverName);

  // 2. Create timeout controller
  const timeoutMs = tool.config.timeoutMs || 30000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 3. Call MCP tool
    const result = await client.callTool(
      {
        name: tool.canonicalName,
        arguments: args
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    // 4. Transform MCP result to ToolResult
    return {
      isError: false,
      content: result.content || []
    };
  } catch (err) {
    clearTimeout(timeout);

    if (err.name === 'AbortError') {
      throw new Error(`Tool ${tool.id} timed out after ${timeoutMs}ms`);
    }

    throw err;
  }
}
```

**Acceptance Criteria**:
- ✅ MCP tools execute successfully
- ✅ Timeout enforcement working
- ✅ Error messages clear
- ✅ 10+ tests passing

---

#### T3: Implement Internal Tool Execution (3 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/internal-tool-handler.ts

export class InternalToolHandler {
  private handlers: Map<string, Function> = new Map();

  registerTool(toolId: string, handler: Function): void {
    this.handlers.set(toolId, handler);
  }

  async execute(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const handler = this.handlers.get(tool.id);
    if (!handler) {
      throw new Error(`No handler registered for internal tool ${tool.id}`);
    }

    const result = await handler(args, context);
    return result;
  }
}

// In ToolGateway:
private internalToolHandler: InternalToolHandler;

constructor(...) {
  this.internalToolHandler = new InternalToolHandler();

  // Register built-in tools
  this.internalToolHandler.registerTool(
    'agent.sendProgressUpdate',
    async (args: any, ctx: ToolExecutionContext) => {
      // Progress update logic
      return { isError: false, content: [{ type: 'text', text: 'Progress sent' }] };
    }
  );
}

private async executeInternalTool(
  tool: ToolRegistryDocument,
  args: unknown,
  context: ToolExecutionContext
): Promise<ToolResult> {
  return await this.internalToolHandler.execute(tool, args, context);
}
```

**Acceptance Criteria**:
- ✅ Internal tools execute successfully
- ✅ Progress updates working
- ✅ 5+ tests passing

---

#### T4: Implement Composition Execution (4 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/gateway/composition-executor.ts
// (Migrated from tool-gateway composition logic)

export class CompositionExecutor {
  async execute(
    tool: ToolRegistryDocument,
    args: unknown,
    context: ToolExecutionContext,
    toolGateway: IToolGateway // For recursive tool execution
  ): Promise<ToolResult> {
    // 1. Load composition definition
    const compositionId = tool.sourceMetadata?.composition?.compositionId;
    if (!compositionId) {
      throw new Error(`Tool ${tool.id} has no composition metadata`);
    }

    const composition = await this.loadComposition(compositionId);

    // 2. Execute steps sequentially
    let state: Record<string, any> = { input: args };

    for (const step of composition.steps) {
      // 3. Validate RBAC for each constituent tool
      const access = await toolGateway.validateToolAccess(
        step.toolId,
        context.userId || '',
        context.modelId,
        context.userRoles
      );

      if (!access.allowed) {
        throw new Error(
          `RBAC denied for composition step ${step.name}: ${access.reason}`
        );
      }

      // 4. Execute step (recursive call to ToolGateway.execute)
      const stepResult = await toolGateway.execute(
        step.toolId,
        this.resolveStepArgs(step.args, state),
        context
      );

      // 5. Update state
      state[step.name] = stepResult;
    }

    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(state) }]
    };
  }

  private resolveStepArgs(
    argsTemplate: any,
    state: Record<string, any>
  ): any {
    // Resolve variable references like ${step1.result}
    // ...
  }
}

// In ToolGateway:
private compositionExecutor: CompositionExecutor;

constructor(...) {
  this.compositionExecutor = new CompositionExecutor();
}

private async executeComposition(
  tool: ToolRegistryDocument,
  args: unknown,
  context: ToolExecutionContext
): Promise<ToolResult> {
  return await this.compositionExecutor.execute(tool, args, context, this);
}
```

**Acceptance Criteria**:
- ✅ Compositions execute successfully
- ✅ Per-step RBAC validation
- ✅ Variable resolution working
- ✅ 8+ tests passing

---

### Sprint 65 Summary

**Duration**: 3-4 weeks (15-20 working days)

**Task Breakdown**:
1. T1: Migrate McpClientManager (2 days)
2. T2: Implement MCP Tool Execution (5 days)
3. T3: Implement Internal Tool Execution (3 days)
4. T4: Implement Composition Execution (4 days)
5. T5: Event Logging Integration (2 days)
6. T6: Error Handling & Recovery (2 days)
7. T7: Integration with Feedback Middleware (1 day)
8. T8: Comprehensive Testing (3 days)

**Total**: 22 days (4 weeks)

**Acceptance Criteria**:
- ✅ All execution types working (MCP, internal, composition)
- ✅ McpClientManager migrated and functional
- ✅ Timeout enforcement working
- ✅ Error handling graceful
- ✅ RBAC enforced on all paths
- ✅ 30+ tests passing
- ✅ Integration test: Deploy to agent-dev, execute all tool types

**Bootstrap for Sprint 66**:
- All tool execution working
- Event logging placeholders in place
- Can now implement ToolObserver module for Loki integration
- Entry point: `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts` (new file)

---

## Sprint 66: Observability (ToolObserver + Loki Integration)

**Duration**: 2 weeks
**Goal**: Implement ToolObserver module for Loki-based metrics and tracing
**Prerequisites**: Sprint 65 complete (Tool execution working)

### Bootstrap Information

**Entry Point**: `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts` (new file)

**Current State**:
- ToolGateway logs events via placeholders (Sprint 64-65)
- Loki and Promtail already deployed and operational
- No metrics queries or aggregation
- No Grafana dashboards

**Goal**: Replace logging placeholders with structured Loki events, implement metrics queries

**Key Files to Create**:
1. `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts` (new file, ~400 lines)
2. `src/apps/tool-orchestrator-service/modules/observer/loki-client.ts` (new file, ~200 lines)
3. `grafana/dashboards/tool-orchestrator-*.json` (4 new dashboards)

### Deliverables

1. **ToolObserver Module** - Loki integration for metrics queries
2. **Structured Event Logging** - tool.invocation events with labels
3. **Loki Label Configuration** - service, toolId, modelId, status, correlationId
4. **Metrics MCP Tools** - tool.get_metrics, model.get_metrics, tool.trace_request
5. **Grafana Dashboards** - 4 dashboards (Invocation Rate, Error Rate, RBAC Denials, Cost Tracking)
6. **Health Tracking** - Tool registry updated from Loki queries
7. **Correlation Tracing** - End-to-end request tracing by correlationId

### Tasks

#### T1: Implement ToolObserver Module (4 days)

**Implementation**:

```typescript
// src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts

import { LokiClient } from './loki-client';
import { Logger } from 'pino';

export interface ToolMetrics {
  toolId: string;
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  deniedCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  lastInvocationAt: string;
}

export interface IToolObserver {
  // Metrics queries
  queryToolMetrics(toolId: string, timeRange: TimeRange): Promise<ToolMetrics>;
  queryModelMetrics(modelId: string, timeRange: TimeRange): Promise<ModelMetrics>;

  // Trace queries
  traceToolInvocation(correlationId: string): Promise<InvocationEvent[]>;

  // Health monitoring
  getToolHealth(toolId: string): Promise<ToolHealthStatus>;
}

export class ToolObserver implements IToolObserver {
  private lokiClient: LokiClient;

  constructor(
    private readonly logger: Logger,
    lokiUrl: string
  ) {
    this.lokiClient = new LokiClient(lokiUrl, logger);
  }

  async queryToolMetrics(
    toolId: string,
    timeRange: TimeRange
  ): Promise<ToolMetrics> {
    // LogQL query for tool metrics
    const query = `
      {service="tool-orchestrator", eventType="tool.invocation", toolId="${toolId}"}
    `;

    const events = await this.lokiClient.query(query, timeRange);

    // Aggregate metrics
    const total = events.length;
    const success = events.filter(e => e.status === 'success').length;
    const error = events.filter(e => e.status === 'error').length;
    const denied = events.filter(e => e.status === 'denied').length;

    const durations = events
      .filter(e => e.durationMs !== undefined)
      .map(e => e.durationMs)
      .sort((a, b) => a - b);

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p95Duration = durations[Math.floor(durations.length * 0.95)];
    const p99Duration = durations[Math.floor(durations.length * 0.99)];

    return {
      toolId,
      totalInvocations: total,
      successCount: success,
      errorCount: error,
      deniedCount: denied,
      avgDurationMs: avgDuration,
      p95DurationMs: p95Duration,
      p99DurationMs: p99Duration,
      lastInvocationAt: events[events.length - 1]?.timestamp || ''
    };
  }

  async getToolHealth(toolId: string): Promise<ToolHealthStatus> {
    // Query last 100 invocations
    const metrics = await this.queryToolMetrics(toolId, {
      start: Date.now() - 3600000, // Last hour
      end: Date.now()
    });

    const errorRate = metrics.errorCount / metrics.totalInvocations;

    if (errorRate > 0.5) {
      return {
        status: 'unhealthy',
        reason: `Error rate ${(errorRate * 100).toFixed(1)}% (threshold: 50%)`
      };
    } else if (errorRate > 0.2) {
      return {
        status: 'degraded',
        reason: `Error rate ${(errorRate * 100).toFixed(1)}% (threshold: 20%)`
      };
    } else {
      return {
        status: 'healthy',
        reason: `Error rate ${(errorRate * 100).toFixed(1)}%`
      };
    }
  }

  async traceToolInvocation(correlationId: string): Promise<InvocationEvent[]> {
    // Query all events with this correlationId
    const query = `
      {service="tool-orchestrator", correlationId="${correlationId}"}
    `;

    return await this.lokiClient.query(query, {
      start: Date.now() - 86400000, // Last 24 hours
      end: Date.now()
    });
  }
}
```

**Acceptance Criteria**:
- ✅ ToolObserver implements IToolObserver interface
- ✅ Metrics aggregation functional (count, avg, p95, p99)
- ✅ Health derivation working
- ✅ Correlation tracing working
- ✅ 10+ unit tests passing

---

### Sprint 66 Summary

**Duration**: 2 weeks (10 working days)

**Acceptance Criteria**:
- ✅ ToolObserver successfully queries Loki
- ✅ All tool invocations logged with structured events
- ✅ 4 Grafana dashboards rendering
- ✅ Correlation tracing working
- ✅ Tool health derived from Loki
- ✅ Integration test: 100 invocations → 100+ events in Loki

**Bootstrap for Sprint 67**:
- All observability working
- Can now implement composition RBAC with full metrics
- Entry point: Composition RBAC validation (register + runtime)

---

## Sprint 67: Composition RBAC + Validation + Cutover

**Duration**: 2-3 weeks
**Goal**: Complete composition RBAC, validation, and production cutover
**Prerequisites**: Sprint 66 complete

### Deliverables

1. **Composition Registration RBAC** - Validate model permissions at registration
2. **Composition Runtime RBAC** - Re-validate at execution
3. **RBAC Inheritance Logic** - Compositions inherit most restrictive RBAC
4. **End-to-End Validation** - 5 integration scenarios
5. **Load Testing** - 1000 invocations, P95 < 100ms
6. **Migration Script** - tool-gateway → tool-orchestrator
7. **Production Cutover** - Zero-downtime migration
8. **Documentation** - Implementation guide, API reference, runbook
9. **tool-gateway Removal** - Deprecated and removed

### Sprint 67 Summary

**Duration**: 2-3 weeks

**Acceptance Criteria**:
- ✅ Composition RBAC complete (registration + runtime)
- ✅ All integration tests pass
- ✅ Load test: 1000 invocations, P95 < 100ms
- ✅ Migration script validated
- ✅ Production cutover successful
- ✅ tool-gateway removed
- ✅ All documentation complete

---

## Total Timeline Summary

| Sprint | Focus | Duration | Cumulative |
|--------|-------|----------|------------|
| **62** | MCP Aggregation | 2-3 weeks | ✅ Complete |
| **63** | Foundation (ToolRegistry + ModelRegistry) | 2-3 weeks | 2-3 weeks |
| **64** | Model-Based RBAC | 2-3 weeks | 4-6 weeks |
| **65** | Tool Execution Migration | 3-4 weeks | 7-10 weeks |
| **66** | Observability | 2 weeks | 9-12 weeks |
| **67** | Composition RBAC + Cutover | 2-3 weeks | 11-15 weeks |

**Total Remaining**: 11-15 weeks (~3-4 months) from Sprint 62 completion
**Target Completion**: End of Q1 2027

---

## Conclusion

This revised implementation plan provides a comprehensive 5-sprint roadmap (Sprints 63-67) to complete the tool-orchestrator migration, building on Sprint 62's MCP aggregation foundation. Each sprint includes:

- **Bootstrap Information**: Entry points, current state, goals
- **Detailed Task Breakdowns**: Code implementations, file locations
- **Acceptance Criteria**: Clear success metrics
- **Sprint Summaries**: Duration, dependencies, deliverables

**Current Status**: Sprint 62 complete (MCP aggregation working)
**Next Sprint**: Sprint 63 - Foundation (ToolRegistry + ModelRegistry Completion)
**Total Remaining Effort**: ~14-18 weeks (5 sprints)

**Document Status**: Active Implementation Plan
**Approval**: Ready for Execution
