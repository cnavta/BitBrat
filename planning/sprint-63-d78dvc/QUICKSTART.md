# Sprint 63 Quick Start Guide

**Sprint ID**: sprint-63-d78dvc
**Goal**: Foundation - ToolRegistry + ModelRegistry Completion
**Duration**: 2-3 weeks (16 working days)

---

## Overview

Sprint 63 builds the **foundation layer** for tool-orchestrator by completing persistent ToolRegistry and ModelRegistry modules. This enables Sprint 64's model-based RBAC implementation.

**What we're building**:
1. ✅ ToolRegistry enhancement (read-only → full CRUD)
2. ✅ ModelRegistry module (NEW - from scratch)
3. ✅ PostgreSQL migration (model_registry table)
4. ✅ Model seeding (10+ LLM models)
5. ✅ MCP tools (4 new tools for management)

---

## Getting Started

### 1. Change to Sprint Worktree

```bash
cd .worktrees/sprint-63-d78dvc/
```

**CRITICAL**: All work must be done in this worktree. Never leave during sprint.

### 2. Install Dependencies and Build

```bash
npm ci
npm run build
```

### 3. Verify Branch

```bash
git branch --show-current
# Should show: feature/sprint-63-d78dvc-foundation-toolregistry-modelr
```

### 4. Review Planning Artifacts

- **Execution Plan**: `planning/sprint-63-d78dvc/SPRINT-EXECUTION-PLAN.md` (detailed breakdown)
- **Backlog**: `planning/sprint-63-d78dvc/backlog.yaml` (24 trackable tasks)
- **This Guide**: `planning/sprint-63-d78dvc/QUICKSTART.md`

---

## Task Workflow

### Recommended Order (Critical Path)

```
Week 1:
  Day 1-2: T3 (PostgreSQL migration) + T1.1 (tool registration)
  Day 3-4: T1.2 (MCP import pipeline)
  Day 5:   T1.3 (deduplication)

Week 2:
  Day 6:   T1.4 (config/lifecycle) + T1.5 (ToolRegistry tests)
  Day 7:   T2.1 (ModelRegistry types)
  Day 8-9: T2.2 (ModelRegistry CRUD)
  Day 10:  T2.3 (permissions)

Week 3:
  Day 11:    T2.4 (ModelRegistry tests)
  Day 12:    T4 (model seeding)
  Day 13:    T5.1 + T5.2 (tool.import + tool.update_config)
  Day 14:    T5.3 + T5.4 (model.register + model.get)
  Day 15-16: T6 (integration testing)
```

### Task Template

For each task in `backlog.yaml`:

1. **Start Task**: Update status in backlog.yaml
   ```yaml
   status: in_progress
   ```

2. **Create Files**: Follow `files_to_create` and `files_to_modify`

3. **Implement**: Follow acceptance criteria

4. **Test**: Run validation command
   ```bash
   npm test -- <test-file> -t '<test-name>'
   ```

5. **Commit**: Atomic commits per task
   ```bash
   git add <files>
   git commit -m "T<task-id>: <title>"
   ```

6. **Complete Task**: Update backlog.yaml
   ```yaml
   status: completed
   ```

---

## Key Files to Create/Modify

### New Files (Sprint 63)

```
src/apps/tool-orchestrator-service/
├── types/
│   ├── tool-registry-document.ts              (T1.1)
│   └── model-registry-document.ts             (T2.1)
├── modules/
│   ├── registry/
│   │   └── tool-registry.interface.ts         (T1.1)
│   └── models/
│       ├── model-registry.ts                  (T2.2)
│       └── model-registry.interface.ts        (T2.1)
└── __tests__/
    ├── tool-registry.test.ts                  (T1.5)
    └── model-registry.test.ts                 (T2.4)

migrations/
└── 025-create-model-registry.sql              (T3.1)

scripts/
└── seed-model-registry.ts                     (T4.1)
```

### Modified Files

```
src/apps/tool-orchestrator-service/
├── index.ts                                   (T5.1-T5.4 - MCP tools)
└── modules/
    └── registry/
        └── tool-registry.ts                   (T1.1-T1.4 - enhancements)
```

---

## Testing Strategy

### Unit Tests (25+ tests)

```bash
# ToolRegistry tests (15 tests)
npm test -- tool-registry.test.ts

# ModelRegistry tests (10 tests)
npm test -- model-registry.test.ts

# All tests with coverage
npm test -- --coverage
```

**Target Coverage**: >80% for ToolRegistry and ModelRegistry modules

### Integration Tests (agent-dev)

```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-sprint63-validation" })

# 2. Deploy tool-orchestrator
bit deploy tool-orchestrator --context agent-dev-sprint63-validation

# 3. Test ToolRegistry CRUD
# - Import tools via tool.import
# - Update config via tool.update_config
# - Query database

# 4. Test ModelRegistry CRUD
# - Register models via model.register
# - Retrieve via model.get
# - Query database

# 5. Run full test suite
npm test -- --coverage

# 6. Clean up
agent_dev.destroy({ name: "agent-dev-sprint63-validation", confirm: true })
```

---

## MCP Tools to Implement

### T5.1: tool.import

```typescript
// Schema
{
  source: 'mcp-server' | 'bit' | 'composition',
  serverId?: string,
  toolId: string
}

// Example call
tool.import({
  source: 'mcp-server',
  serverId: 'image-gen-mcp',
  toolId: 'generate_image'
})
```

