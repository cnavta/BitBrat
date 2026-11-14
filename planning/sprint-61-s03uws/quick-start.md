# Sprint 61: Quick Start Guide

**Sprint ID**: sprint-61-s03uws
**Title**: Composition RBAC + Validation
**Status**: Ready to begin
**Duration**: 2-3 weeks (20 working days)

---

## Overview

This sprint completes the tool-orchestrator migration by implementing composition RBAC validation and comprehensive end-to-end testing. It fills the gap left by Sprint 60, which delivered tool execution logic but did not validate composition RBAC.

**Key Deliverables**:
1. ✅ Composition RBAC Registration Validation
2. ✅ Composition RBAC Runtime Validation
3. ✅ RBAC Inheritance Logic
4. ✅ End-to-End Validation (5 scenarios)
5. ✅ Load Testing (1000 invocations, P95 < 100ms)
6. ✅ Migration Script (tool-gateway → tool-orchestrator)
7. ✅ Production Readiness (cutover preparation)

---

## Prerequisites

**Code Dependencies** (Sprint 60):
- ✅ tool-orchestrator deployed and operational
- ✅ ToolRegistry module (PostgreSQL-backed)
- ✅ ModelRegistry module (PostgreSQL-backed)
- ✅ ToolGateway module (execution orchestration)
- ✅ ToolObserver module (Loki queries)
- ✅ MCP tool execution working
- ✅ Internal tool execution working
- ✅ Composition execution working (basic - no RBAC validation)

**Infrastructure**:
- PostgreSQL (platform_tool_registry, model_registry)
- Loki (observability)
- agent-dev contexts (for validation)

**Documentation**:
- `planning/sprint-55-h17jpp/technical-architecture.md` (tool-orchestrator design)
- `planning/REVISED-IMPLEMENTATION-PLAN.md` (overall migration plan)

---

## Sprint Structure

### Week 1: Composition RBAC Implementation

**Days 1-3: T1 - Composition Registration RBAC**
- Implement extractToolIds method
- Implement registerComposition method
- Write registration tests (5+ tests)
- Integrate with CompositionRegistry

**Days 4-5: T2 - Composition Runtime RBAC**
- Update executeComposition for runtime validation
- Write runtime validation tests (5+ tests)

### Week 2: RBAC Inheritance + Validation

**Days 6-7: T3 - RBAC Inheritance Logic**
- Implement calculateInheritedRbac
- Implement intersectTiers helper
- Implement mergeMinTrustThresholds helper
- Write inheritance tests (6+ tests)

**Days 8-12: T4 - End-to-End Validation**
- Scenario 1: Happy Path
- Scenario 2: RBAC Denial
- Scenario 3: Tool Import
- Scenario 4: Composition RBAC (critical)
- Scenario 5: Model Upgrade

### Week 3: Load Testing + Migration + Cutover Prep

**Days 13-15: T5 - Load Testing**
- Create load test script
- Run load test in agent-dev
- Analyze and optimize (if needed)

**Days 16-18: T6 - Migration Script**
- Implement export from tool-gateway
- Implement import to tool-orchestrator
- Implement validation
- Create rollback script
- Test migration in agent-dev

**Days 19-20: T7 - Cutover Preparation**
- Implement feature flags (llm-bot, reflex)
- Write deployment plan
- Write operational runbook
- Write stakeholder communication

---

## Critical Path

```
T1.1 → T1.2 → T1.3 → T4.4
  ↓
T3.1 → T3.4
  ↓
T2.1 → T2.2
  ↓
T7.1 → T7.3
```

**Why This Path?**
1. T1 (Registration RBAC) enables T4.4 (Composition RBAC E2E test)
2. T3 (Inheritance) is required by T1.2 (registerComposition)
3. T2 (Runtime RBAC) builds on T1 and validates same use case
4. T7 (Feature flags + deployment plan) prepares for Sprint 62 cutover

**All other tasks can run in parallel with the critical path.**

---

## How to Start

