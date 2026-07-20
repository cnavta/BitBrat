# Sprint 350: Testing & Remediation Strategy
## Agent-Dev Context Bootstrap Validation Framework

**Purpose**: Define comprehensive testing approach for validating agent-dev context bootstrap and establishing patterns for future context deployments.

---

## Testing Philosophy

### Principles
1. **Test Early, Test Often**: Validate each phase before proceeding
2. **Fail Fast**: Catch configuration errors before services start
3. **Automated Where Possible**: Prefer automated checks over manual validation
4. **Document Everything**: Every failure teaches us how to improve bootstrap process

### Testing Levels
- **L1 - Configuration Validation**: Files exist, syntax is correct, values are reasonable
- **L2 - Component Health**: Individual services start and respond to health checks
- **L3 - Integration**: Services can communicate with each other
- **L4 - End-to-End**: Full message flows work as expected
- **L5 - Multi-Context**: Multiple contexts can coexist without interference

---

## Phase 1: Configuration Validation Tests

### L1-001: Context Definition Schema Validation
```bash
brat config validate
```
**Expected**: No schema errors, agent-dev context is valid
**On Failure**: Fix architecture.yaml syntax errors
**Remediation**: Review execution context schema, validate against examples

### L1-002: Environment File Existence
```bash
ls -la env/agent-dev/global.yaml
ls -la env/agent-dev/infra.yaml
ls -la .secure.agent-dev
```
**Expected**: All files exist and are readable
**On Failure**: Create missing files
**Remediation**: Run `brat context create agent-dev` if files are missing, or copy from template

### L1-003: Environment File Syntax Validation
```bash
node -e "require('js-yaml').load(require('fs').readFileSync('env/agent-dev/global.yaml', 'utf8'))"
node -e "require('js-yaml').load(require('fs').readFileSync('env/agent-dev/infra.yaml', 'utf8'))"
```
**Expected**: No YAML parse errors
**On Failure**: Fix YAML syntax
**Remediation**: Use YAML linter, check indentation and special characters

### L1-004: Required Environment Variables Present
```bash
brat context show agent-dev --raw | grep -E "POSTGRES_PASSWORD|MCP_AUTH_TOKEN|COMPOSE_PROJECT_NAME"
```
**Expected**: All required variables are set
**On Failure**: Add missing variables to .secure.agent-dev or global.yaml
**Remediation**:
- `POSTGRES_PASSWORD`: Generate with `openssl rand -base64 32`
- `MCP_AUTH_TOKEN`: Generate with `openssl rand -base64 32`
- `COMPOSE_PROJECT_NAME`: Should be `bitbrat-agent-dev`

### L1-005: Context Resolution Test
```bash
brat context show agent-dev
```
**Expected**: Context resolves without errors, shows deployment and runtime config
**On Failure**: Check ContextResolver logs, fix architecture.yaml
**Remediation**: Verify executionContexts.agent-dev exists in architecture.yaml

---

## Phase 2: Infrastructure Health Tests

### L2-001: Docker Daemon Connectivity
```bash
docker info
```
**Expected**: Docker daemon is running and responsive
**On Failure**: Start Docker daemon
**Remediation**: `systemctl start docker` or start Docker Desktop

### L2-002: Docker Network Creation
```bash
docker network inspect bitbrat-agent-dev-network || echo "Network does not exist"
```
**Expected**: Network exists or can be created
**On Failure**: Create network manually
**Remediation**: `docker network create bitbrat-agent-dev-network --label bitbrat-platform=true`

### L2-003: PostgreSQL Container Start
```bash
brat docker up --context agent-dev --service postgres --dry-run
```
**Expected**: Dry-run shows correct compose command with `-p bitbrat-agent-dev`
**On Failure**: Check docker.ts context resolution
**Remediation**: Verify `brat use agent-dev` sets current context correctly

### L2-004: PostgreSQL Container Health
```bash
brat docker up --context agent-dev --service postgres
docker ps | grep bitbrat-agent-dev_postgres
```
**Expected**: Container is running and healthy
**On Failure**: Check docker logs
**Remediation**:
```bash
docker logs bitbrat-agent-dev_postgres_1
# Common issues:
# - Port already in use: Change POSTGRES_PORT in global.yaml
# - Invalid credentials: Check POSTGRES_PASSWORD in .secure.agent-dev
# - Volume permission issues: Remove volume and recreate
```

