# Sprint 58 Quick Reference Guide

**Sprint ID**: sprint-58-6c8qqr
**Title**: Model-Based RBAC - Dual-Layer Validation & Context Propagation
**Status**: Planning → Ready to Execute

---

## Quick Links

- **Sprint Execution Plan**: [sprint-execution-plan.md](./sprint-execution-plan.md)
- **Trackable YAML Backlog**: [backlog.yaml](./backlog.yaml)
- **Sprint Manifest**: [sprint-manifest.yaml](./sprint-manifest.yaml)
- **Sprint 56 Implementation Plan**: `../../planning/sprint-56-rqadsk/implementation-plan.md`
- **Sprint 55 Technical Architecture**: `../../planning/sprint-55-h17jpp/technical-architecture.md`

---

## At a Glance

### What We're Building

Transform BitBrat's RBAC from **agent-based** to **model-based** permissions:

```
Before: Agent (llm-bot) controls tool access
After:  Model (gpt-4, claude-opus) controls tool access
```

### Why This Matters

1. **Cost Control**: Restrict expensive tools to premium models
2. **Security Tiers**: High-risk tools only for trusted models
3. **Fine-Grained Permissions**: Same agent, different models = different access
4. **Trust-Based Access**: Multi-dimensional trust scores (reliability, fidelity, integrity, calibration)

---

## Core Deliverables (Must Have)

### 1. ToolExecutionContext Interface Update
**File**: `src/types/tools.ts`
```typescript
// BEFORE
interface ToolExecutionContext {
  userRoles: string[];
  agentName?: string;  // ❌ Removing
}

// AFTER
interface ToolExecutionContext {
  userRoles: string[];
  modelId: string;     // ✅ Adding (required)
}
```

### 2. ToolGateway Module
**Location**: `src/apps/tool-orchestrator-service/modules/gateway/`
- Tool execution orchestration
- Dual-layer RBAC validation (User × Model)
- LRU cache (5min TTL)
- Event logging to Loki

### 3. RbacValidator (7-Step Algorithm)
**Location**: `src/apps/tool-orchestrator-service/modules/gateway/rbac-validator.ts`
1. User required roles ✓
2. User denied roles ✓
3. Model required roles ✓
4. Model denied roles ✓
5. Model tier restrictions ✓
6. Model tool policy ✓
7. Model trust thresholds ✓

### 4. Service Integration
- **llm-bot**: Pass `modelId` (gpt-4, claude-opus, etc.)
- **reflex**: Pass `modelId: 'reflex'` (deterministic agent model)

### 5. RBAC Test Suite
- 27+ test scenarios
- Unit + integration + load tests
- P95 validation < 1ms

---

## 3-Phase Execution Plan

### Phase 1: Core Infrastructure (Days 1-5)
```
T1.1: Extend ToolExecutionContext (1 day) ──┐
T1.2: Implement ToolGateway Module (5 days) ├─── Critical Path
T1.3: Implement RbacValidator (4 days) ─────┘
```

### Phase 2: Service Integration (Days 6-10)
```
T2.1: Update llm-bot (3 days)
T2.2: Model Tier Enforcement (2 days)
T2.3: Trust Score Validation (3 days)
T2.4: Update reflex (2 days)
```

### Phase 3: Testing & Validation (Days 11-14)
```
T3.1: RBAC Testing Suite (3 days)
T3.2: E2E Validation (1 day)
```

---

## Key Concepts

### Dual-Layer RBAC

```
Effective Permission = User Permissions ∩ Model Permissions

Examples:
✅ User(admin) × Model(gpt-4, admin-capable) = ALLOWED
❌ User(admin) × Model(gpt-3.5, basic) = DENIED
❌ User(guest) × Model(gpt-4, admin-capable) = DENIED
```

### Model Tiers

```
free     → Basic tools only
basic    → Standard tools
premium  → Premium + expensive tools (image gen, video)
enterprise → All tools including admin
```

### Trust Dimensions (0-100 scale)

1. **Reliability**: Produces correct results
2. **Fidelity**: Follows instructions
3. **Integrity**: Resists manipulation
4. **Calibration**: Recognizes uncertainty

---

## Critical Files to Modify

### Type Definitions
```
src/types/tools.ts
├── ToolExecutionContext (add modelId, remove agentName)
└── Update all exports
```

### New Modules
```
src/apps/tool-orchestrator-service/modules/gateway/
├── tool-gateway.ts (NEW)
├── tool-gateway.interface.ts (NEW)
├── rbac-validator.ts (NEW)
└── __tests__/
    ├── tool-gateway.test.ts (NEW)
    └── rbac-validator.test.ts (NEW)
```

### Service Updates
```
src/apps/llm-bot-service.ts (UPDATE - add modelId)
src/apps/reflex-service.ts (UPDATE - add modelId='reflex')
```

---

## Testing Checklist

