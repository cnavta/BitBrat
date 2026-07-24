# Implementation Plan: Sprint 358 - Agent-Dev MCP Tooling

**Sprint ID**: 358
**Status**: Planning Phase - Awaiting Approval
**Created**: 2026-07-23
**Lead Implementor**: Claude (Sonnet 4.5)
**Stakeholder**: Christopher Navta

---

## Sprint Goal

Enable `brat code` agents to provision, manage, and destroy their own dedicated BitBrat Execution Contexts (BECs) via MCP tools, without requiring manual environment setup or deep knowledge of BitBrat's deployment machinery.

---

## Success Criteria

### Functional
- ✅ Agent provisions agent-dev context in <60 seconds
- ✅ All 20+ services start successfully in agent-dev context
- ✅ Zero orphaned resources after destroy (containers, volumes, DB, env files)
- ✅ Agent can query persistence via existing `persistence.*` tools
- ✅ Agent can stream logs via existing `fleet.logs` tool

### Technical
- ✅ 4 MCP lifecycle tools implemented (provision/start/stop/destroy)
- ✅ ContextResolver transparently discovers ephemeral contexts
- ✅ RBAC enforcement: agents can only operate on `agent-dev-*` contexts
- ✅ Code coverage >90% for new code
- ✅ All tests pass (50+ tests across unit/integration/E2E)

### Operational
- ✅ Zero breaking changes to existing workflows
- ✅ User guide published with working examples
- ✅ Clear error messages for all failure modes
- ✅ Complete audit trail of all agent operations

---

## Architecture Overview

### Core Principle
**Agent-dev contexts are standard BitBrat Execution Contexts with guardrails.**

- Storage: `.brat/ephemeral-contexts.yaml` (gitignored) instead of `architecture.yaml`
- Schema: Identical to permanent contexts
- Orchestration: 100% reuse of existing `DockerOrchestrator`, `ContextResolver`, `cmdSeed`
- Monitoring: Agents use existing `fleet.*` and `persistence.*` tools

### Components

```
agent_dev.provision  →  AgentDevContextManager.provision()  →  buildNonInteractive()
                                                           →  scaffoldEnvironment()
                                                           →  writeToEphemeralStorage()
                                                           →  cmdSeed()

agent_dev.start      →  AgentDevContextManager.start()     →  DockerOrchestrator.up()
                                                           →  waitForPostgres()
                                                           →  waitForNats()

agent_dev.stop       →  AgentDevContextManager.stop()      →  DockerOrchestrator.down()

agent_dev.destroy    →  AgentDevContextManager.destroy()   →  DockerOrchestrator.down(-v)
                                                           →  dropDatabase()
                                                           →  deleteEnvDirectory()
                                                           →  removeFromEphemeralStorage()
```

---

## Implementation Phases

### Phase 1: Foundation (Days 1-2)

**Goal**: Enable ephemeral context storage and export reusable functions.

#### Tasks

**1.1 Update ContextResolver to Check Ephemeral Contexts** (3 hours, P0)
- Modify: `tools/brat/src/context/context-resolver.ts`
- Add `loadEphemeralContexts()` method
- Update `getRawContext()` to check ephemeral file first
- Update `listContexts()` to merge both sources
- Handle missing `.brat/` directory gracefully
- **Tests**: Unit tests verify ephemeral loading, merging, prioritization

**1.2 Export Helper Functions from create.ts** (2 hours, P0)
- Modify: `tools/brat/src/commands/context/create.ts`
- Export: `buildNonInteractive()`, `scaffoldEnvironment()`, `waitForPostgres()`, `generateGlobalYaml()`, `generateInfraYaml()`
- No behavioral changes - just visibility
- **Tests**: Integration tests verify `brat context create` still works

**1.3 Implement AgentDevContextManager Core Class** (6 hours, P0)
- Create: `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`
- Implement `provision()`: Generate name, build config, scaffold env, seed DB
- Implement `start()`: Delegate to orchestrator, wait for health
- Implement `stop()`: Delegate to orchestrator, preserve volumes
- Implement `destroy()`: Cleanup containers, volumes, DB, env, ephemeral entry
- **Tests**: Unit + integration tests for all methods

**1.4 Unit Tests for Foundation** (4 hours, P0)
- Create: `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts`
- Modify: `tools/brat/src/context/context-resolver.test.ts`
- 20+ unit tests, 100% coverage for new code