### L2-005: PostgreSQL Connection Test
```bash
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" -c "SELECT version();"
```
**Expected**: Connection succeeds, PostgreSQL version is displayed
**On Failure**: Check connection string and credentials
**Remediation**:
- Verify POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD
- Check if PostgreSQL is exposing the correct port
- Test with: `docker exec bitbrat-agent-dev_postgres_1 psql -U bitbrat -c "SELECT 1;"`

### L2-006: PostgreSQL Schema Validation
```bash
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" -c "\dt"
```
**Expected**: Required tables exist (events, mcp_servers, routing_slips, etc.)
**On Failure**: Run schema migrations
**Remediation**:
```bash
cd infrastructure/postgres/migrations
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" -f 001_initial_schema.sql
```

### L2-007: NATS Container Start & Health
```bash
brat docker up --context agent-dev --service nats
docker ps | grep bitbrat-agent-dev_nats
```
**Expected**: NATS container is running
**On Failure**: Check docker logs
**Remediation**: Similar to PostgreSQL troubleshooting

### L2-008: NATS Connectivity Test
```bash
docker exec bitbrat-agent-dev_nats_1 nats-server --version
```
**Expected**: NATS server version is displayed
**On Failure**: Container is not healthy
**Remediation**: Check NATS logs, verify JetStream is enabled

---

## Phase 3: Service Integration Tests

### L3-001: Tool Gateway Start
```bash
brat docker up --context agent-dev --service tool-gateway
```
**Expected**: tool-gateway container starts without errors
**On Failure**: Check service logs
**Remediation**:
```bash
brat docker logs --context agent-dev --service tool-gateway --follow
# Common issues:
# - PostgreSQL connection failed: Verify DATABASE_URL
# - MCP_AUTH_TOKEN missing: Add to .secure.agent-dev
# - Port conflict: Change TOOL_GATEWAY_PORT in global.yaml
```

### L3-002: Tool Gateway Health Check
```bash
curl -f http://localhost:${TOOL_GATEWAY_PORT}/health || echo "Health check failed"
```
**Expected**: HTTP 200 response with health status
**On Failure**: Gateway is not healthy
**Remediation**: Check PostgreSQL connectivity, verify MCP auth token

### L3-003: Tool Gateway MCP Registration
```bash
brat fleet list --context agent-dev
```
**Expected**: tool-gateway appears in fleet list
**On Failure**: Service did not register in mcp_servers table
**Remediation**:
- Check PostgreSQL connection from tool-gateway
- Verify `mcp_servers` table exists
- Check service logs for registration errors

### L3-004: API Gateway Start & Registration
```bash
brat docker up --context agent-dev --service api-gateway
brat fleet list --context agent-dev | grep api-gateway
```
**Expected**: api-gateway appears in fleet list
**On Failure**: Same remediation as tool-gateway

### L3-005: Event Router Start & Registration
```bash
brat docker up --context agent-dev --service event-router
brat fleet list --context agent-dev | grep event-router
```
**Expected**: event-router appears in fleet list
**On Failure**: Check NATS connectivity, PostgreSQL connection

### L3-006: Inter-Service Communication Test
```bash
brat fleet info tool-gateway --context agent-dev
```
**Expected**: `bit.info` response from tool-gateway
**On Failure**: MCP communication is broken
**Remediation**:
- Verify MCP_AUTH_TOKEN is correct
- Check network connectivity between services
- Verify tool-gateway MCP server is listening

---

## Phase 4: End-to-End Functional Tests

### L4-001: Chat Message Ingestion
```bash
brat chat --context agent-dev --message "test" --user "test-user"
```
**Expected**: Message is processed, response is received
**On Failure**: Check entire event pipeline
**Remediation**:
- Verify ingress-egress service is running
- Check event-router is processing messages
- Verify NATS topics are created
- Check PostgreSQL events table for message persistence

