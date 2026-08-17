# Sprint 367: Agent-Dev Environment MCP Administration

**Sprint Goal:** Ensure agent-dev execution contexts can be fully provisioned, started, and administered via MCP tools without manual intervention.

## Current State Analysis

### What Works ✅
- Agent-dev context provisioning via `agent_dev.provision()`
- Docker Compose file generation for agent-dev contexts
- Environment YAML scaffolding in `env/agent-dev-*/`
- Manual startup via `brat docker up --context agent-dev-*`
- All services start and become healthy when using brat CLI

### Critical Issues Discovered 🔴

#### 1. MCP `agent_dev.start()` fails to generate `.env.brat`
- **Symptom:** Services exit with `ENOTFOUND nats` DNS errors
- **Root Cause:** The MCP start tool doesn't call the Docker orchestrator's environment resolution logic
- **Impact:** Prevents automated agent-dev startup via MCP
- **Location:** `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

The Docker orchestrator in `tools/brat/src/orchestration/docker/orchestrator.ts` has this critical step:
```typescript
const envContent = EnvironmentResolver.flattenToDotEnv(mergedEnv);
const tempEnvPath = '.env.brat';
fs.writeFileSync(fullEnvPath, envContent);
```

But the MCP tool bypasses this and calls docker compose directly without generating the env file first.

#### 2. No routing rules seeded in agent-dev PostgreSQL
- **Symptom:** Event-router loads 0 rules, all messages go to DLQ
- **Root Cause:** Agent-dev contexts are not seeded with baseline routing rules
- **Impact:** Platform cannot process chat messages or any events
- **Evidence:** `"rule_loader.warm_loaded","count":0,"backend":"postgres"`

#### 3. MCP fleet tools don't recognize agent-dev contexts
- **Symptom:** `fleet_list`, `fleet_info`, etc. fail with "Unknown execution context"
- **Root Cause:** Ephemeral contexts stored in `.brat/ephemeral-contexts.yaml` not loaded by MCP server runtime
- **Impact:** Cannot administer agent-dev services via MCP tools

#### 4. NATS stream initialization fails from host
- **Symptom:** `npm run init-streams` fails with "invalid json: unknown field 'replicas'"
- **Root Cause:** Stream config incompatible or streams already exist with different config
- **Impact:** Cannot initialize JetStream from host machine

## Implementation Plan

### Phase 1: Fix MCP `agent_dev.start()` Environment Generation

**Files to modify:**
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

**Changes:**
1. Import `EnvironmentResolver` from `../orchestration/docker/environment-resolver`
2. Import `ExecutionContextLoader` to load context config
3. Before calling docker compose:
   - Load execution context from ephemeral-contexts.yaml
   - Resolve environment using `EnvironmentResolver.resolve()`
   - Flatten to dotenv format using `EnvironmentResolver.flattenToDotEnv()`
   - Write to `.env.brat` at repo root
   - Also write to `infrastructure/docker-compose/.env.brat` for nested compose files

**Acceptance Criteria:**
- `agent_dev.start()` generates `.env.brat` before starting containers
- All services start successfully without DNS errors
- No manual `brat docker up` required

### Phase 2: Auto-Seed Agent-Dev PostgreSQL Database

**Files to modify:**
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` (provision or start)
- `tools/brat/src/seeding/postgres-seed-writer.ts` (use existing seeding logic)

**Changes:**
1. After PostgreSQL container is healthy, run seeding:
   - Load seed data from `tools/brat/src/seeding/seed-data.ts`
   - Use `PostgresSeedWriter` to insert routing rules, users, etc.
   - Connect using `postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat`

2. Alternative: Run migration/seed SQL scripts from `infrastructure/postgres/`

**Acceptance Criteria:**
- Fresh agent-dev contexts have routing rules loaded
- Event-router logs show `"rule_loader.warm_loaded","count":N` where N > 0
- Chat messages are routed through the pipeline (not to DLQ)

### Phase 3: Enable MCP Fleet Tools for Agent-Dev Contexts

**Files to modify:**
- `tools/brat/src/dev-mcp/server.ts` (MCP server initialization)
- `tools/brat/src/fleet/registry-factory.ts` (if needed)

