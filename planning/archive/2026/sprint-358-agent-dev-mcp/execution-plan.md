# Execution Plan: Sprint 358 - Agent-Dev MCP Tooling

**Sprint**: 358
**Created**: 2026-07-23
**Lead Implementor**: Claude (Sonnet 4.5)
**Estimated Duration**: 4-5 days
**Status**: Ready to Execute

---

## Executive Summary

This execution plan breaks down the Technical Architecture into concrete, trackable tasks for implementing MCP-based agent-dev context management. The implementation reuses 90% of existing BitBrat infrastructure, focusing on thin wrappers and integration rather than new functionality.

**Key Success Metrics**:
- Agent provisions agent-dev context in <60 seconds
- All 20+ services start successfully
- Zero orphaned resources after destroy
- 100% test coverage for new code
- Zero breaking changes to existing workflows

---

## Implementation Strategy

### Core Principles

1. **Reuse Over Rebuild**: Extract and export existing functions rather than reimplementing
2. **Minimal Surface Area**: Only 4 new MCP tools (provision/start/stop/destroy)
3. **Transparent Integration**: Existing tools (`fleet.*`, `persistence.*`) work unchanged with agent-dev contexts
4. **Fail-Safe Defaults**: Agent-dev contexts can only affect local Docker, never staging/prod

### Critical Path

```
Phase 1: Foundation (Days 1-2)
  ├─ Task 1.1: Update ContextResolver [CRITICAL]
  ├─ Task 1.2: Export helpers from create.ts [CRITICAL]
  ├─ Task 1.3: Build AgentDevContextManager [CRITICAL]
  └─ Task 1.4: Write unit tests

Phase 2: MCP Tools (Day 3)
  ├─ Task 2.1: Implement 4 MCP tools [DEPENDS: 1.3]
  ├─ Task 2.2: RBAC enforcement [DEPENDS: 2.1]
  └─ Task 2.3: Tool integration tests

Phase 3: Orchestration (Day 4)
  ├─ Task 3.1: Implement start/stop [DEPENDS: 2.1]
  ├─ Task 3.2: Health checks & validation
  └─ Task 3.3: End-to-end tests

Phase 4: Polish (Day 5)
  ├─ Task 4.1: Error handling & messages
  ├─ Task 4.2: Documentation
  └─ Task 4.3: Final validation
```

---

## Phase 1: Foundation (Days 1-2)

### Objective
Establish the foundation for ephemeral context storage and reusable functions.

### Tasks

#### Task 1.1: Update ContextResolver to Check Ephemeral Contexts
**Priority**: P0 (Critical)
**Estimate**: 3 hours
**Depends On**: None

**Implementation**:
1. Add `loadEphemeralContexts()` method to ContextResolver
2. Update `getRawContext()` to check ephemeral file first
3. Update `listContexts()` to merge both sources
4. Handle missing `.brat/` directory gracefully

**Acceptance Criteria**:
- ContextResolver finds contexts in `.brat/ephemeral-contexts.yaml`
- Ephemeral contexts override architecture.yaml on name collision
- `brat context list` shows both permanent and ephemeral contexts
- No breaking changes to existing context resolution

**Files Modified**:
- `tools/brat/src/context/context-resolver.ts`

**Tests**:
- Unit: Load ephemeral contexts from file
- Unit: Merge permanent + ephemeral contexts
- Unit: Prioritize ephemeral over permanent
- Unit: Handle missing ephemeral file

---

#### Task 1.2: Export Helper Functions from create.ts
**Priority**: P0 (Critical)
**Estimate**: 2 hours
**Depends On**: None

**Implementation**:
1. Export `buildNonInteractive()` function
2. Export `scaffoldEnvironment()` function
3. Export `waitForPostgres()` function
4. Export `generateGlobalYaml()` function
5. Export `generateInfraYaml()` function
6. No behavioral changes - just visibility

