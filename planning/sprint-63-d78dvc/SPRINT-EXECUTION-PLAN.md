# Sprint 63 Execution Plan: Foundation (ToolRegistry + ModelRegistry Completion)

**Sprint ID**: sprint-63-d78dvc
**Duration**: 2-3 weeks (10-15 working days)
**Owner**: christophernavta
**Status**: Planning
**Started**: 2026-11-15

---

## Executive Summary

Sprint 63 delivers the **foundation layer** for the tool-orchestrator architecture by completing persistent ToolRegistry and ModelRegistry modules with full CRUD operations. This sprint builds directly on Sprint 62's MCP aggregation foundation and enables Sprint 64's model-based RBAC implementation.

**What Sprint 62 Delivered** (Complete ✅):
- Tool cache (in-memory, 100% complete)
- PostgreSQL tool loading (100% complete)
- MCP server override (19 tools exposed)
- Schema cleaning and periodic refresh

**What Sprint 63 Delivers** (Foundation Layer):
1. **ToolRegistry Module Enhancement** - Transform read-only registry into full CRUD system
2. **ModelRegistry Module** - Create model catalog with trust scores from scratch
3. **PostgreSQL Migration 025** - Add model_registry table
4. **Model Seeding** - 10+ well-known models (gpt-4, claude, reflex, etc.)
5. **MCP Tools** - 4 new tools for tool/model management
6. **Deduplication Logic** - Handle multiple sources providing same tool
7. **Integration Tests** - 25+ tests validating ToolRegistry and ModelRegistry

**Gap Closed**: ~15% of full Sprint 55 vision (from 15-20% to 30-35%)

---

## Sprint Goals

### Primary Goal
Complete persistent tool and model registries with full CRUD operations, enabling Sprint 64's dual-layer RBAC validation.

### Success Criteria
- ✅ ToolRegistry implements full IToolRegistry interface (8 methods)
- ✅ ModelRegistry implements full IModelRegistry interface (6 methods)
- ✅ PostgreSQL migration 025 creates model_registry table
- ✅ 10+ models seeded with trust scores
- ✅ 4 new MCP tools operational (tool.import, tool.update_config, model.register, model.get)
- ✅ 25+ unit tests passing
- ✅ Integration test: Deploy to agent-dev, verify tool/model CRUD

### Out of Scope (Future Sprints)
- ❌ Model-based RBAC validation (Sprint 64)
- ❌ Tool execution logic (Sprint 65)
- ❌ ToolObserver module (Sprint 66)
- ❌ Composition RBAC (Sprint 67)

---

## Technical Context

### Current State (Post-Sprint 62)
```typescript
// src/apps/tool-orchestrator-service.ts
export class ToolOrchestratorServer extends Bit {
  private toolCache: ToolRegistryDocument[] = []; // ✅ Works
  private toolRegistry?: ToolRegistry; // ⚠️ Partial (read-only)
  private toolGateway?: ToolGateway; // ❌ Missing

  // ✅ WORKS: Loads tools from PostgreSQL on startup
  private async loadToolsFromRegistry(): Promise<void> { /* ... */ }

  // ✅ WORKS: Synchronous access to cached tools
  private getAllToolsFromRegistry(): ToolRegistryDocument[] { /* ... */ }

  // ✅ WORKS: Serves aggregated tools via MCP endpoint
  protected getMcpServer(): McpServer { /* ... */ }
}
```

### Target State (Post-Sprint 63)
```typescript
export class ToolOrchestratorServer extends Bit {
  private toolCache: ToolRegistryDocument[] = [];
  private toolRegistry: ToolRegistry; // ✅ FULL CRUD
  private modelRegistry: ModelRegistry; // ✅ NEW MODULE

  // ✅ NEW: Tool import pipeline
  async importFromMcpServer(serverId: string, tools: MCPToolSchema[]): Promise<void>

  // ✅ NEW: Model management
  async registerModel(model: Partial<ModelRegistryDocument>): Promise<void>
  async getModel(modelId: string): Promise<ModelRegistryDocument | null>
}
```

