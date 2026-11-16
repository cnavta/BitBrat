# Sprint 64 Quick Start Guide

**Sprint ID**: sprint-64-743ijk
**Goal**: Model-Based RBAC - Dual-Layer Validation
**Duration**: 2-3 weeks (15 working days)

---

## Overview

Sprint 64 implements **model-based RBAC** - a fundamental shift from agent-based permissions to dual-layer validation (User × Model). The LLM model (gpt-4, claude-sonnet, etc.) becomes the security principal, not the orchestrating agent (llm-bot, query-analyzer).

**What we're building**:
1. ✅ Updated ToolExecutionContext (add `modelId`, remove `agentName`)
2. ✅ RbacValidator module (dual-layer validation logic)
3. ✅ ToolGateway module (tool execution orchestration with RBAC enforcement)
4. ✅ Updated llm-bot (passes LLM modelId)
5. ✅ Updated reflex (passes agent modelId='reflex')
6. ✅ 20+ RBAC test scenarios
7. ✅ Integration validation in agent-dev

---

## Getting Started

### 1. Change to Sprint Worktree

```bash
cd .worktrees/sprint-64-743ijk/
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
# Should show: feature/sprint-64-743ijk-model-based-rbac-dual-layer-va
```

### 4. Review Planning Artifacts

- **Execution Plan**: `planning/sprint-64-743ijk/SPRINT-EXECUTION-PLAN.md` (detailed breakdown)
- **Backlog**: `planning/sprint-64-743ijk/backlog.yaml` (35 trackable tasks)
- **This Guide**: `planning/sprint-64-743ijk/QUICKSTART.md`

---

## Task Workflow

### Recommended Order (Critical Path)

```
Week 1:
  Day 1:   T1.1 + T1.2 (ToolExecutionContext update)
  Day 2-3: T2.1 + T2.2 + T2.3 (ToolGateway skeleton + execute())
  Day 4-5: T2.4 + T2.5 + T2.6 (Cache + placeholders + validateToolAccess())

Week 2:
  Day 6:   T2.7 + T2.8 (listAvailableTools() + tests)
  Day 7:   T3.1 + T3.2 + T3.3 (RbacValidator skeleton + user roles)
  Day 8:   T3.4 + T3.5 (Model roles + tier)
  Day 9:   T3.6 + T3.7 (Model policy + trust scores)
  Day 10:  T3.8 (RbacValidator tests)

Week 3:
  Day 11:    T4.1 + T4.2 (llm-bot model selection + modelId)
  Day 12:    T4.3 + T4.4 (llm-bot tests + agent-dev validation)
  Day 13:    T5.1 + T5.2 (reflex modelId + model verification)
  Day 14:    T5.3 + T5.4 (reflex tests + agent-dev validation)
  Day 15:    T6.1 + T6.2 + T6.3 + T6.4 + T6.5 (Integration tests + completion)
```

### Task Template

For each task in `backlog.yaml`:

1. **Start Task**: Update status in backlog.yaml
   ```yaml
   status: in_progress
   ```

2. **Create/Modify Files**: Follow `files_to_create` and `files_to_modify`

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

### New Files (Sprint 64)

```
src/apps/tool-orchestrator-service/
├── modules/
│   └── gateway/
│       ├── tool-gateway.ts                        (T2.2 - ~800 lines)
│       ├── tool-gateway.interface.ts              (T2.1 - ~100 lines)
│       └── rbac-validator.ts                      (T3.2 - ~300 lines)
└── __tests__/
    ├── tool-gateway.test.ts                       (T2.8 - 10+ tests)
    ├── rbac-validator.test.ts                     (T3.8 - 20+ tests)
    └── model-based-rbac.integration.test.ts       (T6.1-T6.3)
```

### Modified Files

```
src/
├── types/
│   └── tools.ts                                   (T1.1 - ToolExecutionContext interface)
└── apps/
    ├── llm-bot-service.ts                         (T4.1-T4.2 - model selection + modelId)
    ├── reflex-service.ts                          (T5.1 - modelId='reflex')
    └── __tests__/
        ├── llm-bot-service.integration.test.ts    (T4.3)
        └── reflex-service.integration.test.ts     (T5.3)
```

---

## Breaking Changes

### ToolExecutionContext Interface Update (T1.1)

**BEFORE (Sprint 63)**:
```typescript
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;           // ❌ REMOVED
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}
```