**Changes:**
1. Load ephemeral contexts from `.brat/ephemeral-contexts.yaml` during MCP server startup
2. Merge ephemeral contexts with `architecture.yaml` contexts
3. Make context resolution aware of ephemeral contexts
4. Ensure gateway URL discovery works for agent-dev contexts

**Acceptance Criteria:**
- `fleet.list({ context: "agent-dev-*" })` returns all running Bits
- `fleet.info({ bit: "persistence", context: "agent-dev-*" })` works
- `fleet.logs({ bit: "llm-bot", context: "agent-dev-*" })` retrieves logs

### Phase 4: Fix NATS Stream Initialization

**Files to modify:**
- `tools/init-nats-streams.ts`
- `infrastructure/postgres/init/` (potentially add stream init to DB bootstrap)

**Changes:**
1. Detect existing streams and skip recreation if config matches
2. Or: Handle "replicas" field based on NATS server version/capabilities
3. Or: Initialize streams from within a container that has access to Docker network

**Acceptance Criteria:**
- `NATS_URL=nats://localhost:4222 npm run init-streams` succeeds
- Streams exist with correct subjects and BUS_PREFIX

### Phase 5: Integration Testing & Validation

**Validation Script:** `planning/sprint-367-agent-dev-mcp-admin/validate_deliverable.sh`

**Test Scenarios:**
1. **Provision → Start → Verify:**
   ```typescript
   const ctx = await agent_dev.provision();
   await agent_dev.start({ name: ctx.name });
   const fleet = await fleet.list({ context: ctx.name });
   // Assert: fleet contains all expected Bits
   ```

2. **Chat Message Flow:**
   ```bash
   DATABASE_URL="..." BITBRAT_CONTEXT=agent-dev-* \
     npm run brat -- chat --message "!ping" --user TestUser
   # Assert: Receives "pong" response (not timeout)
   ```

3. **Fleet Administration:**
   ```typescript
   await fleet.info({ bit: "event-router", context: "agent-dev-*" });
   await fleet.logs({ bit: "llm-bot", context: "agent-dev-*", limit: 50 });
   // Assert: Both succeed with valid data
   ```

4. **Destroy → Cleanup:**
   ```typescript
   await agent_dev.destroy({ name: ctx.name, confirm: true });
   // Assert: All containers, volumes, networks removed
   // Assert: env/agent-dev-*/ directory removed
   // Assert: docker-compose.agent-dev-*.yaml removed
   ```

**Acceptance Criteria:**
- All test scenarios pass without manual intervention
- Agent-dev lifecycle fully automated via MCP tools
- Documentation updated to reflect working state

## Out of Scope

- Cloud deployment of agent-dev contexts (remains local-only)
- Multi-tenant isolation (shared PostgreSQL database acceptable)
- Performance optimization (focus on functionality first)

## Success Metrics

1. ✅ `agent_dev.start()` success rate: 100%
2. ✅ Routing rules loaded: > 0 on fresh provision
3. ✅ Fleet tools work for agent-dev contexts
4. ✅ Chat command completes without timeout
5. ✅ All validation tests pass

## Timeline

- **Phase 1:** 2 hours (critical path - blocks everything else)
- **Phase 2:** 1.5 hours (database seeding)
- **Phase 3:** 2 hours (MCP context awareness)
- **Phase 4:** 1 hour (NATS streams - low priority)
- **Phase 5:** 1.5 hours (validation & testing)

**Total Estimated Effort:** 8 hours

## Dependencies

- Existing Docker orchestrator logic (reuse, don't rewrite)
- Existing seeding infrastructure (PostgresSeedWriter)
- Ephemeral context YAML format (already defined)

## Risks

1. **Environment resolution complexity:** May need to handle edge cases in variable interpolation
2. **PostgreSQL connection timing:** Seed script may need retry logic if DB not fully ready
3. **MCP server context loading:** May require refactoring context resolution logic

## Rollback Plan

- If Phase 1-3 break existing functionality, revert MCP changes
- Manual `brat docker up` workflow remains as fallback
- Existing local/staging/prod contexts unaffected (agent-dev is isolated)

---

**Ready to Begin:** Awaiting user approval to start Phase 1.
