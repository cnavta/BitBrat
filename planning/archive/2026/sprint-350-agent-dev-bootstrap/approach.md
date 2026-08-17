# Sprint 350: Agent-Dev Context Bootstrap & Validation
## Implementation Approach

**Sprint Goal**: Bring up the agent-dev execution context from scratch, validate all components work correctly, and document the process to ensure future contexts can be bootstrapped reliably.

**Lead Implementor**: Claude (Coding Agent)
**Sprint Branch**: `feature/sprint-350-agent-dev-bootstrap`
**Context Owner**: Coding Agent (100% agent-owned environment)

---

## Phase 1: Discovery & Current State Assessment

### Objectives
- Understand what already exists for agent-dev context
- Identify gaps between configuration and running infrastructure
- Document baseline state before any changes

### Tasks

1. **Configuration Audit**
   - Review `env/agent-dev/global.yaml` - what's configured vs what's needed
   - Review `env/agent-dev/infra.yaml` - infrastructure service definitions
   - Check if `.secure.agent-dev` exists or needs creation
   - Verify `architecture.yaml` executionContexts.agent-dev definition

2. **Infrastructure State Check**
   - Check if any agent-dev containers are running (`docker ps`)
   - Check if agent-dev docker network exists
   - Check if agent-dev PostgreSQL database exists and is accessible
   - Check if agent-dev volumes exist

3. **Context Resolution Validation**
   - Test `brat context show agent-dev` - does it resolve correctly?
   - Test context switching with `brat use agent-dev`
   - Verify `~/.bratrc` correctly stores current context

### Deliverables
- Current state snapshot document
- Gap analysis: what's configured vs what exists
- List of missing components needed for full bring-up

---

## Phase 2: Secrets & Credentials Bootstrap

### Objectives
- Create `.secure.agent-dev` file with all required secrets
- Ensure PostgreSQL credentials are generated and stored
- Ensure MCP auth token is configured

### Tasks

1. **Create .secure.agent-dev**
   - Base it on `.secure.local` template
   - Generate unique `POSTGRES_PASSWORD` for agent-dev
   - Generate unique `MCP_AUTH_TOKEN` for agent-dev
   - Set `BITBRAT_API_TOKEN` (can reuse from local or generate new)
   - Configure any platform-specific secrets (Twilio, Discord, etc. - optional for agent env)

2. **Validate Secret Resolution**
   - Test that `brat context show agent-dev --raw` shows resolved secrets
   - Verify ContextResolver merges secrets correctly

### Deliverables
- `.secure.agent-dev` file (gitignored)
- Documentation of secret generation process
- Validation that secrets are resolved correctly

---

## Phase 3: Infrastructure Bring-Up

### Objectives
- Bring up agent-dev docker-compose stack
- Verify all core infrastructure services start correctly
- Validate service health and connectivity

### Tasks

1. **Database Bootstrap**
   ```bash
   brat docker up --context agent-dev --service postgres
   ```
   - Verify PostgreSQL container starts with correct project name (`bitbrat-agent-dev_postgres_1`)
   - Verify database is created (`bitbrat` database)
   - Test connection with credentials from `.secure.agent-dev`
   - Run schema migrations if needed

2. **Message Bus Bootstrap**
   ```bash
   brat docker up --context agent-dev --service nats
   ```
   - Verify NATS container starts
   - Test NATS connectivity (port 4222)
   - Verify JetStream is enabled

3. **Infrastructure Stack Validation**
   ```bash
   brat docker up --context agent-dev
   ```
   - Bring up all infrastructure services (postgres, nats, firebase-emulator if needed)
   - Verify all containers are healthy
   - Check logs for startup errors

### Deliverables
- Running infrastructure stack for agent-dev
- Health check results for all infrastructure services
- Connection test results (postgres, nats)

---

## Phase 4: Core Platform Services Bring-Up

### Objectives
- Bring up essential platform services (tool-gateway, event-router, etc.)
- Validate service registration and discovery
- Test inter-service communication

### Tasks

1. **Gateway Services**
   ```bash
   brat docker up --context agent-dev --service tool-gateway
   brat docker up --context agent-dev --service api-gateway
   ```
   - Verify gateways start and register with PostgreSQL
   - Test MCP tool discovery via tool-gateway
   - Validate gateway health endpoints

2. **Core Platform Services**
   ```bash
   brat docker up --context agent-dev --service event-router
   brat docker up --context agent-dev --service persistence
   ```
   - Verify services start and connect to postgres/nats
   - Check service logs for errors
   - Verify services register in `mcp_servers` table