### T5.2: tool.update_config

```typescript
// Schema
{
  toolId: string,
  config: {
    timeoutMs?: number,
    maxRetryAttempts?: number,
    costTier?: 'free' | 'standard' | 'premium' | 'enterprise'
  }
}

// Example call
tool.update_config({
  toolId: 'generate_image',
  config: { timeoutMs: 120000, costTier: 'premium' }
})
```

### T5.3: model.register

```typescript
// Schema
{
  id: string,
  provider: string,
  displayName: string,
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'deterministic' | 'system',
  roles: string[],
  capabilities: {
    toolCalling: boolean,
    vision: boolean
  }
}

// Example call
model.register({
  id: 'gpt-4',
  provider: 'openai',
  displayName: 'GPT-4',
  tier: 'premium',
  roles: ['model', 'premium', 'vision', 'function-calling'],
  capabilities: { toolCalling: true, vision: true }
})
```

### T5.4: model.get

```typescript
// Schema
{
  modelId: string
}

// Example call
model.get({ modelId: 'gpt-4' })
```

---

## Model Seeding Data (T4)

### Models to Seed (10+)

**Premium LLM Models**:
- gpt-4 (OpenAI, tier: premium)
- claude-opus-3.5 (Anthropic, tier: premium)

**Standard LLM Models**:
- gpt-4-turbo (OpenAI, tier: premium)
- claude-sonnet-3.5 (Anthropic, tier: premium)

**Basic LLM Models**:
- gpt-3.5-turbo (OpenAI, tier: basic)

**Deterministic Agent Models**:
- reflex (Platform, tier: deterministic)

**Additional Models** (4+ more):
- gpt-4.1-mini
- ollama/llama
- claude-haiku-3.5
- etc.

### Trust Score Template

```yaml
trust:
  - scope: general
    scores:
      reliability: 95   # 0-100: Produces correct, useful results
      fidelity: 95      # 0-100: Follows instructions and constraints
      integrity: 90     # 0-100: Respects boundaries, resists manipulation
      calibration: 85   # 0-100: Recognizes uncertainty and limitations
    evidence:
      source: benchmark
      samples: 10000
      updatedAt: "2026-11-15T00:00:00Z"

  - scope: tool-use
    scores:
      reliability: 95
      fidelity: 95
      integrity: 95
      calibration: 90
    evidence:
      source: mixed
      samples: 5000
      updatedAt: "2026-11-15T00:00:00Z"
```

---

## Database Schema

### Migration 025: model_registry Table

```sql
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier);
CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry(status);
CREATE INDEX IF NOT EXISTS idx_model_registry_trust ON model_registry USING GIN (trust);
```

---

## Common Commands

### Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Run specific test file
npm test -- tool-registry.test.ts

# Run tests with coverage
npm test -- --coverage

# Lint
npm run lint
```

### Database

```bash
# Run migration
psql -f migrations/025-create-model-registry.sql

# Verify table
psql -c "\d model_registry"

# Query models
psql -c "SELECT id, provider, tier FROM model_registry"

# Run seed script
npm run seed:models
```

### Agent-Dev

```bash
# Provision context
agent_dev.provision({ name: "agent-dev-sprint63-test" })

# Deploy service
bit deploy tool-orchestrator --context agent-dev-sprint63-test

# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint63-test" })

# Get info
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint63-test" })

# Destroy context
agent_dev.destroy({ name: "agent-dev-sprint63-test", confirm: true })
```

---

## Sprint Completion Checklist

### Code Deliverables
- [ ] ToolRegistry implements IToolRegistry (8 methods)
- [ ] ModelRegistry implements IModelRegistry (6 methods)
- [ ] PostgreSQL migration 025 complete
- [ ] 10+ models seeded
- [ ] 4 MCP tools working

### Testing
- [ ] 25+ unit tests passing
- [ ] Integration test: agent-dev validation
- [ ] Code coverage >80%

### Documentation
- [ ] Inline JSDoc for all public methods
- [ ] Trust dimensions documented
- [ ] Migration script commented

### Validation
- [ ] Deployed to agent-dev
- [ ] No errors in logs
- [ ] All MCP tools callable

### Sprint Artifacts
- [ ] Sprint completion summary (sprint-63-completion.md)
- [ ] Backlog updated (all tasks marked completed)
- [ ] Bootstrap info for Sprint 64 documented

---

## Troubleshooting

### TypeScript compilation errors
```bash
npm run build
# Fix errors in reported files
```

### Test failures
```bash
npm test -- <test-file> --verbose
# Review test output, fix implementation
```

### PostgreSQL connection issues
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Verify PostgreSQL running
psql -c "SELECT 1"
```

### Agent-dev deployment issues
```bash
# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint63-test" })

# Verify service status
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint63-test" })
```

---

## References

- **Sprint 62 Plan**: `planning/sprint-62-0auem0/REVISED-IMPLEMENTATION-PLAN-POST-SPRINT-62.md`
- **Sprint 55 Architecture**: `planning/sprint-55-h17jpp/technical-architecture.md`
- **Sprint Protocol**: `AGENTS.md`
- **Execution Plan**: `planning/sprint-63-d78dvc/SPRINT-EXECUTION-PLAN.md`
- **Backlog**: `planning/sprint-63-d78dvc/backlog.yaml`

---

**Last Updated**: 2026-11-15
**Status**: Ready for execution