### L4-002: Event Persistence Verification
```bash
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" \
  -c "SELECT COUNT(*) FROM events WHERE created_at > NOW() - INTERVAL '1 minute';"
```
**Expected**: Recent events are persisted in database
**On Failure**: Persistence layer is not working
**Remediation**:
- Check persistence service logs
- Verify NATS subscription is active
- Check database connection

### L4-003: MCP Tool Invocation Test
```bash
brat fleet health --all --context agent-dev
```
**Expected**: All services respond with health status
**On Failure**: Some services are not responding to MCP calls
**Remediation**:
- Check individual service health
- Verify MCP auth tokens match
- Check network connectivity

### L4-004: Routing Slip Processing Test
```bash
# Send message and verify routing slip was processed
brat chat --context agent-dev --message "analyze this" --user "test"
# Check routing_slips table
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" \
  -c "SELECT * FROM routing_slips ORDER BY created_at DESC LIMIT 5;"
```
**Expected**: Routing slips are created and processed
**On Failure**: Event-router is not attaching routing slips
**Remediation**: Check event-router rules, verify JsonLogic evaluation

---

## Phase 5: Multi-Context Isolation Tests

### L5-001: Parallel Context Bring-Up
```bash
# Bring up local context
brat use local
brat docker up --context local --service postgres

# Bring up agent-dev context
brat use agent-dev
brat docker up --context agent-dev --service postgres

# Verify both are running
docker ps | grep postgres
```
**Expected**: Two separate postgres containers running (bitbrat-local_postgres, bitbrat-agent-dev_postgres)
**On Failure**: Contexts are interfering with each other
**Remediation**: Verify COMPOSE_PROJECT_NAME is different for each context

### L5-002: Database Isolation Verification
```bash
# Write to local context
brat use local
psql "postgresql://bitbrat:${POSTGRES_PASSWORD_LOCAL}@localhost:5432/bitbrat" \
  -c "INSERT INTO events (id, correlation_id, payload) VALUES ('test-local', 'local-test', '{}');"

# Verify not visible in agent-dev
brat use agent-dev
psql "postgresql://bitbrat:${POSTGRES_PASSWORD}@localhost:5432/bitbrat" \
  -c "SELECT COUNT(*) FROM events WHERE id = 'test-local';"
```
**Expected**: Count is 0 (databases are isolated)
**On Failure**: Contexts are sharing database
**Remediation**: Verify different POSTGRES_PORT or different database names

### L5-003: Port Conflict Detection
```bash
# Check for port conflicts
netstat -an | grep LISTEN | grep -E "5432|4222|3000|3004"
```
**Expected**: Each context uses different ports
**On Failure**: Port conflicts exist
**Remediation**: Update port assignments in global.yaml files

### L5-004: Context Switching Test
```bash
brat use local
brat context show local | grep "name: local"
brat use agent-dev
brat context show agent-dev | grep "name: agent-dev"
cat ~/.bratrc | grep current_context
```
**Expected**: Current context switches correctly, ~/.bratrc is updated
**On Failure**: Context switching is not persisted
**Remediation**: Check bratrc.ts implementation

---

## Automated Test Suite

### Create Validation Script
```bash
#!/bin/bash
# tools/brat/scripts/validate-context.sh
# Usage: validate-context.sh agent-dev

CONTEXT=$1
echo "=== Validating context: $CONTEXT ==="

# L1 Tests
echo "[L1-001] Schema validation..."
npm run brat -- config validate || exit 1

echo "[L1-002] File existence..."
test -f "env/$CONTEXT/global.yaml" || { echo "FAIL: global.yaml missing"; exit 1; }
test -f ".secure.$CONTEXT" || { echo "FAIL: .secure.$CONTEXT missing"; exit 1; }

echo "[L1-003] YAML syntax..."
node -e "require('js-yaml').load(require('fs').readFileSync('env/$CONTEXT/global.yaml', 'utf8'))" || exit 1

echo "[L1-004] Required variables..."
npm run brat -- context show $CONTEXT --raw | grep -q POSTGRES_PASSWORD || { echo "FAIL: POSTGRES_PASSWORD missing"; exit 1; }

# L2 Tests
echo "[L2-001] Docker connectivity..."
docker info > /dev/null 2>&1 || { echo "FAIL: Docker not running"; exit 1; }

echo "[L2-003] PostgreSQL start (dry-run)..."
npm run brat -- docker up --context $CONTEXT --service postgres --dry-run | grep -q "bitbrat-$CONTEXT" || { echo "FAIL: Wrong project name"; exit 1; }

echo "=== All validation tests passed ==="
```

