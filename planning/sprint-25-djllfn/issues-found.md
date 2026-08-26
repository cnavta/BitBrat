# Agent-Dev Environment Issues

**Sprint**: sprint-25-djllfn
**Date**: 2026-08-25
**Author**: Lead Implementor
**Status**: Initial Investigation Complete

## Executive Summary

Attempted to provision and start an agent-dev environment to test basic `!ping` functionality. The environment **failed to start** due to missing infrastructure services in the generated Docker Compose configuration. This is a **critical blocker** preventing any agent-dev usage.

## Test Scenario

**Objective**: Provision an agent-dev environment and verify `!ping` response works
**Method**:
1. Provision agent-dev context: `agent_dev.provision({ name: "agent-dev-sprint25-test" })`
2. Start services: `agent_dev.start({ name: "agent-dev-sprint25-test" })`
3. Test ping response via ingress-egress

**Result**: ❌ **BLOCKED** - Services failed to start

---

## Issue #1: Missing Infrastructure Services (CRITICAL)

**Severity**: 🔴 **CRITICAL** - Complete blocker
**Category**: Configuration Generation
**Discovered**: 2026-08-25 18:03

### Description

The agent-dev Docker Compose file (`docker-compose.agent-dev-*.yaml`) is generated **without infrastructure services** (NATS, Redis, PostgreSQL), despite all application services declaring hard dependencies on these services via `depends_on`.

### Error Output

```
service "api-gateway" depends on undefined service "nats": invalid compose project
```

### Technical Details

**Generated compose file location**:
```
infrastructure/docker-compose/docker-compose.agent-dev-sprint25-test.yaml
```

**Missing services**:
- `nats` (message bus) - **ALL** platform services depend on this
- `redis` (caching/idempotency) - Required by: ingress-egress, auth, llm-bot, reflex, claim-check
- `postgres` (persistence) - Required by: ALL services using PERSISTENCE_DRIVER=postgres

**Comparison with working `local` context**:
- ✅ `docker-compose.local.yaml` lines 13-93: Defines nats, redis, postgres with health checks
- ❌ `docker-compose.agent-dev-*.yaml`: Missing all infrastructure - only application services

### Impact

- **Cannot start agent-dev environments** - Docker Compose validation fails
- **Cannot test new features** - No way to validate changes in isolation
- **Cannot use CLAUDE.md guidance** - Documentation recommends agent-dev for all new work
- **Blocks sprint protocol compliance** - Protocol requires agent-dev validation before completion

### Root Cause (CONFIRMED via deep code analysis)

**File**: `tools/brat/src/commands/context/create.ts:521`

```typescript
const infrastructure = getRequiredInfrastructure(repoRoot, activeServices);
//                                                 ^^^^ MISSING contextName parameter!
```

The `scaffoldEnvironment()` function calls `getRequiredInfrastructure()` **without passing the `contextName` parameter**, causing it to default to `'local'` context:

```typescript
// tools/brat/src/context/parse-dependencies.ts:135-139
export function getRequiredInfrastructure(
  repoRoot: string,
  activeServices: ServiceMetadata[],
  context: string = 'local'  // <-- DEFAULTS TO 'local'
): Set<string>
```

**Execution flow**:
1. Agent-dev provision creates context `agent-dev-sprint25-test`
2. `AgentDevContextManager.provision()` calls `scaffoldEnvironment(repoRoot, contextName, contextConfig)`
3. `scaffoldEnvironment()` line 521: `getRequiredInfrastructure(repoRoot, activeServices)` WITHOUT contextName
4. Function defaults to `context = 'local'`
5. `InfrastructureRegistry.getRequiredInfrastructure(repoRoot, 'local', ...)` called
6. Registry filters infrastructure by context scope (from `architecture.yaml`)
7. Infrastructure specs have `scope: local`, don't match agent-dev contexts
8. Returns **empty Set<string>()**
9. `generateDockerCompose()` receives empty infrastructure set
10. Generated compose has bitbrat-base + application services, NO infrastructure
11. Docker Compose validation fails: "service X depends on undefined service Y"

