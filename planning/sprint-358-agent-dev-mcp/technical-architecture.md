# Technical Architecture: MCP Dev Tooling for Agent-Dev Execution Context Management

**Sprint**: 358
**Status**: Draft (Revised)
**Created**: 2026-07-23
**Revised**: 2026-07-23
**Architect**: Claude (Sonnet 4.5)
**Stakeholder**: Christopher Navta

---

## Revision History

**Revision 1** (2026-07-23):
- **Simplified architecture**: Agent-dev is now just a standard BEC with guardrails (no special infrastructure)
- **Reduced tool count**: 4 lifecycle tools instead of 6 (removed `agent_dev.status` and `agent_dev.logs`)
- **Reuse existing fleet tools**: Agents use `fleet.info`, `fleet.logs`, `fleet.health` with `context:` parameter
- **Approved storage location**: `.brat/ephemeral-contexts.yaml` (user approved)
- **Key insight**: Don't build duplicate functionality—wrap existing proven components

---

## Executive Summary

This document defines the technical architecture for MCP-based development tooling that enables `brat code` agents to provision, manage, and destroy their own dedicated BitBrat Execution Context (`agent-dev`).

**Core Principle**: Agent-dev contexts are **standard BitBrat Execution Contexts** (BECs) with guardrails. They use the same scaffolding, orchestration, and fleet management as any other BEC—agents simply get thin MCP wrappers for lifecycle operations (provision/start/stop/destroy) and reuse existing fleet tools for monitoring and logs.

**Key Insight**: Don't build special infrastructure. Agent-dev is just another local Docker BEC stored in `.brat/ephemeral-contexts.yaml` instead of `architecture.yaml`. Agents use existing `fleet.*` and `persistence.*` tools targeted at their context.

---

## 1. Current State Analysis

### 1.1 Execution Context System (Sprint 349+)

**ContextResolver** (`tools/brat/src/context/context-resolver.ts`):
- Centralized context resolution with 4-level priority
- Auto-discovery of gateway URLs and PostgreSQL connections
- Environment variable overlay resolution from `env/{context}/` directories
- Cache management for performance

**Existing Contexts** (from `architecture.yaml`):
- `local`: Unix socket Docker, localhost PostgreSQL
- `staging`: SSH-based Docker at `bitbrat.lan`, remote PostgreSQL

**Context Structure**:
```yaml
executionContexts:
  {name}:
    description: "Human-readable description"
    deployment:
      type: docker-compose | cloud-run | k8s
      docker:
        host: unix:///var/run/docker.sock | ssh://user@host
        remoteDir: /opt/BitBratPlatform
        maxConcurrent: 5
    runtime:
      gateway:
        autoDiscover: true
        fallbackPort: 3004
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection: { host, port, database, username, password }
      envOverlay:
        path: env/{contextName}
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.{contextName}
    tags: [development, local]
```

### 1.2 Dev MCP Server (Sprint 333, 354)

**Current Implementation** (`tools/brat/src/dev-mcp/`):
- Stdio-based MCP server for development tooling
- **TargetConnectionManager**: Manages execution context connections (refactored in Sprint 354 to use ContextResolver + ContextAdapter)
- **ContextAdapter**: Bridges `ResolvedContext` → `TargetConnection` (persistence backends, SSH tunnels, Loki config)
- **Existing Tools**:
  - **Config tools**: Show/validate architecture.yaml
  - **Persistence tools**: Query/manipulate PostgreSQL or Firestore
  - **Fleet tools**: `brat fleet` operations via MCP

**Authentication**:
- Requires `MCP_DEV_TOKEN` or `MCP_AUTH_TOKEN` (fail-closed)
- No granular RBAC (Sprint 358 opportunity)

**Current Usage**:
```bash
# Launch dev-mcp server (stdio transport)
MCP_AUTH_TOKEN=xxx brat dev-mcp start --context staging
```

### 1.3 Docker Orchestration (tools/brat/src/orchestration/docker/)

**DockerOrchestrator**:
- Manages `docker compose up/down/logs/ps` across local and SSH targets
- **EnvironmentResolver**: Merges YAML overlays from `env/{context}/`
- **ComposeFactory**: Generates compose file lists, filters inactive services
- **PortManager**: Allocates ports dynamically

**Remote SSH Support**:
- Syncs repo to `remoteDir` via rsync
- Executes `docker compose` via SSH
- Handles ADC credentials for GCP integration

**Key Insight**: All orchestration code already exists and works for `staging` (remote SSH). Agent-dev just needs a new execution context definition + MCP wrapper.

### 1.4 brat CLI Commands

**Relevant Commands** (for MCP wrapping):
- `brat context create <name>`: Interactive wizard to scaffold new context
- `brat context show <name>`: Display context config (redacted or raw)
- `brat context list`: List all contexts with metadata
- `brat use <name>`: Switch default context in `~/.bratrc`
- `brat docker up/down/logs/ps --context <name>`: Orchestrate Docker deployments

