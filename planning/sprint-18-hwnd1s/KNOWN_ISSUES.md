# Known Issues - Sprint 18 (Event Stream Analyzer POC)

**Sprint ID:** sprint-18-hwnd1s
**Created:** 2026-08-18
**Status:** Active

---

## Issue 1: `brat bit create` Generates Incorrect Docker Compose Dependencies

### Severity
🟡 **MEDIUM** - Blocks deployment but easy to fix

### Description
When creating a new Bit service using `brat bit create`, the auto-generated Docker Compose file includes a dependency on `firebase-emulator` instead of `postgres`, even though the platform has migrated to PostgreSQL as the default persistence layer.

### Impact
- Deployment fails with error: `service "X" depends on undefined service "firebase-emulator": invalid compose project`
- Requires manual editing of compose file after service creation
- Affects all new services created with the CLI

### Reproduction Steps
```bash
npm run brat -- bit create my-service --profile llm --exposure platform-only --register --active

# Generated file: infrastructure/docker-compose/services/my-service.compose.yaml
# Contains:
#   depends_on:
#     firebase-emulator:
#       condition: service_healthy
```

### Root Cause
The `brat bit create` command uses a template that references the legacy Firestore/Firebase setup. The template has not been updated to reflect the platform's migration to PostgreSQL.

**Likely Location:** `tools/brat/src/commands/bit/create.ts` or associated template files

### Workaround
Manually edit the generated compose file:

**Before (incorrect):**
```yaml
depends_on:
  nats:
    condition: service_healthy
  firebase-emulator:
    condition: service_healthy
```

**After (correct):**
```yaml
depends_on:
  nats:
    condition: service_healthy
  postgres:
    condition: service_healthy
```

### Permanent Fix Required
1. Update the Docker Compose template used by `brat bit create`
2. Change default dependency from `firebase-emulator` to `postgres`
3. Optionally: Add validation to detect and warn about non-existent service dependencies

### Files Affected in This Sprint
- ✅ Fixed: `infrastructure/docker-compose/services/event-stream-analyzer.compose.yaml`

### Related Issues
- Platform migration from Firestore to PostgreSQL (completed)
- CLAUDE.md states: "PostgreSQL (default, platform-agnostic), Firestore (legacy, deprecated)"
- Architecture.yaml correctly specifies `persistence.driver: postgres` for all contexts

### Priority
🟡 **P1** - Should be fixed to prevent confusion for future service creation

### Recommended Owner
Platform Team / CLI Maintainer

---

## Issue 2: Agent-Dev Infrastructure Missing NATS Dependency

### Severity
🟡 **MEDIUM** - Blocks validation workflow

### Description
Agent-dev execution contexts (used for isolated testing) fail to start because the generated Docker Compose configuration does not include the NATS service dependency, which is required by most BitBrat services for message bus communication.

### Impact
- Cannot validate service deployments in agent-dev contexts
- Blocks proactive validation workflow recommended in CLAUDE.md
- Workaround: Rely on unit/integration tests instead of full deployment validation

### Error Message
```
service 'query-analyzer' depends on undefined service 'nats': invalid compose project
```

### Reproduction Steps
```bash
# Provision agent-dev context
agent_dev.provision({ name: "agent-dev-test" })

# Attempt to start
agent_dev.start({ name: "agent-dev-test" })
# Error: NATS service not found
```

### Root Cause
The agent-dev compose file generation does not include infrastructure services (NATS, PostgreSQL) in the compose stack. Services reference NATS as a dependency but the service itself is not defined.

**Likely Location:** Agent-dev provisioning logic in MCP server or compose file generation

### Workaround
Currently none for agent-dev validation. Alternative validation approaches:
1. Unit tests (isolated component testing)
2. Integration tests (mocked dependencies)
3. Local stack deployment (`npm run local`)

### Permanent Fix Required
1. Add NATS service to agent-dev compose template
2. Add PostgreSQL service to agent-dev compose template
3. Ensure all infrastructure dependencies are included in agent-dev contexts
4. Test agent-dev provisioning end-to-end

### Impact on Sprint 18
- ⚠️ Could not validate event-stream-analyzer deployment in agent-dev
- ✅ Mitigated by comprehensive unit + integration test coverage (11 tests, 100% passing)
- ✅ Mitigated by benchmark validation

### Priority
🟡 **P1** - Blocks recommended validation workflow

### Recommended Owner
Platform Team / Agent-Dev Infrastructure Maintainer

---

## Issue 3: `brat bit create` Generated Test File Has TypeScript Error

### Severity
🟢 **LOW** - Minor annoyance, easy to fix

### Description
The auto-generated test file created by `brat bit create` attempts to access the protected `serviceName` property of the Bit base class, causing a TypeScript compilation error.

### Error Message
```
error TS2445: Property 'serviceName' is protected and only accessible within class 'Bit' and its subclasses.

    expect(server.serviceName).toBe('my-service');
                  ~~~~~~~~~~~
```

### Impact
- Generated test file fails to compile
- Requires manual editing to fix test
- Minor developer experience issue

### Reproduction Steps
```bash
npm run brat -- bit create my-service --profile llm --exposure platform-only --register --active

# Generated file: src/apps/my-service.test.ts
# Contains test that accesses protected property
```

### Root Cause
The test template tries to validate the service name by accessing `server.serviceName`, but this property is `protected` in the Bit base class and cannot be accessed from outside the class.