### Architecture Impact

**New Files Created** (~2,800 lines):
```
src/apps/tool-orchestrator-service/
├── modules/
│   ├── registry/
│   │   ├── tool-registry.ts              (~600 lines, enhanced)
│   │   └── tool-registry.interface.ts    (~50 lines)
│   └── models/
│       ├── model-registry.ts             (~500 lines, NEW)
│       └── model-registry.interface.ts   (~50 lines, NEW)
├── types/
│   ├── tool-registry-document.ts         (~150 lines)
│   └── model-registry-document.ts        (~200 lines, NEW)
└── __tests__/
    ├── tool-registry.test.ts             (~400 lines)
    └── model-registry.test.ts            (~300 lines)

migrations/
└── 025-create-model-registry.sql         (~100 lines, NEW)

scripts/
└── seed-model-registry.ts                (~300 lines, NEW)
```

**Modified Files** (~500 lines changed):
- `src/apps/tool-orchestrator-service.ts` (~200 lines added for MCP tools)
- `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts` (~300 lines enhanced)

**Total Code Impact**: ~3,300 lines (2,800 new + 500 modified)

---

## Task Breakdown

### T1: Complete ToolRegistry Module Enhancement (5 days)

**Goal**: Transform read-only ToolRegistry into full CRUD module