**Deliverables**:
- ContextResolver discovers ephemeral contexts ✅
- AgentDevContextManager fully functional ✅
- All foundation tests passing ✅

---

### Phase 2: MCP Tool Integration (Day 3)

**Goal**: Expose agent-dev lifecycle via MCP tools with RBAC.

#### Tasks

**2.1 Implement 4 MCP Lifecycle Tools** (4 hours, P0)
- Create: `tools/brat/src/dev-mcp/tools/agent-dev.ts`
- Implement: `agent_dev.provision`, `agent_dev.start`, `agent_dev.stop`, `agent_dev.destroy`
- Input validation via Zod schemas
- User-friendly error messages
- Structured responses for programmatic use
- **Tests**: Unit tests for input validation, error handling

**2.2 RBAC Enforcement for Agent-Dev Contexts** (3 hours, P1)
- Modify: `tools/brat/src/dev-mcp/tools/agent-dev.ts`
- Add context name validation (only `agent-dev-*` allowed)
- Add `agentAllowlist: ['claude-code', 'aider', 'continue']`
- Modify: `tools/brat/src/dev-mcp/audit-logger.ts`
- Add contextName, operation, resources fields to audit log
- **Tests**: Unit tests verify rejection of non-agent contexts

**2.3 MCP Tool Integration Tests** (3 hours, P1)
- Modify: `tools/brat/src/dev-mcp/tools/agent-dev.test.ts`
- Test MCP protocol request/response for all 4 tools
- Verify side effects (files created, containers running)
- **Tests**: 10+ integration tests

**Deliverables**:
- 4 MCP tools registered and callable ✅
- RBAC enforcement prevents staging/prod access ✅
- Audit logging captures all operations ✅

---

### Phase 3: Orchestration & Lifecycle (Day 4)

**Goal**: Implement health checks, cleanup validation, and E2E testing.

#### Tasks

**3.1 Implement Start/Stop with Health Checks** (4 hours, P0)
- Modify: `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`
- Enhance `start()`: Poll PostgreSQL (30s timeout), NATS (10s timeout)
- Return gateway URL from auto-discovery
- Enhance `stop()`: Preserve volumes for restart
- **Tests**: Integration tests for health checks, restart scenarios

**3.2 Implement Destroy with Complete Cleanup** (4 hours, P0)
- Modify: `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`
- Enhance `destroy()`: Remove volumes, drop DB, delete env, remove ephemeral entry
- Make idempotent (safe to call multiple times)
- **Tests**: Integration tests verify zero orphaned resources

**3.3 End-to-End Lifecycle Tests** (4 hours, P0)
- Modify: `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts`
- Full lifecycle: Provision → Start → Stop → Start → Destroy
- Parallel contexts: Provision 2, start both, verify isolation, destroy both
- Failure recovery: Kill service, restart
- **Tests**: 5 E2E tests covering all scenarios

**Deliverables**:
- Start waits for service readiness ✅
- Destroy removes all traces ✅
- E2E tests validate full lifecycle ✅

---

### Phase 4: Polish & Documentation (Day 5)

**Goal**: Error handling, user documentation, and final validation.

#### Tasks

**4.1 Error Handling & User-Friendly Messages** (3 hours, P1)
- Modify all agent-dev files
- Add context-rich error messages with remediation suggestions
- Add progress indicators for long operations
- Consistent emoji usage (✅ ⚠️ ❌)
- **Tests**: Manual testing of all error scenarios

**4.2 User Documentation** (4 hours, P1)
- Create: `documentation/guides/agent-dev-contexts.md`
- User guide with overview, quick start, tool reference, workflows, troubleshooting
- Modify: `CLAUDE.md`
- Add agent-dev section with examples
- **Tests**: Manual verification all examples work

**4.3 Final Validation & Cleanup** (2 hours, P1)
- Run full test suite (50+ tests)
- Manual E2E with Claude Code
- Verify no orphaned resources
- Modify: `.gitignore` to add `.brat/`
- Code coverage check (>90%)
- **Tests**: Manual E2E, coverage report

**Deliverables**:
- All error paths have clear messages ✅
- User guide published ✅
- All tests passing ✅
- PR ready for review ✅

---

## File Changes Summary

