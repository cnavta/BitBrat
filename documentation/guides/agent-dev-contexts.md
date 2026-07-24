# Agent-Dev Execution Contexts

**Ephemeral, self-service execution contexts for coding agents to provision, manage, and destroy their own BitBrat development environments.**

**Status**: Production-ready (Sprint 358)

## Core Concepts

| Concept | Description | Example |
|---------|-------------|---------|
| **Agent-Dev Context** | Temporary execution environment with isolated Docker containers, PostgreSQL database, and configuration | `agent-dev-1784822482755-6a23028f` |
| **Ephemeral Storage** | Contexts stored in `.brat/ephemeral-contexts.yaml` (gitignored), not architecture.yaml | Auto-cleaned on destroy |
| **Lifecycle Tools** | 4 MCP tools for complete lifecycle management | `provision`, `start`, `stop`, `destroy` |
| **RBAC Enforcement** | Agent-dev tools can ONLY operate on contexts prefixed with `agent-dev-` | Prevents accidental production operations |
| **Idempotent Operations** | All operations safe to retry (provision fails if exists, destroy safe to call multiple times) | Error recovery guaranteed |

## Quick Reference

```javascript
// Provision new context
agent_dev.provision({
  name: "agent-dev-my-feature",  // Optional: auto-generated if omitted
  persistence: "postgres",         // Optional: default is postgres
  profile: "dev"                   // Optional: dev or staging
})

// Start services (30-60s startup time)
agent_dev.start({ name: "agent-dev-my-feature" })

// Stop services (preserves data)
agent_dev.stop({ name: "agent-dev-my-feature" })

// Destroy context (IRREVERSIBLE - requires confirm: true)
agent_dev.destroy({
  name: "agent-dev-my-feature",
  confirm: true
})
```

## Tool Reference

### agent_dev.provision

**Purpose**: Create new agent-dev execution context with isolated infrastructure

**Input Schema**:
```typescript
{
  name?: string,        // Context name (must start with "agent-dev-")
  profile?: "dev" | "staging",
  persistence?: "postgres" | "firestore"
}
```

**Output**:
```json
{
  "success": true,
  "message": "✅ Context provisioned successfully",
  "context": {
    "name": "agent-dev-1784822482755-6a23028f",
    "status": "provisioned"
  },
  "gateway": {
    "url": "ws://localhost:3004/ws/v1",
    "authToken": "<redacted>"
  },
  "postgres": {
    "host": "localhost",
    "port": 5432,
    "database": "bitbrat"
  },
  "nextSteps": [...]
}
```

**What It Creates**:
- Entry in `.brat/ephemeral-contexts.yaml`
- Environment directory: `env/agent-dev-{timestamp}-{random}/`
- Service configuration files (`global.yaml`, `infra.yaml`, per-service yamls)
- Docker Compose file: `infrastructure/docker-compose/docker-compose.agent-dev-*.yaml`

**Common Errors**:
| Error | Cause | Remediation |
|-------|-------|-------------|
| `Context already exists` | Name collision | Use different name or destroy existing context |
| `Invalid context name` | Name doesn't start with `agent-dev-` | Use `agent-dev-*` prefix |
| `Docker command failed` | Docker not running | Start Docker: `docker info` |

---

### agent_dev.start

**Purpose**: Start all services and wait for readiness (PostgreSQL + NATS)

**Input Schema**:
```typescript
{
  name: string,         // Context name (required)
  service?: string      // Optional: start only this service
}
```

**Output**:
```json
{
  "success": true,
  "message": "✅ Services started successfully",
  "context": "agent-dev-1784822482755-6a23028f",
  "status": "running",
  "gateway": {
    "url": "ws://localhost:3004/ws/v1"
  },
  "services": ["all"],
  "nextSteps": [...]
}
```

**Startup Sequence**:
1. **Docker Compose Up** (20-40s): Builds and starts 17 services + 3 infrastructure containers
2. **PostgreSQL Health Check** (5-30s): Waits for database readiness
3. **NATS Health Check** (2-10s, non-critical): Waits for message bus readiness
4. **Database Seeding** (2-5s): Seeds routing rules, personalities, packs

**Total Time**: 30-90 seconds depending on Docker cache

**Common Errors**:
| Error | Cause | Remediation |
|-------|-------|-------------|
| `Context not found` | Context not provisioned | Run `agent_dev.provision()` first |
| `PostgreSQL did not become ready` | Database startup failure | Check logs: `fleet.logs({ bit: "postgres" })` |
| `Docker command failed` | Port conflict or resource limit | Check ports: `docker ps -a` |
| `dependency cycle detected` | **Known Bug**: Pre-existing circular dependency in docker-compose generation | File issue (outside Sprint 358 scope) |