**Gaps for Agent Use**:
- No programmatic context creation (wizard is interactive)
- No built-in cleanup/destroy workflow
- No PostgreSQL seed data for new contexts (routing rules, personalities)
- No validation that context is "ready" post-creation

---

## 2. Goals and Requirements

### 2.1 Functional Goals

1. **Self-Service Provisioning**: Agents create `agent-dev` contexts via MCP tool calls
2. **Lifecycle Management**: Provision → Start → Stop → Destroy via MCP
3. **Environment Isolation**: Each agent-dev context is fully isolated (separate DB, network, ports)
4. **Observability**: All agent actions logged to audit trail
5. **Idempotency**: Safe to call provision/destroy multiple times
6. **Fast Setup**: <60 seconds from provision to ready (PostgreSQL seeded, services up)

### 2.2 Non-Functional Requirements

1. **Security**: Agent MCP tools cannot escape to other contexts (staging, prod)
2. **Resource Limits**: Max 1 agent-dev context per agent session
3. **Cleanup Guarantees**: Destroy removes all traces (Docker containers, volumes, env files, DB data)
4. **Error Recovery**: Clear error messages, no orphaned resources
5. **Auditability**: Every agent action logged with timestamp, correlation ID
6. **Backward Compatibility**: Existing `brat` CLI commands continue to work

### 2.3 Out of Scope (Future Work)

- Multi-agent context sharing (1 context = 1 agent for now)
- Cloud-based agent-dev (GCP Cloud Run) — Docker only
- Persistent agent-dev contexts (ephemeral only)
- Agent-to-agent context handoff

---

## 3. Technical Architecture

### 3.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Claude Code Agent                          │
│                    (via stdio MCP client)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ MCP Protocol (stdio)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Dev MCP Server                                │
│                 (tools/brat/src/dev-mcp/)                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │             AgentDevContextManager                        │  │
│  │  (Thin wrapper - delegates to existing infrastructure)   │  │
│  │  - provision(name) → ContextProvisionResult               │  │
│  │  - start(name) → StartResult                              │  │
│  │  - stop(name) → void                                      │  │
│  │  - destroy(name) → void                                   │  │
│  └─────────────┬────────────────────────────────────────────┘  │
│                │                                                 │
│                │ Delegates to:                                   │
│                │                                                 │
│  ┌─────────────▼─────────────┐  ┌──────────────────────────┐  │
│  │   ContextResolver         │  │  DockerOrchestrator      │  │
│  │   (existing)              │  │  (existing)              │  │
│  └───────────────────────────┘  └──────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              MCP Tool Definitions                         │  │
│  │  - agent_dev.provision   (scaffold BEC)                   │  │
│  │  - agent_dev.start       (docker up)                      │  │
│  │  - agent_dev.stop        (docker down, preserve data)     │  │
│  │  - agent_dev.destroy     (cleanup all resources)          │  │
│  │                                                            │  │
│  │  Agents use existing tools for monitoring:                │  │
│  │  - fleet.info            (context: agent-dev-xxx)         │  │
│  │  - fleet.logs            (context: agent-dev-xxx)         │  │
│  │  - fleet.health          (context: agent-dev-xxx)         │  │
│  │  - persistence.query     (target: agent-dev-xxx)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              AuditLogger                                  │  │
│  │  (existing, logs all tool calls)                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              │ Reuses existing code:
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                    Existing Infrastructure                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ContextResolver (Sprint 349)                            │   │
│  │  - resolve(name) → ResolvedContext                       │   │
│  │  - listContexts() → string[]                             │   │
│  │  - contextExists(name) → boolean                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DockerOrchestrator (existing)                           │   │
│  │  - up() → void                                           │   │
│  │  - down() → void                                         │   │
│  │  - logs(follow) → void                                   │   │
│  │  - ps() → void                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  EnvironmentResolver (existing)                          │   │
│  │  - resolve(envName) → Record<string, string>             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ComposeFactory (existing)                               │   │
│  │  - getComposeFiles(service?, inactive?) → ComposeFileSet │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

#### 3.2.1 AgentDevContextManager (NEW)

**Location**: `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`

**Responsibilities**:

This is a **thin orchestration layer** that wraps existing BEC infrastructure with guardrails for agent use. It does NOT reimplement context management—it delegates to proven, battle-tested components.

1. **Provision**: Create a standard BEC with agent-specific defaults
   - Generate unique context name (e.g., `agent-dev-{timestamp}`)
   - Create entry in `.brat/ephemeral-contexts.yaml` (NOT `architecture.yaml`)
   - Scaffold `env/agent-dev-{timestamp}/` directory via existing functions
   - Seed PostgreSQL database (routing rules, personalities) via `cmdSeed()`
   - Validate readiness (DB connected, env files present)
   - **Delegation**: Reuses existing functions from `tools/brat/src/commands/context/create.ts`:
     - `buildNonInteractive()` - builds context config from options
     - `scaffoldEnvironment()` - creates env directory and baseline files
     - `generateServiceConfigs()` - generates per-service YAML files
     - `cmdSeed()` - seeds database with routing rules and personalities
   - **Key difference**: Writes to `.brat/ephemeral-contexts.yaml` instead of `architecture.yaml`