3. **Service Discovery Validation**
   ```bash
   brat fleet list --context agent-dev
   brat fleet info --all --context agent-dev
   ```
   - Verify all services are discovered
   - Check MCP exposure levels are correct
   - Validate `bit.info` responses from each service

### Deliverables
- All core platform services running
- Fleet discovery working correctly
- Service health validation report

---

## Phase 5: End-to-End Validation

### Objectives
- Test full message flow through the platform
- Validate agent can interact with the platform
- Ensure all critical paths work

### Tasks

1. **Chat Flow Test**
   ```bash
   brat chat --context agent-dev --message "test message" --user "agent-test"
   ```
   - Verify message is ingested
   - Check event-router processes message
   - Validate response is delivered

2. **MCP Tool Invocation Test**
   - Use `brat fleet` to call tools on running services
   - Test `bit.info`, `bit.health`, `bit.config.get`
   - Verify tool responses are correct

3. **Data Persistence Test**
   - Send events through the system
   - Query PostgreSQL to verify events are persisted
   - Check event tables: `events`, `routing_slips`, `annotations`

4. **Multi-Context Isolation Test**
   - Bring up local context alongside agent-dev
   - Verify containers are isolated (different project names)
   - Verify databases are isolated
   - Test switching contexts with `brat use`

### Deliverables
- End-to-end test results
- Multi-context isolation validation
- List of any issues discovered

---

## Phase 6: Bootstrap Process Documentation

### Objectives
- Document exact steps to bring up a new context from scratch
- Create automation scripts where beneficial
- Update `brat context create` to handle bootstrap better

### Tasks

1. **Create Bootstrap Checklist**
   - Document step-by-step process
   - Include verification steps at each stage
   - Note common pitfalls and solutions

2. **Identify Automation Opportunities**
   - What can be automated in `brat context create`?
   - Should we create a `brat context bootstrap` command?
   - Can we auto-generate `.secure.*` templates?

3. **Update Context Creation**
   - Enhance `brat context create` to scaffold more files
   - Add `--bootstrap` flag to bring up infrastructure immediately
   - Improve error messages and validation

### Deliverables
- Complete bootstrap guide document
- Updated `brat context create` implementation (if needed)
- Automation recommendations

---

## Success Criteria

### Must Have (P0)
✅ Agent-dev context can be brought up from scratch
✅ All core infrastructure services run correctly
✅ PostgreSQL database is accessible and schema is created
✅ Fleet discovery shows all running services
✅ End-to-end message flow works
✅ Multi-context isolation is validated
✅ Bootstrap process is fully documented

### Should Have (P1)
✅ `brat context create` generates better scaffolding
✅ Bootstrap checklist is available for future contexts
✅ Common bootstrap errors have clear remediation steps
✅ Agent-dev can run alongside local without conflicts

### Nice to Have (P2)
- `brat context bootstrap` command for one-command bring-up
- Auto-generation of `.secure.*` files with random secrets
- Health dashboard showing context status
- Automated smoke tests for new contexts

---

## Risk Mitigation

### Risk: PostgreSQL connection failures
**Mitigation**: Test connection string resolution early, validate credentials before full bring-up

### Risk: Port conflicts between contexts
**Mitigation**: Use dynamic port allocation, document port ranges per context

### Risk: Missing environment variables
**Mitigation**: Create comprehensive `.secure.*` template, validate before starting services

### Risk: Schema migration issues
**Mitigation**: Document current schema version, test migrations in isolation first

### Risk: Service registration failures
**Mitigation**: Add retry logic, improve error messages, validate PostgreSQL connectivity first

---

## Rollback Plan

If agent-dev bring-up fails:
1. **Clean shutdown**: `brat docker down --context agent-dev`
2. **Remove volumes**: `docker volume rm $(docker volume ls -q | grep bitbrat-agent-dev)`
3. **Remove network**: `docker network rm bitbrat-agent-dev-network`
4. **Reset context**: `brat use local`
5. **Investigate**: Review logs, fix issues, retry

---

## Timeline Estimate

- **Phase 1 (Discovery)**: 30 minutes
- **Phase 2 (Secrets)**: 20 minutes
- **Phase 3 (Infrastructure)**: 45 minutes
- **Phase 4 (Services)**: 1 hour
- **Phase 5 (Validation)**: 45 minutes
- **Phase 6 (Documentation)**: 1 hour

**Total Estimate**: 4-5 hours for complete sprint