**Acceptance Criteria**:
- All exported functions are importable from other modules
- Existing `brat context create` command still works
- No changes to function signatures
- No breaking changes

**Files Modified**:
- `tools/brat/src/commands/context/create.ts`

**Tests**:
- Integration: `brat context create` still works in interactive mode
- Integration: `brat context create` still works in non-interactive mode

---

#### Task 1.3: Implement AgentDevContextManager
**Priority**: P0 (Critical)
**Estimate**: 6 hours
**Depends On**: Tasks 1.1, 1.2

**Implementation**:
1. Create `AgentDevContextManager` class
2. Implement `provision(options)`:
   - Generate unique context name (`agent-dev-{timestamp}`)
   - Call `buildNonInteractive()` to build config
   - Write to `.brat/ephemeral-contexts.yaml`
   - Call `scaffoldEnvironment()`
   - Call `cmdSeed()` for database seeding
   - Validate readiness
3. Implement `start(contextName)`:
   - Delegate to `DockerOrchestrator.up()`
   - Wait for health checks
   - Return gateway URL
4. Implement `stop(contextName)`:
   - Delegate to `DockerOrchestrator.down()` (preserve volumes)
5. Implement `destroy(contextName)`:
   - Stop services
   - Remove Docker volumes
   - Drop PostgreSQL database
   - Delete env directory
   - Remove from ephemeral-contexts.yaml

**Acceptance Criteria**:
- Provision creates valid BEC in ephemeral storage
- Start launches all services successfully
- Stop preserves data for restart
- Destroy removes all traces (containers, volumes, DB, env files)
- All operations are idempotent
- Clear error messages for all failure modes

**Files Created**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

**Tests**:
- Unit: Context name generation (unique, valid format)
- Unit: Ephemeral storage write/read
- Integration: Provision → verify env files created
- Integration: Provision → verify DB seeded
- Integration: Start → verify services running
- Integration: Destroy → verify cleanup complete

---

#### Task 1.4: Unit Tests for Foundation
**Priority**: P0 (Critical)
**Estimate**: 4 hours
**Depends On**: Tasks 1.1, 1.2, 1.3

**Implementation**:
Write comprehensive unit tests for:
- ContextResolver ephemeral loading
- AgentDevContextManager all methods
- Edge cases (missing files, invalid configs)

**Acceptance Criteria**:
- 100% code coverage for new code
- All tests pass
- No flaky tests