2. **Start**: Launch all services
   - Delegate to `DockerOrchestrator.up()` with `--context agent-dev-{name}`
   - Wait for basic health (PostgreSQL ready, NATS ready)
   - Return gateway URL for agent to use with `fleet.*` tools
   - **Delegation**: 100% reuse of existing Docker orchestration

3. **Stop**: Gracefully stop all services (preserve data)
   - Delegate to `DockerOrchestrator.down()` (without volume removal)
   - **Delegation**: 100% reuse of existing Docker orchestration

4. **Destroy**: Teardown and cleanup (irreversible)
   - Stop all services via `DockerOrchestrator.down()`
   - Remove Docker volumes (`docker compose down -v`)
   - Delete `env/agent-dev-{name}/` directory
   - Drop PostgreSQL database `bitbrat_agent_dev_{timestamp}`
   - Remove entry from `.brat/ephemeral-contexts.yaml`
   - **Delegation**: Uses existing orchestrator + filesystem/DB cleanup

**Key Design Decisions**:
- **Unique Naming**: `agent-dev-{timestamp}` or `agent-dev-{sessionId}` to avoid collisions
- **Ephemeral by Default**: No persistence across agent sessions (destroy on shutdown)
- **Safety Guardrails**: Cannot provision more than 1 context per agent session
- **Context Isolation**: Uses unique Docker Compose project name (`bitbrat-agent-dev-{name}`)

#### 3.2.2 MCP Tools (NEW)

**Location**: `tools/brat/src/dev-mcp/tools/agent-dev.ts`

**Tool Definitions**:

```typescript
// agent_dev.provision
{
  name: 'agent_dev.provision',
  description: 'Provision a new isolated agent-dev execution context',
  inputSchema: z.object({
    name: z.string().optional().describe('Context name (auto-generated if omitted)'),
    profile: z.enum(['dev', 'staging']).optional().default('dev'),
    persistence: z.enum(['postgres', 'firestore']).optional().default('postgres'),
  }),
  handler: async (args, connection) => {
    const result = await agentDevManager.provision({
      name: args.name,
      profile: args.profile,
      persistence: args.persistence,
    });
    return {
      content: [{
        type: 'text',
        text: `✅ Provisioned agent-dev context: ${result.name}\n\n` +
              `Gateway: ${result.gateway.url}\n` +
              `PostgreSQL: ${result.postgres.host}:${result.postgres.port}\n` +
              `Status: ${result.status}\n\n` +
              `Use agent_dev.start to launch services.`
      }]
    };
  }
}

// agent_dev.start
{
  name: 'agent_dev.start',
  description: 'Start all services in the agent-dev context',
  inputSchema: z.object({
    name: z.string().describe('Context name'),
    service: z.string().optional().describe('Start only this service (optional)'),
  }),
  handler: async (args, connection) => {
    const result = await agentDevManager.start(args.name, args.service);
    return {
      content: [{
        type: 'text',
        text: `✅ Started ${args.service || 'all services'}\n\n` +
              `Gateway: ${result.gateway.url}\n` +
              `Services running: ${result.services.length}\n` +
              `Status: ${result.status}`
      }]
    };
  }
}

// agent_dev.stop
{
  name: 'agent_dev.stop',
  description: 'Stop all services in the agent-dev context (preserves data)',
  inputSchema: z.object({
    name: z.string().describe('Context name'),
  }),
  handler: async (args, connection) => {
    await agentDevManager.stop(args.name);
    return {
      content: [{
        type: 'text',
        text: `✅ Stopped agent-dev context: ${args.name}\n\n` +
              `Data preserved. Use agent_dev.start to resume or agent_dev.destroy to cleanup.`
      }]
    };
  }
}

// agent_dev.destroy
{
  name: 'agent_dev.destroy',
  description: 'Destroy agent-dev context and cleanup all resources',
  inputSchema: z.object({
    name: z.string().describe('Context name'),
    confirm: z.boolean().default(false).describe('Confirm destruction'),
  }),
  handler: async (args, connection) => {
    if (!args.confirm) {
      return {
        content: [{
          type: 'text',
          text: `⚠️  Destruction requires confirmation. Call with confirm: true`
        }],
        isError: true,
      };
    }
    await agentDevManager.destroy(args.name);
    return {
      content: [{
        type: 'text',
        text: `✅ Destroyed agent-dev context: ${args.name}\n\n` +
              `All containers, volumes, and data removed.`
      }]
    };
  }
}
```