### 1. Verify Sprint Initialization

```bash
# Confirm you're in sprint worktree
pwd
# Expected: /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-61-s03uws

# Confirm branch
git branch --show-current
# Expected: feature/sprint-61-s03uws-composition-rbac-validation

# Verify sprint status
npm run sprint-mcp -- check-sprint-status
```

### 2. Install Dependencies

```bash
# Install npm packages
npm ci

# Build project
npm run build

# Run tests (verify Sprint 60 baseline)
npm test
```

### 3. Review Key Documents

```bash
# Sprint execution plan (detailed task breakdown)
cat planning/sprint-61-s03uws/implementation-plan.md

# Trackable backlog (35 tasks)
cat planning/sprint-61-s03uws/backlog.yaml

# Tool-orchestrator architecture
cat planning/sprint-55-h17jpp/technical-architecture.md

# Overall migration plan
cat planning/REVISED-IMPLEMENTATION-PLAN.md
```

### 4. Start First Task (T1.1)

```bash
# Create task branch (optional, for large tasks)
git checkout -b task/T1.1-extract-tool-ids

# Open relevant files
code src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

# Implement extractToolIds method
# See planning/sprint-61-s03uws/implementation-plan.md Section T1.1

# Run tests
npm test -- tool-registry

# Commit when done
git add .
git commit -m "T1.1: Implement extractToolIds method

- Extract tool IDs from composition steps
- Handle nested compositions recursively
- Return deduplicated Set of tool IDs
- Add unit tests (3+ scenarios)

Sprint 61 - Task T1.1 complete"
```

---

## Task Tracking

### Using backlog.yaml

The `backlog.yaml` file contains 35 granular tasks. Update task status as you progress:

```yaml
- id: T1.1
  name: "Implement extractToolIds method"
  status: pending  # Change to: in-progress → complete
  estimated_hours: 4
  dependencies: []
```

### Daily Standup Format

```markdown
## Standup 2026-11-13

**Yesterday**:
- Completed T1.1 (extractToolIds method)
- Progress on T1.2 (registerComposition - 50% done)

**Today**:
- Complete T1.2 (registerComposition)
- Start T1.3 (registration tests)

**Blockers**:
- None

**Metrics**:
- Tests passing: 40/75 (target: 75+)
- Code coverage: 82%
- Tasks complete: 2/35
```

---

## Testing Strategy

### Unit Tests (T1-T3)

```bash
# Run registry tests
npm test -- tool-registry

# Run gateway tests
npm test -- tool-gateway

# Run RBAC inheritance tests
npm test -- rbac-inheritance
```

**Target**: 16+ new tests (5 registration, 5 runtime, 6 inheritance)

### Integration Tests (T4)

```bash
# Provision agent-dev context
npm run mcp -- agent_dev.provision '{"name": "agent-dev-sprint-61-test"}'

# Deploy services
npm run brat -- bit deploy tool-orchestrator --context agent-dev-sprint-61-test
npm run brat -- bit deploy llm-bot --context agent-dev-sprint-61-test

# Run E2E test
npm run test:e2e -- scenario-1-happy-path

# Clean up
npm run mcp -- agent_dev.destroy '{"name": "agent-dev-sprint-61-test", "confirm": true}'
```

**Target**: 5 scenarios passing

### Load Tests (T5)

```bash
# Run load test
npm run load-test:tool-orchestrator -- --context agent-dev-sprint-61-load-test

# Expected output:
# Total Invocations: 1000
# P95: 85ms ✅ < 100ms target
```

**Target**: P95 < 100ms

---

## Success Criteria

**Implementation Success**:
- ✅ All P0 tasks complete (11 tasks)
- ✅ All P1 tasks complete (19 tasks)
- ✅ 35+ tests passing (16+ new tests from T1-T3)
- ✅ All 5 E2E scenarios pass in agent-dev
- ✅ Load test: 1000 invocations, P95 < 100ms
- ✅ Migration script validated

