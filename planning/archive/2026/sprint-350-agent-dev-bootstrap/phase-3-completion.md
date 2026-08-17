# Phase 3 Complete: Infrastructure Bootstrap

**Date**: 2026-07-19
**Status**: ✅ COMPLETE

---

## Summary

Successfully brought up PostgreSQL and NATS infrastructure for agent-dev context. Both services are running, healthy, and validated.

---

## Completed Tasks

### PostgreSQL Bootstrap

1. **Created .env.brat file** manually with merged environment variables
   - Sourced from `env/agent-dev/global.yaml`
   - Sourced from `env/agent-dev/infra.yaml`
   - Sourced from `.secure.agent-dev` (secrets)
   - Copied to subdirectories for docker-compose access

2. **Brought up PostgreSQL container**
   ```bash
   docker compose -p bitbrat-agent-dev -f infrastructure/docker-compose/docker-compose.local.yaml up -d postgres
   ```
   - Container: `bitbrat-agent-dev-postgres-1`
   - Status: Healthy
   - Port: 5432 (accessible on host)
   - Volume: `bitbrat-agent-dev_postgres-data` (created)

3. **Ran schema initialization manually**
   - Init scripts didn't run automatically (mount path issue)
   - Executed `01-enable-extensions.sql` - Created pgvector, uuid-ossp, btree_gin extensions
   - Executed `02-create-tables.sql` - Created 23 tables
   - Tables verified with `\dt` command

4. **Validated PostgreSQL connection**
   ```bash
   docker exec bitbrat-agent-dev-postgres-1 psql -U bitbrat -d bitbrat -c "SELECT version();"
   ```
   - Result: PostgreSQL 15.18 running successfully

### NATS Bootstrap

1. **Brought up NATS container**
   ```bash
   docker compose -p bitbrat-agent-dev -f infrastructure/docker-compose/docker-compose.local.yaml up -d nats
   ```
   - Container: `bitbrat-agent-dev-nats-1`
   - Status: Healthy
   - Ports: 4222 (client), 8222 (monitoring)
   - Volume: `bitbrat-agent-dev_nats-data` (created)
   - JetStream: Enabled

2. **Validated NATS connectivity**
   ```bash
   docker exec bitbrat-agent-dev-nats-1 nats-server --version
   curl http://localhost:8222/varz
   ```
   - Result: NATS v2.14.2 running, monitoring endpoint responsive

---

## Key Learnings

### Issue 1: Docker Compose Volume Mount Path Resolution

**Problem**: Init scripts at `/docker-entrypoint-initdb.d` were empty in the container.

**Root Cause**: docker-compose.local.yaml uses relative path `./infrastructure/postgres/init`, but when running docker compose from project root with `-f infrastructure/docker-compose/docker-compose.local.yaml`, the relative path resolves incorrectly.

**Workaround**: Ran init scripts manually using `docker exec` with stdin redirection.

**Improvement Needed**: Update docker-compose file to use absolute paths or use `--project-directory` flag.

### Issue 2: Manual .env.brat Generation

**Problem**: `brat docker up` tries to bring up all services, not just infrastructure.

**Root Cause**: Infrastructure services (postgres, nats) are in base file, not per-service compose files. The `--service` flag only works for BitBrat services in `services/*.compose.yaml`.

**Workaround**: Manually created .env.brat by merging YAML files and .secure.agent-dev.

**Improvement Needed**: Add `brat docker infra` command to bring up only base infrastructure services.

### Issue 3: Context-Specific Environment Resolution

**Discovery**: ContextResolver correctly loads `.secure.<context>` files based on `architecture.yaml` configuration.

**Validation**: Secrets from `.secure.agent-dev` were properly formatted and could be sourced.

**Success**: Environment variable resolution works as designed - just needs to be invoked properly.

---

## Infrastructure State

### Running Containers