**That's it!** Only 4 tools needed. For monitoring and logs, agents use **existing fleet tools**:

```typescript
// Agents use these EXISTING tools (no changes needed):

// Get Bit info (health, version, uptime)
await agent.callTool('fleet.info', {
  bit: 'llm-bot',
  context: 'agent-dev-1721745296'
});

// Stream logs from services
await agent.callTool('fleet.logs', {
  bit: 'llm-bot',
  context: 'agent-dev-1721745296',
  level: ['error', 'warn'],
  since: '5m'
});

// Query persistence
await agent.callTool('persistence.query', {
  collection: 'routing_rules',
  target: 'agent-dev-1721745296'
});
```

**RBAC Enforcement**:
- All `agent_dev.*` tools require `agentAllowlist: ['claude-code']` in MCP server config
- Tools refuse to operate on non-agent-dev contexts (e.g., cannot destroy `staging`)
- Pattern match: only contexts matching `agent-dev-*` or explicitly tagged `agent-dev: true`

#### 3.2.3 Security & Audit (ENHANCED)

**AuditLogger Enhancement**:
- Current: Logs all MCP tool calls to `.brat/dev-mcp-audit.log`
- Enhancement: Add structured fields for agent-dev operations
  - `contextName`: Which context was affected
  - `operation`: provision | start | stop | destroy | status | logs
  - `agentSession`: Unique session ID for grouping
  - `resourcesCreated`: List of Docker containers, volumes, databases
  - `resourcesDestroyed`: Cleanup audit trail

**RBAC Integration** (`src/common/mcp/rbac.ts`):
- Existing `RbacEvaluator` checks `requiredRoles` and `agentAllowlist`
- Enhancement: Add context-scoped checks
  - `isAllowedContext(contextName, sessionContext) → boolean`
  - Deny if contextName not in `[agent-dev-*, user's personal contexts]`
  - Allow if context has tag `agent-dev: true`

**Environment Isolation**:
- Agent-dev contexts use unique Docker Compose project names: `bitbrat-agent-dev-{name}`
- Separate PostgreSQL databases: `bitbrat_agent_dev_{name}` (or separate DB server)
- Unique port ranges: Base port 4000+ (vs 3000+ for local, 5000+ for staging)

---

## 4. Data Model

### 4.1 ExecutionContext Schema (Ephemeral Storage)

**Agent-dev contexts use the SAME schema as standard BECs**, but stored in `.brat/ephemeral-contexts.yaml` instead of `architecture.yaml`:

```yaml
# File: .brat/ephemeral-contexts.yaml (gitignored)
executionContexts:
  agent-dev-{timestamp}:
    description: "Ephemeral agent development context"
    deployment:
      type: docker-compose
      docker:
        host: unix:///var/run/docker.sock
        # No remoteDir (local only)
    runtime:
      gateway:
        autoDiscover: true
        fallbackPort: 4004  # Unique port range for agent-dev
        authToken: ${MCP_AUTH_TOKEN}
      persistence:
        driver: postgres
        connection:
          host: localhost
          port: 5432
          database: bitbrat_agent_dev_{timestamp}
          username: bitbrat
          password: ${POSTGRES_PASSWORD}
      envOverlay:
        path: env/agent-dev-{timestamp}
        files: [global.yaml, infra.yaml, "{service}.yaml"]
        secure: .secure.agent-dev
    tags: [development, agent-dev, ephemeral]
    metadata:
      createdBy: agent  # vs 'user'
      createdAt: "2026-07-23T12:34:56Z"
      sessionId: "claude-code-session-abc123"
      autoDestroy: true  # Destroy on agent session end
```

### 4.2 Context Lifecycle State Machine

```
┌─────────┐
│ NONE    │
└────┬────┘
     │ provision()
     ▼
┌─────────┐
│PROVISIONED
└────┬────┘
     │ start()
     ▼
┌─────────┐
│ RUNNING │◄──┐
└────┬────┘   │
     │        │ start() (idempotent)
     │ stop() │
     ▼        │
┌─────────┐   │
│ STOPPED ├───┘
└────┬────┘
     │ destroy()
     ▼
┌─────────┐
│DESTROYED│
└─────────┘
```

**State Persistence**:
- Option 1: Store in `~/.bratrc` under `agentDevContexts: {name: state}`
- Option 2: Store in `.brat/agent-dev-state.json` (per-repo)
- Option 3: Derive from Docker container state (stateless, query on-demand)

**Recommendation**: Option 3 (stateless) + audit log for history

---

## 5. Implementation Approach

### 5.1 Phase 1: Core Infrastructure (2-3 days)

**Deliverables**:
1. `AgentDevContextManager` class with provision/destroy skeleton
2. Context scaffolding logic (copy from `env/local/`, apply adjustments)
3. PostgreSQL database creation/seeding
4. Basic integration tests