**AFTER (Sprint 64)**:
```typescript
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // 🆕 REQUIRED
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
}
```

**Impact**:
- All tool-invoking services MUST update simultaneously
- llm-bot: Pass LLM model ID (e.g., 'gpt-4', 'claude-opus-3.5')
- reflex: Pass agent model ID ('reflex')
- Deploy in single atomic commit (minimize downtime)

---

## Testing Strategy

### Unit Tests (30+ tests)

```bash
# ToolGateway tests (10 tests)
npm test -- tool-gateway.test.ts

# RbacValidator tests (20 tests)
npm test -- rbac-validator.test.ts

# All tests with coverage
npm test -- --coverage
```

**Target Coverage**: >80% for ToolGateway and RbacValidator modules

### Integration Tests (agent-dev)

```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-sprint64-validation" })

# 2. Deploy tool-orchestrator, llm-bot, reflex
bit deploy tool-orchestrator --context agent-dev-sprint64-validation
bit deploy llm-bot --context agent-dev-sprint64-validation
bit deploy reflex --context agent-dev-sprint64-validation

# 3. Test premium tool access (T6.1)
# - gpt-4 (premium) can access generate_image (premium)
# - gpt-3.5-turbo (basic) cannot access generate_image (premium)
message.send({
  context: 'agent-dev-sprint64-validation',
  text: 'Generate an image of a sunset',
  platform: 'api',
  userId: 'test-premium-user',
  waitForResponse: true
})

# 4. Test model tier enforcement (T6.2)
npm test -- model-based-rbac.integration.test.ts --context agent-dev-sprint64-validation

# 5. Test trust score validation (T6.3)
npm test -- model-based-rbac.integration.test.ts -t "trust"

# 6. Check logs
fleet.logs({ context: "agent-dev-sprint64-validation" })

# 7. Clean up
agent_dev.destroy({ name: "agent-dev-sprint64-validation", confirm: true })
```

---

## RBAC Validation Logic

### Dual-Layer Validation (User × Model)

**Effective Permission = User Permissions ∩ Model Permissions**

**Validation Steps**:
1. Check user required roles (all must be present)
2. Check user denied roles (none must be present)
3. Check model required roles (all must be present)
4. Check model denied roles (none must be present)
5. Check model tier restrictions (allowed list, denied list)
6. Check model tool policy (allowlist, denylist)
7. Check model trust thresholds (reliability, fidelity, integrity, calibration)

**Example RBAC Scenarios**:

```typescript
// Scenario 1: Premium Tool Access
// Tool: generate_image
// RBAC: { modelTiers: { allowed: ['premium', 'enterprise'] } }
// User: ['user']
// Model: gpt-4 (tier: 'premium')
// Result: ✅ ALLOWED

// Scenario 2: Basic Model Restricted
// Tool: generate_image
// RBAC: { modelTiers: { allowed: ['premium', 'enterprise'] } }
// User: ['user']
// Model: gpt-3.5-turbo (tier: 'basic')
// Result: ❌ DENIED (model_tier_not_allowed)

// Scenario 3: Admin Tool
// Tool: admin.delete_user
// RBAC: { userRoles: { required: ['admin'] }, modelRoles: { required: ['admin-capable'] } }
// User: ['admin']
// Model: gpt-3.5-turbo (roles: ['model', 'basic'])
// Result: ❌ DENIED (model_missing_required_roles)

// Scenario 4: Trust Score Validation
// Tool: sensitive_operation
// RBAC: { minTrustThresholds: { scope: 'tool-use', reliability: 90, fidelity: 90 } }
// User: ['user']
// Model: gpt-3.5-turbo (trust: { tool-use: { reliability: 80, fidelity: 85 } })
// Result: ❌ DENIED (model_trust_insufficient)
```

---

## Model Selection Logic (llm-bot)

### Priority

1. **Annotations** - Check for `model_selection` annotation
2. **User Preferences** - Check `event.identity.user.preferences.preferredModel`
3. **Default Model** - Fall back to `this.currentModel`

### Implementation (T4.1)

```typescript
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
npm test -- tool-gateway.test.ts

# Run tests with coverage
npm test -- --coverage

# Lint
npm run lint
```

### Database

```bash
# Query model_registry
psql -c "SELECT id, provider, tier FROM model_registry"

# Check if reflex model exists (T5.2)
psql -c "SELECT * FROM model_registry WHERE id='reflex'"

# Query tool_registry
psql -c "SELECT id, source, status FROM platform_tool_registry"
```