**The fix**: Add one parameter to line 521:
```typescript
const infrastructure = getRequiredInfrastructure(repoRoot, activeServices, contextName);
```

### Remediation Path

**Short-term** (Sprint 25):
1. Locate compose generation code for agent-dev contexts
2. Ensure infrastructure services (nats, redis, postgres) are included in generated file
3. Test that generated compose includes proper:
   - Service definitions with health checks
   - Network configuration (`bitbrat-agent-dev-*-network`)
   - Volume definitions for data persistence

**Long-term**:
1. Add integration test: "agent-dev compose file includes infrastructure services"
2. Add validation: agent_dev.provision() should verify compose file validity
3. Consider extracting infrastructure to separate `infrastructure.compose.yaml` for reuse

---

## Issue #2: Missing Environment Variables (HIGH)

**Severity**: 🟡 **HIGH** - Warning spam, unclear if fatal
**Category**: Configuration
**Discovered**: 2026-08-25 18:03

### Description

Docker Compose emits **19 warnings** about unset environment variables when building the agent-dev context.

### Warnings

```
The "REDIS_URL" variable is not set. Defaulting to a blank string. (3 occurrences)
The "REFLEX_CACHE_POLL_INTERVAL_MS" variable is not set. Defaulting to a blank string. (3 occurrences)
The "DISCORD_OAUTH_PERMISSIONS" variable is not set. Defaulting to a blank string. (2 occurrences)
The "DEBUG_USERS_SLACK" variable is not set. Defaulting to a blank string.
The "DEBUG_USERS_DISCORD" variable is not set. Defaulting to a blank string.
The "DEBUG_USERS_TWITCH" variable is not set. Defaulting to a blank string.
The "SLACK_SIGNING_SECRET" variable is not set. Defaulting to a blank string.
The "SLACK_APP_TOKEN" variable is not set. Defaulting to a blank string.
The "SLACK_BOT_TOKEN" variable is not set. Defaulting to a blank string.
The "LLM_PROVIDER" variable is not set. Defaulting to a blank string.
The "LLM_MODEL" variable is not set. Defaulting to a blank string.
The "K_REVISION" variable is not set. Defaulting to a blank string.
```

### Technical Details

**Expected behavior**:
- Required variables should be set in `.env.brat` (generated during provision)
- Optional platform-specific variables (Slack, Discord, Twilio) can be unset for testing
- System variables (K_REVISION for Cloud Run) can be unset locally