**Files Created/Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` (NEW)
- `tools/brat/src/dev-mcp/agent-dev-context-manager.test.ts` (NEW)
- `tools/brat/src/dev-mcp/tools/agent-dev.ts` (NEW)
- `tools/brat/src/dev-mcp/tools/agent-dev.test.ts` (NEW)
- `tools/brat/src/dev-mcp/server.ts` (MODIFY: register agent-dev tools)
- `tools/brat/src/context/context-resolver.ts` (MODIFY: check `.brat/ephemeral-contexts.yaml`)
- `tools/brat/src/commands/context/create.ts` (MODIFY: export helper functions for reuse)
- `.gitignore` (MODIFY: add `.brat/` to ignore ephemeral contexts)

**Implementation Details**:

The key insight is that **`brat context create` already supports non-interactive mode** with all necessary flags:

```typescript
// Existing interface from create.ts (line 20-55)
export interface ContextCreateOptions {
  nonInteractive?: boolean;
  type?: 'docker-compose' | 'cloud-run' | 'k8s';
  description?: string;
  persistenceDriver?: 'postgres' | 'firestore';
  pgHost?: string;
  pgPort?: number;
  pgDatabase?: string;
  pgUsername?: string;
  pgPassword?: string;
  dockerHost?: string;
  dockerRemoteDir?: string;
  // ... etc
}
```

**What AgentDevContextManager will do**:

1. **Extract and reuse** these helper functions from `create.ts`:
   - `buildNonInteractive(options)` - builds context config from CLI options
   - `scaffoldEnvironment(repoRoot, name, config)` - creates env dir + YAML files
   - `waitForPostgres(timeout)` - waits for PostgreSQL to be ready

2. **Write to ephemeral storage** instead of architecture.yaml:
   ```typescript
   // Instead of calling writeContextToArchitecture()
   // Call new function: writeContextToEphemeralStorage()

   async function writeContextToEphemeralStorage(repoRoot: string, contextName: string, contextConfig: any): Promise<void> {
     const ephemeralPath = path.join(repoRoot, '.brat', 'ephemeral-contexts.yaml');

     // Read existing ephemeral contexts (or create empty)
     let ephemeral: any = { executionContexts: {} };
     if (fs.existsSync(ephemeralPath)) {
       const content = fs.readFileSync(ephemeralPath, 'utf8');
       ephemeral = yaml.load(content) as any;
     }

     // Add new context
     if (!ephemeral.executionContexts) ephemeral.executionContexts = {};
     ephemeral.executionContexts[contextName] = contextConfig;

     // Write back
     const newContent = yaml.dump(ephemeral, { indent: 2, lineWidth: 100, noRefs: true });
     fs.writeFileSync(ephemeralPath, newContent, 'utf8');
   }
   ```

3. **Update ContextResolver** to check both files:
   ```typescript
   // In context-resolver.ts getRawContext()
   async getRawContext(name: string): Promise<ExecutionContext | null> {
     // Check ephemeral contexts first (higher priority)
     const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');
     if (fs.existsSync(ephemeralPath)) {
       const ephemeral = yaml.load(fs.readFileSync(ephemeralPath, 'utf8')) as any;
       if (ephemeral?.executionContexts?.[name]) {
         return ephemeral.executionContexts[name];
       }
     }

     // Fall back to architecture.yaml
     const arch = this.loadArchitecture();
     return arch.executionContexts?.[name] || null;
   }
   ```

**Testing**:
- Unit tests: Context name generation, ephemeral storage write/read
- Integration tests: Provision → Start → Destroy (Docker required)
- Verify ContextResolver finds ephemeral contexts before architecture.yaml

### 5.2 Phase 2: MCP Tool Integration (1-2 days)

**Deliverables**:
1. 4 MCP lifecycle tools registered in Dev MCP server (provision/start/stop/destroy)
2. RBAC enforcement for agent-dev contexts
3. Audit logging enhancements
4. Error handling and user-friendly messages
5. Ensure existing `fleet.*` tools accept `context:` parameter

**Files Modified**:
- `tools/brat/src/dev-mcp/server.ts`: Register tools
- `tools/brat/src/dev-mcp/audit-logger.ts`: Add structured fields
- `src/common/mcp/rbac.ts`: Add context-scoped checks (optional)

**Testing**:
- MCP protocol tests: Send tool call requests, validate responses
- RBAC tests: Attempt to destroy `staging` (should fail)
- Audit log tests: Verify structured logging

### 5.3 Phase 3: Orchestration & Lifecycle (2 days)

**Deliverables**:
1. `start()` implementation using `DockerOrchestrator`
2. `stop()` implementation
3. Health check polling (PostgreSQL, NATS, services)
4. Log streaming via `logs()`

**Files Modified**:
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts`: Implement lifecycle methods
- `tools/brat/src/orchestration/docker/orchestrator.ts`: No changes (reuse as-is)