**Entry Point**: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`

**Current State**:
- ToolRegistry exists (~200 lines)
- Implements only `getTool()` and `queryTools()` (read-only)
- No write operations, no import pipeline

**Target State**:
- Full CRUD implementation (~600 lines)
- Tool import pipeline (MCP/Bit/composition)
- Deduplication logic
- Schema validation

**Subtasks**:
1. **T1.1**: Implement tool registration (`registerTool()`) - 1 day
   - Validate schema
   - Check for duplicates
   - Set defaults (status, health, timestamps)
   - Store in PostgreSQL
   - Add logging

2. **T1.2**: Implement MCP import pipeline (`importFromMcpServer()`) - 2 days
   - Connect to MCP server
   - Parse MCP tool schemas
   - Transform to ToolRegistryDocument
   - Batch import with error handling
   - Log import results

3. **T1.3**: Implement deduplication logic (`deduplicateTool()`) - 1 day
   - Find duplicates by canonical name
   - Source priority: internal > composition > mcp
   - Deprecate non-preferred duplicates
   - Log deduplication decisions

4. **T1.4**: Implement config/lifecycle operations - 1 day
   - `updateToolConfig()` - Update RBAC, timeout, cost tier
   - `deprecateTool()` - Mark as deprecated with reason
   - `disableTool()` - Disable tool (prevent invocations)
   - `validateToolSchema()` - Schema validation logic

5. **T1.5**: Write unit tests - Integrated throughout
   - Test registerTool() success/failure cases (3 tests)
   - Test importFromMcpServer() pipeline (4 tests)
   - Test deduplication logic (3 tests)
   - Test config updates (2 tests)
   - Test schema validation (3 tests)
   - **Target**: 15+ tests

**Acceptance Criteria**:
- ✅ All CRUD operations working (create, read, update, deprecate, disable)
- ✅ MCP server import pipeline functional
- ✅ Deduplication logic handles multiple sources correctly
- ✅ Schema validation catches invalid tools
- ✅ 15+ unit tests passing

**Dependencies**: None (builds on Sprint 62)

---

### T2: Create ModelRegistry Module (5 days)

**Goal**: Create model catalog from scratch with full CRUD and trust scores

**Entry Point**: `src/apps/tool-orchestrator-service/modules/models/model-registry.ts` (NEW)

**Current State**: Module doesn't exist

**Target State**:
- Full IModelRegistry implementation (~500 lines)
- Model CRUD operations
- Model permissions queries
- Tool access validation

**Subtasks**:
1. **T2.1**: Define ModelRegistry interfaces and types - 1 day
   - Create `model-registry-document.ts` (~200 lines)
   - Define `ModelTrust` type (multi-dimensional trust scores)
   - Define `IModelRegistry` interface (~50 lines)
   - Document trust score dimensions (reliability, fidelity, integrity, calibration)

2. **T2.2**: Implement ModelRegistry core operations - 2 days
   - `registerModel()` - Register new model with validation
   - `getModel()` - Retrieve model by ID
   - `queryModels()` - Query with filters
   - `updateModel()` - Update model configuration
   - Storage: DocumentStore (PostgreSQL)

3. **T2.3**: Implement model permissions queries - 1 day
   - `getModelPermissions()` - Extract roles, tier, tool policy
   - `validateModelToolAccess()` - Check tool allowlist/denylist
   - Handle both explicit allowlist and denylist logic

4. **T2.4**: Write unit tests - 1 day
   - Test registerModel() success/failure (2 tests)
   - Test getModel() and queryModels() (2 tests)
   - Test updateModel() (1 test)
   - Test getModelPermissions() (2 tests)
   - Test validateModelToolAccess() (3 tests)
   - **Target**: 10+ tests

**Acceptance Criteria**:
- ✅ ModelRegistry implements IModelRegistry interface
- ✅ All CRUD operations working
- ✅ Model permissions queries functional
- ✅ Tool access validation working
- ✅ 10+ unit tests passing

**Dependencies**: T3 (PostgreSQL migration for storage)

---

### T3: PostgreSQL Migration 025 (1 day)

**Goal**: Create model_registry table in PostgreSQL

**Entry Point**: `migrations/025-create-model-registry.sql` (NEW)

**Target State**:
- model_registry table created
- 4 indexes (provider, tier, status, trust GIN)
- Idempotent migration

**Subtasks**:
1. **T3.1**: Create migration SQL - 4 hours
   - Define table schema (14 columns)
   - Create indexes (provider, tier, status, trust)
   - Add comments for documentation
   - Ensure IF NOT EXISTS clauses

2. **T3.2**: Test migration - 2 hours
   - Run migration on local PostgreSQL
   - Verify table created
   - Verify indexes created
   - Test idempotence (run twice)

3. **T3.3**: Validate in agent-dev - 2 hours
   - Deploy to agent-dev context
   - Run migration
   - Verify schema matches design
   - Query table to confirm structure

**Acceptance Criteria**:
- ✅ Migration creates model_registry table
- ✅ All indexes created
- ✅ Migration is idempotent (can run multiple times)
- ✅ Validated in agent-dev context

**Dependencies**: None (prerequisite for T2)

---

### T4: Model Seeding Script (2 days)

**Goal**: Create script to seed 10+ well-known models with trust scores

**Entry Point**: `scripts/seed-model-registry.ts` (NEW)

**Target State**:
- Seed script (~300 lines)
- 10+ models registered (LLM + agent models)
- Trust scores configured
- Idempotent execution

**Subtasks**:
1. **T4.1**: Define model data - 1 day
   - Premium LLM models: gpt-4, claude-opus-3.5 (2 models)
   - Standard LLM models: gpt-4-turbo, claude-sonnet-3.5 (2 models)
   - Basic LLM models: gpt-3.5-turbo (1 model)
   - Deterministic agent models: reflex (1 model)
   - Additional models: gpt-4.1-mini, ollama/llama, etc. (4+ models)
   - Configure trust scores per scope (general, tool-use)
   - Set tier, roles, capabilities, cost

2. **T4.2**: Implement seed script - 4 hours
   - Load models from data
   - Call modelRegistry.registerModel()
   - Handle duplicates (skip with warning)
   - Log results (registered, skipped)
   - Make idempotent

3. **T4.3**: Test seeding - 4 hours
   - Run script locally
   - Verify 10+ models in database
   - Run script again (verify idempotence)
   - Validate trust scores
   - Validate in agent-dev

**Acceptance Criteria**:
- ✅ Seed script registers 10+ models
- ✅ Includes LLM models (gpt-4, claude, gpt-3.5-turbo)
- ✅ Includes agent models (reflex)
- ✅ Trust scores properly configured
- ✅ Idempotent (can run multiple times)

**Dependencies**: T2 (ModelRegistry), T3 (PostgreSQL migration)

---

### T5: MCP Tools for Tool/Model Management (3 days)

**Goal**: Expose 4 MCP tools for tool and model management

**Entry Point**: `src/apps/tool-orchestrator-service.ts` (modify)

**Target State**:
- 4 new MCP tools registered
- Tools delegate to ToolRegistry and ModelRegistry modules
- Proper Zod schemas
- Error handling

**Subtasks**:
1. **T5.1**: Implement tool.import - 1 day
   - Define Zod schema (source, serverId, toolId)
   - Delegate to toolRegistry.importFromMcpServer()
   - Handle errors gracefully
   - Return success/failure result
   - Write integration test

2. **T5.2**: Implement tool.update_config - 4 hours
   - Define Zod schema (toolId, config)
   - Delegate to toolRegistry.updateToolConfig()
   - Return success result
   - Write integration test

3. **T5.3**: Implement model.register - 1 day
   - Define Zod schema (id, provider, displayName, tier, roles, capabilities)
   - Delegate to modelRegistry.registerModel()
   - Return success/modelId result
   - Write integration test

4. **T5.4**: Implement model.get - 4 hours
   - Define Zod schema (modelId)
   - Delegate to modelRegistry.getModel()
   - Return model details
   - Write integration test

**Acceptance Criteria**:
- ✅ tool.import working
- ✅ tool.update_config working
- ✅ model.register working
- ✅ model.get working
- ✅ All MCP tools have proper schemas
- ✅ 4 integration tests passing

**Dependencies**: T1 (ToolRegistry), T2 (ModelRegistry)

---

### T6: Integration Testing and Validation (2 days)

**Goal**: End-to-end validation in agent-dev context

**Subtasks**:
1. **T6.1**: Deploy to agent-dev - 2 hours
   - Provision agent-dev context
   - Deploy tool-orchestrator
   - Verify service starts
   - Check logs for errors

2. **T6.2**: Test ToolRegistry CRUD - 3 hours
   - Import tools from MCP server
   - Update tool config
   - Query tools
   - Deprecate/disable tools
   - Verify PostgreSQL persistence

3. **T6.3**: Test ModelRegistry CRUD - 3 hours
   - Register new model
   - Query models
   - Update model config
   - Verify trust scores
   - Verify PostgreSQL persistence

4. **T6.4**: Test MCP tools - 3 hours
   - Call tool.import via MCP client
   - Call tool.update_config
   - Call model.register
   - Call model.get
   - Verify responses

5. **T6.5**: Run full test suite - 2 hours
   - Run all unit tests (25+)
   - Run integration tests
   - Verify code coverage (>80%)
   - Fix any failures

**Acceptance Criteria**:
- ✅ All 25+ tests passing
- ✅ Integration test: Deploy to agent-dev, verify tool/model CRUD
- ✅ Code coverage >80%
- ✅ No errors in logs

**Dependencies**: T1, T2, T3, T4, T5

---

## Timeline and Schedule

**Total Duration**: 16 days (3 weeks with overlap)

```
Week 1 (Days 1-5):
  Day 1-2: T3 (PostgreSQL migration) + T1.1 (tool registration)
  Day 3-4: T1.2 (MCP import pipeline)
  Day 5:   T1.3 (deduplication logic)