**Actual behavior**:
- Agent-dev provision creates `.env.brat` but appears to be missing defaults
- Unclear if this causes runtime failures (blocked by Issue #1)

### Impact

- **Noise in logs** - Makes it hard to identify real errors
- **Unclear service behavior** - Services may fail silently with blank config
- **Developer confusion** - Are these fatal or warnings?

### Remediation Path

1. Audit `.env.brat` generation in agent-dev provision code
2. Ensure required variables have sane defaults:
   - `REDIS_URL`: `redis://redis:6379`
   - `LLM_PROVIDER`: `openai`
   - `LLM_MODEL`: `gpt-4o-mini`
   - `REFLEX_CACHE_POLL_INTERVAL_MS`: `10000`
3. Document optional vs required variables
4. Consider validation step: "agent_dev.provision() validates .env.brat completeness"

---

## Issue #3: No Clear Error Messages (MEDIUM)

**Severity**: 🟠 **MEDIUM** - Poor DX
**Category**: User Experience
**Discovered**: 2026-08-25 18:03

### Description

When agent_dev.start() fails, the error message is **a wall of Docker Compose output** without clear guidance on what went wrong or how to fix it.

### Error Output (excerpt)

```json
{
  "error": "❌ Error starting context: Docker command failed with exit code 1
Command: docker compose --project-directory . -p bitbrat-agent-dev-sprint25-test -f infrastructure/docker-compose/docker-compose.agent-dev-sprint25-test.yaml -f infrastructure/docker-compose/services/api-gateway.compose.yaml -f ...
Error: time=\"2026-08-25T18:03:47-04:00\" level=warning msg=\"The \"REDIS_URL\" variable is not set. Defaulting to a blank string.\"
... (19 warnings) ...
service \"api-gateway\" depends on undefined service \"nats\": invalid compose project

💡 Remediation:
  - Ensure Docker is running: docker info
  - Check for port conflicts: docker ps -a
  - View compose logs: docker compose -p bitbrat-agent-dev-sprint25-test logs"
}
```

### Problems

1. **Wall of warnings** buried the actual error (`depends on undefined service "nats"`)
2. **Generic remediation** doesn't address the root cause
3. **No validation** before attempting Docker Compose start

### Remediation Path

1. Add **pre-flight validation** in `agent_dev.start()`:
   - Parse compose file
   - Verify all `depends_on` services are defined
   - Check for common misconfigurations
2. **Improve error messages**:
   - Extract actual error from Docker output
   - Provide specific remediation for known issues
   - Example: "Infrastructure services (nats, redis, postgres) are missing from compose file. This is a known bug - see Issue #1"
3. **Add --quiet mode** to suppress warnings during build

---

## Issue #4: No Health Check Feedback (LOW)

**Severity**: 🟢 **LOW** - Quality of life
**Category**: Observability
**Discovered**: During analysis

### Description

When starting an agent-dev environment, there's **no feedback** on service health until everything is started.

### Expected Behavior

```
Starting agent-dev-sprint25-test...
✓ nats: healthy (2.1s)
✓ redis: healthy (1.3s)
✓ postgres: healthy (4.2s)
✓ auth: started (1.1s)
... (progress updates) ...
✅ All services started successfully
```

### Actual Behavior

```
(wait silently for 30-60 seconds)
(either succeeds or fails with giant error dump)
```

### Remediation Path

1. Add real-time health check polling in `agent_dev.start()`
2. Stream Docker Compose events to show progress
3. Show estimated time remaining based on health check intervals
4. Provide `--follow-logs` option to tail logs during startup

---

## Testing Blocked

Due to Issue #1, the following test scenarios **could not be executed**:

- ❌ `!ping` response (requires ingress-egress running)
- ❌ Message routing verification
- ❌ LLM bot interaction
- ❌ MCP tool discovery
- ❌ Database persistence
- ❌ NATS pub/sub

**All agent-dev functionality is currently broken.**

---

## Recommendations

### Immediate (Sprint 25)

1. **FIX ISSUE #1** - This is the only blocker
2. Create integration test to prevent regression
3. Document workarounds (if any exist)

### Short-term (Next 2 sprints)

1. Address Issue #2 (env var defaults)
2. Improve error messages (Issue #3)
3. Add pre-flight validation

### Long-term (Backlog)

1. Health check feedback (Issue #4)
2. Agent-dev quick-start guide
3. Automated smoke tests for agent-dev environments

---

## Appendix: Environment Details

**System**: macOS (Darwin 25.5.0)
**Docker**: Docker Compose V2
**Context**: agent-dev-sprint25-test
**Profile**: dev
**Persistence**: postgres

**Generated Files**:
- `.brat/ephemeral-contexts.yaml` (context registry)
- `infrastructure/docker-compose/docker-compose.agent-dev-sprint25-test.yaml` (INCOMPLETE)
- `.env.brat` (environment variables - not verified due to startup failure)

**Attempted Commands**:
```bash
# Provision
agent_dev.provision({ name: "agent-dev-sprint25-test", profile: "dev", persistence: "postgres" })
# ✅ SUCCESS

# Start
agent_dev.start({ name: "agent-dev-sprint25-test" })
# ❌ FAILURE: service "api-gateway" depends on undefined service "nats"
```
