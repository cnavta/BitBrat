# Sprint 57 Execution Plan: Foundation - tool-orchestrator with Persistent Registries

**Sprint ID**: sprint-57-54vza9
**Title**: Foundation - tool-orchestrator with Persistent Registries
**Owner**: christophernavta
**Duration**: 2-3 weeks
**Status**: Planning

---

## Executive Summary

Sprint 57 establishes the foundational infrastructure for the tool-centric platform transformation. This sprint creates the `tool-orchestrator` Bit with persistent PostgreSQL-backed registries, replacing the ephemeral in-memory tool storage in `tool-gateway`. This is the first of six sprints (57-62) implementing the architecture defined in Sprint 55.

### Key Objectives

1. **Deploy tool-orchestrator Bit** - New platform service with modular architecture
2. **PostgreSQL Persistence** - Migrate from in-memory to persistent storage
3. **Model Registry** - Introduce model catalog with LLM and agent models (including reflex)
4. **Tool Migration** - Import existing tools from tool-gateway
5. **Foundation for Model-Based RBAC** - Prepare infrastructure for Sprint 58

### Success Criteria

- ✅ tool-orchestrator deploys successfully to agent-dev
- ✅ PostgreSQL tables created with proper indexes
- ✅ Model registry seeded with 8+ models (gpt-4, claude-opus, gpt-3.5-turbo, reflex, etc.)
- ✅ All existing tools migrated from tool-gateway
- ✅ MCP tools functional: tool.list, tool.get, model.list, model.get
- ✅ No breaking changes to existing services

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Task Breakdown](#2-task-breakdown)
3. [Dependencies & Critical Path](#3-dependencies--critical-path)
4. [Testing Strategy](#4-testing-strategy)
5. [Risk Mitigation](#5-risk-mitigation)
6. [Acceptance Criteria](#6-acceptance-criteria)

---

## 1. Architecture Overview

### 1.1 New Components

```
tool-orchestrator Bit (NEW)
├── src/apps/tool-orchestrator-service.ts (main entry)
└── src/apps/tool-orchestrator-service/modules/
    ├── registry/
    │   ├── tool-registry.ts (ToolRegistry module)
    │   ├── tool-registry.test.ts
    │   └── interfaces.ts
    ├── models/
    │   ├── model-registry.ts (ModelRegistry module)
    │   ├── model-registry.test.ts
    │   └── interfaces.ts
    └── types/
        ├── tool-registry-document.ts
        ├── model-registry-document.ts
        └── index.ts
```

### 1.2 PostgreSQL Schema

**New Tables** (3):

1. **platform_tool_registry** (Migration 024)
   - Stores tool metadata with RBAC config
   - GIN indexes on JSONB for fast filtering

2. **model_registry** (Migration 025)
   - Stores LLM model metadata (gpt-4, claude, etc.)
   - Stores agent model metadata (reflex)
   - Includes security profiles, trust scores, capabilities

3. **mcp_server_registrations** (Migration 026)
   - Stores MCP server connection config
   - Tracks imported tools per server

### 1.3 Module Responsibilities

**ToolRegistry Module**:
- Tool storage (CRUD operations)
- Tool deduplication logic
- RBAC metadata management (user + model layers)
- Health tracking (lightweight)

**ModelRegistry Module**:
- Model catalog management
- Security profile storage
- Capability tracking
- Trust score management
- Tool policy enforcement

---

## 2. Task Breakdown

### Phase 1: Infrastructure Setup (Days 1-3)

#### Task 1.1: Create tool-orchestrator Bit
**Duration**: 1 day
**Owner**: Agent
**Priority**: P0 (Critical Path)

**Steps**:
1. Run `brat bit create tool-orchestrator --profile core --exposure platform-only --register --active`
2. Verify generated files:
   - `src/apps/tool-orchestrator-service.ts`
   - `src/apps/tool-orchestrator-service.test.ts`
   - Docker configuration
   - architecture.yaml entry
3. Basic setup() with MCP server initialization
4. Deploy to agent-dev context for validation

**Acceptance Criteria**:
- [ ] Bit created with correct profile and exposure
- [ ] Service starts successfully
- [ ] Registers MCP server on startup
- [ ] No errors in logs

---

#### Task 1.2: Create PostgreSQL Migrations
**Duration**: 1 day
**Owner**: Agent
**Priority**: P0 (Critical Path, blocks all modules)

**Migration 024: platform_tool_registry**
```sql
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

CREATE INDEX idx_platform_tool_registry_source ON platform_tool_registry(source);
CREATE INDEX idx_platform_tool_registry_status ON platform_tool_registry(status);
CREATE INDEX idx_platform_tool_registry_category ON platform_tool_registry(category);
CREATE INDEX idx_platform_tool_registry_tags ON platform_tool_registry USING GIN(tags);
CREATE INDEX idx_platform_tool_registry_rbac ON platform_tool_registry USING GIN(rbac);
CREATE INDEX idx_platform_tool_registry_source_metadata ON platform_tool_registry USING GIN(source_metadata);
```

**Migration 025: model_registry**
```sql
CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  model_type TEXT NOT NULL DEFAULT 'llm' CHECK (model_type IN ('llm', 'rule-based', 'hybrid')),
  roles TEXT[] NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL CHECK (tier IN ('free', 'basic', 'premium', 'enterprise', 'deterministic', 'system')),
  trust JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL DEFAULT '{"toolCalling": false, "vision": false, "streaming": false, "maxContextTokens": 0, "maxOutputTokens": 0}',
  cost JSONB NOT NULL DEFAULT '{"inputTokenCost": 0, "outputTokenCost": 0}',
  tool_policy JSONB NOT NULL DEFAULT '{"allowedTools": [], "deniedTools": []}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  metrics JSONB NOT NULL DEFAULT '{"totalRequests": 0, "totalTokensUsed": 0, "totalCostUSD": 0, "avgResponseTimeMs": 0}',
  CONSTRAINT unique_model_display_name UNIQUE (display_name)
);

CREATE INDEX idx_model_registry_provider ON model_registry(provider);
CREATE INDEX idx_model_registry_tier ON model_registry(tier);
CREATE INDEX idx_model_registry_status ON model_registry(status);
CREATE INDEX idx_model_registry_roles ON model_registry USING GIN(roles);
CREATE INDEX idx_model_registry_capabilities ON model_registry USING GIN(capabilities);
```

**Migration 026: mcp_server_registrations**
```sql
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

CREATE INDEX idx_mcp_server_registrations_status ON mcp_server_registrations(status);
CREATE INDEX idx_mcp_server_registrations_transport ON mcp_server_registrations(transport);
```

**Acceptance Criteria**:
- [ ] All 3 migrations run successfully
- [ ] Indexes created and optimized
- [ ] Constraints validated
- [ ] Rollback tested

---

### Phase 2: Core Modules (Days 4-8)

#### Task 2.1: Implement ToolRegistry Module
**Duration**: 3 days
**Owner**: Agent
**Priority**: P0 (Critical Path)
**Depends On**: Task 1.2 (migrations)

**Interface Design**:
```typescript
interface IToolRegistry {
  // Tool CRUD
  registerTool(tool: ToolRegistryDocument): Promise<void>;
  getTool(id: string): Promise<ToolRegistryDocument | null>;
  queryTools(filters: ToolQueryFilters): Promise<ToolRegistryDocument[]>;
  updateTool(id: string, updates: Partial<ToolRegistryDocument>): Promise<void>;
  deleteTool(id: string): Promise<void>;

  // Deduplication
  findDuplicates(tool: ToolRegistryDocument): Promise<ToolRegistryDocument[]>;
  resolveConflict(toolId: string, preferredSource: string): Promise<void>;

  // Health tracking
  updateHealth(toolId: string, health: HealthStatus): Promise<void>;

  // Import pipeline
  importFromMcp(serverName: string, tools: McpToolDefinition[]): Promise<string[]>;
  importFromBit(bitName: string, tools: BitBratTool[]): Promise<string[]>;
}

interface ToolQueryFilters {
  source?: ToolSource[];
  status?: ('active' | 'deprecated' | 'disabled')[];
  category?: string;
  tags?: string[];
  rbacFilter?: {
    userRoles?: string[];
    modelId?: string;
  };
}
```

**Implementation Details**:
- PostgreSQL DocumentStore backend (collection: `platform_tool_registry`)
- Deduplication by canonical ID (exact match)
- Schema mismatch detection (log warning, require admin resolution)
- RBAC metadata preserved from source
- Health status initialized to 'healthy'

**Testing**:
- Unit tests: 80%+ coverage
- Test deduplication logic
- Test RBAC filtering
- Test import pipeline (MCP + Bit)

**Acceptance Criteria**:
- [ ] All interface methods implemented
- [ ] PostgreSQL queries optimized
- [ ] Deduplication logic tested
- [ ] Unit tests passing

---

#### Task 2.2: Implement ModelRegistry Module
**Duration**: 2 days
**Owner**: Agent
**Priority**: P0 (Critical Path)
**Depends On**: Task 1.2 (migrations)

**Interface Design**:
```typescript
interface IModelRegistry {
  // Model CRUD
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

interface ModelQueryFilters {
  provider?: string[];
  tier?: string[];
  status?: ('active' | 'deprecated' | 'disabled')[];
  capabilities?: {
    toolCalling?: boolean;
    vision?: boolean;
  };
}
```

**Implementation Details**:
- PostgreSQL DocumentStore backend (collection: `model_registry`)
- Trust score scope matching (default: 'tool-use', fallback: 'general')
- Capability validation
- Tool policy enforcement (allowlist + denylist)

**Testing**:
- Unit tests: 80%+ coverage
- Test trust score retrieval
- Test tier filtering
- Test tool policy validation

**Acceptance Criteria**:
- [ ] All interface methods implemented
- [ ] Trust score logic validated
- [ ] Tool policy enforcement working
- [ ] Unit tests passing

---

### Phase 3: Model Seeding & Tool Migration (Days 9-11)

#### Task 3.1: Seed Model Registry
**Duration**: 1 day
**Owner**: Agent
**Priority**: P1
**Depends On**: Task 2.2 (ModelRegistry module)

**Seed Data** (config/model-registry-seed.yaml):

**LLM Models**:
1. **gpt-4** (OpenAI)
   - tier: 'premium'
   - roles: ['model', 'premium', 'vision', 'function-calling']
   - trust: [{ scope: 'tool-use', scores: { reliability: 95, fidelity: 93, integrity: 94, calibration: 92 }}]
   - capabilities: { toolCalling: true, vision: true, maxContextTokens: 128000 }

2. **gpt-4-turbo** (OpenAI)
   - tier: 'premium'
   - roles: ['model', 'premium', 'vision', 'function-calling']
   - trust: [{ scope: 'tool-use', scores: { reliability: 94, fidelity: 92, integrity: 93, calibration: 91 }}]

3. **claude-opus-3.5** (Anthropic)
   - tier: 'premium'
   - roles: ['model', 'premium', 'vision', 'function-calling']
   - trust: [{ scope: 'tool-use', scores: { reliability: 96, fidelity: 95, integrity: 96, calibration: 94 }}]

4. **claude-sonnet-3.5** (Anthropic)
   - tier: 'premium'
   - roles: ['model', 'premium', 'function-calling']
   - trust: [{ scope: 'tool-use', scores: { reliability: 93, fidelity: 92, integrity: 94, calibration: 91 }}]

5. **gpt-3.5-turbo** (OpenAI)
   - tier: 'basic'
   - roles: ['model', 'basic', 'function-calling']
   - trust: [{ scope: 'tool-use', scores: { reliability: 85, fidelity: 83, integrity: 86, calibration: 82 }}]

6. **ollama/llama3** (Ollama)
   - tier: 'free'
   - roles: ['model', 'free', 'local']
   - trust: [{ scope: 'tool-use', scores: { reliability: 75, fidelity: 72, integrity: 78, calibration: 70 }}]

**Agent Models**:
7. **reflex** (deterministic agent)
   - modelType: 'rule-based'
   - tier: 'deterministic'
   - roles: ['agent', 'deterministic', 'system']
   - trust: [{ scope: 'tool-use', scores: { reliability: 100, fidelity: 100, integrity: 100, calibration: 100 }}]
   - capabilities: { toolCalling: true, vision: false, maxContextTokens: 0 }
   - **Note**: reflex executes tools directly (no LLM inference), registered as model for permissions/metrics

8. **system** (internal platform agent)
   - modelType: 'rule-based'
   - tier: 'system'
   - roles: ['system', 'admin']
   - trust: [{ scope: 'tool-use', scores: { reliability: 100, fidelity: 100, integrity: 100, calibration: 100 }}]

**Seed Script**: `scripts/seed-model-registry.ts`
- Idempotent (check if model exists before inserting)
- Run on tool-orchestrator startup (if registry empty)
- Configurable via YAML file

**Acceptance Criteria**:
- [ ] 8+ models seeded
- [ ] Trust scores configured per model
- [ ] reflex registered as deterministic agent model
- [ ] Seed script idempotent

---

#### Task 3.2: Import Existing Tools from tool-gateway
**Duration**: 2 days
**Owner**: Agent
**Priority**: P1
**Depends On**: Task 2.1 (ToolRegistry module)

**Import Strategy**:
1. Query tool-gateway for all registered tools (via MCP `tool.list` or direct registry access)
2. Transform `BitBratTool` → `ToolRegistryDocument`
3. Preserve RBAC metadata (user roles only for now, model roles added in Sprint 58)
4. Insert into `platform_tool_registry` table
5. Log import results (success/failure/conflicts)

**Transformation Logic**:
```typescript
function transformTool(bitTool: BitBratTool): ToolRegistryDocument {
  return {
    id: bitTool.id,
    canonicalName: bitTool.displayName || bitTool.id,
    description: bitTool.description || '',
    source: bitTool.source,
    sourceMetadata: {
      mcpServer: bitTool.originServer ? { name: bitTool.originServer } : undefined,
      bit: bitTool.source === 'internal' ? { name: 'tool-gateway' } : undefined,
    },
    inputSchema: zodToJsonSchema(bitTool.inputSchema),
    rbac: {
      userRoles: {
        required: bitTool.requiredRoles || [],
        denied: [],
      },
      modelRoles: {
        required: [],  // Populated in Sprint 58
        denied: [],
      },
      modelTiers: {
        allowed: [],
        denied: [],
      },
    },
    config: {
      timeoutMs: 30000,
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    },
    health: {
      status: 'healthy',
    },
    status: 'active',
    tags: bitTool.scopes || [],
    category: bitTool.category || 'general',
    relatedTools: [],
    importedAt: new Date(),
    lastUpdatedAt: new Date(),
  };
}
```

**Acceptance Criteria**:
- [ ] All existing tools imported
- [ ] No data loss (verify count matches)
- [ ] RBAC metadata preserved
- [ ] Import script idempotent

---

### Phase 4: MCP Tools (Days 12-14)

#### Task 4.1: Implement Basic MCP Tools
**Duration**: 2 days
**Owner**: Agent
**Priority**: P1
**Depends On**: Tasks 2.1, 2.2 (both modules)

**Tool Specifications**:

1. **tool.list**
   - Description: List all tools with optional filtering
   - Input: `{ source?, status?, category?, tags? }`
   - Output: `ToolRegistryDocument[]`
   - RBAC: No filtering yet (Sprint 58)
   - Implementation: Delegate to ToolRegistry.queryTools()

2. **tool.get**
   - Description: Get single tool metadata
   - Input: `{ toolId: string }`
   - Output: `ToolRegistryDocument | null`
   - Implementation: Delegate to ToolRegistry.getTool()

3. **model.list**
   - Description: List all models with optional filtering
   - Input: `{ provider?, tier?, status? }`
   - Output: `ModelRegistryDocument[]`
   - Implementation: Delegate to ModelRegistry.listModels()

4. **model.get**
   - Description: Get single model metadata
   - Input: `{ modelId: string }`
   - Output: `ModelRegistryDocument | null`
   - Implementation: Delegate to ModelRegistry.getModel()

**MCP Registration**:
```typescript
// In tool-orchestrator-service.ts setup()
this.registerTool('tool.list', 'List all platform tools', toolListSchema, async (args, ctx) => {
  const tools = await this.toolRegistry.queryTools(args);
  return { content: [{ type: 'text', text: JSON.stringify(tools, null, 2) }] };
});

this.registerTool('tool.get', 'Get tool metadata', toolGetSchema, async (args, ctx) => {
  const tool = await this.toolRegistry.getTool(args.toolId);
  if (!tool) throw new Error(`Tool not found: ${args.toolId}`);
  return { content: [{ type: 'text', text: JSON.stringify(tool, null, 2) }] };
});

// Similar for model.list, model.get
```

**Acceptance Criteria**:
- [ ] All 4 MCP tools registered
- [ ] Tools return correct data
- [ ] Error handling for missing tools/models
- [ ] Tools accessible via MCP client

---

### Phase 5: Integration Testing (Days 15-17)

#### Task 5.1: Deploy to Agent-Dev
**Duration**: 1 day
**Owner**: Agent
**Priority**: P0 (Validation)
**Depends On**: All previous tasks

**Deployment Steps**:
1. Provision agent-dev context: `agent_dev.provision({ name: "agent-dev-sprint-57" })`
2. Deploy tool-orchestrator: `bit deploy tool-orchestrator --context agent-dev-sprint-57`
3. Verify service starts successfully
4. Check PostgreSQL tables created
5. Verify model registry seeded
6. Verify tools imported

**Validation**:
```bash
# Check service health
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint-57" })

# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint-57", limit: 50 })

# Test MCP tools
tool.list({})
model.list({})
```

**Acceptance Criteria**:
- [ ] Service deploys without errors
- [ ] PostgreSQL tables exist
- [ ] Model registry has 8+ models
- [ ] Tool registry has all migrated tools
- [ ] MCP tools functional

---

#### Task 5.2: Integration Testing
**Duration**: 2 days
**Owner**: Agent
**Priority**: P1
**Depends On**: Task 5.1 (deployment)

**Test Scenarios**:

1. **Tool Import Test**
   - Query tool.list
   - Verify count matches tool-gateway
   - Validate tool metadata (schema, RBAC, source)

2. **Model Query Test**
   - Query model.list
   - Verify all 8 models present
   - Validate trust scores
   - Test tier filtering

3. **Deduplication Test**
   - Attempt to register duplicate tool
   - Verify conflict detection
   - Test resolution workflow

4. **Health Tracking Test**
   - Update tool health status
   - Query tool with degraded health
   - Verify status reflected in registry

5. **RBAC Metadata Test**
   - Query tools with user role filters
   - Verify RBAC metadata preserved
   - Validate model roles empty (Sprint 58)

**Acceptance Criteria**:
- [ ] All 5 test scenarios pass
- [ ] No regressions in tool-gateway
- [ ] Performance acceptable (queries < 100ms)

---

## 3. Dependencies & Critical Path

### Dependency Graph

```
Task 1.1: Create tool-orchestrator Bit (Day 1)
  └─> Task 1.2: Create PostgreSQL Migrations (Day 2)
       ├─> Task 2.1: ToolRegistry Module (Days 3-5)
       │    ├─> Task 3.2: Import Tools (Days 9-10)
       │    └─> Task 4.1: MCP Tools (Days 12-13)
       │
       └─> Task 2.2: ModelRegistry Module (Days 6-7)
            ├─> Task 3.1: Seed Models (Day 8)
            └─> Task 4.1: MCP Tools (Days 12-13)

Task 4.1: MCP Tools (Days 12-13)
  └─> Task 5.1: Deploy to Agent-Dev (Day 14)
       └─> Task 5.2: Integration Testing (Days 15-17)
```

### Critical Path (17 days)

1. Task 1.1: Create tool-orchestrator Bit (1 day)
2. Task 1.2: PostgreSQL Migrations (1 day)
3. Task 2.1: ToolRegistry Module (3 days)
4. Task 3.2: Import Tools (2 days)
5. Task 2.2: ModelRegistry Module (2 days - parallel)
6. Task 3.1: Seed Models (1 day)
7. Task 4.1: MCP Tools (2 days)
8. Task 5.1: Deploy to Agent-Dev (1 day)
9. Task 5.2: Integration Testing (2 days)

**Total: 17 days (2.4 weeks)**

---

## 4. Testing Strategy

### 4.1 Unit Testing

**Coverage Targets**:
- ToolRegistry Module: 80%+
- ModelRegistry Module: 80%+
- Overall: 75%+

**Test Categories**:

**ToolRegistry Tests**:
- Tool CRUD operations
- Deduplication logic (exact match, schema mismatch)
- RBAC filtering (user roles, empty model roles)
- Health status updates
- Import pipeline (MCP, Bit)

**ModelRegistry Tests**:
- Model CRUD operations
- Trust score retrieval (scope matching)
- Tier filtering
- Tool policy validation
- Capability queries

**Migration Tests**:
- Schema creation
- Index optimization
- Constraint validation
- Rollback procedures

### 4.2 Integration Testing

**Test Environment**: agent-dev-sprint-57

**Scenarios**:
1. End-to-end tool import flow
2. Model registry seeding
3. MCP tool invocation
4. PostgreSQL query performance
5. Deduplication workflow

**Performance Targets**:
- Tool query (single): < 10ms
- Tool query (list, 100 items): < 50ms
- Model query: < 10ms
- Tool import (100 tools): < 5 seconds

### 4.3 Validation Testing

**Backward Compatibility**:
- tool-gateway continues operating
- Existing MCP servers unaffected
- No changes to llm-bot (yet)

**Data Integrity**:
- All tools migrated (verify count)
- RBAC metadata preserved
- No data loss

---

## 5. Risk Mitigation

### High-Risk Items

**Risk 1: PostgreSQL Performance**
- **Mitigation**: Comprehensive GIN indexes on JSONB columns
- **Monitoring**: P95 query latency
- **Fallback**: Optimize queries, add specific indexes

**Risk 2: Tool Deduplication Conflicts**
- **Mitigation**: Clear error messages, admin resolution tool
- **Monitoring**: Conflict rate
- **Fallback**: Allow duplicates with source suffix

**Risk 3: Model Seeding Incomplete**
- **Mitigation**: Idempotent seed script, validation checks
- **Monitoring**: Model count after startup
- **Fallback**: Manual model registration via MCP tools

### Medium-Risk Items

**Risk 4: Migration Failures**
- **Mitigation**: Test migrations in agent-dev first
- **Rollback**: Revert migrations, restore from backup

**Risk 5: Import Data Loss**
- **Mitigation**: Compare counts before/after import
- **Rollback**: Re-run import script

---

## 6. Acceptance Criteria

### Sprint-Level Acceptance

**Infrastructure**:
- [ ] tool-orchestrator Bit created and deployable
- [ ] PostgreSQL migrations (024, 025, 026) run successfully
- [ ] All tables created with proper indexes

**Modules**:
- [ ] ToolRegistry module implements IToolRegistry interface
- [ ] ModelRegistry module implements IModelRegistry interface
- [ ] Both modules have 80%+ test coverage

**Data**:
- [ ] Model registry seeded with 8+ models (LLM + agent models including reflex)
- [ ] All existing tools imported from tool-gateway
- [ ] No data loss verified

**MCP Tools**:
- [ ] tool.list functional
- [ ] tool.get functional
- [ ] model.list functional
- [ ] model.get functional

**Testing**:
- [ ] Unit tests passing
- [ ] Integration tests passing (agent-dev)
- [ ] Performance targets met

**Backward Compatibility**:
- [ ] tool-gateway remains operational
- [ ] No breaking changes to existing services

### Task-Level Acceptance

See individual task acceptance criteria above.

---

## Next Steps

1. **User Approval**: Review and approve this execution plan
2. **Start Implementation**: Begin with Task 1.1 (Create tool-orchestrator Bit)
3. **Track Progress**: Update YAML backlog as tasks complete
4. **Daily Updates**: Track blockers and progress
5. **Sprint Completion**: Validate all acceptance criteria before marking complete

---

**Document Status**: Ready for Review
**Last Updated**: 2026-11-09