Week 2 (Days 6-10):
  Day 6:   T1.4 (config/lifecycle operations)
  Day 7:   T2.1 (ModelRegistry interfaces)
  Day 8-9: T2.2 (ModelRegistry core operations)
  Day 10:  T2.3 (model permissions queries)

Week 3 (Days 11-16):
  Day 11:    T2.4 (ModelRegistry tests)
  Day 12:    T4 (model seeding script)
  Day 13:    T5.1 + T5.2 (tool.import + tool.update_config)
  Day 14:    T5.3 + T5.4 (model.register + model.get)
  Day 15-16: T6 (integration testing and validation)
```

**Critical Path**: T3 → T2 → T4 → T6 (ModelRegistry → Seeding → Validation)

**Parallel Work**:
- T1 (ToolRegistry) and T3 (PostgreSQL migration) can start simultaneously
- T1.5 (tests) integrated throughout T1.1-T1.4
- T2.4 (tests) integrated throughout T2.1-T2.3

---

## Risk Assessment

### High Risk
1. **PostgreSQL migration complexity** (T3)
   - Mitigation: Test migration in local first, validate in agent-dev
   - Rollback plan: Migration is idempotent, can be rolled back

2. **Trust score configuration** (T4)
   - Mitigation: Use published benchmarks for trust scores (OpenAI Evals, Anthropic docs)
   - Fallback: Start with conservative scores, refine in Sprint 64

### Medium Risk
1. **MCP tool schema validation** (T5)
   - Mitigation: Refer to existing MCP tools in tool-gateway for patterns
   - Testing: Integration tests for all 4 tools

2. **Deduplication logic edge cases** (T1.3)
   - Mitigation: Comprehensive unit tests (3+ scenarios)
   - Documentation: Clear source priority rules in code comments

### Low Risk
1. **Integration test failures** (T6)
   - Mitigation: Progressive testing throughout sprint
   - Fallback: Fix issues before marking sprint complete

---

## Bootstrap Information for Sprint 64

After Sprint 63 completion, Sprint 64 will have:

**Foundation Ready**:
- ✅ ToolRegistry fully functional (8 CRUD methods)
- ✅ ModelRegistry fully functional (6 methods)
- ✅ 10+ models available for RBAC testing
- ✅ MCP tools for tool/model management

**Sprint 64 Entry Point**:
`src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts` (new file)

**Sprint 64 Prerequisites Satisfied**:
- Tool metadata persistent and queryable
- Model metadata persistent and queryable
- Can now implement dual-layer RBAC (User × Model)

---

## Acceptance Criteria Summary

**Code Deliverables**:
- ✅ ToolRegistry implements full IToolRegistry interface (8 methods)
- ✅ ModelRegistry implements full IModelRegistry interface (6 methods)
- ✅ PostgreSQL migration 025 complete
- ✅ 10+ models seeded (LLM + agent models)
- ✅ 4 new MCP tools working (tool.import, tool.update_config, model.register, model.get)

**Testing**:
- ✅ 25+ unit tests passing (15 for ToolRegistry, 10 for ModelRegistry)
- ✅ Integration test: Deploy to agent-dev, verify tool/model CRUD
- ✅ Code coverage >80%

**Documentation**:
- ✅ Inline documentation for all public methods
- ✅ Trust score dimensions documented
- ✅ Migration script commented

**Validation**:
- ✅ Deployed and validated in agent-dev context
- ✅ No errors in logs
- ✅ All MCP tools callable and functional

---

## References

- **Sprint 62 Implementation Plan**: `planning/sprint-62-0auem0/REVISED-IMPLEMENTATION-PLAN-POST-SPRINT-62.md`
- **Sprint 55 Technical Architecture**: `planning/sprint-55-h17jpp/technical-architecture.md`
- **Sprint Protocol**: `AGENTS.md`

---

**Status**: ✅ Ready for execution
**Last Updated**: 2026-11-15
**Next Review**: End of Week 1 (Day 5)