**Testing**:
- End-to-end tests: Full provision → start → stop → destroy cycle
- Idempotency tests: Call provision twice, start twice, etc.
- Cleanup tests: Verify no orphaned containers/volumes

### 5.4 Phase 4: Polish & Documentation (1 day)

**Deliverables**:
1. User-facing documentation (`documentation/guides/agent-dev-contexts.md`)
2. Tool descriptions and examples
3. Troubleshooting guide
4. Demo video or walkthrough

**Documentation Topics**:
- What is an agent-dev context?
- When to use agent-dev vs local vs staging
- Tool reference (4 lifecycle tools + existing fleet tools)
- Common errors and solutions
- Resource cleanup guarantees

---

## 6. Migration Path

### 6.1 Backward Compatibility

**Existing Workflows** (must continue to work):
- `brat docker up --context local`: Unchanged
- `brat context create staging`: Unchanged
- `brat use staging && brat docker logs`: Unchanged

**No Breaking Changes**:
- All agent-dev tooling is additive (new MCP tools)
- Existing `ContextResolver`, `DockerOrchestrator` unchanged
- No architecture.yaml schema changes (just new context entries)

### 6.2 Adoption Path

**Phase 1**: Internal testing
- Manually test agent-dev provisioning via MCP tools
- Validate cleanup, resource isolation

**Phase 2**: Claude Code integration
- Add agent-dev tools to MCP server startup
- Update Claude Code context files to recommend agent-dev for testing

**Phase 3**: Documentation & rollout
- Publish guides, update CLAUDE.md
- Announce in changelog

---

## 7. Security Model

### 7.1 Threat Model

**Threats**:
1. **Agent escapes to production**: Agent destroys `staging` or `prod` context
2. **Resource exhaustion**: Agent provisions unlimited contexts, fills disk
3. **Credential leakage**: Agent reads secrets from other contexts
4. **Privilege escalation**: Agent gains access to `brat` commands outside MCP

**Mitigations**:
1. **Context name validation**: Only allow `agent-dev-*` pattern for agent operations
2. **Rate limiting**: Max 1 active context per agent session
3. **Secret redaction**: `context show` always redacts unless `--raw` (not exposed via MCP)
4. **Fail-closed**: All agent-dev tools require `MCP_DEV_TOKEN` authentication

### 7.2 RBAC Rules

**MCP Server Config** (in Dev MCP server registration):
```typescript
{
  name: 'brat-dev-mcp',
  tools: [
    {
      name: 'agent_dev.provision',
      requiredRoles: ['agent'],
      agentAllowlist: ['claude-code', 'aider', 'continue'],
    },
    {
      name: 'agent_dev.destroy',
      requiredRoles: ['agent'],
      agentAllowlist: ['claude-code', 'aider', 'continue'],
    },
    // ... all agent_dev.* tools
  ]
}
```

**SessionContext** (passed to all tool calls):
```typescript
{
  agentName: 'claude-code',
  roles: ['agent', 'developer'],
  sessionId: 'session-abc123',
}
```

**Enforcement**:
```typescript
// In AgentDevContextManager
async destroy(contextName: string, sessionContext: SessionContext): Promise<void> {
  // Validation: Context must be agent-owned
  if (!contextName.startsWith('agent-dev-')) {
    throw new Error(`Cannot destroy non-agent context: ${contextName}`);
  }

  // RBAC check
  if (!rbac.isAllowedTool('agent_dev.destroy', sessionContext)) {
    throw new Error('Unauthorized: agent role required');
  }

  // Proceed with destruction
  // ...
}
```

### 7.3 Audit Trail

**Every agent-dev operation logged**:
```json
{
  "timestamp": "2026-07-23T12:34:56Z",
  "tool": "agent_dev.provision",
  "agentName": "claude-code",
  "sessionId": "session-abc123",
  "contextName": "agent-dev-1721745296",
  "operation": "provision",
  "success": true,
  "durationMs": 3456,
  "resourcesCreated": {
    "containers": ["nats", "postgres", "llm-bot", "event-router", ...],
    "volumes": ["bitbrat-agent-dev-1721745296_postgres_data", ...],
    "database": "bitbrat_agent_dev_1721745296"
  }
}
```

**Audit log location**: `.brat/dev-mcp-audit.log` (existing)

---

## 8. Testing Strategy

### 8.1 Unit Tests

**AgentDevContextManager**:
- Context name generation (uniqueness, format)
- Env file scaffolding (variable substitution, profile application)
- State validation (PROVISIONED → RUNNING → STOPPED → DESTROYED)

**Agent-Dev Tools**:
- Input validation (zod schema enforcement)
- Error messages (user-friendly, actionable)
- Idempotency (call provision twice, no error)

### 8.2 Integration Tests