**Likely Location:** `tools/brat/src/commands/bit/create.ts` test template

### Workaround
Remove the failing test or simplify to only test instantiation:

```typescript
// Remove this:
it('should have correct service name', () => {
  expect(server.serviceName).toBe('my-service');
});

// Keep this:
it('should instantiate successfully', () => {
  expect(server).toBeDefined();
  expect(server).toBeInstanceOf(MyService);
});
```

### Permanent Fix Required
Update the test template to remove the `serviceName` assertion or use a public API to validate the service name.

### Files Affected in This Sprint
- ✅ Fixed: `src/apps/event-stream-analyzer-service.test.ts` (simplified test)

### Priority
🟢 **P2** - Low impact, but should be fixed for better DX

### Recommended Owner
Platform Team / CLI Maintainer

---

## Issue 4: `brat bit create` Generates Custom Dockerfile Instead of Using Standard

### Severity
🟡 **MEDIUM** - Blocks deployment, violates platform standards

### Description
When creating a new Bit service using `brat bit create`, the command generates a custom `Dockerfile.<service>` and configures the Docker Compose file to use it with `context: .` (current directory). This violates the platform's migration to using a single `Dockerfile.service` with build args.

### Impact
- Deployment fails with error: `failed to read dockerfile: open Dockerfile.<service>: no such file or directory`
- Violates platform standardization (Sprint 375 migration)
- Creates technical debt (custom Dockerfiles to maintain)
- Inconsistent with other services

### Error Message
```
failed to solve: failed to read dockerfile: open Dockerfile.event-stream-analyzer: no such file or directory
```

### Platform Standard (Sprint 375)
All services should use:
```yaml
build:
  context: ../..  # Repository root
  dockerfile: Dockerfile.service
  args:
    BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
    SERVICE_NAME: <service-name>
    SERVICE_ENTRY: dist/apps/<service-name>-service.js
    SERVICE_PORT: "3000"
```

### What `brat bit create` Generates (INCORRECT)
```yaml
build:
  context: .  # Wrong: should be ../..
  dockerfile: Dockerfile.<service>  # Wrong: should be Dockerfile.service
```

And creates a custom `Dockerfile.<service>` in the repository root.

### Root Cause
The `brat bit create` command uses outdated templates from before the Sprint 375 Dockerfile migration. The templates generate:
1. Custom Dockerfiles for each service
2. Incorrect build context (`.` instead of `../..`)
3. Direct dockerfile reference instead of using build args

**Likely Location:** `tools/brat/src/commands/bit/create.ts` compose template

### Workaround
Manually update the compose file and delete the custom Dockerfile:

1. **Update compose file** (`infrastructure/docker-compose/services/<service>.compose.yaml`):
```yaml
services:
  <service>:
    env_file:
      - .env.brat
    build:
      context: ../..
      dockerfile: Dockerfile.service
      args:
        BASE_IMAGE: bitbrat-base:${BITBRAT_VERSION:-latest}
        SERVICE_NAME: <service>
        SERVICE_ENTRY: dist/apps/<service>-service.js
        SERVICE_PORT: "3000"
    ports:
      - "${<SERVICE>_HOST_PORT:-3000}:${SERVICE_PORT:-3000}"
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/healthz"]
      interval: 5s
      timeout: 3s
      retries: 10
    depends_on:
      nats:
        condition: service_healthy
      postgres:
        condition: service_healthy
    networks:
      bitbrat-network:
        aliases:
          - <service>.bitbrat.local
```

2. **Delete custom Dockerfile**:
```bash
rm Dockerfile.<service>
```

### Permanent Fix Required
1. Update `brat bit create` Docker Compose template to use standard pattern
2. Remove custom Dockerfile generation
3. Use `Dockerfile.service` with build args
4. Set correct build context (`../..`)
5. Update healthcheck to use `/healthz` endpoint (not `/health`)
6. Add network aliases following platform pattern

### Files Affected in This Sprint
- ✅ Fixed: `infrastructure/docker-compose/services/event-stream-analyzer.compose.yaml`
- ✅ Deleted: `Dockerfile.event-stream-analyzer`

### Related Documentation
- `DOCKERFILE_MIGRATION_SUMMARY.md` - Documents Sprint 375 migration to `Dockerfile.service`
- Sprint 375: Migrated reflex and context-pack to standard Dockerfile

### Priority
🟡 **P1** - Must be fixed to align with platform standards

### Recommended Owner
Platform Team / CLI Maintainer

---

## Summary

| Issue | Severity | Status | Blocks Deployment | Blocks Testing |
|-------|----------|--------|-------------------|----------------|
| Firebase-emulator dependency | 🟡 MEDIUM | ✅ Fixed (manual) | ✅ Yes | No |
| Custom Dockerfile generation | 🟡 MEDIUM | ✅ Fixed (manual) | ✅ Yes | No |
| Agent-dev missing NATS | 🟡 MEDIUM | ⚠️ Workaround | No | ✅ Yes |
| Test file TypeScript error | 🟢 LOW | ✅ Fixed (manual) | No | Yes |

### Recommended Platform-Wide Fixes
1. **Update `brat bit create` templates** (addresses Issues 1, 3, & 4)
2. **Fix agent-dev infrastructure** (addresses Issue 2)
3. **Add validation** to CLI to detect common misconfigurations

---

**Document maintained by:** Lead Implementor
**Last updated:** 2026-08-18
**Sprint:** sprint-18-hwnd1s