### New Files (6)
1. `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` - Core lifecycle manager
2. `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts` - Manager tests
3. `tools/brat/src/dev-mcp/tools/agent-dev.ts` - 4 MCP tools
4. `tools/brat/src/dev-mcp/tools/agent-dev.test.ts` - Tool tests
5. `documentation/guides/agent-dev-contexts.md` - User guide
6. `.brat/ephemeral-contexts.yaml` - Ephemeral context storage (gitignored, auto-generated)

### Modified Files (6)
1. `tools/brat/src/context/context-resolver.ts` - Check ephemeral contexts
2. `tools/brat/src/commands/context/create.ts` - Export helper functions
3. `tools/brat/src/dev-mcp/server.ts` - Register agent-dev tools
4. `tools/brat/src/dev-mcp/audit-logger.ts` - Enhanced audit logging
5. `CLAUDE.md` - Add agent-dev section
6. `.gitignore` - Add `.brat/` directory

---

## Testing Strategy

### Test Pyramid
- **Unit Tests**: 30 tests (context generation, validation, RBAC, helpers)
- **Integration Tests**: 15 tests (MCP tools, orchestration, database)
- **E2E Tests**: 5 tests (full lifecycle, parallel contexts, recovery)
- **Total**: 50+ tests
- **Coverage Target**: >90% for new code

### Test Execution
- Run on every commit
- Block merge if tests fail
- E2E tests may require Docker (local/CI)

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Docker resource exhaustion | Medium | High | Limit 1 active context per agent session |
| Incomplete cleanup | Medium | Medium | Comprehensive destroy tests + manual verification |
| PostgreSQL seed failures | Low | Medium | Retry logic, clear error messages, non-blocking |
| Context name collisions | Low | Medium | Timestamp + random suffix, uniqueness check |

---

## Timeline

| Phase | Duration | Stories | Status |
|-------|----------|---------|--------|
| Phase 1: Foundation | 2 days | 4 stories (15 hours) | Not Started |
| Phase 2: MCP Tools | 1 day | 3 stories (10 hours) | Not Started |
| Phase 3: Orchestration | 1 day | 3 stories (12 hours) | Not Started |
| Phase 4: Polish | 1 day | 3 stories (9 hours) | Not Started |
| **Total** | **4-5 days** | **14 stories (46 hours)** | **Planning** |

---

## Dependencies

### External Dependencies
- Docker running locally (for development and testing)
- PostgreSQL accessible (localhost:5432)
- NATS running (via docker-compose)
- Existing BitBrat infrastructure stable

### Internal Dependencies
- No breaking changes to existing BEC infrastructure
- ContextResolver remains backward compatible
- DockerOrchestrator unchanged

---

## Rollback Plan

**If critical issues discovered during sprint**:
1. All changes are in new files or additive exports
2. Can disable agent-dev tools in dev-mcp server
3. Ephemeral contexts don't affect architecture.yaml
4. No risk to existing `local`, `staging`, `prod` contexts

**Rollback steps**:
1. Unregister agent-dev tools from dev-mcp server
2. Revert ContextResolver changes (ephemeral loading)
3. Remove exports from create.ts (if needed)
4. Delete agent-dev tool files

---

## Definition of Done

### Code
- [ ] All 14 stories completed
- [ ] All P0 tasks completed
- [ ] All P1 tasks completed
- [ ] Code coverage >90%
- [ ] No linter warnings
- [ ] All tests passing (50+ tests)

### Documentation
- [ ] User guide published
- [ ] CLAUDE.md updated
- [ ] All examples working
- [ ] Troubleshooting section complete

### Validation
- [ ] Full E2E test passes
- [ ] Manual testing with Claude Code successful
- [ ] No orphaned resources after destroy
- [ ] RBAC enforcement verified
- [ ] Audit logging verified

### Deliverables
- [ ] PR created with feature branch
- [ ] Code reviewed
- [ ] Merged to main
- [ ] Sprint artifacts complete (retro, learnings)

---

## Next Steps

**Upon Approval**:
1. Begin **Phase 1, Task 1.1**: Update ContextResolver
2. Create `request-log.md` to track all prompts and actions
3. Work through backlog sequentially
4. Update backlog status as tasks complete
5. Create `validate_deliverable.sh` in validation phase

**Requesting Approval**:
- Does this implementation plan meet your expectations?
- Any changes to scope, approach, or timeline?
- Any additional requirements or constraints?

---

**Status**: 🟡 **AWAITING STAKEHOLDER APPROVAL**

Once approved, will begin execution phase and create `request-log.md`.