**Full Lifecycle**:
1. Provision agent-dev context
2. Start services
3. Health check: PostgreSQL seeded, NATS connected
4. Query routing rules (should have 1+ rows)
5. Stop services
6. Destroy context
7. Verify cleanup: No containers, no volumes, no DB

**Parallel Contexts**:
1. Provision `agent-dev-A`
2. Provision `agent-dev-B`
3. Start both
4. Verify isolation (separate DBs, ports)
5. Destroy both

### 8.3 E2E Tests (Manual)

**Via Claude Code**:
1. Launch `brat code`
2. Agent calls `agent_dev.provision`
3. Agent calls `agent_dev.start`
4. Agent queries PostgreSQL via `persistence.*` tools
5. Agent calls `agent_dev.destroy`
6. Verify no orphaned resources

---

## 9. Success Criteria

### 9.1 Functional Criteria

- [ ] Agent provisions agent-dev context in <60 seconds
- [ ] All 20+ services start successfully
- [ ] PostgreSQL seeded with routing rules and personalities
- [ ] Gateway URL auto-discovered and returned
- [ ] Agent can query persistence via `persistence.*` tools (with `target:` parameter)
- [ ] Agent can stream logs via `fleet.logs` (with `context:` parameter)
- [ ] Agent can destroy context, all resources cleaned up
- [ ] No manual intervention required

### 9.2 Security Criteria

- [ ] Agent cannot destroy `local`, `staging`, or `prod` contexts
- [ ] Agent cannot read secrets from other contexts
- [ ] All operations logged to audit trail
- [ ] RBAC enforced (agent role required)

### 9.3 Operational Criteria

- [ ] Zero orphaned Docker containers after destroy
- [ ] Zero orphaned Docker volumes after destroy
- [ ] PostgreSQL database dropped after destroy
- [ ] Env directory deleted after destroy
- [ ] Idempotent operations (safe to retry)

### 9.4 Documentation Criteria

- [ ] User guide published (`documentation/guides/agent-dev-contexts.md`)
- [ ] Tool reference added to CLAUDE.md
- [ ] Troubleshooting guide with common errors
- [ ] Code comments explain non-obvious logic

---

## 10. Open Questions & Decisions Needed

### 10.1 Context Persistence in architecture.yaml

**Question**: Should agent-dev contexts be persisted in `architecture.yaml`?

**Options**:
1. **Yes (file mutation)**: Add context to `architecture.yaml` during provision
   - Pros: Consistent with manual contexts, discoverable via `brat context list`
   - Cons: Git conflicts, file churn, not truly ephemeral

2. **No (in-memory only)**: Keep in `~/.bratrc` or `.brat/agent-dev-state.json`
   - Pros: No file mutation, truly ephemeral
   - Cons: Not discoverable via standard tooling

3. **Hybrid**: Store in `.brat/ephemeral-contexts.yaml` (gitignored)
   - Pros: Discoverable, no architecture.yaml mutation
   - Cons: New file to manage

**DECISION**: ✅ **Option 3 (APPROVED)** — Store in `.brat/ephemeral-contexts.yaml`
- User approved this approach
- ContextResolver will check both `architecture.yaml` and `.brat/ephemeral-contexts.yaml`
- Ephemeral contexts take precedence if name collision

### 10.2 PostgreSQL Database Strategy

**Question**: How to isolate PostgreSQL data per context?

**Options**:
1. **Separate databases**: `bitbrat_agent_dev_{timestamp}` on shared PostgreSQL server
   - Pros: True isolation, easy to drop
   - Cons: Schema duplication, migration complexity

2. **Schema-based isolation**: Same DB, different schemas
   - Pros: Less overhead
   - Cons: Shared connection pool, harder to cleanup

3. **Separate PostgreSQL container**: Dedicated postgres container per context
   - Pros: Full isolation, easy to destroy
   - Cons: High resource usage, slower startup

**Recommendation**: **Option 1 (Separate databases)** — Balance of isolation and efficiency

### 10.3 Auto-Destroy Timing

**Question**: When should agent-dev contexts auto-destroy?

**Options**:
1. **On agent session end**: When dev-mcp server shuts down
   - Pros: True ephemeral
   - Cons: Unexpected data loss if agent crashes

2. **On explicit destroy only**: Agent must call `agent_dev.destroy`
   - Pros: Predictable, agent controls lifecycle
   - Cons: Risk of orphaned contexts if agent forgets

3. **TTL-based**: Auto-destroy after 24 hours of inactivity
   - Pros: Prevents orphans
   - Cons: Complexity, needs background job

**Recommendation**: **Option 2 (Explicit destroy)** + **Option 3 (TTL as safety net)**

### 10.4 Port Allocation Strategy

**Question**: How to allocate unique ports for agent-dev contexts?

**Options**:
1. **Static offset**: agent-dev uses 4000-4100 range
   - Pros: Simple, predictable
   - Cons: Max 1 agent-dev context at a time