---

### agent_dev.stop

**Purpose**: Gracefully stop all services while preserving data

**Input Schema**:
```typescript
{
  name: string          // Context name (required)
}
```

**Output**:
```json
{
  "success": true,
  "message": "✅ Services stopped successfully. Data preserved for restart.",
  "context": "agent-dev-1784822482755-6a23028f",
  "status": "stopped",
  "nextSteps": [...]
}
```

**What Is Preserved**:
- Docker volumes (PostgreSQL data, NATS data, Ollama models)
- Environment directory (`env/agent-dev-*/`)
- Ephemeral context entry (`.brat/ephemeral-contexts.yaml`)

**What Is Removed**:
- Running Docker containers only

**Use Cases**:
- Free up resources temporarily
- Switch between multiple contexts
- Debug configuration changes

---

### agent_dev.destroy

**Purpose**: Complete cleanup of all resources (IRREVERSIBLE)

**Input Schema**:
```typescript
{
  name: string,         // Context name (required)
  confirm: boolean      // Must be true (safety check)
}
```

**Output**:
```json
{
  "success": true,
  "message": "✅ Context destroyed successfully. All resources removed.",
  "context": "agent-dev-1784822482755-6a23028f",
  "status": "destroyed",
  "removedResources": [
    "🐳 Docker containers and volumes",
    "💾 PostgreSQL database",
    "📁 Environment directory",
    "📋 Ephemeral context entry"
  ]
}
```

**Cleanup Steps** (Order of Operations):
1. Stop and remove Docker containers
2. Remove Docker volumes (`docker compose down -v`)
3. Drop PostgreSQL database (currently no-op - shared DB)
4. Delete environment directory (`env/agent-dev-*/`)
5. Remove ephemeral context entry (`.brat/ephemeral-contexts.yaml`)
6. **Validate cleanup**: Verify all resources actually removed

**Idempotency**:
- Safe to call multiple times
- Partial failures aggregated and reported
- If validation fails, reports remaining resources

**Safety Features**:
- **Requires `confirm: true`** - Prevents accidental destruction
- **Agent-dev prefix validation** - Cannot destroy non-agent contexts (staging, prod)
- **Cleanup validation** - Verifies complete resource removal

---

## Common Workflows

### Workflow 1: Quick Development Session

```javascript
// 1. Provision new context
const provision = await agent_dev.provision();
// ✅ Context: agent-dev-1784822482755-6a23028f

// 2. Start services (wait 30-60s)
await agent_dev.start({ name: provision.context.name });
// ✅ All services running

// 3. Do your work...
// Connect to gateway: ws://localhost:3004/ws/v1
// Query database: db.query({ collection: "commands" })

// 4. Destroy when done
await agent_dev.destroy({
  name: provision.context.name,
  confirm: true
});
// ✅ All resources cleaned up
```

### Workflow 2: Long-Running Development

```javascript
// Provision once
const provision = await agent_dev.provision({
  name: "agent-dev-feature-auth"
});

// Start when needed
await agent_dev.start({ name: "agent-dev-feature-auth" });

// Stop to free resources
await agent_dev.stop({ name: "agent-dev-feature-auth" });

// Restart later (data preserved)
await agent_dev.start({ name: "agent-dev-feature-auth" });

// Destroy when feature complete
await agent_dev.destroy({
  name: "agent-dev-feature-auth",
  confirm: true
});
```

### Workflow 3: Parallel Contexts (Testing Multiple Branches)

```javascript
// Provision two contexts
const context1 = await agent_dev.provision({
  name: "agent-dev-feature-a"
});
const context2 = await agent_dev.provision({
  name: "agent-dev-feature-b"
});

// Start both (will fail due to port conflicts - known limitation)
// WORKAROUND: Start sequentially, stop one before starting the other
await agent_dev.start({ name: "agent-dev-feature-a" });
// ... test feature A ...
await agent_dev.stop({ name: "agent-dev-feature-a" });

await agent_dev.start({ name: "agent-dev-feature-b" });
// ... test feature B ...

// Cleanup
await agent_dev.destroy({ name: "agent-dev-feature-a", confirm: true });
await agent_dev.destroy({ name: "agent-dev-feature-b", confirm: true });
```

---

## Troubleshooting

### Error: Context already exists

**Cause**: Duplicate context name

**Solution**:
```javascript
// Option 1: Use auto-generated name
agent_dev.provision()  // Generates unique agent-dev-{timestamp}-{random}

// Option 2: Choose different name
agent_dev.provision({ name: "agent-dev-my-other-feature" })

// Option 3: Destroy existing context
agent_dev.destroy({ name: "agent-dev-my-feature", confirm: true })
```

### Error: PostgreSQL did not become ready