### Unit Tests
- [ ] ToolGateway module (80%+ coverage)
- [ ] RbacValidator (95%+ coverage)
- [ ] 27+ RBAC scenarios

### Integration Tests
- [ ] llm-bot with modelId
- [ ] reflex with modelId
- [ ] Multiple models (gpt-4, gpt-3.5-turbo, reflex)

### E2E Tests
- [ ] Deploy to agent-dev
- [ ] Premium tool + basic model → DENIED
- [ ] Basic tool + premium model → ALLOWED
- [ ] Admin tool + high-trust model → ALLOWED
- [ ] Admin tool + low-trust model → DENIED

### Performance Tests
- [ ] P95 RBAC validation < 1ms
- [ ] Cache hit ratio > 90%
- [ ] Load test: 1000 validations

---

## Success Metrics

### Must Achieve
- ✅ modelId field in ToolExecutionContext (required)
- ✅ Dual-layer RBAC working
- ✅ Model tier enforcement working
- ✅ Trust score validation working
- ✅ llm-bot + reflex integrated
- ✅ All 27+ tests passing
- ✅ P95 < 1ms

### Nice to Have
- ⭕ Admin tools (model.update_trust_scores)
- ⭕ Grafana dashboards (RBAC denials)

---

## Common Commands

### Development
```bash
# Change to sprint worktree
cd .worktrees/sprint-58-6c8qqr/

# Install dependencies
npm ci

# Build
npm run build

# Run tests
npm test

# Run specific test
npm test -- rbac-validator.test.ts

# Type check
npm run build

# Lint
npm run lint
```

### Testing
```bash
# Unit tests
npm test -- tool-gateway.test.ts
npm test -- rbac-validator.test.ts

# Integration tests
npm run test:integration

# Load tests
npm run test:load -- rbac

# Deploy to agent-dev
npm run brat -- bit deploy tool-orchestrator --context agent-dev-sprint58
```

### MCP Tools
```bash
# List tools
npm run brat -- fleet list

# Get tool info
npm run brat -- fleet info --bit tool-orchestrator

# View logs
npm run brat -- fleet logs --bit tool-orchestrator --context agent-dev-sprint58

# Trace request
npm run brat -- fleet trace --correlation-id <id>
```

---

## Gotchas & Warnings

### ⚠️ Breaking Changes
- Updating `ToolExecutionContext` breaks **all** tool invocations
- Use feature flag: `ENABLE_MODEL_BASED_RBAC=false` (default)
- Gradual rollout: llm-bot → reflex → production

### ⚠️ Performance Critical
- RBAC validation is on hot path (every tool invocation)
- Target: P95 < 1ms
- Use LRU cache aggressively

### ⚠️ Security Critical
- RbacValidator is security boundary
- Test thoroughly (27+ scenarios)
- Never skip trust validation for high-risk tools

### ⚠️ Coordination Required
- llm-bot team (context changes)
- reflex team (context changes)
- tool-orchestrator team (RBAC logic)

---

## Decision Log

### D1: Model-Based vs Agent-Based RBAC
**Decision**: Use Model-Based RBAC
**Rationale**: Model is the decision-maker, not the agent. Enables cost control, security tiers, and trust-based access.
**Alternatives Considered**: Agent-based, Hybrid
**Date**: Sprint 58 Start

### D2: Breaking Change to ToolExecutionContext
**Decision**: Accept breaking change, use feature flag
**Rationale**: Required for model-based RBAC. Cannot be done incrementally.
**Impact**: High (all tool invocations)
**Mitigation**: Feature flag + comprehensive testing
**Date**: Sprint 58 Start

---

## Next Steps After Sprint 58

### Sprint 59: Observability
- ToolObserver module (Loki integration)
- Tool invocation event logging
- Grafana dashboards (RBAC denials, tool metrics)
- Health tracking

### Sprint 60: Composition RBAC
- Registration-time RBAC validation
- Runtime re-validation
- RBAC inheritance logic

### Sprint 61: Validation & Cutover
- E2E integration testing
- Load testing (1000 invocations)
- Migration script (tool-gateway → tool-orchestrator)
- Production deployment
- tool-gateway deprecation

---

## Questions? Issues?

### Documentation
- Sprint Execution Plan: [sprint-execution-plan.md](./sprint-execution-plan.md)
- YAML Backlog: [backlog.yaml](./backlog.yaml)
- Implementation Plan: Sprint 56 (`../../planning/sprint-56-rqadsk/implementation-plan.md`)
- Technical Architecture: Sprint 55 (`../../planning/sprint-55-h17jpp/technical-architecture.md`)

### Support
- **CLAUDE.md**: Platform development guidelines
- **AGENTS.md**: Sprint protocol
- **GitHub Issues**: Bug reports and feature requests

---

**Ready to Execute!** 🚀

Review the Sprint Execution Plan and YAML Backlog, then begin with Phase 1 tasks.