**Files Created**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts`

---

## Phase 2: MCP Tools (Day 3)

### Objective
Expose agent-dev lifecycle via MCP tools with RBAC enforcement.

### Tasks

#### Task 2.1: Implement 4 MCP Tools
**Priority**: P0 (Critical)
**Estimate**: 4 hours
**Depends On**: Task 1.3

**Implementation**:
Create `tools/brat/src/dev-mcp/tools/agent-dev.ts` with:

1. `agent_dev.provision`:
   - Input: `{ name?, profile?, persistence? }`
   - Calls `agentDevManager.provision()`
   - Returns context name, gateway URL, status

2. `agent_dev.start`:
   - Input: `{ name, service? }`
   - Calls `agentDevManager.start()`
   - Returns gateway URL, service count

3. `agent_dev.stop`:
   - Input: `{ name }`
   - Calls `agentDevManager.stop()`
   - Returns success message

4. `agent_dev.destroy`:
   - Input: `{ name, confirm }`
   - Requires `confirm: true`
   - Calls `agentDevManager.destroy()`
   - Returns success message

**Acceptance Criteria**:
- All 4 tools registered in MCP server
- Tool schemas validate inputs correctly
- Clear, actionable error messages
- User-friendly success messages
- Tools return structured responses

**Files Created**:
- `tools/brat/src/dev-mcp/tools/agent-dev.ts`

**Tests**:
- Unit: Input validation for each tool
- Unit: Error handling for each tool
- Integration: MCP protocol request/response

---

#### Task 2.2: RBAC Enforcement for Agent-Dev Contexts
**Priority**: P1 (High)
**Estimate**: 3 hours
**Depends On**: Task 2.1

**Implementation**:
1. Add context name validation to all tools:
   - Only allow `agent-dev-*` pattern
   - Reject `local`, `staging`, `prod`, etc.
2. Add to tool metadata: `agentAllowlist: ['claude-code', 'aider', 'continue']`
3. Update audit logging with context operations

**Acceptance Criteria**:
- Tools reject non-agent-dev context names
- Clear error: "Cannot operate on non-agent context: staging"
- Audit log captures all agent-dev operations
- RBAC allows only whitelisted agents

**Files Modified**:
- `tools/brat/src/dev-mcp/tools/agent-dev.ts`
- `tools/brat/src/dev-mcp/audit-logger.ts`

**Tests**:
- Unit: Reject `destroy('local')`
- Unit: Reject `destroy('staging')`
- Unit: Accept `destroy('agent-dev-123')`
- Integration: Verify audit log entries

---

#### Task 2.3: MCP Tool Integration Tests
**Priority**: P1 (High)
**Estimate**: 3 hours
**Depends On**: Tasks 2.1, 2.2

**Implementation**:
Write integration tests that:
- Start dev-mcp server
- Call each tool via MCP protocol
- Verify responses
- Check side effects (files created, containers running)

**Acceptance Criteria**:
- All 4 tools callable via MCP
- Tools work with TargetConnection
- Responses match schema
- Side effects verified

**Files Created**:
- `tools/brat/src/dev-mcp/tools/agent-dev.test.ts`

---

## Phase 3: Orchestration & Lifecycle (Day 4)

### Objective
Implement full lifecycle orchestration with health checks and validation.

### Tasks

#### Task 3.1: Implement Start/Stop with Health Checks
**Priority**: P0 (Critical)
**Estimate**: 4 hours
**Depends On**: Task 2.1

**Implementation**:
1. Enhance `start()`:
   - Call `DockerOrchestrator.up()`
   - Poll PostgreSQL until ready (30s timeout)
   - Poll NATS until ready (10s timeout)
   - Verify gateway auto-discovery
   - Return connection details
2. Enhance `stop()`:
   - Call `DockerOrchestrator.down()` without volume removal
   - Verify containers stopped

**Acceptance Criteria**:
- Start waits for PostgreSQL readiness
- Start waits for NATS readiness
- Start returns gateway URL
- Start times out gracefully if services don't start
- Stop preserves volumes for restart

**Files Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

**Tests**:
- Integration: Start waits for DB (mock delayed start)
- Integration: Start times out if DB never ready
- Integration: Stop preserves data
- Integration: Start after stop (restart scenario)

---

#### Task 3.2: Implement Destroy with Complete Cleanup
**Priority**: P0 (Critical)
**Estimate**: 4 hours
**Depends On**: Task 3.1

**Implementation**:
1. Enhance `destroy()`:
   - Stop all services via `DockerOrchestrator.down()`
   - Remove Docker volumes: `docker compose down -v`
   - Drop PostgreSQL database: `DROP DATABASE bitbrat_agent_dev_{timestamp}`
   - Delete env directory: `rm -rf env/agent-dev-{timestamp}/`
   - Remove from ephemeral-contexts.yaml
   - Verify cleanup complete
2. Add idempotency: safe to call destroy multiple times

**Acceptance Criteria**:
- Destroy removes all Docker containers
- Destroy removes all Docker volumes
- Destroy drops PostgreSQL database
- Destroy removes env directory
- Destroy removes ephemeral context entry
- Calling destroy twice doesn't error
- Verify no orphaned resources

**Files Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

**Tests**:
- Integration: Provision → Destroy → verify all gone
- Integration: Destroy twice (idempotency)
- Integration: Destroy checks (no containers, no volumes, no DB, no env dir)

---

#### Task 3.3: End-to-End Lifecycle Tests
**Priority**: P0 (Critical)
**Estimate**: 4 hours
**Depends On**: Tasks 3.1, 3.2

**Implementation**:
Write comprehensive E2E tests:
1. Full lifecycle: Provision → Start → Stop → Start → Destroy
2. Parallel contexts: Provision 2 → Start both → Verify isolation → Destroy both
3. Failure recovery: Provision → Start → Kill services → Start again

**Acceptance Criteria**:
- Full lifecycle completes successfully
- Parallel contexts are isolated (different DBs, ports)
- Restart after stop works
- Cleanup verified for all scenarios

**Files Created/Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts`