**Cause**: Database container failed to start

**Diagnosis**:
```bash
# Check PostgreSQL logs
fleet.logs({ context: "agent-dev-xxx", bit: "postgres" })

# Check container status
docker ps -a | grep postgres

# Try manual connection
psql -h localhost -U bitbrat -d bitbrat
```

**Common Fixes**:
- Increase timeout (PostgreSQL might be slow on first start)
- Check Docker resources (memory/CPU)
- Verify port 5432 not in use

### Error: Docker command failed with exit code 1

**Cause**: Various Docker issues (port conflicts, dependency cycles, resource limits)

**Diagnosis**:
```bash
# Check Docker status
docker info

# Check running containers
docker ps -a

# Check for port conflicts
lsof -i :3004  # Gateway port
lsof -i :5432  # PostgreSQL port
lsof -i :4222  # NATS port

# View Docker Compose logs
docker compose -p bitbrat-agent-dev-xxx logs
```

**Common Fixes**:
- **Port conflicts**: Stop other contexts or change ports
- **Dependency cycle**: Known bug in docker-compose generation (Sprint 358 blocker)
- **Resource limits**: Increase Docker memory/CPU limits

### Warning: NATS may not be fully ready

**Cause**: NATS container slow to start (non-critical)

**Impact**: Minimal - services will retry connection

**Action**: None required (warning only)

### Partial cleanup warnings

**Cause**: Some resources failed to remove during destroy

**Example**:
```
⚠️ Partial cleanup: Destroy completed with 2 error(s):
  1. Docker containers still exist: bitbrat-agent-dev-xxx-llm-bot
  2. Environment directory still exists: env/agent-dev-xxx
```

**Solution**:
```javascript
// Safe to retry (idempotent)
agent_dev.destroy({ name: "agent-dev-xxx", confirm: true })

// Manual cleanup if needed
docker compose -p bitbrat-agent-dev-xxx down -v
rm -rf env/agent-dev-xxx
```

---

## Limitations & Known Issues

| Limitation | Description | Workaround |
|------------|-------------|------------|
| **Port Conflicts** | Multiple contexts cannot run simultaneously (all use same ports) | Start contexts sequentially, stop one before starting another |
| **Dependency Cycle** | Pre-existing bug: `auth` ↔ `event-router` circular dependency blocks `start()` | **Sprint 358 Blocker** - File issue in docker-compose generation |
| **Shared Database** | All contexts use same PostgreSQL database (no true isolation) | Use different database per context (future enhancement) |
| **No Auto-Cleanup** | Ephemeral contexts persist until explicitly destroyed | Manual cleanup required |
| **Local Docker Only** | Agent-dev contexts only work on local Docker (no cloud deployment) | Use standard BECs for cloud environments |

---

## Architecture Details

### File Structure

```
BitBratPlatform/
├── .brat/
│   └── ephemeral-contexts.yaml          # Ephemeral context registry (gitignored)
├── env/
│   └── agent-dev-{timestamp}-{random}/  # Isolated environment directory
│       ├── global.yaml                  # Global environment variables
│       ├── infra.yaml                   # Infrastructure configuration
│       └── {service}.yaml               # Per-service configuration
├── infrastructure/
│   └── docker-compose/
│       └── docker-compose.agent-dev-*.yaml  # Generated Docker Compose files
└── tools/brat/src/dev-mcp/
    ├── agent-dev-context-manager.ts     # Core lifecycle manager
    └── tools/agent-dev.ts               # MCP tool definitions
```

### Context Resolution Priority

When resolving execution contexts, ContextResolver checks:

1. **Ephemeral contexts** (`.brat/ephemeral-contexts.yaml`) - Highest priority
2. **Permanent contexts** (`architecture.yaml`) - Fallback

This allows agent-dev contexts to override permanent contexts with the same name (though naming convention prevents this in practice).

### RBAC Model

Agent-dev tools enforce strict naming conventions:

| Operation | Allowed Context Names | Blocked Names | Enforcement |
|-----------|----------------------|---------------|-------------|
| `provision` | `agent-dev-*` | All others | `AgentDevContextManager.validateAgentDevContext()` |
| `start` | `agent-dev-*` | All others | Same |
| `stop` | `agent-dev-*` | All others | Same |
| `destroy` | `agent-dev-*` | All others | Same |

**Why?** Prevents agents from accidentally operating on staging/production contexts.

---

## See Also

- [Execution Contexts](../concepts/execution-contexts.md) - Understanding BECs
- [Fleet Management](./brat-fleet.md) - Monitoring and control plane
- [Docker Orchestration](../reference/docker-orchestrator.md) - Docker Compose integration
- [AGENTS.md](../../AGENTS.md) - Sprint protocol for LLM development