### Usage
```bash
chmod +x tools/brat/scripts/validate-context.sh
./tools/brat/scripts/validate-context.sh agent-dev
```

---

## Common Failure Scenarios & Remediation

### Scenario 1: "PostgreSQL connection refused"
**Symptoms**: Services fail to start, logs show "ECONNREFUSED localhost:5432"
**Root Cause**: PostgreSQL container not running or wrong port
**Remediation**:
1. Check if postgres container is running: `docker ps | grep postgres`
2. Verify port mapping: `docker port bitbrat-agent-dev_postgres_1`
3. Check POSTGRES_HOST and POSTGRES_PORT in global.yaml
4. Test connection: `psql "postgresql://bitbrat:PASSWORD@localhost:5432/bitbrat"`

### Scenario 2: "MCP auth token mismatch"
**Symptoms**: Fleet commands fail with "Unauthorized" or "Forbidden"
**Root Cause**: MCP_AUTH_TOKEN in .secure.agent-dev doesn't match service configuration
**Remediation**:
1. Generate new token: `openssl rand -base64 32`
2. Update .secure.agent-dev: `MCP_AUTH_TOKEN=<token>`
3. Restart all services: `brat docker down --context agent-dev && brat docker up --context agent-dev`

### Scenario 3: "Table does not exist"
**Symptoms**: Services crash on startup, logs show "relation 'mcp_servers' does not exist"
**Root Cause**: PostgreSQL schema not initialized
**Remediation**:
1. Locate migration files: `ls infrastructure/postgres/migrations/`
2. Run migrations: `psql "postgresql://bitbrat:PASSWORD@localhost:5432/bitbrat" -f infrastructure/postgres/migrations/001_initial_schema.sql`
3. Verify tables: `psql "postgresql://bitbrat:PASSWORD@localhost:5432/bitbrat" -c "\dt"`

### Scenario 4: "Port already in use"
**Symptoms**: Container fails to start, logs show "bind: address already in use"
**Root Cause**: Another service (or context) is using the same port
**Remediation**:
1. Find conflicting process: `lsof -i :PORT`
2. Either stop the conflicting service or change port in global.yaml
3. Update port variable (e.g., TOOL_GATEWAY_PORT: 3005)
4. Restart service

### Scenario 5: "Context not found"
**Symptoms**: `brat context show agent-dev` fails with "Context 'agent-dev' not found"
**Root Cause**: executionContexts.agent-dev missing from architecture.yaml
**Remediation**:
1. Run: `brat context create agent-dev` to regenerate
2. Or manually add to architecture.yaml under executionContexts

---

## Success Metrics

### Quantitative Metrics
- **Configuration Tests**: 5/5 pass (L1-001 through L1-005)
- **Infrastructure Tests**: 8/8 pass (L2-001 through L2-008)
- **Integration Tests**: 6/6 pass (L3-001 through L3-006)
- **Functional Tests**: 4/4 pass (L4-001 through L4-004)
- **Isolation Tests**: 4/4 pass (L5-001 through L5-004)
- **Total Pass Rate**: 27/27 tests (100%)

### Qualitative Metrics
- Bootstrap process is documented and repeatable
- Common failures have clear remediation steps
- Agent-dev context can be brought up in < 15 minutes
- No manual intervention required after initial .secure file creation

---

## Continuous Validation

### Daily Health Checks
```bash
# Add to cron or CI
brat fleet health --all --context agent-dev
brat fleet info tool-gateway --context agent-dev
```

### Weekly Full Validation
```bash
# Run complete test suite
./tools/brat/scripts/validate-context.sh agent-dev
```

### On Each Code Change
```bash
# In CI pipeline
npm test
npm run brat -- config validate
npm run brat -- docker up --context agent-dev --dry-run --service tool-gateway
```