---

## Phase 4: Polish & Documentation (Day 5)

### Objective
Error handling, documentation, and final validation.

### Tasks

#### Task 4.1: Error Handling & User-Friendly Messages
**Priority**: P1 (High)
**Estimate**: 3 hours
**Depends On**: Phase 3

**Implementation**:
1. Audit all error paths
2. Add context-rich error messages:
   - "Failed to start PostgreSQL: Connection refused at localhost:5432. Is the postgres container running?"
   - "Context 'agent-dev-123' not found. Did you run agent_dev.provision first?"
3. Add progress indicators:
   - "Starting 22 services... (this may take 30-60 seconds)"
4. Add validation messages:
   - "✅ All services healthy"
   - "⚠️ 2 services failed to start. Run fleet.logs to diagnose."

**Acceptance Criteria**:
- Every error path has clear message
- Messages suggest remediation
- Progress feedback for long operations
- Consistent emoji usage (✅ ⚠️ ❌)

**Files Modified**:
- All agent-dev related files

---

#### Task 4.2: Documentation
**Priority**: P1 (High)
**Estimate**: 4 hours
**Depends On**: Phase 3

**Implementation**:
Create comprehensive documentation:

1. **User Guide**: `documentation/guides/agent-dev-contexts.md`
   - What is agent-dev?
   - When to use it?
   - Tool reference (4 lifecycle tools)
   - Common workflows
   - Troubleshooting

2. **Update CLAUDE.md**:
   - Add agent-dev section
   - Link to user guide
   - Example usage

3. **API Reference**:
   - Document each MCP tool
   - Input schemas
   - Output formats
   - Examples

**Acceptance Criteria**:
- User guide published
- CLAUDE.md updated
- All tools documented
- Examples are copy-pasteable

**Files Created/Modified**:
- `documentation/guides/agent-dev-contexts.md` (NEW)
- `CLAUDE.md` (MODIFY)

---

#### Task 4.3: Final Validation & Cleanup
**Priority**: P1 (High)
**Estimate**: 2 hours
**Depends On**: Tasks 4.1, 4.2

**Implementation**:
1. Run full test suite
2. Manual E2E test with Claude Code
3. Verify no orphaned resources
4. Check code coverage
5. Update `.gitignore` to include `.brat/`
6. Create demo video (optional)

**Acceptance Criteria**:
- All tests pass
- Code coverage >90% for new code
- Manual E2E works
- `.gitignore` updated
- No orphaned resources after destroy

**Files Modified**:
- `.gitignore`

---

## Testing Strategy

### Test Pyramid

```
     /\
    /E2E\          5 tests (Full lifecycle scenarios)
   /------\
  /  INT   \       15 tests (MCP tools, orchestration)
 /----------\
/    UNIT    \     30 tests (Functions, validation, edge cases)
--------------
```

### Test Categories

**Unit Tests** (30 tests, 50% of time):
- Context name generation
- Ephemeral storage read/write
- Input validation
- RBAC checks
- Helper function behavior

**Integration Tests** (15 tests, 30% of time):
- MCP tool calls
- Docker orchestration
- Database seeding
- File system operations
- Health checks

**E2E Tests** (5 tests, 20% of time):
- Full provision → start → stop → destroy
- Parallel contexts
- Restart scenarios
- Failure recovery
- Cleanup validation

### CI/CD Integration