**Operational Success**:
- ✅ Feature flag implemented (llm-bot, reflex)
- ✅ Deployment plan documented
- ✅ Runbook created
- ✅ Stakeholders informed
- ✅ Ready for Sprint 62 cutover

---

## Common Commands

### Development

```bash
# Build project
npm run build

# Run tests
npm test

# Run specific test file
npm test -- composition-registration.test.ts

# Lint code
npm run lint

# Type check
npx tsc --noEmit
```

### Sprint Management

```bash
# Check sprint status
npm run sprint-mcp -- check-sprint-status

# Update sprint status
npm run sprint-mcp -- update-sprint-status '{"sprintId": "sprint-61-s03uws", "status": "in-progress"}'

# Complete sprint (after all tasks done)
npm run sprint-mcp -- complete-sprint '{"sprintId": "sprint-61-s03uws", "completionMode": "normal"}'
```

### Agent-Dev Contexts

```bash
# Provision context
npm run mcp -- agent_dev.provision '{"name": "agent-dev-sprint-61-test"}'

# Deploy service
npm run brat -- bit deploy tool-orchestrator --context agent-dev-sprint-61-test

# Check logs
npm run mcp -- fleet.logs '{"bit": "tool-orchestrator", "context": "agent-dev-sprint-61-test", "limit": 20}'

# Destroy context
npm run mcp -- agent_dev.destroy '{"name": "agent-dev-sprint-61-test", "confirm": true}'
```

### Git Workflow

```bash
# Check current branch
git branch --show-current

# Stage changes
git add .

# Commit with descriptive message
git commit -m "T1.2: Implement registerComposition method

- Validate model access to all constituent tools
- Throw error if model lacks access
- Store composition with RBAC metadata

Sprint 61 - Task T1.2 complete"

# Push to remote
git push -u origin feature/sprint-61-s03uws-composition-rbac-validation
```

---

## Troubleshooting

### Build Failures

```bash
# Clean build
rm -rf dist node_modules
npm ci
npm run build
```

### Test Failures

```bash
# Run tests in watch mode
npm test -- --watch

# Run specific test with verbose output
npm test -- composition-registration.test.ts --verbose

# Clear Jest cache
npx jest --clearCache
```

### Agent-Dev Issues

```bash
# Check agent-dev context status
npm run mcp -- agent_dev.list

# Check Docker containers
docker ps -a | grep sprint-61

# Check PostgreSQL
docker exec -it <container> psql -U postgres -d bitbrat -c "SELECT * FROM platform_tool_registry;"
```

---

## Resources

**Documentation**:
- Implementation Plan: `planning/sprint-61-s03uws/implementation-plan.md`
- Backlog: `planning/sprint-61-s03uws/backlog.yaml`
- Architecture: `planning/sprint-55-h17jpp/technical-architecture.md`
- Migration Plan: `planning/REVISED-IMPLEMENTATION-PLAN.md`

**Code Locations**:
- ToolRegistry: `src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts`
- ModelRegistry: `src/apps/tool-orchestrator-service/modules/models/model-registry.ts`
- ToolGateway: `src/apps/tool-orchestrator-service/modules/gateway/tool-gateway.ts`
- ToolObserver: `src/apps/tool-orchestrator-service/modules/observer/tool-observer.ts`

**Tests**:
- Unit Tests: `src/apps/tool-orchestrator-service/modules/**/__tests__/`
- E2E Tests: `planning/sprint-61-s03uws/validation/`

---

## Next Steps After Sprint 61

**Sprint 62: Cutover + Documentation + Cleanup**

1. Production cutover (phased rollout: 10% → 50% → 100%)
2. tool-gateway deprecation
3. Comprehensive documentation
4. Code cleanup
5. Final monitoring (7 days stable)

**Prerequisites**: Sprint 61 complete ✅

---

**Ready to begin? Start with T1.1: Implement extractToolIds method**

See `planning/sprint-61-s03uws/implementation-plan.md` for detailed instructions.