| Container | Status | Ports | Volume |
|-----------|--------|-------|--------|
| bitbrat-agent-dev-postgres-1 | Healthy | 5432:5432 | bitbrat-agent-dev_postgres-data |
| bitbrat-agent-dev-nats-1 | Healthy | 4222:4222, 8222:8222 | bitbrat-agent-dev_nats-data |

### PostgreSQL Schema

23 tables created and verified:
- `service_registry` (for MCP server registration)
- `events` (for event persistence)
- `routing_rules` (for event-router JsonLogic rules)
- `auth_users`, `auth_scopes` (for authentication)
- `api_tokens` (for API access)
- `context_packs` (with pgvector for RAG)
- `conversation_history`, `llm_responses` (for LLM interactions)
- `reflexes` (for reflex service)
- `state`, `mutation_log`, `snapshots` (for state-engine)
- `disposition_observations` (for disposition-service)
- `prompt_logs`, `tool_usage`, `metrics` (for observability)
- `personalities`, `integration_configs`, `sessions`, `twitch_tokens` (domain-specific)
- `user_state`, `global_state` (state management)

### NATS Configuration

- Server ID: NBWPBYWJGYXLRNLLICHA7XBU3BRFI3OQMTWFAB4SJCP62LZBOFS7B4OR
- Version: 2.14.2
- Max Connections: 65536
- Max Payload: 1MB
- JetStream: Enabled (data persisted to volume)

---

## Next Steps (Phase 4)

1. Bring up tool-gateway service
2. Verify MCP registration in `service_registry` table
3. Test MCP tool discovery
4. Validate gateway health endpoints
5. Bring up core platform services (api-gateway, event-router, persistence)
6. Verify fleet discovery with `brat fleet list --context agent-dev`

---

## Files Modified/Created

### Created

- `.secure.agent-dev` - Agent-dev secrets (POSTGRES_PASSWORD, MCP_AUTH_TOKEN, etc.)
- `.env.brat` - Merged environment file for docker-compose
- `infrastructure/docker-compose/.env.brat` - Copy for compose context
- `infrastructure/docker-compose/services/.env.brat` - Copy for services context

### Docker Resources Created

- `bitbrat-agent-dev-postgres-1` container
- `bitbrat-agent-dev-nats-1` container
- `bitbrat-agent-dev_postgres-data` volume
- `bitbrat-agent-dev_nats-data` volume
- `bitbrat-agent-dev_default` network (auto-created by compose)

---

## Test Results

### L2 Infrastructure Health Tests

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| L2-001 | Docker Daemon Connectivity | ✅ PASS | Docker daemon responsive |
| L2-002 | Docker Network Creation | ✅ PASS | Network auto-created by compose |
| L2-003 | PostgreSQL Container Start | ✅ PASS | Container started with correct project name |
| L2-004 | PostgreSQL Container Health | ✅ PASS | Healthcheck passing |
| L2-005 | PostgreSQL Connection Test | ✅ PASS | psql connection successful |
| L2-006 | PostgreSQL Schema Validation | ✅ PASS | 23/23 tables created |
| L2-007 | NATS Container Start & Health | ✅ PASS | Container healthy |
| L2-008 | NATS Connectivity Test | ✅ PASS | Monitoring endpoint responsive |

**Overall L2 Status**: 8/8 PASS

---

## Phase 3 Success Criteria

- [x] PostgreSQL container running and healthy
- [x] PostgreSQL database accessible with credentials from .secure.agent-dev
- [x] PostgreSQL schema initialized (23 tables created)
- [x] NATS container running and healthy
- [x] NATS JetStream enabled
- [x] Infrastructure uses correct project name (`bitbrat-agent-dev`)
- [x] Volumes created with context-specific names
- [x] No port conflicts with other contexts

**Phase 3 Status**: ✅ **COMPLETE**

**Ready to proceed to Phase 4**: Bring up platform services (tool-gateway, api-gateway, event-router, etc.)