- Run tests on every commit
- Block merge if tests fail
- Require code coverage >90%
- Run E2E tests nightly (resource-intensive)

---

## Risk Management

### Critical Risks

| Risk | Mitigation | Owner |
|------|------------|-------|
| Docker resource exhaustion | Limit to 1 active context per agent session | Lead Dev |
| Incomplete cleanup | Comprehensive destroy tests, manual verification | Lead Dev |
| PostgreSQL seed failures | Retry logic, clear error messages | Lead Dev |
| Context name collisions | Timestamp + random suffix, uniqueness check | Lead Dev |

### Contingency Plans

**If PostgreSQL seeding fails**:
- Log warning, don't block provision
- Agent can manually seed later via `persistence.query`

**If Docker orchestration hangs**:
- 60-second timeout on all Docker operations
- Clear timeout error message
- Allow manual recovery via `brat docker down --context <name>`

**If ephemeral contexts not found**:
- Graceful fallback to architecture.yaml
- Warning message: "Ephemeral contexts file not found, using architecture.yaml"

---

## Definition of Done

### Per-Task DoD
- [ ] Code written and reviewed
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Code coverage >90%
- [ ] Error handling complete
- [ ] Documentation updated
- [ ] No new linter warnings

### Sprint DoD
- [ ] All P0 tasks completed
- [ ] All P1 tasks completed
- [ ] Full E2E test passes
- [ ] User guide published
- [ ] CLAUDE.md updated
- [ ] Manual testing with Claude Code successful
- [ ] No orphaned resources after destroy
- [ ] Code merged to main branch

---

## Rollout Plan

### Phase 1: Internal Testing (Day 5 afternoon)
- Manual testing by implementor
- Test with Claude Code locally
- Verify cleanup guarantees

### Phase 2: Documentation Review (Day 5 evening)
- Stakeholder reviews user guide
- Verify examples work
- Collect feedback

### Phase 3: Merge & Deploy (Day 6)
- Create PR with all changes
- Code review
- Merge to main
- Announce in changelog

---

## Success Metrics

### Functional Metrics
- Agent provisions context in <60 seconds ✅
- All 20+ services start successfully ✅
- Zero orphaned resources after destroy ✅
- Agent can query DB via persistence tools ✅
- Agent can stream logs via fleet tools ✅

### Quality Metrics
- Code coverage >90% ✅
- All tests pass ✅
- Zero critical bugs ✅
- Clear error messages for all failure modes ✅

### Operational Metrics
- Documentation completeness: 100% ✅
- User guide readability: Approved by stakeholder ✅
- Example accuracy: All examples work ✅

---

## Appendix: Quick Reference

### Key Files

**New Files**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`
- `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts`
- `tools/brat/src/dev-mcp/tools/agent-dev.ts`
- `tools/brat/src/dev-mcp/tools/agent-dev.test.ts`
- `.brat/ephemeral-contexts.yaml` (gitignored, auto-generated)
- `documentation/guides/agent-dev-contexts.md`

**Modified Files**:
- `tools/brat/src/context/context-resolver.ts`
- `tools/brat/src/commands/context/create.ts`
- `tools/brat/src/dev-mcp/server.ts`
- `tools/brat/src/dev-mcp/audit-logger.ts`
- `CLAUDE.md`
- `.gitignore`

### Command Reference

```bash
# Provision agent-dev context (via MCP)
agent_dev.provision({ profile: 'dev', persistence: 'postgres' })

# Start services (via MCP)
agent_dev.start({ name: 'agent-dev-1721745296' })

# Check status (existing tool)
fleet.info({ bit: 'llm-bot', context: 'agent-dev-1721745296' })

# Stream logs (existing tool)
fleet.logs({ bit: 'event-router', context: 'agent-dev-1721745296', level: ['error', 'warn'] })

# Destroy context (via MCP)
agent_dev.destroy({ name: 'agent-dev-1721745296', confirm: true })
```

---

**End of Execution Plan**