### Agent-Dev

```bash
# Provision context
agent_dev.provision({ name: "agent-dev-sprint64-test" })

# Deploy service
bit deploy tool-orchestrator --context agent-dev-sprint64-test
bit deploy llm-bot --context agent-dev-sprint64-test
bit deploy reflex --context agent-dev-sprint64-test

# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint64-test" })
fleet.logs({ bit: "llm-bot", context: "agent-dev-sprint64-test" })
fleet.logs({ bit: "reflex", context: "agent-dev-sprint64-test" })

# Get info
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint64-test" })

# Destroy context
agent_dev.destroy({ name: "agent-dev-sprint64-test", confirm: true })
```

### MCP Tools (Testing)

```bash
# Validate tool access
tool.validateToolAccess({
  toolId: 'generate_image',
  userId: 'test-user',
  modelId: 'gpt-4',
  userRoles: ['user']
})

# List available tools for model
tool.listAvailableTools({
  modelId: 'gpt-4',
  userRoles: ['user']
})

# Get model details
model.get({ modelId: 'gpt-4' })
model.get({ modelId: 'reflex' })
```

---

## Sprint Completion Checklist

### Code Deliverables
- [ ] ToolExecutionContext has `modelId` (required), `agentName` removed
- [ ] ToolGateway implements IToolGateway interface
- [ ] RbacValidator validates dual-layer (User × Model)
- [ ] Model tier enforcement working
- [ ] Trust score validation working
- [ ] llm-bot passes LLM modelId
- [ ] reflex passes agent modelId ('reflex')
- [ ] 20+ RBAC test scenarios passing

### Testing
- [ ] 30+ unit tests passing (ToolGateway + RbacValidator)
- [ ] Integration test: Premium tool access (T6.1)
- [ ] Integration test: Model tier enforcement (T6.2)
- [ ] Integration test: Trust score validation (T6.3)
- [ ] Code coverage >80% for ToolGateway and RbacValidator

### Documentation
- [ ] Inline JSDoc for all public methods
- [ ] RBAC validation logic documented
- [ ] Model selection logic documented

### Validation
- [ ] Deployed to agent-dev
- [ ] No errors in logs
- [ ] Premium tools restricted to premium models
- [ ] Basic models cannot access expensive/admin tools
- [ ] Trust score validation working

### Sprint Artifacts
- [ ] Sprint completion summary (sprint-64-completion.md)
- [ ] Backlog updated (all tasks marked completed)
- [ ] Bootstrap info for Sprint 65 documented

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

### RBAC denial not logged

```bash
# Check if ToolGateway.logToolInvocation() is being called
# Verify logger configuration
fleet.logs({ bit: "tool-orchestrator", context: "local", limit: 50 })
```

### Model not found

```bash
# Check model_registry table
psql -c "SELECT * FROM model_registry WHERE id='<model-id>'"

# Verify Sprint 63 model seeding completed
psql -c "SELECT id, tier FROM model_registry"
```

### Agent-dev deployment issues

```bash
# Check logs
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint64-test" })

# Verify service status
fleet.info({ bit: "tool-orchestrator", context: "agent-dev-sprint64-test" })

# Check PostgreSQL connection
fleet.logs({ bit: "tool-orchestrator", context: "agent-dev-sprint64-test" }) | grep DATABASE
```

### llm-bot not passing modelId

```bash
# Check selectModel() logic
fleet.logs({ bit: "llm-bot", context: "local", limit: 50 }) | grep modelId

# Verify ToolExecutionContext includes modelId
fleet.logs({ bit: "tool-orchestrator", context: "local", limit: 50 }) | grep modelId
```

---

## References

- **Sprint 63 Plan**: `planning/sprint-63-d78dvc/SPRINT-EXECUTION-PLAN.md`
- **Sprint 62 Revised Plan**: `planning/sprint-62-0auem0/REVISED-IMPLEMENTATION-PLAN-POST-SPRINT-62.md`
- **Sprint 55 Architecture**: `planning/sprint-55-h17jpp/technical-architecture.md`
- **Sprint Protocol**: `AGENTS.md`
- **Execution Plan**: `planning/sprint-64-743ijk/SPRINT-EXECUTION-PLAN.md`
- **Backlog**: `planning/sprint-64-743ijk/backlog.yaml`

---

**Last Updated**: 2026-11-16
**Status**: Ready for execution