2. **Dynamic allocation**: PortManager assigns free ports
   - Pros: Multiple agent-dev contexts
   - Cons: Existing PortManager is stateless (no persistence)

3. **Docker automatic**: Let Docker assign random host ports
   - Pros: No collision risk
   - Cons: Harder to discover, less predictable

**Recommendation**: **Option 1 (Static offset)** for MVP, **Option 2 (Dynamic)** for v2

---

## 11. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Docker resource exhaustion | High | Medium | Rate limit: 1 context/agent, auto-destroy TTL |
| Incomplete cleanup (orphaned resources) | Medium | Medium | Integration tests, idempotent destroy |
| Agent confusion (which context am I using?) | Medium | Low | Clear tool responses, `status` command |
| PostgreSQL seed data drift | Low | Medium | Seed script in version control, CI validation |
| Context name collisions | Medium | Low | Timestamp + random suffix, uniqueness check |
| SSH key management (if remote agent-dev) | High | Low | OUT OF SCOPE: Local only for MVP |

---

## 12. Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Core Infrastructure | 1-2 days | None |
| Phase 2: MCP Tool Integration | 1 day | Phase 1 |
| Phase 3: Orchestration & Lifecycle | 1 day | Phase 2 |
| Phase 4: Polish & Documentation | 1 day | Phase 3 |
| **Total** | **4-5 days** | |

**Revised estimate (down from 6-8 days)** because:
- ✅ Non-interactive mode already exists in `brat context create`
- ✅ All scaffolding functions already exist (just need to export them)
- ✅ No need to build status/logs tools (reusing fleet tools)
- ✅ PostgreSQL seeding already implemented (`cmdSeed`)
- ✅ Docker orchestration already works (`DockerOrchestrator`)

**Assumptions**:
- Single developer (architect as implementer)
- Existing infrastructure (ContextResolver, DockerOrchestrator) stable
- No major blockers (Docker works, PostgreSQL accessible)

---

## 13. Next Steps

1. **Review this TA with stakeholder** (Christopher Navta)
2. **Finalize open questions** (decisions on persistence, ports, auto-destroy)
3. **Create implementation plan** (`implementation-plan.md`)
4. **Begin Phase 1**: AgentDevContextManager skeleton
5. **Iterate**: Build, test, refine

---

## Appendices

### Appendix A: File Structure

```
tools/brat/src/dev-mcp/
├── agent-dev-context-manager.ts       # NEW: Core lifecycle manager
├── agent-dev-context-manager.test.ts  # NEW: Unit tests
├── tools/
│   ├── agent-dev.ts                   # NEW: 4 MCP lifecycle tools
│   └── agent-dev.test.ts              # NEW: Tool tests
├── server.ts                          # MODIFY: Register tools
└── audit-logger.ts                    # MODIFY: Add structured fields

.brat/
├── ephemeral-contexts.yaml            # NEW: Agent-dev context registry
├── agent-dev-state.json               # NEW: Runtime state (optional)
└── dev-mcp-audit.log                  # EXISTING: Audit log

env/
└── agent-dev-{timestamp}/             # NEW: Generated per context
    ├── global.yaml
    ├── infra.yaml
    ├── llm-bot.yaml
    ├── persistence.yaml
    └── ...

documentation/guides/
└── agent-dev-contexts.md              # NEW: User guide
```

### Appendix B: Sample Usage Session

```typescript
// Agent session starts
const agent = new ClaudeCodeAgent();

// 1. Provision
const provision = await agent.callTool('agent_dev.provision', {
  profile: 'dev',
  persistence: 'postgres',
});
// Output: "✅ Provisioned agent-dev context: agent-dev-1721745296"

// 2. Start
const start = await agent.callTool('agent_dev.start', {
  name: 'agent-dev-1721745296',
});
// Output: "✅ Started all services. Gateway: ws://localhost:4004/ws/v1"

// 3. Query data (existing persistence tool)
const query = await agent.callTool('persistence.query', {
  collection: 'routing_rules',
  target: 'agent-dev-1721745296',
});
// Output: "Found 3 routing rules: ..."

// 4. Check Bit health (existing fleet tool)
const health = await agent.callTool('fleet.info', {
  bit: 'llm-bot',
  context: 'agent-dev-1721745296',
});
// Output: "Bit: llm-bot, Status: healthy, Uptime: 45s"

// 5. Stream logs (existing fleet tool)
const logs = await agent.callTool('fleet.logs', {
  bit: 'event-router',
  context: 'agent-dev-1721745296',
  level: ['error', 'warn'],
  since: '5m',
});
// Output: "[2026-07-23 12:34:56] [warn] event-router: Routing slip empty..."

// 6. Destroy (when done)
const destroy = await agent.callTool('agent_dev.destroy', {
  name: 'agent-dev-1721745296',
  confirm: true,
});
// Output: "✅ Destroyed agent-dev context: agent-dev-1721745296"
```

---

**End of Technical Architecture Document**
